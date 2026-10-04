import { compactSubmissions } from '../domain/friendSubmissions';
import type { FriendSubmission } from '../domain/friendSubmissions';
import { fetchContestSubmissionsByHandle } from './codeforcesApi';
import {
  loadCachedSubmissions,
  saveCachedSubmissions,
} from './friendSubmissionsStore';

/*
 * Requests currently running, keyed by contest+handle, so a caller
 * that asks again while one is in flight (the friends list refreshes
 * every minute) shares it instead of queueing a duplicate call.
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
 * All submissions `handle` has in `contestId`: from the tab cache if
 * fresh, otherwise from the API (cached afterwards). Rejects if the
 * API call fails or is aborted; failures are deliberately not cached.
 * An aborted signal that has not started its request yet sends
 * nothing at all.
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

  const request = fetchContestSubmissionsByHandle(contestId, handle, signal)
    .then(raw => {
      const submissions = compactSubmissions(raw);

      saveCachedSubmissions(contestId, handle, submissions);

      return submissions;
    })
    .finally(() => {
      /* Only remove our own entry, never a newer one that replaced it. */
      if (inflight.get(key)?.promise === request) {
        inflight.delete(key);
      }
    });

  inflight.set(key, { promise: request, signal });

  return request;
}
