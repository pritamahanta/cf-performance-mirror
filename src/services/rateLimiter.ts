/*
 * A token bucket: `capacity` requests may go out at once, after that
 * `refillPerSec` per second. take() never blocks; it tells the caller
 * how long to wait instead.
 */
export interface RateLimiter {
  /*
   * 0 means a token was taken and the request may start now.
   * A positive number is how many milliseconds to wait before asking
   * again; nothing is taken in that case.
   */
  take(): number;
}

export interface TokenBucketOptions {
  capacity: number;
  refillPerSec: number;
  now?: () => number;
}

export function createTokenBucket(options: TokenBucketOptions): RateLimiter {
  const { capacity, refillPerSec, now = Date.now } = options;

  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new RangeError('capacity must be a number >= 1');
  }

  if (!Number.isFinite(refillPerSec) || refillPerSec <= 0) {
    throw new RangeError('refillPerSec must be a number > 0');
  }

  let tokens = capacity;
  let last = now();

  return {
    take(): number {
      const current = now();
      /* A clock that jumps backwards must not refill or drain the bucket. */
      const elapsedSec = Math.max(0, current - last) / 1000;

      last = Math.max(last, current);
      tokens = Math.min(capacity, tokens + elapsedSec * refillPerSec);

      if (tokens >= 1) {
        tokens -= 1;

        return 0;
      }

      return Math.ceil(((1 - tokens) / refillPerSec) * 1000);
    },
  };
}
