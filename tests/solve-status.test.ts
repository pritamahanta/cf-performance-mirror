import test from 'node:test';
import assert from 'node:assert/strict';

import { PerformanceEngine } from '../src/domain/performanceEngine.ts';
import { solveStatus } from '../src/domain/friction.ts';
import type { CodeforcesSubmission } from '../src/types/codeforces.ts';

const START = 1_700_000_000;
const DURATION = 7_200;
const AFTER = START + DURATION + 50_000;

const contestMap = {
  900: { id: 900, name: 'Codeforces Round 900 (Div. 2)', startTimeSeconds: START, durationSeconds: DURATION },
};

function sub(id: number, index: string, verdict: string, at: number): CodeforcesSubmission {
  return {
    id,
    creationTimeSeconds: at,
    verdict,
    problem: { contestId: 900, index, name: `P${index}`, tags: [] },
  } as unknown as CodeforcesSubmission;
}

/*
 * A: accepted in the contest.
 * B: wrong in the contest, accepted after it.
 * C: wrong in the contest, never accepted.
 * D: accepted in the contest, accepted again after it.
 * E: never touched in the contest, accepted after it (practice).
 * F: accepted in the contest, then a wrong one after it.
 * G: wrong in the contest and wrong after it, never accepted.
 */
const data = new PerformanceEngine({
  contestMap,
  rawSubmissions: [
    sub(1, 'A', 'OK', START + 600),
    sub(2, 'B', 'WRONG_ANSWER', START + 900),
    sub(3, 'B', 'OK', AFTER),
    sub(4, 'C', 'WRONG_ANSWER', START + 1_200),
    sub(5, 'D', 'OK', START + 1_500),
    sub(6, 'D', 'OK', AFTER + 10),
    sub(7, 'E', 'OK', AFTER + 20),
    sub(8, 'F', 'OK', START + 1_800),
    sub(9, 'F', 'WRONG_ANSWER', AFTER + 30),
    sub(10, 'G', 'WRONG_ANSWER', START + 2_000),
    sub(11, 'G', 'WRONG_ANSWER', AFTER + 40),
  ],
  ratedContestSet: new Set<number>(),
  userRatingHistory: [],
}).recalc('total', 'all', AFTER + 1_000_000);

const inContest = data.categoryRawProblems.Div2;
const practice = data.practiceRawProblems;
const byIndex = (list: { index: string }[], index: string) => list.find(problem => problem.index === index);

test('solve status: accepted during the contest is "solved", even if it was submitted again later', () => {
  assert.equal(solveStatus(byIndex(inContest, 'A')!), 'solved');
  assert.equal(solveStatus(byIndex(inContest, 'D')!), 'solved');
});

test('solve status: tried in the contest, not accepted then, accepted after it is "upsolved"', () => {
  assert.equal(solveStatus(byIndex(inContest, 'B')!), 'upsolved');
});

test('solve status: a problem first tried in practice and solved there is just "solved", not an upsolve', () => {
  assert.equal(solveStatus(byIndex(practice, 'E')!), 'solved');
});

test('solve status: never accepted is "unsolved"', () => {
  assert.equal(solveStatus(byIndex(inContest, 'C')!), 'unsolved');
  assert.equal(solveStatus(byIndex(inContest, 'G')!), 'unsolved');
});

test('lists: every problem touched during the contest is In-contest, the rest are Practice', () => {
  assert.deepEqual(inContest.map(problem => problem.index).sort(), ['A', 'B', 'C', 'D', 'F', 'G']);
  assert.deepEqual(practice.map(problem => problem.index), ['E']);
});

test('lists: an In-contest problem carries all its submissions, during the contest or after, right or wrong', () => {
  const b = byIndex(inContest, 'B')!;
  assert.deepEqual([b.acIds, b.waIds], [[3], [2]]);

  const d = byIndex(inContest, 'D')!;
  assert.deepEqual(d.acIds.slice().sort((x, y) => x - y), [5, 6]);

  const f = byIndex(inContest, 'F')!;
  assert.deepEqual([f.acIds, f.waIds], [[8], [9]]);
  assert.equal(f.wa, 1);

  const g = byIndex(inContest, 'G')!;
  assert.deepEqual(g.waIds.slice().sort((x, y) => x - y), [10, 11]);
  assert.equal(g.wa, 2);
});

test('lists: no submission is counted twice', () => {
  const ids = inContest.flatMap(problem => [
    ...problem.acIds, ...problem.waIds, ...problem.tleIds, ...problem.rteIds, ...problem.mleIds, ...problem.otherIds,
  ]);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 10);
});
