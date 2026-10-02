import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { classifyProfileHtml } from '../src/domain/onlineTracker.ts';
import { checkProfileOnlineStatus } from '../src/services/codeforcesApi.ts';
import { findSidebarBoxByText } from '../src/content/mount.ts';

/* Profile lines as the live site words them (English and Russian). */
const EN_ONLINE = '<li><span>Last visit:</span> <span class="x">online now</span></li><li>Registered: 5 years ago</li>';
const RU_ONLINE = '<li>Последнее посещение: сейчас на сайте</li><li>Зарегистрирован: 16 лет назад</li>';

test('english: online and offline values', () => {
  assert.equal(classifyProfileHtml(EN_ONLINE), 'online');
  for (const ago of ['18 minutes ago', '7 hours ago', '3 weeks ago', '12 months ago', '4 years ago', 'a minute ago']) {
    assert.equal(
      classifyProfileHtml(`<li>Last visit: <span title="Sep/29/2026 18:19:18">${ago}</span></li><li>Registered: 1 year ago</li>`),
      'offline',
      ago,
    );
  }
});

test('russian: online and offline values', () => {
  assert.equal(classifyProfileHtml(RU_ONLINE), 'online');
  for (const ago of ['4 дня назад', '7 недель назад', '4 недели назад', '3 года назад', '9 месяцев назад', '6 лет назад', 'минуту назад']) {
    assert.equal(
      classifyProfileHtml(`<li>Последнее посещение: <span title="Sep/29/2026 18:19:18">${ago}</span></li><li>Зарегистрирован: 1 год назад</li>`),
      'offline',
      ago,
    );
  }
});

test('label matching ignores case, tags, and non-breaking spaces', () => {
  assert.equal(classifyProfileHtml('<li>LAST VISIT: Online Now</li>'), 'online');
  assert.equal(classifyProfileHtml('<li>ПОСЛЕДНЕЕ ПОСЕЩЕНИЕ: СЕЙЧАС НА САЙТЕ</li>'), 'online');
  assert.equal(classifyProfileHtml('<li>Last&nbsp;visit&nbsp;:&nbsp;online&nbsp;now</li>'), 'online');
  assert.equal(classifyProfileHtml('<li>Последнее&nbsp;посещение:&#160;сейчас&nbsp;на&nbsp;сайте</li>'), 'online');
  assert.equal(classifyProfileHtml('<li>Последнее посещение: сейчас <b>на</b> сайте</li>'), 'online');
  assert.equal(classifyProfileHtml('<div>Last visit:</div><div><span>3 hours ago</span></div>'), 'offline');
});

test('a date in a title attribute never decides the answer', () => {
  assert.equal(
    classifyProfileHtml('<li>Последнее посещение: <span title="Sep/29/2026 18:19:18">сейчас на сайте</span></li>'),
    'online',
  );
  /* Digits only inside a tag are not a time value. */
  assert.equal(
    classifyProfileHtml('<li>Последнее посещение: <span title="Sep/29/2026 18:19:18">непонятно</span></li>'),
    'unknown',
  );
});

test('only the Last visit line counts, not later text on the page', () => {
  assert.equal(
    classifyProfileHtml('<li>Last visit: 3 hours ago</li><li>Registered: 2 years ago</li><p>online now</p>'),
    'offline',
  );
  assert.equal(
    classifyProfileHtml('<li>Последнее посещение: 3 часа назад</li><p>сейчас на сайте</p>'),
    'offline',
  );
});

test('a value we do not recognise is unknown, never offline', () => {
  /* The next line has digits; they must not turn an unrecognised value into "offline". */
  assert.equal(
    classifyProfileHtml('<li>Последнее посещение: сейчас онлайн</li><li>Зарегистрирован: 5 лет назад</li>'),
    'unknown',
  );
  assert.equal(
    classifyProfileHtml('Последнее посещение: сейчас онлайн Зарегистрирован: 5 лет назад'),
    'unknown',
  );
  assert.equal(classifyProfileHtml('Last visit: just now Registered: 5 years ago'), 'unknown');
});

test('a language that is not listed is unknown, never offline', () => {
  for (const html of [
    '<li>最后访问: 3 小时前</li>',
    '<li>Última visita: hace 3 horas</li>',
    '<li>Letzter Besuch: vor 3 Stunden</li>',
    '<li>Son ziyaret: 3 saat önce</li>',
  ]) {
    assert.equal(classifyProfileHtml(html), 'unknown', html);
  }
});

test('truncated, empty and error pages are unknown', () => {
  assert.equal(classifyProfileHtml(''), 'unknown');
  assert.equal(classifyProfileHtml('<html>503 Service Unavailable</html>'), 'unknown');
  assert.equal(classifyProfileHtml('<li>Last visit:'), 'unknown');
  assert.equal(classifyProfileHtml('<li>Последнее посещение:   '), 'unknown');
});

/* ------------------------------------------------------------------ */
/* The real reader: streamed body, multi-byte text split across chunks */
/* ------------------------------------------------------------------ */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function streamedResponse(text: string, chunkBytes: number, pulled: { chunks: number }): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();

        return;
      }

      pulled.chunks += 1;
      controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      offset += chunkBytes;
    },
  });

  return new Response(body, { status: 200 });
}

test('reader: Russian page split mid-character is still read correctly', async () => {
  const filler = '<div>x</div>'.repeat(50);

  for (const chunkBytes of [1, 3, 7, 64]) {
    const pulled = { chunks: 0 };
    globalThis.fetch = (async () => streamedResponse(`${filler}${RU_ONLINE}`, chunkBytes, pulled)) as typeof fetch;
    assert.equal(await checkProfileOnlineStatus('someone'), 'online', `chunk ${chunkBytes}`);

    globalThis.fetch = (async () =>
      streamedResponse(`${filler}<li>Последнее посещение: 4 дня назад</li><li>Зарегистрирован: 1 год назад</li>`, chunkBytes, { chunks: 0 })) as typeof fetch;
    assert.equal(await checkProfileOnlineStatus('someone'), 'offline', `chunk ${chunkBytes}`);
  }
});

test('reader: English page still works and the download stops early', async () => {
  const pulled = { chunks: 0 };
  const huge = `<li>Last visit: <span>online now</span></li>${'<p>filler</p>'.repeat(40_000)}`;
  globalThis.fetch = (async () => streamedResponse(huge, 4096, pulled)) as typeof fetch;

  assert.equal(await checkProfileOnlineStatus('someone'), 'online');
  assert.ok(pulled.chunks < 20, `read ${pulled.chunks} chunks; the rest of the page should not be downloaded`);
});

test('reader: unlisted language and non-200 answers stay unknown', async () => {
  globalThis.fetch = (async () => streamedResponse('<li>最后访问: 3 小时前</li>', 16, { chunks: 0 })) as typeof fetch;
  assert.equal(await checkProfileOnlineStatus('someone'), 'unknown');

  globalThis.fetch = (async () => new Response('x', { status: 429 })) as typeof fetch;
  assert.equal(await checkProfileOnlineStatus('someone'), 'unknown');

  globalThis.fetch = (async () => new Response('x', { status: 404 })) as typeof fetch;
  assert.equal(await checkProfileOnlineStatus('someone'), 'offline');
});

/* ------------------------------------------------------------------ */
/* Sidebar placement                                                    */
/* ------------------------------------------------------------------ */

function fakeSidebar(captions: Array<string | null>): { sidebar: Element; boxes: Element[] } {
  const boxes = captions.map(caption => ({
    textContent: `box ${caption ?? ''}`,
    querySelector: () => (caption === null ? null : { textContent: caption }),
  })) as unknown as Element[];

  const sidebar = { querySelectorAll: () => boxes } as unknown as Element;

  return { sidebar, boxes };
}

test('sidebar: finds the Top rated box in English and Russian', () => {
  const english = fakeSidebar(['→ Pay attention', '→ Top rated', '→ Top contributors']);
  assert.equal(findSidebarBoxByText(english.sidebar, ['top rated', 'лидеры (рейтинг)']), english.boxes[1]);

  const russian = fakeSidebar(['→ Обратите внимание', '→ Лидеры (рейтинг)', '→ Лидеры (вклад)']);
  assert.equal(findSidebarBoxByText(russian.sidebar, ['top rated', 'лидеры (рейтинг)']), russian.boxes[1]);

  assert.equal(findSidebarBoxByText(russian.sidebar, 'top rated'), null);
  assert.equal(findSidebarBoxByText(english.sidebar, 'top contributors'), english.boxes[2]);
});

test('label and value in separate list items still read the value', () => {
  assert.equal(classifyProfileHtml('<li>Last visit:</li><li>3 hours ago</li>'), 'offline');
  assert.equal(classifyProfileHtml('<li>Последнее посещение:</li><li>сейчас на сайте</li>'), 'online');
});
