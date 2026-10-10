import type { ModeData, ProblemEntry, SubmissionTiming } from '../types/performance';
import type { Category } from '../types/settings';
import { totalErrors } from './utils';

export const ALL_CF_TAGS = [
  '*special', '2-sat', 'binary search', 'bitmasks', 'brute force',
  'chinese remainder theorem', 'combinatorics', 'constructive algorithms',
  'data structures', 'dfs and similar', 'divide and conquer', 'dp', 'dsu',
  'expression parsing', 'fft', 'flows', 'games', 'geometry',
  'graph matchings', 'graphs', 'greedy', 'hashing', 'implementation',
  'interactive', 'math', 'matrices', 'meet-in-the-middle', 'number theory',
  'probabilities', 'schedules', 'shortest paths', 'sortings', 'special',
  'string suffix structures', 'strings', 'ternary search', 'trees',
  'two pointers',
];

export type FrictionSource = 'category' | 'practice';

export interface FrictionFilters {
  hideAC: boolean;
  solvedOnly: boolean;
  hideTags: boolean;
  hideRatings: boolean;
  minAttempts: number;
  ratingMin: string;
  ratingMax: string;
  tagFilters: string[];
}

export interface FilteredFrictionResult {
  problems: ProblemEntry[];
  availableTags: string[];
}

export interface FrictionViewState {
  source: FrictionSource;
  sort: 'errors' | 'rating';
  filters: FrictionFilters;
}

export function getFrictionProblems(modeData: ModeData, category: Category, source: FrictionSource): ProblemEntry[] {
  return source === 'category'
    ? (modeData.categoryRawProblems?.[category] || [])
    : (modeData.practiceRawProblems || []);
}

export function getAvailableTags(problems: readonly ProblemEntry[]): string[] {
  return Array.from(new Set(problems.flatMap(problem => problem.tags || []))).sort();
}

export function filterFrictionProblems(
  problems: readonly ProblemEntry[],
  filters: FrictionFilters,
): ProblemEntry[] {
  const rMin = filters.ratingMin !== '' && !Number.isNaN(Number.parseInt(filters.ratingMin, 10))
    ? Number.parseInt(filters.ratingMin, 10)
    : null;
  const rMax = filters.ratingMax !== '' && !Number.isNaN(Number.parseInt(filters.ratingMax, 10))
    ? Number.parseInt(filters.ratingMax, 10)
    : null;

  return problems
    .filter(problem => totalErrors(problem) >= filters.minAttempts)
    .filter(problem => !filters.solvedOnly || problem.solved)
    .filter(problem => !filters.hideAC || !problem.solved)
    .filter(problem => filters.tagFilters.length === 0 || filters.tagFilters.every(tag => (problem.tags || []).includes(tag)))
    .filter(problem => {
      if (rMin === null && rMax === null) return true;
      if (!problem.rating) return false;
      if (rMin !== null && problem.rating < rMin) return false;
      if (rMax !== null && problem.rating > rMax) return false;
      return true;
    });
}

export function sortFrictionProblems(problems: readonly ProblemEntry[], sort: 'errors' | 'rating'): ProblemEntry[] {
  return [...problems].sort((a, b) => sort === 'rating'
    ? (b.rating || 0) - (a.rating || 0)
    : totalErrors(b) - totalErrors(a));
}

export type SubmissionVerdictKey = 'ac' | 'wa' | 'tle' | 'rte' | 'mle' | 'other';

/* Every submission recorded for one problem, each with its verdict. */
export function getProblemSubmissions(
  problem: Pick<ProblemEntry, 'acIds' | 'waIds' | 'tleIds' | 'rteIds' | 'mleIds' | 'otherIds'>,
): { id: number; verdict: SubmissionVerdictKey }[] {
  const byId = new Map<number, SubmissionVerdictKey>();
  const add = (ids: readonly number[] | undefined, verdict: SubmissionVerdictKey) => {
    (ids || []).forEach(id => byId.set(id, verdict));
  };

  add(problem.acIds, 'ac');
  add(problem.waIds, 'wa');
  add(problem.tleIds, 'tle');
  add(problem.rteIds, 'rte');
  add(problem.mleIds, 'mle');
  add(problem.otherIds, 'other');

  return Array.from(byId, ([id, verdict]) => ({ id, verdict }));
}

export function buildSubmissionUrl(
  submissionId: number,
  contestId: number,
  submissionContestMap?: Map<number, number>,
): string | null {
  const resolvedContestId = submissionContestMap?.get(submissionId) || contestId;
  if (!resolvedContestId || resolvedContestId <= 0) return null;
  const path = resolvedContestId >= 100001 ? 'gym' : 'contest';
  return `https://codeforces.com/${path}/${resolvedContestId}/submission/${submissionId}`;
}

export function submissionSortKey(
  id: number,
  timingMap?: Map<number, SubmissionTiming>,
): number {
  const meta = timingMap?.get(id);
  if (!meta || typeof meta.submittedAt !== 'number' || typeof meta.contestStart !== 'number') return Number.POSITIVE_INFINITY;
  const offset = meta.submittedAt - meta.contestStart;
  return offset >= 0 ? offset : Number.POSITIVE_INFINITY;
}
