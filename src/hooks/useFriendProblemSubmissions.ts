import {
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  ProblemRef,
} from '../domain/friendSubmissions';

import {
  applyFailure,
  applyFresh,
  applyRequested,
  applyStored,
} from '../domain/friendEntries';

import type {
  FriendEntries,
  FriendProblemEntry,
} from '../domain/friendEntries';

import {
  loadFriendContestSubmissions,
  peekStoredFriendSubmissions,
} from '../services/friendSubmissions';

export type { FriendProblemEntry };

export interface FriendProblemSubmissions {
  entries: FriendEntries;
}

/*
 * For each given friend, loads their submissions
 * in the problem's contest so the panel can tell who has
 * solved it. Results are keyed by lower-cased handle.
 *
 * Nothing runs when `problem` is null (any page that is
 * not a problem page), so other pages make no extra
 * requests at all. Every friend is checked. Calls are queued one at a time by the
 * service layer, and results arrive progressively; the
 * friends list itself never waits on them.
 *
 * Old results are shown first: whatever is stored for a friend,
 * even when it is no longer up to date, appears at once (marked
 * `stale: 'updating'`) and is replaced when that friend's fresh
 * request returns. Showing it sends nothing, and the requests made
 * are exactly the ones that were made before: only friends whose
 * stored copy is not up to date are asked again.
 *
 * `fetching` lets the caller hold the requests back (while ratings
 * are still being fetched, say) without delaying the stored copies.
 *
 * Nothing runs while `active` is false either, and turning
 * it off cancels every call still queued or in flight (the
 * queue can hold one per friend, spaced out over
 * several seconds, so merely ignoring their results would
 * still send them).
 */
export function useFriendProblemSubmissions(
  problem: ProblemRef | null,
  handles: readonly string[],
  active: boolean,
  fetching: boolean = true,
): FriendProblemSubmissions {
  const [entries, setEntries] =
    useState<FriendEntries>({});

  const contestId =
    problem
      ? problem.contestId
      : null;

  /*
   * A string, so the effects below depend on *which*
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

  /* Stored copies first: no request, so it is instant. */
  useEffect(() => {
    if (
      !active ||
      contestId === null ||
      handlesKey === ''
    ) {
      return;
    }

    const found: Array<[string, NonNullable<ReturnType<typeof peekStoredFriendSubmissions>>]> = [];

    for (const handle of handlesKey.split('\n')) {
      const stored =
        peekStoredFriendSubmissions(
          contestId,
          handle,
        );

      if (stored) {
        found.push([handle, stored]);
      }
    }

    if (found.length === 0) {
      return;
    }

    setEntries(previous => {
      let next = previous;

      for (const [handle, stored] of found) {
        next = applyStored(next, handle, stored);
      }

      return next;
    });
  }, [active, contestId, handlesKey]);

  useEffect(() => {
    const signal =
      controllerRef.current
        ?.signal;

    if (
      !active ||
      !fetching ||
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
        applyRequested(previous, handle),
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

          setEntries(previous =>
            applyFresh(previous, handle, submissions),
          );
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          setEntries(previous =>
            applyFailure(previous, handle),
          );
        });
    }

    return () => {
      cancelled = true;
    };
  }, [active, fetching, contestId, handlesKey]);

  return { entries };
}
