import {
  useEffect,
  useState,
} from 'react';

import {
  normalizeSettings,
} from '../domain/settings';

import {
  SETTINGS_CHANGED_EVENT,
  loadSettings,
} from '../services/storage';

function readFriendsVisible(): boolean {
  return normalizeSettings(
    loadSettings(),
  ).friendsVisible;
}

/*
 * Whether the Online Friends box should be shown.
 *
 * The toggle button lives in the profile-page
 * controls, but the box itself is mounted in a
 * separate React root in the sidebar, so it can't
 * read the controls' state. It used to read the
 * saved setting once at mount, which meant the
 * button only took effect after a page reload.
 * This hook re-reads the saved setting whenever
 * settings are saved, so the box shows/hides
 * immediately.
 */
export function useFriendsVisible(): boolean {
  const [visible, setVisible] =
    useState(
      readFriendsVisible,
    );

  useEffect(() => {
    const sync = () => {
      setVisible(
        readFriendsVisible(),
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

  return visible;
}
