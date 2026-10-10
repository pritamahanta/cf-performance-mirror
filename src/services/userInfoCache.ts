/*
 * Small cache of friends' rating and rank (only used to colour their
 * handles), kept in localStorage so reopening a problem page, in this tab
 * or another, does not ask Codeforces again. A rating colour that is a
 * few hours old is harmless; the entries are public Codeforces data, not
 * tied to the logged-in account.
 *
 * Everything is best-effort: if storage is unavailable or full the
 * functions quietly do nothing / return null.
 */

const PREFIX = 'cfpm_uinfo:';

export const USER_INFO_TTL_MS = 6 * 60 * 60 * 1000;

export interface CachedUserInfo {
  handle: string;
  rank?: string;
  rating?: number;
}

interface StoredEntry {
  v: 1;
  t: number;
  i: CachedUserInfo;
}

function keyFor(handle: string): string {
  return `${PREFIX}${handle.toLowerCase()}`;
}

function parse(raw: string | null): StoredEntry | null {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<StoredEntry> | null;

    if (
      value &&
      value.v === 1 &&
      typeof value.t === 'number' &&
      value.i &&
      typeof value.i.handle === 'string' &&
      (value.i.rank === undefined || typeof value.i.rank === 'string') &&
      (value.i.rating === undefined || typeof value.i.rating === 'number')
    ) {
      return value as StoredEntry;
    }
  } catch {
    // Corrupted entry: treated as missing.
  }

  return null;
}

export function loadCachedUserInfo(
  handle: string,
  storage?: Storage,
  now: number = Date.now(),
): CachedUserInfo | null {
  try {
    const store = storage ?? localStorage;
    const key = keyFor(handle);
    const entry = parse(store.getItem(key));

    if (!entry || now - entry.t > USER_INFO_TTL_MS || entry.t > now) {
      if (store.getItem(key) !== null) {
        store.removeItem(key);
      }

      return null;
    }

    return entry.i;
  } catch {
    return null;
  }
}

/* Saves a whole batch, and drops expired entries once per batch. */
export function saveCachedUserInfos(
  infos: readonly CachedUserInfo[],
  storage?: Storage,
  now: number = Date.now(),
): void {
  try {
    const store = storage ?? localStorage;

    for (let i = store.length - 1; i >= 0; i -= 1) {
      const key = store.key(i);

      if (key && key.startsWith(PREFIX)) {
        const entry = parse(store.getItem(key));

        if (!entry || now - entry.t > USER_INFO_TTL_MS) {
          store.removeItem(key);
        }
      }
    }

    for (const info of infos) {
      const entry: StoredEntry = {
        v: 1,
        t: now,
        i: { handle: info.handle, rank: info.rank, rating: info.rating },
      };

      store.setItem(keyFor(info.handle), JSON.stringify(entry));
    }
  } catch {
    // Storage full or unavailable: skip caching.
  }
}

/*
 * Wraps a user.info fetcher so that every rating it returns is also
 * saved here. The Online Friends box fetches the same ratings the Friends
 * submissions box needs for its handle colours; with this, whichever
 * box fetches them first saves the other one its own request.
 *
 * The result and any error pass through unchanged, and a failed save
 * (storage full or unavailable) never turns a good answer into an error.
 */
export function cachingUserInfoFetcher<User extends CachedUserInfo, Args extends unknown[]>(
  fetchInfo: (...args: Args) => Promise<User[]>,
): (...args: Args) => Promise<User[]> {
  return async (...args: Args) => {
    const users = await fetchInfo(...args);

    if (Array.isArray(users) && users.length > 0) {
      saveCachedUserInfos(users);
    }

    return users;
  };
}
