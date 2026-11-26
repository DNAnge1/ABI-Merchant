/**
 * Shared miss / confusion report schema (Phase 1 logger + Phase 2 D1 miss_reports).
 *
 * Same rich diagnostic payload for:
 * - Calibration panel ground-truth onset logs
 * - Player 👎 Wrong → “what did you get?”
 *
 * No audio upload — spectrum/clip stay local-only; D1/export strip them.
 */

import type { FingerprintsFile, MatchResult } from './audioMatcher';
import { liveFeatureDistances } from './fingerprintPairwise';

/** Bump only when D1 column / consumer shape must change. */
export const MISS_REPORT_SCHEMA_VERSION = 1 as const;
/** @deprecated alias — prefer MISS_REPORT_SCHEMA_VERSION */
export const CONFUSION_DEBUG_SCHEMA = MISS_REPORT_SCHEMA_VERSION;

export const CALIBRATION_DEBUG_STORAGE_KEY = 'abi-merchant.calibrationDebug';

export type MissReportSource =
  | 'live-onset'
  | 'auto'
  | 'burst'
  | 'player-miss';

export type ConfusionScoreRow = {
  soundId: number;
  confidence: number;
  rank: number;
};

export type BandFeatureDistance = {
  cosine: number;
  l2: number;
  centroidDeltaHz: number;
  highBandDelta: number;
};

export type ConfusionDiagnostics = {
  onsetDurationMs: number;
  peakRms: number;
  meanRms: number;
  noiseFloor: number;
  rmsBaseline: number;
  sampleRate: number;
  captureMode: 'display' | 'microphone' | null;
  capturedCentroid: number;
  /** Live↔expected / live↔predicted / FP↔FP feature distances */
  bandDistance: {
    expected: BandFeatureDistance | null;
    predicted: BandFeatureDistance | null;
    expectedVsPredictedFp: (BandFeatureDistance & { centeredCosine: number }) | null;
  };
};

/**
 * Canonical diagnose-why payload. Phase 2 Cloudflare D1 `miss_reports` stores
 * this JSON unchanged (minus local-only fields stripped by {@link toMissReportForUpload}).
 */
export type MissReportPayload = {
  schemaVersion: typeof MISS_REPORT_SCHEMA_VERSION;
  id: string;
  ts: string;
  appVersion: string;
  sessionId: string;
  source: MissReportSource;
  /** Ground truth Sound ID (calibration picker or player “what did you get?”). */
  expectedId: number;
  /** Matcher top prediction at report time. */
  predictedId: number;
  match: boolean;
  /** Rank of expectedId in full score list (1 = top), null if unscored. */
  expectedRank: number | null;
  expectedScore: number | null;
  predictedScore: number | null;
  top5: ConfusionScoreRow[];
  /** Optional item correction from player miss modal. */
  actualItemId?: number;
  actualItemName?: string;
  /** Raid context at report time. */
  mapModeId: string | null;
  mapModeLabel: string | null;
  cargoType: string | null;
  cargoPrice: number | null;
  diagnostics: ConfusionDiagnostics;
  /**
   * Local-only spectral snapshot for Copy Debug JSON / fingerprint work.
   * Stripped before D1 upload — never send audio or full spectrum remotely in Phase 2.
   */
  spectrumVector?: number[];
  /** Local-only: optional WAV available for Download Clip (never uploaded). */
  clipAvailable: boolean;
  clipId?: string;
};

/** @deprecated alias for MissReportPayload — panel / logger use the same shape. */
export type ConfusionDebugEvent = MissReportPayload;

export type ConfusionPairSummary = {
  expectedId: number;
  predictedId: number;
  hits: number;
  expectedTotal: number;
  /** e.g. "#2 → #8 (4/5)" */
  label: string;
};

/** Numbers-only export row (no spectrum, no clip blobs). */
export type MissReportJsonRow = Omit<
  MissReportPayload,
  'spectrumVector' | 'clipId'
> & { clipAvailable: false };

export type ConfusionDebugExport = {
  schemaVersion: typeof MISS_REPORT_SCHEMA_VERSION;
  exportedAt: string;
  sessionId: string;
  expectedId: number | null;
  events: MissReportJsonRow[];
  confusionSummary: ConfusionPairSummary[];
};

export type RaidContextSnapshot = {
  mapModeId: string | null;
  mapModeLabel: string | null;
  cargoType: string | null;
  cargoPrice: number | null;
};

export type BuildMissReportOpts = {
  expectedId: number;
  matches: MatchResult[];
  source: MissReportSource;
  fingerprints: FingerprintsFile;
  spectrumVector: number[];
  capturedCentroid: number;
  onsetDurationMs: number;
  peakRms: number;
  meanRms: number;
  noiseFloor: number;
  rmsBaseline: number;
  sampleRate: number;
  captureMode: 'display' | 'microphone' | null;
  sessionId: string;
  appVersion: string;
  raid: RaidContextSnapshot;
  actualItemId?: number;
  actualItemName?: string;
  /** Local clip key only — never uploaded. */
  clipId?: string;
  /**
   * When set (player-miss), force predictedId to the locked group even if
   * re-scored top differs slightly after UI sticky/consensus.
   */
  predictedIdOverride?: number;
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isCalibrationDebugEnabledFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export function readCalibrationDebugPref(): boolean {
  if (typeof window === 'undefined') return false;
  if (isCalibrationDebugEnabledFromUrl()) return true;
  try {
    return localStorage.getItem(CALIBRATION_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCalibrationDebugPref(on: boolean) {
  try {
    if (on) localStorage.setItem(CALIBRATION_DEBUG_STORAGE_KEY, '1');
    else localStorage.removeItem(CALIBRATION_DEBUG_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/**
 * Build the shared diagnose-why payload (Calibration logger + player 👎).
 * Always includes expectedId rank/score even when outside top 5.
 */
export function buildMissReport(opts: BuildMissReportOpts): MissReportPayload {
  const ranked = [...opts.matches].sort((a, b) => b.confidence - a.confidence);
  const top5: ConfusionScoreRow[] = ranked.slice(0, 5).map((m, i) => ({
    soundId: m.soundId,
    confidence: m.confidence,
    rank: i + 1,
  }));
  const predictedId =
    opts.predictedIdOverride ?? ranked[0]?.soundId ?? -1;
  const predictedScore =
    ranked.find((m) => m.soundId === predictedId)?.confidence ??
    ranked[0]?.confidence ??
    null;
  const expectedIdx = ranked.findIndex((m) => m.soundId === opts.expectedId);
  const expectedRank = expectedIdx >= 0 ? expectedIdx + 1 : null;
  const expectedScore = expectedIdx >= 0 ? ranked[expectedIdx].confidence : null;
  const distances = liveFeatureDistances(
    opts.spectrumVector,
    opts.capturedCentroid,
    opts.fingerprints,
    opts.expectedId,
    predictedId,
  );

  return {
    schemaVersion: MISS_REPORT_SCHEMA_VERSION,
    id: uid(),
    ts: new Date().toISOString(),
    appVersion: opts.appVersion,
    sessionId: opts.sessionId,
    source: opts.source,
    expectedId: opts.expectedId,
    predictedId,
    match: predictedId === opts.expectedId,
    expectedRank,
    expectedScore,
    predictedScore,
    top5,
    actualItemId: opts.actualItemId,
    actualItemName: opts.actualItemName,
    mapModeId: opts.raid.mapModeId,
    mapModeLabel: opts.raid.mapModeLabel,
    cargoType: opts.raid.cargoType,
    cargoPrice: opts.raid.cargoPrice,
    diagnostics: {
      onsetDurationMs: opts.onsetDurationMs,
      peakRms: Math.round(opts.peakRms * 10000) / 10000,
      meanRms: Math.round(opts.meanRms * 10000) / 10000,
      noiseFloor: Math.round(opts.noiseFloor * 10000) / 10000,
      rmsBaseline: Math.round(opts.rmsBaseline * 10000) / 10000,
      sampleRate: opts.sampleRate,
      captureMode: opts.captureMode,
      capturedCentroid: Math.round(opts.capturedCentroid),
      bandDistance: {
        expected: distances.expected,
        predicted: distances.predicted,
        expectedVsPredictedFp: distances.expectedVsPredictedFp
          ? {
              cosine: distances.expectedVsPredictedFp.cosine,
              centeredCosine: distances.expectedVsPredictedFp.centeredCosine,
              l2: distances.expectedVsPredictedFp.l2,
              centroidDeltaHz: distances.expectedVsPredictedFp.centroidDeltaHz,
              highBandDelta: distances.expectedVsPredictedFp.highBandDelta,
            }
          : null,
      },
    },
    spectrumVector: opts.spectrumVector,
    clipAvailable: Boolean(opts.clipId),
    clipId: opts.clipId,
  };
}

/** @deprecated use buildMissReport */
export const buildConfusionEvent = buildMissReport;

/**
 * Strip local-only fields before Phase 2 D1 POST / public stats ingest.
 * No audio, no full spectrum vector.
 */
export function toMissReportForUpload(
  event: MissReportPayload,
): Omit<MissReportPayload, 'spectrumVector' | 'clipAvailable' | 'clipId'> {
  const {
    spectrumVector: _sv,
    clipAvailable: _ca,
    clipId: _cid,
    ...rest
  } = event;
  return rest;
}

/** Aggregate confusion pairs: #expected → #predicted (hits/expectedTotal). */
export function summarizeConfusion(events: MissReportPayload[]): ConfusionPairSummary[] {
  const byExpected = new Map<number, number>();
  const byPair = new Map<string, { expectedId: number; predictedId: number; hits: number }>();
  for (const e of events) {
    byExpected.set(e.expectedId, (byExpected.get(e.expectedId) ?? 0) + 1);
    if (e.match) continue;
    const key = `${e.expectedId}->${e.predictedId}`;
    const prev = byPair.get(key);
    if (prev) prev.hits += 1;
    else byPair.set(key, { expectedId: e.expectedId, predictedId: e.predictedId, hits: 1 });
  }
  return Array.from(byPair.values())
    .map((p) => {
      const expectedTotal = byExpected.get(p.expectedId) ?? p.hits;
      return {
        ...p,
        expectedTotal,
        label: `#${p.expectedId} → #${p.predictedId} (${p.hits}/${expectedTotal})`,
      };
    })
    .sort((a, b) => b.hits - a.hits || a.expectedId - b.expectedId);
}

/**
 * Numbers-only Debug JSON — strips spectrum vectors and clip refs.
 * WAV stays a separate local Download Clip action (never embedded / uploaded).
 */
export function exportConfusionDebugJson(
  sessionId: string,
  expectedId: number | null,
  events: MissReportPayload[],
): string {
  const file: ConfusionDebugExport = {
    schemaVersion: MISS_REPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessionId,
    expectedId,
    events: events.map((e) => {
      const uploaded = toMissReportForUpload(e);
      return { ...uploaded, clipAvailable: false };
    }),
    confusionSummary: summarizeConfusion(events),
  };
  return JSON.stringify(file, null, 2);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
