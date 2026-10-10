import type { FriendSubmission } from './friendSubmissions';

/*
 * What the Friends submissions box knows about each friend, keyed by
 * lower-cased handle.
 *
 * A friend can be shown from an old stored copy while a fresh request runs
 * (`stale: 'updating'`); if that request then fails, the old copy stays on
 * screen, marked `stale: 'failed'`, instead of the friend disappearing.
 * No `stale` means the data is up to date.
 */
export type FriendProblemEntry =
  | { status: 'loading' }
  | {
      status: 'ready';
      /*
       * Everything the friend submitted in this problem's contest (all
       * problems); the caller narrows it to the current problem.
       */
      submissions: FriendSubmission[];
      stale?: 'updating' | 'failed';
    }
  | { status: 'error' };

export type FriendEntries = Record<string, FriendProblemEntry>;

/* A stored copy found for a friend: shown at once, never replacing anything already known. */
export function applyStored(
  previous: FriendEntries,
  handle: string,
  stored: { submissions: FriendSubmission[]; fresh: boolean },
): FriendEntries {
  if (previous[handle]?.status === 'ready') {
    return previous;
  }

  return {
    ...previous,
    [handle]: stored.fresh
      ? { status: 'ready', submissions: stored.submissions }
      : { status: 'ready', submissions: stored.submissions, stale: 'updating' },
  };
}

/* A request for the friend is about to be made (or made again). Data already shown stays. */
export function applyRequested(previous: FriendEntries, handle: string): FriendEntries {
  const current = previous[handle];

  if (current?.status === 'loading') {
    return previous;
  }

  if (current?.status === 'ready') {
    return current.stale === 'failed'
      ? { ...previous, [handle]: { ...current, stale: 'updating' } }
      : previous;
  }

  return { ...previous, [handle]: { status: 'loading' } };
}

/* The fresh data arrived. */
export function applyFresh(
  previous: FriendEntries,
  handle: string,
  submissions: FriendSubmission[],
): FriendEntries {
  return { ...previous, [handle]: { status: 'ready', submissions } };
}

/* The request failed: an old copy already shown stays (marked), otherwise the friend is an error. */
export function applyFailure(previous: FriendEntries, handle: string): FriendEntries {
  const current = previous[handle];

  if (current?.status === 'ready') {
    return current.stale
      ? { ...previous, [handle]: { ...current, stale: 'failed' } }
      : previous;
  }

  return { ...previous, [handle]: { status: 'error' } };
}

/* How many of these friends are on screen from an old copy that is still being refreshed. */
export function countUpdating(entries: FriendEntries, handles: readonly string[]): number {
  let count = 0;

  for (const handle of handles) {
    const entry = entries[handle.toLowerCase()];

    if (entry?.status === 'ready' && entry.stale === 'updating') {
      count += 1;
    }
  }

  return count;
}
