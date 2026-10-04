import test from 'node:test';
import assert from 'node:assert/strict';

import { OnlineFriendsPoller } from '../src/services/onlinePoller.ts';
import type { PollerApi, PollerState, Visibility } from '../src/services/onlinePoller.ts';
import type { Persistence, PersistedSnapshot } from '../src/services/onlineStore.ts';
import type { OnlineStatus } from '../src/domain/onlineTracker.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const never = () => new Promise<never>(() => {});

async function waitFor(condition: () => boolean, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;

  while (Date.now() < until) {
    if (condition()) {
      return true;
    }

    await sleep(5);
  }

  return condition();
}

function fakeVisibility() {
  let hidden = false;
  const callbacks = new Set<() => void>();
  const visibility: Visibility = {
    isHidden: () => hidden,
    subscribe: cb => {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
  };
  return {
    visibility,
    set(value: boolean) {
      hidden = value;
      callbacks.forEach(cb => cb());
    },
  };
}

function memoryPersistence(): Persistence {
  let stored: PersistedSnapshot | null = null;
  return {
    load: () => stored,
    save: snapshot => {
      stored = snapshot;
    },
    onExternalChange: () => () => {},
    runExclusive: async task => {
      await task();
      return true;
    },
  };
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
  friendsTimeoutMs: 80,
  infoTimeoutMs: 80,
};

function info(handles: string[]) {
  return handles.map(handle => ({ handle, rating: 1500, rank: 'specialist' }));
}

function onlineHandles(poller: OnlineFriendsPoller): string[] {
  const state: PollerState = poller.getState();
  return state.status === 'ready' ? state.friends.map(friend => friend.handle).sort() : [];
}

test('stall: a friends page that never answers does not freeze the poller', async () => {
  let friendsCalls = 0;
  let checks = 0;
  const api: PollerApi = {
    /* The first request hangs and ignores its abort signal, like a stalled connection. */
    fetchFriends: () => {
      friendsCalls += 1;
      return friendsCalls === 1 ? never() : Promise.resolve(['a', 'b']);
    },
    checkProfile: async (handle): Promise<OnlineStatus> => {
      checks += 1;
      return handle === 'a' ? 'online' : 'offline';
    },
    fetchInfo: async handles => info(handles),
  };

  const poller = new OnlineFriendsPoller(api, fakeVisibility().visibility, FAST);
  poller.start();

  try {
    assert.ok(await waitFor(() => onlineHandles(poller).includes('a')), 'recovered and found the online friend');
    assert.ok(friendsCalls >= 2);
    assert.ok(checks >= 2);
  } finally {
    poller.stop();
  }
});

test('stall: a rating lookup that never answers does not freeze the scan', async () => {
  let infoCalls = 0;
  let checks = 0;
  const api: PollerApi = {
    fetchFriends: async () => ['a', 'b', 'c'],
    checkProfile: async (handle): Promise<OnlineStatus> => {
      checks += 1;
      return handle === 'a' ? 'online' : 'offline';
    },
    fetchInfo: handles => {
      infoCalls += 1;
      return infoCalls === 1 ? never() : Promise.resolve(info(handles));
    },
  };

  const poller = new OnlineFriendsPoller(api, fakeVisibility().visibility, FAST);
  poller.start();

  try {
    assert.ok(await waitFor(() => onlineHandles(poller).includes('a')), 'the online friend still shows up');
    assert.ok(checks >= 3, 'every friend was checked');
  } finally {
    poller.stop();
  }
});

test('stall: ratings that never come back still let an online friend show', async () => {
  let infoCalls = 0;
  const api: PollerApi = {
    fetchFriends: async () => ['a', 'b'],
    checkProfile: async (handle): Promise<OnlineStatus> => (handle === 'a' ? 'online' : 'offline'),
    fetchInfo: () => {
      infoCalls += 1;
      return never();
    },
  };

  const poller = new OnlineFriendsPoller(api, fakeVisibility().visibility, FAST);
  poller.start();

  try {
    assert.ok(await waitFor(() => onlineHandles(poller).includes('a')), 'shown even without a rating');
    /* The scan's lookup and the follow-up lookup both timed out and were given up on. */
    assert.ok(infoCalls >= 2);
  } finally {
    poller.stop();
  }
});

test('stall: a tab hidden during a stalled request unwinds, and polling resumes when shown', async () => {
  let friendsCalls = 0;
  const api: PollerApi = {
    fetchFriends: () => {
      friendsCalls += 1;
      return friendsCalls === 1 ? never() : Promise.resolve(['a']);
    },
    checkProfile: async (): Promise<OnlineStatus> => 'online',
    fetchInfo: async handles => info(handles),
  };

  /* Long deadlines: only the abort can end the stalled request here. */
  const visibility = fakeVisibility();
  const poller = new OnlineFriendsPoller(api, visibility.visibility, {
    ...FAST,
    friendsTimeoutMs: 60_000,
    infoTimeoutMs: 60_000,
  });
  poller.start();

  try {
    await sleep(40);
    assert.equal(friendsCalls, 1);

    visibility.set(true);
    await sleep(40);
    visibility.set(false);

    assert.ok(await waitFor(() => friendsCalls >= 2, 1500), 'a new cycle started');
    assert.ok(await waitFor(() => onlineHandles(poller).includes('a'), 1500));
  } finally {
    poller.stop();
  }
});

test('refresh: a click while idle starts a check right away and shows feedback', async () => {
  let friendsCalls = 0;
  const api: PollerApi = {
    fetchFriends: async () => {
      friendsCalls += 1;
      return ['a', 'b', 'c'];
    },
    checkProfile: async (handle): Promise<OnlineStatus> => {
      await sleep(2);
      return handle === 'a' ? 'online' : 'offline';
    },
    fetchInfo: async handles => info(handles),
  };

  const poller = new OnlineFriendsPoller(
    api,
    fakeVisibility().visibility,
    { ...FAST, intervalMs: 5_000, persistSaveGapMs: 10 },
    memoryPersistence(),
  );

  let sawRefreshing = false;
  poller.subscribe(() => {
    const state = poller.getState();
    if ('refreshing' in state && state.refreshing) {
      sawRefreshing = true;
    }
  });

  poller.start();

  try {
    assert.ok(await waitFor(() => onlineHandles(poller).includes('a')), 'first scan finished');
    await sleep(60);
    const before = friendsCalls;

    poller.refresh();

    assert.ok(await waitFor(() => friendsCalls > before, 1000), 'the first click ran a new check');
    assert.ok(sawRefreshing, 'and showed the refreshing state');
  } finally {
    poller.stop();
  }
});
