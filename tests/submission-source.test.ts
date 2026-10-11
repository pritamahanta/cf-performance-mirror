import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { UserFacingError, fetchSubmissionSourceText } from '../src/services/codeforcesApi.ts';

const realFetch = globalThis.fetch;
const realDomParser = (globalThis as { DOMParser?: unknown }).DOMParser;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { DOMParser?: unknown }).DOMParser = realDomParser;
});

function installPageWithSource(source: string | null, html?: string) {
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString() {
      return {
        querySelector: (selector: string) =>
          selector === '#program-source-text' && source !== null
            ? { textContent: source, innerHTML: html ?? source }
            : null,
      };
    }
  };
}

test('fetchSubmissionSourceText: returns the text of #program-source-text and nothing else', async () => {
  installPageWithSource('#include <bits/stdc++.h>\nint main() {}\n');
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;

  const source = await fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1');
  assert.deepEqual(source, { text: '#include <bits/stdc++.h>\nint main() {}\n' });
});

test('fetchSubmissionSourceText: gives the element\'s plain text, not its markup', async () => {
  installPageWithSource(
    '#include <bits/stdc++.h>',
    '<span class="comment">#include &lt;bits/stdc++.h&gt;</span>',
  );
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;

  const source = await fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1');
  assert.deepEqual(source, { text: '#include <bits/stdc++.h>' }, 'the Copy button must get the plain source, not markup');
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
    (error: unknown) => {
      assert.ok(error instanceof UserFacingError);
      assert.match(error.message, /permission/);
      assert.doesNotMatch(error.message, /403/, 'no status code in what the user sees');
      return true;
    },
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

/* ---------- refusal wording and the hidden-frame retry ---------- */

const { describeSubmissionPageFailure, loadSourceInFrame } = await import('../src/services/codeforcesApi.ts');

test('refusal wording: bot protection is told apart from a plain 403, and no status code is shown', () => {
  const challenge = describeSubmissionPageFailure(403, '<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b"></script>');
  assert.match(challenge, /bot protection/);
  assert.doesNotMatch(challenge, /403/);

  const plain = describeSubmissionPageFailure(403, '');
  assert.match(plain, /permission/);
  assert.doesNotMatch(plain, /403/);
  assert.doesNotMatch(plain, /bot protection/);

  const other = describeSubmissionPageFailure(500, '');
  assert.match(other, /Could not load/);
  assert.doesNotMatch(other, /500/);
});

type FakeFrame = {
  attrs: Record<string, string>;
  style: { cssText: string };
  tabIndex: number;
  src: string;
  removed: boolean;
  contentDocument: { querySelector: (s: string) => unknown } | null;
  listeners: Record<string, () => void>;
  setAttribute(k: string, v: string): void;
  addEventListener(type: string, fn: () => void): void;
  remove(): void;
};

function installDocument(page: { querySelector: (s: string) => unknown } | null, fire = true) {
  const frames: FakeFrame[] = [];

  (globalThis as { document?: unknown }).document = {
    body: {
      appendChild(frame: FakeFrame) {
        frame.contentDocument = page;
        if (fire) queueMicrotask(() => frame.listeners.load?.());
      },
    },
    createElement() {
      const frame: FakeFrame = {
        attrs: {},
        style: { cssText: '' },
        tabIndex: 0,
        src: '',
        removed: false,
        contentDocument: null,
        listeners: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
        remove() {
          this.removed = true;
        },
      };
      frames.push(frame);
      return frame;
    },
  };

  return frames;
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

test('hidden frame: returns the source from the framed page and always removes the frame', async () => {
  const frames = installDocument({
    querySelector: (s: string) =>
      s === '#program-source-text' ? { textContent: 'int main(){}', innerHTML: 'int main(){}' } : null,
  });

  const result = await loadSourceInFrame('https://codeforces.com/contest/1/submission/1');
  assert.deepEqual(result, { text: 'int main(){}' });
  assert.equal(frames[0].src, 'https://codeforces.com/contest/1/submission/1');
  assert.equal(frames[0].removed, true);
});

test('hidden frame: a page without source, an unreadable frame, or a timeout gives null', async () => {
  let frames = installDocument({ querySelector: () => null });
  assert.equal(await loadSourceInFrame('u'), null);
  assert.equal(frames[0].removed, true);

  frames = installDocument(null);
  assert.equal(await loadSourceInFrame('u'), null, 'contentDocument null (blocked)');

  frames = installDocument({ querySelector: () => null }, false);
  assert.equal(await loadSourceInFrame('u', undefined, 20), null, 'never loads');
  assert.equal(frames[0].removed, true);
});

test('hidden frame: an aborted signal opens nothing', async () => {
  const frames = installDocument({ querySelector: () => null });
  const controller = new AbortController();
  controller.abort();

  assert.equal(await loadSourceInFrame('u', controller.signal), null);
  assert.equal(frames.length, 0);
});

test('fetchSubmissionSourceText: a 403 is retried in a hidden frame and succeeds from it', async () => {
  installPageWithSource('irrelevant');
  installDocument({
    querySelector: (s: string) =>
      s === '#program-source-text' ? { textContent: 'framed source', innerHTML: 'framed <b>source</b>' } : null,
  });
  globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;

  const source = await fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1');
  assert.deepEqual(source, { text: 'framed source' });
});

test('fetchSubmissionSourceText: a 403 that the frame cannot fix still reports the refusal', async () => {
  installPageWithSource('irrelevant');
  installDocument({ querySelector: () => null });
  globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;

  await assert.rejects(fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1'), /permission/);
});

test('fetchSubmissionSourceText: other statuses are not retried in a frame', async () => {
  installPageWithSource('irrelevant');
  const frames = installDocument({ querySelector: () => ({ textContent: 'x', innerHTML: 'x' }) });
  globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;

  await assert.rejects(fetchSubmissionSourceText('https://codeforces.com/contest/1/submission/1'), /Could not load/);
  assert.equal(frames.length, 0);
});
