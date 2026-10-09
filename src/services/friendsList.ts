import { fetchOnlineFriends } from './codeforcesApi';

/*
 * The user's whole friends list (despite its name, fetchOnlineFriends
 * reads the /friends page, which lists every friend), kept in memory
 * for a few minutes so closing and reopening the Friends submissions
 * box does not read the page again every time. A failure is never
 * cached.
 */
export const FRIENDS_LIST_TTL_MS = 5 * 60 * 1000;

let cached: { at: number; handles: string[] } | null = null;

export function clearFriendsListCache(): void {
  cached = null;
}

export async function loadFriendHandles(
  signal?: AbortSignal,
  fetcher: (signal?: AbortSignal) => Promise<string[]> = fetchOnlineFriends,
  now: () => number = Date.now,
): Promise<string[]> {
  if (
    cached &&
    now() - cached.at <= FRIENDS_LIST_TTL_MS &&
    cached.at <= now()
  ) {
    return cached.handles;
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

  return handles;
}
