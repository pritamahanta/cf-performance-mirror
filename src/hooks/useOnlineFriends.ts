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
 * Checking online status now means one request
 * per friend (see fetchOnlineHandles), not one
 * batched API call, so refreshing every 2 minutes
 * instead of every 1 keeps request volume more
 * reasonable.
 */
const REFRESH_INTERVAL_MS =
  120_000;

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
      refreshing: boolean;
    }
  | {
      status: 'error';
      message: string;
    };

interface Result {
  state: OnlineFriendsState;
  refresh: () => void;
}

export function useOnlineFriends(
  active: boolean,
): Result {
  const [state, setState] =
    useState<OnlineFriendsState>({
      status: 'loading',
    });

  const [tick, setTick] =
    useState(0);

  const stateRef =
    useRef(state);

  stateRef.current =
    state;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled =
      false;

    const current =
      stateRef.current;

    setState(
      current.status ===
        'ready'
        ? {
            ...current,
            refreshing: true,
          }
        : {
            status: 'loading',
          },
    );

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
          refreshing: false,
        });
      } catch {
        if (cancelled) {
          return;
        }

        setState(
          previous =>
            previous.status ===
            'ready'
              ? {
                  ...previous,
                  refreshing: false,
                }
              : {
                  status: 'error',
                  message:
                    LOAD_ERROR_MESSAGE,
                },
        );
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
    refresh: () =>
      setTick(
        count =>
          count + 1,
      ),
  };
}