import type { ListFetchFailure } from '../domain/problemLists';
import { MAX_FILE_BYTES } from '../domain/problemLists';

export type ListFetchResult =
  | { ok: true; text: string; contentType: string }
  | { ok: false; failure: ListFetchFailure; status?: number };

export interface ListFetchOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/* The body as text, or null as soon as it is longer than `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();

  if (!reader) {
    const text = await response.text();

    return text.length > maxBytes ? null : text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);

      return null;
    }

    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8').decode(joined);
}

/*
 * Reads a list from a web address, from the page itself (so the site has to
 * allow it: a site that does not send the headers browsers require for
 * that makes the request fail, which is reported as "blocked"). No cookies
 * or login are sent, nothing identifies the page that asked, and the
 * answer is capped in size and time. Never throws.
 */
export async function fetchListText(
  url: string,
  options: ListFetchOptions = {},
): Promise<ListFetchResult> {
  const fetcher = options.fetcher ?? ((address, init) => fetch(address, init));
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetcher(url, {
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, failure: 'http', status: response.status };
    }

    const declared = Number(response.headers.get('content-length'));

    if (Number.isFinite(declared) && declared > maxBytes) {
      controller.abort();

      return { ok: false, failure: 'too-large' };
    }

    const text = await readCapped(response, maxBytes);

    if (text === null) {
      return { ok: false, failure: 'too-large' };
    }

    return { ok: true, text, contentType: response.headers.get('content-type') ?? '' };
  } catch {
    return { ok: false, failure: timedOut ? 'timeout' : 'blocked' };
  } finally {
    clearTimeout(timer);
  }
}
