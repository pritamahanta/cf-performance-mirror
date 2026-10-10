import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { ExtensionSettings } from '../../types/settings';
import type { Theme } from '../../domain/theme';

interface Props {
  settings: ExtensionSettings;
  theme: Theme;
  onChange: (patch: Partial<ExtensionSettings>) => void;
  /* Open the Timings or Problems box. */
  onOpen: (view: 'timings' | 'problems') => void;
}

type ToggleKey =
  | 'friendsVisible'
  | 'friendSubmissionsVisible';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/*
 * A button that explains itself on hover or keyboard focus. The text is a
 * bubble rendered over the page (not inside the card, whose body clips
 * anything that sticks out), so it is never cut off.
 */
const TIP_WIDTH = 260;

function TipButton({
  tip,
  theme,
  children,
  onClick,
  ...rest
}: {
  tip: string;
  theme: Theme;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick: () => void;
  'aria-pressed'?: boolean;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const room = window.innerWidth - TIP_WIDTH - 8;

    setAt({
      left: Math.max(8, Math.min(rect.left, room)),
      top: rect.bottom + 6,
    });
  };

  const hide = () => setAt(null);

  /* A fixed bubble would be left behind if the page scrolls under it. */
  useEffect(() => {
    if (!at) {
      return;
    }

    window.addEventListener('scroll', hide, { capture: true, passive: true });

    return () => window.removeEventListener('scroll', hide, true);
  }, [at]);

  return (
    <>
      <button
        type="button"
        aria-label={tip}
        onMouseEnter={event => show(event.currentTarget)}
        onMouseLeave={hide}
        onFocus={event => show(event.currentTarget)}
        onBlur={hide}
        onClick={() => {
          /* The window it opens covers the button; the bubble must not linger. */
          hide();
          onClick();
        }}
        {...rest}
      >
        {children}
      </button>

      {at &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: at.left,
              top: at.top,
              width: TIP_WIDTH,
              boxSizing: 'border-box',
              zIndex: 999999,
              pointerEvents: 'none',
              padding: '7px 10px',
              borderRadius: 5,
              fontSize: 12,
              lineHeight: 1.45,
              fontFamily: theme.fontFamily,
              background: theme.isDark ? '#e8e8e8' : '#2b2b2b',
              color: theme.isDark ? '#1a1a1a' : '#f5f5f5',
              boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
            }}
          >
            {tip}
          </div>,
          document.body,
        )}
    </>
  );
}

const VIEWS: Array<{
  view: 'timings' | 'problems';
  label: string;
  hint: string;
  icon: ReactNode;
}> = [
  {
    view: 'timings',
    label: 'Timings',
    hint: 'Opens a window with your average and median solve time for each problem letter (A, B, C…).',
    icon: (
      <Icon>
        <rect x="1" y="2" width="14" height="12" rx="1.5" />
        <path d="M1 6h14" />
        <path d="M1 10h14" />
        <path d="M5.5 6v8" />
      </Icon>
    ),
  },
  {
    view: 'problems',
    label: 'Problems',
    hint: 'Opens a window listing the problems you got errors on, with filters and the submissions behind each count.',
    icon: (
      <Icon>
        <path d="M3.5 1.5h6l3 3v10h-9z" />
        <path d="M9.5 1.5v3h3" />
        <path d="M5.5 8h5" />
        <path d="M5.5 11h5" />
      </Icon>
    ),
  },
];

const TOGGLES: Array<{
  key: ToggleKey;
  label: string;
  noun: string;
}> = [
  {
    key: 'friendsVisible',
    label: 'Friends',
    noun: 'the Online Friends box in the right sidebar of Codeforces pages (who is online now)',
  },
  {
    key: 'friendSubmissionsVisible',
    label: 'Submissions',
    noun: 'the Friends submissions box on problem pages (which friends submitted that problem)',
  },
];

/*
 * The profile card's one row. Left: Timings and Problems, which open
 * their own box over the page (each carrying the Div /
 * time-or-contest / total-or-rated filters). Right: the two sidebar
 * boxes (Friends, Submissions) as quiet switches - a dot that is lit
 * while the box is on.
 */
export function ToggleBar({ settings, theme, onChange, onOpen }: Props) {
  return (
    <div
      className="cfpm-toggle-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        margin: '10px 0 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {VIEWS.map(({ view, label, hint, icon }) => (
          <TipButton
            key={view}
            tip={hint}
            theme={theme}
            className="cfpm-pill-btn"
            style={{
              gap: 6,
              background: theme.btnBg,
              color: theme.btnText,
              border: `1px solid ${theme.btnBorder}`,
            }}
            onClick={() => onOpen(view)}
          >
            {icon}
            <span>{label}</span>
          </TipButton>
        ))}
      </div>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        role="group"
        aria-label="Sidebar boxes"
      >
        <span
          style={{
            marginRight: 2,
            fontSize: 11,
            color: theme.muted,
            whiteSpace: 'nowrap',
          }}
        >
          Sidebar
        </span>

        {TOGGLES.map(({ key, label, noun }) => {
          const on = settings[key];

          return (
            <TipButton
              key={key}
              theme={theme}
              tip={`${label} is ${on ? 'on' : 'off'}: ${noun}. Click to turn it ${on ? 'off' : 'on'}.`}
              className="cfpm-pill-btn"
              aria-pressed={on}
              style={{
                gap: 7,
                background: 'transparent',
                color: on ? theme.text : theme.muted,
                border: `1px solid ${theme.btnBorder}`,
              }}
              onClick={() => {
                const patch: Partial<ExtensionSettings> = {};
                patch[key] = !on;
                onChange(patch);
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  flexShrink: 0,
                  background: on ? '#27ae60' : 'transparent',
                  border: `1.5px solid ${on ? '#27ae60' : theme.muted}`,
                }}
              />
              <span>{label}</span>
            </TipButton>
          );
        })}
      </div>
    </div>
  );
}
