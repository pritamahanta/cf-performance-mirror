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
  icon: ReactNode;
}> = [
  {
    key: 'friendsVisible',
    label: 'Friends',
    noun: 'the Online Friends box in the sidebar',
    icon: (
      <Icon>
        <circle cx="6" cy="5.2" r="2.2" />
        <path d="M1.6 13.2c0-2.4 1.9-3.8 4.4-3.8s4.4 1.4 4.4 3.8" />
        <circle cx="12.1" cy="6.1" r="1.7" />
        <path d="M10.3 9.2c1.8 0.3 3.1 1.5 3.1 4" />
      </Icon>
    ),
  },
  {
    key: 'friendSubmissionsVisible',
    label: 'Submissions',
    noun: 'the Friends submissions box (problem pages)',
    icon: (
      <Icon>
        <path d="M5.5 3.5h8" />
        <path d="M5.5 8h8" />
        <path d="M5.5 12.5h8" />
        <path d="M1.8 3.5l.8.8 1.4-1.6" />
        <path d="M1.8 8l.8.8 1.4-1.6" />
        <path d="M1.8 12.5l.8.8 1.4-1.6" />
      </Icon>
    ),
  },
];

/*
 * The profile card's buttons. Timings and Problems open their own box
 * over the page (each carrying the Div / time-or-contest / total-or-rated
 * filters); Friends and Submissions switch the two sidebar boxes on or
 * off, and say so in the label next to them.
 */
export function ToggleBar({ settings, theme, onChange, onOpen }: Props) {
  return (
    <div
      className="cfpm-toggle-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 7,
        margin: '12px 0',
      }}
    >
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

      <span
        style={{
          marginLeft: 8,
          fontSize: 11,
          color: theme.muted,
          whiteSpace: 'nowrap',
        }}
      >
        Sidebar boxes:
      </span>

      {TOGGLES.map(({ key, label, noun, icon }) => {
        const on = settings[key];

        return (
          <button
            key={key}
            type="button"
            className={`cfpm-pill-btn ${on ? 'active' : ''}`}
            title={`${on ? 'On' : 'Off'}: ${noun}. Click to turn ${on ? 'off' : 'on'}.`}
            aria-pressed={on}
            style={{
              gap: 6,
              background: on ? theme.btnActiveBg : theme.btnBg,
              color: on ? theme.btnActiveText : theme.muted,
              border: `1px solid ${on ? theme.btnActiveBorder : theme.btnBorder}`,
            }}
            onClick={() => {
              const patch: Partial<ExtensionSettings> = {};
              patch[key] = !on;
              onChange(patch);
            }}
          >
            {icon}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
