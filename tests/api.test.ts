import test from 'node:test';
import assert from 'node:assert/strict';

import { checkProfileOnlineStatus } from '../src/services/codeforcesApi.ts';

function streamOf(text: string, chunk = 400) {
  const encoder = new TextEncoder();
  let position = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position >= text.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(text.slice(position, position + chunk)));
      position += chunk;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, wasCancelled: () => cancelled, position: () => position };
}

const filler = '<div>x</div>'.repeat(5000);

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

test('profile check: online now', async () => {
  const s = streamOf(`${filler}<li>Last visit: <span>online now</span></li>${filler}`);
  mockFetch(() => new Response(s.body, { status: 200 }));
  assert.equal(await checkProfileOnlineStatus('a'), 'online');
});

test('profile check: offline, and stops downloading early', async () => {
  const page = `${filler}<li>Last visit: <span>3 hours ago</span></li>${filler}${filler}${filler}`;
  const s = streamOf(page);
  mockFetch(() => new Response(s.body, { status: 200 }));
  assert.equal(await checkProfileOnlineStatus('a'), 'offline');
  assert.ok(s.position() < page.length / 2, 'should not read the whole page');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(s.wasCancelled(), true);
});

test('profile check: 404 (deleted handle) is offline; 429/503 are unknown', async () => {
  mockFetch(() => new Response('nope', { status: 404 }));
  assert.equal(await checkProfileOnlineStatus('gone'), 'offline');
  mockFetch(() => new Response('slow down', { status: 429 }));
  assert.equal(await checkProfileOnlineStatus('a'), 'unknown');
  mockFetch(() => new Response('down', { status: 503 }));
  assert.equal(await checkProfileOnlineStatus('a'), 'unknown');
});

test('profile check: 200 page without the marker is unknown, not offline', async () => {
  mockFetch(() => new Response('<html>Please wait while we verify your browser</html>', { status: 200 }));
  assert.equal(await checkProfileOnlineStatus('a'), 'unknown');
});

test('profile check: network error and abort are unknown', async () => {
  mockFetch(() => {
    throw new TypeError('network down');
  });
  assert.equal(await checkProfileOnlineStatus('a'), 'unknown');
});
