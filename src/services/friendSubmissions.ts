import { compactSubmissions } from '../domain/friendSubmissions';
import type { FriendSubmission } from '../domain/friendSubmissions';
import { fetchContestSubmissionsByHandle } from './codeforcesApi';
import {
  loadCachedSubmissions,
  loadStoredSubmissions,
  saveCachedSubmissions,
} from './friendSubmissionsStore';
import type { StoredSubmissions } from './friendSubmissionsStore';

/*
 * Requests currently running in this tab, keyed by contest+handle, so
 * a caller that asks again while one is in flight (the friends list
 * refreshes every minute) shares it instead of queueing a duplicate
 * call. This only dedupes within one tab; the lock below handles the
 * same request arriving from a different tab at the same time.
 *
 * The signal it was started with is kept so a request that has been
 * aborted (and is only waiting to be dropped by the queue) is never
 * handed to a new caller, who would otherwise inherit its rejection.
 */
const inflight = new Map<
  string,
  {
    promise: Promise<FriendSubmission[]>;
    signal: AbortSignal | undefined;
  }
>();

/*
 * The cache (friendSubmissionsStore.ts) is backed by localStorage, so
 * it is already shared by every tab on codeforces.com. Without a lock,
 * though, opening several problem pages of the same contest at once
 * (e.g. A, B and C in three tabs) still has each tab miss the cache at
 * the same moment and queue its own API call for the same friend - as
 * many duplicate requests as there are tabs open, each paced to the
 * same per-tab rate, so the combined rate against Codeforces scales
 * with tab count.
 *
 * `navigator.locks` (the Web Locks API) is already used for this exact
 * purpose elsewhere in the extension - see createBrowserPersistence's
 * runExclusive in onlineStore.ts, confirmed working inside this
 * extension's content scripts - so the same mechanism is used here,
 * one lock per contest+handle: the tab that gets the lock first makes
 * the request and caches it; every other tab asking for the same
 * friend in the same contest waits for that lock instead of firing its
 * own request, then re-reads the (now populated) shared cache.
 */
const locks: LockManager | undefined =
  typeof navigator !== 'undefined' ? navigator.locks : undefined;

async function fetchAndCache(
  contestId: number,
  handle: string,
  signal?: AbortSignal,
): Promise<FriendSubmission[]> {
  const raw = await fetchContestSubmissionsByHandle(contestId, handle, signal);
  const submissions = compactSubmissions(raw);

  saveCachedSubmissions(contestId, handle, submissions);

  return submissions;
}

/*
 * Runs the fetch-or-cache work for one contest+handle under a cross-tab
 * lock, when the Web Locks API is available; falls back to fetching
 * directly (today's behavior) when it is not. The signal is passed to
 * the lock request itself, so a caller that aborts while only waiting
 * for its turn (never having started a request) is dropped immediately
 * instead of being left queued.
 *
 * A genuine fetch failure (API error, abort once the lock was granted)
 * is not caught here and rejects normally, same as without a lock -
 * only the lock-acquisition step is wrapped, never the outcome of the
 * task that runs inside it.
 */
function runUnderLock(
  key: string,
  contestId: number,
  handle: string,
  signal?: AbortSignal,
): Promise<FriendSubmission[]> {
  if (!locks || typeof locks.request !== 'function') {
    return fetchAndCache(contestId, handle, signal);
  }

  const callback = async (lock: Lock | null): Promise<FriendSubmission[]> => {
    if (!lock) {
      /* Not expected without `ifAvailable`, but handled rather than assumed impossible. */
      return fetchAndCache(contestId, handle, signal);
    }

    /* Another tab may have fetched and cached this while we waited for the lock. */
    const cached = loadCachedSubmissions(contestId, handle);

    if (cached) {
      return cached;
    }

    return fetchAndCache(contestId, handle, signal);
  };

  /*
   * lib.dom's LockGrantedCallback<T> types the callback as returning
   * `T` (not `T | PromiseLike<T>`), even though the real API does
   * await whatever the callback returns (per MDN: "the callback ...
   * may return a Promise, [and] the Promise returned by request()
   * resolves ... when it resolves") - this is a gap in the bundled
   * type definitions, not a runtime issue, so the callback is cast to
   * what that (mistyped) signature expects rather than widened to `any`.
   */
  return locks.request(
    `cfpm-fsub:${key}`,
    { signal },
    callback as unknown as LockGrantedCallback<FriendSubmission[]>,
  );
}

/*
 * What is stored for `handle` in `contestId`, even if it is no longer up
 * to date (up to a day old), so it can be shown at once while
 * loadFriendContestSubmissions fetches the fresh copy. Sends nothing.
 */
export function peekStoredFriendSubmissions(
  contestId: number,
  handle: string,
): StoredSubmissions | null {
  return loadStoredSubmissions(contestId, handle);
}

/*
 * All submissions `handle` has in `contestId`: from the shared cache if
 * fresh, otherwise from the API (cached afterwards, for every tab).
 * Rejects if the API call fails or is aborted; failures are
 * deliberately not cached. An aborted signal that has not started its
 * request yet (including one still waiting on the cross-tab lock)
 * sends nothing at all.
 */
export function loadFriendContestSubmissions(
  contestId: number,
  handle: string,
  signal?: AbortSignal,
): Promise<FriendSubmission[]> {
  const cached = loadCachedSubmissions(contestId, handle);

  if (cached) {
    return Promise.resolve(cached);
  }

  const key = `${contestId}:${handle.toLowerCase()}`;
  const running = inflight.get(key);

  if (running && !running.signal?.aborted) {
    return running.promise;
  }

  const request = runUnderLock(key, contestId, handle, signal)
    .finally(() => {
      /* Only remove our own entry, never a newer one that replaced it. */
      if (inflight.get(key)?.promise === request) {
        inflight.delete(key);
      }
    });

  inflight.set(key, { promise: request, signal });

  return request;
}
