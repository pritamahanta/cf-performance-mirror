import test from 'node:test';
import assert from 'node:assert/strict';

import { OnlineFriendsPoller } from '../src/services/onlinePoller.ts';
import type { PollerApi, PollerState, Visibility } from '../src/services/onlinePoller.ts';
import { OnlineTracker } from '../src/domain/onlineTracker.ts';
import type { Persistence, PersistedSnapshot } from '../src/services/onlineStore.ts';
import { createBrowserPersistence, STORAGE_PREFIX } from '../src/services/onlineStore.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

function snapshotOf(opts: { friends: string[]; online: string[]; checkedAt: number; updatedAt: number; lastCycleEndedAt: number; lastFullEndedAt: number; lastFullDurationMs: number }): PersistedSnapshot {
  const t = new OnlineTracker();
  t.syncFriends(opts.friends);
  for (const h of opts.friends) t.record(h, opts.online.includes(h) ? 'online' : 'offline', opts.checkedAt);
  t.applyInfo(opts.online, opts.online.map(handle => ({ handle, rating: 1500, rank: 'x' })));
  t.snapshot(opts.checkedAt);
  return { v: 1, savedAt: opts.updatedAt, tracker: t.exportState(), updatedAt: opts.updatedAt, incomplete: false,
    lastCycleEndedAt: opts.lastCycleEndedAt, lastFullEndedAt: opts.lastFullEndedAt, lastFullDurationMs: opts.lastFullDurationMs,
    fullScanStartedAt: 0, fullScanOpen: false };
}

function fakePersistence(seed: PersistedSnapshot | null, lock: { held: boolean }) {
  let stored = seed;
  const counts = { load: 0, save: 0 };
  const p: Persistence = {
    load: () => { counts.load++; return stored; },
    save: s => { counts.save++; stored = s; },
    onExternalChange: () => () => {},
    runExclusive: async task => { if (lock.held) return false; await task(); return true; },
  };
  return { p, counts };
}

function fakeApi(friends: string[], onlineSet: Set<string>, friendsDelay = 0) {
  const calls = { friends: 0, checks: 0, order: [] as string[] };
  const api: PollerApi = {
    fetchFriends: async () => { calls.friends++; if (friendsDelay) await sleep(friendsDelay); return friends; },
    checkProfile: async h => { calls.checks++; calls.order.push(h); await sleep(2); return onlineSet.has(h) ? 'online' : 'offline'; },
    fetchInfo: async hs => hs.map(handle => ({ handle, rating: 1500, rank: 'x' })),
  };
  return { api, calls };
}

const FAST = { requestsPerSecond: 0, intervalMs: 60, lockRetryMs: 40, flushMs: 10, infoGapMs: 5, progressAfterMs: 5000, minManualGapMs: 1, persistSaveGapMs: 10 };

test('lock lost: tab that loses the lock must resume once the lock is free', async () => {
  const lock = { held: true };
  const { p } = fakePersistence(null, lock);
  const { api, calls } = fakeApi(['a', 'b'], new Set(['a']));
  const poller = new OnlineFriendsPoller(api, visible, FAST, p);
  poller.start();
  await sleep(150);
  assert.equal(calls.friends, 0, 'nothing should run while the lock is held');
  lock.held = false;
  await sleep(400);
  poller.stop();
  assert.ok(calls.friends > 0, 'poller never resumed after the lock was released');
});

test('idle: no busy loop when nothing is due and nobody is online', async () => {
  const now = Date.now();
  const friends = Array.from({ length: 50 }, (_, i) => 'f' + i);
  const seed = snapshotOf({ friends, online: [], checkedAt: now - 500, updatedAt: now - 500,
    lastCycleEndedAt: now - 500, lastFullEndedAt: now - 500, lastFullDurationMs: 5000 });
  const { p, counts } = fakePersistence(seed, { held: false });
  const { api } = fakeApi(friends, new Set());
  const poller = new OnlineFriendsPoller(api, visible, FAST, p);
  poller.start();
  await sleep(400);
  poller.stop();
  assert.ok(counts.load < 30, `persistence.load() called ${counts.load} times in 400ms (busy loop)`);
});

test('stale cache: stale snapshot must not show a confident empty list', async () => {
  const now = Date.now();
  const friends = ['a', 'b', 'c'];
  const old = now - 2 * 3600_000;
  const seed = snapshotOf({ friends, online: ['a'], checkedAt: old, updatedAt: old,
    lastCycleEndedAt: old, lastFullEndedAt: old, lastFullDurationMs: 1000 });
  const { p } = fakePersistence(seed, { held: false });
  const { api } = fakeApi(friends, new Set(['a']), 150);
  const poller = new OnlineFriendsPoller(api, visible, FAST, p);
  const seen: PollerState[] = [];
  poller.subscribe(() => seen.push(poller.getState()));
  poller.start();
  await sleep(100);
  const during = poller.getState();
  poller.stop();
  assert.equal(during.status, 'loading', `state while scanning was ${during.status}${during.status === 'ready' ? ' with ' + during.friends.length + ' friends' : ''}`);
});

test('cleanup: wiping other accounts keeps no stale keys', () => {
  const data = new Map<string, string>();
  const storage = {
    get length() { return data.size; },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  } as unknown as Storage;
  for (const n of ['a', 'b', 'c', 'd']) data.set(STORAGE_PREFIX + n, '{}');
  data.set('other', '1');
  const doc = { querySelector: () => ({ getAttribute: () => '/profile/me' }) } as unknown as Document;
  createBrowserPersistence({ storage, doc, win: { addEventListener() {}, removeEventListener() {} } });
  const left = Array.from(data.keys()).filter(k => k.startsWith(STORAGE_PREFIX));
  assert.deepEqual(left, [], `stale keys left: ${left.join(',')}`);
});

test('navigation: an interrupted full scan does not starve friends outside the online group', async () => {
  // Codeforces is page-per-profile, so every click to a new profile
  // tears down the content script and spins up a brand new poller
  // against the same persisted store. A full scan over a big friend
  // list takes a while, so clicking quickly tears it down mid-scan,
  // over and over, before it ever reaches anyone outside the online
  // group. The next cycle after an interruption is always "quick"
  // (the just-interrupted full scan goes on cooldown) - it must still
  // check friends the full scan never got to, not just re-confirm
  // whoever is already online (nobody, here).
  const friends = Array.from({ length: 300 }, (_, i) => 'f' + i);
  const { p } = fakePersistence(null, { held: false });
  const { api, calls } = fakeApi(friends, new Set());

  // Round 1: starts a full scan, then the page is "navigated away"
  // well before it can finish.
  const first = new OnlineFriendsPoller(api, visible, { ...FAST, maxConcurrency: 3 }, p);
  first.start();
  await sleep(20);
  first.stop();

  const afterRound1 = calls.order.length;
  assert.ok(afterRound1 > 0, 'the interrupted scan should have checked at least a few friends');
  assert.ok(afterRound1 < friends.length, 'the full scan must not have finished - that is this test\'s premise');

  // Round 2: the next page. The full scan just got interrupted, so
  // it is on cooldown (resumeMinGapMs) and this can only run a quick
  // cycle.
  const second = new OnlineFriendsPoller(api, visible, { ...FAST, maxConcurrency: 3, quickColdBudget: 8 }, p);
  second.start();

  const deadline = Date.now() + 2000;
  while (calls.order.length < afterRound1 + 8 && Date.now() < deadline) {
    await sleep(5);
  }

  second.stop();

  assert.equal(
    calls.order.length - afterRound1,
    8,
    `a quick cycle after an interrupted full scan checked ${calls.order.length - afterRound1} new friends, ` +
      'expected exactly the 8-friend cold budget - this is what used to be 0 and starved the list forever',
  );
});
