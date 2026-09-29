import type { OnlineStatus } from '../domain/onlineTracker';

export interface PoolOptions {
  /* Checks one friend. Must resolve "unknown" (not throw) on any failure. */
  check: (handle: string, signal: AbortSignal) => Promise<OnlineStatus>;

  /* Called once per friend with the final result (after any retry). */
  onResult: (handle: string, status: OnlineStatus) => void;

  signal: AbortSignal;

  /* Most requests in flight at once. */
  maxConcurrency?: number;

  /* Extra attempts for a friend whose check came back unknown. */
  retries?: number;

  /* This many failed checks in a row (retries included) stops the run early. */
  breakerLimit?: number;

  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface PoolSummary {
  total: number;

  /* Friends with a final result (including final "unknown"). */
  done: number;

  /* Of those, how many never got a usable answer. */
  unknown: number;

  aborted: boolean;

  /* Stopped early because the server kept failing. */
  brokeCircuit: boolean;
}

interface Item {
  handle: string;
  attempt: number;
}

/*
 * Runs `check` over every handle with a sliding window of requests
 * (a new one starts the moment another finishes, so one slow reply
 * never stalls the rest).
 *
 * Failure handling:
 *  - a failed check is retried once, at the back of the queue;
 *  - 3 failures in a row halve the window and pause everything for
 *    an exponentially growing time;
 *  - 20 successes in a row widen the window again and ease the pause;
 *  - many failed checks in a row open a circuit breaker and end the
 *    run, instead of hammering a server that is not answering (retries
 *    count, so a dead server is noticed after a handful of requests,
 *    not after the whole queue has been tried once).
 */
export function checkHandles(
  handles: string[],
  options: PoolOptions,
): Promise<PoolSummary> {
  const {
    check,
    onResult,
    signal,
    maxConcurrency = 6,
    retries = 1,
    breakerLimit = 15,
    baseBackoffMs = 1_500,
    maxBackoffMs = 20_000,
  } = options;

  return new Promise(resolve => {
    const queue: Item[] = handles.map(handle => ({ handle, attempt: 0 }));
    const total = handles.length;

    let limit = maxConcurrency;
    let running = 0;
    let done = 0;
    let unknown = 0;
    let failuresInARow = 0;
    let rawFailuresInARow = 0;
    let successesInARow = 0;
    let backoffMs = 0;
    let pausedUntil = 0;
    let broke = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;

      if (timer !== null) {
        clearTimeout(timer);
      }

      signal.removeEventListener('abort', finish);

      resolve({
        total,
        done,
        unknown,
        aborted: signal.aborted,
        brokeCircuit: broke,
      });
    };

    const pump = () => {
      if (finished) {
        return;
      }

      if (signal.aborted) {
        finish();

        return;
      }

      if (broke) {
        if (running === 0) {
          finish();
        }

        return;
      }

      const wait = pausedUntil - Date.now();

      if (wait > 0) {
        if (timer !== null) {
          clearTimeout(timer);
        }

        timer = setTimeout(() => {
          timer = null;
          pump();
        }, wait);

        return;
      }

      while (running < limit && queue.length > 0) {
        start(queue.shift() as Item);
      }

      if (running === 0 && queue.length === 0) {
        finish();
      }
    };

    const settle = (item: Item, status: OnlineStatus) => {
      running -= 1;

      if (finished || signal.aborted) {
        pump();

        return;
      }

      if (status === 'unknown') {
        successesInARow = 0;
        failuresInARow += 1;
        rawFailuresInARow += 1;

        if (rawFailuresInARow >= breakerLimit) {
          broke = true;
        }

        if (item.attempt < retries) {
          queue.push({ handle: item.handle, attempt: item.attempt + 1 });
        } else {
          done += 1;
          unknown += 1;
          onResult(item.handle, 'unknown');
        }

        if (failuresInARow >= 3) {
          failuresInARow = 0;
          limit = Math.max(1, Math.floor(limit / 2));
          backoffMs =
            backoffMs === 0
              ? baseBackoffMs
              : Math.min(maxBackoffMs, backoffMs * 2);
          pausedUntil = Date.now() + backoffMs;
        }
      } else {
        failuresInARow = 0;
        rawFailuresInARow = 0;
        successesInARow += 1;
        done += 1;
        onResult(item.handle, status);

        if (successesInARow >= 20) {
          successesInARow = 0;
          limit = Math.min(maxConcurrency, limit + 1);
          backoffMs = Math.floor(backoffMs / 2);
        }
      }

      pump();
    };

    const start = (item: Item) => {
      running += 1;

      check(item.handle, signal).then(
        status => settle(item, status),
        () => settle(item, 'unknown'),
      );
    };

    signal.addEventListener('abort', finish, { once: true });

    if (total === 0 || signal.aborted) {
      finish();

      return;
    }

    pump();
  });
}
