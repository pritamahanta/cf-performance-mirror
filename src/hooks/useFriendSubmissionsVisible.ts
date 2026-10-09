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

export interface FriendSubmissionsVisibility {
  /*
   * Master switch (`friendSubmissionsVisible`, the list-with-checks
   * button in the profile page's controls). Off: the box is not
   * rendered at all and nothing is requested.
   */
  enabled: boolean;

  /*
   * The box's own open/closed chevron (`friendSubmissionsExpanded`).
   * Closed: header only, nothing is requested.
   */
  expanded: boolean;
}

function read(): FriendSubmissionsVisibility {
  const settings =
    normalizeSettings(
      loadSettings(),
    );

  return {
    enabled:
      settings.friendSubmissionsVisible,
    expanded:
      settings.friendSubmissionsExpanded,
  };
}

/*
 * Same idea as useFriendsVisible, for the Friends submissions box: it
 * lives in its own React root, so it re-reads the saved settings
 * whenever settings are saved.
 */
export function useFriendSubmissionsVisible(): FriendSubmissionsVisibility {
  const [visibility, setVisibility] =
    useState(read);

  useEffect(() => {
    const sync = () => {
      const fresh = read();

      setVisibility(current =>
        current.enabled === fresh.enabled &&
        current.expanded === fresh.expanded
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
