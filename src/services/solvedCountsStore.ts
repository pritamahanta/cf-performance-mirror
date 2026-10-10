import { parseSolvedCounts } from '../domain/solvedCounts';

export const SOLVED_COUNTS_KEY = 'cfpm_solved_counts_v1';

/* A problem's solved-by figure moves slowly, so a day-old copy is fine. */
export const SOLVED_COUNTS_TTL_MS = 24 * 60 * 60 * 1000;

/* After a failed request, do not ask again for this long (the panel can be reopened any time). */
export const SOLVED_COUNTS_RETRY_MS = 60_000;

export type SolvedCounts = Record<string, number>;

interface Stored {
  t: number;
  c: SolvedCounts;
}

interface Deps {
  /* Resolved on every use: storage can be unavailable (private window, blocked site data). */
  getStorage: () => Storage | null;
  fetcher: () => Promise<SolvedCounts>;
  now: () => number;
}

function readStored(storage: Storage | null): Stored | null {
  try {
    const raw = storage?.getItem(SOLVED_COUNTS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Stored> | null;

    if (
      parsed &&
      typeof parsed.t === 'number' &&
      parsed.c &&
      typeof parsed.c === 'object' &&
      !Array.isArray(parsed.c) &&
      Object.keys(parsed.c).length > 0
    ) {
      return { t: parsed.t, c: parsed.c };
    }
  } catch {
    /* Unreadable cache: treated as no cache. */
  }

  return null;
}

/*
 * Loads the solved-by figures once and shares them: a fresh cached copy is
 * used without any request; otherwise one request is made (concurrent callers
 * share it) and the result is cached. If the request fails, the last cached
 * copy is used even when old, and with none the result is an empty map - the
 * table then simply shows no figure. A failure is not retried for a minute.
 */
export function createSolvedCountsLoader(deps: Deps): () => Promise<SolvedCounts> {
  let inflight: Promise<SolvedCounts> | null = null;
  let failedAt = Number.NEGATIVE_INFINITY;

  return () => {
    const cached = readStored(deps.getStorage());
    const now = deps.now();

    if (cached && now - cached.t >= 0 && now - cached.t < SOLVED_COUNTS_TTL_MS) {
      return Promise.resolve(cached.c);
    }

    if (inflight) return inflight;

    if (now - failedAt < SOLVED_COUNTS_RETRY_MS) {
      return Promise.resolve(cached?.c ?? {});
    }

    inflight = deps
      .fetcher()
      .then(counts => {
        if (Object.keys(counts).length === 0) {
          throw new Error('empty');
        }

        try {
          deps.getStorage()?.setItem(SOLVED_COUNTS_KEY, JSON.stringify({ t: deps.now(), c: counts } satisfies Stored));
        } catch {
          /* Quota or blocked storage: the figures still show this time. */
        }

        return counts;
      })
      .catch(() => {
        failedAt = deps.now();
        return cached?.c ?? {};
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  };
}

export { parseSolvedCounts };
