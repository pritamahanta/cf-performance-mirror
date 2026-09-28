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
 */
const inflight = new Map<string, Promise<FriendSubmission[]>>();

/*
 * All submissions `handle` has in `contestId`: from the tab cache if
 * fresh, otherwise from the API (cached afterwards). Rejects if the
 * API call fails; failures are deliberately not cached.
 */
export function loadFriendContestSubmissions(
  contestId: number,
  handle: string,
): Promise<FriendSubmission[]> {
  const cached = loadCachedSubmissions(contestId, handle);

  if (cached) {
    return Promise.resolve(cached);
  }

  const key = `${contestId}:${handle.toLowerCase()}`;
  const running = inflight.get(key);

  if (running) {
    return running;
  }

  const request = fetchContestSubmissionsByHandle(contestId, handle)
    .then(raw => {
      const submissions = compactSubmissions(raw);

      saveCachedSubmissions(contestId, handle, submissions);

      return submissions;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);

  return request;
}
