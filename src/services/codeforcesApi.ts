import type {
  CodeforcesApiResponse,
  CodeforcesContest,
  CodeforcesRatingChange,
  CodeforcesSubmission,
  CodeforcesUser,
} from '../types/codeforces';

import {
  createPacedApiClient,
} from './pacedApi';

import {
  classifyProfileHtml,
} from '../domain/onlineTracker';

import type {
  OnlineStatus,
} from '../domain/onlineTracker';

import {
  LAST_VISIT_CONTEXT_CHARS,
  findLastVisitLabel,
} from '../domain/profileLocales';

import { withDeadline } from './deadline';
import { getLoggedInHandle } from './onlineStore';

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
 * One request per online friend is made when a problem
 * page is opened (see useFriendProblemSubmissions), so
 * these calls go through a serial, rate-aware queue
 * instead of firing in parallel: Codeforces documents a
 * limit of one API request per two seconds.
 *
 * A non-2xx reply can still carry the API's own JSON
 * error ("Call limit exceeded"), so the body is parsed
 * before the HTTP status is judged.
 */
const pacedApi =
  createPacedApiClient({
    /*
     * Start at the documented pace (one call per two
     * seconds) instead of probing with shorter gaps,
     * which exceeded the documented limit. user.info
     * calls from the background worker share the same
     * quota.
     */
    fastGapMs: 2_100,
    slowGapMs: 2_100,
    fetchJson: async (
      path,
      signal,
    ) => {
      const response =
        await fetch(
          `${API_BASE}${path}`,
          {
            cache: 'no-store',
            signal,
          },
        );

      let body: unknown =
        null;

      try {
        body =
          await response.json();
      } catch {
        body = null;
      }

      /*
       * Aborted while the body was still downloading:
       * report that, not a misleading "HTTP <status>".
       */
      if (signal?.aborted) {
        throw (
          signal.reason ??
          new Error(
            'Request aborted',
          )
        );
      }

      if (
        body &&
        typeof body ===
          'object' &&
        'status' in body
      ) {
        return body;
      }

      throw new Error(
        `Codeforces API HTTP ${response.status}`,
      );
    },
  });

/*
 * Every submission `handle` made in one contest,
 * including practice and virtual ones, newest first.
 * contestId must be a positive integer.
 */
export async function fetchContestSubmissionsByHandle(
  contestId: number,
  handle: string,
  signal?: AbortSignal,
): Promise<
  CodeforcesSubmission[]
> {
  const result =
    await pacedApi.get<
      CodeforcesSubmission[]
    >(
      `/contest.status?contestId=${contestId}&handle=${encodeURIComponent(handle)}`,
      signal,
    );

  return Array.isArray(
    result,
  )
    ? result
    : [];
}

/*
 * True when the fetched page itself shows a logged-in header. Used to
 * tell "you have no friends" from "you are not logged in": a logged-out
 * page has no friends table either, but no logged-in header.
 */
function pageShowsLoggedIn(doc: Document): boolean {
  try {
    return getLoggedInHandle(doc) !== null;
  } catch {
    return false;
  }
}

/* Longest the friends page may take, request and body together. */
const FRIENDS_PAGE_TIMEOUT_MS =
  20_000;

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
export async function fetchOnlineFriends(
  signal?: AbortSignal,
  timeoutMs = FRIENDS_PAGE_TIMEOUT_MS,
): Promise<
  string[]
> {
  /*
   * A time limit on the whole read (request and body), so a connection
   * that stalls can't hold up the scan forever. Aborting the caller's
   * `signal` still cancels it right away.
   */
  const limit =
    new AbortController();

  const relay = () => {
    limit.abort();
  };

  if (signal?.aborted) {
    relay();
  } else {
    signal?.addEventListener(
      'abort',
      relay,
      { once: true },
    );
  }

  const timer =
    setTimeout(
      relay,
      timeoutMs,
    );

  let html: string;

  try {
    const response =
      await fetch(
        'https://codeforces.com/friends',
        {
          credentials: 'include',
          cache: 'no-store',
          signal: limit.signal,
        },
      );

    if (!response.ok) {
      throw new Error(
        'Could not load your Codeforces friends page.',
      );
    }

    html =
      await response.text();
  } finally {
    clearTimeout(timer);

    signal?.removeEventListener(
      'abort',
      relay,
    );
  }

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
    /* Logged in but nothing to list: an empty list, not an error. */
    if (pageShowsLoggedIn(doc)) {
      return [];
    }

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
    if (pageShowsLoggedIn(doc)) {
      return [];
    }

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
 * green) directly from live data, and "Last visit:
 * 3 hours ago" for everyone else. Checking that
 * text per-friend is slower (one request per
 * friend) but is the only signal confirmed to be
 * accurate.
 *
 * The page is read in whatever language Codeforces
 * serves it (English or Russian, see profileLocales.ts);
 * the request never changes the user's language.
 *
 * Only a page with a "Last visit" value we understand
 * counts as an answer. Anything else (an error
 * status, a throttling or challenge page, a network
 * failure) is "unknown", never "offline", so a
 * failed check can't make someone disappear.
 */

/* The "Last visit" line sits near the top of the page; never read more than this. */
const PROFILE_MAX_CHARS =
  600_000;

/*
 * Reads the profile response only until the
 * "Last visit" line has been seen, then cancels the
 * rest of the download.
 */
async function readProfileHead(
  response: Response,
): Promise<string> {
  if (!response.body) {
    return response.text();
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let html = '';

  try {
    for (;;) {
      const {
        done,
        value,
      } = await reader.read();

      if (done) {
        break;
      }

      html +=
        decoder.decode(
          value,
          { stream: true },
        );

      const label =
        findLastVisitLabel(
          html,
        );

      if (
        label !== null &&
        html.length - label.index >=
          LAST_VISIT_CONTEXT_CHARS
      ) {
        break;
      }

      if (
        html.length >
        PROFILE_MAX_CHARS
      ) {
        break;
      }
    }
  } finally {
    reader
      .cancel()
      .catch(() => undefined);
  }

  return html;
}

export async function checkProfileOnlineStatus(
  handle: string,
  signal?: AbortSignal,
): Promise<OnlineStatus> {
  try {
    const response =
      await fetch(
        `https://codeforces.com/profile/${encodeURIComponent(
          handle,
        )}`,
        {
          cache: 'no-store',
          signal,
        },
      );

    /*
     * A handle that no longer exists is a definite
     * answer (not online), not a failure to retry.
     */
    if (response.status === 404) {
      return 'offline';
    }

    if (!response.ok) {
      return 'unknown';
    }

    return classifyProfileHtml(
      await readProfileHead(
        response,
      ),
    );
  } catch {
    return 'unknown';
  }
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

/* Slightly above the documented 2s between API calls. */
const USER_INFO_CHUNK_GAP_MS =
  2_100;

/*
 * Longest the extension waits for one user.info chunk. The background
 * worker gives up on its own request a little sooner (see
 * public/background.js), so this is the backstop for a worker that
 * never answers at all.
 */
const USER_INFO_TIMEOUT_MS =
  20_000;

export async function fetchUsersInfo(
  handles: string[],
  signal?: AbortSignal,
  timeoutMs = USER_INFO_TIMEOUT_MS,
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

  /*
   * One chunk at a time: parallel chunks would be an
   * unpaced burst against the documented limit of one
   * API call per two seconds, and a single rejected
   * chunk would discard all the others.
   */
  const results: CodeforcesUser[] =
    [];

  for (
    let index = 0;
    index < chunks.length;
    index += 1
  ) {
    if (index > 0) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            USER_INFO_CHUNK_GAP_MS,
          ),
      );
    }

    if (signal?.aborted) {
      throw new Error('Aborted.');
    }

    const response =
      (await withDeadline(
        runtime.sendMessage(
          {
            type:
              'CFPM_FETCH_USER_INFO',
            handles:
              chunks[index],
          },
        ),
        timeoutMs,
        signal,
        'Codeforces user.info',
      )) as UserInfoResponse;

    if (!response?.ok) {
      throw new Error(
        response?.error ||
          'Could not fetch Codeforces user information.',
      );
    }

    results.push(
      ...(response.data ?? []),
    );
  }

  return results;
}