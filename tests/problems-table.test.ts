import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSolvedCounts } from '../src/domain/solvedCounts.ts';
import { getProblemSubmissions } from '../src/domain/friction.ts';
import {
  SOLVED_COUNTS_KEY,
  SOLVED_COUNTS_RETRY_MS,
  SOLVED_COUNTS_TTL_MS,
  createSolvedCountsLoader,
} from '../src/services/solvedCountsStore.ts';

class FakeStorage implements Storage {
  data = new Map<string, string>();
  get length(): number { return this.data.size; }
  getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key)! : null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
  key(index: number): string | null { return Array.from(this.data.keys())[index] ?? null; }
}

/* ---------- parsing the problemset reply ---------- */

test('parseSolvedCounts: keys each count by "<contestId>-<index>"', () => {
  const counts = parseSolvedCounts({
    problems: [],
    problemStatistics: [
      { contestId: 2269, index: 'B', solvedCount: 11998 },
      { contestId: 2268, index: 'F', solvedCount: 233 },
    ],
  });

  assert.deepEqual(counts, { '2269-B': 11998, '2268-F': 233 });
});

test('parseSolvedCounts: skips entries that are not valid statistics and never throws', () => {
  const counts = parseSolvedCounts({
    problemStatistics: [
      null,
      'x',
      { contestId: '1', index: 'A', solvedCount: 5 },
      { contestId: 1, index: '', solvedCount: 5 },
      { contestId: 1, index: 'A' },
      { contestId: 1, index: 'B', solvedCount: -1 },
      { contestId: 1, index: 'C', solvedCount: Number.NaN },
      { contestId: 1, index: 'D', solvedCount: 0 },
    ],
  });

  assert.deepEqual(counts, { '1-D': 0 });
  assert.deepEqual(parseSolvedCounts(undefined), {});
  assert.deepEqual(parseSolvedCounts(null), {});
  assert.deepEqual(parseSolvedCounts({ problemStatistics: 'nope' }), {});
});

/* ---------- every submission of a problem ---------- */

test('getProblemSubmissions: lists accepted and every kind of error with its verdict', () => {
  const all = getProblemSubmissions({
    acIds: [5],
    waIds: [1, 2],
    tleIds: [3],
    rteIds: [],
    mleIds: [4],
    otherIds: [6],
  });

  assert.deepEqual(
    all.map(item => [item.id, item.verdict]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [[1, 'wa'], [2, 'wa'], [3, 'tle'], [4, 'mle'], [5, 'ac'], [6, 'other']],
  );
});

test('getProblemSubmissions: an id is listed once and an empty problem gives an empty list', () => {
  const twice = getProblemSubmissions({ acIds: [1], waIds: [1], tleIds: [], rteIds: [], mleIds: [], otherIds: [] });
  assert.equal(twice.length, 1);

  assert.deepEqual(
    getProblemSubmissions({ acIds: [], waIds: [], tleIds: [], rteIds: [], mleIds: [], otherIds: [] }),
    [],
  );
});

/* ---------- loading and caching ---------- */

function makeLoader(options: { storage?: Storage | null; fetcher: () => Promise<Record<string, number>>; clock: { t: number } }) {
  return createSolvedCountsLoader({
    getStorage: () => (options.storage === undefined ? new FakeStorage() : options.storage),
    fetcher: options.fetcher,
    now: () => options.clock.t,
  });
}

test('loader: a fresh cached copy is used without any request', async () => {
  const storage = new FakeStorage();
  storage.setItem(SOLVED_COUNTS_KEY, JSON.stringify({ t: 1000, c: { '1-A': 7 } }));

  let calls = 0;
  const load = makeLoader({ storage, clock: { t: 1000 + SOLVED_COUNTS_TTL_MS - 1 }, fetcher: async () => { calls += 1; return { '1-A': 9 }; } });

  assert.deepEqual(await load(), { '1-A': 7 });
  assert.equal(calls, 0);
});

test('loader: a stale copy is refreshed and the new figures are cached', async () => {
  const storage = new FakeStorage();
  storage.setItem(SOLVED_COUNTS_KEY, JSON.stringify({ t: 1000, c: { '1-A': 7 } }));

  const clock = { t: 1000 + SOLVED_COUNTS_TTL_MS };
  const load = makeLoader({ storage, clock, fetcher: async () => ({ '1-A': 9 }) });

  assert.deepEqual(await load(), { '1-A': 9 });
  assert.deepEqual(JSON.parse(storage.getItem(SOLVED_COUNTS_KEY)!), { t: clock.t, c: { '1-A': 9 } });
});

test('loader: callers at the same time share one request', async () => {
  let calls = 0;
  const load = makeLoader({ clock: { t: 5 }, fetcher: async () => { calls += 1; return { '1-A': 1 }; } });

  const [a, b] = await Promise.all([load(), load()]);

  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test('loader: a failed request falls back to the old copy, and is not retried within the cooldown', async () => {
  const storage = new FakeStorage();
  storage.setItem(SOLVED_COUNTS_KEY, JSON.stringify({ t: 0, c: { '1-A': 7 } }));

  let calls = 0;
  const clock = { t: SOLVED_COUNTS_TTL_MS + 10 };
  const load = makeLoader({ storage, clock, fetcher: async () => { calls += 1; throw new Error('Call limit exceeded'); } });

  assert.deepEqual(await load(), { '1-A': 7 });
  assert.equal(calls, 1);

  clock.t += SOLVED_COUNTS_RETRY_MS - 1;
  assert.deepEqual(await load(), { '1-A': 7 });
  assert.equal(calls, 1, 'still inside the cooldown');

  clock.t += 2;
  await load();
  assert.equal(calls, 2, 'asks again once the cooldown is over');
});

test('loader: with no cache and a failed request the result is an empty map, not an error', async () => {
  const load = makeLoader({ clock: { t: 1 }, fetcher: async () => { throw new Error('offline'); } });
  assert.deepEqual(await load(), {});
});

test('loader: an empty reply is not cached as if it were data', async () => {
  const storage = new FakeStorage();
  const load = makeLoader({ storage, clock: { t: 1 }, fetcher: async () => ({}) });

  assert.deepEqual(await load(), {});
  assert.equal(storage.getItem(SOLVED_COUNTS_KEY), null);
});

test('loader: unavailable or full storage still returns the figures', async () => {
  const full = new FakeStorage();
  full.setItem = () => { throw new Error('QuotaExceededError'); };

  assert.deepEqual(await makeLoader({ storage: full, clock: { t: 1 }, fetcher: async () => ({ '1-A': 3 }) })(), { '1-A': 3 });
  assert.deepEqual(await makeLoader({ storage: null, clock: { t: 1 }, fetcher: async () => ({ '1-A': 3 }) })(), { '1-A': 3 });
});

test('loader: a damaged cache entry is ignored', async () => {
  const storage = new FakeStorage();
  storage.setItem(SOLVED_COUNTS_KEY, '{not json');

  assert.deepEqual(await makeLoader({ storage, clock: { t: 1 }, fetcher: async () => ({ '2-B': 4 }) })(), { '2-B': 4 });
});
