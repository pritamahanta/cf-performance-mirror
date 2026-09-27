import type {
  CSSProperties,
} from 'react';

import type {
  Theme,
} from '../../domain/theme';

import {
  getRatingColor,
} from '../../domain/utils';

import {
  buildProfileUrl,
} from '../../domain/friends';

import {
  useOnlineFriends,
} from '../../hooks/useOnlineFriends';

interface Props {
  theme: Theme;
  visible: boolean;
}

const ONLINE_DOT:
  CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background:
    '#2ecc71',
  flexShrink: 0,
};

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

export function OnlineFriendsPanel({
  theme,
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

  const count =
    state.status ===
    'ready'
      ? state.friends.length
      : null;

  const refreshTitle =
    state.status ===
    'ready'
      ? `Updated ${timeAgoLabel(
          state.updatedAt,
        )} · Refresh`
      : 'Refresh';

  return (
    <div
      style={{
        margin:
          '10px 0',
        width:
          '100%',
        boxSizing:
          'border-box',
      }}
    >
      <div
        style={{
          border:
            `1px solid ${theme.borderLight}`,
          borderRadius: 5,
          overflow:
            'hidden',
          display:
            'flex',
          flexDirection:
            'column',
        }}
      >
        <div
          style={{
            display:
              'flex',
            alignItems:
              'center',
            justifyContent:
              'space-between',
            borderBottom:
              `1px solid ${theme.borderLight}`,
            minHeight: 38,
            padding:
              '0 8px 0 12px',
            flexShrink:
              0,
            gap: 8,
            background:
              theme.bg,
          }}
        >
          <div
            style={{
              display:
                'flex',
              alignItems:
                'center',
              gap: 7,
              minWidth:
                0,
            }}
          >
            <span
              style={{
                ...ONLINE_DOT,
                boxShadow:
                  '0 0 0 2px rgba(46,204,113,0.18)',
              }}
            />

            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color:
                  theme.headingText,
                whiteSpace:
                  'nowrap',
              }}
            >
              Online Friends
            </span>

            {count !== null && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 9,
                  padding:
                    '0 5px',
                  minWidth: 16,
                  textAlign:
                    'center',
                  display:
                    'inline-block',
                  background:
                    theme.isDark
                      ? '#3a3a3a'
                      : '#d8d8d8',
                  color:
                    theme.muted,
                }}
              >
                {count}
              </span>
            )}
          </div>

          <button
            className="cfpm-icon-btn"
            title={
              refreshTitle
            }
            aria-label="Refresh online friends"
            style={{
              width: 24,
              height: 24,
              background:
                theme.btnBg,
              color:
                theme.muted,
              border:
                `1px solid ${theme.btnBorder}`,
            }}
            onClick={
              refresh
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
              <path d="M13.5 2.5v3.2h-3.2" />
            </svg>
          </button>
        </div>

        {state.status ===
          'loading' && (
          <div
            style={{
              padding:
                '18px 14px',
              color:
                theme.emptyText,
              fontStyle:
                'italic',
              fontSize: 12.5,
              textAlign:
                'center',
            }}
          >
            Loading online friends…
          </div>
        )}

        {state.status ===
          'error' && (
          <div
            style={{
              padding:
                '16px 14px',
              color:
                theme.muted,
              fontSize: 12,
              textAlign:
                'center',
              lineHeight:
                1.5,
            }}
          >
            {state.message}
          </div>
        )}

        {state.status ===
          'ready' &&
          state.friends
            .length === 0 && (
          <div
            style={{
              padding:
                '18px 14px',
              color:
                theme.emptyText,
              fontStyle:
                'italic',
              fontSize: 12.5,
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
            .length > 0 && (
          <div
            className="cfpm-list-scroll"
            style={{
              maxHeight:
                196,
              overflowY:
                'auto',
              width:
                '100%',
              boxSizing:
                'border-box',
              opacity:
                state.refreshing
                  ? 0.6
                  : 1,
              transition:
                'opacity 0.15s ease',
            }}
          >
            {state.friends.map(
              (
                friend,
                index,
              ) => (
                <a
                  key={
                    friend.handle
                  }
                  className="cfpm-sub-link"
                  href={buildProfileUrl(
                    friend.handle,
                  )}
                  target="_blank"
                  rel="noopener"
                  style={{
                    color:
                      theme.text,
                    borderTop:
                      index > 0
                        ? `1px solid ${theme.borderLighter}`
                        : undefined,
                  }}
                >
                  <span
                    style={
                      ONLINE_DOT
                    }
                  />

                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow:
                        'hidden',
                      textOverflow:
                        'ellipsis',
                      whiteSpace:
                        'nowrap',
                      color:
                        getRatingColor(
                          friend.rating,
                        ),
                      fontWeight:
                        700,
                    }}
                  >
                    {
                      friend.handle
                    }
                  </span>

                  {typeof friend.rating ===
                    'number' && (
                    <span
                      style={{
                        fontSize: 11,
                        color:
                          theme.muted,
                        fontWeight:
                          400,
                        flexShrink:
                          0,
                      }}
                    >
                      {
                        friend.rating
                      }
                    </span>
                  )}
                </a>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}