import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getRatedUserClassName,
  isLegendaryRank,
} from '../../domain/utils';

import {
  hasSolved,
  parseProblemPage,
  submissionsForProblem,
} from '../../domain/friendSubmissions';

import {
  buildProfileUrl,
} from '../../domain/friends';

import {
  useFriendsVisible,
} from '../../hooks/useFriendsVisible';

import {
  useFriendProblemSubmissions,
} from '../../hooks/useFriendProblemSubmissions';

import {
  useOnlineFriends,
} from '../../hooks/useOnlineFriends';

import {
  FriendSubmissionsPopup,
} from './FriendSubmissionsPopup';

/*
 * Max height (px) of the friend list. Longer
 * lists scroll inside the box; the title above
 * and the footer row below always stay put.
 */
const LIST_MAX_HEIGHT =
  260;

const NO_HANDLES: string[] =
  [];

function timeAgoLabel(
  updatedAt: number,
): string {
  const seconds =
    Math.max(
      0,
      Math.round(
        (Date.now() -
          updatedAt) /
          1000,
      ),
    );

  if (
    seconds < 5
  ) {
    return 'just now';
  }

  if (
    seconds < 60
  ) {
    return `${seconds}s ago`;
  }

  return `${Math.round(
    seconds / 60,
  )}m ago`;
}

/*
 * Renders the friend's handle the same way
 * Codeforces itself does: colored by rating tier,
 * with the two-tone first letter Codeforces uses
 * for Legendary Grandmasters.
 */
function RatedHandle({
  handle,
  rank,
}: {
  handle: string;
  rank?: string;
}) {
  const className =
    getRatedUserClassName(
      rank,
    );

  if (
    isLegendaryRank(
      rank,
    )
  ) {
    return (
      <a
        href={buildProfileUrl(
          handle,
        )}
        target="_blank"
        rel="noopener"
        title={handle}
        className={
          className
        }
      >
        <span className="legendary-user-first-letter">
          {handle.charAt(
            0,
          )}
        </span>
        {handle.slice(
          1,
        )}
      </a>
    );
  }

  return (
    <a
      href={buildProfileUrl(
        handle,
      )}
      target="_blank"
      rel="noopener"
      title={handle}
      className={
        className ||
        undefined
      }
    >
      {handle}
    </a>
  );
}

/*
 * Small, unobtrusive brand mark - same monospace,
 * muted-gray, letter-spaced treatment used for the
 * "cfpm" label on the main mirror panel. Sits in
 * the footer row next to the refresh button, not
 * meant to draw attention.
 */
function CfpmMark() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing:
          '0.08em',
        fontFamily:
          'monospace',
        color: '#999999',
        opacity: 0.75,
        userSelect: 'none',
      }}
      title="CF Performance Mirror"
    >
      cfpm
    </span>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function SubmissionsIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function OnlineFriendsPanel() {
  const visible =
    useFriendsVisible();

  const {
    state,
    refreshing,
    refresh,
  } =
    useOnlineFriends(
      visible,
    );

  /*
   * Set only on a problem page of a regular contest
   * (null everywhere else, which switches the whole
   * "friend's submissions" feature off: no requests,
   * no extra markup).
   */
  const problem =
    useMemo(
      () =>
        parseProblemPage(
          window.location
            .pathname,
        ),
      [],
    );

  const friendHandles =
    useMemo(
      () =>
        state.status ===
        'ready'
          ? state.friends.map(
              friend =>
                friend.handle,
            )
          : NO_HANDLES,
      [state],
    );

  const submissionEntries =
    useFriendProblemSubmissions(
      problem,
      friendHandles,
    );

  const [openFriend, setOpenFriend] =
    useState<{
      handle: string;
      anchor: HTMLElement;
    } | null>(null);

  const closePopup =
    useCallback(() => {
      setOpenFriend(null);
    }, []);

  /*
   * Drop the popup if its friend goes offline (their
   * row, and so the popup's anchor, disappears) or the
   * whole box is hidden.
   */
  useEffect(() => {
    if (!openFriend) {
      return;
    }

    const stillListed =
      visible &&
      state.status ===
        'ready' &&
      state.friends.some(
        friend =>
          friend.handle ===
          openFriend.handle,
      );

    if (!stillListed) {
      setOpenFriend(null);
    }
  }, [
    visible,
    state,
    openFriend,
  ]);

  if (!visible) {
    return null;
  }

  const openedFriend =
    openFriend &&
    state.status ===
      'ready'
      ? state.friends.find(
          friend =>
            friend.handle ===
            openFriend.handle,
        )
      : undefined;

  const openedEntry =
    openedFriend
      ? submissionEntries[
          openedFriend.handle.toLowerCase()
        ]
      : undefined;

  const openedSubmissions =
    problem &&
    openedEntry?.status ===
      'ready'
      ? submissionsForProblem(
          openedEntry.submissions,
          problem.index,
        )
      : [];

  /*
   * A click while a load is already running would
   * just cancel it and start over, so ignore it.
   * (Not `disabled`: the button should look the
   * same during the initial load and only show
   * feedback when the user clicks it.)
   */
  const busy =
    refreshing ||
    state.status ===
      'loading';

  const refreshTitle =
    refreshing
      ? 'Refreshing\u2026'
      : state.status ===
          'ready'
        ? `Updated ${timeAgoLabel(
            state.updatedAt,
          )} \u00b7 Refresh`
        : 'Refresh';

  const countLabel =
    state.status ===
    'ready'
      ? `${state.friends.length} online`
      : '\u00a0';

  /*
   * Structure mirrors Codeforces' own sidebar
   * boxes exactly (verified live against the
   * "Top contributors" box on codeforces.com):
   *
   * <div class="roundbox sidebox borderTopRound">
   *   <div class="caption titled">
   *     -> Title
   *   </div>
   *   <table class="rtable">...</table>
   * </div>
   *
   * Using those real class names (rather than
   * custom CSS) means this renders with
   * Codeforces' own live stylesheet - fonts,
   * spacing, row shading, dark mode - instead of
   * an approximation of it.
   *
   * Below the (scrollable) list sits a fixed
   * footer row: cfpm mark + refresh button on the
   * left, online count on the right.
   */
  return (
    <div className="roundbox sidebox borderTopRound">
      <div className="caption titled">
        {'\u2192 Online friends'}
      </div>

      {state.status ===
        'loading' && (
        <div
          style={{
            padding:
              '0.75em 1em',
            textAlign:
              'center',
          }}
        >
          {"Checking who's online\u2026"}
        </div>
      )}

      {state.status ===
        'error' && (
        <div
          style={{
            padding:
              '0.75em 1em',
            textAlign:
              'center',
          }}
        >
          {state.message}
        </div>
      )}

      {state.status ===
        'ready' &&
        state.friends
          .length ===
          0 && (
        <div
          style={{
            padding:
              '0.75em 1em',
            textAlign:
              'center',
          }}
        >
          No friends online right now.
        </div>
      )}

      {state.status ===
        'ready' &&
        state.friends
          .length >
          0 && (
        <div
          className="cfpm-list-scroll cfpm-friends-list"
          style={{
            maxHeight:
              LIST_MAX_HEIGHT,
          }}
        >
          <table className="rtable">
            <tbody>
              <tr>
                <th
                  className="left"
                  style={{
                    width:
                      '2.25em',
                  }}
                >
                  &nbsp;
                </th>
                <th>
                  User
                </th>
                <th
                  style={{
                    width:
                      '5em',
                  }}
                >
                  Rating
                </th>
              </tr>

              {state.friends.map(
                (
                  friend,
                  index,
                ) => {
                  const dark =
                    index %
                      2 ===
                    0;

                  const entry =
                    problem
                      ? submissionEntries[
                          friend.handle.toLowerCase()
                        ]
                      : undefined;

                  const solved =
                    problem !==
                      null &&
                    entry?.status ===
                      'ready' &&
                    hasSolved(
                      submissionsForProblem(
                        entry.submissions,
                        problem.index,
                      ),
                    );

                  const handleLink =
                    (
                      <RatedHandle
                        handle={
                          friend.handle
                        }
                        rank={
                          friend.rank
                        }
                      />
                    );

                  return (
                    <tr
                      key={
                        friend.handle
                      }
                    >
                      <td
                        className={
                          dark
                            ? 'left dark'
                            : 'left'
                        }
                        title="Online now"
                      >
                        <span
                          style={{
                            display:
                              'inline-block',
                            width: 7,
                            height: 7,
                            borderRadius:
                              '50%',
                            background:
                              '#2ecc71',
                          }}
                        />
                      </td>

                      <td
                        className={
                          dark
                            ? 'dark'
                            : ''
                        }
                      >
                        {problem ? (
                          <div className="cfpm-friend-user">
                            {handleLink}

                            {solved && (
                              <button
                                type="button"
                                className="cfpm-friend-sub-btn"
                                title={`${friend.handle}'s submissions for this problem`}
                                aria-label={`Show ${friend.handle}'s submissions for this problem`}
                                aria-haspopup="dialog"
                                aria-expanded={
                                  openFriend?.handle ===
                                  friend.handle
                                }
                                onClick={event => {
                                  const anchor =
                                    event.currentTarget;

                                  setOpenFriend(
                                    current =>
                                      current?.handle ===
                                      friend.handle
                                        ? null
                                        : {
                                            handle:
                                              friend.handle,
                                            anchor,
                                          },
                                  );
                                }}
                              >
                                <SubmissionsIcon />
                              </button>
                            )}
                          </div>
                        ) : (
                          handleLink
                        )}
                      </td>

                      <td
                        className={
                          dark
                            ? 'dark'
                            : ''
                        }
                      >
                        {typeof friend.rating ===
                        'number'
                          ? friend.rating
                          : '\u2014'}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="cfpm-friends-footer">
        <div className="cfpm-friends-footer-group">
          <CfpmMark />

          <button
            type="button"
            className={
              refreshing
                ? 'cfpm-friends-refresh cfpm-spinning'
                : 'cfpm-friends-refresh'
            }
            onClick={() => {
              if (!busy) {
                refresh();
              }
            }}
            title={
              refreshTitle
            }
            aria-label="Refresh online friends"
            aria-busy={
              refreshing
            }
          >
            <RefreshIcon />
          </button>
        </div>

        <span className="cfpm-friends-count">
          {countLabel}
        </span>
      </div>

      {problem &&
        openFriend &&
        openedFriend &&
        openedSubmissions.length >
          0 && (
          <FriendSubmissionsPopup
            title={
              <RatedHandle
                handle={
                  openedFriend.handle
                }
                rank={
                  openedFriend.rank
                }
              />
            }
            problem={problem}
            submissions={
              openedSubmissions
            }
            anchor={
              openFriend.anchor
            }
            onClose={
              closePopup
            }
          />
        )}
    </div>
  );
}