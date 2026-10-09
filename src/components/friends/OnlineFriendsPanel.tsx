import {
  useFriendsVisible,
} from '../../hooks/useFriendsVisible';

import {
  emptyListMessage,
  listNotes,
} from '../../domain/panelNotices';

import {
  useOnlineFriends,
} from '../../hooks/useOnlineFriends';

import {
  toggleFriendsExpanded,
} from '../../services/storage';

import {
  ChevronIcon,
  CfpmMark,
  RatedHandle,
} from './shared';

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
  const {
    enabled,
    expanded,
  } =
    useFriendsVisible();

  /*
   * Everything that talks to Codeforces (the friends
   * poller) runs only while the feature is on AND the
   * box is open. Turning it off, or closing the box,
   * stops it.
   */
  const active =
    enabled &&
    expanded;

  const {
    state,
    refreshing,
    refresh,
  } =
    useOnlineFriends(
      active,
    );

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
   * Master switch off: render nothing at all - not even
   * the closed header. Placed after every hook above so
   * the hooks still run in the same order on each render.
   */
  if (!enabled) {
    return null;
  }

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
        <span>
          {'\u2192 Online friends'}
        </span>

        <button
          id="cfpm-friends-chevron-btn"
          type="button"
          className={
            expanded
              ? ''
              : 'collapsed'
          }
          title={
            expanded
              ? 'Hide online friends'
              : 'Show online friends'
          }
          aria-label={
            expanded
              ? 'Hide online friends'
              : 'Show online friends'
          }
          aria-expanded={
            expanded
          }
          onClick={() => {
            /*
             * Flips only the box's own open/closed flag
             * (never the master switch, which belongs to
             * the profile page's controls). Reads the full
             * saved settings fresh from storage and writes
             * the whole object back - never a partial
             * patch, since saveSettings() overwrites
             * storage with exactly what it's given - and
             * dispatches the event useFriendsVisible() and
             * the profile page's controls both listen for.
             */
            toggleFriendsExpanded();
          }}
        >
          <ChevronIcon />
        </button>
      </div>

      {expanded && (
        <>
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
          {state.progress
            ? `Checking who's online\u2026 ${state.progress.checked}/${state.progress.total}`
            : "Checking who's online\u2026"}
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
          {emptyListMessage(
            state.noFriends,
          )}
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

      {state.status ===
        'ready' &&
        listNotes({
          incomplete:
            state.incomplete,
          slowScan:
            state.slowScan,
        }).map(note => (
          <div
            key={note}
            style={{
              padding:
                '0.25em 1em',
              fontSize:
                '0.85em',
              opacity: 0.7,
              textAlign:
                'center',
            }}
          >
            {note}
          </div>
        ))}

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
              /*
               * Always call refresh(): the poller itself already
               * decides what a click means depending on what's
               * going on (nothing running yet, a scan already in
               * flight, too soon after the last one, ...) and
               * always acknowledges it. Gating this on a "busy"
               * flag used to silently swallow clicks made while
               * the very first load was still in progress - which
               * is exactly what "the button ignores my click"
               * looks like.
               */
              refresh();
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

        </>
      )}
    </div>
  );
}