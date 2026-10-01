import test from 'node:test';
import assert from 'node:assert/strict';

import { OnlineTracker } from '../src/domain/onlineTracker.ts';
import {
  createBrowserPersistence,
  parseSnapshot,
  STORAGE_PREFIX,
} from '../src/services/onlineStore.ts';

test('tracker: export/import round trip preserves handles, info, and order', () => {
  const t = new OnlineTracker();
  t.syncFriends(['Alice', 'bob']);
  t.record('Alice', 'online', 1000);
  t.record('bob', 'offline', 2000);
  t.applyInfo(['Alice', 'bob'], [
    { handle: 'Alice', rating: 1700, rank: 'candidate master' },
    { handle: 'bob', rating: 1200, rank: 'pupil' },
  ]);
  const state = t.exportState();

  const clone = new OnlineTracker();
  assert.equal(clone.importState(state), true);
  assert.deepEqual(clone.snapshot(2000).map(f => f.handle), ['Alice']);
  assert.deepEqual(clone.plan(), ['Alice', 'bob']);
  assert.equal(clone.exportState().friends[0], 'Alice');
});

test('tracker: invalid import is rejected without mutating the tracker', () => {
  const t = new OnlineTracker();
  t.syncFriends(['Alice']);
  t.record('Alice', 'online', 1000);
  const before = t.exportState();

  assert.equal(t.importState({
    friends: ['Alice'],
    entries: [['alice', 1, 5000], ['bad', 2, 3000]],
    infos: [{ handle: 'Alice' }],
    order: ['alice', 'bad'],
  }), false);
  assert.deepEqual(t.exportState(), before);
});

test('parseSnapshot: rejects bad data', () => {
  assert.equal(parseSnapshot('not json', Date.now()), null);
  assert.equal(parseSnapshot(JSON.stringify({ v: 2, savedAt: 1, tracker: { friends: [] } }), Date.now()), null);
  assert.equal(parseSnapshot(JSON.stringify({ v: 1, savedAt: NaN, tracker: { friends: [] } }), Date.now()), null);
  assert.equal(parseSnapshot(JSON.stringify({ v: 1, savedAt: Date.now() + 120_000, tracker: { friends: [] } }), Date.now()), null);
});

test('browser persistence: key per handle, other accounts removed, logout clears cache, quota failures do not throw', () => {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: key => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => { store.clear(); },
    key: index => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };

  const doc = {
    querySelector: (selector: string) => {
      if (selector === '.lang-chooser a[href^="/profile/"]') {
        return { getAttribute: () => '/profile/Alpha' } as unknown as Element;
      }
      return null;
    },
  } as unknown as Document;

  const persistence = createBrowserPersistence({ storage, doc });
  assert.ok(persistence);
  persistence!.save({
    v: 1,
    savedAt: 123,
    tracker: { friends: ['Alpha'], entries: [['alpha', 1, 123]], infos: [{ handle: 'Alpha', rating: 1500 }], order: ['alpha'] },
    updatedAt: 123,
    incomplete: false,
    lastCycleEndedAt: 123,
    lastFullEndedAt: 123,
    lastFullDurationMs: 100,
    fullScanStartedAt: 0,
    fullScanOpen: false,
  });
  assert.ok(store.has(STORAGE_PREFIX + 'alpha'));
  assert.equal(store.has(STORAGE_PREFIX + 'beta'), false);

  const other = createBrowserPersistence({
    storage,
    doc: {
      querySelector: () => ({ getAttribute: () => '/profile/Beta' }) as unknown as Element,
    } as unknown as Document,
  });
  assert.ok(other);
  other!.save({
    v: 1,
    savedAt: 456,
    tracker: { friends: ['Beta'], entries: [['beta', 1, 456]], infos: [{ handle: 'Beta', rating: 1300 }], order: ['beta'] },
    updatedAt: 456,
    incomplete: false,
    lastCycleEndedAt: 456,
    lastFullEndedAt: 456,
    lastFullDurationMs: 50,
    fullScanStartedAt: 0,
    fullScanOpen: false,
  });
  assert.equal(store.has(STORAGE_PREFIX + 'alpha'), false);
  assert.equal(store.has(STORAGE_PREFIX + 'beta'), true);

  const loggedOut = createBrowserPersistence({
    storage,
    doc: {
      querySelector: () => null,
    } as unknown as Document,
  });
  assert.equal(loggedOut, null);
  assert.equal(store.has(STORAGE_PREFIX + 'beta'), false);

  const quota = createBrowserPersistence({
    storage: {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    },
    doc,
  });
  assert.ok(quota);
  assert.doesNotThrow(() => quota!.save({
    v: 1,
    savedAt: 100,
    tracker: { friends: ['Alpha'], entries: [['alpha', 1, 100]], infos: [{ handle: 'Alpha', rating: 1500 }], order: ['alpha'] },
    updatedAt: 100,
    incomplete: false,
    lastCycleEndedAt: 100,
    lastFullEndedAt: 100,
    lastFullDurationMs: 10,
    fullScanStartedAt: 0,
    fullScanOpen: false,
  }));
});
