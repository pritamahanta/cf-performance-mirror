import type { CodeforcesContest, CodeforcesRatingChange, CodeforcesSubmission } from '../types/codeforces';
import { CATEGORIES, DEFAULT_INDICES } from '../types/settings';
import type { Category } from '../types/settings';
import type { DeltaInfo, ModeData, ProblemEntry, ResolvedTimeline } from '../types/performance';
import { classifyContest, decideUserDivisionForContest } from './classification';

interface EngineInput {
  contestMap: Record<number, CodeforcesContest>;
  rawSubmissions: CodeforcesSubmission[];
  ratedContestSet: Set<number>;
  userRatingHistory: CodeforcesRatingChange[];
}

export class PerformanceEngine {
  private readonly contestMap: Record<number, CodeforcesContest>;
  private readonly rawSubmissions: CodeforcesSubmission[];
  private readonly ratedContestSet: Set<number>;
  private readonly userRatingHistory: CodeforcesRatingChange[];

  constructor(input: EngineInput) {
    this.contestMap = input.contestMap;
    this.rawSubmissions = input.rawSubmissions;
    this.ratedContestSet = input.ratedContestSet;
    this.userRatingHistory = input.userRatingHistory;
  }

  calcDeltaRating(category: Category, timelineValue: ResolvedTimeline, now = Math.floor(Date.now() / 1000)): DeltaInfo {
    let cutoffTime = 0;
    let endTime = now;

    if (typeof timelineValue === 'object' && timelineValue.type === 'custom') {
      if (timelineValue.start && timelineValue.end) {
        cutoffTime = new Date(timelineValue.start).getTime() / 1000;
        endTime = new Date(timelineValue.end).getTime() / 1000 + 86399;
      }
    } else if (typeof timelineValue === 'object' && timelineValue.type === 'contests') {
      const contestRecords = [...this.userRatingHistory]
        .filter(change => {
          const contest = this.contestMap[change.contestId];
          if (!contest) return false;
          let contestCategory = classifyContest(contest);
          if (contestCategory === 'Div1+Div2') contestCategory = change.oldRating >= 1900 ? 'Div1' : 'Div2';
          return contestCategory === category;
        })
        .sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds)
        .slice(0, timelineValue.n);
      let delta = 0;
      contestRecords.forEach(change => { delta += change.newRating - change.oldRating; });
      return { delta, count: contestRecords.length };
    } else if (typeof timelineValue === 'object' && timelineValue.type === 'contestRank') {
      const sorted = [...this.userRatingHistory]
        .filter(change => {
          const contest = this.contestMap[change.contestId];
          if (!contest) return false;
          let contestCategory = classifyContest(contest);
          if (contestCategory === 'Div1+Div2') contestCategory = change.oldRating >= 1900 ? 'Div1' : 'Div2';
          return contestCategory === category;
        })
        .sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds);
      const slice = sorted.slice(timelineValue.lo - 1, timelineValue.hi);
      let delta = 0;
      slice.forEach(change => { delta += change.newRating - change.oldRating; });
      return { delta, count: slice.length };
    } else if (typeof timelineValue === 'string' && timelineValue !== 'all') {
      cutoffTime = now - Number.parseInt(timelineValue, 10) * 30 * 24 * 3600;
    }

    let delta = 0;
    let count = 0;
    const sorted = [...this.userRatingHistory].sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds);
    sorted.forEach(change => {
      const time = change.ratingUpdateTimeSeconds;
      if (time < cutoffTime || time > endTime) return;
      const contest = this.contestMap[change.contestId];
      if (!contest) return;
      let contestCategory = classifyContest(contest);
      if (contestCategory === 'Div1+Div2') contestCategory = change.oldRating >= 1900 ? 'Div1' : 'Div2';
      if (contestCategory !== category) return;
      delta += change.newRating - change.oldRating;
      count += 1;
    });
    return { delta, count };
  }

  recalc(mode: 'total' | 'rated' | 'unrated', timelineValue: ResolvedTimeline, now = Math.floor(Date.now() / 1000)): ModeData {
    let cutoffTime = 0;
    let endTime = now;
    let contestWiseN: number | null = null;
    let contestRankLo: number | null = null;
    let contestRankHi: number | null = null;

    if (typeof timelineValue === 'object' && timelineValue.type === 'custom') {
      if (timelineValue.start && timelineValue.end) {
        cutoffTime = new Date(timelineValue.start).getTime() / 1000;
        endTime = new Date(timelineValue.end).getTime() / 1000 + 86399;
      }
    } else if (typeof timelineValue === 'object' && timelineValue.type === 'contests') {
      contestWiseN = timelineValue.n;
    } else if (typeof timelineValue === 'object' && timelineValue.type === 'contestRank') {
      contestRankLo = timelineValue.lo;
      contestRankHi = timelineValue.hi;
    } else if (typeof timelineValue === 'string' && timelineValue !== 'all') {
      cutoffTime = now - Number.parseInt(timelineValue, 10) * 30 * 24 * 60 * 60;
    }

    const buildParticipatedBase = (modeName: typeof mode): Set<number> => {
      const inWindow = new Set<number>();
      this.rawSubmissions.forEach(submission => {
        if (!submission.problem) return;
        const contestId = submission.problem.contestId;
        if (typeof contestId !== 'number') return;
        const contest = this.contestMap[contestId];
        if (!contest || typeof contest.startTimeSeconds !== 'number' || typeof contest.durationSeconds !== 'number') return;
        const submittedAt = submission.creationTimeSeconds;
        if (typeof submittedAt === 'number' && submittedAt >= contest.startTimeSeconds && submittedAt <= contest.startTimeSeconds + contest.durationSeconds) {
          inWindow.add(contestId);
        }
      });

      const participated = new Set<number>();
      if (modeName === 'total') {
        this.ratedContestSet.forEach(id => participated.add(id));
        inWindow.forEach(id => participated.add(id));
      } else if (modeName === 'rated') {
        this.ratedContestSet.forEach(id => participated.add(id));
      } else {
        inWindow.forEach(id => { if (!this.ratedContestSet.has(id)) participated.add(id); });
      }
      return participated;
    };

    let contestWiseIds: Set<number> | null = null;
    if (contestWiseN !== null || contestRankLo !== null) {
      const participated = buildParticipatedBase(mode);
      const sorted = Array.from(participated)
        .filter(id => this.contestMap[id] && typeof this.contestMap[id].startTimeSeconds === 'number')
        .sort((a, b) => this.contestMap[b].startTimeSeconds - this.contestMap[a].startTimeSeconds);
      contestWiseIds = contestWiseN !== null
        ? new Set(sorted.slice(0, contestWiseN))
        : new Set(sorted.slice((contestRankLo as number) - 1, contestRankHi as number));
    }

    const filteredSubmissions = this.rawSubmissions.filter(submission => {
      if (!submission.creationTimeSeconds) return false;
      if (contestWiseIds !== null) return !!submission.problem && typeof submission.problem.contestId === 'number' && contestWiseIds.has(submission.problem.contestId);
      if (cutoffTime === 0 && endTime === now) return true;
      return submission.creationTimeSeconds >= cutoffTime && submission.creationTimeSeconds <= endTime;
    });

    const inWindowSet = new Set<number>();
    filteredSubmissions.forEach(submission => {
      if (!submission.problem || typeof submission.problem.contestId !== 'number') return;
      const contest = this.contestMap[submission.problem.contestId];
      if (!contest || typeof contest.startTimeSeconds !== 'number' || typeof contest.durationSeconds !== 'number') return;
      const submittedAt = submission.creationTimeSeconds;
      if (typeof submittedAt === 'number' && submittedAt >= contest.startTimeSeconds && submittedAt <= contest.startTimeSeconds + contest.durationSeconds) {
        inWindowSet.add(submission.problem.contestId);
      }
    });

    let participated: Set<number>;
    if (contestWiseIds !== null) {
      participated = contestWiseIds;
    } else {
      participated = new Set<number>();
      if (mode === 'total') {
        this.ratedContestSet.forEach(id => participated.add(id));
        inWindowSet.forEach(id => participated.add(id));
      } else if (mode === 'rated') {
        this.ratedContestSet.forEach(id => participated.add(id));
      } else {
        inWindowSet.forEach(id => { if (!this.ratedContestSet.has(id)) participated.add(id); });
      }

      if (cutoffTime !== 0 || endTime !== now) {
        const tmp = new Set<number>();
        participated.forEach(id => {
          const contest = this.contestMap[id];
          if (contest && contest.startTimeSeconds >= cutoffTime && contest.startTimeSeconds <= endTime) tmp.add(id);
        });
        participated = tmp;
      }
    }

    const categoryIndexTimes = {} as ModeData['categoryIndexTimes'];
    const categoryIndexAttempts = {} as ModeData['categoryIndexAttempts'];
    const categoryIndexSolved = {} as ModeData['categoryIndexSolved'];
    const categoryContestCount = {} as ModeData['categoryContestCount'];
    const categoryIndexWrongIds = {} as ModeData['categoryIndexWrongIds'];
    const categoryIndexAcIds = {} as ModeData['categoryIndexAcIds'];
    CATEGORIES.forEach(category => {
      categoryIndexTimes[category] = {};
      categoryIndexAttempts[category] = {};
      categoryIndexSolved[category] = {};
      categoryContestCount[category] = 0;
      categoryIndexWrongIds[category] = {};
      categoryIndexAcIds[category] = {};
    });

    const categoryContestSets = Object.fromEntries(CATEGORIES.map(category => [category, new Set<number>()])) as Record<Category, Set<number>>;
    const unofficialForTable = new Set<number>();
    participated.forEach(id => { if (!this.ratedContestSet.has(id)) unofficialForTable.add(id); });

    const firstACSet = new Set<string>();
    filteredSubmissions.forEach(submission => {
      if (!submission.problem || typeof submission.problem.contestId !== 'number') return;
      const contestId = submission.problem.contestId;
      if (!participated.has(contestId)) return;
      const contest = this.contestMap[contestId];
      if (!contest || typeof contest.startTimeSeconds !== 'number' || typeof contest.durationSeconds !== 'number') return;
      const start = contest.startTimeSeconds;
      const end = start + contest.durationSeconds;
      const submittedAt = submission.creationTimeSeconds;
      if (typeof submittedAt !== 'number' || submittedAt < start || submittedAt > end) return;
      const index = submission.problem.index;
      const pid = `${contestId}-${index}`;
      let category = classifyContest(contest);
      if (category === 'Div1+Div2') category = decideUserDivisionForContest(contestId, contest, unofficialForTable.has(contestId), this.userRatingHistory);
      if (!categoryIndexAttempts[category as Category]) category = 'Other';
      const categoryKey = category as Category;
      categoryContestSets[categoryKey].add(contestId);
      categoryIndexAttempts[categoryKey][index] = (categoryIndexAttempts[categoryKey][index] || 0) + 1;
      categoryIndexTimes[categoryKey][index] = categoryIndexTimes[categoryKey][index] || [];

      if (submission.verdict !== 'OK') {
        if (!categoryIndexWrongIds[categoryKey][index]) categoryIndexWrongIds[categoryKey][index] = [];
        categoryIndexWrongIds[categoryKey][index].push(submission.id);
      }

      if (submission.verdict !== 'OK') return;
      if (firstACSet.has(pid)) return;
      firstACSet.add(pid);
      categoryIndexSolved[categoryKey][index] = (categoryIndexSolved[categoryKey][index] || 0) + 1;
      if (!categoryIndexAcIds[categoryKey][index]) categoryIndexAcIds[categoryKey][index] = [];
      categoryIndexAcIds[categoryKey][index].push(submission.id);

      const timeMin = (submittedAt - start) / 60;
      const maxAllowed = Math.max(1, Math.round(contest.durationSeconds / 60));
      if (timeMin >= 0 && timeMin <= maxAllowed) categoryIndexTimes[categoryKey][index].push(timeMin);
    });

    const everAC = new Set<string>();
    this.rawSubmissions.forEach(submission => {
      if (submission.verdict === 'OK' && submission.problem && typeof submission.problem.contestId === 'number') {
        everAC.add(`${submission.problem.contestId}-${submission.problem.index}`);
      }
    });

    const inContestCids = new Set<number>();
    filteredSubmissions.forEach(submission => {
      if (!submission.problem || typeof submission.problem.contestId !== 'number') return;
      const contestId = submission.problem.contestId;
      const contest = this.contestMap[contestId];
      if (!contest || typeof contest.startTimeSeconds !== 'number' || typeof contest.durationSeconds !== 'number') return;
      const submittedAt = submission.creationTimeSeconds;
      if (typeof submittedAt === 'number' && submittedAt >= contest.startTimeSeconds && submittedAt <= contest.startTimeSeconds + contest.durationSeconds) inContestCids.add(contestId);
    });

    const unofficialForList = new Set<number>();
    inContestCids.forEach(id => { if (!this.ratedContestSet.has(id)) unofficialForList.add(id); });

    const submissionTimingMap = new Map<number, { contestStart: number; submittedAt: number }>();
    const submissionContestMap = new Map<number, number>();

    const makeProbEntry = (submission: CodeforcesSubmission, contestName: string): ProblemEntry => ({
      pid: `${submission.problem.contestId}-${submission.problem.index}`,
      name: submission.problem.name || submission.problem.index,
      contestId: submission.problem.contestId as number,
      contestName,
      index: submission.problem.index,
      rating: submission.problem.rating || null,
      tags: (submission.problem.tags || []).slice(),
      solved: everAC.has(`${submission.problem.contestId}-${submission.problem.index}`),
      wa: 0, tle: 0, rte: 0, mle: 0, other: 0,
      acIds: [], waIds: [], tleIds: [], rteIds: [], mleIds: [], otherIds: [],
    });

    const categoryRawWAMap = Object.fromEntries(CATEGORIES.map(category => [category, new Map<string, ProblemEntry>()])) as Record<Category, Map<string, ProblemEntry>>;
    const recordVerdict = (problem: ProblemEntry, verdict: string | undefined, submissionId: number): void => {
      const key = verdict === 'WRONG_ANSWER' ? 'wa' : verdict === 'TIME_LIMIT_EXCEEDED' ? 'tle' : verdict === 'RUNTIME_ERROR' ? 'rte' : verdict === 'MEMORY_LIMIT_EXCEEDED' ? 'mle' : 'other';
      problem[key] += 1;
      problem[`${key}Ids` as 'waIds' | 'tleIds' | 'rteIds' | 'mleIds' | 'otherIds'].push(submissionId);
    };

    filteredSubmissions.forEach(submission => {
      if (!submission.problem || typeof submission.problem.contestId !== 'number') return;
      const contestId = submission.problem.contestId;
      if (!inContestCids.has(contestId)) return;
      const contest = this.contestMap[contestId];
      if (!contest) return;
      const start = contest.startTimeSeconds;
      const end = start + contest.durationSeconds;
      const submittedAt = submission.creationTimeSeconds;
      if (typeof submittedAt !== 'number' || submittedAt < start || submittedAt > end) return;
      const pid = `${contestId}-${submission.problem.index}`;
      let category = classifyContest(contest);
      if (category === 'Div1+Div2') category = decideUserDivisionForContest(contestId, contest, unofficialForList.has(contestId), this.userRatingHistory);
      if (!categoryRawWAMap[category as Category]) category = 'Other';
      const categoryKey = category as Category;
      if (!categoryRawWAMap[categoryKey].has(pid)) categoryRawWAMap[categoryKey].set(pid, makeProbEntry(submission, contest.name || `Contest ${contestId}`));
      const problem = categoryRawWAMap[categoryKey].get(pid) as ProblemEntry;
      submissionTimingMap.set(submission.id, { contestStart: start, submittedAt });
      submissionContestMap.set(submission.id, contestId);
      if (submission.verdict === 'OK') problem.acIds.push(submission.id);
      else recordVerdict(problem, submission.verdict, submission.id);
    });

    const inContestAcIds = new Set<number>();
    CATEGORIES.forEach(category => categoryRawWAMap[category].forEach(problem => problem.acIds.forEach(id => inContestAcIds.add(id))));
    this.rawSubmissions.forEach(submission => {
      if (!submission.problem || submission.verdict !== 'OK' || typeof submission.problem.contestId !== 'number') return;
      const contestId = submission.problem.contestId;
      const pid = `${contestId}-${submission.problem.index}`;
      if (inContestAcIds.has(submission.id)) return;
      const contest = this.contestMap[contestId];
      if (contest && typeof contest.startTimeSeconds === 'number' && typeof contest.durationSeconds === 'number') {
        const start = contest.startTimeSeconds;
        const end = start + contest.durationSeconds;
        const submittedAt = submission.creationTimeSeconds;
        if (typeof submittedAt === 'number' && submittedAt >= start && submittedAt <= end) {
          submissionTimingMap.set(submission.id, { contestStart: start, submittedAt });
          submissionContestMap.set(submission.id, contestId);
        }
      }
      CATEGORIES.some(category => {
        const entry = categoryRawWAMap[category].get(pid);
        if (!entry) return false;
        entry.acIds.push(submission.id);
        return true;
      });
    });

    const categoryRawProblems = {} as ModeData['categoryRawProblems'];
    CATEGORIES.forEach(category => {
      categoryRawProblems[category] = Array.from(categoryRawWAMap[category].values());
    });

    const practiceRawWAMap = new Map<string, ProblemEntry>();
    filteredSubmissions.forEach(submission => {
      if (!submission.problem || typeof submission.problem.contestId !== 'number') return;
      const contestId = submission.problem.contestId;
      const contest = this.contestMap[contestId];
      if (!contest) return;
      let duringContest = false;
      if (typeof contest.startTimeSeconds === 'number' && typeof contest.durationSeconds === 'number') {
        const start = contest.startTimeSeconds;
        const end = start + contest.durationSeconds;
        const submittedAt = submission.creationTimeSeconds;
        if (typeof submittedAt === 'number' && submittedAt >= start && submittedAt <= end) duringContest = true;
      }
      if (duringContest) return;
      const pid = `${contestId}-${submission.problem.index}`;
      if (!practiceRawWAMap.has(pid)) practiceRawWAMap.set(pid, makeProbEntry(submission, contest.name || `Contest ${contestId}`));
      const problem = practiceRawWAMap.get(pid) as ProblemEntry;
      if (submission.verdict === 'OK') problem.acIds.push(submission.id);
      else recordVerdict(problem, submission.verdict, submission.id);
    });

    return {
      categoryIndexTimes,
      categoryIndexAttempts,
      categoryIndexSolved,
      categoryIndexWrongIds,
      categoryIndexAcIds,
      categoryRawProblems,
      practiceRawProblems: Array.from(practiceRawWAMap.values()),
      participatedCount: participated.size,
      categoryContestCount: Object.fromEntries(CATEGORIES.map(category => [category, categoryContestSets[category].size])) as Record<Category, number>,
      submissionTimingMap,
      submissionContestMap,
    };
  }
}

export { DEFAULT_INDICES };
