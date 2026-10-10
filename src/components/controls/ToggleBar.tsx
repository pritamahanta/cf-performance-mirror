import type { ReactNode } from 'react';

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

const VIEWS: Array<{
  view: 'timings' | 'problems';
  label: string;
  hint: string;
  icon: ReactNode;
}> = [
  {
    view: 'timings',
    label: 'Timings',
    hint: 'Open: average and median solve time for each problem letter',
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
    hint: 'Open: the problems you got errors on, with their submissions',
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
    noun: 'the Online Friends box in the sidebar',
  },
  {
    key: 'friendSubmissionsVisible',
    label: 'Submissions',
    noun: 'the Friends submissions box (problem pages)',
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
          <button
            key={view}
            type="button"
            className="cfpm-pill-btn"
            title={hint}
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
          </button>
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
            <button
              key={key}
              type="button"
              className="cfpm-pill-btn"
              title={`${on ? 'On' : 'Off'}: ${noun}. Click to turn ${on ? 'off' : 'on'}.`}
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
