import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LISTS,
  MAX_PROBLEMS_PER_LIST,
  listNameFromFile,
  normalizeStoredLists,
  parseProblemListText,
  parseProblemMetadata,
} from '../src/domain/problemLists.ts';
import { getFrictionProblems } from '../src/domain/friction.ts';
import { PerformanceEngine } from '../src/domain/performanceEngine.ts';
import {
  PROBLEM_LISTS_KEY,
  loadProblemLists,
  saveProblemLists,
} from '../src/services/problemListStore.ts';
import type { CodeforcesSubmission } from '../src/types/codeforces.ts';
import type { ModeData } from '../src/types/performance.ts';

class FakeStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

/* ---------- parsing ---------- */

test('parse: links in every Codeforces form, and plain ids', () => {
  const text = [
    'https://codeforces.com/problemset/problem/4/A',
    'https://codeforces.com/contest/1234/problem/B1?locale=en',
    'https://codeforces.com/gym/102345/problem/C',
    '4-D',
    '5/e',
    '6 F',
    '1700g',
  ].join('\n');

  assert.deepEqual(parseProblemListText(text).pids, [
    '4-A',
    '1234-B1',
    '102345-C',
    '4-D',
    '5-E',
    '6-F',
    '1700-G',
  ]);
});

test('parse: CSV, TSV and markdown rows, header and comments', () => {
  const text = [
    '# my sheet',
    'rank,name,link,rating',
    '1,Watermelon,https://codeforces.com/problemset/problem/4/A,800',
    '2\tTheatre Square\t1A\t1000',
    '| 3 | [Way Too Long](https://codeforces.com/contest/71/problem/A) |',
    '"231A",Team,800',
  ].join('\n');

  const parsed = parseProblemListText(text);

  assert.deepEqual(parsed.pids, ['4-A', '1-A', '71-A', '231-A']);
  assert.equal(parsed.ignored, 1, 'only the header line holds no problem');
});

test('parse: a submission link or a bare number is not a problem', () => {
  const parsed = parseProblemListText(
    ['https://codeforces.com/contest/1234/submission/99999', '800', 'hello', '0A', '9999999A'].join('\n'),
  );

  assert.deepEqual(parsed.pids, []);
  assert.equal(parsed.ignored, 5);
});

test('parse: duplicates are dropped and the first position wins', () => {
  assert.deepEqual(parseProblemListText('1A\n2B\n1a\nhttps://codeforces.com/contest/2/problem/B').pids, ['1-A', '2-B']);
});

test('parse: JSON arrays of strings, objects and a problems key', () => {
  assert.deepEqual(parseProblemListText('["1A", "https://codeforces.com/contest/2/problem/B"]').pids, ['1-A', '2-B']);

  assert.deepEqual(
    parseProblemListText('[{"contestId": 3, "index": "c"}, {"contestId": "4", "index": "D"}, {"problem": {"contestId": 5, "index": "E"}}, {"url": "6F"}, 7, null, {"contestId": 1}]').pids,
    ['3-C', '4-D', '5-E', '6-F'],
  );

  const wrapped = parseProblemListText('{"name": "x", "problems": ["8A", {"contestId": 9, "index": "B"}]}');

  assert.deepEqual(wrapped.pids, ['8-A', '9-B']);
  assert.equal(wrapped.ignored, 0);
  assert.deepEqual(parseProblemListText('[1A, 2B]').pids, ['1-A'], 'invalid JSON is read as text: one problem per line');
});

test('parse: a byte order mark and Windows line endings are harmless', () => {
  assert.deepEqual(parseProblemListText('﻿1A\r\n2B\r\n').pids, ['1-A', '2-B']);
});

test('parse: empty input and non-list JSON give no problems and never throw', () => {
  assert.deepEqual(parseProblemListText('').pids, []);
  assert.deepEqual(parseProblemListText('{"a": 1}').pids, []);
  assert.deepEqual(parseProblemListText('[').pids, []);
});

test('parse: more than the limit is cut and flagged', () => {
  const lines = Array.from({ length: MAX_PROBLEMS_PER_LIST + 5 }, (_, i) => `${i + 1}A`).join('\n');
  const parsed = parseProblemListText(lines);

  assert.equal(parsed.pids.length, MAX_PROBLEMS_PER_LIST);
  assert.equal(parsed.truncated, true);
  assert.equal(parseProblemListText('1A\n2A').truncated, false);
});

test('list name comes from the file name', () => {
  assert.equal(listNameFromFile('CP-31 sheet.csv'), 'CP-31 sheet');
  assert.equal(listNameFromFile('.json'), 'Imported list');
  assert.equal(listNameFromFile(`${'x'.repeat(100)}.txt`).length, 60);
});

/* ---------- problemset metadata ---------- */

test('metadata: only the wanted problems, only well-formed entries', () => {
  const result = {
    problems: [
      { contestId: 4, index: 'A', name: 'Watermelon', rating: 800, tags: ['math', 5, 'brute force'] },
      { contestId: 5, index: 'A', name: 'Not wanted', tags: [] },
      { contestId: 6, index: 'A', name: 'No rating' },
      { contestId: '7', index: 'A', name: 'Bad id', tags: [] },
      { contestId: 8, index: 'A', tags: [] },
      null,
    ],
  };

  assert.deepEqual(parseProblemMetadata(result, new Set(['4-A', '6-A', '7-A', '8-A'])), {
    '4-A': { name: 'Watermelon', rating: 800, tags: ['math', 'brute force'] },
    '6-A': { name: 'No rating', rating: null, tags: [] },
  });

  assert.deepEqual(parseProblemMetadata(undefined, new Set(['4-A'])), {});
  assert.deepEqual(parseProblemMetadata({ problems: 'x' }, new Set(['4-A'])), {});
});

/* ---------- storage ---------- */

const goodList = {
  id: 'abc',
  name: 'Sheet',
  pids: ['1-A', '2-B'],
  meta: { '1-A': { name: 'One', rating: 800, tags: ['math'] }, '9-Z': { name: 'stray', rating: null, tags: [] } },
};

test('store: round trip, and a meta entry for a problem not in the list is dropped', () => {
  const storage = new FakeStorage();

  assert.equal(saveProblemLists(storage, [goodList]), true);

  assert.deepEqual(loadProblemLists(storage), [
    { id: 'abc', name: 'Sheet', pids: ['1-A', '2-B'], meta: { '1-A': goodList.meta['1-A'] } },
  ]);
});

test('store: saving no lists clears the key', () => {
  const storage = new FakeStorage();

  saveProblemLists(storage, [goodList]);
  saveProblemLists(storage, []);

  assert.equal(storage.getItem(PROBLEM_LISTS_KEY), null);
});

test('store: a failing or missing storage is reported, not thrown', () => {
  const full = new FakeStorage();
  full.setItem = () => {
    throw new Error('quota');
  };

  assert.equal(saveProblemLists(full, [goodList]), false);
  assert.equal(saveProblemLists(null, [goodList]), false);
  assert.deepEqual(loadProblemLists(null), []);
});

test('store: corrupted or tampered data is dropped list by list', () => {
  const storage = new FakeStorage();

  storage.setItem(PROBLEM_LISTS_KEY, '{not json');
  assert.deepEqual(loadProblemLists(storage), []);

  const bad = [
    { ...goodList, id: 'dup' },
    { ...goodList, id: 'dup' },
    { ...goodList, id: 'p1', pids: ['1-A', '1-A'] },
    { ...goodList, id: 'p2', pids: ['<img>'] },
    { ...goodList, id: 'p3', pids: [] },
    { ...goodList, id: 'p4', name: '' },
    { ...goodList, id: 'p5', meta: [] },
    { ...goodList, id: 'ok', meta: { '1-A': { name: 5, rating: 1, tags: [] }, '2-B': { name: 'Two', rating: 'x', tags: [] } } },
  ];

  const kept = normalizeStoredLists({ lists: bad });

  assert.deepEqual(kept.map(list => list.id), ['dup', 'ok']);
  assert.deepEqual(kept[1].meta, {}, 'malformed meta entries are dropped');
});

test('store: no more than the maximum number of lists is read', () => {
  const many = Array.from({ length: MAX_LISTS + 3 }, (_, i) => ({ ...goodList, id: `l${i}` }));

  assert.equal(normalizeStoredLists({ lists: many }).length, MAX_LISTS);
});

/* ---------- the user's submissions on a list's problems ---------- */

const START = 1_700_000_000;
const DURATION = 7_200;
const AFTER = START + DURATION + 50_000;

function sub(id: number, contestId: number, index: string, verdict: string | undefined, at: number, extra: Record<string, unknown> = {}): CodeforcesSubmission {
  return {
    id,
    creationTimeSeconds: at,
    verdict,
    problem: { contestId, index, name: `P${contestId}${index}`, rating: 1000, tags: ['dp'], ...extra },
  } as unknown as CodeforcesSubmission;
}

const engine = new PerformanceEngine({
  contestMap: { 900: { id: 900, name: 'Round 900', startTimeSeconds: START, durationSeconds: DURATION } },
  rawSubmissions: [
    sub(10, 900, 'A', 'OK', START + 100),
    sub(11, 900, 'B', 'WRONG_ANSWER', START + 200),
    sub(12, 900, 'B', 'TIME_LIMIT_EXCEEDED', START + 300),
    sub(13, 900, 'B', 'OK', AFTER),
    sub(14, 900, 'C', 'RUNTIME_ERROR', AFTER),
    sub(15, 900, 'C', undefined, AFTER),
    sub(16, 900, 'D', 'OK', AFTER),
    sub(17, 100500, 'A', 'MEMORY_LIMIT_EXCEEDED', AFTER, { rating: undefined, tags: [] }),
    sub(18, 901, 'A', 'OK', AFTER),
  ],
  ratedContestSet: new Set<number>(),
  userRatingHistory: [],
});

test('list entries: one per wanted problem in the given order, ignoring other problems', () => {
  const entries = engine.entriesForPids(['900-D', '900-A', '902-A'], () => undefined);

  assert.deepEqual(entries.map(entry => entry.pid), ['900-D', '900-A', '902-A']);
});

test('list entries: solved status, in-contest flags and verdict counts come from every submission', () => {
  const byPid = Object.fromEntries(
    engine.entriesForPids(['900-A', '900-B', '900-C', '900-D', '100500-A'], () => undefined).map(entry => [entry.pid, entry]),
  );

  assert.equal(byPid['900-A'].solved, true);
  assert.equal(byPid['900-A'].solvedInContest, true);

  assert.equal(byPid['900-B'].solved, true);
  assert.equal(byPid['900-B'].solvedInContest, false);
  assert.equal(byPid['900-B'].attemptedInContest, true);
  assert.deepEqual([byPid['900-B'].wa, byPid['900-B'].tle], [1, 1]);
  assert.deepEqual(byPid['900-B'].acIds, [13]);

  assert.equal(byPid['900-C'].solved, false);
  assert.deepEqual([byPid['900-C'].rte, byPid['900-C'].other], [1, 1], 'a submission without a verdict counts as other');

  assert.equal(byPid['900-D'].attemptedInContest, false);
  assert.equal(byPid['900-D'].solved, true);

  assert.equal(byPid['100500-A'].mle, 1);
  assert.equal(byPid['100500-A'].contestName, 'Contest 100500', 'a contest outside the regular list gets a plain name');
});

test('list entries: a problem never submitted is listed unsolved, named from the fallback', () => {
  const [entry] = engine.entriesForPids(['902-A'], pid => ({ name: `Known ${pid}`, rating: 1500, tags: ['math'] }));

  assert.equal(entry.name, 'Known 902-A');
  assert.equal(entry.rating, 1500);
  assert.deepEqual(entry.tags, ['math']);
  assert.equal(entry.solved, false);
  assert.deepEqual(entry.acIds, []);

  const [unknown] = engine.entriesForPids(['902-A'], () => ({ name: '', rating: null, tags: [] }));

  assert.equal(unknown.name, '902-A', 'an unknown problem shows its id');
  assert.equal(unknown.rating, null);
});

test('list entries: a submitted problem takes its details from the submission, not the fallback', () => {
  const [entry] = engine.entriesForPids(['900-A'], () => ({ name: 'Other', rating: 3000, tags: ['x'] }));

  assert.equal(entry.name, 'P900A');
  assert.equal(entry.rating, 1000);
  assert.deepEqual(entry.tags, ['dp']);
});

test('the list source is not filled from the contest data', () => {
  const empty = { categoryRawProblems: { Div2: [{}] }, practiceRawProblems: [{}] } as unknown as ModeData;

  assert.deepEqual(getFrictionProblems(empty, 'Div2', 'list'), []);
  assert.equal(getFrictionProblems(empty, 'Div2', 'practice').length, 1);
  assert.equal(getFrictionProblems(empty, 'Div2', 'category').length, 1);
});
