/**
 * Fire-and-forget miss / confusion reports → Cloudflare Worker + D1.
 * Always posts numbers-only MissReportPayload via toMissReportForUpload.
 * No audio / spectrum / clip — soft-fail when Worker unreachable.
 */

import type { MissReportPayload } from './confusionDebug';
import { toMissReportForUpload } from './confusionDebug';
import { COMMUNITY_VOTE_WORKER_URL } from './communityVotes';

export const CALIBRATION_AUTO_SAVE_KEY = 'abi-merchant.calibrationAutoSave';

export type MissReportUpload = ReturnType<typeof toMissReportForUpload>;

export interface MissConfusionPair {
  expectedId: number;
  predictedId: number;
  hits: number;
  label: string;
}

export interface MissDailyRow {
  day: string;
  total: number;
  misses: number;
}

export interface MissReportStats {
  totals: { total: number; misses: number; hits: number };
  topMisidentified: MissConfusionPair[];
  topPredictedAsWrong: { soundId: number; hits: number }[];
  daily: MissDailyRow[];
  windowDays: number;
}

export interface MissReportListItem {
  id: string;
  createdAt: number;
  day: string;
  schemaVersion: number;
  source: string;
  expectedId: number;
  predictedId: number;
  match: boolean;
  expectedRank: number | null;
  expectedScore: number | null;
  predictedScore: number | null;
  mapModeId: string | null;
  appVersion: string | null;
  payload: MissReportUpload | null;
}

export function readCalibrationAutoSavePref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CALIBRATION_AUTO_SAVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCalibrationAutoSavePref(on: boolean) {
  try {
    if (on) localStorage.setItem(CALIBRATION_AUTO_SAVE_KEY, '1');
    else localStorage.removeItem(CALIBRATION_AUTO_SAVE_KEY);
  } catch {
    /* ignore quota */
  }
}

/**
 * POST /reports — fire-and-forget. Returns true on 2xx, false on soft failure.
 * Always strips spectrum / clip via toMissReportForUpload.
 */
export async function postMissReport(event: MissReportPayload): Promise<boolean> {
  try {
    const body = toMissReportForUpload(event);
    const res = await fetch(`${COMMUNITY_VOTE_WORKER_URL}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      mode: 'cors',
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /reports/stats — public confusion summary; null when unreachable. */
export async function fetchMissReportStats(): Promise<MissReportStats | null> {
  try {
    const res = await fetch(`${COMMUNITY_VOTE_WORKER_URL}/reports/stats`, {
      method: 'GET',
      mode: 'cors',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MissReportStats;
    if (!data?.totals || !Array.isArray(data.topMisidentified)) return null;
    return data;
  } catch {
    return null;
  }
}

/** GET /reports — recent public rows; null when unreachable. */
export async function fetchMissReports(opts?: {
  limit?: number;
  missesOnly?: boolean;
}): Promise<MissReportListItem[] | null> {
  try {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set('limit', String(opts.limit));
    if (opts?.missesOnly) q.set('misses', '1');
    const qs = q.toString();
    const res = await fetch(
      `${COMMUNITY_VOTE_WORKER_URL}/reports${qs ? `?${qs}` : ''}`,
      { method: 'GET', mode: 'cors' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { reports?: MissReportListItem[] };
    return Array.isArray(data.reports) ? data.reports : null;
  } catch {
    return null;
  }
}
