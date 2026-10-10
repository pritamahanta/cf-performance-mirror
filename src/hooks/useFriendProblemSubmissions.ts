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

import {
  loadFriendsOnProblem,
  planFriendScan,
} from '../services/friendsStatusPage';

import type {
  FriendIdsByHandle,
} from '../services/friendsStatusPage';

export type { FriendProblemEntry };

/*
 * What the friends-only status page said about one problem. `answer` is
 * null when it could not be relied on (everyone is then checked). The
 * key says which problem it is for, so an answer is never applied to
 * another one.
 */
interface PageLookup {
  key: string;
  answer: FriendIdsByHandle | null;
}

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
 * One request to Codeforces' friends-only status page for the problem
 * (see friendsStatusPage.ts) tells which friends have submitted it at
 * all. Only those friends are then looked up; the others are known to
 * have nothing on this problem and cost no request. When that page is
 * unavailable or cannot be trusted, every friend is looked up, as before.
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

  const problemIndex =
    problem
      ? problem.index
      : null;

  const pageKey =
    contestId !== null && problemIndex !== null
      ? `${contestId}:${problemIndex}`
      : null;

  const [lookup, setLookup] =
    useState<PageLookup | null>(null);

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

  const hasHandles =
    handlesKey !== '';

  /*
   * The one friends-only status page request. It starts as soon as the
   * friends are known, in parallel with the ratings, and does not wait
   * for `fetching`.
   */
  useEffect(() => {
    const signal =
      controllerRef.current
        ?.signal;

    if (
      !active ||
      !signal ||
      !hasHandles ||
      contestId === null ||
      problemIndex === null ||
      pageKey === null
    ) {
      return;
    }

    let cancelled =
      false;

    loadFriendsOnProblem(
      {
        contestId,
        index: problemIndex,
      },
      signal,
    ).then(answer => {
      if (!cancelled) {
        setLookup({
          key: pageKey,
          answer,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [active, hasHandles, contestId, problemIndex, pageKey]);

  const lookupSettled =
    lookup !== null &&
    lookup.key === pageKey;

  const onProblem =
    lookupSettled
      ? lookup.answer
      : null;

  useEffect(() => {
    const signal =
      controllerRef.current
        ?.signal;

    if (
      !active ||
      !fetching ||
      !lookupSettled ||
      !signal ||
      contestId === null ||
      handlesKey === ''
    ) {
      return;
    }

    let cancelled =
      false;

    const plan =
      planFriendScan(
        handlesKey.split('\n'),
        onProblem,
      );

    /*
     * Friends the page does not list have no submission on this problem:
     * settled at once, nothing sent. In memory only - this is not their
     * contest-wide data, so it must never reach the shared cache.
     */
    for (const handle of plan.skip) {
      setEntries(previous =>
        applyFresh(previous, handle, []),
      );
    }

    for (const {
      handle,
      ids,
    } of plan.scan) {
      setEntries(previous =>
        applyRequested(previous, handle),
      );

      loadFriendContestSubmissions(
        contestId,
        handle,
        signal,
        ids,
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
  }, [active, fetching, lookupSettled, onProblem, contestId, handlesKey]);

  return { entries };
}
