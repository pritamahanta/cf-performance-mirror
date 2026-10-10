import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * storage.ts dispatches a plain DOM `Event` on `window` whenever
 * settings are saved; there is no DOM in this runner, so a minimal
 * stand-in is set up before the module under test is imported.
 */
(globalThis as unknown as { window: EventTarget }).window = new EventTarget();

const { DEFAULT_SETTINGS, normalizeSettings } = await import('../src/domain/settings.ts');
const {
  toggleFriendsExpanded,
  toggleFriendsVisible,
  saveSettings,
  loadSettings,
  SETTINGS_CHANGED_EVENT,
} = await import('../src/services/storage.ts');
const { createPacedApiClient } = await import('../src/services/pacedApi.ts');
const { loadFriendContestSubmissions } = await import('../src/services/friendSubmissions.ts');

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

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
});

/* ---------- settings: the two flags ---------- */

test('defaults: master switch on, box open', () => {
  assert.equal(DEFAULT_SETTINGS.friendsVisible, true);
  assert.equal(DEFAULT_SETTINGS.friendsExpanded, true);

  const fresh = normalizeSettings({});
  assert.equal(fresh.friendsVisible, true);
  assert.equal(fresh.friendsExpanded, true);
});

test('settings saved before friendsExpanded existed keep their master value and get an open box', () => {
  const on = normalizeSettings({ friendsVisible: true });
  assert.equal(on.friendsVisible, true);
  assert.equal(on.friendsExpanded, true);

  const off = normalizeSettings({ friendsVisible: false });
  assert.equal(off.friendsVisible, false);
  assert.equal(off.friendsExpanded, true);
});

test('both flags are read back exactly as saved', () => {
  const s = normalizeSettings({ friendsVisible: true, friendsExpanded: false });
  assert.equal(s.friendsVisible, true);
  assert.equal(s.friendsExpanded, false);
});

/* ---------- toggles are independent ---------- */

test('toggleFriendsExpanded: flips only the box flag and keeps every other saved setting', () => {
  saveSettings(
    {
      category: 'Div1',
      hideAC: true,
      tagFilters: ['dp', 'greedy'],
      friendsVisible: true,
      friendsExpanded: true,
    } as never,
    storage,
  );

  const result = toggleFriendsExpanded(storage);
  assert.equal(result, false, 'returns the new value');

  const saved = loadSettings(storage);
  assert.equal(saved.friendsExpanded, false);
  assert.equal(saved.friendsVisible, true, 'master switch must not change');
  assert.equal(saved.category, 'Div1');
  assert.equal(saved.hideAC, true);
  assert.deepEqual(saved.tagFilters, ['dp', 'greedy']);
});

test('toggleFriendsExpanded: from nothing saved, the default open box closes', () => {
  assert.equal(toggleFriendsExpanded(storage), false);
  const saved = loadSettings(storage);
  assert.equal(saved.friendsExpanded, false);
  assert.equal(saved.friendsVisible, true, 'master switch stays at its default');
});

test('toggleFriendsVisible: flips only the master switch and leaves the box flag alone', () => {
  saveSettings({ friendsVisible: false, friendsExpanded: false } as never, storage);

  assert.equal(toggleFriendsVisible(storage), true);

  const saved = loadSettings(storage);
  assert.equal(saved.friendsVisible, true);
  assert.equal(saved.friendsExpanded, false, 'closed box stays closed when the feature is switched on');
});

test('toggleFriendsExpanded: dispatches the settings-changed event once', () => {
  let fired = 0;
  const listener = () => {
    fired += 1;
  };
  const w = (globalThis as unknown as { window: EventTarget }).window;

  w.addEventListener(SETTINGS_CHANGED_EVENT, listener);

  try {
    toggleFriendsExpanded(storage);
    assert.equal(fired, 1);
  } finally {
    w.removeEventListener(SETTINGS_CHANGED_EVENT, listener);
  }
});

/* ---------- paced queue: abort ---------- */

const okBody = { status: 'OK', result: [] };
const noSleep = () => Promise.resolve();

test('pacedApi: a call aborted before its turn sends nothing, later calls still run', async () => {
  const sent: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve;
  });

  const client = createPacedApiClient({
    sleep: noSleep,
    fetchJson: async path => {
      sent.push(path);
      if (path === '/first') {
        await firstGate;
      }
      return okBody;
    },
  });

  const controller = new AbortController();

  const first = client.get('/first');
  const dropped = client.get('/dropped', controller.signal);
  const last = client.get('/last');

  controller.abort();
  releaseFirst();

  await first;
  await assert.rejects(dropped);
  await last;

  assert.deepEqual(sent, ['/first', '/last'], '/dropped must never be sent');
});

test('pacedApi: an already-aborted signal rejects without sending', async () => {
  let calls = 0;
  const client = createPacedApiClient({
    sleep: noSleep,
    fetchJson: async () => {
      calls += 1;
      return okBody;
    },
  });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(client.get('/x', controller.signal));
  assert.equal(calls, 0);
});

test('pacedApi: abort while waiting for the pacing slot sends nothing', async () => {
  let calls = 0;
  const controller = new AbortController();

  const client = createPacedApiClient({
    // The first call takes the slot; the second waits in sleep() and is aborted there.
    sleep: async () => {
      controller.abort();
    },
    now: () => 0,
    fetchJson: async () => {
      calls += 1;
      return okBody;
    },
  });

  await client.get('/first');
  await assert.rejects(client.get('/second', controller.signal));

  assert.equal(calls, 1, 'only the first call was sent');
});

test('pacedApi: the signal is passed on to fetchJson, and none is passed when none is given', async () => {
  const seen: Array<AbortSignal | undefined> = [];
  const client = createPacedApiClient({
    sleep: noSleep,
    fetchJson: async (_path, signal) => {
      seen.push(signal);
      return okBody;
    },
  });

  const controller = new AbortController();

  await client.get('/a', controller.signal);
  await client.get('/b');

  assert.equal(seen[0], controller.signal);
  assert.equal(seen[1], undefined);
});

/* ---------- friend submissions: abort end to end ---------- */

function stubFetch(delayMs: number) {
  const calls: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { signal?: AbortSignal }) => {
    calls.push(String(input));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      init?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(init.signal?.reason ?? new Error('aborted'));
        },
        { once: true },
      );
    });

    return { status: 200, json: async () => okBody } as unknown as Response;
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('friend submissions: aborting stops every request still queued', async () => {
  const stub = stubFetch(20);

  try {
    const controller = new AbortController();
    const contestId = 910001;

    const runs = ['a', 'b', 'c', 'd'].map(handle =>
      loadFriendContestSubmissions(contestId, handle, controller.signal).then(
        () => 'ok',
        () => 'rejected',
      ),
    );

    // Wait until the first request is actually on the wire, then abort.
    while (stub.calls.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    controller.abort();

    const results = await Promise.all(runs);

    // Give the queue far longer than its 350ms gap to (wrongly) send more.
    await new Promise(resolve => setTimeout(resolve, 1200));

    assert.equal(stub.calls.length, 1, 'only the request already sent may exist');
    assert.deepEqual(results, ['rejected', 'rejected', 'rejected', 'rejected']);
  } finally {
    stub.restore();
  }
});

test('friend submissions: a new caller is not handed an aborted request', async () => {
  const stub = stubFetch(20);

  try {
    const contestId = 910002;
    const blocker = loadFriendContestSubmissions(contestId, 'blocker');

    const first = new AbortController();
    const doomed = loadFriendContestSubmissions(contestId, 'x', first.signal).then(
      () => 'ok',
      () => 'rejected',
    );

    first.abort();

    // Same contest + handle, fresh signal, while the aborted one is still queued.
    const second = new AbortController();
    const retry = loadFriendContestSubmissions(contestId, 'x', second.signal);

    await blocker;
    assert.equal(await doomed, 'rejected');
    assert.deepEqual(await retry, [], 'the retry must succeed on its own request');

    const xCalls = stub.calls.filter(url => url.includes('handle=x'));
    assert.equal(xCalls.length, 1, 'exactly one request for x was ever sent');
  } finally {
    stub.restore();
  }
});

test('friend submissions: without a signal behaviour is unchanged (shared in-flight request)', async () => {
  const stub = stubFetch(20);

  try {
    const contestId = 910003;
    const one = loadFriendContestSubmissions(contestId, 'same');
    const two = loadFriendContestSubmissions(contestId, 'same');

    await Promise.all([one, two]);

    assert.equal(stub.calls.length, 1, 'duplicate callers share one request');
  } finally {
    stub.restore();
  }
});
