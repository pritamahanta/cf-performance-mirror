import type { Category, Mode } from './settings';

export interface SubmissionTiming {
  contestStart: number;
  submittedAt: number;
}

export interface ProblemEntry {
  pid: string;
  name: string;
  contestId: number;
  contestName: string;
  index: string;
  rating: number | null;
  tags: string[];
  solved: boolean;
  /*
   * Whether the problem was accepted while its contest was running (judged by
   * the submission's time, over every submission, whatever period is shown).
   * `solved` without this means it was solved only after the contest.
   */
  solvedInContest: boolean;
  /*
   * Whether the problem had at least one submission, right or wrong, while its
   * contest was running (same judging and scope as `solvedInContest`). A
   * problem solved only after the contest is an upsolve only if this is true;
   * otherwise it was just practised.
   */
  attemptedInContest: boolean;
  wa: number;
  tle: number;
  rte: number;
  mle: number;
  other: number;
  acIds: number[];
  waIds: number[];
  tleIds: number[];
  rteIds: number[];
  mleIds: number[];
  otherIds: number[];
}

export interface TimelineCustom {
  type: 'custom';
  start: string;
  end: string;
}

export interface TimelineContests {
  type: 'contests';
  n: number;
}

export interface TimelineContestRank {
  type: 'contestRank';
  lo: number;
  hi: number;
}

export type ResolvedTimeline = string | TimelineCustom | TimelineContests | TimelineContestRank;

export interface ModeData {
  categoryIndexTimes: Record<Category, Record<string, number[]>>;
  categoryIndexAttempts: Record<Category, Record<string, number>>;
  categoryIndexSolved: Record<Category, Record<string, number>>;
  categoryIndexWrongIds: Record<Category, Record<string, number[]>>;
  categoryIndexAcIds: Record<Category, Record<string, number[]>>;
  categoryRawProblems: Record<Category, ProblemEntry[]>;
  practiceRawProblems: ProblemEntry[];
  /*
   * How many distinct problems, among the submissions in the chosen period,
   * could not be listed because their contest is not in Codeforces' regular
   * contest list (gym contests, or a contest the list does not know), or
   * the problem has no contest number at all (acm.sgu.ru, say).
   */
  omittedProblems: { gym: number; other: number };
  participatedCount: number;
  categoryContestCount: Record<Category, number>;
  submissionTimingMap: Map<number, SubmissionTiming>;
  submissionContestMap: Map<number, number>;
}

export interface DeltaInfo {
  delta: number;
  count: number;
}

export interface PerformanceSnapshot extends ModeData {
  category: Category;
  mode: Mode;
  timeline: ResolvedTimeline;
  deltaInfo: DeltaInfo;
}
