import type { ProblemRef } from '../domain/friendSubmissions';
import { pickContestProblemInfo } from '../domain/contestProblemInfo';
import type { ContestProblemInfo } from '../domain/contestProblemInfo';
import { fetchContestStandingsHeader } from './codeforcesApi';

export type { ContestProblemInfo };

/*
 * The current problem's contest name and the problem's own name, for the
 * "By <handle>, contest: ..., problem: (<index>) <name>" line on a
 * friend's submission source. Every submission opened on one problem
 * page is on the same contest and problem, so the first lookup's answer
 * is cached (per contest) and reused for the rest of the page's life -
 * one request at most, however many friends' submissions are opened.
 * Never throws: a failed or incomplete reply resolves to null, and the
 * header falls back to the problem's letter alone, as it did before.
 */
const cache = new Map<number, Promise<ContestProblemInfo | null>>();

export function loadContestProblemInfo(
  problem: ProblemRef,
): Promise<ContestProblemInfo | null> {
  const cached = cache.get(problem.contestId);

  if (cached) {
    return cached;
  }

  const request = fetchContestStandingsHeader(problem.contestId)
    .then(standings =>
      pickContestProblemInfo(standings.contest, standings.problems, problem.index),
    )
    .catch(() => null);

  cache.set(problem.contestId, request);

  return request;
}

export function clearContestProblemInfoCache(): void {
  cache.clear();
}
