import type { CodeforcesUser } from '../types/codeforces';

export interface OnlineFriend {
  handle: string;
  rating?: number;
  rank?: string;
}

// Merges the plain handle list from user.friends with the richer data from
// user.info (rating/rank), keyed case-insensitively since CF handles are
// case-insensitive but user.info returns the canonical casing.
export function mergeFriendsWithInfo(handles: string[], infos: CodeforcesUser[]): OnlineFriend[] {
  const infoByHandle = new Map(infos.map(info => [info.handle.toLowerCase(), info]));
  return handles
    .map((handle): OnlineFriend => {
      const info = infoByHandle.get(handle.toLowerCase());
      return { handle: info?.handle ?? handle, rating: info?.rating, rank: info?.rank };
    })
    .sort((a, b) => a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' }));
}

export function buildProfileUrl(handle: string): string {
  return `https://codeforces.com/profile/${encodeURIComponent(handle)}`;
}