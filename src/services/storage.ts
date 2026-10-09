import type { ExtensionSettings, SavedSettings } from '../types/settings';
import { normalizeSettings } from '../domain/settings';

export const SETTINGS_KEY = 'cfpm_defaults';
export const TOGGLE_KEY = 'cfpm_enabled';

// Fired on `window` (same tab) every time settings are saved. The Online Friends
// panel lives in its own React root in the Codeforces sidebar, so it can't share
// state with the profile-page controls; it listens for this instead.
export const SETTINGS_CHANGED_EVENT = 'cfpm:settings-changed';

export function loadSettings(storage: Storage = localStorage): SavedSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as SavedSettings;
  } catch {
    // Preserve legacy behavior: storage failures are non-fatal.
  }
  return {};
}

export function saveSettings(settings: Partial<ExtensionSettings>, storage: Storage = localStorage): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
  } catch {
    // Preserve legacy behavior: storage failures are non-fatal.
  }
}

/*
 * Flips `friendsVisible` and persists it. Reads the full saved
 * settings fresh from storage rather than taking a value from the
 * caller - saveSettings() overwrites storage with exactly what it's
 * given, so writing a bare `{friendsVisible}` patch here would wipe
 * every other saved setting (category, timeline, hideAC, ...).
 * Returns the new value.
 */
export function toggleFriendsVisible(storage: Storage = localStorage): boolean {
  const next = normalizeSettings(loadSettings(storage));
  next.friendsVisible = !next.friendsVisible;
  saveSettings(next, storage);
  return next.friendsVisible;
}

/*
 * Same as toggleFriendsVisible, for `friendsExpanded` (the Online
 * Friends box's own open/closed chevron). Returns the new value.
 */
export function toggleFriendsExpanded(storage: Storage = localStorage): boolean {
  const next = normalizeSettings(loadSettings(storage));
  next.friendsExpanded = !next.friendsExpanded;
  saveSettings(next, storage);
  return next.friendsExpanded;
}

/*
 * Same as toggleFriendsExpanded, for `friendSubmissionsExpanded` (the
 * Friends submissions box's own open/closed chevron). Returns the new
 * value.
 */
export function toggleFriendSubmissionsExpanded(storage: Storage = localStorage): boolean {
  const next = normalizeSettings(loadSettings(storage));
  next.friendSubmissionsExpanded = !next.friendSubmissionsExpanded;
  saveSettings(next, storage);
  return next.friendSubmissionsExpanded;
}

export function loadToggle(storage: Storage = localStorage): boolean {
  try {
    const value = storage.getItem(TOGGLE_KEY);
    return value === null ? true : value === 'true';
  } catch {
    return true;
  }
}

export function saveToggle(enabled: boolean, storage: Storage = localStorage): void {
  try {
    storage.setItem(TOGGLE_KEY, String(enabled));
  } catch {
    // Preserve legacy behavior: storage failures are non-fatal.
  }
}
