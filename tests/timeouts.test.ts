import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchOnlineFriends, fetchUsersInfo } from '../src/services/codeforcesApi.ts';

const realFetch = globalThis.fetch;
const realDomParser = (globalThis as { DOMParser?: unknown }).DOMParser;
const realChrome = (globalThis as { chrome?: unknown }).chrome;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { DOMParser?: unknown }).DOMParser = realDomParser;
  (globalThis as { chrome?: unknown }).chrome = realChrome;
});

/* A fetch that, like the real one, fails with AbortError when its signal aborts. */
function abortableNever(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
}

/* The minimum of the DOM that fetchOnlineFriends touches. */
function installFakeDom(handles: string[]) {
  const links = handles.map(handle => ({ getAttribute: () => `/profile/${handle}` }));
  const table = { querySelectorAll: () => links };
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString() {
      return { querySelectorAll: (selector: string) => (selector === 'table.tablesorter' ? [table] : []) };
    }
  };
}

test('friends page: a request that never answers is cut off by the timeout', async () => {
  let seenSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seenSignal = init?.signal ?? undefined;
    return abortableNever(init?.signal ?? undefined);
  }) as typeof fetch;

  const startedAt = Date.now();
  await assert.rejects(fetchOnlineFriends(undefined, 40));
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(seenSignal?.aborted, true, 'the connection is released too');
});

test('friends page: a body that stalls after the headers is cut off too', async () => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  const startedAt = Date.now();
  await assert.rejects(fetchOnlineFriends(undefined, 40));
  assert.ok(Date.now() - startedAt < 500);
});

test('friends page: the caller aborting still cancels it right away', async () => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => abortableNever(init?.signal ?? undefined)) as typeof fetch;

  const controller = new AbortController();
  const pending = fetchOnlineFriends(controller.signal, 10_000);
  setTimeout(() => controller.abort(), 10);

  const startedAt = Date.now();
  await assert.rejects(pending);
  assert.ok(Date.now() - startedAt < 500);

  const already = new AbortController();
  already.abort();
  await assert.rejects(fetchOnlineFriends(already.signal, 10_000));
});

test('friends page: a normal answer is still read, and a bad status still fails', async () => {
  installFakeDom(['alice', 'bob', 'alice']);
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;
  assert.deepEqual(await fetchOnlineFriends(undefined, 10_000), ['alice', 'bob']);

  globalThis.fetch = (async () => new Response('x', { status: 503 })) as typeof fetch;
  await assert.rejects(fetchOnlineFriends(undefined, 10_000), /Could not load/);
});

test('user.info: a background worker that never answers is cut off', async () => {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: () => new Promise(() => {}) } };

  const startedAt = Date.now();
  await assert.rejects(fetchUsersInfo(['a', 'b'], undefined, 40), /timed out/);
  assert.ok(Date.now() - startedAt < 500);
});

test('user.info: aborting cancels a pending request', async () => {
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: () => new Promise(() => {}) } };

  const controller = new AbortController();
  const pending = fetchUsersInfo(['a'], controller.signal, 10_000);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending);
});

test('user.info: normal answers still work, several chunks included', async () => {
  const calls: string[][] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: async (message: { handles: string[] }) => {
        calls.push(message.handles);
        return { ok: true, data: message.handles.map(handle => ({ handle })) };
      },
    },
  };

  const handles = Array.from({ length: 120 }, (_, i) => `u${i}`);
  const users = await fetchUsersInfo(handles, undefined, 10_000);
  assert.equal(calls.length, 2);
  assert.equal(users.length, 120);

  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: async () => ({ ok: false, error: 'FAILED' }) } };
  await assert.rejects(fetchUsersInfo(['a'], undefined, 10_000), /FAILED/);
});
