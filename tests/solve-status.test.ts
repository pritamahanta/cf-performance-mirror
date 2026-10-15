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
  ],
  ratedContestSet: new Set<number>(),
  userRatingHistory: [],
}).recalc('total', 'all', AFTER + 1_000_000);

const byIndex = (list: { index: string }[], index: string) => list.find(problem => problem.index === index);

test('solve status: accepted during the contest is "contest", even if it was submitted again later', () => {
  const inContest = data.categoryRawProblems.Div2;

  assert.equal(solveStatus(byIndex(inContest, 'A')!), 'contest');
  assert.equal(solveStatus(byIndex(inContest, 'D')!), 'contest');
});

test('solve status: a wrong attempt in the contest and an accept only after it is "after"', () => {
  assert.equal(solveStatus(byIndex(data.categoryRawProblems.Div2, 'B')!), 'after');
});

test('solve status: never accepted is "unsolved"', () => {
  assert.equal(solveStatus(byIndex(data.categoryRawProblems.Div2, 'C')!), 'unsolved');
});

test('solve status: a problem first solved in practice after the contest is "after" in the practice list', () => {
  const practice = data.practiceRawProblems;

  assert.equal(solveStatus(byIndex(practice, 'E')!), 'after');
  assert.equal(solveStatus(byIndex(practice, 'B')!), 'after');
});

test('solve status: a practice-list problem that was accepted in the contest is "contest"', () => {
  /* D's later accept is in the practice list, but its first accept was during the contest. */
  assert.equal(solveStatus(byIndex(data.practiceRawProblems, 'D')!), 'contest');
});
