import type { ExtensionSettings, SavedSettings } from '../types/settings';
import { VALID_TIMELINE_VALUES } from '../types/settings';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  category: 'Div4', mode: 'total', timeline: 'all', sortMode: 'errors',
  hideAC: false, hideTags: false, hideRatings: false, solvedOnly: false,
  minAttempts: 1, ratingMin: '', ratingMax: '', customStart: '', customEnd: '',
  tagFilters: [], customContestFrom: '', customContestTo: '',
  /*
   * On by default. This is the master switch (the Friends button in the
   * profile page's controls): while it is off the Online Friends box is
   * not rendered at all and makes no requests. While it is on the box
   * reads the user's own authenticated /friends page (see
   * fetchOnlineFriends) and stores the result in localStorage. A
   * logged-out visitor makes that one request and the box then shows
   * its "make sure you're logged in" message.
   *
   * An existing user who updates has no `friendsVisible` key saved yet,
   * so normalizeSettings gives them this default too: the box turns on
   * for them, and the privacy policy says so.
   */
  friendsVisible: true,
  /*
   * The Online Friends box's own open/closed state (its header chevron),
   * which only matters while the master switch above is on. Closed keeps
   * the header and makes no requests. Open by default, so turning the
   * feature on shows the list.
   */
  friendsExpanded: true,
  /*
   * Friends submissions box (problem pages only), independent of the
   * Online Friends box above. Same two-flag pattern: the master switch
   * is the profile controls' Submissions button and is ON by default
   * (it reads the user's authenticated /friends page and sends
   * Codeforces API requests while on); the expanded flag is the box's
   * own chevron on the problem page.
   */
  friendSubmissionsVisible: true,
  friendSubmissionsExpanded: true,
};

export function normalizeSettings(saved: SavedSettings): ExtensionSettings {
  const timeline = saved.timeline && VALID_TIMELINE_VALUES.has(saved.timeline) ? saved.timeline : DEFAULT_SETTINGS.timeline;
  const sortMode = saved.sortMode === 'rating' || saved.sortMode === 'errors' ? saved.sortMode : DEFAULT_SETTINGS.sortMode;
  return {
    category: saved.category || DEFAULT_SETTINGS.category,
    mode: saved.mode || DEFAULT_SETTINGS.mode,
    timeline,
    sortMode,
    hideAC: saved.hideAC ?? DEFAULT_SETTINGS.hideAC,
    hideTags: saved.hideTags ?? DEFAULT_SETTINGS.hideTags,
    hideRatings: saved.hideRatings ?? DEFAULT_SETTINGS.hideRatings,
    solvedOnly: saved.solvedOnly ?? DEFAULT_SETTINGS.solvedOnly,
    minAttempts: saved.minAttempts !== undefined ? Math.max(1, saved.minAttempts) : DEFAULT_SETTINGS.minAttempts,
    ratingMin: saved.ratingMin ?? DEFAULT_SETTINGS.ratingMin,
    ratingMax: saved.ratingMax ?? DEFAULT_SETTINGS.ratingMax,
    customStart: saved.customStart ?? DEFAULT_SETTINGS.customStart,
    customEnd: saved.customEnd ?? DEFAULT_SETTINGS.customEnd,
    tagFilters: Array.isArray(saved.tagFilters) ? saved.tagFilters : DEFAULT_SETTINGS.tagFilters,
    customContestFrom: saved.customContestFrom ?? DEFAULT_SETTINGS.customContestFrom,
    customContestTo: saved.customContestTo ?? DEFAULT_SETTINGS.customContestTo,
    friendsVisible: saved.friendsVisible ?? DEFAULT_SETTINGS.friendsVisible,
    friendsExpanded: saved.friendsExpanded ?? DEFAULT_SETTINGS.friendsExpanded,
    friendSubmissionsVisible: saved.friendSubmissionsVisible ?? DEFAULT_SETTINGS.friendSubmissionsVisible,
    friendSubmissionsExpanded: saved.friendSubmissionsExpanded ?? DEFAULT_SETTINGS.friendSubmissionsExpanded,
  };
}