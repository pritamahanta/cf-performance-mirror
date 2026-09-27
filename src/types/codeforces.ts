export type ContestPhase = 'BEFORE' | 'CODING' | 'PENDING_SYSTEM_TESTS' | 'SYSTEM_TEST' | 'FINISHED' | string;

export interface CodeforcesContest {
  id: number;
  name: string;
  type?: string;
  phase?: ContestPhase;
  frozen?: boolean;
  durationSeconds: number;
  startTimeSeconds: number;
  relativeTimeSeconds?: number;
}

export interface CodeforcesProblem {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type?: string;
  points?: number;
  rating?: number;
  tags: string[];
}

export interface CodeforcesSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds?: number;
  problem: CodeforcesProblem;
  author?: unknown;
  programmingLanguage?: string;
  verdict?: string;
  testset?: string;
  passedTestCount?: number;
  timeConsumedMillis?: number;
  memoryConsumedBytes?: number;
}

export interface CodeforcesRatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

export interface CodeforcesApiResponse<T> {
  status: 'OK' | string;
  result?: T;
  comment?: string;
}

export interface CodeforcesUser {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  lastOnlineTimeSeconds?: number;
}