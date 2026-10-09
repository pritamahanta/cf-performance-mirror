/*
 * The wording the Online Friends box shows for states that are not a
 * plain list of friends. Kept apart from the component so each message
 * can be tested.
 */

export const NO_FRIENDS_MESSAGE =
  'No friends found on your Codeforces friends page.';

export const NONE_ONLINE_MESSAGE = 'No friends online right now.';

export const INCOMPLETE_NOTE =
  "Some friends couldn't be checked — anyone who is online may be missing from this list.";

export const SLOW_SCAN_NOTE =
  'Large friend list: someone who just came online can take several minutes to appear, and short visits may be missed.';

/* What to show instead of the list when it is empty. */
export function emptyListMessage(noFriends: boolean): string {
  return noFriends ? NO_FRIENDS_MESSAGE : NONE_ONLINE_MESSAGE;
}

export interface NoteInput {
  incomplete: boolean;
  slowScan: boolean;
}

/* The small notes under the list, in display order. */
export function listNotes(input: NoteInput): string[] {
  const notes: string[] = [];

  if (input.incomplete) {
    notes.push(INCOMPLETE_NOTE);
  }

  if (input.slowScan) {
    notes.push(SLOW_SCAN_NOTE);
  }

  return notes;
}

/* ---- Friends submissions box ---- */

export const LIST_LOADING_MESSAGE = 'Loading your friends\u2026';

export function noSubmissionsMessage(checked: number): string {
  return checked === 1
    ? 'The friend checked has no submissions on this problem.'
    : `None of the ${checked} friends checked has submitted this problem.`;
}

export function checkingMessage(done: number, total: number): string {
  return `Checking friends\u2019 submissions\u2026 ${done}/${total}`;
}

export function failedNote(failed: number): string {
  return failed === 1
    ? "1 friend couldn't be checked."
    : `${failed} friends couldn't be checked.`;
}

export interface CheckedScopeInput {
  /* Friends on the friends list. */
  totalFriends: number;

  /* How many of them, from the top, are being checked now. */
  checkedLimit: number;

  /* How many more one click adds at most. */
  batchSize: number;
}

export interface CheckedScopeInfo {
  text: string;

  /* How many friends the next click will add to the check. */
  nextBatch: number;
}

/*
 * Set only when some friends are not being checked yet; null when every
 * friend is covered.
 */
export function checkedScopeInfo(input: CheckedScopeInput): CheckedScopeInfo | null {
  if (input.totalFriends <= input.checkedLimit) {
    return null;
  }

  return {
    text: `Checked the first ${input.checkedLimit} of ${input.totalFriends} friends.`,
    nextBatch: Math.min(input.batchSize, input.totalFriends - input.checkedLimit),
  };
}
