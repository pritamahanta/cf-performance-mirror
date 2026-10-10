import type { ProblemRef } from '../domain/friendSubmissions';
import { getLoggedInHandle } from './onlineStore';

/*
 * Which of the user's friends have submitted a problem, from ONE request:
 * Codeforces' own "friends only" status page,
 *   /problemset/status/<contest>/problem/<index>?friends=on
 * (the page behind the "friends only" checkbox on a problem's status
 * page; it needs the user's login, like the friends list).
 *
 * It is used only to narrow down who needs an API lookup. The page does
 * not carry what the box shows besides that (time since the contest
 * started, the failing test number, the exact participation type: its
 * dates are in the account's own time zone, which the page does not
 * state), so the friends it lists still get the usual per-friend request,
 * and every friend it does not list is known to have nothing on this
 * problem, which saves their request altogether.
 *
 * The answer is trusted only when it is provably complete. Anything else
 * (not logged in, a different page, a row without a profile link such as a
 * team, a list that may continue on another page) gives null and the
 * caller checks every friend as before.
 */

/*
 * A page with this many rows or more is treated as possibly continued on a
 * next page. Codeforces' status pages hold 50 rows as far as is known;
 * the margin below that is deliberate, and the pagination markup is
 * checked as well.
 */
export const FRIENDS_STATUS_ROW_LIMIT = 25;

/* How long one answer is reused, per account and problem. */
export const FRIENDS_STATUS_TTL_MS = 2 * 60 * 1000;

/* Longest the page may take, request and body together. */
const FRIENDS_STATUS_TIMEOUT_MS = 8_000;

/* Lower-cased handle -> ids of that friend's submissions on the problem. */
export type FriendIdsByHandle = Map<string, number[]>;

export function friendsStatusUrl(problem: ProblemRef): string {
  return (
    `https://codeforces.com/problemset/status/${problem.contestId}` +
    `/problem/${encodeURIComponent(problem.index)}?friends=on`
  );
}

function handleFromHref(href: string | null): string | null {
  if (!href) {
    return null;
  }

  const match = /^\/profile\/([^/?#]+)/.exec(href);

  if (!match) {
    return null;
  }

  try {
    const handle = decodeURIComponent(match[1]).trim();

    return handle === '' ? null : handle;
  } catch {
    return null;
  }
}

/*
 * Reads the friends-only status page. Null means "do not rely on this
 * page" (see the top of the file); a Map, possibly empty, means these are
 * all the friends with a submission on the problem.
 */
export function parseFriendsStatusPage(html: string): FriendIdsByHandle | null {
  let doc: Document;

  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }

  /*
   * Proof that the server applied the friends filter: the page's own
   * "friends only" checkbox is ticked. Without it the rows could be
   * anyone's.
   */
  const friendsSwitch = doc.querySelector(
    'form.friendsEnabledSwitch input[name="friends"]',
  );

  if (!friendsSwitch || !friendsSwitch.hasAttribute('checked')) {
    return null;
  }

  /* The static page carries one hidden pagination prototype; a real one is a second page. */
  const continues =
    doc.querySelector('.page-index') !== null ||
    Array.from(doc.querySelectorAll('.pagination')).some(
      element => !element.classList.contains('next-or-prev-prototype'),
    );

  const rows = Array.from(doc.querySelectorAll('tr[data-submission-id]'));

  if (continues || rows.length >= FRIENDS_STATUS_ROW_LIMIT) {
    return null;
  }

  const byHandle: FriendIdsByHandle = new Map();

  for (const row of rows) {
    const id = Number(row.getAttribute('data-submission-id'));

    if (!Number.isSafeInteger(id) || id <= 0) {
      return null;
    }

    const links = Array.from(
      row.querySelectorAll('td.status-party-cell a[href^="/profile/"]'),
    );

    /* No profile link (a team, say): the friend behind the row is unknown. */
    if (links.length === 0) {
      return null;
    }

    for (const link of links) {
      const handle = handleFromHref(link.getAttribute('href'));

      if (!handle) {
        return null;
      }

      const key = handle.toLowerCase();
      const ids = byHandle.get(key);

      if (ids) {
        ids.push(id);
      } else {
        byHandle.set(key, [id]);
      }
    }
  }

  return byHandle;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const answers = new Map<string, { at: number; value: FriendIdsByHandle }>();
const running = new Map<string, Promise<FriendIdsByHandle | null>>();

export function clearFriendsStatusCache(): void {
  answers.clear();
  running.clear();
}

/*
 * The friends with a submission on `problem`, or null when this page
 * cannot be relied on (the caller then checks everyone). Never throws.
 * A null answer is not remembered.
 */
export async function loadFriendsOnProblem(
  problem: ProblemRef,
  signal?: AbortSignal,
  options: {
    fetcher?: Fetcher;
    now?: () => number;
    account?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<FriendIdsByHandle | null> {
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const account =
    options.account === undefined ? getLoggedInHandle() : options.account;

  /* The answer depends on whose friends they are: no known account, no answer. */
  if (!account || signal?.aborted) {
    return null;
  }

  const key =
    `${account.toLowerCase()}:${problem.contestId}:${problem.index.toUpperCase()}`;

  const known = answers.get(key);

  if (known && now() - known.at <= FRIENDS_STATUS_TTL_MS && known.at <= now()) {
    return known.value;
  }

  const shared = running.get(key);

  if (shared) {
    return shared;
  }

  const request = (async (): Promise<FriendIdsByHandle | null> => {
    const limit = new AbortController();
    const relay = () => limit.abort();

    signal?.addEventListener('abort', relay, { once: true });

    const timer = setTimeout(relay, options.timeoutMs ?? FRIENDS_STATUS_TIMEOUT_MS);

    try {
      const response = await fetcher(friendsStatusUrl(problem), {
        credentials: 'include',
        cache: 'no-store',
        signal: limit.signal,
      });

      if (!response.ok) {
        return null;
      }

      const value = parseFriendsStatusPage(await response.text());

      if (value) {
        answers.set(key, { at: now(), value });
      }

      return value;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  })().finally(() => {
    running.delete(key);
  });

  running.set(key, request);

  return request;
}

/*
 * Splits the friends by what the page says: `skip` have nothing on the
 * problem (no request needed); `scan` are the ones to look up, each with
 * the ids of the submissions the page showed (the looked-up copy must
 * contain them). With no page answer (null) everyone is scanned.
 */
export function planFriendScan(
  handles: readonly string[],
  onProblem: FriendIdsByHandle | null,
): { skip: string[]; scan: Array<{ handle: string; ids: number[] }> } {
  const skip: string[] = [];
  const scan: Array<{ handle: string; ids: number[] }> = [];

  for (const handle of handles) {
    const key = handle.toLowerCase();

    if (!onProblem) {
      scan.push({ handle, ids: [] });
    } else if (onProblem.has(key)) {
      scan.push({ handle, ids: onProblem.get(key) ?? [] });
    } else {
      skip.push(handle);
    }
  }

  return { skip, scan };
}
