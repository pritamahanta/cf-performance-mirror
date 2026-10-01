import test from 'node:test';
import assert from 'node:assert/strict';

import { createTokenBucket } from '../src/services/rateLimiter.ts';

function clock(start = 1_000_000) {
  let t = start;

  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (value: number) => {
      t = value;
    },
  };
}

test('allows a burst, then tells the caller how long to wait', () => {
  const c = clock();
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 10, now: c.now });

  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 100);
});

test('refills over time and never above capacity', () => {
  const c = clock();
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 10, now: c.now });

  for (let i = 0; i < 3; i += 1) bucket.take();

  c.advance(250);
  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 50);

  c.advance(60_000);
  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 0);
  assert.equal(bucket.take(), 0);
  assert.ok(bucket.take() > 0);
});

test('a refused take() consumes nothing', () => {
  const c = clock();
  const bucket = createTokenBucket({ capacity: 1, refillPerSec: 2, now: c.now });

  assert.equal(bucket.take(), 0);

  const first = bucket.take();
  const second = bucket.take();

  assert.ok(first > 0);
  assert.equal(second, first);

  c.advance(first);
  assert.equal(bucket.take(), 0);
});

test('a clock that goes backwards neither refills nor breaks the bucket', () => {
  const c = clock();
  const bucket = createTokenBucket({ capacity: 2, refillPerSec: 10, now: c.now });

  bucket.take();
  bucket.take();

  c.set(c.now() - 5_000);
  assert.ok(bucket.take() > 0);

  /* Time moves forward again from the earliest point seen; no giant refill. */
  c.set(c.now() + 5_000 + 100);
  assert.equal(bucket.take(), 0);
  assert.ok(bucket.take() > 0);
});

test('invalid options throw RangeError', () => {
  assert.throws(() => createTokenBucket({ capacity: 0, refillPerSec: 1 }), RangeError);
  assert.throws(() => createTokenBucket({ capacity: 0.5, refillPerSec: 1 }), RangeError);
  assert.throws(() => createTokenBucket({ capacity: 1, refillPerSec: 0 }), RangeError);
  assert.throws(() => createTokenBucket({ capacity: 1, refillPerSec: -2 }), RangeError);
  assert.throws(() => createTokenBucket({ capacity: Number.NaN, refillPerSec: 1 }), RangeError);
});
