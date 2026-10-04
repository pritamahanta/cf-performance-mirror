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

export interface FriendsVisibility {
  /*
   * Master switch (`friendsVisible`, the people-icon button in
   * the profile page's controls). Off: the box is not rendered
   * at all and nothing is requested.
   */
  enabled: boolean;

  /*
   * The box's own open/closed chevron (`friendsExpanded`). Only
   * meaningful while `enabled`. Closed: header only, nothing is
   * requested.
   */
  expanded: boolean;
}

function readFriendsVisibility(): FriendsVisibility {
  const settings =
    normalizeSettings(
      loadSettings(),
    );

  return {
    enabled:
      settings.friendsVisible,
    expanded:
      settings.friendsExpanded,
  };
}

/*
 * The two saved flags that decide what the Online Friends box
 * shows.
 *
 * The master switch lives in the profile-page controls, but the
 * box itself is mounted in a separate React root in the sidebar,
 * so it can't read the controls' state. This hook re-reads the
 * saved settings whenever settings are saved, so the box follows
 * either flag immediately, without a page reload.
 */
export function useFriendsVisible(): FriendsVisibility {
  const [visibility, setVisibility] =
    useState(
      readFriendsVisibility,
    );

  useEffect(() => {
    const sync = () => {
      const fresh =
        readFriendsVisibility();

      setVisibility(
        current =>
          current.enabled ===
            fresh.enabled &&
          current.expanded ===
            fresh.expanded
            ? current
            : fresh,
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

  return visibility;
}
