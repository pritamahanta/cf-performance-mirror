import type { CodeforcesUser } from '../types/codeforces';
import type { OnlineFriend } from './friends';

/*
 * Result of checking one friend.
 *
 * "unknown" means the check itself failed (network error,
 * throttling, an unexpected page, ...). It says nothing about
 * whether the friend is online, so it never overwrites what we
 * already know about them.
 */
export type OnlineStatus = 'online' | 'offline' | 'unknown';

/*
 * A profile page shows "Last visit: online now" for someone who is
 * online, and "Last visit: 3 hours ago" (or similar) for everyone
 * else. Any page without the "Last visit:" text (an error page,
 * a challenge page, a truncated response) tells us nothing.
 */
const PROFILE_ONLINE_PATTERN =
  /Last visit:\s*(?:<[^>]+>\s*)*online now/i;

const PROFILE_LAST_VISIT_PATTERN = /Last visit:/i;

export function classifyProfileHtml(html: string): OnlineStatus {
  if (PROFILE_ONLINE_PATTERN.test(html)) {
    return 'online';
  }

  if (PROFILE_LAST_VISIT_PATTERN.test(html)) {
    return 'offline';
  }

  return 'unknown';
}

/*
 * An "online" reading that has not been re-confirmed for this long
 * is dropped from the list. Accuracy beats showing a stale name:
 * during a long outage the list empties instead of lying.
 */
export const ONLINE_TTL_MS = 6 * 60_000;

/* How many times a missing rating is requested per cycle before the row is shown without it. */
export const MAX_INFO_ATTEMPTS = 2;

interface Entry {
  online: boolean;
  checkedAt: number;
}

interface InfoAttempt {
  count: number;
  cycle: number;
}

export interface InfoSummary {
  handle: string;
  rating?: number;
  rank?: string;
}

export interface TrackerState {
  friends: string[];
  entries: Array<[string, 0 | 1, number]>;
  infos: InfoSummary[];
  order: string[];
}

export class OnlineTracker {
  private entries = new Map<string, Entry>();
  private infos = new Map<string, InfoSummary>();
  private attempts = new Map<string, InfoAttempt>();
  private names = new Map<string, string>();
  private order: string[] = [];
  private cycle = 0;

  exportState(): TrackerState {
    return {
      friends: Array.from(this.names.values()),
      entries: Array.from(this.entries.entries()).map(([key, entry]) => [
        key,
        entry.online ? 1 : 0,
        entry.checkedAt,
      ]),
      infos: Array.from(this.infos.values()).map(info => ({
        handle: info.handle,
        rating: info.rating,
        rank: info.rank,
      })),
      order: [...this.order],
    };
  }

  importState(state: unknown): boolean {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return false;
    }

    const candidate = state as Record<string, unknown>;
    const friends = candidate.friends;
    const entries = candidate.entries;
    const infos = candidate.infos;
    const order = candidate.order;

    if (!Array.isArray(friends) || !Array.isArray(entries) || !Array.isArray(infos) || !Array.isArray(order)) {
      return false;
    }

    const nextNames = new Map<string, string>();
    const seenHandles = new Set<string>();

    for (const handle of friends) {
      if (typeof handle !== 'string' || handle.length === 0 || handle.length > 64) {
        return false;
      }

      const key = handle.toLowerCase();
      if (seenHandles.has(key)) {
        return false;
      }

      seenHandles.add(key);
      nextNames.set(key, handle);
    }

    if (nextNames.size > 20_000) {
      return false;
    }

    const nextEntries = new Map<string, Entry>();
    const allowed = new Set(nextNames.keys());

    for (const entry of entries) {
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

      if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) {
        return false;
      }

      const key = handle.toLowerCase();
      if (!allowed.has(key)) {
        return false;
      }

      nextEntries.set(key, {
        online: online === 1,
        checkedAt,
      });
    }

    const nextInfos = new Map<string, InfoSummary>();
    const seenInfoKeys = new Set<string>();

    for (const info of infos) {
      if (!info || typeof info !== 'object' || Array.isArray(info)) {
        return false;
      }

      const record = info as Record<string, unknown>;
      const handle = record.handle;
      if (typeof handle !== 'string' || handle.length === 0 || handle.length > 64) {
        return false;
      }

      const key = handle.toLowerCase();
      if (!allowed.has(key) || seenInfoKeys.has(key)) {
        return false;
      }

      const rating = record.rating;
      const rank = record.rank;
      if (rating !== undefined && (typeof rating !== 'number' || !Number.isFinite(rating))) {
        return false;
      }

      if (rank !== undefined && (typeof rank !== 'string' || rank.length > 64)) {
        return false;
      }

      seenInfoKeys.add(key);
      nextInfos.set(key, {
        handle: nextNames.get(key) ?? handle,
        rating: typeof rating === 'number' ? rating : undefined,
        rank: typeof rank === 'string' ? rank : undefined,
      });
    }

    const nextOrder: string[] = [];
    const seenOrder = new Set<string>();

    for (const key of order) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 64) {
        return false;
      }

      const lower = key.toLowerCase();
      if (!allowed.has(lower) || seenOrder.has(lower)) {
        return false;
      }

      seenOrder.add(lower);
      nextOrder.push(lower);
    }

    const previousAttempts = this.attempts;
    const previousCycle = this.cycle;

    this.names = nextNames;
    this.entries = nextEntries;
    this.infos = nextInfos;
    this.order = nextOrder;
    this.attempts.clear();
    this.cycle = previousCycle;

    return true;
  }

  /* How many friends are currently known. */
  friendCount(): number {
    return this.names.size;
  }

  beginCycle(): void {
    this.cycle += 1;
  }

  /*
   * Replaces the known friend list. Anyone no longer in it (removed
   * as a friend) is forgotten, so they can't linger as "online".
   */
  syncFriends(handles: string[]): void {
    const keep = new Set<string>();

    for (const handle of handles) {
      const key = handle.toLowerCase();

      keep.add(key);
      this.names.set(key, handle);
    }

    for (const map of [this.entries, this.infos, this.attempts, this.names]) {
      for (const key of Array.from(map.keys())) {
        if (!keep.has(key)) {
          map.delete(key);
        }
      }
    }

    this.order = this.order.filter(key => keep.has(key));
  }

  /*
   * The order to check friends in: anyone last seen online first
   * (so the visible list is re-confirmed before anything else),
   * then friends never checked, then the rest, least recently
   * checked first. If a cycle is cut short, the next one carries
   * on with the friends that have waited longest.
   */
  plan(): string[] {
    const groupOf = (key: string): number => {
      const entry = this.entries.get(key);

      if (!entry) {
        return 1;
      }

      return entry.online ? 0 : 2;
    };

    return Array.from(this.names.keys())
      .map((key, index) => ({ key, index }))
      .sort((a, b) => {
        const groupA = groupOf(a.key);
        const groupB = groupOf(b.key);

        if (groupA !== groupB) {
          return groupA - groupB;
        }

        const checkedA = this.entries.get(a.key)?.checkedAt ?? 0;
        const checkedB = this.entries.get(b.key)?.checkedAt ?? 0;

        if (checkedA !== checkedB) {
          return checkedA - checkedB;
        }

        return a.index - b.index;
      })
      .map(item => this.names.get(item.key) as string);
  }

  /*
   * Time spent with the tab hidden doesn't count against freshness:
   * nothing was being checked, so nothing could have been re-confirmed.
   * Without this, returning to a long-hidden tab would briefly show
   * fewer friends than were online when it was hidden.
   */
  shiftFreshness(ms: number, now: number): void {
    if (ms <= 0) {
      return;
    }

    for (const entry of this.entries.values()) {
      entry.checkedAt = Math.min(now, entry.checkedAt + ms);
    }
  }

  /* Friends currently believed online (used by the short re-check cycles). */
  onlineHandles(): string[] {
    const result: string[] = [];

    for (const [key, entry] of this.entries) {
      if (entry.online) {
        result.push(this.names.get(key) ?? key);
      }
    }

    return result;
  }

  record(handle: string, status: OnlineStatus, now: number): void {
    if (status === 'unknown') {
      return;
    }

    const key = handle.toLowerCase();

    if (!this.names.has(key)) {
      this.names.set(key, handle);
    }

    this.entries.set(key, {
      online: status === 'online',
      checkedAt: now,
    });
  }

  /*
   * Online friends whose rating we still need. A row is held back
   * until its rating has been requested once (so its colour does not
   * change after it appears); if the request keeps failing it is
   * shown without a rating rather than never.
   */
  handlesNeedingInfo(): string[] {
    const result: string[] = [];

    for (const [key, entry] of this.entries) {
      if (!entry.online || this.infos.has(key)) {
        continue;
      }

      const attempt = this.attempts.get(key);

      if (
        !attempt ||
        attempt.count < MAX_INFO_ATTEMPTS ||
        attempt.cycle < this.cycle
      ) {
        result.push(this.names.get(key) ?? key);
      }
    }

    return result;
  }

  /* `users` is null when the request failed. */
  applyInfo(requested: string[], users: CodeforcesUser[] | null): void {
    for (const user of users ?? []) {
      this.infos.set(user.handle.toLowerCase(), user);
    }

    for (const handle of requested) {
      const key = handle.toLowerCase();
      const previous = this.attempts.get(key);

      this.attempts.set(key, {
        count: (previous?.count ?? 0) + 1,
        cycle: this.cycle,
      });
    }
  }

  /*
   * The rows to show. Rows never move: existing ones keep their
   * position, new ones are appended, and rows that are no longer
   * online or fresh simply drop out.
   */
  snapshot(now: number): OnlineFriend[] {
    const visible = new Set<string>();

    for (const [key, entry] of this.entries) {
      if (!entry.online || now - entry.checkedAt > ONLINE_TTL_MS) {
        continue;
      }

      if (this.infos.has(key) || (this.attempts.get(key)?.count ?? 0) >= 1) {
        visible.add(key);
      }
    }

    const next = this.order.filter(key => visible.has(key));
    const placed = new Set(next);

    for (const key of visible) {
      if (!placed.has(key)) {
        next.push(key);
      }
    }

    this.order = next;

    return next.map((key): OnlineFriend => {
      const info = this.infos.get(key);

      return {
        handle: info?.handle ?? this.names.get(key) ?? key,
        rating: info?.rating,
        rank: info?.rank,
      };
    });
  }
}
