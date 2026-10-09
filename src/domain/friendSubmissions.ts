import type { CodeforcesSubmission } from '../types/codeforces';
import { buildSubmissionUrl } from './friction';

/*
 * Pure logic for the "friend's submissions on this problem" feature
 * (no DOM, no network), so it can be reasoned about and tested on
 * its own.
 */

export interface ProblemRef {
  contestId: number;
  index: string;
}

/*
 * Compact, storage-friendly copy of the few Submission fields the
 * popup needs. Everything except id/index/createdAt can be absent.
 * Only fields that are actually displayed are kept, so cached
 * entries for users with very many submissions stay small.
 */
export interface FriendSubmission {
  id: number;
  index: string;
  createdAt: number;
  participantType?: string;
  /*
   * Seconds since contest start (or since the virtual start). Only
   * set for submissions made as a contestant / virtual participant.
   */
  contestSeconds?: number;
  verdict?: string;
  testset?: string;
  passedTestCount?: number;
}

/*
 * Regular contests only. Gym / group / acm.sguru problems live at
 * other URLs (and gym ids start at 100001, same rule as
 * buildSubmissionUrl), and their submissions are not reliably
 * available through the anonymous public API, so they are ignored.
 */
const GYM_CONTEST_ID_MIN = 100001;

const PROBLEM_PATH_PATTERNS: readonly RegExp[] = [
  /^\/problemset\/problem\/(\d+)\/([A-Za-z][A-Za-z0-9]*)\/?$/,
  /^\/contest\/(\d+)\/problem\/([A-Za-z][A-Za-z0-9]*)\/?$/,
];

export function parseProblemPage(pathname: string): ProblemRef | null {
  for (const pattern of PROBLEM_PATH_PATTERNS) {
    const match = pattern.exec(pathname);

    if (!match) {
      continue;
    }

    const contestId = Number(match[1]);

    if (
      !Number.isSafeInteger(contestId) ||
      contestId <= 0 ||
      contestId >= GYM_CONTEST_ID_MIN
    ) {
      return null;
    }

    return { contestId, index: match[2].toUpperCase() };
  }

  return null;
}

/*
 * The API reports Integer.MAX_VALUE as relativeTimeSeconds for
 * practice submissions (seen in real contest.status responses), so
 * it must never be shown as a time.
 */
const RELATIVE_TIME_SENTINEL = 2147483647;

const CONTEST_TIME_PARTICIPANT_TYPES = new Set([
  'CONTESTANT',
  'OUT_OF_COMPETITION',
  'VIRTUAL',
]);

export function compactSubmission(
  raw: CodeforcesSubmission | null | undefined,
): FriendSubmission | null {
  if (
    !raw ||
    typeof raw.id !== 'number' ||
    !raw.problem ||
    typeof raw.problem.index !== 'string' ||
    typeof raw.creationTimeSeconds !== 'number'
  ) {
    return null;
  }

  const participantType = raw.author?.participantType;
  const relative = raw.relativeTimeSeconds;

  const hasContestTime =
    typeof participantType === 'string' &&
    CONTEST_TIME_PARTICIPANT_TYPES.has(participantType) &&
    typeof relative === 'number' &&
    relative >= 0 &&
    relative < RELATIVE_TIME_SENTINEL;

  return {
    id: raw.id,
    index: raw.problem.index,
    createdAt: raw.creationTimeSeconds,
    participantType,
    contestSeconds: hasContestTime ? relative : undefined,
    verdict: raw.verdict,
    testset: raw.testset,
    passedTestCount: raw.passedTestCount,
  };
}

export function compactSubmissions(
  raw: readonly CodeforcesSubmission[],
): FriendSubmission[] {
  const result: FriendSubmission[] = [];

  for (const item of raw) {
    const compact = compactSubmission(item);

    if (compact) {
      result.push(compact);
    }
  }

  return result;
}

/* Guards data read back from sessionStorage. */
export function isFriendSubmission(value: unknown): value is FriendSubmission {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === 'number' &&
    typeof item.index === 'string' &&
    typeof item.createdAt === 'number'
  );
}

/* Newest first, matching how Codeforces lists submissions. */
export function submissionsForProblem(
  submissions: readonly FriendSubmission[],
  index: string,
): FriendSubmission[] {
  const wanted = index.toUpperCase();

  return submissions
    .filter(item => item.index.toUpperCase() === wanted)
    .sort((a, b) => b.id - a.id);
}

export function hasSolved(submissions: readonly FriendSubmission[]): boolean {
  return submissions.some(item => item.verdict === 'OK');
}

const VERDICT_LABELS: Record<string, string> = {
  OK: 'Accepted',
  WRONG_ANSWER: 'Wrong answer',
  RUNTIME_ERROR: 'Runtime error',
  TIME_LIMIT_EXCEEDED: 'Time limit exceeded',
  MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded',
  IDLENESS_LIMIT_EXCEEDED: 'Idleness limit exceeded',
  COMPILATION_ERROR: 'Compilation error',
  CHALLENGED: 'Hacked',
  SKIPPED: 'Skipped',
  TESTING: 'Running',
  REJECTED: 'Rejected',
  FAILED: 'Judgement failed',
  PARTIAL: 'Partial result',
  CRASHED: 'Crashed',
  INPUT_PREPARATION_CRASHED: 'Input preparation crashed',
  SECURITY_VIOLATED: 'Security violated',
  SUBMITTED: 'Submitted',
};

/* Verdicts Codeforces reports together with a failing test number. */
const TEST_NUMBER_VERDICTS = new Set([
  'WRONG_ANSWER',
  'RUNTIME_ERROR',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'IDLENESS_LIMIT_EXCEEDED',
]);

function humanizeEnum(value: string): string {
  const text = value.replace(/_/g, ' ').toLowerCase();

  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function verdictLabel(
  submission: Pick<FriendSubmission, 'verdict' | 'passedTestCount' | 'testset'>,
): string {
  const { verdict } = submission;

  if (!verdict) {
    return 'In queue';
  }

  const base = VERDICT_LABELS[verdict] ?? humanizeEnum(verdict);

  if (
    TEST_NUMBER_VERDICTS.has(verdict) &&
    typeof submission.passedTestCount === 'number' &&
    submission.passedTestCount >= 0
  ) {
    const kind = submission.testset === 'PRETESTS' ? 'pretest' : 'test';

    return `${base} on ${kind} ${submission.passedTestCount + 1}`;
  }

  return base;
}

export type VerdictTone = 'ok' | 'bad' | 'neutral';

const NEUTRAL_VERDICTS = new Set([
  'TESTING',
  'SUBMITTED',
  'SKIPPED',
  'PARTIAL',
]);

export function verdictTone(verdict: string | undefined): VerdictTone {
  if (!verdict || NEUTRAL_VERDICTS.has(verdict)) {
    return 'neutral';
  }

  return verdict === 'OK' ? 'ok' : 'bad';
}

/* 3725 -> "1:02" (h:mm), the way contest times are shown. */
export function formatContestTime(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function participationLabel(
  participantType: string | undefined,
): string | null {
  switch (participantType) {
    case 'CONTESTANT':
      return 'Contest';
    case 'OUT_OF_COMPETITION':
      return 'Out of competition';
    case 'VIRTUAL':
      return 'Virtual';
    case 'PRACTICE':
      return 'Practice';
    default:
      return null;
  }
}

/*
 * Second line of a popup row, e.g.
 * "Contest +1:02 · Sep 3, 2025, 14:30".
 */
export function submissionMeta(
  submission: FriendSubmission,
  formatDate: (unixSeconds: number) => string,
): string {
  const parts: string[] = [];
  const participation = participationLabel(submission.participantType);

  if (participation) {
    parts.push(
      typeof submission.contestSeconds === 'number'
        ? `${participation} +${formatContestTime(submission.contestSeconds)}`
        : participation,
    );
  }

  parts.push(formatDate(submission.createdAt));

  return parts.join(' \u00b7 ');
}

export function formatSubmissionDate(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/*
 * Short "when" for one line in the sidebar box: the contest time for
 * contest / virtual submissions ("Contest +1:02"), otherwise the date.
 */
export function shortWhen(
  submission: FriendSubmission,
  formatDate: (unixSeconds: number) => string,
): string {
  const participation = participationLabel(submission.participantType);

  if (participation && typeof submission.contestSeconds === 'number') {
    return `${participation} +${formatContestTime(submission.contestSeconds)}`;
  }

  return formatDate(submission.createdAt);
}

export function buildFriendSubmissionUrl(
  submission: Pick<FriendSubmission, 'id'>,
  contestId: number,
): string | null {
  return buildSubmissionUrl(submission.id, contestId);
}

/*
 * One row of the Friends submissions box: what a friend did on this
 * problem, boiled down.
 */
export interface FriendProblemSummary {
  /* Submissions on this problem, newest first. */
  submissions: FriendSubmission[];
  solved: boolean;

  /*
   * The earliest accepted submission (lowest id) when solved, otherwise
   * the newest submission. This is the one the row's time refers to.
   */
  headline: FriendSubmission;

  /* Submissions before the first accepted one (all of them when unsolved). */
  attemptsBeforeSolve: number;
}

/* Null when the friend has no submission on the problem. */
export function summarizeFriend(
  allSubmissions: readonly FriendSubmission[],
  index: string,
): FriendProblemSummary | null {
  const submissions = submissionsForProblem(allSubmissions, index);

  if (submissions.length === 0) {
    return null;
  }

  let firstOk: FriendSubmission | null = null;

  for (const item of submissions) {
    if (item.verdict === 'OK' && (firstOk === null || item.id < firstOk.id)) {
      firstOk = item;
    }
  }

  if (firstOk) {
    const okId = firstOk.id;

    return {
      submissions,
      solved: true,
      headline: firstOk,
      attemptsBeforeSolve: submissions.filter(item => item.id < okId).length,
    };
  }

  return {
    submissions,
    solved: false,
    headline: submissions[0],
    attemptsBeforeSolve: submissions.length,
  };
}

/*
 * Solved friends first (earliest accepted first), then unsolved ones
 * (most recent attempt first); handle breaks ties so the order is stable
 * between renders.
 */
export function compareSummaries(
  a: { handle: string; summary: FriendProblemSummary },
  b: { handle: string; summary: FriendProblemSummary },
): number {
  if (a.summary.solved !== b.summary.solved) {
    return a.summary.solved ? -1 : 1;
  }

  const byTime = a.summary.solved
    ? a.summary.headline.createdAt - b.summary.headline.createdAt
    : b.summary.headline.createdAt - a.summary.headline.createdAt;

  if (byTime !== 0) {
    return byTime;
  }

  return a.handle.localeCompare(b.handle);
}
