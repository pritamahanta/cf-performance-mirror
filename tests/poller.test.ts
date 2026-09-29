import test from 'node:test';
import assert from 'node:assert/strict';

import { OnlineFriendsPoller } from '../src/services/onlinePoller.ts';
import type { PollerApi, PollerState, Visibility } from '../src/services/onlinePoller.ts';
import type { OnlineStatus } from '../src/domain/onlineTracker.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function fakeVisibility() {
  let hidden = false;
  const callbacks = new Set<() => void>();
  const visibility: Visibility = {
    isHidden: () => hidden,
    subscribe: cb => {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
  };
  return {
    visibility,
    set(value: boolean) {
      hidden = value;
      callbacks.forEach(cb => cb());
    },
  };
}

const FAST = {
  intervalMs: 60,
  maxBackoffMs: 300,
  progressAfterMs: 20,
  flushMs: 5,
  infoGapMs: 1,
  minManualGapMs: 10,
  maxFullScanGapMs: 500,
  poolBaseBackoffMs: 5,
  poolMaxBackoffMs: 20,
};

function makeApi(opts: {
  friends: string[];
  online: Set<string>;
  latencyMs?: number;
  fail?: () => boolean;
}) {
  const stats = { friendsCalls: 0, checks: 0, concurrent: 0, peakConcurrent: 0, cycles: 0, aborts: 0 };
  const api: PollerApi = {
    fetchFriends: async signal => {
      stats.friendsCalls += 1;
      stats.cycles += 1;
      if (signal.aborted) throw new Error('aborted');
      return opts.friends;
    },
    checkProfile: async (handle, signal): Promise<OnlineStatus> => {
      stats.checks += 1;
      stats.concurrent += 1;
      stats.peakConcurrent = Math.max(stats.peakConcurrent, stats.concurrent);
      try {
        await new Promise<void>(resolve => {
          const t = setTimeout(resolve, opts.latencyMs ?? 1);
          signal.addEventListener('abort', () => {
            stats.aborts += 1;
            clearTimeout(t);
            resolve();
          });
        });
        if (signal.aborted) return 'unknown';
        if (opts.fail?.()) return 'unknown';
        return opts.online.has(handle) ? 'online' : 'offline';
      } finally {
        stats.concurrent -= 1;
      }
    },
    fetchInfo: async handles => handles.map(handle => ({ handle, rating: 1400, rank: 'pupil' })),
  };
  return { api, stats };
}

async function waitFor(poller: OnlineFriendsPoller, pred: (s: PollerState) => boolean, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred(poller.getState())) return poller.getState();
    await sleep(5);
  }
  throw new Error(`timeout; state was ${JSON.stringify(poller.getState())}`);
}

const ready = (s: PollerState) => (s.status === 'ready' ? s.friends.map(f => f.handle) : null);

test('poller: shows online friends with ratings', async () => {
  const { api } = makeApi({ friends: ['a', 'b', 'c', 'd'], online: new Set(['b', 'd']) });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, FAST);
  poller.start();
  const s = await waitFor(poller, s => s.status === 'ready' && s.friends.length === 2);
  assert.equal(s.status === 'ready' && s.friends[0].rating, 1400);
  poller.stop();
});

test('poller: list grows while a big scan runs, with progress', async () => {
  const friends = Array.from({ length: 120 }, (_, i) => `f${i}`);
  const online = new Set(friends.filter((_, i) => i % 10 === 0));
  const { api } = makeApi({ friends, online, latencyMs: 8 });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, { ...FAST, intervalMs: 5000, maxConcurrency: 4 });
  const sizes: number[] = [];
  let sawProgress = false;
  poller.subscribe(() => {
    const s = poller.getState();
    if (s.status === 'ready') sizes.push(s.friends.length);
    if (s.progress && s.progress.total === 120) sawProgress = true;
  });
  poller.start();
  await waitFor(poller, s => s.status === 'ready' && s.friends.length === 12 && s.progress === null, 5000);
  assert.ok(sawProgress, 'progress should be reported for a long scan');
  const distinct = new Set(sizes).size;
  assert.ok(distinct >= 3, `list should grow in steps, saw sizes ${[...new Set(sizes)]}`);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1] || sizes[i] === 12, 'never shrinks mid-scan');
  poller.stop();
});

test('poller: a cycle slower than the interval never overlaps another', async () => {
  const friends = Array.from({ length: 60 }, (_, i) => `f${i}`);
  const { api, stats } = makeApi({ friends, online: new Set(['f1']), latencyMs: 10 });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, { ...FAST, intervalMs: 20, maxConcurrency: 3 });
  poller.start();
  await sleep(700);
  assert.ok(stats.peakConcurrent <= 3, `peak concurrency ${stats.peakConcurrent}`);
  const s = poller.getState();
  assert.equal(s.status, 'ready');
  assert.deepEqual(ready(s), ['f1']);
  poller.stop();
});

test('poller: failed checks never turn an online friend offline', async () => {
  let failing = false;
  const { api } = makeApi({ friends: ['a', 'b'], online: new Set(['a']), fail: () => failing });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, FAST);
  poller.start();
  await waitFor(poller, s => ready(s)?.length === 1);
  failing = true;
  await sleep(250);
  assert.deepEqual(ready(poller.getState()), ['a']);
  poller.stop();
});

test('poller: friend who really went offline is removed by the next check', async () => {
  const online = new Set(['a', 'b']);
  const { api } = makeApi({ friends: ['a', 'b'], online });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, FAST);
  poller.start();
  await waitFor(poller, s => ready(s)?.length === 2);
  online.delete('a');
  await waitFor(poller, s => ready(s)?.join() === 'b');
  poller.stop();
});

test('poller: total failure with nothing to show becomes an error, then recovers', async () => {
  let failing = true;
  const { api } = makeApi({ friends: ['a', 'b', 'c'], online: new Set(['a']), fail: () => failing });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, { ...FAST, intervalMs: 30 });
  poller.start();
  await waitFor(poller, s => s.status === 'error', 3000);
  failing = false;
  await waitFor(poller, s => ready(s)?.join() === 'a', 4000);
  poller.stop();
});

test('poller: hidden tab aborts the cycle and makes no requests; showing it resumes', async () => {
  const friends = Array.from({ length: 200 }, (_, i) => `f${i}`);
  const { api, stats } = makeApi({ friends, online: new Set(['f0']), latencyMs: 15 });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, { ...FAST, maxConcurrency: 4 });
  poller.start();
  await sleep(60);
  v.set(true);
  await sleep(40);
  const checksWhenHidden = stats.checks;
  await sleep(300);
  assert.equal(stats.checks, checksWhenHidden, 'no requests while hidden');
  v.set(false);
  await waitFor(poller, s => ready(s)?.join() === 'f0', 5000);
  assert.ok(stats.checks > checksWhenHidden);
  poller.stop();
});

test('poller: starting hidden waits until visible', async () => {
  const { api, stats } = makeApi({ friends: ['a'], online: new Set(['a']) });
  const v = fakeVisibility();
  v.set(true);
  const poller = new OnlineFriendsPoller(api, v.visibility, FAST);
  poller.start();
  await sleep(150);
  assert.equal(stats.friendsCalls, 0);
  v.set(false);
  await waitFor(poller, s => ready(s)?.join() === 'a');
  poller.stop();
});

test('poller: manual refresh runs a fresh full check and shows feedback', async () => {
  const online = new Set<string>();
  const { api, stats } = makeApi({ friends: ['a', 'b'], online });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, { ...FAST, intervalMs: 60_000 });
  poller.start();
  await waitFor(poller, s => s.status === 'ready');
  const before = stats.friendsCalls;
  online.add('b');
  await sleep(20);
  poller.refresh();
  await waitFor(poller, s => ready(s)?.join() === 'b');
  assert.equal(stats.friendsCalls, before + 1);
  poller.stop();
});

test('poller: stop() aborts in-flight work and resets to loading', async () => {
  const friends = Array.from({ length: 100 }, (_, i) => `f${i}`);
  const { api, stats } = makeApi({ friends, online: new Set(['f0']), latencyMs: 20 });
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, FAST);
  poller.start();
  await sleep(50);
  poller.stop();
  const checks = stats.checks;
  await sleep(200);
  assert.equal(stats.checks, checks, 'no requests after stop');
  assert.equal(poller.getState().status, 'loading');
});

test('poller: friends page failure keeps the current list', async () => {
  let breakFriends = false;
  const base = makeApi({ friends: ['a', 'b'], online: new Set(['a']) });
  const api: PollerApi = {
    ...base.api,
    fetchFriends: async signal => {
      if (breakFriends) throw new Error('logged out');
      return base.api.fetchFriends(signal);
    },
  };
  const v = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, v.visibility, FAST);
  poller.start();
  await waitFor(poller, s => ready(s)?.join() === 'a');
  breakFriends = true;
  await sleep(250);
  assert.deepEqual(ready(poller.getState()), ['a']);
  poller.stop();
});
