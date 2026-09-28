import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  fetchOnlineFriends,
  fetchOnlineHandles,
  fetchUsersInfo,
} from '../services/codeforcesApi';

import {
  mergeFriendsWithInfo,
} from '../domain/friends';

import type {
  OnlineFriend,
} from '../domain/friends';

/*
 * Checking online status means one request per
 * friend (see fetchOnlineHandles), not one batched
 * call, so this can't be as tight as a typical
 * poll without risking heavy, sustained load on
 * codeforces.com. 60s is a middle ground: noticeably
 * live, without firing ~1 request/friend every few
 * seconds indefinitely. The panel's own refresh
 * button (bottom row) still gives an instant manual
 * check any time.
 */
const REFRESH_INTERVAL_MS =
  60_000;

const LOAD_ERROR_MESSAGE =
  "Couldn't load your online friends. Make sure you're logged in to Codeforces.";

export type OnlineFriendsState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      friends: OnlineFriend[];
      updatedAt: number;
    }
  | {
      status: 'error';
      message: string;
    };

interface Result {
  state: OnlineFriendsState;

  /*
   * True only while a refresh the user asked for
   * (by clicking the refresh button) is running.
   * The initial load and the 60s auto-refresh
   * never set it, so they stay visually silent.
   */
  refreshing: boolean;

  refresh: () => void;
}

export function useOnlineFriends(
  active: boolean,
): Result {
  const [state, setState] =
    useState<OnlineFriendsState>({
      status: 'loading',
    });

  const [refreshing, setRefreshing] =
    useState(false);

  const [tick, setTick] =
    useState(0);

  const stateRef =
    useRef(state);

  stateRef.current =
    state;

  /*
   * Set by refresh() so the effect below can tell
   * a click apart from the interval's auto tick.
   */
  const manualRef =
    useRef(false);

  useEffect(() => {
    if (!active) {
      /*
       * Hidden: drop the old list so turning the
       * box back on starts from a clean "loading"
       * state instead of flashing stale friends.
       */
      setState(previous =>
        previous.status ===
        'loading'
          ? previous
          : {
              status:
                'loading',
            },
      );

      setRefreshing(false);

      return;
    }

    let cancelled =
      false;

    const manual =
      manualRef.current;

    manualRef.current =
      false;

    /*
     * Only a click gets visible feedback. Auto
     * refreshes leave the current list and the
     * refresh button exactly as they are until
     * fresh data quietly replaces them.
     */
    if (manual) {
      setRefreshing(true);

      if (
        stateRef.current
          .status ===
        'error'
      ) {
        setState({
          status:
            'loading',
        });
      }
    }

    (async () => {
      try {
        /*
         * This returns all friends from the
         * authenticated /friends page.
         */
        const handles =
          await fetchOnlineFriends();

        /*
         * This now executes user.info from
         * the extension service worker. Used
         * only for rating/rank display - not
         * for online status (see below).
         */
        const infos =
          handles.length > 0
            ? await fetchUsersInfo(
                handles,
              )
            : [];

        /*
         * user.info's lastOnlineTimeSeconds can
         * lag the live site by an hour or more,
         * so online status is instead read
         * directly off each friend's profile
         * page, which reflects live data.
         */
        const onlineHandleSet =
          handles.length > 0
            ? await fetchOnlineHandles(
                handles,
              )
            : new Set<string>();

        if (cancelled) {
          return;
        }

        const onlineInfos =
          infos.filter(
            info =>
              onlineHandleSet.has(
                info.handle,
              ),
          );

        const onlineHandles =
          onlineInfos.map(
            info =>
              info.handle,
          );

        setState({
          status: 'ready',
          friends:
            mergeFriendsWithInfo(
              onlineHandles,
              onlineInfos,
            ),
          updatedAt:
            Date.now(),
        });
      } catch {
        if (cancelled) {
          return;
        }

        /*
         * A failed refresh keeps whatever list is
         * already on screen. The error message is
         * only for when there is nothing to show.
         */
        setState(
          previous =>
            previous.status ===
            'ready'
              ? previous
              : {
                  status: 'error',
                  message:
                    LOAD_ERROR_MESSAGE,
                },
        );
      } finally {
        if (!cancelled) {
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, tick]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval =
      window.setInterval(
        () => {
          setTick(
            count =>
              count + 1,
          );
        },
        REFRESH_INTERVAL_MS,
      );

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [active]);

  return {
    state,
    refreshing,
    refresh: () => {
      manualRef.current =
        true;

      setTick(
        count =>
          count + 1,
      );
    },
  };
}