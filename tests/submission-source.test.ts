import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchSubmissionSourceText } from '../src/services/codeforcesApi.ts';

const realFetch = globalThis.fetch;
const realDomParser = (globalThis as { DOMParser?: unknown }).DOMParser;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { DOMParser?: unknown }).DOMParser = realDomParser;
});

function installPageWithSource(source: string | null) {
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString() {
      return {
        querySelector: (selector: string) =>
          selector === '#program-source-text' && source !== null
            ? { textContent: source }
            : null,
      };
    }
  };
}

test('fetchSubmissionSourceText: returns the text of #program-source-text', async () => {
  installPageWithSource('#include <bits/stdc++.h>\nint main() {}\n');
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;

  const source = await fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1');
  assert.equal(source, '#include <bits/stdc++.h>\nint main() {}\n');
});

test('fetchSubmissionSourceText: no such element on the page is a clear error, not empty source', async () => {
  installPageWithSource(null);
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;

  await assert.rejects(
    fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1'),
    /source/i,
  );
});

test('fetchSubmissionSourceText: blank source is treated the same as missing', async () => {
  installPageWithSource('   \n  ');
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;

  await assert.rejects(fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1'));
});

test('fetchSubmissionSourceText: a non-ok response is rejected and never reaches the parser', async () => {
  installPageWithSource('irrelevant');
  globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;

  await assert.rejects(
    fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1'),
    /403/,
  );
});

test('fetchSubmissionSourceText: an already-aborted signal rejects (same as real fetch would)', async () => {
  installPageWithSource('irrelevant');
  globalThis.fetch = (async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return new Response('<html></html>', { status: 200 });
  }) as typeof fetch;

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1', controller.signal),
  );
});
