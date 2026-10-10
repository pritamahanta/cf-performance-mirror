import { isFriendSubmission } from '../domain/friendSubmissions';
import type { FriendSubmission } from '../domain/friendSubmissions';

/*
 * Cache (localStorage, shared by all tabs) of a friend's submissions in
 * one contest. Codeforces pages are full page loads, so without this
 * every problem page of the same contest, and every reload of one,
 * would repeat the same requests for every friend. The entries are
 * public Codeforces data, not tied to the logged-in account.
 *
 * Everything is best-effort: storage can be unavailable or full, in
 * which case the functions quietly do nothing / return null.
 */

const PREFIX = 'cfpm_fsub:';

/* How long an entry counts as up to date: inside this window it is used without any request. */
export const FRIEND_SUBMISSIONS_TTL_MS = 30 * 60 * 1000;

/*
 * How long an entry that is no longer up to date is still kept and may be
 * shown (marked as updating) while a fresh request runs. Older than this it
 * is dropped and never shown.
 */
export const FRIEND_SUBMISSIONS_MAX_STALE_MS = 24 * 60 * 60 * 1000;

/* Don't try to cache pathological (huge) entries. */
const MAX_ENTRY_CHARS = 200_000;

interface StoredEntry {
  v: 1;
  t: number;
  s: FriendSubmission[];
}

function keyFor(contestId: number, handle: string): string {
  return `${PREFIX}${contestId}:${handle.toLowerCase()}`;
}

function parseEntry(raw: string | null): StoredEntry | null {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<StoredEntry> | null;

    if (
      value &&
      value.v === 1 &&
      typeof value.t === 'number' &&
      Array.isArray(value.s) &&
      value.s.every(isFriendSubmission)
    ) {
      return value as StoredEntry;
    }
  } catch {
    // Corrupted entry: treated as missing.
  }

  return null;
}

/*
 * The stored entry for a key, or null. An entry that cannot be used at all
 * (corrupted, dated in the future, or older than the longest it may be
 * shown) is removed; one that is merely not up to date is kept.
 */
function readEntry(store: Storage, key: string, now: number): StoredEntry | null {
  const entry = parseEntry(store.getItem(key));

  if (!entry || entry.t > now || now - entry.t > FRIEND_SUBMISSIONS_MAX_STALE_MS) {
    store.removeItem(key);

    return null;
  }

  return entry;
}

/* Up-to-date submissions only (age within FRIEND_SUBMISSIONS_TTL_MS); null otherwise. */
export function loadCachedSubmissions(
  contestId: number,
  handle: string,
  storage?: Storage,
  now: number = Date.now(),
): FriendSubmission[] | null {
  try {
    const store = storage ?? localStorage;
    const entry = readEntry(store, keyFor(contestId, handle), now);

    if (!entry || now - entry.t > FRIEND_SUBMISSIONS_TTL_MS) {
      return null;
    }

    return entry.s;
  } catch {
    return null;
  }
}

export interface StoredSubmissions {
  submissions: FriendSubmission[];

  /* True when the copy is still up to date; false when it is old and only fit to show while refreshing. */
  fresh: boolean;
}

/*
 * The stored copy even when it is no longer up to date, as long as it is
 * not older than FRIEND_SUBMISSIONS_MAX_STALE_MS. Sends nothing.
 */
export function loadStoredSubmissions(
  contestId: number,
  handle: string,
  storage?: Storage,
  now: number = Date.now(),
): StoredSubmissions | null {
  try {
    const store = storage ?? localStorage;
    const entry = readEntry(store, keyFor(contestId, handle), now);

    if (!entry) {
      return null;
    }

    return {
      submissions: entry.s,
      fresh: now - entry.t <= FRIEND_SUBMISSIONS_TTL_MS,
    };
  } catch {
    return null;
  }
}

/* Removes every entry that is no longer up to date (oldest data first to go when space runs out). */
function evictNotFresh(store: Storage, now: number): void {
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const key = store.key(i);

    if (!key || !key.startsWith(PREFIX)) {
      continue;
    }

    const entry = parseEntry(store.getItem(key));

    if (!entry || now - entry.t > FRIEND_SUBMISSIONS_TTL_MS) {
      store.removeItem(key);
    }
  }
}

function pruneExpired(store: Storage, now: number): void {
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const key = store.key(i);

    if (!key || !key.startsWith(PREFIX)) {
      continue;
    }

    const entry = parseEntry(store.getItem(key));

    if (!entry || entry.t > now || now - entry.t > FRIEND_SUBMISSIONS_MAX_STALE_MS) {
      store.removeItem(key);
    }
  }
}

export function saveCachedSubmissions(
  contestId: number,
  handle: string,
  submissions: readonly FriendSubmission[],
  storage?: Storage,
  now: number = Date.now(),
): void {
  try {
    const store = storage ?? localStorage;
    const entry: StoredEntry = { v: 1, t: now, s: [...submissions] };
    const json = JSON.stringify(entry);

    if (json.length > MAX_ENTRY_CHARS) {
      return;
    }

    pruneExpired(store, now);

    try {
      store.setItem(keyFor(contestId, handle), json);
    } catch {
      /*
       * Full: keeping old copies for a day takes room, so give up the
       * ones that are not up to date and try once more.
       */
      evictNotFresh(store, now);
      store.setItem(keyFor(contestId, handle), json);
    }
  } catch {
    // Storage full or unavailable: skip caching.
  }
}
