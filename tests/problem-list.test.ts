import test from 'node:test';
import assert from 'node:assert/strict';

import { PerformanceEngine } from '../src/domain/performanceEngine.ts';
import { filterFrictionProblems } from '../src/domain/friction.ts';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/domain/settings.ts';
import type { FrictionFilters } from '../src/domain/friction.ts';
import type { CodeforcesSubmission } from '../src/types/codeforces.ts';

const START = 1_700_000_000;
const DURATION = 7_200;

const contestMap = {
  900: { id: 900, name: 'Codeforces Round 900 (Div. 2)', startTimeSeconds: START, durationSeconds: DURATION },
  901: { id: 901, name: 'Codeforces Round 901 (Div. 2)', startTimeSeconds: START + 100_000, durationSeconds: DURATION },
};

function submission(
  id: number,
  contestId: number,
  index: string,
  verdict: string,
  at: number,
): CodeforcesSubmission {
  return {
    id,
    creationTimeSeconds: at,
    verdict,
    problem: { contestId, index, name: `P${index}`, tags: [] },
  } as unknown as CodeforcesSubmission;
}

/*
 * Contest 900 (in-contest): A solved first try, B one wrong then solved.
 * Contest 901 problem A (practice, long after it ended): solved first try.
 */
const engine = new PerformanceEngine({
  contestMap,
  rawSubmissions: [
    submission(1, 900, 'A', 'OK', START + 600),
    submission(2, 900, 'B', 'WRONG_ANSWER', START + 1_200),
    submission(3, 900, 'B', 'OK', START + 1_800),
    submission(4, 901, 'A', 'OK', START + 100_000 + DURATION + 5_000),
  ],
  ratedContestSet: new Set<number>(),
  userRatingHistory: [],
});

const NOW = START + 1_000_000;
const data = engine.recalc('total', 'all', NOW);

const noFilters: FrictionFilters = {
  hideAC: false,
  solvedOnly: false,
  hideTags: false,
  hideRatings: false,
  minWrongAttempts: 0,
  ratingMin: '',
  ratingMax: '',
  tagFilters: [],
};

test('problem list: in-contest problems solved without a wrong attempt are kept', () => {
  const pids = data.categoryRawProblems.Div2.map(problem => problem.pid).sort();

  assert.deepEqual(pids, ['900-A', '900-B']);
  assert.equal(data.categoryRawProblems.Div2.find(problem => problem.pid === '900-A')?.acIds.length, 1);
});

test('problem list: practice problems solved without a wrong attempt are kept', () => {
  assert.deepEqual(data.practiceRawProblems.map(problem => problem.pid), ['901-A']);
});

test('problem list: min wrong attempts 0 lists everything, 1 keeps only problems with a wrong attempt', () => {
  const problems = data.categoryRawProblems.Div2;

  assert.equal(filterFrictionProblems(problems, noFilters).length, 2);
  assert.deepEqual(
    filterFrictionProblems(problems, { ...noFilters, minWrongAttempts: 1 }).map(problem => problem.pid),
    ['900-B'],
  );
});

test('settings: min wrong attempts defaults to 0, and a value saved under the old name is not carried over', () => {
  assert.equal(DEFAULT_SETTINGS.minWrongAttempts, 0);
  assert.equal(normalizeSettings({}).minWrongAttempts, 0);
  assert.equal(normalizeSettings({ minAttempts: 1 } as never).minWrongAttempts, 0);
});

test('settings: a saved min wrong attempts is kept, never below 0', () => {
  assert.equal(normalizeSettings({ minWrongAttempts: 3 }).minWrongAttempts, 3);
  assert.equal(normalizeSettings({ minWrongAttempts: -2 }).minWrongAttempts, 0);
});

/* ---------- problems the list cannot hold ---------- */

const { omittedProblemsNote } = await import('../src/domain/panelNotices.ts');

function rawSubmission(id: number, problem: Record<string, unknown>, at: number): CodeforcesSubmission {
  return {
    id,
    creationTimeSeconds: at,
    verdict: 'OK',
    problem: { name: 'X', tags: [], ...problem },
  } as unknown as CodeforcesSubmission;
}

test('omitted problems: gym, unlisted-contest and contest-less problems are counted once each; listed ones are not', () => {
  const later = START + 100_000 + DURATION + 9_000;
  const withOthers = new PerformanceEngine({
    contestMap,
    rawSubmissions: [
      submission(1, 900, 'A', 'OK', START + 600),
      rawSubmission(10, { contestId: 100500, index: 'A' }, later),
      rawSubmission(11, { contestId: 100500, index: 'A' }, later + 10),
      rawSubmission(12, { contestId: 100500, index: 'B' }, later + 20),
      rawSubmission(13, { contestId: 777, index: 'C' }, later + 30),
      rawSubmission(14, { problemsetName: 'acmsguru', index: '100' }, later + 40),
    ],
    ratedContestSet: new Set<number>(),
    userRatingHistory: [],
  }).recalc('total', 'all', NOW);

  assert.deepEqual(withOthers.omittedProblems, { gym: 2, other: 2 });
  assert.deepEqual(withOthers.categoryRawProblems.Div2.map(problem => problem.pid), ['900-A']);
});

test('omitted problems: nothing is omitted when every submission is in a listed contest', () => {
  assert.deepEqual(data.omittedProblems, { gym: 0, other: 0 });
});

test('omitted problems note: wording, plural and nothing-to-say', () => {
  assert.equal(omittedProblemsNote({ gym: 0, other: 0 }), null);
  assert.equal(
    omittedProblemsNote({ gym: 1, other: 0 }),
    "Not included: 1 gym problem (outside Codeforces' regular contest list).",
  );
  assert.equal(
    omittedProblemsNote({ gym: 12, other: 3 }),
    "Not included: 12 gym and 3 other problems (outside Codeforces' regular contest list).",
  );
  assert.equal(
    omittedProblemsNote({ gym: 0, other: 2 }),
    "Not included: 2 other problems (outside Codeforces' regular contest list).",
  );
});
