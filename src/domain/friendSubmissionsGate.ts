/*
 * What the Friends submissions box's two saved switches control.
 *
 * `enabled` is the master switch; `expanded` is the box's own chevron.
 * Requests depend on the master switch only: the scan starts when the
 * problem page loads, so the answer is already there (or well under way)
 * when the box is opened. The chevron only decides what is shown.
 */
export interface FriendSubmissionsGate {
  /* Run the scan: friends list, ratings, submissions. */
  fetching: boolean;

  /* Show the list, the footer and the submissions popup. */
  showBody: boolean;
}

export function friendSubmissionsGate(visibility: {
  enabled: boolean;
  expanded: boolean;
}): FriendSubmissionsGate {
  return {
    fetching: visibility.enabled,
    showBody: visibility.enabled && visibility.expanded,
  };
}
