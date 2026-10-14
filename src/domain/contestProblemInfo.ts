import type { CodeforcesContest, CodeforcesProblem } from '../types/codeforces';

/*
 * Pure logic for picking a problem's name and its contest's name out of
 * a contest.standings reply (no network), so it can be tested on its
 * own. See services/contestProblemInfoCache.ts for the fetching side.
 */

export interface ContestProblemInfo {
  contestName: string;
  problemName: string;
}

/*
 * Null when either name is missing or blank - both are optional on
 * Codeforces' own objects - so the caller falls back to the problem's
 * letter alone, as it did before this existed.
 */
export function pickContestProblemInfo(
  contest: CodeforcesContest,
  problems: readonly CodeforcesProblem[],
  index: string,
): ContestProblemInfo | null {
  const problem = problems.find(
    p => p.index.toUpperCase() === index.toUpperCase(),
  );

  const contestName = contest.name?.trim();
  const problemName = problem?.name?.trim();

  if (!contestName || !problemName) {
    return null;
  }

  return { contestName, problemName };
}
