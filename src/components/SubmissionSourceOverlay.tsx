import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  CSSProperties,
  ReactNode,
} from 'react';

import { createPortal } from 'react-dom';

import { fetchSubmissionSourceText } from '../services/codeforcesApi';
import { highlight } from '../domain/highlight';
import type { TokenType } from '../domain/highlight';
import type { Theme } from '../domain/theme';

interface Props {
  /* The real Codeforces submission page - fetched for its source, and used as the "#" link and the fallback when source can't be loaded inline. */
  url: string;

  submissionId: number;

  /* Rendered colored, same as elsewhere in the extension (e.g. RatedHandle). */
  handle: ReactNode;

  contestName?: string;
  problemIndex?: string;
  problemName?: string;

  /* Rendered colored, e.g. green for Accepted, red for a rejection. */
  verdictLabel: ReactNode;

  theme: Theme;
  onClose: () => void;
}

/*
 * Token colors of the Codeforces source view (measured from a screenshot
 * of it): navy keywords, purple types, dark-red comments, green strings,
 * teal numbers, olive punctuation. Keywords, types, comments and strings
 * are bold there; numbers, punctuation and plain text are not.
 */
const CODEFORCES_CODE_COLORS: Record<TokenType, string> = {
  pln: '#000',
  kwd: '#008',
  typ: '#606',
  com: '#800',
  str: '#080',
  lit: '#066',
  pun: '#660',
};

/* Codeforces has no dark theme; these are lighter stand-ins for a dark page. */
const DARK_CODE_COLORS: Record<TokenType, string> = {
  pln: '#e6e6e6',
  kwd: '#8ab4ff',
  typ: '#d9a0ff',
  com: '#ff9a8a',
  str: '#7bd88f',
  lit: '#6fd6d6',
  pun: '#d4d48a',
};

const BOLD_TOKENS: ReadonlySet<TokenType> = new Set<TokenType>([
  'kwd',
  'typ',
  'com',
  'str',
]);

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; html: string; text: string }
  | { status: 'error'; message: string };

/*
 * A submission's source code shown as an in-page overlay, laid out and
 * colored like Codeforces' own "view source" dialog (white box with a
 * grey border, one-line header, grey code box, syntax colors), instead
 * of opening the submission's page in a new tab. It closes with the
 * cross, a click outside the box, or Escape.
 *
 * The syntax colors come from highlight(): the page Codeforces serves
 * holds the source as plain text and colors it with a script in the
 * browser, so the fetched copy carries no color markup to reuse.
 */
export function SubmissionSourceOverlay({
  url,
  submissionId,
  handle,
  contestName,
  problemIndex,
  problemName,
  verdictLabel,
  theme,
  onClose,
}: Props) {
  const [state, setState] =
    useState<LoadState>({
      status: 'loading',
    });

  const [copied, setCopied] =
    useState(false);

  const tokens =
    useMemo(
      () =>
        state.status ===
        'ready'
          ? highlight(
              state.text,
            )
          : [],
      [state],
    );

  useEffect(() => {
    const controller =
      new AbortController();

    fetchSubmissionSourceText(
      url,
      controller.signal,
    )
      .then(source => {
        setState({
          status: 'ready',
          html: source.html,
          text: source.text,
        });
      })
      .catch(error => {
        if (
          controller.signal
            .aborted
        ) {
          return;
        }

        setState({
          status: 'error',
          message:
            error instanceof
            Error
              ? error.message
              : "Couldn't load this submission's source code inline.",
        });
      });

    return () => {
      controller.abort();
    };
  }, [url]);

  useEffect(() => {
    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key ===
        'Escape'
      ) {
        onClose();
      }
    };

    document.addEventListener(
      'keydown',
      onKeyDown,
    );

    return () => {
      document.removeEventListener(
        'keydown',
        onKeyDown,
      );
    };
  }, [onClose]);

  const copySource = () => {
    if (
      state.status !==
      'ready'
    ) {
      return;
    }

    navigator.clipboard
      ?.writeText(
        state.text,
      )
      .then(() => {
        setCopied(true);

        setTimeout(
          () =>
            setCopied(
              false,
            ),
          1500,
        );
      })
      .catch(() => {
        // Clipboard access can be denied by the browser; the source
        // is still fully visible and selectable, so this is silent.
      });
  };

  const light =
    !theme.isDark;

  const colors =
    light
      ? CODEFORCES_CODE_COLORS
      : DARK_CODE_COLORS;

  const ruleColor =
    light
      ? '#9a9a9a'
      : theme.dropdownBorder;

  /*
   * No dimming behind the box: the Codeforces dialog does not dim the
   * page (measured from a screenshot of it). Clicking outside still
   * closes it.
   */
  const backdropStyle: CSSProperties =
    {
      position: 'fixed',
      inset: 0,
      zIndex: 999999,
      background:
        'transparent',
      display: 'flex',
      alignItems:
        'flex-start',
      justifyContent:
        'center',
      padding: '12px 6px',
      boxSizing:
        'border-box',
    };

  /*
   * Measured from the Codeforces dialog: 3px #ccc border, rounded
   * corners, 22px padding all round, nearly the full width of the
   * window, 12px from its top. It grows with the code up to the window
   * height and then scrolls inside.
   */
  const boxStyle: CSSProperties =
    {
      position: 'relative',
      width: '100%',
      maxHeight:
        'calc(100vh - 24px)',
      boxSizing:
        'border-box',
      display: 'flex',
      flexDirection:
        'column',
      padding: 22,
      borderRadius: 6,
      border: `3px solid ${light ? '#ccc' : theme.dropdownBorder}`,
      boxShadow:
        '0 0 24px rgba(0,0,0,0.45)',
      background:
        light
          ? '#fff'
          : theme.dropdownBg,
      color:
        light
          ? '#000'
          : theme.text,
      fontFamily:
        light
          ? 'Arial, Helvetica, sans-serif'
          : theme.fontFamily,
      fontSize: 12,
    };

  const linkStyle: CSSProperties =
    {
      color:
        light
          ? '#00f'
          : theme.problemLink,
      textDecoration:
        'underline',
      cursor: 'pointer',
      background: 'none',
      border: 0,
      padding: 0,
      font: 'inherit',
    };

  const problemLabel =
    problemIndex
      ? problemName
        ? `(${problemIndex}) ${problemName}`
        : `(${problemIndex})`
      : null;

  const content = (
    <div
      style={backdropStyle}
      onClick={event => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        id="cfpm-submission-sandbox"
        role="dialog"
        aria-modal="true"
        aria-label="Submission source"
        style={boxStyle}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          style={{
            position:
              'absolute',
            top: 6,
            right: 2,
            width: 18,
            height: 18,
            background:
              'transparent',
            border: 0,
            padding: 0,
            cursor:
              'pointer',
            fontFamily:
              'Arial, Helvetica, sans-serif',
            fontSize: 18,
            lineHeight:
              '18px',
            textAlign:
              'center',
            color:
              light
                ? '#b2b2b2'
                : theme.muted,
          }}
        >
          {'×'}
        </button>

        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY:
              'auto',
            padding:
              '0 12px',
          }}
        >
          <div
            style={{
              paddingTop: 12,
              marginLeft: -1,
              lineHeight:
                '14px',
            }}
          >
            {'By '}
            <strong>
              {handle}
            </strong>

            {contestName && (
              <>
                {', contest: '}
                {contestName}
              </>
            )}

            {problemLabel && (
              <>
                {', problem: '}
                {problemLabel}
              </>
            )}

            {', '}
            <strong>
              {verdictLabel}
            </strong>

            {', '}
            <a
              href={url}
              target="_blank"
              rel="noopener"
              title={`Submission #${submissionId}`}
              style={
                light
                  ? {
                      textDecoration:
                        'underline',
                    }
                  : linkStyle
              }
            >
              {'#'}
            </a>

            {state.status ===
              'ready' && (
              <>
                {', '}
                <button
                  type="button"
                  onClick={
                    copySource
                  }
                  style={
                    linkStyle
                  }
                >
                  {copied
                    ? 'Copied'
                    : 'Copy'}
                </button>
              </>
            )}
          </div>

          <div
            style={{
              margin:
                '6px 0 6px',
              borderTop: `1px solid ${ruleColor}`,
              borderBottom: `1px solid ${light ? '#eee' : ruleColor}`,
            }}
          />

          {state.status ===
            'loading' && (
            <div
              style={{
                padding:
                  '1.5em',
                textAlign:
                  'center',
                color:
                  theme.muted,
              }}
            >
              {'Loading submission source…'}
            </div>
          )}

          {state.status ===
            'error' && (
            <div
              style={{
                padding:
                  '1.5em',
                textAlign:
                  'center',
              }}
            >
              <div
                style={{
                  marginBottom: 10,
                  color:
                    theme.muted,
                }}
              >
                {
                  state.message
                }
              </div>

              <a
                href={url}
                target="_blank"
                rel="noopener"
                style={{
                  color:
                    theme.problemLink,
                  fontWeight: 600,
                }}
              >
                {'View on Codeforces ↗'}
              </a>
            </div>
          )}

          {state.status ===
            'ready' && (
            /*
             * Built from highlight()'s tokens as React text and spans
             * (never as HTML), so nothing in the submitted code is
             * ever interpreted as markup. Measured from the
             * Codeforces source view: 13px monospace, grey #eff0f1 box, no
             * padding.
             */
            <pre
              style={{
                margin: 0,
                padding: 0,
                background:
                  light
                    ? '#eff0f1'
                    : 'rgba(255,255,255,0.06)',
                color:
                  colors.pln,
                fontFamily:
                  'monospace',
                fontSize: 13,
                lineHeight:
                  'normal',
                whiteSpace:
                  'pre',
                overflowX:
                  'auto',
              }}
            >
              {tokens.map(
                (
                  token,
                  index,
                ) =>
                  token.type ===
                  'pln' ? (
                    token.text
                  ) : (
                    <span
                      key={
                        index
                      }
                      style={{
                        color:
                          colors[
                            token
                              .type
                          ],
                        fontWeight:
                          BOLD_TOKENS.has(
                            token.type,
                          )
                            ? 'bold'
                            : undefined,
                      }}
                    >
                      {
                        token.text
                      }
                    </span>
                  ),
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(
    content,
    document.body,
  );
}
