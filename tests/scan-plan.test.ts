import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { OnlineTracker } from '../src/domain/onlineTracker.ts';
import type { CodeforcesUser } from '../src/types/codeforces.ts';
import { OnlineFriendsPoller } from '../src/services/onlinePoller.ts';
import type { PollerApi, Visibility } from '../src/services/onlinePoller.ts';

const NOW = 1_800_000_000_000;
const DAY = 24 * 3_600_000;
const OPTS = { hotWindowMs: DAY, budget: 6, coldReserve: 2 };

const names = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
const sec = (ms: number) => Math.floor(ms / 1000);

function trackerWith(friends: string[]) {
  const t = new OnlineTracker();

  t.syncFriends(friends);

  return t;
}

/* ------------------------------ tracker level ------------------------------ */

test('plan: online first, then recently active (most recent first), then longest-unchecked', () => {
  const t = trackerWith(names(10));

  t.record('f9', 'online', NOW - 1000);
  t.applyActivity([
    { handle: 'f2', lastOnlineTimeSeconds: sec(NOW - 3_600_000) },
    { handle: 'f5', lastOnlineTimeSeconds: sec(NOW - 60_000) },
    { handle: 'f7', lastOnlineTimeSeconds: sec(NOW - 7_200_000) },
    { handle: 'f1', lastOnlineTimeSeconds: sec(NOW - 10 * DAY) },
  ]);
  t.record('f3', 'offline', NOW - 5000);

  const plan = t.planScan(NOW, { hotWindowMs: DAY, budget: 100, coldReserve: 2 });

  assert.deepEqual(plan.slice(0, 4), ['f9', 'f5', 'f2', 'f7']);
  /* The rest: never-checked first (list order), the recently checked f3 last. */
  assert.deepEqual(plan.slice(4), ['f0', 'f1', 'f4', 'f6', 'f8', 'f3']);
});

test('plan: everyone shown online is always included, even above the budget', () => {
  const t = trackerWith(names(12));

  for (let i = 0; i < 9; i += 1) t.record(`f${i}`, 'online', NOW);

  const plan = t.planScan(NOW, { hotWindowMs: DAY, budget: 2, coldReserve: 1 });

  assert.equal(plan.filter(h => Number(h.slice(1)) < 9).length, 9);
  assert.equal(plan.length, 9 + 2);
});

test('plan: the budget caps hot friends, keeps a cold reserve, and overflow gets its turn', () => {
  const t = trackerWith(names(30));
  const users: CodeforcesUser[] = [];

  /* f0..f19 are all recently active; f0 most recently. */
  for (let i = 0; i < 20; i += 1) users.push({ handle: `f${i}`, lastOnlineTimeSeconds: sec(NOW - (i + 1) * 60_000) });

  t.applyActivity(users);

  const plan = t.planScan(NOW, OPTS);

  assert.equal(plan.length, 6);
  /* budget 6, reserve 2 => 4 hot (the most recent), 2 from the rest. */
  assert.deepEqual(plan.slice(0, 4), ['f0', 'f1', 'f2', 'f3']);
  assert.equal(plan.slice(4).length, 2);

  /* Overflow hot friends (f4..f19) join the rest and are checked longest-unchecked first. */
  t.record('f0', 'offline', NOW);
  t.record('f1', 'offline', NOW);
  t.record('f2', 'offline', NOW);
  t.record('f3', 'offline', NOW);
  t.record('f4', 'offline', NOW - 1000);

  const next = t.planScan(NOW, OPTS);
  const rest = next.slice(4);

  assert.ok(!rest.includes('f4'), 'a friend checked a moment ago waits for others');
  assert.ok(rest.every(h => !['f0', 'f1', 'f2', 'f3'].includes(h)));
});

test('plan: without activity data every friend is in the rest, capped by the budget', () => {
  const t = trackerWith(names(40));
  const plan = t.planScan(NOW, OPTS);

  assert.equal(plan.length, 6);
  assert.deepEqual(plan, ['f0', 'f1', 'f2', 'f3', 'f4', 'f5']);
});

test('activity: ignores non-friends, converts seconds to ms, and survives export/import', () => {
  const t = trackerWith(['Alice', 'bob']);

  t.applyActivity([
    { handle: 'alice', rating: 1500, rank: 'specialist', lastOnlineTimeSeconds: 1_700_000_000 },
    { handle: 'stranger', lastOnlineTimeSeconds: 1_700_000_000 },
    { handle: 'bob' },
  ]);
  t.record('Alice', 'online', NOW);

  const state = t.exportState();

  assert.deepEqual(state.seen, [['alice', 1_700_000_000_000]]);
  assert.deepEqual(state.infos.map(i => i.handle), ['alice'], 'infos are only saved for friends shown online');

  const copy = new OnlineTracker();

  assert.equal(copy.importState(JSON.parse(JSON.stringify(state))), true);
  assert.deepEqual(copy.exportState().seen, state.seen);
});

test('import: accepts old snapshots without `seen`, rejects malformed `seen`', () => {
  const t = trackerWith(['a', 'b']);
  const good = JSON.parse(JSON.stringify(t.exportState()));

  delete good.seen;
  assert.equal(new OnlineTracker().importState(good), true);

  for (const bad of ['x', [['a']], [['a', 'x']], [['zzz', 1]], [['a', -5]], [[7, 1]]]) {
    const target = new OnlineTracker();

    assert.equal(target.importState({ ...good, seen: bad }), false, JSON.stringify(bad));
  }
});

test('syncFriends forgets the activity of removed friends', () => {
  const t = trackerWith(['a', 'b']);

  t.applyActivity([{ handle: 'a', lastOnlineTimeSeconds: 1_700_000_000 }, { handle: 'b', lastOnlineTimeSeconds: 1_700_000_000 }]);
  t.syncFriends(['a']);
  assert.deepEqual(t.exportState().seen, [['a', 1_700_000_000_000]]);
});

/* ------------------------------ poller level ------------------------------ */

const created: OnlineFriendsPoller[] = [];

class TrackedPoller extends OnlineFriendsPoller {
  constructor(...args: ConstructorParameters<typeof OnlineFriendsPoller>) {
    super(...args);
    created.push(this);
  }
}

afterEach(() => {
  for (const poller of created.splice(0)) poller.stop();
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const visible: Visibility = { isHidden: () => false, subscribe: () => () => {} };

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const t0 = Date.now();

  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out');
    await sleep(5);
  }
}

const CFG = {
  requestsPerSecond: 0,
  intervalMs: 60_000,
  maxFullScanGapMs: 60_000,
  progressAfterMs: 0,
  flushMs: 5,
  infoGapMs: 1,
  minManualGapMs: 1,
  poolBaseBackoffMs: 5,
  poolMaxBackoffMs: 20,
  maxConcurrency: 1,
};

function makeApi(friends: string[], online: Set<string>, hot: Set<string>, opts: { failInfo?: boolean } = {}) {
  const calls = { order: [] as string[], infoCalls: 0, friends: 0 };
  const api: PollerApi = {
    fetchFriends: async () => {
      calls.friends += 1;

      return friends;
    },
    checkProfile: async handle => {
      calls.order.push(handle);
      await sleep(1);

      return online.has(handle) ? 'online' : 'offline';
    },
    fetchInfo: async handles => {
      calls.infoCalls += 1;

      if (opts.failInfo) throw new Error('boom');

      const nowSec = Math.floor(Date.now() / 1000);

      return handles.map((handle, i) => ({
        handle,
        rating: 1500,
        rank: 'specialist',
        lastOnlineTimeSeconds: hot.has(handle) ? nowSec - 60 - i : nowSec - 30 * 86_400,
      }));
    },
  };

  return { api, calls };
}

test('poller: likely-online friends are checked first and the scan stays within budget', async () => {
  const friends = names(300);
  const hot = new Set(names(300).slice(250, 260));
  const online = new Set(['f255']);
  const { api, calls } = makeApi(friends, online, hot);
  const poller = new TrackedPoller(api, visible, { ...CFG, scanBudget: 50, coldReserve: 10 });

  poller.start();
  await waitFor(() => calls.order.length >= 50 && poller.getState().status === 'ready');
  await sleep(30);

  assert.deepEqual(new Set(calls.order.slice(0, 10)), hot, 'the ten recently active friends come first');
  assert.equal(new Set(calls.order).size, 50, 'only the budgeted number of friends was checked');

  const state = poller.getState();

  assert.equal(state.status, 'ready');

  if (state.status === 'ready') {
    assert.deepEqual(state.friends.map(f => f.handle), ['f255']);
    assert.equal(state.friends[0].rating, 1500, 'rating came from the activity pass');
  }

  assert.equal(calls.infoCalls, 1, 'no extra user.info call for the online friend');
});

test('poller: if the activity pass fails the scan still runs, in plain order', async () => {
  const friends = names(60);
  const { api, calls } = makeApi(friends, new Set(['f3']), new Set(), { failInfo: true });
  const poller = new TrackedPoller(api, visible, { ...CFG, scanBudget: 20, coldReserve: 5 });

  poller.start();
  await waitFor(() => calls.order.length >= 20);
  await sleep(40);

  assert.equal(new Set(calls.order).size, 20);
  assert.equal(poller.getState().status, 'ready');
});

test('plan: with no budget limit every friend is included exactly once, shown-online first', () => {
  const t = trackerWith(names(50));

  t.record('f40', 'online', NOW);
  t.applyActivity([{ handle: 'f3', lastOnlineTimeSeconds: sec(NOW - 60_000) }]);

  const plan = t.planScan(NOW, { hotWindowMs: DAY, budget: Number.POSITIVE_INFINITY, coldReserve: 30 });

  assert.equal(plan.length, 50);
  assert.equal(new Set(plan).size, 50);
  assert.deepEqual(plan.slice(0, 2), ['f40', 'f3']);
});

test('plan: hotWindowMs of 0 turns the recency ordering off', () => {
  const t = trackerWith(names(6));

  t.applyActivity([{ handle: 'f5', lastOnlineTimeSeconds: sec(NOW - 1000) }]);
  t.record('f0', 'offline', NOW);

  const plan = t.planScan(NOW, { hotWindowMs: 0, budget: Number.POSITIVE_INFINITY, coldReserve: 0 });

  assert.deepEqual(plan, ['f1', 'f2', 'f3', 'f4', 'f5', 'f0']);
});

test('poller: by default a dormant friend who is online is found in the very first scan', async () => {
  const friends = names(300);
  const calls: string[] = [];
  const api: PollerApi = {
    fetchFriends: async () => friends,
    checkProfile: async handle => {
      calls.push(handle);
      await sleep(1);

      return handle === 'f299' ? 'online' : 'offline';
    },
    /* Nobody was seen in a month: the activity data points nowhere useful. */
    fetchInfo: async handles =>
      handles.map(handle => ({ handle, rating: 1200, rank: 'pupil', lastOnlineTimeSeconds: Math.floor(Date.now() / 1000) - 30 * 86_400 })),
  };
  const poller = new TrackedPoller(api, visible, CFG);

  poller.start();
  await waitFor(() => {
    const state = poller.getState();

    return state.status === 'ready' && state.friends.some(f => f.handle === 'f299');
  });

  assert.equal(new Set(calls).size, 300, 'every friend was checked on their profile page');
});
