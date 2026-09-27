import type { ExtensionSettings, SavedSettings } from '../types/settings';
import { VALID_TIMELINE_VALUES } from '../types/settings';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  category: 'Div4', mode: 'total', timeline: 'all', sortMode: 'errors',
  hideAC: false, hideTags: false, hideRatings: false, solvedOnly: false,
  minAttempts: 1, ratingMin: '', ratingMax: '', customStart: '', customEnd: '',
  tagFilters: [], tableVisible: true, customContestFrom: '', customContestTo: '',
  friendsVisible: true,
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
  };
}