import { useEffect, useState } from 'react';
import { fetchProblemSolvedCounts } from '../services/codeforcesApi';
import {
  createSolvedCountsLoader,
  type SolvedCounts,
} from '../services/solvedCountsStore';

/* One loader for the whole page, so reopening the panel never repeats a request. */
const loadSolvedCounts = createSolvedCountsLoader({
  getStorage: () => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  },
  fetcher: fetchProblemSolvedCounts,
  now: () => Date.now(),
});

/* null while loading; afterwards the map (empty when Codeforces gave nothing). */
export function useProblemSolvedCounts(): SolvedCounts | null {
  const [counts, setCounts] = useState<SolvedCounts | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadSolvedCounts().then(result => {
      if (!cancelled) setCounts(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
}
