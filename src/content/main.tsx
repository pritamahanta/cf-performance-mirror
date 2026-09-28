import { createRoot } from 'react-dom/client';
import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import { PerformanceMirror } from '../components/PerformanceMirror';
import { OnlineFriendsPanel } from '../components/friends/OnlineFriendsPanel';
import { useTheme } from '../hooks/useTheme';
import { normalizeSettings } from '../domain/settings';
import { PerformanceEngine } from '../domain/performanceEngine';

import {
  fetchContests,
  fetchUserDataset,
} from '../services/codeforcesApi';

import {
  loadSettings,
  loadToggle,
  saveSettings,
  saveToggle,
} from '../services/storage';

import {
  mountExtension,
  mountOnlineFriendsHost,
  observeWidth,
} from './mount';

import type {
  CodeforcesContest,
} from '../types/codeforces';

import type {
  ExtensionSettings,
} from '../types/settings';

import css from '../styles/performance-mirror.css?inline';

const HANDLE_RE =
  /^[a-zA-Z0-9_\-.]{2,24}$/;

type LoadState =
  | {
      status: 'loading';
    }
  | {
      status: 'ready';
      engine: PerformanceEngine;
    }
  | {
      status: 'error';
      message: string;
    };

interface AppProps {
  initialSettings:
    ExtensionSettings;

  initialEnabled:
    boolean;

  onSettingsChange:
    (
      settings: ExtensionSettings,
    ) => void;

  onEnabledChange:
    (
      enabled: boolean,
    ) => void;

  loadState: LoadState;
}

function App({
  initialSettings,
  initialEnabled,
  onSettingsChange,
  onEnabledChange,
  loadState,
}: AppProps) {
  const theme =
    useTheme();

  useEffect(() => {
    const host =
      document.getElementById(
        'cfpm-compact',
      );

    if (!host) return;

    host.style.cssText = [
      'box-sizing:border-box',
      'font-family:Arial,sans-serif',
      'font-size:14px',
      `color:${theme.text}`,
      `background:${theme.bg}`,
      `border:1px solid ${theme.border}`,
      'border-radius:5px',
      'padding:0',
      'margin-top:10px',
      'max-width:920px',
    ].join(';');

    host.style.setProperty(
      '--cfpm-bg',
      theme.bg,
    );

    host.style.setProperty(
      '--cfpm-text',
      theme.text,
    );

    host.style.setProperty(
      '--cfpm-border',
      theme.border,
    );

    host.style.setProperty(
      '--cfpm-border-light',
      theme.borderLight,
    );

    host.style.setProperty(
      '--cfpm-border-lighter',
      theme.borderLighter,
    );

    host.style.setProperty(
      '--cfpm-muted',
      theme.muted,
    );

    host.style.setProperty(
      '--cfpm-muted-strong',
      theme.mutedStrong,
    );

    host.style.setProperty(
      '--cfpm-heading',
      theme.headingText,
    );

    host.style.setProperty(
      '--cfpm-table-header',
      theme.tableHeaderText,
    );

    host.style.setProperty(
      '--cfpm-table-cell',
      theme.tableCellText,
    );

    host.style.setProperty(
      '--cfpm-btn-bg',
      theme.btnBg,
    );

    host.style.setProperty(
      '--cfpm-btn-text',
      theme.btnText,
    );

    host.style.setProperty(
      '--cfpm-btn-border',
      theme.btnBorder,
    );

    host.style.setProperty(
      '--cfpm-active-bg',
      theme.btnActiveBg,
    );

    host.style.setProperty(
      '--cfpm-active-text',
      theme.btnActiveText,
    );

    host.style.setProperty(
      '--cfpm-active-border',
      theme.btnActiveBorder,
    );

    host.style.setProperty(
      '--cfpm-empty',
      theme.emptyText,
    );

    host.style.setProperty(
      '--cfpm-input-bg',
      theme.inputBg,
    );

    host.style.setProperty(
      '--cfpm-input-text',
      theme.inputText,
    );

    host.style.setProperty(
      '--cfpm-input-border',
      theme.inputBorder,
    );

    host.style.setProperty(
      '--cfpm-dropdown-bg',
      theme.dropdownBg,
    );

    host.style.setProperty(
      '--cfpm-dropdown-border',
      theme.dropdownBorder,
    );

    host.style.setProperty(
      '--cfpm-dropdown-section',
      theme.dropdownSection,
    );

    host.style.setProperty(
      '--cfpm-accent',
      theme.accentBlue,
    );
  }, [theme]);

  if (
    loadState.status ===
    'ready'
  ) {
    return (
      <PerformanceMirror
        engine={
          loadState.engine
        }
        initialSettings={
          initialSettings
        }
        initialEnabled={
          initialEnabled
        }
        theme={theme}
        onSettingsChange={
          onSettingsChange
        }
        onEnabledChange={
          onEnabledChange
        }
      />
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
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
            opacity: 0.8,
          }}
        >
          cfpm
        </span>
      </div>

      <div
        id="cfpm-header-divider"
        style={{
          height: 1,
          background:
            theme.borderLight,
        }}
      />

      <div id="cfpm-body">
        <div
          style={{
            padding:
              '0 14px 14px',
            boxSizing:
              'border-box',
          }}
        >
          <div
            style={{
              color:
                theme.muted,
              fontSize: 12,
              marginTop: 2,
              marginBottom: 10,
            }}
          >
            {loadState.status ===
            'loading'
              ? 'Loading…'
              : loadState.message}
          </div>
        </div>
      </div>
    </>
  );
}

function createEngine(
  contests: CodeforcesContest[],
  submissions: Awaited<
    ReturnType<
      typeof fetchUserDataset
    >
  >['submissions'],
  ratingHistory: Awaited<
    ReturnType<
      typeof fetchUserDataset
    >
  >['ratingHistory'],
): PerformanceEngine {
  const contestMap =
    Object.fromEntries(
      contests.map(
        contest => [
          contest.id,
          contest,
        ],
      ),
    ) as Record<
      number,
      CodeforcesContest
    >;

  const ratedContestSet =
    new Set<number>(
      ratingHistory.map(
        change =>
          change.contestId,
      ),
    );

  return new PerformanceEngine({
    contestMap,
    rawSubmissions:
      submissions,
    ratedContestSet,
    userRatingHistory:
      ratingHistory,
  });
}

function Root() {
  const settings =
    useMemo(
      () =>
        normalizeSettings(
          loadSettings(),
        ),
      [],
    );

  const initialEnabled =
    useMemo(
      () => loadToggle(),
      [],
    );

  const [loadState, setLoadState] =
    useState<LoadState>({
      status: 'loading',
    });

  useEffect(() => {
    let cancelled =
      false;

    const handle =
      (
        window.location.pathname
          .split('/')[2] ||
        ''
      ).trim();

    if (
      !HANDLE_RE.test(handle)
    ) {
      setLoadState({
        status: 'error',
        message:
          'Could not detect a valid Codeforces username in the page URL.',
      });

      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const [
          contests,
          dataset,
        ] =
          await Promise.all([
            fetchContests(),
            fetchUserDataset(
              handle,
            ),
          ]);

        if (cancelled) {
          return;
        }

        setLoadState({
          status: 'ready',
          engine:
            createEngine(
              contests,
              dataset.submissions,
              dataset.ratingHistory,
            ),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof
            Error &&
          error.message
            ? error.message
            : 'Could not connect to Codeforces. Please check your connection and try again.';

        setLoadState({
          status: 'error',
          message:
            message ===
            'unknown'
              ? 'Codeforces returned an error: unknown'
              : message.startsWith(
                  'Codeforces returned',
                )
                ? message
                : 'Could not connect to Codeforces. Please check your connection and try again.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveCurrentSettings =
    (
      next: ExtensionSettings,
    ): void =>
      saveSettings(next);

  return (
    <App
      initialSettings={
        settings
      }
      initialEnabled={
        initialEnabled
      }
      onSettingsChange={
        saveCurrentSettings
      }
      onEnabledChange={
        saveToggle
      }
      loadState={
        loadState
      }
    />
  );
}

function ensureStylesInjected(): void {
  const styleId =
    'cfpm-toggle-style';

  const oldStyle =
    document.getElementById(
      styleId,
    );

  if (oldStyle) {
    return;
  }

  const style =
    document.createElement(
      'style',
    );

  style.id =
    styleId;

  style.textContent = css;

  document.head.appendChild(
    style,
  );
}

/*
 * The Online Friends box is independent of the
 * full performance-mirror app: it should appear
 * in the Codeforces sidebar on any page that has
 * one (contest pages, blog pages, problem pages,
 * ...), not only on /profile/* pages. Mounted
 * separately from Root/App/PerformanceMirror so it
 * doesn't depend on being on a profile page at all.
 */
function mountOnlineFriendsWidget(): void {
  const host =
    mountOnlineFriendsHost();

  if (!host) {
    return;
  }

  if (
    host.dataset
      .cfpmMounted ===
    'true'
  ) {
    return;
  }

  host.dataset.cfpmMounted =
    'true';

  const settings =
    normalizeSettings(
      loadSettings(),
    );

  createRoot(host).render(
    <OnlineFriendsPanel
      visible={
        settings.friendsVisible
      }
    />,
  );
}

function installApp(): void {
  ensureStylesInjected();

  mountOnlineFriendsWidget();

  if (
    document.getElementById(
      'cfpm-compact',
    )
  ) {
    return;
  }

  const handle =
    (
      window.location.pathname
        .split('/')[2] ||
      ''
    ).trim();

  if (
    !HANDLE_RE.test(handle)
  ) {
    return;
  }

  const {
    host,
    appRoot,
    widthSource,
  } =
    mountExtension();

  observeWidth(
    host,
    widthSource,
  );

  createRoot(
    appRoot,
  ).render(
    <Root />,
  );
}

installApp();