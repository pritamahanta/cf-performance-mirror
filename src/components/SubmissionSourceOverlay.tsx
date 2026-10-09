import {
  useEffect,
  useState,
} from 'react';

import type {
  CSSProperties,
  ReactNode,
} from 'react';

import { createPortal } from 'react-dom';

import { fetchSubmissionSourceText } from '../services/codeforcesApi';
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

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; source: string }
  | { status: 'error'; message: string };

/*
 * A submission's source code shown as an in-page overlay - a dimmed
 * backdrop with a centered box and a cross button to close it - the
 * same way Codeforces itself shows a submission's source in its own
 * "view source" dialog, instead of opening the submission's page in
 * a new tab.
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
          source,
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
        state.source,
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

  const backdropStyle: CSSProperties =
    {
      position: 'fixed',
      inset: 0,
      zIndex: 999999,
      background:
        'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent:
        'center',
      padding: 16,
      boxSizing:
        'border-box',
    };

  const boxStyle: CSSProperties =
    {
      position: 'relative',
      width: '100%',
      maxWidth: 820,
      maxHeight: '85vh',
      boxSizing:
        'border-box',
      display: 'flex',
      flexDirection:
        'column',
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow:
        '0 12px 36px rgba(0,0,0,0.35)',
      background:
        theme.dropdownBg,
      border: `1px solid ${theme.dropdownBorder}`,
      color: theme.text,
      fontFamily:
        theme.fontFamily,
    };

  const linkStyle: CSSProperties =
    {
      color:
        theme.problemLink,
      textDecoration:
        'none',
      cursor: 'pointer',
      background: 'none',
      border: 0,
      padding: 0,
      font: 'inherit',
      fontWeight: 600,
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
            top: 8,
            right: 10,
            background:
              'transparent',
            border: 0,
            padding: 4,
            cursor:
              'pointer',
            opacity: 0.55,
            fontSize: 18,
            lineHeight: 1,
            color:
              theme.text,
          }}
        >
          {'✕'}
        </button>

        <div
          style={{
            padding:
              '14px 42px 12px 16px',
            fontSize: 13,
            lineHeight: 1.5,
            borderBottom: `1px solid ${theme.dropdownBorder}`,
            flexShrink: 0,
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
            style={linkStyle}
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
            overflow: 'auto',
            flex: '1 1 auto',
            background:
              theme.isDark
                ? 'rgba(255,255,255,0.03)'
                : '#f5f5f5',
          }}
        >
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
            <pre
              style={{
                margin: 0,
                padding:
                  '12px 16px',
                fontFamily:
                  'Consolas, Menlo, Monaco, "Courier New", monospace',
                fontSize: 12.5,
                lineHeight: 1.5,
                whiteSpace:
                  'pre',
                color:
                  theme.text,
              }}
            >
              {state.source}
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
