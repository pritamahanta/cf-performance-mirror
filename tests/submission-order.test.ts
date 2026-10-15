import test from 'node:test';
import assert from 'node:assert/strict';

import { sortSubmissionIds } from '../src/domain/friction.ts';

const START = 1_700_000_000;

/* id -> when it was made, as the engine records it. */
const timing = new Map([
  [11, { contestStart: START, submittedAt: START + 600 }],
  [12, { contestStart: START, submittedAt: START + 1_800 }],
  [13, { contestStart: START, submittedAt: START + 3_000 }],
  [21, { contestStart: START + 900_000, submittedAt: START + 900_000 + 300 }],
]);

test('submission order: newest first within a contest', () => {
  assert.deepEqual(sortSubmissionIds([12, 11, 13], timing), [13, 12, 11]);
});

test('submission order: ones made outside any contest (no timing) come first, newest id first', () => {
  assert.deepEqual(sortSubmissionIds([11, 40, 13, 41], timing), [41, 40, 13, 11]);
});

test('submission order: by contest, the latest contest first, then newest within it', () => {
  assert.deepEqual(sortSubmissionIds([11, 21, 12], timing, true), [21, 12, 11]);
});

test('submission order, ascending: the smallest time first within a contest', () => {
  assert.deepEqual(sortSubmissionIds([12, 11, 13], timing, false, true), [11, 12, 13]);
});

test('submission order, ascending: ones made outside any contest (no timing) come last, oldest id first', () => {
  assert.deepEqual(sortSubmissionIds([11, 40, 13, 41], timing, false, true), [11, 13, 40, 41]);
});

test('submission order, ascending: by contest, the oldest contest first', () => {
  assert.deepEqual(sortSubmissionIds([11, 21, 12], timing, true, true), [11, 12, 21]);
});

test('submission order, ascending is exactly the reverse of the default', () => {
  const ids = [13, 40, 11, 21, 12, 41];

  for (const byContest of [false, true]) {
    assert.deepEqual(
      sortSubmissionIds(ids, timing, byContest, true),
      sortSubmissionIds(ids, timing, byContest).reverse(),
    );
  }
});

test('submission order: works without any timing at all (newest id first) and does not change its input', () => {
  const ids = [3, 1, 2];

  assert.deepEqual(sortSubmissionIds(ids), [3, 2, 1]);
  assert.deepEqual(ids, [3, 1, 2]);
});
