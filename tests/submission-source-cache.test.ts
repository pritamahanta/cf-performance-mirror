import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelPrefetchIntent,
  clearSubmissionSourceCache,
  getSubmissionSource,
  peekCachedSubmissionText,
  prefetchOnIntent,
  prefetchSubmissionSource,
} from '../src/services/submissionSourceCache.ts';

import { UserFacingError, fetchSubmissionSourceText } from '../src/services/codeforcesApi.ts';

type Call = { url: string; framed: boolean | undefined };

const URL_A = 'https://codeforces.com/contest/1/submission/1';
const URL_B = 'https://codeforces.com/contest/1/submission/2';

afterEach(() => {
  clearSubmissionSourceCache();
});

/* A loader whose results the test settles by hand. */
function controlledLoader() {
  const calls: Call[] = [];
  const pending: Array<{ resolve: (text: string) => void; reject: (error: Error) => void }> = [];

  const load = ((url: string, _signal?: AbortSignal, _timeoutMs?: number, framed?: boolean) => {
    calls.push({ url, framed });

    return new Promise((resolve, reject) => {
      pending.push({ resolve: text => resolve({ text }), reject });
    });
  }) as unknown as typeof fetchSubmissionSourceText;

  return { load, calls, pending };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('cache: a second open of the same submission makes no request and is readable synchronously', async () => {
  const { load, calls, pending } = controlledLoader();

  const first = getSubmissionSource(URL_A, undefined, load);
  pending[0].resolve('int main(){}');
  assert.deepEqual(await first, { text: 'int main(){}' });

  assert.equal(peekCachedSubmissionText(URL_A), 'int main(){}');

  assert.deepEqual(await getSubmissionSource(URL_A, undefined, load), { text: 'int main(){}' });
  assert.equal(calls.length, 1);
});

test('cache: callers asking for the same url while it loads share one request', async () => {
  const { load, calls, pending } = controlledLoader();

  const one = getSubmissionSource(URL_A, undefined, load);
  const two = getSubmissionSource(URL_A, undefined, load);
  pending[0].resolve('x');

  assert.deepEqual(await one, { text: 'x' });
  assert.deepEqual(await two, { text: 'x' });
  assert.equal(calls.length, 1);
});

test('cache: a failure is not cached, the next open tries again', async () => {
  const { load, calls, pending } = controlledLoader();

  const first = getSubmissionSource(URL_A, undefined, load);
  pending[0].reject(new UserFacingError('nope'));
  await assert.rejects(first, /nope/);

  assert.equal(peekCachedSubmissionText(URL_A), null);

  const second = getSubmissionSource(URL_A, undefined, load);
  pending[1].resolve('ok');
  assert.deepEqual(await second, { text: 'ok' });
  assert.equal(calls.length, 2);
});

test('cache: opening starts a framed load; a prefetch starts an unframed one', async () => {
  const opened = controlledLoader();
  void getSubmissionSource(URL_A, undefined, opened.load);
  assert.equal(opened.calls[0].framed, true);
  clearSubmissionSourceCache();

  const prefetched = controlledLoader();
  prefetchSubmissionSource(URL_A, prefetched.load);
  assert.equal(prefetched.calls[0].framed, false);
});

test('prefetch: opening while the prefetch is loading uses its result', async () => {
  const { load, calls, pending } = controlledLoader();

  prefetchSubmissionSource(URL_A, load);
  const opened = getSubmissionSource(URL_A, undefined, load);
  pending[0].resolve('from prefetch');

  assert.deepEqual(await opened, { text: 'from prefetch' });
  assert.equal(calls.length, 1);
});

test('prefetch: if the prefetch fails, opening does the full (framed) load', async () => {
  const { load, calls, pending } = controlledLoader();

  prefetchSubmissionSource(URL_A, load);
  const opened = getSubmissionSource(URL_A, undefined, load);
  pending[0].reject(new UserFacingError('refused'));
  await tick();

  assert.equal(calls.length, 2);
  assert.equal(calls[1].framed, true);

  pending[1].resolve('full load');
  assert.deepEqual(await opened, { text: 'full load' });
});

test('prefetch: only one runs at a time, and a cached url is not fetched again', async () => {
  const { load, calls, pending } = controlledLoader();

  prefetchSubmissionSource(URL_A, load);
  prefetchSubmissionSource(URL_B, load);
  assert.equal(calls.length, 1, 'second prefetch skipped while the first is loading');

  pending[0].resolve('a');
  await tick();

  prefetchSubmissionSource(URL_A, load);
  assert.equal(calls.length, 1, 'already cached');

  prefetchSubmissionSource(URL_B, load);
  assert.equal(calls.length, 2, 'free to prefetch again once the first finished');
});

test('prefetch: a failed prefetch frees the slot and leaves nothing cached', async () => {
  const { load, calls, pending } = controlledLoader();

  prefetchSubmissionSource(URL_A, load);
  pending[0].reject(new Error('boom'));
  await tick();

  assert.equal(peekCachedSubmissionText(URL_A), null);

  prefetchSubmissionSource(URL_A, load);
  assert.equal(calls.length, 2);
});

test('abort: an already-aborted signal rejects and starts no request', async () => {
  const { load, calls } = controlledLoader();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(getSubmissionSource(URL_A, controller.signal, load), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('abort: aborting rejects that caller at once, and the load still finishes into the cache', async () => {
  const { load, calls, pending } = controlledLoader();
  const controller = new AbortController();

  const opened = getSubmissionSource(URL_A, controller.signal, load);
  controller.abort();
  await assert.rejects(opened, { name: 'AbortError' });

  pending[0].resolve('late');
  await tick();

  assert.equal(peekCachedSubmissionText(URL_A), 'late');
  assert.deepEqual(await getSubmissionSource(URL_A, undefined, load), { text: 'late' });
  assert.equal(calls.length, 1);
});

test('intent: leaving the row before the delay cancels the prefetch', async () => {
  let started = false;
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    started = true;
    return new Response('', { status: 500 });
  }) as typeof fetch;

  try {
    prefetchOnIntent(URL_A);
    cancelPrefetchIntent();
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(started, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchSubmissionSourceText: with the frame fallback off, a 403 opens no frame', async () => {
  const frames: unknown[] = [];
  const realFetch = globalThis.fetch;

  (globalThis as { document?: unknown }).document = {
    body: { appendChild() {} },
    createElement() {
      const frame = {};
      frames.push(frame);
      return frame;
    },
  };

  globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;

  try {
    await assert.rejects(fetchSubmissionSourceText(URL_A, undefined, undefined, false), /permission/);
    assert.equal(frames.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { document?: unknown }).document;
  }
});
