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

const REFRESH_INTERVAL_MS =
  60_000;

/*
 * Consider a friend online when Codeforces has
 * seen them online within the last 5 minutes.
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

  stateRef.current =
    state;

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;

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
         * Get all handles from the authenticated
         * Codeforces /friends page.
         */
        const handles =
          await fetchOnlineFriends();

        /*
         * Get fresh public information for those
         * handles, including lastOnlineTimeSeconds.
         */
        const infos =
          handles.length > 0
            ? await fetchUsersInfo(
                handles,
              )
            : [];

        const nowSeconds =
          Math.floor(
            Date.now() / 1000,
          );

        /*
         * Keep only users whose last online time
         * is within the configured threshold.
         *
         * We intentionally do not require diff >= 0,
         * because the client/server clocks can differ
         * slightly.
         */
        const onlineInfos =
          infos.filter(
            info => {
              const lastOnline =
                info.lastOnlineTimeSeconds;

              if (
                typeof lastOnline !==
                'number'
              ) {
                return false;
              }

              const diff =
                nowSeconds -
                lastOnline;

              return (
                diff <
                ONLINE_THRESHOLD_SECONDS
              );
            },
          );

        if (cancelled) {
          return;
        }

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

        /*
         * Keep the previous successful list
         * during a refresh failure.
         */
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
            count => count + 1,
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
        count => count + 1,
      ),
  };
}