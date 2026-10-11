import { fetchSubmissionSourceText } from './codeforcesApi';

import type { SubmissionSource } from './codeforcesApi';

/*
 * Session cache and hover prefetch for submission source.
 *
 * The slow part of opening a submission is the request for its
 * Codeforces page (see fetchSubmissionSourceText), which only started
 * once the overlay had opened. This module:
 *
 *  - remembers sources already loaded (a submission's source does not
 *    change), so opening the same one again is instant;
 *  - shares one request between callers that ask for the same url
 *    while it is still loading;
 *  - starts the request when the pointer rests on a row (or the row
 *    gets keyboard focus), so it is often finished by the click.
 *
 * Only successful loads are kept; a failure is never cached, so the
 * next open tries again. A prefetch never uses the hidden-frame
 * fallback (that loads a whole Codeforces page just because of a
 * hover); if a prefetch fails, opening the submission does the full
 * load, fallback included, exactly as before.
 */

type Loader = typeof fetchSubmissionSourceText;

interface Entry {
  promise: Promise<SubmissionSource>;
  /* True when this load may use the hidden-frame fallback. */
  framed: boolean;
  /* Set once the load has succeeded. */
  text: string | null;
}

const MAX_ENTRIES = 25;
const PREFETCH_DELAY_MS = 250;

const entries = new Map<string, Entry>();

let prefetchesInFlight = 0;

let intentTimer: ReturnType<typeof setTimeout> | null = null;

function start(url: string, framed: boolean, load: Loader): Entry {
  const existing = entries.get(url);

  if (existing) {
    /* Most recently used goes last. */
    entries.delete(url);
    entries.set(url, existing);

    return existing;
  }

  const entry: Entry = {
    /* No caller signal: the request is shared. It still has its own time limit. */
    promise: load(url, undefined, undefined, framed),
    framed,
    text: null,
  };

  entries.set(url, entry);

  /* Registered before any caller's handlers, so it has run by the time they do. */
  entry.promise.then(
    source => {
      entry.text = source.text;
    },
    () => {
      if (entries.get(url) === entry) {
        entries.delete(url);
      }
    },
  );

  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;

    if (oldest === undefined) {
      break;
    }

    entries.delete(oldest);
  }

  return entry;
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

async function resolveSource(
  url: string,
  load: Loader,
): Promise<SubmissionSource> {
  const existing = entries.get(url);

  if (existing && !existing.framed) {
    /* Started by a hover: use it if it worked, otherwise do the full load below. */
    try {
      return await start(url, false, load).promise;
    } catch {
      /* A failed entry has removed itself; fall through to a full load. */
    }
  }

  return start(url, true, load).promise;
}

/* The source text if it has already been loaded, else null. */
export function peekCachedSubmissionText(url: string): string | null {
  return entries.get(url)?.text ?? null;
}

/*
 * Same result as fetchSubmissionSourceText(url, signal). Aborting
 * `signal` rejects this call at once but does not cancel the shared
 * request, which finishes (or times out) in the background.
 */
export function getSubmissionSource(
  url: string,
  signal?: AbortSignal,
  load: Loader = fetchSubmissionSourceText,
): Promise<SubmissionSource> {
  if (!signal) {
    return resolveSource(url, load);
  }

  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<SubmissionSource>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });

    resolveSource(url, load).then(
      source => {
        signal.removeEventListener('abort', onAbort);
        resolve(source);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/* Starts loading `url` in the background. At most one prefetch runs at a time. */
export function prefetchSubmissionSource(
  url: string,
  load: Loader = fetchSubmissionSourceText,
): void {
  if (entries.has(url) || prefetchesInFlight > 0) {
    return;
  }

  prefetchesInFlight += 1;

  const done = () => {
    prefetchesInFlight = Math.max(0, prefetchesInFlight - 1);
  };

  start(url, false, load).promise.then(done, done);
}

export function cancelPrefetchIntent(): void {
  if (intentTimer !== null) {
    clearTimeout(intentTimer);
    intentTimer = null;
  }
}

/* For a row's pointer-enter / focus: prefetch if the pointer stays a moment. */
export function prefetchOnIntent(url: string): void {
  cancelPrefetchIntent();

  if (entries.has(url)) {
    return;
  }

  intentTimer = setTimeout(() => {
    intentTimer = null;
    prefetchSubmissionSource(url);
  }, PREFETCH_DELAY_MS);
}

/* For tests. */
export function clearSubmissionSourceCache(): void {
  cancelPrefetchIntent();
  entries.clear();
  prefetchesInFlight = 0;
}
