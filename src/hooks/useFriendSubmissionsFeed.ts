import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  compareSummaries,
  summarizeFriend,
} from '../domain/friendSubmissions';

import type {
  FriendProblemSummary,
  ProblemRef,
} from '../domain/friendSubmissions';

import { fetchUsersInfoPaced } from '../services/codeforcesApi';
import { loadFriendHandles } from '../services/friendsList';

import {
  loadCachedUserInfo,
  saveCachedUserInfos,
} from '../services/userInfoCache';

import type { CachedUserInfo } from '../services/userInfoCache';

import { useFriendProblemSubmissions } from './useFriendProblemSubmissions';

export type FriendsListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; handles: string[] };

export interface FriendSubmissionRow {
  handle: string;
  rank?: string;
  rating?: number;
  summary: FriendProblemSummary;
}

export interface FriendSubmissionsFeed {
  list: FriendsListState;

  /* Friends with at least one submission on this problem, best first. */
  rows: FriendSubmissionRow[];

  /* True until every friend has been checked (or has failed). */
  busy: boolean;

  /* Friends whose submissions could not be loaded. */
  failed: number;
}

const NO_HANDLES: string[] = [];

/*
 * Everything behind the Friends submissions box: the friends list, the
 * rating colour of every friend, and each friend's submissions in the
 * problem's contest. Every friend is checked.
 *
 * The order matters for the request queue: the (few) rating requests go
 * first, then the submissions requests, one per friend. Everything that
 * was fetched before, in this tab or another, comes from the caches
 * (friends list, ratings, submissions) and sends nothing.
 *
 * Nothing runs while `active` is false (feature off or box closed).
 */
export function useFriendSubmissionsFeed(
  problem: ProblemRef,
  active: boolean,
): FriendSubmissionsFeed {
  const [list, setList] =
    useState<FriendsListState>({ status: 'loading' });

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller = new AbortController();

    setList(current =>
      current.status === 'ready' ? current : { status: 'loading' },
    );

    loadFriendHandles(controller.signal)
      .then(handles => {
        if (!controller.signal.aborted) {
          setList({ status: 'ready', handles });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setList({
          status: 'error',
          message:
            error instanceof Error && error.message
              ? error.message
              : 'Could not load your Codeforces friends.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [active]);

  const handles = useMemo(
    () => (list.status === 'ready' ? list.handles : NO_HANDLES),
    [list],
  );

  /*
   * A string, so the effect below depends on *which* friends there are,
   * not on the identity of the array.
   */
  const handlesKey = handles.map(handle => handle.toLowerCase()).join('\n');

  const [infos, setInfos] =
    useState<Record<string, CachedUserInfo>>({});

  /* The handles whose ratings are settled (answered, cached, or failed). */
  const [infoFor, setInfoFor] = useState('');

  useEffect(() => {
    if (!active || handlesKey === '') {
      return;
    }

    const wanted = handlesKey.split('\n');
    const known: Record<string, CachedUserInfo> = {};
    const missing: string[] = [];

    for (const key of wanted) {
      const cached = loadCachedUserInfo(key);

      if (cached) {
        known[key] = cached;
      } else {
        missing.push(key);
      }
    }

    setInfos(previous => ({ ...previous, ...known }));

    if (missing.length === 0) {
      setInfoFor(handlesKey);

      return;
    }

    const controller = new AbortController();

    fetchUsersInfoPaced(missing, controller.signal)
      .then(users => {
        if (controller.signal.aborted) {
          return;
        }

        const fresh: CachedUserInfo[] = users.map(user => ({
          handle: user.handle,
          rank: user.rank,
          rating: user.rating,
        }));

        saveCachedUserInfos(fresh);

        setInfos(previous => {
          const next = { ...previous };

          for (const info of fresh) {
            next[info.handle.toLowerCase()] = info;
          }

          return next;
        });

        setInfoFor(handlesKey);
      })
      .catch(() => {
        /* Failed or aborted. A failure only costs the colours: carry on. */
        if (!controller.signal.aborted) {
          setInfoFor(handlesKey);
        }
      });

    return () => {
      controller.abort();
    };
  }, [active, handlesKey]);

  /*
   * Submissions are requested only once the rating requests are done, so
   * that those are not queued behind one request per friend.
   */
  const infoSettled = infoFor === handlesKey && handlesKey !== '';

  const { entries } = useFriendProblemSubmissions(
    problem,
    infoSettled ? handles : NO_HANDLES,
    active,
  );

  const rows = useMemo(() => {
    const result: FriendSubmissionRow[] = [];

    for (const handle of handles) {
      const entry = entries[handle.toLowerCase()];

      if (entry?.status !== 'ready') {
        continue;
      }

      const summary = summarizeFriend(entry.submissions, problem.index);

      if (summary) {
        const info = infos[handle.toLowerCase()];

        result.push({
          handle: info?.handle ?? handle,
          rank: info?.rank,
          rating: info?.rating,
          summary,
        });
      }
    }

    return result.sort(compareSummaries);
  }, [handles, entries, infos, problem.index]);

  let failed = 0;
  let pending = 0;

  for (const handle of handles) {
    const status = entries[handle.toLowerCase()]?.status;

    if (status === 'error') {
      failed += 1;
    } else if (status !== 'ready') {
      pending += 1;
    }
  }

  return {
    list,
    rows,
    busy: list.status === 'loading' || (handles.length > 0 && pending > 0),
    failed,
  };
}
