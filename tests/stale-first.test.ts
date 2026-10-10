import test from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { window: EventTarget }).window = new EventTarget();

class FakeStorage implements Storage {
  data = new Map<string, string>();
  /* Number of stored bytes allowed before setItem throws, like a full localStorage. */
  limit = Number.POSITIVE_INFINITY;
  get length(): number {
    return this.data.size;
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    const others = Array.from(this.data.entries())
      .filter(([existing]) => existing !== key)
      .reduce((sum, [, v]) => sum + v.length, 0);

    if (others + value.length > this.limit) {
      throw new Error('QuotaExceededError');
    }

    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

const globalStore = new FakeStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = globalStore;

const {
  FRIEND_SUBMISSIONS_MAX_STALE_MS,
  FRIEND_SUBMISSIONS_TTL_MS,
  loadCachedSubmissions,
  loadStoredSubmissions,
  saveCachedSubmissions,
} = await import('../src/services/friendSubmissionsStore.ts');

const {
  applyFailure,
  applyFresh,
  applyRequested,
  applyStored,
  countUpdating,
} = await import('../src/domain/friendEntries.ts');

const { loadFriendContestSubmissions, peekStoredFriendSubmissions } = await import(
  '../src/services/friendSubmissions.ts'
);

const { updatingLabel } = await import('../src/domain/panelNotices.ts');

import type { FriendSubmission } from '../src/domain/friendSubmissions.ts';

const sub = (id: number): FriendSubmission => ({ id, index: 'A', createdAt: 1_000 + id });

const T0 = 1_000_000_000;

/* ---------- the store keeps old entries ---------- */

test('store: an entry past the TTL is no longer up to date but is still returned as a stale copy', () => {
  const store = new FakeStorage();
  saveCachedSubmissions(1, 'Ann', [sub(1)], store, T0);

  const later = T0 + FRIEND_SUBMISSIONS_TTL_MS + 1;

  assert.equal(loadCachedSubmissions(1, 'ann', store, later), null, 'not up to date');
  assert.deepEqual(loadStoredSubmissions(1, 'ann', store, later), { submissions: [sub(1)], fresh: false });
});

test('store: reading an old entry does not delete it', () => {
  const store = new FakeStorage();
  saveCachedSubmissions(1, 'ann', [sub(1)], store, T0);

  const later = T0 + FRIEND_SUBMISSIONS_TTL_MS + 5;
  loadCachedSubmissions(1, 'ann', store, later);
  loadCachedSubmissions(1, 'ann', store, later);

  assert.equal(store.length, 1);
  assert.equal(loadStoredSubmissions(1, 'ann', store, later)?.fresh, false);
});

test('store: a fresh entry is reported as fresh by both readers', () => {
  const store = new FakeStorage();
  saveCachedSubmissions(1, 'ann', [sub(1)], store, T0);

  assert.deepEqual(loadCachedSubmissions(1, 'ann', store, T0 + 10), [sub(1)]);
  assert.deepEqual(loadStoredSubmissions(1, 'ann', store, T0 + 10), { submissions: [sub(1)], fresh: true });
});

test('store: an entry older than the longest it may be shown is dropped', () => {
  const store = new FakeStorage();
  saveCachedSubmissions(1, 'ann', [sub(1)], store, T0);

  assert.ok(loadStoredSubmissions(1, 'ann', store, T0 + FRIEND_SUBMISSIONS_MAX_STALE_MS), 'exactly at the limit still counts');
  assert.equal(loadStoredSubmissions(1, 'ann', store, T0 + FRIEND_SUBMISSIONS_MAX_STALE_MS + 1), null);
  assert.equal(store.length, 0, 'and it is removed');
});

test('store: corrupted and future-dated entries are dropped, not shown', () => {
  const store = new FakeStorage();
  store.setItem('cfpm_fsub:1:ann', '{nope');
  assert.equal(loadStoredSubmissions(1, 'ann', store, T0), null);
  assert.equal(store.length, 0);

  saveCachedSubmissions(1, 'bob', [sub(1)], store, T0 + 10_000);
  assert.equal(loadStoredSubmissions(1, 'bob', store, T0), null);
  assert.equal(store.length, 0);
});

test('store: saving removes only entries past the longest age, keeping old but usable ones', () => {
  const store = new FakeStorage();
  const old = T0;
  /* Oldest first: saving at an earlier time would treat the later entry as future-dated. */
  saveCachedSubmissions(1, 'ancient', [sub(2)], store, old - FRIEND_SUBMISSIONS_MAX_STALE_MS - 1);
  saveCachedSubmissions(1, 'stale', [sub(1)], store, old);

  const now = old + FRIEND_SUBMISSIONS_TTL_MS * 3;
  saveCachedSubmissions(1, 'new', [sub(3)], store, now);

  assert.ok(store.getItem('cfpm_fsub:1:stale'), 'a stale entry survives a save');
  assert.ok(store.getItem('cfpm_fsub:1:new'));
  assert.equal(store.getItem('cfpm_fsub:1:ancient'), null, 'one past a day is pruned');
});

test('store: when storage is full, copies that are not up to date are given up and the save is retried', () => {
  const store = new FakeStorage();
  saveCachedSubmissions(1, 'stale1', [sub(1)], store, T0);
  saveCachedSubmissions(1, 'stale2', [sub(2)], store, T0);
  const used = Array.from(store.data.values()).reduce((sum, v) => sum + v.length, 0);

  /* Room for the two old copies only, not for a third entry besides them. */
  store.limit = used + 5;

  const now = T0 + FRIEND_SUBMISSIONS_TTL_MS * 2;
  saveCachedSubmissions(1, 'fresh', [sub(3)], store, now);

  assert.deepEqual(loadCachedSubmissions(1, 'fresh', store, now), [sub(3)], 'the new entry was stored');
  assert.equal(store.getItem('cfpm_fsub:1:stale1'), null);
  assert.equal(store.getItem('cfpm_fsub:1:stale2'), null);
});

test('store: a save that cannot succeed even after that is silent', () => {
  const store = new FakeStorage();
  store.limit = 1;

  assert.doesNotThrow(() => saveCachedSubmissions(1, 'ann', [sub(1)], store, T0));
  assert.equal(store.length, 0);
});

/* ---------- requests: the same calls as before ---------- */

function stubFetch() {
  const calls: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));

    return {
      status: 200,
      json: async () => ({ status: 'OK', result: [] }),
    } as unknown as Response;
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('requests: a stale friend is shown from the stored copy, then costs exactly one request; a fresh one costs none', async () => {
  const stub = stubFetch();
  globalStore.clear();

  try {
    const contestId = 920001;
    saveCachedSubmissions(contestId, 'oldie', [sub(7)], globalStore, Date.now() - FRIEND_SUBMISSIONS_TTL_MS * 4);
    saveCachedSubmissions(contestId, 'newbie', [sub(8)], globalStore, Date.now());

    assert.deepEqual(peekStoredFriendSubmissions(contestId, 'oldie'), { submissions: [sub(7)], fresh: false }, 'shown at once');
    assert.equal(stub.calls.length, 0, 'showing it sends nothing');

    assert.deepEqual(await loadFriendContestSubmissions(contestId, 'newbie'), [sub(8)]);
    assert.equal(stub.calls.length, 0, 'a fresh copy needs no request');

    assert.deepEqual(await loadFriendContestSubmissions(contestId, 'oldie'), [], 'the fresh answer replaces it');
    assert.equal(stub.calls.length, 1, 'one request for the stale friend');
    assert.ok(stub.calls[0].includes('handle=oldie'));

    assert.deepEqual(peekStoredFriendSubmissions(contestId, 'oldie'), { submissions: [], fresh: true }, 'and is stored up to date');
    await loadFriendContestSubmissions(contestId, 'oldie');
    assert.equal(stub.calls.length, 1, 'no repeat');
  } finally {
    stub.restore();
  }
});

/* ---------- what the box knows about each friend ---------- */

test('entries: a stored copy shows at once; an old one is marked updating, a fresh one is not', () => {
  const stale = applyStored({}, 'ann', { submissions: [sub(1)], fresh: false });
  assert.deepEqual(stale.ann, { status: 'ready', submissions: [sub(1)], stale: 'updating' });

  const fresh = applyStored({}, 'ann', { submissions: [sub(1)], fresh: true });
  assert.deepEqual(fresh.ann, { status: 'ready', submissions: [sub(1)] });
});

test('entries: a stored copy never replaces something already known', () => {
  const known = applyFresh({}, 'ann', [sub(9)]);
  assert.equal(applyStored(known, 'ann', { submissions: [sub(1)], fresh: false }), known);

  const updating = applyStored({}, 'ann', { submissions: [sub(1)], fresh: false });
  assert.equal(applyStored(updating, 'ann', { submissions: [sub(2)], fresh: false }), updating);
});

test('entries: asking again keeps what is on screen; only an empty or failed friend goes to loading', () => {
  const updating = applyStored({}, 'ann', { submissions: [sub(1)], fresh: false });
  assert.equal(applyRequested(updating, 'ann'), updating, 'stale copy stays, still updating');

  assert.deepEqual(applyRequested({}, 'bob').bob, { status: 'loading' });
  assert.deepEqual(applyRequested({ bob: { status: 'error' } }, 'bob').bob, { status: 'loading' });

  const loading = applyRequested({}, 'bob');
  assert.equal(applyRequested(loading, 'bob'), loading);

  const fresh = applyFresh({}, 'ann', [sub(1)]);
  assert.equal(applyRequested(fresh, 'ann'), fresh);
});

test('entries: the fresh answer replaces the stale copy and clears the marker', () => {
  const updating = applyStored({}, 'ann', { submissions: [sub(1)], fresh: false });
  const done = applyFresh(updating, 'ann', [sub(1), sub(2)]);

  assert.deepEqual(done.ann, { status: 'ready', submissions: [sub(1), sub(2)] });
});

test('entries: if the refresh fails the old copy stays on screen, marked; with no copy it is an error', () => {
  const updating = applyStored({}, 'ann', { submissions: [sub(1)], fresh: false });
  const failed = applyFailure(updating, 'ann');

  assert.deepEqual(failed.ann, { status: 'ready', submissions: [sub(1)], stale: 'failed' });
  assert.deepEqual(applyFailure({}, 'bob').bob, { status: 'error' });
  assert.deepEqual(applyFailure({ bob: { status: 'loading' } }, 'bob').bob, { status: 'error' });

  const fresh = applyFresh({}, 'cy', [sub(3)]);
  assert.equal(applyFailure(fresh, 'cy'), fresh, 'up-to-date data is not marked by a later failure');
});

test('entries: a failed refresh is tried again and shows as updating again', () => {
  const failed = applyFailure(applyStored({}, 'ann', { submissions: [sub(1)], fresh: false }), 'ann');
  const again = applyRequested(failed, 'ann');

  assert.deepEqual(again.ann, { status: 'ready', submissions: [sub(1)], stale: 'updating' });
});

test('entries: only friends still on an old copy count as updating', () => {
  let entries = applyStored({}, 'ann', { submissions: [], fresh: false });
  entries = applyStored(entries, 'bob', { submissions: [], fresh: false });
  entries = applyFresh(entries, 'cy', []);
  entries = applyFailure(entries, 'bob');
  entries = applyRequested(entries, 'dee');

  assert.equal(countUpdating(entries, ['Ann', 'bob', 'cy', 'dee', 'eve']), 1, 'ann only: bob failed, cy is fresh, dee is loading, eve unknown');
  assert.equal(countUpdating(entries, []), 0);
});

test('updating label: says how many are left', () => {
  assert.equal(updatingLabel(12), 'Updating… 12 left');
  assert.equal(updatingLabel(1), 'Updating… 1 left');
});
