import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  fetchOnlineFriends,
  fetchUsersInfo,
} from '../services/codeforcesApi';

import {
  mergeFriendsWithInfo,
} from '../domain/friends';

import type {
  OnlineFriend,
} from '../domain/friends';

const REFRESH_INTERVAL_MS = 60_000;

/*
 * A friend is considered online when Codeforces has seen
 * them online within the last 5 minutes.
 */
const ONLINE_THRESHOLD_SECONDS =
  5 * 60;

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

  stateRef.current = state;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

    const current =
      stateRef.current;

    /*
     * Keep the existing list visible while refreshing.
     */
    setState(
      current.status === 'ready'
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
         * This returns the user's complete friend list
         * from the authenticated Codeforces /friends page.
         */
        const handles =
          await fetchOnlineFriends();

        /*
         * Fetch rating + lastOnlineTimeSeconds for all friends.
         */
        const infos =
          handles.length > 0
            ? await fetchUsersInfo(handles)
            : [];

        const nowSeconds =
          Math.floor(
            Date.now() / 1000,
          );

        /*
         * Only keep friends whose last observed online time
         * is within the last 5 minutes.
         */
        const onlineInfos =
          infos.filter(info => {
            const lastOnline =
              info.lastOnlineTimeSeconds;

            if (
              typeof lastOnline !==
              'number'
            ) {
              return false;
            }

            const elapsed =
              nowSeconds -
              lastOnline;

            return (
              elapsed >= 0 &&
              elapsed <
                ONLINE_THRESHOLD_SECONDS
            );
          });

        /*
         * Use the handles from the filtered user objects,
         * not the complete friend list.
         */
        const onlineHandles =
          onlineInfos.map(
            info => info.handle,
          );

        if (cancelled) {
          return;
        }

        setState({
          status: 'ready',
          friends:
            mergeFriendsWithInfo(
              onlineHandles,
              onlineInfos,
            ),
          updatedAt: Date.now(),
          refreshing: false,
        });
      } catch {
        if (cancelled) {
          return;
        }

        /*
         * During a refresh, preserve the previous successful
         * list rather than replacing it with an error.
         */
        setState(previous =>
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
      window.setInterval(() => {
        setTick(
          count => count + 1,
        );
      }, REFRESH_INTERVAL_MS);

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
        count => count + 1,
      ),
  };
}