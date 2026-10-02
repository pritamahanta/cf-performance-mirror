import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyProfileHtml,
  OnlineTracker,
  ONLINE_TTL_MS,
} from '../src/domain/onlineTracker.ts';
import { checkHandles } from '../src/services/onlinePool.ts';
import type { OnlineStatus } from '../src/domain/onlineTracker.ts';

test('classifyProfileHtml: online, offline, unknown', () => {
  assert.equal(
    classifyProfileHtml('<li>Last visit: <span class="x">online now</span></li>'),
    'online',
  );
  assert.equal(
    classifyProfileHtml('<li>Last visit: <span>3 hours ago</span></li>'),
    'offline',
  );
  assert.equal(classifyProfileHtml('<html>503 Service Unavailable</html>'), 'unknown');
  assert.equal(classifyProfileHtml(''), 'unknown');
});

test('tracker: unknown never overwrites a known status', () => {
  const t = new OnlineTracker();
  t.syncFriends(['a', 'b']);
  t.record('a', 'online', 1000);
  t.record('a', 'unknown', 2000);
  t.applyInfo(['a'], [{ handle: 'a', rating: 1500, rank: 'specialist' }]);
  assert.deepEqual(t.snapshot(2000).map(f => f.handle), ['a']);
});

test('tracker: online entries expire when not re-confirmed', () => {
  const t = new OnlineTracker();
  t.syncFriends(['a']);
  t.record('a', 'online', 0);
  t.applyInfo(['a'], [{ handle: 'a' }]);
  assert.equal(t.snapshot(ONLINE_TTL_MS).length, 1);
  assert.equal(t.snapshot(ONLINE_TTL_MS + 1).length, 0);
});

test('tracker: rows wait for one rating attempt, then show even if it failed', () => {
  const t = new OnlineTracker();
  t.beginCycle();
  t.syncFriends(['a']);
  t.record('a', 'online', 1);
  assert.equal(t.snapshot(1).length, 0);
  assert.deepEqual(t.handlesNeedingInfo(), ['a']);
  t.applyInfo(['a'], null);
  assert.equal(t.snapshot(1).length, 1);
  assert.equal(t.snapshot(1)[0].rating, undefined);
});

test('tracker: rows never move, new ones append, removed friends vanish', () => {
  const t = new OnlineTracker();
  t.syncFriends(['a', 'b', 'c']);
  for (const h of ['c', 'a']) {
    t.record(h, 'online', 1);
    t.applyInfo([h], [{ handle: h }]);
  }
  assert.deepEqual(t.snapshot(1).map(f => f.handle), ['c', 'a']);
  t.record('b', 'online', 2);
  t.applyInfo(['b'], [{ handle: 'b' }]);
  assert.deepEqual(t.snapshot(2).map(f => f.handle), ['c', 'a', 'b']);
  t.record('c', 'offline', 3);
  assert.deepEqual(t.snapshot(3).map(f => f.handle), ['a', 'b']);
  t.syncFriends(['a']);
  assert.deepEqual(t.snapshot(3).map(f => f.handle), ['a']);
});

test('tracker: plan puts online first, then never-checked, then oldest-checked', () => {
  const t = new OnlineTracker();
  t.syncFriends(['w', 'x', 'y', 'z']);
  t.record('x', 'offline', 500);
  t.record('y', 'offline', 100);
  t.record('z', 'online', 900);
  assert.deepEqual(t.plan(), ['z', 'w', 'y', 'x']);
});

const never = new AbortController().signal;

test('pool: checks everything and reports each result once', async () => {
  const seen: Record<string, OnlineStatus> = {};
  const handles = Array.from({ length: 50 }, (_, i) => `h${i}`);
  const summary = await checkHandles(handles, {
    signal: never,
    check: async h => (Number(h.slice(1)) % 5 === 0 ? 'online' : 'offline'),
    onResult: (h, s) => {
      assert.equal(seen[h], undefined);
      seen[h] = s;
    },
  });
  assert.equal(summary.done, 50);
  assert.equal(summary.unknown, 0);
  assert.equal(Object.values(seen).filter(s => s === 'online').length, 10);
});

test('pool: never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  await checkHandles(Array.from({ length: 40 }, (_, i) => `h${i}`), {
    signal: never,
    maxConcurrency: 4,
    check: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active -= 1;
      return 'offline';
    },
    onResult: () => undefined,
  });
  assert.ok(peak <= 4, `peak was ${peak}`);
  assert.ok(peak >= 2);
});

test('pool: a transient failure is retried and the retry result is reported', async () => {
  const calls: Record<string, number> = {};
  const results: Record<string, OnlineStatus> = {};
  await checkHandles(['a', 'b'], {
    signal: never,
    baseBackoffMs: 1,
    check: async h => {
      calls[h] = (calls[h] ?? 0) + 1;
      return h === 'a' && calls[h] === 1 ? 'unknown' : 'online';
    },
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.equal(calls.a, 2);
  assert.equal(results.a, 'online');
});

test('pool: persistent failures come back as unknown, not offline', async () => {
  const results: Record<string, OnlineStatus> = {};
  const summary = await checkHandles(['a', 'b', 'c'], {
    signal: never,
    baseBackoffMs: 1,
    maxBackoffMs: 2,
    check: async () => 'unknown',
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.deepEqual(Object.values(results), ['unknown', 'unknown', 'unknown']);
  assert.equal(summary.unknown, 3);
});

test('pool: a check that throws is treated as unknown', async () => {
  const results: Record<string, OnlineStatus> = {};
  await checkHandles(['a'], {
    signal: never,
    baseBackoffMs: 1,
    check: async () => {
      throw new Error('boom');
    },
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.equal(results.a, 'unknown');
});

test('pool: circuit breaker stops early when the server keeps failing', async () => {
  let calls = 0;
  const handles = Array.from({ length: 500 }, (_, i) => `h${i}`);
  const summary = await checkHandles(handles, {
    signal: never,
    breakerLimit: 10,
    baseBackoffMs: 1,
    maxBackoffMs: 1,
    check: async () => {
      calls += 1;
      return 'unknown';
    },
    onResult: () => undefined,
  });
  assert.equal(summary.brokeCircuit, true);
  assert.ok(calls < 100, `made ${calls} calls`);
});

test('pool: abort resolves promptly and reports nothing afterwards', async () => {
  const controller = new AbortController();
  let reported = 0;
  const promise = checkHandles(Array.from({ length: 100 }, (_, i) => `h${i}`), {
    signal: controller.signal,
    check: () => new Promise<OnlineStatus>(resolve => setTimeout(() => resolve('offline'), 20)),
    onResult: () => {
      reported += 1;
    },
  });
  setTimeout(() => controller.abort(), 30);
  const summary = await promise;
  const atAbort = reported;
  await new Promise(r => setTimeout(r, 80));
  assert.equal(summary.aborted, true);
  assert.equal(reported, atAbort);
});

test('pool: a request that never settles does not block the rest of the batch', async () => {
  const results: Record<string, OnlineStatus> = {};
  const summary = await checkHandles(['a', 'b', 'c'], {
    signal: never,
    retries: 0,
    requestTimeoutMs: 30,
    check: async (h, signal) => {
      if (h === 'b') {
        // A connection that never responds and never rejects -
        // no 'unknown', no throw, nothing. Only a timeout can end it.
        return new Promise<OnlineStatus>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return 'offline';
    },
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.equal(summary.done, 3);
  assert.equal(results.a, 'offline');
  assert.equal(results.b, 'unknown');
  assert.equal(results.c, 'offline');
});

test('pool: still finishes even if check() ignores its signal entirely', async () => {
  const results: Record<string, OnlineStatus> = {};
  await checkHandles(['a', 'b'], {
    signal: never,
    retries: 0,
    requestTimeoutMs: 30,
    check: async h => (h === 'a' ? new Promise<OnlineStatus>(() => {}) : 'offline'),
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.equal(results.a, 'unknown');
  assert.equal(results.b, 'offline');
});

test('pool: a slow but eventually-successful check is not mistaken for a timeout', async () => {
  const results: Record<string, OnlineStatus> = {};
  await checkHandles(['a'], {
    signal: never,
    requestTimeoutMs: 200,
    check: () => new Promise<OnlineStatus>(resolve => setTimeout(() => resolve('online'), 20)),
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.equal(results.a, 'online');
});

test('pool: requestTimeoutMs: 0 disables the per-attempt timeout', async () => {
  const results: Record<string, OnlineStatus> = {};
  await checkHandles(['a'], {
    signal: never,
    requestTimeoutMs: 0,
    check: () => new Promise<OnlineStatus>(resolve => setTimeout(() => resolve('online'), 30)),
    onResult: (h, s) => {
      results[h] = s;
    },
  });
  assert.equal(results.a, 'online');
});

test('pool: empty input finishes immediately', async () => {
  const summary = await checkHandles([], {
    signal: never,
    check: async () => 'offline',
    onResult: () => undefined,
  });
  assert.equal(summary.total, 0);
});
