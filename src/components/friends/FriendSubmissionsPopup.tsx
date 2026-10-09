import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  CSSProperties,
  ReactNode,
} from 'react';

import { createPortal } from 'react-dom';

import {
  buildFriendSubmissionUrl,
  submissionMeta,
  verdictLabel,
  verdictTone,
} from '../../domain/friendSubmissions';

import type {
  FriendSubmission,
  ProblemRef,
} from '../../domain/friendSubmissions';

import { useTheme } from '../../hooks/useTheme';
import { SubmissionSourceOverlay } from '../SubmissionSourceOverlay';

/*
 * The popup is as wide as its content needs (a row is two short
 * lines), within these bounds.
 */
const POPUP_MIN_WIDTH = 190;
const POPUP_MAX_WIDTH = 280;
const LIST_MAX_HEIGHT = 260;
const EDGE_GAP = 8;

/*
 * Preferred placement: beside the friends box (to its left),
 * level with the clicked row, with a small arrow pointing at the
 * row - so the friends list stays fully visible and clickable.
 * ARROW_SIZE is the side of the rotated square used as the arrow;
 * its tip sticks out ~0.7 * ARROW_SIZE past the popup edge, which
 * SIDE_GAP has to leave room for.
 */
const SIDE_GAP = 10;
const ARROW_SIZE = 8;
const ARROW_EDGE_MARGIN = 10;

/*
 * A user can have hundreds of submissions on one problem. Only
 * this many rows are rendered at first, and each click on
 * "Show more" adds another batch, so opening the popup stays
 * instant however long the list is.
 */
const PAGE_SIZE = 30;

function formatDate(
  unixSeconds: number,
): string {
  try {
    return new Date(
      unixSeconds * 1000,
    ).toLocaleString(
      undefined,
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
    );
  } catch {
    return '';
  }
}

/*
 * Node.contains() throws a TypeError for anything that is not
 * a DOM node (an event aimed at `window`, say), which would
 * abort the handler and leave the popup stuck open.
 */
function isInside(
  container: Element | null,
  target: EventTarget | null,
): boolean {
  return (
    container !== null &&
    target instanceof Node &&
    container.contains(target)
  );
}

/*
 * Like isInside, but for a whole event. composedPath() is fixed
 * when the event is dispatched, so it still includes the popup
 * when the clicked element was removed from the page by the
 * time this runs (e.g. the "Show more" button disappearing after
 * it loads the last batch). Without it that click would look
 * like a click outside the popup and close it.
 */
function isEventInside(
  container: Element | null,
  event: Event,
): boolean {
  if (container === null) {
    return false;
  }

  return (
    event.composedPath().includes(container) ||
    isInside(container, event.target)
  );
}

interface Position {
  top: number;
  left: number;
  /*
   * Set only for the beside-the-box placement: where the arrow
   * on the popup's right edge sits (its centre, in px from the
   * popup's top) and whether that spot is over the header
   * (so the arrow can match the header's colour).
   */
  arrow: {
    top: number;
    overHeader: boolean;
  } | null;
}

interface Props {
  /* Rendered in the header (the friend's colored handle). */
  title: ReactNode;
  /* Same handle, plain text - for the source overlay's "By" line. */
  handle: string;
  problem: ProblemRef;
  submissions: FriendSubmission[];
  anchor: HTMLElement;
  onClose: () => void;
}

/*
 * Small floating list of one friend's submissions on the
 * current problem, opened from the button in their row.
 * Each row opens that submission's source inline (see
 * SubmissionSourceOverlay) instead of leaving the page.
 */
export function FriendSubmissionsPopup({
  title,
  handle,
  problem,
  submissions,
  anchor,
  onClose,
}: Props) {
  const [openedSubmission, setOpenedSubmission] =
    useState<FriendSubmission | null>(null);

  /*
   * Read inside the outside-click/scroll/resize effect below without
   * being a dependency of it (see its comment: re-subscribing those
   * listeners every time the source overlay opens or closes would be
   * unnecessary churn). Kept in sync on every render, same as the
   * value it guards.
   */
  const openedSubmissionRef =
    useRef<FriendSubmission | null>(
      null,
    );

  openedSubmissionRef.current =
    openedSubmission;

  const theme =
    useTheme();

  const popupRef =
    useRef<HTMLDivElement>(
      null,
    );

  const headerRef =
    useRef<HTMLDivElement>(
      null,
    );

  const [position, setPosition] =
    useState<Position>({
      top: -9999,
      left: -9999,
      arrow: null,
    });

  const [visibleCount, setVisibleCount] =
    useState(PAGE_SIZE);

  useLayoutEffect(() => {
    const popup =
      popupRef.current;

    if (
      !popup ||
      !document.contains(
        anchor,
      )
    ) {
      onClose();

      return;
    }

    const rect =
      anchor.getBoundingClientRect();

    const viewW =
      window.innerWidth ||
      document
        .documentElement
        .clientWidth;

    const viewH =
      window.innerHeight ||
      document
        .documentElement
        .clientHeight;

    const width =
      popup.offsetWidth ||
      POPUP_MIN_WIDTH;

    const height =
      popup.offsetHeight ||
      180;

    const box =
      anchor.closest(
        '.sidebox',
      ) ??
      anchor.closest(
        '.roundbox',
      );

    const sideLeft =
      box
        ? box.getBoundingClientRect()
            .left -
          width -
          SIDE_GAP
        : -1;

    if (
      sideLeft >=
      EDGE_GAP
    ) {
      const headerHeight =
        headerRef.current
          ?.offsetHeight ??
        30;

      const anchorMiddle =
        rect.top +
        rect.height / 2;

      /*
       * Put the arrow at the header's vertical centre
       * (1px is the popup's border) so it lines up with
       * the row; near the top/bottom of the viewport the
       * popup is clamped and the arrow slides instead.
       */
      const top =
        Math.min(
          Math.max(
            EDGE_GAP,
            anchorMiddle -
              (1 +
                headerHeight /
                  2),
          ),
          Math.max(
            EDGE_GAP,
            viewH -
              height -
              EDGE_GAP,
          ),
        );

      const arrowTop =
        Math.min(
          Math.max(
            ARROW_EDGE_MARGIN,
            anchorMiddle -
              top,
          ),
          Math.max(
            ARROW_EDGE_MARGIN,
            height -
              ARROW_EDGE_MARGIN,
          ),
        );

      setPosition({
        top,
        left: sideLeft,
        arrow: {
          top: arrowTop,
          overHeader:
            arrowTop <
            1 +
              headerHeight,
        },
      });

      return;
    }

    /*
     * Not enough room beside the box (narrow window):
     * open just below the button, right edges lined up,
     * or above it when there is no room underneath.
     */
    let left =
      rect.right - width;

    left = Math.min(
      left,
      viewW - width - EDGE_GAP,
    );

    left = Math.max(
      EDGE_GAP,
      left,
    );

    let top =
      rect.bottom + 6;

    if (
      top + height >
      viewH - EDGE_GAP
    ) {
      top = Math.max(
        EDGE_GAP,
        rect.top - height - 6,
      );
    }

    setPosition({
      top,
      left,
      arrow: null,
    });
  }, [
    anchor,
    onClose,
    submissions.length,
  ]);

  useEffect(() => {
    const onDocumentClick = (
      event: MouseEvent,
    ) => {
      /*
       * The source overlay (SubmissionSourceOverlay) is a sibling
       * portal, not a child of popupRef - it is not "inside" the
       * popup by any DOM check, so while it is open this listener
       * must do nothing at all. Otherwise clicking anything inside
       * it (the Copy button, the code itself, its own backdrop)
       * would be seen as a click "outside" this popup and close it
       * - taking the overlay down with it, since openedSubmission
       * lives in this component's own state.
       */
      if (
        openedSubmissionRef.current
      ) {
        return;
      }

      /*
       * Clicks on the button itself are handled by the
       * button (it toggles the popup). contains() rather
       * than ===, because the click usually lands on the
       * icon inside the button, and because this listener
       * may be attached while the very click that opened
       * the popup is still bubbling.
       */
      if (
        isEventInside(
          anchor,
          event,
        ) ||
        isEventInside(
          popupRef.current,
          event,
        )
      ) {
        return;
      }

      onClose();
    };

    const onScroll = (
      event: Event,
    ) => {
      /*
       * Same reasoning as onDocumentClick: scrolling inside the
       * overlay's own scrollable code view dispatches a (non-
       * bubbling) scroll event whose target is never inside
       * popupRef, but this capture-phase window listener still
       * sees it. Without this guard, scrolling the source code
       * closes the popup underneath it and the overlay with it -
       * exactly the "scrolling closes it" bug.
       */
      if (
        openedSubmissionRef.current
      ) {
        return;
      }

      if (
        !isInside(
          popupRef.current,
          event.target,
        )
      ) {
        onClose();
      }
    };

    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        openedSubmissionRef.current
      ) {
        /*
         * The overlay has its own Escape handler (it closes
         * itself, leaving this popup open underneath, same as a
         * real dialog). Acting here too would close both at once.
         */
        return;
      }

      if (
        event.key ===
        'Escape'
      ) {
        onClose();
      }
    };

    const onResize = () => {
      if (
        openedSubmissionRef.current
      ) {
        return;
      }

      onClose();
    };

    document.addEventListener(
      'click',
      onDocumentClick,
    );

    document.addEventListener(
      'keydown',
      onKeyDown,
    );

    window.addEventListener(
      'scroll',
      onScroll,
      {
        passive: true,
        capture: true,
      },
    );

    window.addEventListener(
      'resize',
      onResize,
    );

    return () => {
      document.removeEventListener(
        'click',
        onDocumentClick,
      );

      document.removeEventListener(
        'keydown',
        onKeyDown,
      );

      window.removeEventListener(
        'scroll',
        onScroll,
        true,
      );

      window.removeEventListener(
        'resize',
        onResize,
      );
    };
  }, [anchor, onClose]);

  const toneColor = {
    ok: theme.solvedBadgeText,
    bad: theme.waBadgeText,
    neutral: theme.muted,
  };

  /*
   * Two layers: the outer one is positioned and carries the arrow
   * (which sticks out past the edge, so it cannot clip); the inner
   * one has the border, rounded corners and clipping.
   */
  const style: CSSProperties =
    {
      position: 'fixed',
      zIndex: 999999,
      top: position.top,
      left: position.left,
      width: 'max-content',
      minWidth:
        POPUP_MIN_WIDTH,
      maxWidth: `min(${POPUP_MAX_WIDTH}px, calc(100vw - ${EDGE_GAP * 2}px))`,
      boxSizing:
        'border-box',
      color: theme.text,
      fontFamily:
        theme.fontFamily,
    };

  const surfaceStyle: CSSProperties =
    {
      boxSizing:
        'border-box',
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow:
        '0 6px 22px rgba(0,0,0,0.20), 0 1px 5px rgba(0,0,0,0.12)',
      display: 'flex',
      flexDirection:
        'column',
      background:
        theme.dropdownBg,
      border: `1px solid ${theme.dropdownBorder}`,
    };

  const count =
    submissions.length;

  const visibleSubmissions =
    useMemo(
      () =>
        submissions.slice(
          0,
          visibleCount,
        ),
      [
        submissions,
        visibleCount,
      ],
    );

  const remaining =
    count -
    visibleSubmissions.length;

  const content = (
    <div
      ref={popupRef}
      id="cfpm-fsub-popup"
      role="dialog"
      aria-label="Friend submissions"
      style={style}
    >
      <div style={surfaceStyle}>
      <div
        ref={headerRef}
        style={{
          padding:
            '6px 10px 6px 10px',
          fontSize: 12,
          fontWeight: 700,
          color:
            theme.mutedStrong,
          borderBottom: `1px solid ${theme.dropdownBorder}`,
          background:
            theme.dropdownSection,
          display: 'flex',
          alignItems:
            'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow:
              'hidden',
            textOverflow:
              'ellipsis',
            whiteSpace:
              'nowrap',
          }}
        >
          {title}
        </span>

        <span
          style={{
            fontSize: 11,
            fontWeight: 400,
            color:
              theme.muted,
            whiteSpace:
              'nowrap',
          }}
        >
          {`${count} submission${
            count === 1
              ? ''
              : 's'
          }`}
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            marginLeft:
              'auto',
            background:
              'transparent',
            border: 0,
            padding:
              '2px 2px 2px 6px',
            cursor:
              'pointer',
            opacity: 0.55,
            fontSize: 11,
            color:
              theme.text,
          }}
        >
          {'\u2715'}
        </button>
      </div>

      <div
        id="cfpm-fsub-popup-list"
        style={{
          overflowY: 'auto',
          maxHeight:
            LIST_MAX_HEIGHT,
          overscrollBehavior:
            'contain',
        }}
      >
        {visibleSubmissions.map(
          (
            submission,
            index,
          ) => {
            const url =
              buildFriendSubmissionUrl(
                submission,
                problem.contestId,
              );

            const rowStyle: CSSProperties =
              {
                display:
                  'block',
                padding:
                  '5px 10px',
                textDecoration:
                  'none',
                fontSize: 12,
                color:
                  theme.text,
                cursor: url
                  ? 'pointer'
                  : 'default',
                borderTop:
                  index > 0
                    ? `1px solid ${theme.borderLighter}`
                    : undefined,
                background:
                  index %
                    2 ===
                  0
                    ? 'transparent'
                    : theme.isDark
                      ? 'rgba(255,255,255,0.02)'
                      : 'rgba(0,0,0,0.015)',
              };

            const body = (
              <>
                <div
                  style={{
                    fontWeight: 700,
                    color:
                      toneColor[
                        verdictTone(
                          submission.verdict,
                        )
                      ],
                  }}
                >
                  {verdictLabel(
                    submission,
                  )}
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color:
                      theme.muted,
                    marginTop: 1,
                  }}
                >
                  {submissionMeta(
                    submission,
                    formatDate,
                  )}
                </div>
              </>
            );

            return url ? (
              <button
                key={
                  submission.id
                }
                type="button"
                className="cfpm-fsub-row"
                title={`Submission #${submission.id}`}
                style={{
                  ...rowStyle,
                  width: '100%',
                  textAlign: 'left',
                  font: 'inherit',
                }}
                onClick={() =>
                  setOpenedSubmission(
                    submission,
                  )
                }
              >
                {body}
              </button>
            ) : (
              <div
                key={
                  submission.id
                }
                className="cfpm-fsub-row"
                style={
                  rowStyle
                }
              >
                {body}
              </div>
            );
          },
        )}

        {remaining >
          0 && (
          <button
            type="button"
            className="cfpm-fsub-more"
            onClick={() => {
              setVisibleCount(
                current =>
                  current +
                  PAGE_SIZE,
              );
            }}
            style={{
              display:
                'block',
              width: '100%',
              padding:
                '6px 10px',
              border: 0,
              borderTop: `1px solid ${theme.borderLighter}`,
              background:
                'transparent',
              color:
                theme.problemLink,
              fontSize: 11,
              fontWeight: 700,
              fontFamily:
                'inherit',
              textAlign:
                'center',
              cursor:
                'pointer',
            }}
          >
            {`Show more (${remaining} remaining)`}
          </button>
        )}
      </div>
      </div>

      {position.arrow && (
        <span
          aria-hidden="true"
          style={{
            position:
              'absolute',
            right:
              -ARROW_SIZE / 2,
            top:
              position.arrow
                .top -
              ARROW_SIZE / 2,
            width:
              ARROW_SIZE,
            height:
              ARROW_SIZE,
            boxSizing:
              'border-box',
            transform:
              'rotate(45deg)',
            pointerEvents:
              'none',
            background:
              position.arrow
                .overHeader
                ? theme.dropdownSection
                : theme.dropdownBg,
            borderTop: `1px solid ${theme.dropdownBorder}`,
            borderRight: `1px solid ${theme.dropdownBorder}`,
          }}
        />
      )}
    </div>
  );

  const openedUrl =
    openedSubmission
      ? buildFriendSubmissionUrl(
          openedSubmission,
          problem.contestId,
        )
      : null;

  return (
    <>
      {createPortal(
        content,
        document.body,
      )}

      {openedSubmission &&
        openedUrl && (
          <SubmissionSourceOverlay
            url={openedUrl}
            submissionId={
              openedSubmission.id
            }
            handle={handle}
            problemIndex={
              problem.index
            }
            verdictLabel={
              <span
                style={{
                  color:
                    toneColor[
                      verdictTone(
                        openedSubmission.verdict,
                      )
                    ],
                }}
              >
                {verdictLabel(
                  openedSubmission,
                )}
              </span>
            }
            theme={theme}
            onClose={() =>
              setOpenedSubmission(
                null,
              )
            }
          />
        )}
    </>
  );
}
