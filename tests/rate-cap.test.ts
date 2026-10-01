import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { checkHandles } from '../src/services/onlinePool.ts';
import { createTokenBucket } from '../src/services/rateLimiter.ts';
import type { RateLimiter } from '../src/services/rateLimiter.ts';
import { OnlineFriendsPoller } from '../src/services/onlinePoller.ts';
import type { PollerApi, PollerState, Visibility } from '../src/services/onlinePoller.ts';
import { OnlineTracker } from '../src/domain/onlineTracker.ts';
import type { OnlineStatus } from '../src/domain/onlineTracker.ts';
import type { Persistence, PersistedSnapshot } from '../src/services/onlineStore.ts';

/* Every poller a test creates is stopped afterwards, even when an assertion throws. */
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

function activeTimers(): number | null {
  const info = (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo;

  return info ? info.call(process).filter(name => name === 'Timeout').length : null;
}

/* ------------------------------ pool level ------------------------------ */

test('pool: a token bucket caps the start rate', async () => {
  const handles = Array.from({ length: 10 }, (_, i) => `h${i}`);
  const starts: number[] = [];
  const t0 = Date.now();

  await checkHandles(handles, {
    signal: new AbortController().signal,
    maxConcurrency: 10,
    limiter: createTokenBucket({ capacity: 3, refillPerSec: 20 }),
    check: async () => {
      starts.push(Date.now() - t0);

      return 'offline';
    },
    onResult: () => {},
  });

  assert.equal(starts.length, 10);
  assert.ok(starts.filter(t => t < 30).length <= 3, `starts in first 30ms: ${starts.filter(t => t < 30).length}`);
  assert.ok(Date.now() - t0 >= 300, `7 refills at 20/s need ~350ms, took ${Date.now() - t0}ms`);
});

test('pool: retries consume tokens too', async () => {
  let taken = 0;
  const inner = createTokenBucket({ capacity: 100, refillPerSec: 1000 });
  const counting: RateLimiter = {
    take: () => {
      const wait = inner.take();

      if (wait === 0) taken += 1;

      return wait;
    },
  };
  const attempts = new Map<string, number>();

  await checkHandles(['a', 'b', 'c'], {
    signal: new AbortController().signal,
    maxConcurrency: 1,
    limiter: counting,
    check: async handle => {
      const n = (attempts.get(handle) ?? 0) + 1;

      attempts.set(handle, n);

      return handle === 'b' && n === 1 ? 'unknown' : 'offline';
    },
    onResult: () => {},
  });

  assert.equal(taken, 4, 'three friends plus one retry');
});

test('pool: aborting while waiting for a token ends the run and leaves no timer', async () => {
  const before = activeTimers();
  const controller = new AbortController();
  let started = 0;

  const run = checkHandles(Array.from({ length: 6 }, (_, i) => `h${i}`), {
    signal: controller.signal,
    maxConcurrency: 4,
    limiter: createTokenBucket({ capacity: 1, refillPerSec: 0.5 }),
    check: async () => {
      started += 1;

      return 'offline';
    },
    onResult: () => {},
  });

  await sleep(50);
  controller.abort();

  const t0 = Date.now();
  const summary = await run;

  assert.equal(summary.aborted, true);
  assert.ok(Date.now() - t0 < 200);
  assert.equal(started, 1, 'only the burst token was used');

  await sleep(10);

  const after = activeTimers();

  if (before !== null && after !== null) {
    assert.ok(after <= before, `timers before ${before}, after ${after}`);
  }
});

/* ----------------------------- poller level ----------------------------- */

interface Calls {
  friends: number;
  perHandle: Map<string, number>;
  order: string[];
}

function makeApi(opts: {
  friends: string[];
  online: Set<string>;
  latencyMs?: number;
  statusFor?: (handle: string, nth: number) => OnlineStatus;
}) {
  const calls: Calls = { friends: 0, perHandle: new Map(), order: [] };
  const api: PollerApi = {
    fetchFriends: async () => {
      calls.friends += 1;

      return opts.friends;
    },
    checkProfile: async handle => {
      const nth = (calls.perHandle.get(handle) ?? 0) + 1;

      calls.perHandle.set(handle, nth);
      calls.order.push(handle);
      await sleep(opts.latencyMs ?? 1);

      if (opts.statusFor) return opts.statusFor(handle, nth);

      return opts.online.has(handle) ? 'online' : 'offline';
    },
    fetchInfo: async handles => handles.map(handle => ({ handle, rating: 1500, rank: 'specialist' })),
  };

  return { api, calls };
}

const BASE = {
  intervalMs: 60_000,
  maxFullScanGapMs: 60_000,
  progressAfterMs: 0,
  flushMs: 5,
  infoGapMs: 1,
  minManualGapMs: 1,
  poolBaseBackoffMs: 5,
  poolMaxBackoffMs: 20,
};

const friendsOf = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const t0 = Date.now();

  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out');
    await sleep(5);
  }
}

function lastFullDone(poller: OnlineFriendsPoller, calls: Calls, total: number): boolean {
  const state = poller.getState();

  return state.status === 'ready' && !state.progress && calls.perHandle.size >= total && !state.refreshing;
}

test('poller: online friends are re-checked during one long full scan', async () => {
  const friends = friendsOf(120);
  const online = new Set(['f90', 'f91', 'f92']);
  const { api, calls } = makeApi({ friends, online });
  const poller = new TrackedPoller(api, visible, {
    ...BASE,
    maxConcurrency: 3,
    requestsPerSecond: 100,
    requestBurst: 5,
    recheckOnlineEveryMs: 100,
  });

  poller.start();
  await waitFor(() => lastFullDone(poller, calls, friends.length) && calls.perHandle.get('f119') !== undefined);
  poller.stop();

  for (const handle of online) {
    assert.ok((calls.perHandle.get(handle) ?? 0) > 1, `${handle} checked ${calls.perHandle.get(handle)} times`);
  }

  assert.equal(calls.friends, 1, 'one friends-page fetch for the whole scan');
});

test('poller: friends known to be online are checked first in the next scan', async () => {
  const friends = friendsOf(60);
  const old = Date.now() - 2 * 3_600_000;
  const t = new OnlineTracker();

  t.syncFriends(friends);

  for (const h of friends) t.record(h, ['f40', 'f41', 'f42'].includes(h) ? 'online' : 'offline', old);

  const seed: PersistedSnapshot = {
    v: 1,
    savedAt: old,
    tracker: t.exportState(),
    updatedAt: old,
    incomplete: false,
    lastCycleEndedAt: old,
    lastFullEndedAt: old,
    lastFullDurationMs: 1000,
    fullScanStartedAt: 0,
    fullScanOpen: false,
  };
  const persistence: Persistence = {
    load: () => seed,
    save: () => {},
    onExternalChange: () => () => {},
  };
  const { api, calls } = makeApi({ friends, online: new Set(['f40', 'f41', 'f42']) });
  const poller = new TrackedPoller(api, visible, { ...BASE, requestsPerSecond: 0 }, persistence);

  poller.start();
  await waitFor(() => calls.order.length >= 4);
  poller.stop();

  assert.deepEqual(new Set(calls.order.slice(0, 3)), new Set(['f40', 'f41', 'f42']));
});

test('poller: progress counts only the main list, never the re-checks', async () => {
  const friends = friendsOf(100);
  const { api, calls } = makeApi({ friends, online: new Set(['f5', 'f6']) });
  const poller = new TrackedPoller(api, visible, {
    ...BASE,
    maxConcurrency: 3,
    requestsPerSecond: 100,
    requestBurst: 5,
    recheckOnlineEveryMs: 80,
  });
  const seen: Array<{ checked: number; total: number }> = [];

  poller.subscribe(() => {
    const state: PollerState = poller.getState();

    if ((state.status === 'ready' || state.status === 'loading') && state.progress) {
      seen.push(state.progress);
    }
  });
  poller.start();
  await waitFor(() => (calls.perHandle.get('f99') ?? 0) > 0 && poller.getState().status === 'ready');
  await sleep(50);
  poller.stop();

  assert.ok(seen.length > 0, 'progress was reported');
  assert.ok(seen.every(p => p.total === friends.length), 'total stays the list length');
  assert.ok(seen.every(p => p.checked <= p.total), 'checked never exceeds total');
});

test('poller: a failed re-check does not make an online friend vanish', async () => {
  const friends = friendsOf(80);
  const online = new Set(['f10', 'f11']);
  const { api, calls } = makeApi({
    friends,
    online,
    statusFor: (handle, nth) => (online.has(handle) ? (nth === 1 ? 'online' : 'unknown') : 'offline'),
  });
  const poller = new TrackedPoller(api, visible, {
    ...BASE,
    maxConcurrency: 3,
    requestsPerSecond: 100,
    requestBurst: 5,
    recheckOnlineEveryMs: 60,
  });

  poller.start();
  await waitFor(() => (calls.perHandle.get('f79') ?? 0) > 0);
  await sleep(100);

  const state = poller.getState();

  poller.stop();
  assert.ok((calls.perHandle.get('f10') ?? 0) > 1, 'it was re-checked');
  assert.equal(state.status, 'ready');

  if (state.status === 'ready') {
    assert.deepEqual(state.friends.map(f => f.handle).sort(), ['f10', 'f11']);
  }
});

test('poller: stopping in the middle of a slice ends all requests', async () => {
  const friends = friendsOf(200);
  const { api, calls } = makeApi({ friends, online: new Set(['f1']) });
  const poller = new TrackedPoller(api, visible, {
    ...BASE,
    maxConcurrency: 3,
    requestsPerSecond: 200,
    requestBurst: 5,
    recheckOnlineEveryMs: 50,
  });

  poller.start();
  await waitFor(() => calls.order.length >= 25);
  poller.stop();

  const atStop = calls.order.length;

  await sleep(200);
  assert.ok(calls.order.length - atStop <= 3, `requests after stop: ${calls.order.length - atStop}`);
});

test('poller: with the cap off a short list is scanned at once', async () => {
  const friends = friendsOf(30);
  const { api, calls } = makeApi({ friends, online: new Set(['f1']) });
  const poller = new TrackedPoller(api, visible, { ...BASE, requestsPerSecond: 0 });
  const t0 = Date.now();

  poller.start();
  await waitFor(() => calls.perHandle.size === 30);
  poller.stop();
  assert.ok(Date.now() - t0 < 500);
});

/* --------------------------- manual refresh rules --------------------------- */

async function scanned(friends: string[], online: Set<string>, extra: Record<string, number> = {}) {
  const made = makeApi({ friends, online, latencyMs: 2 });
  const poller = new TrackedPoller(made.api, visible, {
    ...BASE,
    maxConcurrency: 3,
    requestsPerSecond: 3000,
    requestBurst: 100,
    ...extra,
  });

  poller.start();
  await waitFor(() => made.calls.perHandle.size === friends.length && poller.getState().status === 'ready' && !('progress' in poller.getState() && (poller.getState() as { progress: unknown }).progress));
  await sleep(30);

  return { ...made, poller };
}

test('manual refresh: a small list gets a full scan', async () => {
  const { poller, calls } = await scanned(friendsOf(20), new Set(['f1']));
  const before = calls.friends;

  poller.refresh();
  await waitFor(() => calls.friends === before + 1);
  poller.stop();
});

test('manual refresh: a big list only re-checks the friends shown online', async () => {
  const { poller, calls } = await scanned(friendsOf(400), new Set(['f1', 'f2']));
  const friendsBefore = calls.friends;
  const checksBefore = calls.order.length;

  poller.refresh();
  await waitFor(() => calls.order.length >= checksBefore + 2);
  await sleep(60);
  poller.stop();

  assert.equal(calls.friends, friendsBefore, 'no friends-page fetch');
  assert.equal(calls.order.length - checksBefore, 2, 'exactly the two online friends');
});

test('manual refresh: a big list with nobody online makes no requests', async () => {
  const { poller, calls } = await scanned(friendsOf(400), new Set());
  const friendsBefore = calls.friends;
  const checksBefore = calls.order.length;

  poller.refresh();
  await sleep(120);
  poller.stop();

  assert.equal(calls.friends, friendsBefore);
  assert.equal(calls.order.length, checksBefore);
});

test('manual refresh: the spinner shows during a manual re-check of a big list', async () => {
  let slow = false;
  const friends = friendsOf(300);
  const online = new Set(['f1']);
  const made = makeApi({ friends, online, latencyMs: 2 });
  const original = made.api.checkProfile;

  made.api.checkProfile = async (handle, signal) => {
    if (slow) await sleep(80);

    return original(handle, signal);
  };

  const poller = new TrackedPoller(made.api, visible, {
    ...BASE,
    maxConcurrency: 3,
    requestsPerSecond: 3000,
    requestBurst: 100,
  });

  poller.start();
  await waitFor(() => made.calls.perHandle.size === friends.length);
  await sleep(60);

  slow = true;
  poller.refresh();
  await sleep(20);

  const state = poller.getState();

  assert.equal(state.status === 'ready' || state.status === 'loading' ? state.refreshing : false, true);
  await sleep(150);
  poller.stop();
});
