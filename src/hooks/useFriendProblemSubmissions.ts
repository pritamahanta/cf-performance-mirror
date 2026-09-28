import {
  useEffect,
  useState,
} from 'react';

import type {
  FriendSubmission,
  ProblemRef,
} from '../domain/friendSubmissions';

import {
  loadFriendContestSubmissions,
} from '../services/friendSubmissions';

export type FriendProblemEntry =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      /*
       * Everything the friend submitted in this problem's
       * contest (all problems); the caller narrows it to
       * the current problem.
       */
      submissions: FriendSubmission[];
    }
  | {
      status: 'error';
    };

/*
 * Safety valve: with a very large number of online
 * friends, only the first few are checked, so opening a
 * problem page can never turn into an unbounded burst of
 * API calls.
 */
export const MAX_FRIENDS_CHECKED = 30;

/*
 * For each given (online) friend, loads their submissions
 * in the problem's contest so the panel can tell who has
 * solved it. Results are keyed by lower-cased handle.
 *
 * Nothing runs when `problem` is null (any page that is
 * not a problem page), so other pages make no extra
 * requests at all. Calls are queued one at a time by the
 * service layer, and results arrive progressively; the
 * friends list itself never waits on them.
 */
export function useFriendProblemSubmissions(
  problem: ProblemRef | null,
  handles: readonly string[],
): Record<string, FriendProblemEntry> {
  const [entries, setEntries] =
    useState<
      Record<
        string,
        FriendProblemEntry
      >
    >({});

  const contestId =
    problem
      ? problem.contestId
      : null;

  /*
   * A string, so the effect below depends on *which*
   * friends are online, not on the identity of the array
   * (the list is rebuilt on every 60s refresh).
   */
  const handlesKey =
    Array.from(
      new Set(
        handles.map(handle =>
          handle.toLowerCase(),
        ),
      ),
    )
      .slice(
        0,
        MAX_FRIENDS_CHECKED,
      )
      .join('\n');

  useEffect(() => {
    if (
      contestId === null ||
      handlesKey === ''
    ) {
      return;
    }

    let cancelled =
      false;

    for (const handle of handlesKey.split(
      '\n',
    )) {
      setEntries(previous =>
        previous[handle]
          ?.status ===
        'ready'
          ? previous
          : {
              ...previous,
              [handle]: {
                status:
                  'loading',
              },
            },
      );

      loadFriendContestSubmissions(
        contestId,
        handle,
      )
        .then(submissions => {
          if (cancelled) {
            return;
          }

          setEntries(
            previous => ({
              ...previous,
              [handle]: {
                status:
                  'ready',
                submissions,
              },
            }),
          );
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setEntries(
            previous => ({
              ...previous,
              [handle]: {
                status:
                  'error',
              },
            }),
          );
        });
    }

    return () => {
      cancelled = true;
    };
  }, [contestId, handlesKey]);

  return entries;
}
