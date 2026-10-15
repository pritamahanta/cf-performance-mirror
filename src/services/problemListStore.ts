import { normalizeStoredLists } from '../domain/problemLists';
import type { StoredProblemList } from '../domain/problemLists';

export const PROBLEM_LISTS_KEY = 'cfpm_problem_lists_v1';

/* Unreadable or missing storage is the same as no lists. */
export function loadProblemLists(storage: Storage | null): StoredProblemList[] {
  try {
    const raw = storage?.getItem(PROBLEM_LISTS_KEY);

    return raw ? normalizeStoredLists(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/* False when the lists could not be saved (storage full or blocked). */
export function saveProblemLists(
  storage: Storage | null,
  lists: readonly StoredProblemList[],
): boolean {
  if (!storage) {
    return false;
  }

  try {
    if (lists.length === 0) {
      storage.removeItem(PROBLEM_LISTS_KEY);
    } else {
      storage.setItem(PROBLEM_LISTS_KEY, JSON.stringify({ v: 1, lists }));
    }

    return true;
  } catch {
    return false;
  }
}

export function defaultListStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
