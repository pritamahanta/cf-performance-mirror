import type { CodeforcesUser } from '../types/codeforces';
import type { OnlineFriend } from '../domain/friends';
import { OnlineTracker } from '../domain/onlineTracker';
import type { OnlineStatus } from '../domain/onlineTracker';
import { checkHandles } from './onlinePool';

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
  fetchInfo: (handles: string[]) => Promise<CodeforcesUser[]>;
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

  maxConcurrency: number;

  /* Pool tuning: pause after 3 failures in a row, doubling up to the max... */
  poolBaseBackoffMs: number;
  poolMaxBackoffMs: number;

  /* ...and give up on a scan after this many failed checks in a row. */
  poolBreakerLimit: number;

  /* Show "incomplete" when at least this share of a full scan failed. */
  incompleteShare: number;
}

export const DEFAULT_POLLER_CONFIG: PollerConfig = {
  intervalMs: 60_000,
  maxBackoffMs: 4 * 60_000,
  fullScanGapFactor: 2,
  maxFullScanGapMs: 10 * 60_000,
  progressAfterMs: 2_000,
  flushMs: 300,
  infoGapMs: 2_100,
  minManualGapMs: 5_000,
  maxConcurrency: 6,
  poolBaseBackoffMs: 1_500,
  poolMaxBackoffMs: 20_000,
  poolBreakerLimit: 15,
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

  private inFlight = false;
  private restartRequested = false;
  private abortedForHidden = false;
  private waitingForVisible = false;
  private hiddenSince = 0;
  private currentMode: 'full' | 'quick' = 'full';
  private manualQueued = false;

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
  ) {
    this.api = api;
    this.visibility = visibility;
    this.config = { ...DEFAULT_POLLER_CONFIG, ...config };
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

    this.tracker = new OnlineTracker();
    this.inFlight = false;
    this.restartRequested = false;
    this.abortedForHidden = false;
    this.waitingForVisible = false;
    this.hiddenSince = 0;
    this.manualQueued = false;
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

  private tick(manual: boolean): void {
    if (!this.running || this.inFlight) {
      return;
    }

    if (this.visibility.isHidden()) {
      this.waitingForVisible = true;

      return;
    }

    if (manual || this.isFullScanDue()) {
      void this.runCycle('full', manual);

      return;
    }

    if (this.tracker.onlineHandles().length === 0) {
      this.scheduleNext(this.nextDelay());

      return;
    }

    void this.runCycle('quick', false);
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
        handles = tracker.plan();
      } else {
        handles = tracker.onlineHandles();
      }

      let checked = 0;

      const summary = await checkHandles(handles, {
        signal,
        maxConcurrency: this.config.maxConcurrency,
        baseBackoffMs: this.config.poolBaseBackoffMs,
        maxBackoffMs: this.config.poolMaxBackoffMs,
        breakerLimit: this.config.poolBreakerLimit,
        check: this.api.checkProfile,
        onResult: (handle, status) => {
          tracker.record(handle, status, Date.now());
          checked += 1;
          this.dirty = true;

          if (Date.now() - startedAt > this.config.progressAfterMs) {
            this.progress = { checked, total: handles.length };
          }

          this.scheduleFlush(epoch, tracker);
        },
      });

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
      }
    }

    this.dirty = false;
    this.emit();

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
