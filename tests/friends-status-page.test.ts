import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

(globalThis as unknown as { window: EventTarget }).window = new EventTarget();

class FakeStorage implements Storage {
  data = new Map<string, string>();
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

const globalStore = new FakeStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = globalStore;

/*
 * The parser reads the page with DOMParser, which Node does not have.
 * jsdom (not a dependency of this project) stands in for it here; when it
 * is not installed the parser tests are skipped, not passed.
 */
let jsdomAvailable = false;

try {
  const { JSDOM } = await import('jsdom');
  const window = new JSDOM('').window;

  (globalThis as { DOMParser?: unknown }).DOMParser = window.DOMParser;
  jsdomAvailable = true;
} catch {
  jsdomAvailable = false;
}

const {
  FRIENDS_STATUS_ROW_LIMIT,
  clearFriendsStatusCache,
  friendsStatusUrl,
  loadFriendsOnProblem,
  parseFriendsStatusPage,
  planFriendScan,
} = await import('../src/services/friendsStatusPage.ts');

const { loadFriendContestSubmissions } = await import('../src/services/friendSubmissions.ts');
const { saveCachedSubmissions } = await import('../src/services/friendSubmissionsStore.ts');

import type { FriendSubmission } from '../src/domain/friendSubmissions.ts';

const parserTest = (name: string, fn: () => void | Promise<void>) =>
  test(name, { skip: jsdomAvailable ? false : 'jsdom is not installed' }, fn);

/* A real friends-only status page (problem 2269B), trimmed to the filter form, the table and the hidden pagination prototype; handles anonymised. */
const SAMPLE = readFileSync(new URL('./fixtures/friends-status-2269B.html', import.meta.url), 'utf8');

const sampleRow = (id: number, handle = 'someone') =>
  `<tr data-submission-id="${id}"><td class="id-cell"><a class="view-source" href="/problemset/submission/2269/${id}" submissionId="${id}">${id}</a></td>` +
  `<td class="status-party-cell" data-participantId="1"><a href="/profile/${handle}" class="rated-user user-gray">${handle}</a></td></tr>`;

const page = (rows: string, { checked = true, extra = '' } = {}) =>
  `<html><body><form action="" method="get" class="friendsEnabledSwitch"><label><input name="friends" type="checkbox"${checked ? ' checked' : ''}/></label></form>` +
  `<table class="status-frame-datatable"><tr class="first-row"><th>#</th></tr>${rows}</table>${extra}</body></html>`;

/* ---------- parsing the page ---------- */

parserTest('page: the real sample gives the six friends, each with the id of their submission', () => {
  const result = parseFriendsStatusPage(SAMPLE);

  assert.ok(result);
  assert.deepEqual(
    Array.from(result.keys()).sort(),
    ['friend_a', 'friend_b', 'friend_c', 'friend_d', 'friend_e', 'friend_f'],
  );
  assert.deepEqual(result.get('friend_a'), [393124353]);
  assert.deepEqual(result.get('friend_b'), [392285536]);
});

parserTest('page: the virtual participant (extra marker in the cell) is still read by profile link', () => {
  assert.deepEqual(parseFriendsStatusPage(SAMPLE)?.get('friend_c'), [392315993]);
});

parserTest('page: several submissions by one friend are grouped under the lower-cased handle', () => {
  const result = parseFriendsStatusPage(page(sampleRow(5, 'Ann') + sampleRow(9, 'ann') + sampleRow(7, 'Bob')));

  assert.deepEqual(result?.get('ann'), [5, 9]);
  assert.deepEqual(result?.get('bob'), [7]);
});

parserTest('page: friends filter not applied (checkbox not ticked, or missing) is not trusted', () => {
  assert.equal(parseFriendsStatusPage(page(sampleRow(1), { checked: false })), null);
  assert.equal(parseFriendsStatusPage('<html><body><table class="status-frame-datatable"></table></body></html>'), null);
  assert.equal(parseFriendsStatusPage('<html><title>Just a moment...</title></html>'), null);
});

parserTest('page: a ticked filter with no rows is a real empty answer', () => {
  const result = parseFriendsStatusPage(page(''));

  assert.ok(result);
  assert.equal(result.size, 0);
});

parserTest('page: a full-looking page may continue on another page, so it is not trusted', () => {
  const rows = Array.from({ length: FRIENDS_STATUS_ROW_LIMIT }, (_, i) => sampleRow(100 + i, `u${i}`)).join('');
  assert.equal(parseFriendsStatusPage(page(rows)), null);

  const fewer = Array.from({ length: FRIENDS_STATUS_ROW_LIMIT - 1 }, (_, i) => sampleRow(100 + i, `u${i}`)).join('');
  assert.equal(parseFriendsStatusPage(page(fewer))?.size, FRIENDS_STATUS_ROW_LIMIT - 1);
});

parserTest('page: real pagination markup means more pages; the hidden prototype does not', () => {
  assert.equal(
    parseFriendsStatusPage(page(sampleRow(1), { extra: '<div class="pagination"><ul><li><span class="page-index" pageIndex="1">1</span></li></ul></div>' })),
    null,
  );
  assert.equal(
    parseFriendsStatusPage(page(sampleRow(1), { extra: '<div class="pagination next-or-prev-prototype" style="display:none"></div>' }))?.size,
    1,
  );
});

parserTest('page: a row without a profile link (a team) makes the whole page untrusted', () => {
  const team = '<tr data-submission-id="3"><td class="status-party-cell"><a href="/team/55">Team</a></td></tr>';
  assert.equal(parseFriendsStatusPage(page(sampleRow(1) + team)), null);
});

parserTest('page: a bad submission id makes the page untrusted', () => {
  const bad = '<tr data-submission-id="abc"><td class="status-party-cell"><a href="/profile/x">x</a></td></tr>';
  assert.equal(parseFriendsStatusPage(page(bad)), null);
});

/* ---------- the request ---------- */

const PROBLEM = { contestId: 2269, index: 'B' };

function okResponse(body: string): Response {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
}

test('request: the url is the friends-only status page of the problem', () => {
  assert.equal(
    friendsStatusUrl(PROBLEM),
    'https://codeforces.com/problemset/status/2269/problem/B?friends=on',
  );
});

parserTest('request: one fetch with the login, answered once per account and problem inside the window', async () => {
  clearFriendsStatusCache();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let clock = 1_000;

  const options = {
    account: 'Me',
    now: () => clock,
    fetcher: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return okResponse(SAMPLE);
    },
  };

  const first = await loadFriendsOnProblem(PROBLEM, undefined, options);
  const second = await loadFriendsOnProblem(PROBLEM, undefined, options);

  assert.equal(first?.size, 6);
  assert.equal(second, first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, friendsStatusUrl(PROBLEM));
  assert.equal(calls[0].init.credentials, 'include');

  /* another account never gets this account's answer */
  await loadFriendsOnProblem(PROBLEM, undefined, { ...options, account: 'Other' });
  assert.equal(calls.length, 2);

  /* past the window it is asked again */
  clock += 3 * 60 * 1000;
  await loadFriendsOnProblem(PROBLEM, undefined, options);
  assert.equal(calls.length, 3);
});

test('request: no known account, an error status, a network error or an abort give null, and null is not remembered', async () => {
  clearFriendsStatusCache();
  let calls = 0;

  const failing = {
    account: 'Me',
    fetcher: async () => {
      calls += 1;
      return { ok: false, status: 403, text: async () => '' } as unknown as Response;
    },
  };

  assert.equal(await loadFriendsOnProblem(PROBLEM, undefined, { ...failing, account: null }), null);
  assert.equal(calls, 0, 'no account: nothing sent');

  assert.equal(await loadFriendsOnProblem(PROBLEM, undefined, failing), null);
  assert.equal(await loadFriendsOnProblem(PROBLEM, undefined, failing), null);
  assert.equal(calls, 2, 'a failure is asked again, not cached');

  const throwing = { account: 'Me', fetcher: async () => { throw new Error('offline'); } };
  assert.equal(await loadFriendsOnProblem(PROBLEM, undefined, throwing), null);

  const controller = new AbortController();
  controller.abort();
  assert.equal(await loadFriendsOnProblem(PROBLEM, controller.signal, failing), null);
  assert.equal(calls, 2, 'aborted: nothing sent');
});

test('request: a page that never answers is given up on after the timeout', async () => {
  clearFriendsStatusCache();

  const hanging = {
    account: 'Me',
    timeoutMs: 20,
    fetcher: (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  };

  assert.equal(await loadFriendsOnProblem(PROBLEM, undefined, hanging), null);
});

/* ---------- who is looked up ---------- */

test('plan: friends the page does not list are skipped; listed ones are looked up with their ids', () => {
  const answer = new Map([['ann', [5, 9]]]);
  const plan = planFriendScan(['Ann', 'bob', 'Cy'], answer);

  assert.deepEqual(plan.skip, ['bob', 'Cy']);
  assert.deepEqual(plan.scan, [{ handle: 'Ann', ids: [5, 9] }]);
});

test('plan: without a usable page every friend is looked up', () => {
  const plan = planFriendScan(['Ann', 'bob'], null);

  assert.deepEqual(plan.skip, []);
  assert.deepEqual(plan.scan, [{ handle: 'Ann', ids: [] }, { handle: 'bob', ids: [] }]);
});

test('plan: an empty page answer skips everyone', () => {
  const plan = planFriendScan(['Ann', 'bob'], new Map());

  assert.deepEqual(plan.scan, []);
  assert.deepEqual(plan.skip, ['Ann', 'bob']);
});

/* ---------- a stored copy must contain what the page showed ---------- */

const sub = (id: number): FriendSubmission => ({ id, index: 'B', createdAt: 1_000 + id });

test('stored copy: used when it has the ids the page showed, fetched again when it lacks one', async () => {
  globalStore.clear();
  const original = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return {
      status: 200,
      json: async () => ({ status: 'OK', result: [] }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const contestId = 930001;
    saveCachedSubmissions(contestId, 'ann', [sub(5), sub(9)], globalStore, Date.now());

    assert.deepEqual(await loadFriendContestSubmissions(contestId, 'ann', undefined, [5, 9]), [sub(5), sub(9)]);
    assert.equal(calls.length, 0, 'has both ids: no request');

    assert.deepEqual(await loadFriendContestSubmissions(contestId, 'ann', undefined, [5, 9, 11]), []);
    assert.equal(calls.length, 1, 'lacks id 11: asked again');
    assert.ok(calls[0].includes('handle=ann'));

    saveCachedSubmissions(contestId, 'bob', [sub(1)], globalStore, Date.now());
    await loadFriendContestSubmissions(contestId, 'bob');
    assert.equal(calls.length, 1, 'no ids asked for: the copy is used as before');
  } finally {
    globalThis.fetch = original;
  }
});
