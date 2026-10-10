import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchOnlineFriends } from '../src/services/codeforcesApi.ts';
import { OnlineFriendsPoller } from '../src/services/onlinePoller.ts';
import type { PollerApi, PollerState, Visibility } from '../src/services/onlinePoller.ts';
import type { OnlineStatus } from '../src/domain/onlineTracker.ts';
import {
  INCOMPLETE_NOTE,
  NONE_ONLINE_MESSAGE,
  NO_FRIENDS_MESSAGE,
  SLOW_SCAN_NOTE,
  SUBMISSIONS_LOADING_MESSAGE,
  emptyListMessage,
  failedNote,
  listNotes,
  noSubmissionsMessage,
  submissionsLoadingMessage,
} from '../src/domain/panelNotices.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const realFetch = globalThis.fetch;
const realDomParser = (globalThis as { DOMParser?: unknown }).DOMParser;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { DOMParser?: unknown }).DOMParser = realDomParser;
});

/* A friends page with no friends table, with or without the logged-in header link. */
function installPageWithoutFriends(loggedIn: boolean) {
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString() {
      return {
        querySelectorAll: () => [],
        querySelector: (selector: string) =>
          loggedIn && selector === '.lang-chooser a[href^="/profile/"]'
            ? { getAttribute: () => '/profile/me' }
            : null,
      };
    }
  };
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;
}

test('friends page: logged in with no friends is an empty list, not an error', async () => {
  installPageWithoutFriends(true);
  assert.deepEqual(await fetchOnlineFriends(undefined, 10_000), []);
});

test('friends page: no friends table while logged out is still the login error', async () => {
  installPageWithoutFriends(false);
  await assert.rejects(fetchOnlineFriends(undefined, 10_000), /logged in/);
});

test('friends page: a table with no profile links, logged in, is an empty list', async () => {
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString() {
      const emptyTable = { querySelectorAll: () => [] };
      return {
        querySelectorAll: (selector: string) => (selector === 'table' ? [emptyTable] : []),
        querySelector: () => ({ getAttribute: () => '/profile/me' }),
      };
    }
  };
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;
  assert.deepEqual(await fetchOnlineFriends(undefined, 10_000), []);
});

test('friends page: a page that cannot be inspected for a login stays an error', async () => {
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString() {
      return { querySelectorAll: () => [] };
    }
  };
  globalThis.fetch = (async () => new Response('<html></html>', { status: 200 })) as typeof fetch;
  await assert.rejects(fetchOnlineFriends(undefined, 10_000), /friends table/);
});

function fakeVisibility(): Visibility {
  return { isHidden: () => false, subscribe: () => () => undefined };
}

const FAST = {
  requestsPerSecond: 0,
  intervalMs: 60,
  maxBackoffMs: 300,
  progressAfterMs: 20,
  flushMs: 5,
  infoGapMs: 1,
  minManualGapMs: 10,
  maxFullScanGapMs: 500,
  poolBaseBackoffMs: 5,
  poolMaxBackoffMs: 20,
};

function api(friends: () => Promise<string[]>, latencyMs = 1): PollerApi {
  return {
    fetchFriends: friends,
    checkProfile: async (): Promise<OnlineStatus> => {
      await sleep(latencyMs);
      return 'offline';
    },
    fetchInfo: async handles => handles.map(handle => ({ handle, rating: 1200, rank: 'pupil' })),
  };
}

async function waitFor(poller: OnlineFriendsPoller, pred: (s: PollerState) => boolean, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred(poller.getState())) return poller.getState();
    await sleep(5);
  }
  throw new Error(`timeout; state was ${JSON.stringify(poller.getState())}`);
}

test('poller: zero friends is a ready, empty state flagged noFriends, never an error', async () => {
  const poller = new OnlineFriendsPoller(api(async () => []), fakeVisibility(), FAST);
  poller.start();
  const s = await waitFor(poller, s => s.status === 'ready');
  assert.ok(s.status === 'ready');
  assert.equal(s.friends.length, 0);
  assert.equal(s.noFriends, true);
  await sleep(200);
  assert.equal(poller.getState().status, 'ready', 'later cycles stay ready');
  poller.stop();
});

test('poller: friends who are all offline is NOT flagged noFriends', async () => {
  const poller = new OnlineFriendsPoller(api(async () => ['a', 'b']), fakeVisibility(), FAST);
  poller.start();
  const s = await waitFor(poller, s => s.status === 'ready');
  assert.ok(s.status === 'ready');
  assert.equal(s.friends.length, 0);
  assert.equal(s.noFriends, false);
  poller.stop();
});

test('poller: a failing friends page is still an error, not noFriends', async () => {
  const poller = new OnlineFriendsPoller(
    api(async () => {
      throw new Error('boom');
    }),
    fakeVisibility(),
    FAST,
  );
  poller.start();
  const s = await waitFor(poller, s => s.status === 'error');
  assert.ok(s.status === 'error');
  poller.stop();
});

test('poller: slowScan is set only once a full scan took at least slowScanNoticeMs', async () => {
  const slow = new OnlineFriendsPoller(api(async () => ['a', 'b', 'c'], 15), fakeVisibility(), {
    ...FAST,
    intervalMs: 5000,
    maxConcurrency: 1,
    slowScanNoticeMs: 20,
  });
  slow.start();
  const s = await waitFor(slow, s => s.status === 'ready' && s.progress === null && s.slowScan);
  assert.ok(s.status === 'ready' && s.slowScan);
  slow.stop();

  const quick = new OnlineFriendsPoller(api(async () => ['a', 'b', 'c'], 1), fakeVisibility(), {
    ...FAST,
    intervalMs: 5000,
    slowScanNoticeMs: 60_000,
  });
  quick.start();
  const q = await waitFor(quick, s => s.status === 'ready' && s.progress === null);
  assert.ok(q.status === 'ready');
  await sleep(50);
  const after = quick.getState();
  assert.ok(after.status === 'ready' && after.slowScan === false);
  quick.stop();
});

test('notices: empty-list wording distinguishes no friends from none online', () => {
  assert.equal(emptyListMessage(true), NO_FRIENDS_MESSAGE);
  assert.equal(emptyListMessage(false), NONE_ONLINE_MESSAGE);
  assert.notEqual(NO_FRIENDS_MESSAGE, NONE_ONLINE_MESSAGE);
  assert.doesNotMatch(NO_FRIENDS_MESSAGE, /logged in/i);
});

test('notices: the incomplete note no longer claims a last known status', () => {
  assert.doesNotMatch(INCOMPLETE_NOTE, /last known/i);
  assert.match(INCOMPLETE_NOTE, /missing/);
});

test('notices: friends-submissions wording', () => {
  assert.equal(noSubmissionsMessage(1), 'The friend checked has no submissions on this problem.');
  assert.equal(noSubmissionsMessage(30), 'None of the 30 friends checked has submitted this problem.');
  assert.equal(failedNote(1), "1 friend couldn't be checked.");
  assert.equal(failedNote(3), "3 friends couldn't be checked.");
});

test('notices: friends-submissions loading message counts up as friends are checked', () => {
  assert.equal(submissionsLoadingMessage(0, 40), 'Loading friends’ submissions… 0/40 checked');
  assert.equal(submissionsLoadingMessage(12, 40), 'Loading friends’ submissions… 12/40 checked');
  assert.equal(submissionsLoadingMessage(40, 40), 'Loading friends’ submissions… 40/40 checked');
  /* Total not known yet (list still loading): falls back to the plain message. */
  assert.equal(submissionsLoadingMessage(0, 0), SUBMISSIONS_LOADING_MESSAGE);
});

test('notices: every applicable list note is shown, in order', () => {
  assert.deepEqual(listNotes({ incomplete: true, slowScan: true }), [INCOMPLETE_NOTE, SLOW_SCAN_NOTE]);
  assert.deepEqual(listNotes({ incomplete: false, slowScan: false }), []);
});
