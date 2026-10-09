import {
  useEffect,
  useRef,
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
 * Safety valve: with a very large number of
 * friends, only the first few are checked, so opening a
 * problem page can never turn into an unbounded burst of
 * API calls. This is also the batch size: the panel
 * offers a button that raises the limit by this many
 * (see `checkMore`), so every extra request is something
 * the user asked for.
 */
export const MAX_FRIENDS_CHECKED = 30;

export interface FriendProblemSubmissions {
  entries: Record<string, FriendProblemEntry>;

  /* How many friends, counted from the top of the list, are being checked. */
  limit: number;

  /* Raises the limit by one batch (MAX_FRIENDS_CHECKED). */
  checkMore: () => void;
}

/*
 * For each given friend, loads their submissions
 * in the problem's contest so the panel can tell who has
 * solved it. Results are keyed by lower-cased handle.
 *
 * Nothing runs when `problem` is null (any page that is
 * not a problem page), so other pages make no extra
 * requests at all. Calls are queued one at a time by the
 * service layer, and results arrive progressively; the
 * friends list itself never waits on them.
 *
 * Nothing runs while `active` is false either, and turning
 * it off cancels every call still queued or in flight (the
 * queue holds up to `limit` of them, spaced out over
 * several seconds, so merely ignoring their results would
 * still send them).
 */
export function useFriendProblemSubmissions(
  problem: ProblemRef | null,
  handles: readonly string[],
  active: boolean,
): FriendProblemSubmissions {
  const [batches, setBatches] =
    useState(1);

  const limit =
    MAX_FRIENDS_CHECKED *
    batches;

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
        limit,
      )
      .join('\n');

  /*
   * One AbortController per period in which `active` is
   * true. Declared before the effect below so that, in the
   * same commit, it has already been created when that
   * effect reads it. A change of friends does not abort
   * it: calls already queued for friends who are still
   * online are kept and shared, as before.
   */
  const controllerRef =
    useRef<AbortController | null>(
      null,
    );

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller =
      new AbortController();

    controllerRef.current =
      controller;

    return () => {
      controller.abort();

      if (
        controllerRef.current ===
        controller
      ) {
        controllerRef.current =
          null;
      }
    };
  }, [active]);

  useEffect(() => {
    const signal =
      controllerRef.current
        ?.signal;

    if (
      !active ||
      !signal ||
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
        signal,
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
  }, [active, contestId, handlesKey]);

  return {
    entries,
    limit,
    checkMore: () => {
      setBatches(
        current =>
          current + 1,
      );
    },
  };
}
