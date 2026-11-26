/**
 * Fire-and-forget community 👍/👎 tallies via Cloudflare Worker + D1.
 * localStorage calibration stays authoritative for UX; Worker failures are silent.
 */

export const COMMUNITY_VOTE_WORKER_URL =
  'https://abi-merchant-counter.brent-reichert.workers.dev';

const MIN_SOUND_ID = 1;
const MAX_SOUND_ID = 38;

export type CommunityVote = 'up' | 'down';

export interface CommunitySoundCounts {
  soundId: number;
  upCount: number;
  downCount: number;
}

export interface CommunityAggregates {
  totalUp: number;
  totalDown: number;
  totalVotes: number;
  accuracyPct: number;
  soundsWithVotes: number;
}

export interface CommunityStats {
  sounds: CommunitySoundCounts[];
  aggregates: CommunityAggregates;
}

function isValidSoundId(soundId: number): boolean {
  return Number.isInteger(soundId) && soundId >= MIN_SOUND_ID && soundId <= MAX_SOUND_ID;
}

/** POST /vote — never throws; never blocks UI. */
export function postCommunityVote(soundId: number, vote: CommunityVote): void {
  if (!isValidSoundId(soundId) || (vote !== 'up' && vote !== 'down')) return;

  void fetch(`${COMMUNITY_VOTE_WORKER_URL}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soundId, vote }),
    // keepalive helps a little if the tab navigates away mid-request
    keepalive: true,
  }).catch(() => {
    /* offline / CORS / Worker down — localStorage already recorded */
  });
}

/** GET /stats — returns null when Worker unreachable. */
export async function fetchCommunityStats(): Promise<CommunityStats | null> {
  try {
    const res = await fetch(`${COMMUNITY_VOTE_WORKER_URL}/stats`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CommunityStats;
    if (!data?.aggregates || !Array.isArray(data.sounds)) return null;
    return data;
  } catch {
    return null;
  }
}
