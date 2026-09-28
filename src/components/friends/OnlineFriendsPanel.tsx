import {
  getRatedUserClassName,
  isLegendaryRank,
} from '../../domain/utils';

import {
  buildProfileUrl,
} from '../../domain/friends';

import {
  useOnlineFriends,
} from '../../hooks/useOnlineFriends';

interface Props {
  visible: boolean;
}

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
 * the box's own top-links slot next to Refresh, not
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

export function OnlineFriendsPanel({
  visible,
}: Props) {
  const {
    state,
    refresh,
  } =
    useOnlineFriends(
      visible,
    );

  if (!visible) {
    return null;
  }

  const refreshTitle =
    state.status ===
    'ready'
      ? `Updated ${timeAgoLabel(
          state.updatedAt,
        )} \u00b7 Refresh`
      : 'Refresh';

  const isRefreshing =
    state.status ===
      'loading' ||
    (state.status ===
      'ready' &&
      state.refreshing);

  /*
   * Structure mirrors Codeforces' own sidebar
   * boxes exactly (verified live against the
   * "Top contributors" box on codeforces.com):
   *
   * <div class="roundbox sidebox borderTopRound">
   *   <div class="caption titled">
   *     -> Title
   *     <div class="top-links">...</div>
   *   </div>
   *   <table class="rtable">...</table>
   * </div>
   *
   * Using those real class names (rather than
   * custom CSS) means this renders with
   * Codeforces' own live stylesheet - fonts,
   * spacing, row shading, dark mode - instead of
   * an approximation of it.
   */
  return (
    <div className="roundbox sidebox borderTopRound">
      <div className="caption titled">
        {'\u2192 Online Friends'}

        <div
          className="top-links"
          style={{
            display: 'flex',
            alignItems:
              'center',
            gap: 8,
          }}
        >
          <CfpmMark />

          <a
            onClick={
              refresh
            }
            title={
              refreshTitle
            }
            aria-label="Refresh online friends"
            style={{
              cursor:
                'pointer',
              opacity:
                isRefreshing
                  ? 0.5
                  : 1,
            }}
          >
            {isRefreshing
              ? 'Refreshing\u2026'
              : 'Refresh'}
          </a>
        </div>
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
          className="cfpm-list-scroll"
          style={{
            maxHeight: 260,
            overflowY:
              'auto',
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
    </div>
  );
}