import test from 'node:test';
import assert from 'node:assert/strict';

import { pickContestProblemInfo } from '../src/domain/contestProblemInfo.ts';
import type { CodeforcesContest, CodeforcesProblem } from '../src/types/codeforces.ts';

const contest = (name: string): CodeforcesContest => ({
  id: 2276,
  name,
  durationSeconds: 7200,
  startTimeSeconds: 0,
});

const problem = (index: string, name: string): CodeforcesProblem => ({
  index,
  name,
  tags: [],
});

test('matches the problem by index, case-insensitively', () => {
  const info = pickContestProblemInfo(
    contest('Educational Codeforces Round 195 (Rated for Div. 2)'),
    [problem('A', 'Easy'), problem('E', 'Good Substrings')],
    'e',
  );

  assert.deepEqual(info, {
    contestName: 'Educational Codeforces Round 195 (Rated for Div. 2)',
    problemName: 'Good Substrings',
  });
});

test('null when the index is not in the problem list', () => {
  assert.equal(
    pickContestProblemInfo(contest('Round'), [problem('A', 'Easy')], 'E'),
    null,
  );
});

test('null when the contest name is blank', () => {
  assert.equal(
    pickContestProblemInfo(contest('   '), [problem('A', 'Easy')], 'A'),
    null,
  );
});

test('null when the matched problem has a blank name', () => {
  assert.equal(
    pickContestProblemInfo(contest('Round'), [problem('A', '  ')], 'A'),
    null,
  );
});

test('trims surrounding whitespace in both names', () => {
  assert.deepEqual(
    pickContestProblemInfo(contest('  Round 1  '), [problem('A', '  Watermelon  ')], 'A'),
    { contestName: 'Round 1', problemName: 'Watermelon' },
  );
});
