import type { ProblemEntry } from '../types/performance';

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function totalErrors(problem: Pick<ProblemEntry, 'wa' | 'tle' | 'rte' | 'mle' | 'other'>): number {
  return (problem.wa || 0) + (problem.tle || 0) + (problem.rte || 0) + (problem.mle || 0) + (problem.other || 0);
}

export function getRatingColor(rating: number | null | undefined): string {
  if (!rating || rating < 1200) return '#808080';
  if (rating < 1400) return '#008000';
  if (rating < 1600) return '#03a89e';
  if (rating < 1900) return '#0000ff';
  if (rating < 2100) return '#aa00aa';
  if (rating < 2400) return '#ff8c00';
  if (rating < 3000) return '#ff0000';
  return '#cc0000';
}

/*
 * Codeforces colors every handle by rating tier
 * using these exact class names (confirmed live
 * on codeforces.com's own "Top contributors" box:
 * e.g. class="rated-user user-legendary" on
 * Legendary Grandmasters). Reusing them - instead
 * of a hand-picked hex value - means the handle
 * renders with Codeforces' own live stylesheet,
 * including its dark mode, rather than a guess.
 *
 * The API's "rank" field comes back lowercase
 * (e.g. "legendary grandmaster"), so compare
 * case-insensitively.
 */
export function getRatedUserClassName(rank: string | null | undefined): string {
  const normalized = (rank ?? '').trim().toLowerCase();

  if (normalized === 'legendary grandmaster') return 'rated-user user-legendary';
  if (normalized === 'international grandmaster' || normalized === 'grandmaster') return 'rated-user user-red';
  if (normalized === 'international master' || normalized === 'master') return 'rated-user user-orange';
  if (normalized === 'candidate master') return 'rated-user user-violet';
  if (normalized === 'expert') return 'rated-user user-blue';
  if (normalized === 'specialist') return 'rated-user user-cyan';
  if (normalized === 'pupil') return 'rated-user user-green';
  if (normalized === 'newbie') return 'rated-user user-gray';

  return '';
}

/*
 * Legendary Grandmasters get a two-tone handle on
 * Codeforces: the first letter wrapped in its own
 * <span class="legendary-user-first-letter">.
 */
export function isLegendaryRank(rank: string | null | undefined): boolean {
  return (rank ?? '').trim().toLowerCase() === 'legendary grandmaster';
}