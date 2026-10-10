import { fetchOnlineFriends } from './codeforcesApi';
import { getLoggedInHandle } from './onlineStore';

/*
 * The user's whole friends list (despite its name, fetchOnlineFriends
 * reads the /friends page, which lists every friend), cached so closing
 * and reopening the Friends submissions box, or opening another problem
 * page, does not read the page again every time. A failure is never
 * cached.
 *
 * Two layers: memory (this page) and sessionStorage (this tab, so a page
 * reload or the next problem page reuses it). The stored copy is keyed by
 * the logged-in handle, and is not used at all when the page does not show
 * who is logged in, so a friends list can never be shown to another
 * account.
 */
export const FRIENDS_LIST_TTL_MS = 5 * 60 * 1000;

const PREFIX = 'cfpm_flist:';

let cached: { at: number; handles: string[] } | null = null;

export function clearFriendsListCache(): void {
  cached = null;
}

function readStored(
  store: Storage | null,
  account: string | null,
  now: number,
): string[] | null {
  if (!store || !account) {
    return null;
  }

  try {
    const raw = store.getItem(`${PREFIX}${account.toLowerCase()}`);

    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as { t?: unknown; h?: unknown } | null;

    if (
      value &&
      typeof value.t === 'number' &&
      Array.isArray(value.h) &&
      value.h.every(item => typeof item === 'string') &&
      now - value.t <= FRIENDS_LIST_TTL_MS &&
      value.t <= now
    ) {
      return value.h as string[];
    }
  } catch {
    // Corrupted or unavailable: treated as missing.
  }

  return null;
}

function writeStored(
  store: Storage | null,
  account: string | null,
  handles: string[],
  now: number,
): void {
  if (!store || !account) {
    return;
  }

  try {
    store.setItem(
      `${PREFIX}${account.toLowerCase()}`,
      JSON.stringify({ t: now, h: handles }),
    );
  } catch {
    // Storage full or unavailable: skip caching.
  }
}

function defaultStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export async function loadFriendHandles(
  signal?: AbortSignal,
  fetcher: (signal?: AbortSignal) => Promise<string[]> = fetchOnlineFriends,
  now: () => number = Date.now,
  store: Storage | null = defaultStore(),
  account: string | null = getLoggedInHandle(),
): Promise<string[]> {
  if (
    cached &&
    now() - cached.at <= FRIENDS_LIST_TTL_MS &&
    cached.at <= now()
  ) {
    return cached.handles;
  }

  const stored = readStored(store, account, now());

  if (stored) {
    cached = { at: now(), handles: stored };

    return stored;
  }

  const fetched = await fetcher(signal);

  /* Same friend twice (or in another letter case) must not cost two requests. */
  const seen = new Set<string>();
  const handles: string[] = [];

  for (const handle of fetched) {
    const key = handle.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      handles.push(handle);
    }
  }

  cached = { at: now(), handles };
  writeStored(store, account, handles, now());

  return handles;
}
