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

export const FRIEND_SUBMISSIONS_TTL_MS = 30 * 60 * 1000;

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

export function loadCachedSubmissions(
  contestId: number,
  handle: string,
  storage?: Storage,
  now: number = Date.now(),
): FriendSubmission[] | null {
  try {
    const store = storage ?? localStorage;
    const key = keyFor(contestId, handle);
    const entry = parseEntry(store.getItem(key));

    if (!entry) {
      store.removeItem(key);

      return null;
    }

    if (now - entry.t > FRIEND_SUBMISSIONS_TTL_MS || entry.t > now) {
      store.removeItem(key);

      return null;
    }

    return entry.s;
  } catch {
    return null;
  }
}

function pruneExpired(store: Storage, now: number): void {
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
    store.setItem(keyFor(contestId, handle), json);
  } catch {
    // Storage full or unavailable: skip caching.
  }
}
