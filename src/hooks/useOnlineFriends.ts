import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  checkProfileOnlineStatus,
  fetchOnlineFriends,
  fetchUsersInfo,
} from '../services/codeforcesApi';

import {
  OnlineFriendsPoller,
} from '../services/onlinePoller';

import type {
  PollerState,
  Progress,
} from '../services/onlinePoller';

import type {
  OnlineFriend,
} from '../domain/friends';

/*
 * The panel-facing state. "loading" and "ready" may carry
 * `progress` while a long scan is still running, so the list can
 * grow as results arrive instead of waiting for every friend.
 */
export type OnlineFriendsState =
  | {
      status: 'loading';
      progress: Progress | null;
    }
  | {
      status: 'ready';
      friends: OnlineFriend[];
      updatedAt: number;
      progress: Progress | null;

      /* Some friends could not be checked; they show their last known status. */
      incomplete: boolean;
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
   * The initial load and the automatic refreshes
   * never set it, so they stay visually silent.
   */
  refreshing: boolean;

  refresh: () => void;
}

function createPoller(): OnlineFriendsPoller {
  return new OnlineFriendsPoller(
    {
      fetchFriends: fetchOnlineFriends,
      checkProfile: checkProfileOnlineStatus,
      fetchInfo: fetchUsersInfo,
    },
    {
      isHidden: () =>
        document.hidden,
      subscribe: callback => {
        document.addEventListener(
          'visibilitychange',
          callback,
        );

        return () => {
          document.removeEventListener(
            'visibilitychange',
            callback,
          );
        };
      },
    },
  );
}

function toPanelState(
  state: PollerState,
): OnlineFriendsState {
  switch (state.status) {
    case 'loading':
      return {
        status: 'loading',
        progress:
          state.progress,
      };

    case 'error':
      return {
        status: 'error',
        message:
          state.message,
      };

    default:
      return {
        status: 'ready',
        friends:
          state.friends,
        updatedAt:
          state.updatedAt,
        progress:
          state.progress,
        incomplete:
          state.incomplete,
      };
  }
}

export function useOnlineFriends(
  active: boolean,
): Result {
  const pollerRef =
    useRef<OnlineFriendsPoller | null>(
      null,
    );

  if (pollerRef.current === null) {
    pollerRef.current =
      createPoller();
  }

  const poller =
    pollerRef.current;

  const [snapshot, setSnapshot] =
    useState<PollerState>(() =>
      poller.getState(),
    );

  useEffect(() => {
    if (!active) {
      return;
    }

    const unsubscribe =
      poller.subscribe(() => {
        setSnapshot(
          poller.getState(),
        );
      });

    poller.start();

    return () => {
      unsubscribe();

      /*
       * Hidden: stop all requests and drop the old list so
       * turning the box back on starts from a clean
       * "loading" state instead of flashing stale friends.
       */
      poller.stop();

      setSnapshot(
        poller.getState(),
      );
    };
  }, [active, poller]);

  return {
    state:
      toPanelState(
        snapshot,
      ),
    refreshing:
      snapshot.refreshing,
    refresh: () => {
      poller.refresh();
    },
  };
}
