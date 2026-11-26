/**
 * Fire-and-forget community tallies via Cloudflare Worker + D1.
 * localStorage calibration stays authoritative for UX; Worker failures are silent.
 */

export const COMMUNITY_VOTE_WORKER_URL =
  'https://abi-merchant-counter.brent-reichert.workers.dev';

const MIN_SOUND_ID = 1;
const MAX_SOUND_ID = 38;

const VISIT_SESSION_KEY = 'abi-merchant.community.visit.v1';
const MAP_MODE_SESSION_PREFIX = 'abi-merchant.community.mapMode.';

export type CommunityVote = 'up' | 'down';

/** Whitelisted POST /event keys (plus map_mode special). */
export type CommunityEventKey =
  | 'visits'
  | 'scans_total'
  | 'scans_auto'
  | 'scans_manual'
  | 'scans_fallback'
  | 'reds_found'
  | 'pip_opens'
  | 'capture_display'
  | 'capture_mic'
  | 'map_mode';

export interface CommunitySoundCounts {
  soundId: number;
  upCount: number;
  downCount: number;
  scanCount?: number;
  redCount?: number;
}

export interface CommunitySoundExtreme {
  soundId: number;
  upCount?: number;
  downCount?: number;
  scanCount?: number;
}

export interface CommunityAggregates {
  totalUp: number;
  totalDown: number;
  totalVotes: number;
  accuracyPct: number;
  soundsWithVotes: number;
  mostVoted?: CommunitySoundExtreme | null;
  leastVoted?: CommunitySoundExtreme | null;
  mostScanned?: CommunitySoundExtreme | null;
  leastScanned?: CommunitySoundExtreme | null;
  topRedSoundId?: number | null;
}

export interface CommunityDailyRow {
  day: string;
  visits: number;
  scans: number;
  votes: number;
  redsFound: number;
}

export interface CommunityMapModeCount {
  mapMode: string;
  count: number;
}

export interface CommunityStats {
  sounds: CommunitySoundCounts[];
  aggregates: CommunityAggregates;
  counters?: Record<string, number>;
  daily?: CommunityDailyRow[];
  topMapModes?: CommunityMapModeCount[];
}

function isValidSoundId(soundId: number): boolean {
  return Number.isInteger(soundId) && soundId >= MIN_SOUND_ID && soundId <= MAX_SOUND_ID;
}

function postJson(path: string, body: unknown): void {
  void fetch(`${COMMUNITY_VOTE_WORKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    /* offline / CORS / Worker down — local UX already recorded */
  });
}

/** POST /vote — never throws; never blocks UI. */
export function postCommunityVote(soundId: number, vote: CommunityVote): void {
  if (!isValidSoundId(soundId) || (vote !== 'up' && vote !== 'down')) return;
  postJson('/vote', { soundId, vote });
}

/** POST /event — whitelist keys only; never throws. */
export function postCommunityEvent(
  key: CommunityEventKey,
  opts?: { soundId?: number; mapMode?: string },
): void {
  if (key === 'map_mode') {
    const mapMode = opts?.mapMode?.trim();
    if (!mapMode) return;
    postJson('/event', { key, mapMode });
    return;
  }

  const body: { key: string; soundId?: number } = { key };
  if (opts?.soundId != null && isValidSoundId(opts.soundId)) {
    body.soundId = opts.soundId;
  }
  postJson('/event', body);
}

/**
 * Once per browser tab session — approximates unique sessions via visits + sessionStorage.
 */
export function trackCommunityVisit(): void {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(VISIT_SESSION_KEY)) {
      return;
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(VISIT_SESSION_KEY, '1');
    }
  } catch {
    /* private mode / blocked storage — still fire once this call */
  }
  postCommunityEvent('visits');
}

/** Once per session per map/mode id (avoids spam while flipping selects). */
export function trackCommunityMapMode(mapModeId: string): void {
  const id = mapModeId.trim();
  if (!id) return;
  try {
    const sk = `${MAP_MODE_SESSION_PREFIX}${id}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sk)) return;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sk, '1');
  } catch {
    /* still fire */
  }
  postCommunityEvent('map_mode', { mapMode: id });
}

/**
 * Fire scan-related counters after a lock / best-guess.
 * - scans_total (+ optional soundId for most/least scanned)
 * - scans_auto | scans_manual
 * - scans_fallback when capture is mic/loopback
 * - reds_found when red chance > 0 (+ soundId for top red)
 */
export function trackCommunityScan(opts: {
  soundId: number;
  mode: 'automatic' | 'manual';
  captureSource?: 'display' | 'microphone' | null;
  redChancePercent?: number;
}): void {
  const soundId = opts.soundId;
  postCommunityEvent('scans_total', { soundId });
  postCommunityEvent(opts.mode === 'manual' ? 'scans_manual' : 'scans_auto');
  if (opts.captureSource === 'microphone') {
    postCommunityEvent('scans_fallback');
  }
  if ((opts.redChancePercent ?? 0) > 0) {
    postCommunityEvent('reds_found', { soundId });
  }
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
