import type {
  CodeforcesApiResponse,
  CodeforcesContest,
  CodeforcesRatingChange,
  CodeforcesSubmission,
  CodeforcesUser,
} from '../types/codeforces';

const API_BASE =
  'https://codeforces.com/api';

async function get<T>(
  path: string,
): Promise<
  CodeforcesApiResponse<T>
> {
  const response =
    await fetch(
      `${API_BASE}${path}`,
    );

  return response.json() as Promise<
    CodeforcesApiResponse<T>
  >;
}

export async function fetchContests(): Promise<
  CodeforcesContest[]
> {
  const data =
    await get<CodeforcesContest[]>(
      '/contest.list',
    );

  return data.status === 'OK'
    ? (data.result ?? [])
    : [];
}

export async function fetchUserRating(
  handle: string,
): Promise<
  CodeforcesRatingChange[]
> {
  const data =
    await get<CodeforcesRatingChange[]>(
      `/user.rating?handle=${encodeURIComponent(handle)}`,
    );

  return data.status === 'OK'
    ? (data.result ?? [])
    : [];
}

export async function fetchUserSubmissions(
  handle: string,
): Promise<
  CodeforcesSubmission[]
> {
  const data =
    await get<CodeforcesSubmission[]>(
      `/user.status?handle=${encodeURIComponent(handle)}&count=10000`,
    );

  if (data.status !== 'OK') {
    throw new Error(
      data.comment || 'unknown',
    );
  }

  return data.result ?? [];
}

export async function fetchUserDataset(
  handle: string,
): Promise<{
  submissions: CodeforcesSubmission[];
  ratingHistory: CodeforcesRatingChange[];
}> {
  const [
    submissions,
    ratingHistory,
  ] = await Promise.all([
    fetchUserSubmissions(handle),
    fetchUserRating(handle),
  ]);

  return {
    submissions,
    ratingHistory,
  };
}

/*
 * Codeforces' user.friends?onlyOnline=true
 * requires API authorization.
 *
 * We intentionally avoid putting an API secret
 * inside the extension.
 *
 * Instead, read the authenticated /friends page
 * using the user's existing Codeforces session.
 */
export async function fetchOnlineFriends(): Promise<
  string[]
> {
  const response =
    await fetch(
      'https://codeforces.com/friends',
      {
        credentials: 'include',
        cache: 'no-store',
      },
    );

  if (!response.ok) {
    throw new Error(
      'Could not load your Codeforces friends page.',
    );
  }

  const html =
    await response.text();

  const doc =
    new DOMParser().parseFromString(
      html,
      'text/html',
    );

  /*
   * Codeforces renders every real data table
   * (friends, standings, submissions, rating
   * changes, ...) with the "tablesorter" class.
   * Sidebar boxes (Top rated, Recent actions,
   * etc.) are plain divs, not tables, but they
   * can still contain "/profile/" links, so a
   * bare "most profile links" comparison across
   * *all* tables on the page can grab the wrong
   * one when the friends list itself is short.
   *
   * Prefer an actual tablesorter table first;
   * only fall back to the old "largest number of
   * profile links" heuristic if none is found, so
   * behavior is unchanged in that edge case.
   */
  const tablesorterTables =
    Array.from(
      doc.querySelectorAll(
        'table.tablesorter',
      ),
    )
      .map(table => ({
        table,
        count:
          table.querySelectorAll(
            'a[href*="/profile/"]',
          ).length,
      }))
      .filter(
        item => item.count > 0,
      )
      .sort(
        (a, b) =>
          b.count -
          a.count,
      );

  const tables =
    tablesorterTables.length >
    0
      ? tablesorterTables
      : Array.from(
          doc.querySelectorAll(
            'table',
          ),
        )
          .map(table => ({
            table,
            count:
              table.querySelectorAll(
                'a[href*="/profile/"]',
              ).length,
          }))
          .filter(
            item =>
              item.count > 0,
          )
          .sort(
            (a, b) =>
              b.count -
              a.count,
          );

  const friendsTable =
    tables[0]?.table;

  if (!friendsTable) {
    throw new Error(
      "Couldn't find your Codeforces friends table. Make sure you're logged in.",
    );
  }

  const handles =
    Array.from(
      new Set(
        Array.from(
          friendsTable.querySelectorAll<HTMLAnchorElement>(
            'a[href*="/profile/"]',
          ),
        )
          .map(link => {
            const href =
              link.getAttribute(
                'href',
              );

            const match =
              href?.match(
                /\/profile\/([^/?#]+)/,
              );

            return (
              match?.[1] ?? ''
            );
          })
          .filter(Boolean),
      ),
    );

  if (handles.length === 0) {
    throw new Error(
      "Couldn't find any friends on your Codeforces friends page.",
    );
  }

  return handles;
}

/*
 * user.info's lastOnlineTimeSeconds is served
 * from a cache that can lag the live site by an
 * hour or more, so it is not reliable for "is
 * this person online right now".
 *
 * Each profile page itself is not cached the same
 * way: it renders "Last visit: online now" (in
 * green) directly from live data. Checking that
 * text per-friend is slower (one request per
 * friend) but is the only signal confirmed to be
 * accurate.
 */
const PROFILE_ONLINE_PATTERN =
  /Last visit:\s*(?:<[^>]+>\s*)*online now/i;

const PROFILE_CHECK_CONCURRENCY =
  10;

async function isProfileOnlineNow(
  handle: string,
): Promise<boolean> {
  try {
    const response =
      await fetch(
        `https://codeforces.com/profile/${encodeURIComponent(
          handle,
        )}`,
        {
          cache: 'no-store',
        },
      );

    if (!response.ok) {
      return false;
    }

    const html =
      await response.text();

    return PROFILE_ONLINE_PATTERN.test(
      html,
    );
  } catch {
    return false;
  }
}

export async function fetchOnlineHandles(
  handles: string[],
): Promise<Set<string>> {
  const online =
    new Set<string>();

  for (
    let i = 0;
    i < handles.length;
    i +=
      PROFILE_CHECK_CONCURRENCY
  ) {
    const batch =
      handles.slice(
        i,
        i +
          PROFILE_CHECK_CONCURRENCY,
      );

    const results =
      await Promise.all(
        batch.map(
          async handle => ({
            handle,
            online:
              await isProfileOnlineNow(
                handle,
              ),
          }),
        ),
      );

    results.forEach(
      result => {
        if (result.online) {
          online.add(
            result.handle,
          );
        }
      },
    );
  }

  return online;
}

type ExtensionRuntime = {
  sendMessage: (
    message: unknown,
  ) => Promise<unknown>;
};

function getExtensionRuntime():
  ExtensionRuntime {
  const chromeObject =
    (
      globalThis as typeof globalThis & {
        chrome?: {
          runtime?: ExtensionRuntime;
        };
      }
    ).chrome;

  if (
    !chromeObject?.runtime
      ?.sendMessage
  ) {
    throw new Error(
      'CF Performance Mirror background service is unavailable.',
    );
  }

  return chromeObject.runtime;
}

interface UserInfoResponse {
  ok: boolean;
  data?: CodeforcesUser[];
  error?: string;
}

const USER_INFO_CHUNK_SIZE =
  100;

export async function fetchUsersInfo(
  handles: string[],
): Promise<
  CodeforcesUser[]
> {
  if (handles.length === 0) {
    return [];
  }

  const runtime =
    getExtensionRuntime();

  const chunks: string[][] =
    [];

  for (
    let i = 0;
    i < handles.length;
    i += USER_INFO_CHUNK_SIZE
  ) {
    chunks.push(
      handles.slice(
        i,
        i +
          USER_INFO_CHUNK_SIZE,
      ),
    );
  }

  const results =
    await Promise.all(
      chunks.map(
        async chunk => {
          const response =
            (await runtime.sendMessage(
              {
                type:
                  'CFPM_FETCH_USER_INFO',
                handles:
                  chunk,
              },
            )) as UserInfoResponse;

          if (!response?.ok) {
            throw new Error(
              response?.error ||
                'Could not fetch Codeforces user information.',
            );
          }

          return response.data ?? [];
        },
      ),
    );

  return results.flat();
}