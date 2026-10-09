import {
  useEffect,
  useMemo,
  useRef,
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

  /* Friends in scope of the current check limit. */
  inScope: number;

  /* Of those, how many are still being loaded / failed to load. */
  loading: number;
  failed: number;

  limit: number;
  checkMore: () => void;
}

interface UserInfo {
  handle: string;
  rank?: string;
  rating?: number;
}

/*
 * Everything behind the Friends submissions box: the friends list,
 * each friend's submissions in the problem's contest (30 friends at a
 * time, see useFriendProblemSubmissions), and the rating colour of
 * the friends who actually have something to show.
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
    () => (list.status === 'ready' ? list.handles : []),
    [list],
  );

  const { entries, limit, checkMore } =
    useFriendProblemSubmissions(problem, handles, active);

  const scope = useMemo(
    () => handles.slice(0, limit),
    [handles, limit],
  );

  const rowsBase = useMemo(() => {
    const result: { handle: string; summary: FriendProblemSummary }[] = [];

    for (const handle of scope) {
      const entry = entries[handle.toLowerCase()];

      if (entry?.status !== 'ready') {
        continue;
      }

      const summary = summarizeFriend(entry.submissions, problem.index);

      if (summary) {
        result.push({ handle, summary });
      }
    }

    return result;
  }, [scope, entries, problem.index]);

  let loading = 0;
  let failed = 0;

  for (const handle of scope) {
    const status = entries[handle.toLowerCase()]?.status;

    if (status === 'error') {
      failed += 1;
    } else if (status !== 'ready') {
      loading += 1;
    }
  }

  const [infos, setInfos] =
    useState<Record<string, UserInfo>>({});

  const requested = useRef<Set<string>>(new Set());

  /*
   * Ratings are asked for once a batch has finished loading, in one
   * call per up-to-100 handles, so the rows are not recoloured one by
   * one and the extra requests stay few. A call that fails is not
   * retried; those handles just stay uncoloured.
   */
  const missingKey = loading === 0
    ? rowsBase
        .map(row => row.handle.toLowerCase())
        .filter(key => !requested.current.has(key))
        .join('\n')
    : '';

  useEffect(() => {
    if (!active || missingKey === '') {
      return;
    }

    const controller = new AbortController();
    const wanted = missingKey.split('\n');
    let answered = false;

    for (const key of wanted) {
      requested.current.add(key);
    }

    fetchUsersInfoPaced(wanted, controller.signal)
      .then(users => {
        if (controller.signal.aborted) {
          return;
        }

        answered = true;

        setInfos(previous => {
          const next = { ...previous };

          for (const user of users) {
            next[user.handle.toLowerCase()] = {
              handle: user.handle,
              rank: user.rank,
              rating: user.rating,
            };
          }

          return next;
        });
      })
      .catch(() => {
        /* A failed call is not retried: the handles stay uncoloured. */
        answered = !controller.signal.aborted;
      });

    return () => {
      controller.abort();

      /* No answer yet (box closed meanwhile): ask again when it reopens. */
      if (!answered) {
        for (const key of wanted) {
          requested.current.delete(key);
        }
      }
    };
  }, [active, missingKey]);

  const rows = useMemo(() => {
    const full: FriendSubmissionRow[] = rowsBase.map(row => {
      const info = infos[row.handle.toLowerCase()];

      return {
        handle: info?.handle ?? row.handle,
        rank: info?.rank,
        rating: info?.rating,
        summary: row.summary,
      };
    });

    return full.sort(compareSummaries);
  }, [rowsBase, infos]);

  return {
    list,
    rows,
    inScope: scope.length,
    loading,
    failed,
    limit,
    checkMore,
  };
}
