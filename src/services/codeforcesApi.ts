import type {
  CodeforcesApiResponse,
  CodeforcesContest,
  CodeforcesRatingChange,
  CodeforcesSubmission,
  CodeforcesUser,
} from '../types/codeforces';

const API_BASE = 'https://codeforces.com/api';

async function get<T>(path: string): Promise<CodeforcesApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`);
  return response.json() as Promise<CodeforcesApiResponse<T>>;
}

export async function fetchContests(): Promise<CodeforcesContest[]> {
  const data = await get<CodeforcesContest[]>('/contest.list');
  return data.status === 'OK' ? (data.result ?? []) : [];
}

export async function fetchUserRating(handle: string): Promise<CodeforcesRatingChange[]> {
  const data = await get<CodeforcesRatingChange[]>(`/user.rating?handle=${encodeURIComponent(handle)}`);
  return data.status === 'OK' ? (data.result ?? []) : [];
}

export async function fetchUserSubmissions(handle: string): Promise<CodeforcesSubmission[]> {
  const data = await get<CodeforcesSubmission[]>(`/user.status?handle=${encodeURIComponent(handle)}&count=10000`);
  if (data.status !== 'OK') {
    throw new Error(data.comment || 'unknown');
  }
  return data.result ?? [];
}

export async function fetchUserDataset(handle: string): Promise<{
  submissions: CodeforcesSubmission[];
  ratingHistory: CodeforcesRatingChange[];
}> {
  const [submissions, ratingHistory] = await Promise.all([
    fetchUserSubmissions(handle),
    fetchUserRating(handle),
  ]);
  return { submissions, ratingHistory };
}

// user.friends is an "authorized" CF API method. It has no separate public
// login step here: called same-origin from codeforces.com, the browser's
// existing CF session cookie is what authorizes it. If the viewer isn't
// logged in to Codeforces, this call fails and the caller should treat that
// as "can't show friends right now" rather than a fatal error.
export async function fetchOnlineFriends(): Promise<string[]> {
  const data = await get<string[]>('/user.friends?onlyOnline=true');
  if (data.status !== 'OK') {
    throw new Error(data.comment || 'unknown');
  }
  return data.result ?? [];
}

const USER_INFO_CHUNK_SIZE = 100;

// Chunked so a large friends list can't build one oversized request URL.
// A single failed chunk degrades to an empty list for those handles instead
// of failing the whole lookup.
export async function fetchUsersInfo(handles: string[]): Promise<CodeforcesUser[]> {
  if (handles.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < handles.length; i += USER_INFO_CHUNK_SIZE) {
    chunks.push(handles.slice(i, i + USER_INFO_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map(async chunk => {
      const data = await get<CodeforcesUser[]>(`/user.info?handles=${chunk.map(encodeURIComponent).join(';')}`);
      return data.status === 'OK' ? (data.result ?? []) : [];
    }),
  );
  return results.flat();
}