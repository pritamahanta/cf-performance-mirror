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

export function solvedLimitNote(limit: number): string {
  return `Solved marks are checked for the first ${limit} online friends only.`;
}

/* What to show instead of the list when it is empty. */
export function emptyListMessage(noFriends: boolean): string {
  return noFriends ? NO_FRIENDS_MESSAGE : NONE_ONLINE_MESSAGE;
}

export interface NoteInput {
  incomplete: boolean;
  slowScan: boolean;

  /* A problem page with the solved-marker feature active. */
  onProblemPage: boolean;

  /* Online friends currently listed. */
  listedCount: number;

  /* How many of them get a solved marker. */
  solvedLimit: number;
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

  if (input.onProblemPage && input.listedCount > input.solvedLimit) {
    notes.push(solvedLimitNote(input.solvedLimit));
  }

  return notes;
}
