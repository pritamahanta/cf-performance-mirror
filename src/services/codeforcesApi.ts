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

/*
 * user.info through the same serial, paced queue as contest.status
 * (never overlapping with it), for callers that already queue their
 * other API calls there. Unlike fetchUsersInfo this goes straight to
 * the API from the page.
 *
 * Codeforces rejects the whole call if any handle in it does not
 * exist, so a failure here means "no ratings for this chunk", not
 * "no ratings at all": the caller keeps going without them.
 */
export async function fetchUsersInfoPaced(
  handles: readonly string[],
  signal?: AbortSignal,
): Promise<CodeforcesUser[]> {
  const result: CodeforcesUser[] = [];

  for (let i = 0; i < handles.length; i += USER_INFO_CHUNK_SIZE) {
    const chunk = handles.slice(i, i + USER_INFO_CHUNK_SIZE);

    try {
      const users = await pacedApi.get<CodeforcesUser[]>(
        `/user.info?handles=${chunk.map(encodeURIComponent).join(';')}`,
        signal,
      );

      if (Array.isArray(users)) {
        result.push(...users);
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
    }
  }

  return result;
}

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

/* Longest the extension waits for a submission page to load. */
const SUBMISSION_PAGE_TIMEOUT_MS =
  15_000;

/*
 * Codeforces renders a viewable submission's source directly on its
 * own page, inside `<pre id="program-source-text">` - the same
 * element its own "view source" dialog reads from. There is no
 * public API for this (user.status never includes source), so this
 * reads the submission's own page the same way fetchOnlineFriends and
 * checkProfileOnlineStatus already read other Codeforces pages.
 *
 * Codeforces wraps that source in its own syntax-highlighting spans
 * (that's what gives the real "view source" dialog its colors), so
 * both forms are returned: `html` (the element's innerHTML, kept as
 * markup so the overlay can render it and inherit those colors from
 * Codeforces' own stylesheet, already loaded on the page this content
 * script runs in - no colors are invented here) and `text` (the
 * element's textContent, the exact plain source, for the Copy button
 * and as the signal of whether anything was actually found).
 *
 * Not every submission is viewable this way - the author may have
 * restricted it, or the viewer may simply not be allowed to see it -
 * so a page that loads but has no such element throws, rather than
 * returning something that looks like source but is not. The caller
 * is expected to fall back to linking straight to `url` when this
 * rejects.
 */
export interface SubmissionSource {
  html: string;
  text: string;
}

/*
 * The wording for a refused submission-page request. Exported for tests.
 * `head` is the start of the response body ('' if none could be read).
 */
export function describeSubmissionPageFailure(
  status: number,
  head: string,
): string {
  const challenge =
    /cf-chl|challenge-platform|Just a moment|Attention Required|cf-browser-verification/i.test(
      head,
    );

  if (challenge) {
    return `Codeforces' bot protection blocked the request (status ${status}). Open any Codeforces page in this browser, pass the check if one is shown, then try again.`;
  }

  if (status === 403) {
    return 'Codeforces answered "forbidden" (status 403) for this submission. It may not allow your account to view this user\'s source code.';
  }

  return `Could not load the submission page (status ${status}).`;
}

/* Longest the hidden page may take to load. */
const FRAME_TIMEOUT_MS =
  15_000;

/*
 * Second try for a submission page that the plain request was refused
 * for: load the same page the way a link click would (a hidden iframe,
 * same origin, so its document can be read) and take the source from it.
 * Returns null when it cannot - no DOM, aborted, timed out, blocked from
 * framing, or the page has no source - and the caller then reports the
 * original refusal. The frame is always removed again.
 */
export function loadSourceInFrame(
  url: string,
  signal?: AbortSignal,
  timeoutMs = FRAME_TIMEOUT_MS,
): Promise<SubmissionSource | null> {
  return new Promise(resolve => {
    if (
      typeof document ===
        'undefined' ||
      !document.body ||
      signal?.aborted
    ) {
      resolve(null);

      return;
    }

    const frame =
      document.createElement(
        'iframe',
      );

    frame.setAttribute(
      'aria-hidden',
      'true',
    );

    frame.tabIndex =
      -1;

    frame.style.cssText =
      'position:fixed;left:-9999px;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';

    let finished =
      false;

    const finish = (
      value: SubmissionSource | null,
    ) => {
      if (finished) {
        return;
      }

      finished =
        true;

      clearTimeout(
        timer,
      );

      signal?.removeEventListener(
        'abort',
        onAbort,
      );

      frame.remove();

      resolve(
        value,
      );
    };

    const onAbort = () =>
      finish(null);

    const timer =
      setTimeout(
        onAbort,
        timeoutMs,
      );

    signal?.addEventListener(
      'abort',
      onAbort,
      { once: true },
    );

    frame.addEventListener(
      'load',
      () => {
        try {
          const element =
            frame.contentDocument?.querySelector(
              '#program-source-text',
            );

          const text =
            element?.textContent;

          finish(
            element &&
              text &&
              text.trim()
              ? {
                  html: element.innerHTML,
                  text,
                }
              : null,
          );
        } catch {
          /* Not readable (blocked or cross-origin): no result. */
          finish(null);
        }
      },
    );

    frame.src =
      url;

    document.body.appendChild(
      frame,
    );
  });
}

export async function fetchSubmissionSourceText(
  url: string,
  signal?: AbortSignal,
  timeoutMs = SUBMISSION_PAGE_TIMEOUT_MS,
): Promise<SubmissionSource> {
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

  let failure: Error | null =
    null;

  let refused =
    false;

  try {
    const response =
      await fetch(
        url,
        {
          credentials: 'include',
          cache: 'no-store',
          signal: limit.signal,
        },
      );

    if (!response.ok) {
      /*
       * Say what kind of refusal it was. A 403 can come from
       * Codeforces itself (it limits who may view a submission's
       * source) or from the bot protection in front of it, and
       * the two need different advice; the start of the body tells
       * them apart. The status always stays in the message.
       */
      let head =
        '';

      try {
        head =
          (
            await response.text()
          ).slice(
            0,
            4000,
          );
      } catch {
        // No readable body: classified by status alone.
      }

      failure =
        new Error(
          describeSubmissionPageFailure(
            response.status,
            head,
          ),
        );

      /* The fallback below only retries a refusal, not other failures. */
      refused =
        response.status ===
        403;

      throw failure;
    }

    html =
      await response.text();
  } catch (error) {
    if (
      refused &&
      error ===
        failure
    ) {
      const viaFrame =
        await loadSourceInFrame(
          url,
          signal,
          timeoutMs,
        );

      if (viaFrame) {
        return viaFrame;
      }
    }

    throw error;
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

  const sourceEl =
    doc.querySelector(
      '#program-source-text',
    );

  const sourceText =
    sourceEl?.textContent;

  if (
    !sourceText ||
    !sourceText.trim()
  ) {
    throw new Error(
      "Couldn't load this submission's source code inline.",
    );
  }

  /*
   * Not `instanceof HTMLElement`: that global does not exist outside
   * a real DOM (notably in this project's node:test suite, which
   * fakes DOMParser), so the markup is kept whenever the parsed
   * element actually has an innerHTML string to offer, real DOM or
   * fake, and the plain text is the fallback otherwise.
   */
  const sourceHtml =
    typeof (
      sourceEl as {
        innerHTML?: unknown;
      }
    )?.innerHTML ===
    'string'
      ? (
          sourceEl as unknown as {
            innerHTML: string;
          }
        ).innerHTML
      : sourceText;

  return {
    html: sourceHtml,
    text: sourceText,
  };
}