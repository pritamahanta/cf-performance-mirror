/*
 * Gives a promise a deadline.
 *
 * Rejects when `ms` pass or when `signal` aborts, whichever comes
 * first, even if the underlying work never settles or ignores its own
 * abort signal (a stalled connection, a background worker that never
 * answers). The original promise is left to finish on its own and its
 * outcome is dropped, so a late result or a late failure is harmless.
 *
 * `ms` <= 0 means no time limit (the abort signal still applies).
 */
export class DeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeadlineError';
  }
}

export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
  label = 'Request',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const finish = (action: () => void) => {
      if (finished) {
        return;
      }

      finished = true;

      if (timer !== null) {
        clearTimeout(timer);
      }

      signal?.removeEventListener('abort', onAbort);
      action();
    };

    const onAbort = () => {
      finish(() => reject(new DeadlineError(`${label} aborted.`)));
    };

    if (signal?.aborted) {
      /* Still observe the promise so a later rejection is not "unhandled". */
      promise.catch(() => undefined);
      reject(new DeadlineError(`${label} aborted.`));

      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    if (ms > 0) {
      timer = setTimeout(() => {
        timer = null;
        finish(() => reject(new DeadlineError(`${label} timed out after ${Math.round(ms / 1000)}s.`)));
      }, ms);
    }

    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}
