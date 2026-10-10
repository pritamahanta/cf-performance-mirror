export type Category = 'Div1' | 'Div2' | 'Div3' | 'Div4' | 'Other';
export type Mode = 'total' | 'rated' | 'unrated';
export type SortMode = 'errors' | 'rating';
export type TimelineValue = 'all' | '1' | '3' | '6' | '12' | '24' | 'custom' | 'c5' | 'c10' | 'c20' | 'cc';

export interface SavedSettings {
  category?: Category;
  mode?: Mode;
  timeline?: TimelineValue;
  sortMode?: SortMode;
  hideAC?: boolean;
  hideTags?: boolean;
  hideRatings?: boolean;
  solvedOnly?: boolean;
  minAttempts?: number;
  ratingMin?: string;
  ratingMax?: string;
  customStart?: string;
  customEnd?: string;
  tagFilters?: string[];
  customContestFrom?: string;
  customContestTo?: string;
  friendsVisible?: boolean;
  friendsExpanded?: boolean;
  friendSubmissionsVisible?: boolean;
  friendSubmissionsExpanded?: boolean;
}

export interface ExtensionSettings {
  category: Category;
  mode: Mode;
  timeline: TimelineValue;
  sortMode: SortMode;
  hideAC: boolean;
  hideTags: boolean;
  hideRatings: boolean;
  solvedOnly: boolean;
  minAttempts: number;
  ratingMin: string;
  ratingMax: string;
  customStart: string;
  customEnd: string;
  tagFilters: string[];
  customContestFrom: string;
  customContestTo: string;
  friendsVisible: boolean;
  friendsExpanded: boolean;
  friendSubmissionsVisible: boolean;
  friendSubmissionsExpanded: boolean;
}

export const CATEGORIES: Category[] = ['Div1', 'Div2', 'Div3', 'Div4', 'Other'];
export const DEFAULT_INDICES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const VALID_TIMELINE_VALUES = new Set<TimelineValue>(['all', '1', '3', '6', '12', '24', 'custom', 'c5', 'c10', 'c20', 'cc']);