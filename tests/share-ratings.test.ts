import test from 'node:test';
import assert from 'node:assert/strict';

import {
  USER_INFO_TTL_MS,
  cachingUserInfoFetcher,
  loadCachedUserInfo,
} from '../src/services/userInfoCache';

class FakeStorage implements Storage {
  data = new Map<string, string>();
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

const store = new FakeStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = store;

interface User {
  handle: string;
  rating?: number;
  rank?: string;
  lastOnlineTimeSeconds?: number;
}

test('ratings fetched by the wrapped fetcher are found by the cache reader', async () => {
  store.clear();

  const users: User[] = [
    { handle: 'Alice', rating: 1500, rank: 'specialist', lastOnlineTimeSeconds: 5 },
    { handle: 'Bob' },
  ];

  const calls: unknown[][] = [];

  const fetcher = cachingUserInfoFetcher(async (handles: string[], signal?: AbortSignal) => {
    calls.push([handles, signal]);

    return users;
  });

  const controller = new AbortController();
  const result = await fetcher(['Alice', 'Bob'], controller.signal);

  assert.deepEqual(calls, [[['Alice', 'Bob'], controller.signal]], 'arguments pass through');
  assert.equal(result, users, 'the very same result comes back, with every field');
  assert.deepEqual(loadCachedUserInfo('alice'), { handle: 'Alice', rank: 'specialist', rating: 1500 });
  assert.deepEqual(loadCachedUserInfo('BOB'), { handle: 'Bob' });
});

test('an error from the fetcher passes through and saves nothing', async () => {
  store.clear();

  const fetcher = cachingUserInfoFetcher(async (_handles: string[]): Promise<User[]> => {
    throw new Error('boom');
  });

  await assert.rejects(fetcher(['a']), /boom/);
  assert.equal(store.length, 0);
});

test('an empty answer saves nothing and leaves old entries alone', async () => {
  store.clear();

  await cachingUserInfoFetcher(async (_h: string[]) => [{ handle: 'old', rating: 1 }] as User[])(['old']);
  const before = store.getItem('cfpm_uinfo:old');

  const result = await cachingUserInfoFetcher(async (_h: string[]) => [] as User[])(['x']);

  assert.deepEqual(result, []);
  assert.equal(store.getItem('cfpm_uinfo:old'), before);
  assert.equal(store.length, 1);
});

test('a full or broken storage does not turn a good answer into an error', async () => {
  store.clear();
  store.limit = 1;

  const users: User[] = [{ handle: 'Alice', rating: 1200 }];
  const result = await cachingUserInfoFetcher(async (_h: string[]) => users)(['Alice']);

  assert.equal(result, users);
  assert.equal(store.length, 0);
  store.limit = Number.POSITIVE_INFINITY;

  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length(): number {
      throw new Error('denied');
    },
  } as unknown as Storage;

  assert.equal(await cachingUserInfoFetcher(async (_h: string[]) => users)(['Alice']), users);

  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
});

test('saved ratings expire after the usual 6 hours', async () => {
  store.clear();
  await cachingUserInfoFetcher(async (_h: string[]) => [{ handle: 'Alice', rating: 1500 }] as User[])(['Alice']);

  const savedAt = JSON.parse(store.getItem('cfpm_uinfo:alice')!).t as number;

  assert.ok(loadCachedUserInfo('alice', store, savedAt + USER_INFO_TTL_MS));
  assert.equal(loadCachedUserInfo('alice', store, savedAt + USER_INFO_TTL_MS + 1), null);
});
