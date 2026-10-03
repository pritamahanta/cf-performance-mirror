import type { CodeforcesUser } from '../types/codeforces';
import type { OnlineFriend } from '../domain/friends';
import { OnlineTracker } from '../domain/onlineTracker';
import { ONLINE_TTL_MS, type OnlineStatus } from '../domain/onlineTracker';
import type { Persistence, PersistedSnapshot } from './onlineStore';
import { checkHandles } from './onlinePool';
import type { PoolSummary } from './onlinePool';
import { createTokenBucket } from './rateLimiter';
import type { RateLimiter } from './rateLimiter';

export interface Progress {
  checked: number;
  total: number;
}

export type PollerState =
  | {
      status: 'loading';
      progress: Progress | null;
      refreshing: boolean;
    }
  | {
      status: 'ready';
      friends: OnlineFriend[];
      updatedAt: number;

      /* Set only while a long scan is running. */
      progress: Progress | null;

      /*
       * True when the last full scan could not check a noticeable
       * share of friends; those keep their last known status.
       */
      incomplete: boolean;
      refreshing: boolean;
    }
  | {
      status: 'error';
      message: string;
      refreshing: boolean;
    };

export interface PollerApi {
  fetchFriends: (signal: AbortSignal) => Promise<string[]>;
  checkProfile: (handle: string, signal: AbortSignal) => Promise<OnlineStatus>;
  fetchInfo: (handles: string[], signal?: AbortSignal) => Promise<CodeforcesUser[]>;
}

export interface Visibility {
  isHidden: () => boolean;
  subscribe: (callback: () => void) => () => void;
}

export interface PollerConfig {
  /* Gap between cycles. */
  intervalMs: number;

  /* Longest wait after repeated failed cycles. */
  maxBackoffMs: number;

  /* Full scans are spaced at least this many scan-durations apart... */
  fullScanGapFactor: number;

  /* ...but never further apart than this. */
  maxFullScanGapMs: number;

  /* Progress is only shown for cycles that run longer than this. */
  progressAfterMs: number;

  /* Minimum time between list updates while results stream in. */
  flushMs: number;

  /* Minimum gap between user.info requests (documented limit: 1 per 2s). */
  infoGapMs: number;

  /* Ignore manual refreshes this soon after a cycle started. */
  minManualGapMs: number;

  /* How long to wait before persisting a snapshot again. */
  persistSaveGapMs: number;

  /* If a full scan was interrupted, avoid repeating it for this long. */
  resumeMinGapMs: number;

  /* Retry after a storage lock is held elsewhere. */
  lockRetryMs: number;

  maxConcurrency: number;

  /*
   * Hard cap on profile requests: sustained rate and burst size.
   * 0 (or less) turns the cap off.
   */
  requestsPerSecond: number;
  requestBurst: number;

  /* During a long full scan, friends shown online are re-checked this often. */
  recheckOnlineEveryMs: number;

  /* Above this many friends a manual refresh only re-checks who is shown online. */
  manualFullScanMaxFriends: number;

  /*
   * Order of a full scan: everyone shown online, then friends seen
   * online within hotWindowMs (most recent first), then the rest,
   * longest-unchecked first. This only changes WHEN a friend is
   * checked within the scan, never WHETHER: with the default
   * scanBudget (no limit) every friend is checked on their profile
   * page in every scan. Lowering scanBudget limits how many friends
   * beyond those shown online one scan covers (at least coldReserve
   * of them from the rest) and trades coverage for speed. hotWindowMs
   * of 0 turns the recency ordering off (plain longest-unchecked
   * first).
   */
  hotWindowMs: number;
  scanBudget: number;
  coldReserve: number;

  /*
   * A "quick" cycle (the only kind that runs while a full scan isn't due
   * yet, including while one is on cooldown after being interrupted)
   * always re-checks everyone currently shown online, plus up to this
   * many friends that have never been checked yet or were checked
   * longest ago. Without this, a full scan that keeps getting
   * interrupted before finishing (e.g. the page is navigated away) would
   * starve: quick cycles would only ever re-confirm already-online
   * friends, and nobody else would ever get checked.
   */
  quickColdBudget: number;

  /* Pool tuning: pause after 3 failures in a row, doubling up to the max... */
  poolBaseBackoffMs: number;
  poolMaxBackoffMs: number;

  /* ...and give up on a scan after this many failed checks in a row. */
  poolBreakerLimit: number;

  /*
   * Longest a single profile check may take before it is treated as
   * failed (and freed up for retry/backoff like any other failure).
   * Without this, one request that never responds - no error, no
   * timeout of its own - would sit in the pool forever and the scan
   * would never finish. 0 turns it off.
   */
  poolRequestTimeoutMs: number;

  /* Show "incomplete" when at least this share of a full scan failed. */
  incompleteShare: number;
}

export const DEFAULT_POLLER_CONFIG: PollerConfig = {
  intervalMs: 60_000,
  maxBackoffMs: 4 * 60_000,
  fullScanGapFactor: 1,
  maxFullScanGapMs: 10 * 60_000,
  progressAfterMs: 2_000,
  flushMs: 300,
  infoGapMs: 2_100,
  minManualGapMs: 5_000,
  persistSaveGapMs: 2_000,
  resumeMinGapMs: 5_000,
  lockRetryMs: 15_000,
  maxConcurrency: 3,
  requestsPerSecond: 2,
  requestBurst: 20,
  recheckOnlineEveryMs: 90_000,
  manualFullScanMaxFriends: 150,
  hotWindowMs: 24 * 3_600_000,
  scanBudget: Number.POSITIVE_INFINITY,
  coldReserve: 30,
  quickColdBudget: 10,
  poolBaseBackoffMs: 1_500,
  poolMaxBackoffMs: 20_000,
  poolBreakerLimit: 15,
  poolRequestTimeoutMs: 20_000,
  incompleteShare: 0.05,
};

const LOAD_ERROR_MESSAGE =
  "Couldn't load your online friends. Make sure you're logged in to Codeforces.";

const CHECK_ERROR_MESSAGE =
  "Couldn't check who's online right now. Retrying automatically.";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };

    const timer = setTimeout(done, ms);

    signal.addEventListener('abort', done, { once: true });
  });
}

/*
 * Keeps the online-friends list up to date.
 *
 * One cycle at a time, always: a new cycle is only scheduled after
 * the previous one has ended, so runs can never overlap or pile up,
 * however slow Codeforces is.
 *
 * Two kinds of cycle:
 *  - full: reads the friends page and checks every friend, in the
 *    order that keeps the visible list most accurate (see
 *    OnlineTracker.plan). How often it runs scales with how long the
 *    last one took, so a big friend list automatically gets a lower
 *    request rate.
 *  - quick: re-checks only the friends currently shown as online, so
 *    the visible list stays accurate every minute even when a full
 *    scan is expensive.
 *
 * Nothing is fetched while the tab is hidden; the running cycle is
 * aborted and the list is refreshed when the tab is shown again.
 */
export class OnlineFriendsPoller {
  private readonly api: PollerApi;
  private readonly config: PollerConfig;
  private readonly visibility: Visibility;
  private readonly persistence: Persistence | null;
  private readonly limiter: RateLimiter | null;
  private readonly listeners = new Set<() => void>();

  private tracker = new OnlineTracker();
  private state: PollerState = {
    status: 'loading',
    progress: null,
    refreshing: false,
  };

  private running = false;
  private epoch = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  private unsubscribeStorage: (() => void) | null = null;

  private inFlight = false;
  private acquiring = false;
  private restartRequested = false;
  private abortedForHidden = false;
  private waitingForVisible = false;
  private hiddenSince = 0;
  private currentMode: 'full' | 'quick' = 'full';
  private manualQueued = false;

  private fullScanStartedAt = 0;
  private fullScanOpen = false;
  private interruptedPending = false;
  private resumeNotBefore = 0;
  private lastPersistAt = 0;
  private lastAdoptedSavedAt = 0;

  private hasData = false;
  private errorMessage: string | null = null;
  private updatedAt = 0;
  private incomplete = false;
  private refreshing = false;
  private progress: Progress | null = null;

  private cycleStartedAt = 0;
  private lastCycleEndedAt = 0;
  private lastFullEndedAt = 0;
  private lastFullDurationMs = 0;
  private failedCycles = 0;

  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private infoRun: Promise<void> | null = null;
  private lastInfoAt = Number.NEGATIVE_INFINITY;

  constructor(
    api: PollerApi,
    visibility: Visibility,
    config: Partial<PollerConfig> = {},
    persistence: Persistence | null = null,
  ) {
    this.api = api;
    this.visibility = visibility;
    this.persistence = persistence;
    this.config = { ...DEFAULT_POLLER_CONFIG, ...config };

    /* One bucket for the poller's whole life: toggling the panel must not refill it. */
    this.limiter =
      this.config.requestsPerSecond > 0
        ? createTokenBucket({
            capacity: Math.max(1, this.config.requestBurst),
            refillPerSec: this.config.requestsPerSecond,
          })
        : null;
  }

  getState(): PollerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.epoch += 1;

    this.unsubscribeVisibility = this.visibility.subscribe(() => {
      this.handleVisibilityChange();
    });

    if (this.persistence) {
      this.unsubscribeStorage = this.persistence.onExternalChange(() => {
        this.adoptExternal();
      });
    }

    if (this.persistence) {
      const snap = this.persistence.load();
      if (snap && this.tracker.importState(snap.tracker)) {
        this.updatedAt = snap.updatedAt;
        this.incomplete = snap.incomplete;
        this.lastCycleEndedAt = snap.lastCycleEndedAt;
        this.lastFullEndedAt = snap.lastFullEndedAt;
        this.lastFullDurationMs = snap.lastFullDurationMs;
        this.hasData = Date.now() - snap.updatedAt <= ONLINE_TTL_MS;
        this.cycleStartedAt = snap.lastCycleEndedAt;
        this.lastAdoptedSavedAt = snap.savedAt;

        if (snap.fullScanOpen) {
          this.interruptedPending = true;
          const ran = Math.max(0, snap.savedAt - snap.fullScanStartedAt);
          this.resumeNotBefore = snap.savedAt + Math.min(
            this.config.maxFullScanGapMs,
            Math.max(this.config.resumeMinGapMs, this.config.fullScanGapFactor * ran),
          );
        } else {
          this.interruptedPending = false;
        }

        this.emit();

        const remaining = this.lastCycleEndedAt > 0
          ? Math.max(0, this.config.intervalMs - (Date.now() - this.lastCycleEndedAt))
          : 0;

        if (this.hasData && this.lastCycleEndedAt > 0 && remaining > 0) {
          this.scheduleNext(remaining);
          return;
        }
      }
    }

    this.tick(false);
  }

  /* Stops everything and forgets all data, so a restart begins clean. */
  stop(): void {
    this.running = false;
    this.epoch += 1;

    this.controller?.abort();
    this.controller = null;
    this.clearTimer();

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = null;

    this.tracker = new OnlineTracker();
    this.inFlight = false;
    this.acquiring = false;
    this.restartRequested = false;
    this.abortedForHidden = false;
    this.waitingForVisible = false;
    this.hiddenSince = 0;
    this.manualQueued = false;
    this.fullScanStartedAt = 0;
    this.fullScanOpen = false;
    this.interruptedPending = false;
    this.resumeNotBefore = 0;
    this.lastPersistAt = 0;
    this.lastAdoptedSavedAt = 0;
    this.hasData = false;
    this.errorMessage = null;
    this.updatedAt = 0;
    this.incomplete = false;
    this.refreshing = false;
    this.progress = null;
    this.cycleStartedAt = 0;
    this.lastCycleEndedAt = 0;
    this.lastFullEndedAt = 0;
    this.lastFullDurationMs = 0;
    this.failedCycles = 0;
    this.dirty = false;
    this.infoRun = null;
    this.lastInfoAt = Number.NEGATIVE_INFINITY;

    this.state = { status: 'loading', progress: null, refreshing: false };
    this.notify();
  }

  /*
   * Manual refresh. If a cycle is already running it is the fresh
   * check, so the click only turns on the "refreshing" feedback.
   */
  refresh(): void {
    if (!this.running) {
      return;
    }

    if (this.inFlight) {
      /* A running full scan is already the fresh check; a quick one is not. */
      if (this.currentMode === 'quick') {
        this.manualQueued = true;
      }

      this.refreshing = true;
      this.emit();

      return;
    }

    if (Date.now() - this.cycleStartedAt < this.config.minManualGapMs) {
      return;
    }

    this.clearTimer();
    this.tick(true);
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.clearTimer();

    const epoch = this.epoch;

    this.timer = setTimeout(() => {
      this.timer = null;

      if (epoch === this.epoch) {
        this.tick(false);
      }
    }, Math.max(0, delayMs));
  }

  private handleVisibilityChange(): void {
    if (!this.running) {
      return;
    }

    if (this.visibility.isHidden()) {
      this.clearTimer();

      if (this.hiddenSince === 0) {
        this.hiddenSince = Date.now();
      }

      if (this.inFlight) {
        this.abortedForHidden = true;
        this.controller?.abort();
      }

      return;
    }

    this.abortedForHidden = false;

    if (this.hiddenSince !== 0) {
      this.tracker.shiftFreshness(Date.now() - this.hiddenSince, Date.now());
      this.hiddenSince = 0;
    }

    if (this.inFlight) {
      /* Hidden and shown again before the aborted cycle wound down. */
      this.restartRequested = true;

      return;
    }

    const age = Date.now() - this.lastCycleEndedAt;

    if (this.waitingForVisible || age >= this.config.intervalMs) {
      this.waitingForVisible = false;
      this.tick(false);
    } else {
      this.scheduleNext(this.config.intervalMs - age);
    }
  }

  private nextDelay(): number {
    const { intervalMs, maxBackoffMs } = this.config;

    if (this.failedCycles === 0) {
      return intervalMs;
    }

    return Math.min(
      maxBackoffMs,
      intervalMs * 2 ** Math.min(this.failedCycles, 6),
    );
  }

  private isFullScanDue(): boolean {
    if (this.interruptedPending) {
      return Date.now() >= this.resumeNotBefore;
    }

    if (this.lastFullEndedAt === 0) {
      return true;
    }

    const { intervalMs, fullScanGapFactor, maxFullScanGapMs } = this.config;

    const gap = Math.min(
      maxFullScanGapMs,
      Math.max(intervalMs, this.lastFullDurationMs * fullScanGapFactor),
    );

    /* A little slack so timer jitter can't push a due scan a whole tick late. */
    const slack = Math.min(1_000, intervalMs * 0.1);

    return Date.now() - this.lastFullEndedAt >= gap - slack;
  }

  private chooseMode(manual: boolean): 'full' | 'quick' | 'none' {
    if (manual) {
      /*
       * A full scan of a big list takes minutes, so the refresh button
       * must not start one: it re-checks who is shown online instead.
       */
      if (this.tracker.friendCount() <= this.config.manualFullScanMaxFriends) {
        return 'full';
      }

      if (this.tracker.onlineHandles().length > 0) {
        return 'quick';
      }
    }

    if (this.isFullScanDue()) {
      return 'full';
    }

    /*
     * Nothing to do only when there is no friend data at all yet. As
     * long as there is at least one friend, a "quick" cycle always has
     * useful work: either friends to re-confirm as online, or - via
     * planQuick's cold budget - friends still waiting on their first
     * check. onlineHandles().length === 0 on its own is NOT "nothing to
     * do": it is exactly the state a quick cycle needs to make progress
     * on an interrupted full scan.
     */
    if (this.tracker.friendCount() === 0) {
      return 'none';
    }

    return 'quick';
  }

  private msUntilNextCycle(): number {
    if (this.lastCycleEndedAt === 0) {
      return 0;
    }

    return Math.max(0, this.config.intervalMs - (Date.now() - this.lastCycleEndedAt));
  }

  private adoptExternal(): void {
    if (!this.running || this.inFlight || this.acquiring || !this.persistence) {
      return;
    }

    const snap = this.persistence.load();
    if (!snap || snap.savedAt <= this.lastAdoptedSavedAt) {
      return;
    }

    const candidate = new OnlineTracker();
    if (!candidate.importState(snap.tracker)) {
      return;
    }

    this.tracker = candidate;
    this.updatedAt = snap.updatedAt;
    this.incomplete = snap.incomplete;
    this.lastCycleEndedAt = snap.lastCycleEndedAt;
    this.lastFullEndedAt = snap.lastFullEndedAt;
    this.lastFullDurationMs = snap.lastFullDurationMs;
    this.lastAdoptedSavedAt = snap.savedAt;
    this.hasData = Date.now() - snap.updatedAt <= ONLINE_TTL_MS;

    this.emit();
    this.scheduleNext(this.msUntilNextCycle());
  }

  private tick(manual: boolean): void {
    if (!this.running || this.inFlight || this.acquiring) {
      return;
    }

    if (this.visibility.isHidden()) {
      this.waitingForVisible = true;

      return;
    }

    if (this.persistence?.runExclusive) {
      const epoch = this.epoch;
      this.acquiring = true;

      void this.persistence.runExclusive(async () => {
        this.acquiring = false;

        if (epoch !== this.epoch || !this.running) {
          return;
        }

        const snap = this.persistence?.load();
        if (snap && snap.savedAt > this.lastAdoptedSavedAt) {
          const candidate = new OnlineTracker();
          if (candidate.importState(snap.tracker)) {
            this.tracker = candidate;
            this.updatedAt = snap.updatedAt;
            this.incomplete = snap.incomplete;
            this.lastCycleEndedAt = snap.lastCycleEndedAt;
            this.lastFullEndedAt = snap.lastFullEndedAt;
            this.lastFullDurationMs = snap.lastFullDurationMs;
            this.lastAdoptedSavedAt = snap.savedAt;
            this.hasData = Date.now() - snap.updatedAt <= ONLINE_TTL_MS;
            this.emit();
            this.scheduleNext(this.msUntilNextCycle());
            return;
          }
        }

        const mode = this.chooseMode(manual);
        if (mode === 'none') {
          this.scheduleNext(this.nextDelay());
          return;
        }

        if (mode === 'full') {
          await this.runCycle('full', manual);
          return;
        }

        await this.runCycle('quick', manual);
      }).then(
        ran => {
          if (epoch !== this.epoch) {
            return;
          }

          this.acquiring = false;

          if (!ran && this.running && !this.inFlight) {
            const jitter = this.config.lockRetryMs * (0.8 + Math.random() * 0.4);
            this.scheduleNext(jitter);
          }
        },
        () => {
          if (epoch !== this.epoch) {
            return;
          }

          this.acquiring = false;

          if (this.running && !this.inFlight) {
            this.scheduleNext(this.nextDelay());
          }
        },
      );

      return;
    }

    const mode = this.chooseMode(manual);
    if (mode === 'none') {
      this.scheduleNext(this.nextDelay());
      return;
    }

    if (mode === 'full') {
      void this.runCycle('full', manual);
      return;
    }

    void this.runCycle('quick', manual);
  }

  private persist(force: boolean): void {
    if (this.persistence === null || !this.running) {
      return;
    }

    if (!force && Date.now() - this.lastPersistAt < this.config.persistSaveGapMs) {
      return;
    }

    if (!this.hasData && this.tracker.exportState().friends.length === 0) {
      return;
    }

    const snapshot: PersistedSnapshot = {
      v: 1,
      savedAt: Math.max(Date.now(), this.lastPersistAt + 1),
      tracker: this.tracker.exportState(),
      updatedAt: this.updatedAt,
      incomplete: this.incomplete,
      lastCycleEndedAt: this.lastCycleEndedAt,
      lastFullEndedAt: this.lastFullEndedAt,
      lastFullDurationMs: this.lastFullDurationMs,
      fullScanStartedAt: this.fullScanStartedAt,
      fullScanOpen: this.fullScanOpen,
    };

    this.persistence.save(snapshot);
    this.lastPersistAt = snapshot.savedAt;
  }

  private async refreshActivity(
    epoch: number,
    tracker: OnlineTracker,
    signal: AbortSignal,
    friends: string[],
  ): Promise<void> {
    try {
      const users = await this.api.fetchInfo(friends, signal);

      if (signal.aborted || epoch !== this.epoch || tracker !== this.tracker) {
        return;
      }

      tracker.applyActivity(users);
    } catch {
      /* Keep what was known before; the scan order is just less sharp this time. */
    }
  }

  private async runCycle(mode: 'full' | 'quick', manual: boolean): Promise<void> {
    const epoch = this.epoch;
    const tracker = this.tracker;
    const controller = new AbortController();
    const { signal } = controller;
    const startedAt = Date.now();

    this.controller = controller;
    this.inFlight = true;
    this.currentMode = mode;
    this.cycleStartedAt = startedAt;
    this.refreshing = manual || this.manualQueued;
    this.progress = null;

    if (this.refreshing) {
      /* Show the refresh feedback right away, not with the first result. */
      this.emit();
    }

    if (mode === 'full') {
      this.fullScanOpen = true;
      this.fullScanStartedAt = startedAt;
      this.interruptedPending = false;
      this.persist(true);
    }

    tracker.beginCycle();

    let failed = false;

    try {
      let handles: string[];

      if (mode === 'full') {
        const friends = await this.api.fetchFriends(signal);

        if (signal.aborted) {
          return;
        }

        tracker.syncFriends(friends);

        /* One user.info pass: ratings for every row, and who was active lately. */
        await this.refreshActivity(epoch, tracker, signal, friends);

        if (signal.aborted) {
          return;
        }

        handles = tracker.planScan(Date.now(), {
          hotWindowMs: this.config.hotWindowMs,
          budget: this.config.scanBudget,
          coldReserve: this.config.coldReserve,
        });
      } else {
        handles = tracker.planQuick(this.config.quickColdBudget);
      }

      let checked = 0;

      const runChecks = (batch: string[], countProgress: boolean): Promise<PoolSummary> =>
        checkHandles(batch, {
          signal,
          maxConcurrency: this.config.maxConcurrency,
          baseBackoffMs: this.config.poolBaseBackoffMs,
          maxBackoffMs: this.config.poolMaxBackoffMs,
          breakerLimit: this.config.poolBreakerLimit,
          requestTimeoutMs: this.config.poolRequestTimeoutMs,
          limiter: this.limiter,
          check: this.api.checkProfile,
          onResult: (handle, status) => {
            tracker.record(handle, status, Date.now());
            this.dirty = true;

            if (countProgress) {
              checked += 1;

              if (Date.now() - startedAt > this.config.progressAfterMs) {
                this.progress = { checked, total: handles.length };
              }
            }

            this.scheduleFlush(epoch, tracker);
          },
        });

      let summary: PoolSummary;

      if (mode === 'full') {
        /*
         * A full scan can take minutes and no quick cycle can run during
         * it, so the scan checks friends in slices and re-checks the ones
         * shown online between slices. Otherwise they would expire from
         * the list (ONLINE_TTL_MS) in the middle of a long scan.
         */
        const onlineKeys = new Set(tracker.onlineHandles().map(handle => handle.toLowerCase()));
        const head = handles.filter(handle => onlineKeys.has(handle.toLowerCase()));
        const rest = handles.filter(handle => !onlineKeys.has(handle.toLowerCase()));
        const { requestsPerSecond, recheckOnlineEveryMs } = this.config;

        const sliceSize =
          requestsPerSecond > 0
            ? Math.max(20, Math.floor((recheckOnlineEveryMs / 1000) * requestsPerSecond))
            : 200;

        const combined: PoolSummary = {
          total: 0,
          done: 0,
          unknown: 0,
          aborted: false,
          brokeCircuit: false,
        };

        /* Re-checks only feed the list; they never count toward progress or "incomplete". */
        const merge = (part: PoolSummary, main: boolean) => {
          if (main) {
            combined.total += part.total;
            combined.done += part.done;
            combined.unknown += part.unknown;
          }

          combined.aborted = combined.aborted || part.aborted;
          combined.brokeCircuit = combined.brokeCircuit || part.brokeCircuit;
        };

        let lastOnlineCheckAt = Date.now();

        if (head.length > 0) {
          merge(await runChecks(head, true), true);
          lastOnlineCheckAt = Date.now();
        }

        for (let i = 0; i < rest.length; i += sliceSize) {
          if (signal.aborted || combined.brokeCircuit) {
            break;
          }

          if (Date.now() - lastOnlineCheckAt >= recheckOnlineEveryMs) {
            const online = tracker.onlineHandles();

            if (online.length > 0) {
              merge(await runChecks(online, false), false);

              if (signal.aborted || combined.brokeCircuit) {
                break;
              }
            }

            lastOnlineCheckAt = Date.now();
          }

          merge(await runChecks(rest.slice(i, i + sliceSize), true), true);
        }

        summary = combined;
      } else {
        summary = await runChecks(handles, true);
      }

      if (signal.aborted) {
        return;
      }

      await this.pumpInfo(epoch, tracker, signal);

      if (signal.aborted) {
        return;
      }

      this.hasData = true;
      this.errorMessage = null;

      if (summary.total > 0 && (summary.unknown === summary.total || summary.brokeCircuit)) {
        failed = true;
      }

      if (mode === 'full') {
        this.incomplete =
          summary.brokeCircuit ||
          (summary.total > 0 &&
            summary.unknown / summary.total >= this.config.incompleteShare);
      }

      if (failed && tracker.snapshot(Date.now()).length === 0) {
        /* Nothing usable to show and nothing could be verified: say so. */
        this.hasData = false;
        this.errorMessage = CHECK_ERROR_MESSAGE;
      } else if (!failed) {
        this.updatedAt = Date.now();
      }
    } catch {
      if (signal.aborted) {
        return;
      }

      failed = true;

      if (!this.hasData) {
        this.errorMessage = LOAD_ERROR_MESSAGE;
      }
    } finally {
      if (epoch === this.epoch) {
        this.finishCycle(mode, startedAt, controller, signal.aborted, failed);
      }
    }
  }

  private finishCycle(
    mode: 'full' | 'quick',
    startedAt: number,
    controller: AbortController,
    aborted: boolean,
    failed: boolean,
  ): void {
    if (this.controller === controller) {
      this.controller = null;
    }

    this.inFlight = false;
    this.refreshing = false;
    this.progress = null;
    this.lastCycleEndedAt = Date.now();

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (!aborted) {
      this.failedCycles = failed ? this.failedCycles + 1 : 0;

      if (mode === 'full') {
        this.lastFullEndedAt = this.lastCycleEndedAt;
        this.lastFullDurationMs = this.lastCycleEndedAt - startedAt;
        this.fullScanOpen = false;
        this.interruptedPending = false;
      }
    } else if (mode === 'full') {
      this.interruptedPending = true;
      const elapsed = Math.max(0, Date.now() - startedAt);
      this.resumeNotBefore = Date.now() + Math.min(
        this.config.maxFullScanGapMs,
        Math.max(this.config.resumeMinGapMs, this.config.fullScanGapFactor * elapsed),
      );
      this.fullScanOpen = true;
    }

    this.dirty = false;
    this.emit();
    this.persist(!aborted);

    if (!this.running) {
      return;
    }

    if (this.manualQueued && !aborted) {
      this.manualQueued = false;
      this.tick(true);

      return;
    }

    this.manualQueued = false;

    if (this.restartRequested) {
      this.restartRequested = false;
      this.tick(false);

      return;
    }

    if (this.abortedForHidden) {
      /* The visibility handler restarts polling when the tab is shown. */
      this.waitingForVisible = true;

      return;
    }

    this.scheduleNext(this.nextDelay());
  }

  private scheduleFlush(epoch: number, tracker: OnlineTracker): void {
    if (this.flushTimer !== null) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;

      if (epoch !== this.epoch || tracker !== this.tracker || !this.dirty) {
        return;
      }

      this.dirty = false;
      this.emit();
      this.persist(false);
      void this.pumpInfo(epoch, tracker, this.controller?.signal);
    }, this.config.flushMs);
  }

  /*
   * Fetches ratings for online friends that lack one, one request at
   * a time and no faster than the documented API limit. Only ever
   * runs for friends who are online, so it is a handful of handles.
   */
  private pumpInfo(
    epoch: number,
    tracker: OnlineTracker,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (this.infoRun) {
      return this.infoRun;
    }

    const run = (async () => {
      for (;;) {
        if (signal?.aborted || epoch !== this.epoch || tracker !== this.tracker) {
          return;
        }

        const needed = tracker.handlesNeedingInfo().slice(0, 100);

        if (needed.length === 0) {
          return;
        }

        const wait = this.lastInfoAt + this.config.infoGapMs - Date.now();

        if (wait > 0) {
          await sleep(wait, signal ?? new AbortController().signal);

          if (signal?.aborted || epoch !== this.epoch || tracker !== this.tracker) {
            return;
          }
        }

        this.lastInfoAt = Date.now();

        try {
          tracker.applyInfo(needed, await this.api.fetchInfo(needed));
        } catch {
          tracker.applyInfo(needed, null);
        }

        if (epoch === this.epoch && tracker === this.tracker) {
          this.dirty = true;
          this.scheduleFlush(epoch, tracker);
        }
      }
    })().finally(() => {
      if (this.infoRun === run) {
        this.infoRun = null;
      }
    });

    this.infoRun = run;

    return run;
  }

  private emit(): void {
    const friends = this.tracker.snapshot(Date.now());
    const { refreshing, progress } = this;

    if (this.errorMessage !== null && friends.length === 0) {
      this.state = {
        status: 'error',
        message: this.errorMessage,
        refreshing,
      };
    } else if (!this.hasData && friends.length === 0) {
      this.state = { status: 'loading', progress, refreshing };
    } else {
      this.state = {
        status: 'ready',
        friends,
        updatedAt: this.updatedAt || Date.now(),
        progress,
        incomplete: this.incomplete,
        refreshing,
      };
    }

    this.notify();
  }
}
