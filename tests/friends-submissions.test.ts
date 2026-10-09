import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { window: EventTarget }).window = new EventTarget();

const { DEFAULT_SETTINGS, normalizeSettings } = await import('../src/domain/settings.ts');
const { toggleFriendSubmissionsExpanded, saveSettings, loadSettings } = await import(
  '../src/services/storage.ts'
);
const { compareSummaries, shortWhen, summarizeFriend } = await import(
  '../src/domain/friendSubmissions.ts'
);
const { FRIENDS_LIST_TTL_MS, clearFriendsListCache, loadFriendHandles } = await import(
  '../src/services/friendsList.ts'
);
import type { FriendSubmission } from '../src/domain/friendSubmissions.ts';

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

const sub = (id: number, index: string, verdict: string | undefined, createdAt: number, extra: Partial<FriendSubmission> = {}): FriendSubmission => ({
  id,
  index,
  createdAt,
  verdict,
  ...extra,
});

/* ---------- settings ---------- */

test('friends submissions: off by default, box open by default', () => {
  assert.equal(DEFAULT_SETTINGS.friendSubmissionsVisible, false);
  assert.equal(DEFAULT_SETTINGS.friendSubmissionsExpanded, true);

  const fresh = normalizeSettings({});
  assert.equal(fresh.friendSubmissionsVisible, false);
  assert.equal(fresh.friendSubmissionsExpanded, true);
});

test('friends submissions: older saved settings keep every other value', () => {
  const s = normalizeSettings({ friendsVisible: true, friendsExpanded: false });
  assert.equal(s.friendsVisible, true);
  assert.equal(s.friendsExpanded, false);
  assert.equal(s.friendSubmissionsVisible, false);
  assert.equal(s.friendSubmissionsExpanded, true);
});

test('friends submissions: the chevron flips only its own flag', () => {
  const storage = new FakeStorage();
  saveSettings({ ...normalizeSettings({}), friendsVisible: true, friendSubmissionsVisible: true, category: 'Div2' }, storage);

  assert.equal(toggleFriendSubmissionsExpanded(storage), false);

  const saved = normalizeSettings(loadSettings(storage));
  assert.equal(saved.friendSubmissionsExpanded, false);
  assert.equal(saved.friendSubmissionsVisible, true, 'master switch unchanged');
  assert.equal(saved.friendsVisible, true, 'Online Friends switch unchanged');
  assert.equal(saved.friendsExpanded, true, 'Online Friends box unchanged');
  assert.equal(saved.category, 'Div2', 'unrelated settings survive');
});

/* ---------- per-friend summary ---------- */

test('summary: no submission on this problem is null; other problems are ignored', () => {
  assert.equal(summarizeFriend([], 'A'), null);
  assert.equal(summarizeFriend([sub(1, 'B', 'OK', 100)], 'A'), null);
});

test('summary: solved headline is the earliest accepted, attempts counted before it', () => {
  const all = [
    sub(10, 'A', 'WRONG_ANSWER', 100),
    sub(20, 'A', 'OK', 200),
    sub(30, 'A', 'OK', 300),
    sub(40, 'B', 'OK', 400),
  ];
  const s = summarizeFriend(all, 'a')!;

  assert.equal(s.solved, true);
  assert.equal(s.headline.id, 20);
  assert.equal(s.attemptsBeforeSolve, 1);
  assert.deepEqual(s.submissions.map(x => x.id), [30, 20, 10], 'newest first');
});

test('summary: unsolved headline is the newest attempt', () => {
  const s = summarizeFriend([sub(1, 'A', 'WRONG_ANSWER', 100), sub(2, 'A', 'TIME_LIMIT_EXCEEDED', 200)], 'A')!;

  assert.equal(s.solved, false);
  assert.equal(s.headline.id, 2);
  assert.equal(s.attemptsBeforeSolve, 2);
});

test('ordering: solved first (earliest solve first), then unsolved (latest attempt first), then handle', () => {
  const mk = (handle: string, subs: FriendSubmission[]) => ({ handle, summary: summarizeFriend(subs, 'A')! });

  const rows = [
    mk('zed', [sub(1, 'A', 'WRONG_ANSWER', 500)]),
    mk('bob', [sub(2, 'A', 'OK', 300)]),
    mk('amy', [sub(3, 'A', 'OK', 100)]),
    mk('cat', [sub(4, 'A', 'WRONG_ANSWER', 900)]),
    mk('abe', [sub(5, 'A', 'OK', 300)]),
  ];

  assert.deepEqual(
    rows.sort(compareSummaries).map(r => r.handle),
    ['amy', 'abe', 'bob', 'cat', 'zed'],
  );
});

test('shortWhen: contest time for contest submissions, the date otherwise', () => {
  const date = (t: number) => `D${t}`;

  assert.equal(shortWhen(sub(1, 'A', 'OK', 50, { participantType: 'CONTESTANT', contestSeconds: 3725 }), date), 'Contest +1:02');
  assert.equal(shortWhen(sub(1, 'A', 'OK', 50, { participantType: 'VIRTUAL', contestSeconds: 60 }), date), 'Virtual +0:01');
  assert.equal(shortWhen(sub(1, 'A', 'OK', 50, { participantType: 'PRACTICE' }), date), 'D50');
  assert.equal(shortWhen(sub(1, 'A', 'OK', 50), date), 'D50');
});

/* ---------- friends list ---------- */

beforeEach(() => clearFriendsListCache());

test('friends list: de-duplicates (case-insensitive) and keeps order', async () => {
  const handles = await loadFriendHandles(undefined, async () => ['Ann', 'bob', 'ann', 'Bob', 'cy']);
  assert.deepEqual(handles, ['Ann', 'bob', 'cy']);
});

test('friends list: reused within the TTL, read again after it', async () => {
  let calls = 0;
  let clock = 1_000;
  const fetcher = async () => {
    calls += 1;
    return ['a'];
  };

  await loadFriendHandles(undefined, fetcher, () => clock);
  clock += FRIENDS_LIST_TTL_MS - 1;
  await loadFriendHandles(undefined, fetcher, () => clock);
  assert.equal(calls, 1);

  clock += 2;
  await loadFriendHandles(undefined, fetcher, () => clock);
  assert.equal(calls, 2);
});

test('friends list: a failure is not cached', async () => {
  let calls = 0;

  await assert.rejects(
    loadFriendHandles(undefined, async () => {
      calls += 1;
      throw new Error('boom');
    }),
  );

  const handles = await loadFriendHandles(undefined, async () => {
    calls += 1;
    return ['ok'];
  });

  assert.deepEqual(handles, ['ok']);
  assert.equal(calls, 2);
});
