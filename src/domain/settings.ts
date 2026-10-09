import type { ExtensionSettings, SavedSettings } from '../types/settings';
import { VALID_TIMELINE_VALUES } from '../types/settings';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  category: 'Div4', mode: 'total', timeline: 'all', sortMode: 'errors',
  hideAC: false, hideTags: false, hideRatings: false, solvedOnly: false,
  minAttempts: 1, ratingMin: '', ratingMax: '', customStart: '', customEnd: '',
  tagFilters: [], tableVisible: true, customContestFrom: '', customContestTo: '',
  /*
   * Off by default: it reads the user's own authenticated /friends page
   * (see fetchOnlineFriends) and stores the result in localStorage. An
   * existing user who updates has no `friendsVisible` key saved yet, so
   * they fall through to this default too (see normalizeSettings below)
   * - it must opt them in explicitly, not turn this on for them silently.
   *
   * This is the master switch (the people-icon button in the profile page's
   * controls): while it is off the Online Friends box is not rendered at
   * all and makes no requests.
   */
  friendsVisible: false,
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
   * is the profile controls' button and is OFF by default, because it
   * reads the user's authenticated /friends page and sends Codeforces API
   * requests; the expanded flag is the box's own chevron on the problem
   * page.
   */
  friendSubmissionsVisible: false,
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
    tableVisible: saved.tableVisible ?? DEFAULT_SETTINGS.tableVisible,
    customContestFrom: saved.customContestFrom ?? DEFAULT_SETTINGS.customContestFrom,
    customContestTo: saved.customContestTo ?? DEFAULT_SETTINGS.customContestTo,
    friendsVisible: saved.friendsVisible ?? DEFAULT_SETTINGS.friendsVisible,
    friendsExpanded: saved.friendsExpanded ?? DEFAULT_SETTINGS.friendsExpanded,
    friendSubmissionsVisible: saved.friendSubmissionsVisible ?? DEFAULT_SETTINGS.friendSubmissionsVisible,
    friendSubmissionsExpanded: saved.friendSubmissionsExpanded ?? DEFAULT_SETTINGS.friendSubmissionsExpanded,
  };
}