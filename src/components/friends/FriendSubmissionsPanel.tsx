import { useCallback, useState } from 'react';

import {
  formatSubmissionDate,
  shortWhen,
} from '../../domain/friendSubmissions';

import type { ProblemRef } from '../../domain/friendSubmissions';

import {
  LIST_LOADING_MESSAGE,
  NO_FRIENDS_MESSAGE,
  checkedScopeInfo,
  checkingMessage,
  failedNote,
  noSubmissionsMessage,
} from '../../domain/panelNotices';

import { useTheme } from '../../hooks/useTheme';
import { useFriendSubmissionsFeed } from '../../hooks/useFriendSubmissionsFeed';
import { useFriendSubmissionsVisible } from '../../hooks/useFriendSubmissionsVisible';
import { MAX_FRIENDS_CHECKED } from '../../hooks/useFriendProblemSubmissions';
import { toggleFriendSubmissionsExpanded } from '../../services/storage';

import { FriendSubmissionsPopup } from './FriendSubmissionsPopup';
import { CfpmMark, ChevronIcon, RatedHandle } from './shared';

/*
 * Max height (px) of the list; longer lists scroll inside the box while
 * the title above and the footer below stay put.
 */
const LIST_MAX_HEIGHT = 260;

const MESSAGE_STYLE = {
  padding: '0.75em 1em',
  textAlign: 'center' as const,
};

const NOTE_STYLE = {
  padding: '0.25em 1em',
  fontSize: '0.85em',
  textAlign: 'center' as const,
};

/*
 * The "Friends submissions" box: which of the user's friends have
 * submitted the problem on this page, whether they solved it, and when.
 * A click on a friend's count opens that friend's submissions on this
 * problem; each one opens its source code in the page.
 *
 * It is independent of Online Friends: it reads the whole friends list
 * itself and has its own settings, so either box can be on without the
 * other.
 *
 * The markup is Codeforces' own sidebar-box structure (see
 * OnlineFriendsPanel), so fonts, spacing, row shading and dark mode come
 * from the live Codeforces stylesheet.
 */
export function FriendSubmissionsPanel({ problem }: { problem: ProblemRef }) {
  const { enabled, expanded } = useFriendSubmissionsVisible();

  /* Nothing is requested while the feature is off or the box is closed. */
  const active = enabled && expanded;

  const feed = useFriendSubmissionsFeed(problem, active);

  /* Result colours follow the page's light/dark detection used everywhere else in cfpm. */
  const theme = useTheme();

  const [openFriend, setOpenFriend] = useState<{
    handle: string;
    anchor: HTMLElement;
  } | null>(null);

  const closePopup = useCallback(() => {
    setOpenFriend(null);
  }, []);

  /* The popup goes away with its row, or when the box is closed or switched off. */
  const opened = active && openFriend !== null
    ? feed.rows.find(row => row.handle === openFriend.handle)
    : undefined;

  /* Hooks above run on every render, including when the switch is off. */
  if (!enabled) {
    return null;
  }

  const totalFriends = feed.list.status === 'ready' ? feed.list.handles.length : 0;

  const scope =
    feed.list.status === 'ready'
      ? checkedScopeInfo({
          totalFriends,
          checkedLimit: feed.limit,
          batchSize: MAX_FRIENDS_CHECKED,
        })
      : null;

  const done = feed.inScope - feed.loading;

  const footerLabel =
    feed.list.status === 'ready' && totalFriends > 0
      ? `${feed.rows.length} with submissions`
      : ' ';

  return (
    <div className="roundbox sidebox borderTopRound">
      <div className="caption titled">
        <span>{'→ Friends submissions'}</span>

        <button
          id="cfpm-fsubs-chevron-btn"
          type="button"
          className={expanded ? '' : 'collapsed'}
          title={expanded ? 'Hide friends submissions' : 'Show friends submissions'}
          aria-label={expanded ? 'Hide friends submissions' : 'Show friends submissions'}
          aria-expanded={expanded}
          onClick={() => {
            /* Only the box's own open/closed flag; the master switch belongs to the profile controls. */
            toggleFriendSubmissionsExpanded();
          }}
        >
          <ChevronIcon />
        </button>
      </div>

      {expanded && (
        <>
          {feed.list.status === 'loading' && (
            <div style={MESSAGE_STYLE}>{LIST_LOADING_MESSAGE}</div>
          )}

          {feed.list.status === 'error' && (
            <div style={MESSAGE_STYLE}>{feed.list.message}</div>
          )}

          {feed.list.status === 'ready' && totalFriends === 0 && (
            <div style={MESSAGE_STYLE}>{NO_FRIENDS_MESSAGE}</div>
          )}

          {feed.list.status === 'ready' && totalFriends > 0 && feed.loading > 0 && (
            <div style={NOTE_STYLE}>{checkingMessage(done, feed.inScope)}</div>
          )}

          {feed.list.status === 'ready' &&
            totalFriends > 0 &&
            feed.loading === 0 &&
            feed.rows.length === 0 && (
              <div style={MESSAGE_STYLE}>
                {feed.failed === feed.inScope
                  ? failedNote(feed.failed)
                  : noSubmissionsMessage(feed.inScope - feed.failed)}
              </div>
            )}

          {feed.rows.length > 0 && (
            <div
              className="cfpm-list-scroll cfpm-fsubs-list"
              style={{ maxHeight: LIST_MAX_HEIGHT }}
            >
              <table className="rtable">
                <tbody>
                  <tr>
                    <th className="left">User</th>
                    <th style={{ width: '4.5em' }}>Result</th>
                    <th style={{ width: '2.75em' }}>Subs</th>
                  </tr>

                  {feed.rows.map((row, index) => {
                    const dark = index % 2 === 0;
                    const { summary } = row;

                    return (
                      <tr key={row.handle}>
                        <td className={dark ? 'left dark' : 'left'}>
                          <RatedHandle handle={row.handle} rank={row.rank} />

                          <div className="cfpm-fsubs-when">
                            {shortWhen(summary.headline, formatSubmissionDate)}
                          </div>
                        </td>

                        <td className={dark ? 'dark' : ''}>
                          <span
                            className="cfpm-fsubs-result"
                            style={{
                              color: summary.solved
                                ? theme.solvedBadgeText
                                : theme.waBadgeText,
                            }}
                            title={
                              summary.solved
                                ? summary.attemptsBeforeSolve === 0
                                  ? 'Solved on the first submission'
                                  : `Solved after ${summary.attemptsBeforeSolve} earlier submission${
                                      summary.attemptsBeforeSolve === 1 ? '' : 's'
                                    }`
                                : 'No accepted submission'
                            }
                          >
                            {summary.solved ? 'Solved' : 'Unsolved'}
                          </span>
                        </td>

                        <td className={dark ? 'dark' : ''}>
                          <button
                            type="button"
                            className="cfpm-fsubs-count"
                            title={`Show ${row.handle}'s submissions for this problem`}
                            aria-label={`Show ${row.handle}'s ${summary.submissions.length} submissions for this problem`}
                            aria-haspopup="dialog"
                            aria-expanded={openFriend?.handle === row.handle}
                            onClick={event => {
                              const anchor = event.currentTarget;

                              setOpenFriend(current =>
                                current?.handle === row.handle
                                  ? null
                                  : { handle: row.handle, anchor },
                              );
                            }}
                          >
                            {summary.submissions.length}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {feed.list.status === 'ready' && feed.failed > 0 && feed.loading === 0 && feed.rows.length > 0 && (
            <div style={{ ...NOTE_STYLE, opacity: 0.7 }}>{failedNote(feed.failed)}</div>
          )}

          {scope && (
            <div style={NOTE_STYLE}>
              <span style={{ opacity: 0.7 }}>{scope.text}</span>{' '}
              <button
                type="button"
                className="cfpm-fsubs-more"
                onClick={feed.checkMore}
                title={`Sends ${scope.nextBatch} more Codeforces requests, about one every 2 seconds`}
              >
                {`Check next ${scope.nextBatch}`}
              </button>
            </div>
          )}

          <div className="cfpm-friends-footer">
            <div className="cfpm-friends-footer-group">
              <CfpmMark />
            </div>

            <span className="cfpm-friends-count">{footerLabel}</span>
          </div>

          {opened && openFriend && (
            <FriendSubmissionsPopup
              key={opened.handle}
              title={<RatedHandle handle={opened.handle} rank={opened.rank} />}
              handle={opened.handle}
              problem={problem}
              submissions={opened.summary.submissions}
              anchor={openFriend.anchor}
              onClose={closePopup}
            />
          )}
        </>
      )}
    </div>
  );
}
