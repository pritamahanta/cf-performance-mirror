import type { CodeforcesApiResponse } from '../types/codeforces';

/*
 * Serial, rate-aware client for Codeforces API calls that are made
 * in bulk (one per online friend).
 *
 * The API docs state a limit of one request per two seconds, and
 * answer excess calls with status FAILED / "Call limit exceeded".
 * In practice bursts are often tolerated, so the client starts fast
 * (a short gap between calls) and only if the limit is actually hit
 * does it switch, for the rest of the page's life, to the documented
 * pace and retry the call that was rejected.
 *
 * Calls never overlap: they run strictly one after another in the
 * order they were queued.
 *
 * A call can be given an AbortSignal. One that is aborted before its
 * turn comes is dropped without sending anything (and without
 * consuming a pacing slot), and the signal is passed on to
 * `fetchJson` so a request already on the wire is cancelled too.
 */

export class CodeforcesApiError extends Error {
  readonly callLimit: boolean;

  constructor(message: string, callLimit = false) {
    super(message);
    this.name = 'CodeforcesApiError';
    this.callLimit = callLimit;
  }
}

export interface PacedApiOptions {
  /* Performs one request and returns the parsed JSON body. */
  fetchJson: (path: string, signal?: AbortSignal) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fastGapMs?: number;
  slowGapMs?: number;
  maxAttempts?: number;
}

export interface PacedApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
}

const CALL_LIMIT_PATTERN = /call limit exceeded/i;

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Request aborted');
}

function isApiResponse(value: unknown): value is CodeforcesApiResponse<unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { status?: unknown }).status === 'string'
  );
}

export function createPacedApiClient({
  fetchJson,
  sleep = defaultSleep,
  now = Date.now,
  fastGapMs = 350,
  // Slightly above the documented 2s so clock jitter can't trip it.
  slowGapMs = 2100,
  maxAttempts = 4,
}: PacedApiOptions): PacedApiClient {
  let gapMs = fastGapMs;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let tail: Promise<unknown> = Promise.resolve();

  async function run<T>(path: string, signal?: AbortSignal): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      if (signal?.aborted) {
        throw abortError(signal);
      }

      const wait = lastStartedAt + gapMs - now();

      if (wait > 0) {
        await sleep(wait);
      }

      /* Aborted while waiting for its slot: send nothing. */
      if (signal?.aborted) {
        throw abortError(signal);
      }

      lastStartedAt = now();

      const body = await fetchJson(path, signal);

      if (!isApiResponse(body)) {
        throw new CodeforcesApiError('Unexpected Codeforces API response');
      }

      if (body.status === 'OK') {
        return body.result as T;
      }

      const comment = body.comment ?? '';

      if (CALL_LIMIT_PATTERN.test(comment)) {
        gapMs = slowGapMs;

        if (attempt < maxAttempts) {
          continue;
        }

        throw new CodeforcesApiError('Codeforces call limit exceeded', true);
      }

      throw new CodeforcesApiError(
        comment || 'Codeforces API returned FAILED',
      );
    }
  }

  return {
    get<T>(path: string, signal?: AbortSignal): Promise<T> {
      const result = tail.then(() => run<T>(path, signal));

      // A failed call must not block the calls queued behind it.
      tail = result.catch(() => undefined);

      return result;
    },
  };
}
