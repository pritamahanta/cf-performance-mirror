/*
 * "Solved by" figures: how many Codeforces users have solved each problem.
 *
 * They come from the public `problemset.problems` method, which returns the
 * problems together with a `problemStatistics` list (one entry per problem,
 * carrying contestId, index and solvedCount). This keeps only that figure,
 * keyed the same way as ProblemEntry.pid ("<contestId>-<index>"), so the map
 * stays small enough to cache. Anything that does not look like a statistics
 * entry is skipped instead of trusted.
 */
export function parseSolvedCounts(result: unknown): Record<string, number> {
  const counts: Record<string, number> = {};

  const statistics = (result as { problemStatistics?: unknown } | null | undefined)?.problemStatistics;

  if (!Array.isArray(statistics)) {
    return counts;
  }

  for (const entry of statistics) {
    if (!entry || typeof entry !== 'object') continue;

    const { contestId, index, solvedCount } = entry as Record<string, unknown>;

    if (
      typeof contestId === 'number' &&
      Number.isInteger(contestId) &&
      typeof index === 'string' &&
      index !== '' &&
      typeof solvedCount === 'number' &&
      Number.isFinite(solvedCount) &&
      solvedCount >= 0
    ) {
      counts[`${contestId}-${index}`] = solvedCount;
    }
  }

  return counts;
}
