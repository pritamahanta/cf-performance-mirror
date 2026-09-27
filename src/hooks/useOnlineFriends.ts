import { useEffect, useRef, useState } from 'react';
import { fetchOnlineFriends, fetchUsersInfo } from '../services/codeforcesApi';
import { mergeFriendsWithInfo } from '../domain/friends';
import type { OnlineFriend } from '../domain/friends';

const REFRESH_INTERVAL_MS = 60_000;
const LOAD_ERROR_MESSAGE = "Couldn't load your online friends. Make sure you're logged in to Codeforces.";

export type OnlineFriendsState =
  | { status: 'loading' }
  | { status: 'ready'; friends: OnlineFriend[]; updatedAt: number; refreshing: boolean }
  | { status: 'error'; message: string };

interface Result {
  state: OnlineFriendsState;
  refresh: () => void;
}

// `active` gates both the fetch and the polling interval, so the panel does
// no network work at all while the user has it hidden via settings.
export function useOnlineFriends(active: boolean): Result {
  const [state, setState] = useState<OnlineFriendsState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const current = stateRef.current;
    setState(current.status === 'ready' ? { ...current, refreshing: true } : { status: 'loading' });

    (async () => {
      try {
        const handles = await fetchOnlineFriends();
        const infos = handles.length ? await fetchUsersInfo(handles) : [];
        if (cancelled) return;
        setState({
          status: 'ready',
          friends: mergeFriendsWithInfo(handles, infos),
          updatedAt: Date.now(),
          refreshing: false,
        });
      } catch {
        if (cancelled) return;
        // A refresh failure keeps showing the last good list instead of
        // replacing it with an error; only a failed *first* load shows one.
        setState(previous => (previous.status === 'ready'
          ? { ...previous, refreshing: false }
          : { status: 'error', message: LOAD_ERROR_MESSAGE }));
      }
    })();

    return () => { cancelled = true; };
  }, [active, tick]);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setTick(count => count + 1), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [active]);

  return { state, refresh: () => setTick(count => count + 1) };
}