import type { TrackerState } from '../domain/onlineTracker';

export const STORAGE_PREFIX = 'cfpm_online_v1:';

export interface PersistedSnapshot {
  v: 1;
  savedAt: number;
  tracker: TrackerState;
  updatedAt: number;
  incomplete: boolean;
  lastCycleEndedAt: number;
  lastFullEndedAt: number;
  lastFullDurationMs: number;
  fullScanStartedAt: number;
  fullScanOpen: boolean;
}

export interface Persistence {
  load(): PersistedSnapshot | null;
  save(snapshot: PersistedSnapshot): void;
  onExternalChange(callback: () => void): () => void;
  runExclusive?(task: () => Promise<void>): Promise<boolean>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTrackerState(value: unknown): value is TrackerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const state = value as Record<string, unknown>;

  if (!Array.isArray(state.friends) || !Array.isArray(state.entries) || !Array.isArray(state.infos) || !Array.isArray(state.order)) {
    return false;
  }

  if (state.friends.length > 20_000) {
    return false;
  }

  for (const handle of state.friends) {
    if (typeof handle !== 'string' || handle.length === 0 || handle.length > 64) {
      return false;
    }
  }

  for (const entry of state.entries) {
    if (!Array.isArray(entry) || entry.length !== 3) {
      return false;
    }

    const [handle, online, checkedAt] = entry as [unknown, unknown, unknown];
    if (typeof handle !== 'string' || handle.length === 0 || handle.length > 64) {
      return false;
    }
    if (online !== 0 && online !== 1) {
      return false;
    }
    if (!isFiniteNumber(checkedAt)) {
      return false;
    }
  }

  for (const info of state.infos) {
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      return false;
    }

    const record = info as Record<string, unknown>;
    if (typeof record.handle !== 'string' || record.handle.length === 0 || record.handle.length > 64) {
      return false;
    }
    if (record.rating !== undefined && (!isFiniteNumber(record.rating))) {
      return false;
    }
    if (record.rank !== undefined && (typeof record.rank !== 'string' || record.rank.length > 64)) {
      return false;
    }
  }

  for (const handle of state.order) {
    if (typeof handle !== 'string' || handle.length === 0 || handle.length > 64) {
      return false;
    }
  }

  return true;
}

export function parseSnapshot(raw: string | null, now: number): PersistedSnapshot | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const snapshot = parsed as Record<string, unknown>;

  if (snapshot.v !== 1) {
    return null;
  }

  const requiredFields = [
    'savedAt',
    'tracker',
    'updatedAt',
    'incomplete',
    'lastCycleEndedAt',
    'lastFullEndedAt',
    'lastFullDurationMs',
    'fullScanStartedAt',
    'fullScanOpen',
  ] as const;

  for (const key of requiredFields) {
    if (!(key in snapshot)) {
      return null;
    }
  }

  if (
    !isFiniteNumber(snapshot.savedAt)
    || !isFiniteNumber(snapshot.updatedAt)
    || !isFiniteNumber(snapshot.lastCycleEndedAt)
    || !isFiniteNumber(snapshot.lastFullEndedAt)
    || !isFiniteNumber(snapshot.lastFullDurationMs)
    || !isFiniteNumber(snapshot.fullScanStartedAt)
    || typeof snapshot.incomplete !== 'boolean'
    || typeof snapshot.fullScanOpen !== 'boolean'
    || !isTrackerState(snapshot.tracker)
  ) {
    return null;
  }

  if (snapshot.savedAt > now + 60_000 || snapshot.lastCycleEndedAt > now + 60_000) {
    return null;
  }

  return {
    v: 1,
    savedAt: snapshot.savedAt,
    tracker: snapshot.tracker,
    updatedAt: snapshot.updatedAt,
    incomplete: snapshot.incomplete,
    lastCycleEndedAt: snapshot.lastCycleEndedAt,
    lastFullEndedAt: snapshot.lastFullEndedAt,
    lastFullDurationMs: snapshot.lastFullDurationMs,
    fullScanStartedAt: snapshot.fullScanStartedAt,
    fullScanOpen: snapshot.fullScanOpen,
  };
}

export function getLoggedInHandle(doc: Document | null = typeof document !== 'undefined' ? document : null): string | null {
  if (!doc) {
    return null;
  }

  const anchor = doc.querySelector('.lang-chooser a[href^="/profile/"]');

  if (!anchor || typeof anchor.getAttribute !== 'function') {
    return null;
  }

  const href = anchor.getAttribute('href') ?? '';
  const path = href.split('?')[0].split('#')[0];
  const match = /^\/profile\/(.+)$/.exec(path);

  if (!match) {
    return null;
  }

  try {
    const handle = decodeURIComponent(match[1]).trim();
    return handle.length > 0 ? handle : null;
  } catch {
    return null;
  }
}

function removeStorageKeys(storage: Storage, prefix: string, keep?: string): void {
  const doomed: string[] = [];

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);

    if (key && key.startsWith(prefix) && key !== keep) {
      doomed.push(key);
    }
  }

  for (const key of doomed) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures silently.
    }
  }
}

export function createBrowserPersistence(opts?: {
  storage?: Storage;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc?: Document;
  locks?: LockManager | undefined;
  now?: () => number;
}): Persistence | null {
  const storage = opts?.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  const win = opts?.win ?? (typeof window !== 'undefined' ? window : {
    addEventListener() {
      // no-op in Node tests
    },
    removeEventListener() {
      // no-op in Node tests
    },
  } as Pick<Window, 'addEventListener' | 'removeEventListener'>);
  const locks = opts?.locks ?? (typeof navigator !== 'undefined' ? navigator.locks : undefined);
  const doc = opts?.doc ?? (typeof document !== 'undefined' ? document : null);

  if (!storage || !doc) {
    return null;
  }

  const handle = getLoggedInHandle(doc);

  if (!handle) {
    removeStorageKeys(storage, STORAGE_PREFIX);
    return null;
  }

  const key = STORAGE_PREFIX + handle.toLowerCase();
  removeStorageKeys(storage, STORAGE_PREFIX, key);

  const persistence: Persistence = {
    load(): PersistedSnapshot | null {
      try {
        const raw = storage.getItem(key);
        return parseSnapshot(raw, opts?.now?.() ?? Date.now());
      } catch {
        return null;
      }
    },
    save(snapshot: PersistedSnapshot): void {
      try {
        storage.setItem(key, JSON.stringify(snapshot));
      } catch {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore cleanup failures silently.
        }
      }
    },
    onExternalChange(callback: () => void): () => void {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) {
          callback();
        }
      };
      win.addEventListener('storage', onStorage);
      return () => {
        win.removeEventListener('storage', onStorage);
      };
    },
  };

  persistence.runExclusive = async (task: () => Promise<void>): Promise<boolean> => {
    if (!locks || typeof locks.request !== 'function') {
      await task();
      return true;
    }

    let ran = false;
    try {
      await locks.request('cfpm-online-friends:' + handle.toLowerCase(), { ifAvailable: true }, async lock => {
        if (!lock) {
          return;
        }
        ran = true;
        await task();
      });
    } catch {
      if (!ran) {
        await task();
        ran = true;
      }
    }
    return ran;
  };

  return persistence;
}
