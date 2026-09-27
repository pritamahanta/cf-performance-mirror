import type {
  CodeforcesApiResponse,
  CodeforcesContest,
  CodeforcesRatingChange,
  CodeforcesSubmission,
  CodeforcesUser,
} from '../types/codeforces';

const API_BASE = 'https://codeforces.com/api';

async function get<T>(
  path: string,
): Promise<CodeforcesApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`);
  return response.json() as Promise<CodeforcesApiResponse<T>>;
}

export async function fetchContests(): Promise<CodeforcesContest[]> {
  const data = await get<CodeforcesContest[]>('/contest.list');
  return data.status === 'OK'
    ? (data.result ?? [])
    : [];
}

export async function fetchUserRating(
  handle: string,
): Promise<CodeforcesRatingChange[]> {
  const data = await get<CodeforcesRatingChange[]>(
    `/user.rating?handle=${encodeURIComponent(handle)}`,
  );

  return data.status === 'OK'
    ? (data.result ?? [])
    : [];
}

export async function fetchUserSubmissions(
  handle: string,
): Promise<CodeforcesSubmission[]> {
  const data =
    await get<CodeforcesSubmission[]>(
      `/user.status?handle=${encodeURIComponent(handle)}&count=10000`,
    );

  if (data.status !== 'OK') {
    throw new Error(data.comment || 'unknown');
  }

  return data.result ?? [];
}

export async function fetchUserDataset(
  handle: string,
): Promise<{
  submissions: CodeforcesSubmission[];
  ratingHistory: CodeforcesRatingChange[];
}> {
  const [
    submissions,
    ratingHistory,
  ] = await Promise.all([
    fetchUserSubmissions(handle),
    fetchUserRating(handle),
  ]);

  return {
    submissions,
    ratingHistory,
  };
}

/*
 * Codeforces' user.friends API method requires API authorization.
 * Instead of embedding an API secret in the extension, read the
 * authenticated /friends page using the user's existing Codeforces
 * browser session.
 */
export async function fetchOnlineFriends(): Promise<string[]> {
  const response = await fetch(
    'https://codeforces.com/friends',
    {
      credentials: 'include',
    },
  );

  if (!response.ok) {
    throw new Error(
      'Could not load your Codeforces friends page.',
    );
  }

  const html = await response.text();

  const doc = new DOMParser().parseFromString(
    html,
    'text/html',
  );

  /*
   * The friends page contains the main friends table.
   * Select the largest table containing profile links so
   * unrelated sidebar profile links are ignored.
   */
  const tables = Array.from(
    doc.querySelectorAll('table'),
  )
    .map(table => ({
      table,
      count:
        table.querySelectorAll(
          'a[href*="/profile/"]',
        ).length,
    }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count);

  const friendsTable = tables[0]?.table;

  if (!friendsTable) {
    throw new Error(
      "Couldn't load your friends. Make sure you're logged in to Codeforces.",
    );
  }

  const handles = Array.from(
    new Set(
      Array.from(
        friendsTable.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/profile/"]',
        ),
      )
        .map(link => {
          const match =
            link.getAttribute('href')?.match(
              /\/profile\/([^/?#]+)/,
            );

          return match?.[1] ?? '';
        })
        .filter(Boolean),
    ),
  );

  if (handles.length === 0) {
    throw new Error(
      "Couldn't find any friends on your Codeforces friends page.",
    );
  }

  return handles;
}

const USER_INFO_CHUNK_SIZE = 100;

/*
 * Keep requests chunked so the URL does not become too large.
 */
export async function fetchUsersInfo(
  handles: string[],
): Promise<CodeforcesUser[]> {
  if (handles.length === 0) {
    return [];
  }

  const chunks: string[][] = [];

  for (
    let i = 0;
    i < handles.length;
    i += USER_INFO_CHUNK_SIZE
  ) {
    chunks.push(
      handles.slice(
        i,
        i + USER_INFO_CHUNK_SIZE,
      ),
    );
  }

  const results = await Promise.all(
    chunks.map(async chunk => {
      const data =
        await get<CodeforcesUser[]>(
          `/user.info?handles=${chunk
            .map(encodeURIComponent)
            .join(';')}`,
        );

      return data.status === 'OK'
        ? (data.result ?? [])
        : [];
    }),
  );

  return results.flat();
}