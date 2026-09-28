import {
  getRatedUserClassName,
  isLegendaryRank,
} from '../../domain/utils';

import {
  buildProfileUrl,
} from '../../domain/friends';

import {
  useFriendsVisible,
} from '../../hooks/useFriendsVisible';

import {
  useOnlineFriends,
} from '../../hooks/useOnlineFriends';

/*
 * Max height (px) of the friend list. Longer
 * lists scroll inside the box; the title above
 * and the footer row below always stay put.
 */
const LIST_MAX_HEIGHT =
  260;

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

  if (!visible) {
    return null;
  }

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
        {'\u2192 Online Friends'}
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
                        <RatedHandle
                          handle={
                            friend.handle
                          }
                          rank={
                            friend.rank
                          }
                        />
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
    </div>
  );
}