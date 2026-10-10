import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  CSSProperties,
} from 'react';

import type {
  PerformanceEngine,
} from '../domain/performanceEngine';

import type {
  Theme,
} from '../domain/theme';

import type {
  ExtensionSettings,
} from '../types/settings';

import type {
  ResolvedTimeline,
} from '../types/performance';

import {
  resolveTimelineValue,
  timelineLabel,
} from '../domain/timeline';

import {
  usePerformanceData,
} from '../hooks/usePerformanceData';

import {
  normalizeSettings,
} from '../domain/settings';

import {
  SETTINGS_CHANGED_EVENT,
  loadSettings,
} from '../services/storage';

import {
  PerformanceTable,
} from './PerformanceTable';

import {
  Controls,
} from './controls/Controls';

import {
  ToggleBar,
} from './controls/ToggleBar';

import {
  Sandbox,
} from './Sandbox';

import {
  FrictionPanel,
} from './friction/FrictionPanel';

/* Max width (px) of the Timings box; the table scrolls sideways inside it. */
const TIMINGS_MAX_WIDTH = 560;

interface Props {
  engine: PerformanceEngine;
  initialSettings: ExtensionSettings;
  initialEnabled: boolean;
  theme: Theme;

  onSettingsChange:
    (
      settings: ExtensionSettings,
    ) => void;

  onEnabledChange:
    (
      enabled: boolean,
    ) => void;
}

function timelineDisplayLabel(
  settings: ExtensionSettings,
): string {
  if (
    settings.timeline ===
      'custom' &&
    settings.customStart &&
    settings.customEnd
  ) {
    return `${settings.customStart} → ${settings.customEnd}`;
  }

  if (
    settings.timeline ===
      'cc' &&
    settings.customContestFrom &&
    settings.customContestTo
  ) {
    const from =
      Number.parseInt(
        settings.customContestFrom,
        10,
      );

    const to =
      Number.parseInt(
        settings.customContestTo,
        10,
      );

    if (
      !Number.isNaN(from) &&
      !Number.isNaN(to)
    ) {
      const lo =
        Math.min(
          from,
          to,
        );

      const hi =
        Math.max(
          from,
          to,
        );

      return lo === 1
        ? `Last ${hi} contests`
        : `Contests ${lo}–${hi} most recent`;
    }

    return 'Custom contests';
  }

  return timelineLabel(
    settings.timeline,
  );
}

export function PerformanceMirror({
  engine,
  initialSettings,
  initialEnabled,
  theme,
  onSettingsChange,
  onEnabledChange,
}: Props) {
  const [
    settings,
    setSettings,
  ] = useState(
    initialSettings,
  );

  const [
    enabled,
    setEnabled,
  ] = useState(
    initialEnabled,
  );

  const [
    popupSort,
    setPopupSort,
  ] = useState<
    'time' | 'contest'
  >('time');

  const resolvedTimeline:
    ResolvedTimeline =
      useMemo(
        () =>
          resolveTimelineValue(
            settings.timeline,
            settings.customStart,
            settings.customEnd,
            settings.customContestFrom,
            settings.customContestTo,
          ),
        [
          settings.timeline,
          settings.customStart,
          settings.customEnd,
          settings.customContestFrom,
          settings.customContestTo,
        ],
      );

  const {
    modeData,
    deltaInfoByCategory,
  } =
    usePerformanceData(
      engine,
      settings.mode,
      resolvedTimeline,
    );

  const deltaInfo =
    deltaInfoByCategory[
      settings.category
    ];

  useEffect(() => {
    onSettingsChange(
      settings,
    );
  }, [
    settings,
    onSettingsChange,
  ]);

  /*
   * friendsExpanded is toggled from the Online Friends
   * box's own chevron, in a separate React root that
   * saves straight to storage. Without this, this
   * panel's own local `settings` copy would go stale
   * after that - and the next change made here (even an
   * unrelated one, like the category) would silently
   * write the stale value back, clobbering the box's
   * own open/closed state. friendsVisible (the master
   * switch) is kept in the same sync so the two can
   * never drift apart.
   */
  useEffect(() => {
    const sync = () => {
      const fresh =
        normalizeSettings(
          loadSettings(),
        );

      setSettings(
        current =>
          current.friendsVisible ===
            fresh.friendsVisible &&
          current.friendsExpanded ===
            fresh.friendsExpanded &&
          current.friendSubmissionsVisible ===
            fresh.friendSubmissionsVisible &&
          current.friendSubmissionsExpanded ===
            fresh.friendSubmissionsExpanded
            ? current
            : {
                ...current,
                friendsVisible:
                  fresh.friendsVisible,
                friendsExpanded:
                  fresh.friendsExpanded,
                friendSubmissionsVisible:
                  fresh.friendSubmissionsVisible,
                friendSubmissionsExpanded:
                  fresh.friendSubmissionsExpanded,
              },
      );
    };

    window.addEventListener(
      SETTINGS_CHANGED_EVENT,
      sync,
    );

    return () => {
      window.removeEventListener(
        SETTINGS_CHANGED_EVENT,
        sync,
      );
    };
  }, []);

  const updateSettings = (
    patch: Partial<ExtensionSettings>,
  ) => {
    setSettings(
      current => ({
        ...current,
        ...patch,
      }),
    );
  };

  const infoText =
    useMemo(() => {
      const count =
        modeData
          .categoryContestCount[
            settings.category
          ] || 0;

      let text =
        `${modeData.participatedCount} contests total · ` +
        `${settings.category}: ${count}`;

      if (
        deltaInfo?.count >
        0
      ) {
        text +=
          ` · Δ ${deltaInfo.delta >= 0 ? '+' : ''}` +
          `${deltaInfo.delta} (${deltaInfo.count} rated)`;
      }

      const mode =
        settings.mode[0].toUpperCase() +
        settings.mode.slice(1);

      return (
        `${text} · ${mode} · ` +
        `${timelineDisplayLabel(
          settings,
        )}`
      );
    }, [
      modeData,
      settings,
      deltaInfo,
    ]);

  const cardStyle:
    CSSProperties = {
    boxSizing:
      'border-box',
    fontFamily:
      theme.fontFamily,
    fontSize: 14,
    color:
      theme.text,
    background:
      theme.bg,
    border:
      `1px solid ${theme.border}`,
    borderRadius: 5,
    padding: 0,
    marginTop: 10,
    maxWidth: 920,
  };

  const infoLine = (
    <div
      className="cfpm-info"
      style={{
        color:
          theme.muted,
      }}
    >
      {infoText}
    </div>
  );

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems:
            'center',
          justifyContent:
            'space-between',
          padding:
            '5px 12px',
          gap: 10,
          minHeight: 32,
          boxSizing:
            'border-box',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color:
              theme.muted,
            letterSpacing:
              '0.1em',
            cursor:
              'default',
            userSelect:
              'none',
            fontFamily:
              'monospace',
            opacity:
              enabled
                ? 0.8
                : 0.4,
          }}
        >
          cfpm
        </span>

        <button
          id="cfpm-chevron-btn"
          className={
            enabled
              ? ''
              : 'collapsed'
          }
          title={
            enabled
              ? 'Collapse'
              : 'Expand'
          }
          aria-label={
            enabled
              ? 'Collapse CF Performance Mirror'
              : 'Expand CF Performance Mirror'
          }
          style={{
            color:
              theme.muted,
          }}
          onClick={() => {
            const next =
              !enabled;

            setEnabled(
              next,
            );

            onEnabledChange(
              next,
            );
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 4.5l4 4 4-4" />
          </svg>
        </button>
      </div>

      <div
        id="cfpm-header-divider"
        style={{
          background:
            theme.borderLight,
        }}
      />

      <div
        id="cfpm-body"
        className={
          enabled
            ? ''
            : 'cfpm-collapsed'
        }
      >
        <ToggleBar
          settings={
            settings
          }
          theme={
            theme
          }
          onChange={
            updateSettings
          }
        />

        <div
          id="cfpm-timeline-extra"
        />

        {settings.tableVisible && (
          <Sandbox
            title="Timings"
            theme={
              theme
            }
            maxWidth={
              TIMINGS_MAX_WIDTH
            }
          >
            <Controls
              settings={
                settings
              }
              theme={
                theme
              }
              onChange={
                updateSettings
              }
            />

            {infoLine}

            <div
              className="cfpm-table-scroll"
              style={{
                marginBottom: 0,
              }}
            >
              <PerformanceTable
                modeData={
                  modeData
                }
                category={
                  settings.category
                }
                deltaInfo={
                  deltaInfo ??
                  null
                }
                theme={
                  theme
                }
                popupSort={
                  popupSort
                }
                onPopupSortChange={
                  setPopupSort
                }
              />
            </div>
          </Sandbox>
        )}

        {settings.problemsVisible && (
          <Sandbox
            title="Problems"
            theme={
              theme
            }
          >
            <Controls
              settings={
                settings
              }
              theme={
                theme
              }
              onChange={
                updateSettings
              }
            />

            {infoLine}

            <FrictionPanel
              modeData={
                modeData
              }
              category={
                settings.category
              }
              settings={
                settings
              }
              theme={
                theme
              }
              onSettingsChange={
                updateSettings
              }
              popupSort={
                popupSort
              }
              onPopupSortChange={
                setPopupSort
              }
            />
          </Sandbox>
        )}
      </div>
    </>
  );
}