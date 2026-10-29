/**
 * Real-time Web Audio matcher for Field Merchant mystery cargo sounds.
 * Uses AnalyserNode (fftSize 2048, or 4096 when sampleRate > 30k), onset detection,
 * 300ms spectral slices, and cosine similarity against precomputed fingerprints
 * filtered by cargo size+price.
 */

/** Fingerprint extract rate Nyquist (22050/2) — live centroids must stay in this band. */
export const FP_NYQUIST_HZ = 11025;
export const CENTROID_MIN_HZ = 50;

/** Prefer ~10.8Hz bins at 44.1/48k so live FFT resolution matches 22050@2048 fingerprints. */
export function analyserFftSize(sampleRate: number): number {
  return sampleRate > 30000 ? 4096 : 2048;
}

import {
  captureDisplayWithAudio,
  type BootstrappedCapture,
  type CaptureSourceKind,
} from './displayCapture';
import { captureMicWithAudio } from './micCapture';
import {
  presetFor,
  type SensitivityLevel,
  type SensitivityPreset,
} from './sensitivity';
import { assetUrl } from './assetUrl';
import { concatFloat32, encodeWavMono } from './browserAudio';

export type SoundKind = 'pickup' | 'drop';

export interface FingerprintSide {
  file: string;
  name: string;
  durationMs: number;
  sampleRate: number;
  fftSize: number;
  spectralCentroid: number;
  dominantPeaks: { frequencyHz: number; magnitude: number }[];
  durationEnvelope: number[];
  spectrumVector: number[];
  /** Present on live300-aligned fingerprints */
  windowMs?: number;
  onsetMs?: number;
  frames?: number;
}

export interface SoundFingerprint {
  soundId: number;
  pickup: FingerprintSide | null;
  drop: FingerprintSide | null;
  itemNames: string[];
}

export interface FingerprintsFile {
  generatedAt: string;
  fftSize: number;
  sampleRate: number;
  vectorBands: number;
  /** Live-aligned analysis window (ms). Pickup-only fingerprints use ~300. */
  windowMs?: number;
  /** Which side the matcher should prefer. Field Merchant = pickup only. */
  matchSide?: SoundKind | 'auto';
  analysis?: string;
  fingerprints: Record<string, SoundFingerprint>;
}

export interface MerchantItem {
  id: number;
  name: string;
  rarity: number;
  size: string;
  category: string;
  contactPrice: number;
  soundId: number;
  iconUrl?: string;
  pickupSound: string;
  dropSound: string;
  sources: { cargoType: string; cargoPrice: number }[];
}

export interface MatchResult {
  soundId: number;
  confidence: number;
  kind: SoundKind;
  items: MerchantItem[];
  spectralCentroid: number;
  /** Captured spectrum bands for calibration / miss logging */
  spectrumVector?: number[];
  capturedCentroid?: number;
  /**
   * Set when {@link resolveQuiet19Residual} promoted/floored #19.
   * Lock path uses a softer (or zero) margin so ~78% vs ~77–78% can lock.
   */
  quiet19Residual?: boolean;
  /**
   * Set when {@link resolveField10Residual} promoted dulled in-game electronics (#10).
   * Field #10 often lands ~3.4 kHz vs FP ~4.6 kHz and gets buried under #32/#21.
   */
  field10Residual?: boolean;
}

export interface MatchPayload {
  matches: MatchResult[];
  peakMs: number;
  spectrumVector: number[];
  capturedCentroid: number;
  /** How the match was produced — burst bypasses auto margin rules in the UI. */
  source?: 'auto' | 'burst';
  /** Last burst WAV when source is burst (Multi + Stop & Match). */
  captureBlob?: Blob | null;
  captureDurationMs?: number;
}

/** Result of Stop & Match — always populated so the UI can toast + replay capture. */
export interface BurstMatchResult {
  ok: boolean;
  reason: string;
  matches: MatchResult[];
  frameCount: number;
  spikeCount: number;
  peakRms: number;
  baseline: number;
  threshold: number;
  /** Raw burst PCM as WAV — present even when match fails / “too quiet”. */
  captureBlob: Blob | null;
  captureSampleRate: number;
  captureDurationMs: number;
  captureSamples: number;
}

export interface MatcherOptions {
  /** RMS energy threshold for onset (0–1 scale of analyser). Default from sensitivity. */
  noiseFloor?: number;
  /** Capture window after onset in ms. Default 300 */
  sliceMs?: number;
  /** Cooldown between detections in ms. Default 800; continuous ~600 */
  cooldownMs?: number;
  /**
   * Prefer pickup, drop, or auto.
   * Default pickup — Field Merchant only plays pickup when dragging cargo.
   * `auto` also resolves to pickup-only (drop vectors ignored for matching).
   */
  kind?: SoundKind | 'auto';
  /**
   * After the browser window regains focus, ignore onsets for this many ms
   * (single-monitor Alt+Tab grace). 0 = off.
   */
  focusGraceMs?: number;
  /** Low / Med / High onset+match strictness. Default med (mic runs stricter). */
  sensitivity?: SensitivityLevel;
}

export type MatcherStatus =
  | 'idle'
  | 'listening'
  | 'capturing'
  | 'matching'
  | 'done'
  | 'error';

/** Shop workflow phase for UI status copy. */
export type ShopPhase =
  | 'in-raid'
  | 'calibrating'
  | 'at-shop'
  | 'recording'
  | 'locked';

/** Dual + Multiple Items: auto-count cargo moves then lock. */
export const MULTI_SPIKE_TARGET_N = 3;
/** Silence / refractory after a Multi lock before counting the next cargo. */
export const MULTI_COOLDOWN_MS = 1100;
/**
 * Min gap between counted Multi moves. Long cargo (#31 clock) has multi-lobe
 * envelopes — a short sep counted 2–3 spikes inside one drag and mixed items.
 */
const MULTI_SPIKE_SEP_MS = 520;

export type MultiScanPhase =
  | 'idle'
  | 'armed'
  | 'counting'
  | 'matching'
  | 'cooldown';

export interface MultiScanProgress {
  spikeCount: number;
  targetN: number;
  phase: MultiScanPhase;
  detail?: string;
}

interface BurstFrame {
  t: number;
  rms: number;
  spectrum: number[];
  centroid: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Web Audio getByteFrequencyData maps minDecibels=-100 … maxDecibels=-30 → 0..255.
 * Fingerprints are built from linear FFT magnitudes — convert dB bytes back to linear.
 * Prefer {@link fftLinearMagnitudes} from time-domain for fingerprint-aligned capture.
 */
function byteToLinearMag(byteVal: number): number {
  if (byteVal <= 0) return 0;
  const db = -100 + (byteVal / 255) * 70;
  return Math.pow(10, db / 20);
}

/** In-place radix-2 FFT (real/imag). n must be power of 2. */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = Math.PI / half;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const ang = -step * k;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const evenRe = re[i + k];
        const evenIm = im[i + k];
        const oddRe = re[i + k + half];
        const oddIm = im[i + k + half];
        const tr = wr * oddRe - wi * oddIm;
        const ti = wr * oddIm + wi * oddRe;
        re[i + k] = evenRe + tr;
        im[i + k] = evenIm + ti;
        re[i + k + half] = evenRe - tr;
        im[i + k + half] = evenIm - ti;
      }
    }
  }
}

/**
 * Linear FFT magnitudes from Analyser time-domain floats (Hann window).
 * Matches fingerprint extract path better than getByteFrequencyData (dB/byte).
 */
export function fftLinearMagnitudes(timeDomain: Float32Array): Float32Array {
  const n = timeDomain.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(n - 1, 1)));
    re[i] = timeDomain[i] * hann;
  }
  fftRadix2(re, im);
  const half = n >> 1;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Pearson / mean-centered cosine mapped to [0, 1] — kills flat broadband DC bias. */
function centeredCosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    dot += da * db;
    na += da * da;
    nb += db * db;
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(0, (dot / (Math.sqrt(na) * Math.sqrt(nb)) + 1) / 2);
}

/** Share of energy in upper half of the band vector (bright/gritty vs dull thud). */
export function highBandRatio(vec: number[]): number {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  const upper = vec.slice(16).reduce((s, v) => s + v, 0);
  return upper / total;
}

/**
 * Share of energy in the top third of log-bands.
 * Field #10 (electronics) keeps a strong upper third (~0.33+) even when mic-dulled;
 * teapot #32 (~0.27) and solar #16 (~0.17) do not.
 */
export function upperThirdRatio(vec: number[]): number {
  const n = vec.length;
  if (n === 0) return 0;
  let hi = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += vec[i];
    if (Math.floor((i * 3) / n) >= 2) hi += vec[i];
  }
  return hi / (total || 1e-9);
}

/** Fill log-bands that received zero FFT bins (common at 44.1/48k with coarse fftSize). */
function interpolateEmptyBands(bandVec: number[], bandCounts: number[]): void {
  const n = bandVec.length;
  for (let bi = 0; bi < n; bi++) {
    if (bandCounts[bi] > 0) continue;
    let lo = bi - 1;
    while (lo >= 0 && bandCounts[lo] === 0) lo--;
    let hi = bi + 1;
    while (hi < n && bandCounts[hi] === 0) hi++;
    if (lo >= 0 && hi < n) {
      const t = (bi - lo) / (hi - lo);
      bandVec[bi] = bandVec[lo] * (1 - t) + bandVec[hi] * t;
    } else if (lo >= 0) {
      bandVec[bi] = bandVec[lo];
    } else if (hi < n) {
      bandVec[bi] = bandVec[hi];
    }
  }
}

export function magnitudeToBands(
  magnitudes: Float32Array | Uint8Array,
  sampleRate: number,
  fftSize: number,
  bands = 32,
): number[] {
  const half = magnitudes.length;
  const isByte = magnitudes instanceof Uint8Array;
  const bandVec = new Array(bands).fill(0);
  const bandCounts = new Array(bands).fill(0);
  const minF = 80;
  const maxF = Math.min(sampleRate / 2, 8000);
  for (let i = 1; i < half; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < minF || freq > maxF) continue;
    const t = Math.log(freq / minF) / Math.log(maxF / minF);
    const bi = Math.min(bands - 1, Math.floor(t * bands));
    const mag = isByte
      ? byteToLinearMag((magnitudes as Uint8Array)[i])
      : (magnitudes as Float32Array)[i];
    bandVec[bi] += mag;
    bandCounts[bi] += 1;
  }
  // Average bins per log-band — raw += inflates highs (many more FFT bins).
  for (let bi = 0; bi < bands; bi++) {
    if (bandCounts[bi] > 0) bandVec[bi] /= bandCounts[bi];
  }
  interpolateEmptyBands(bandVec, bandCounts);
  const max = Math.max(...bandVec, 1e-9);
  return bandVec.map((v) => v / max);
}

/** Spectral centroid restricted to fingerprint Nyquist band (50–11025 Hz). */
export function spectralCentroidHz(
  magnitudes: Float32Array | Uint8Array,
  sampleRate: number,
  fftSize: number,
): number {
  const isByte = magnitudes instanceof Uint8Array;
  let num = 0;
  let den = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < CENTROID_MIN_HZ || freq > FP_NYQUIST_HZ) continue;
    const mag = isByte
      ? byteToLinearMag((magnitudes as Uint8Array)[i])
      : (magnitudes as Float32Array)[i];
    num += freq * mag;
    den += mag;
  }
  if (den <= 0) return 0;
  return Math.min(FP_NYQUIST_HZ, Math.max(CENTROID_MIN_HZ, num / den));
}

/** Items valid for a given cargo size + price (and optional cargo type). */
export function filterItemsByCargo(
  items: MerchantItem[],
  opts: { size?: string; cargoPrice?: number; cargoType?: string },
): MerchantItem[] {
  return items.filter((item) => {
    if (opts.size && item.size !== opts.size) return false;
    if (opts.cargoPrice == null && !opts.cargoType) return true;
    return item.sources.some((s) => {
      if (opts.cargoPrice != null && s.cargoPrice !== opts.cargoPrice) return false;
      if (opts.cargoType && s.cargoType !== opts.cargoType) return false;
      return true;
    });
  });
}

/**
 * Field-confirmed near-twins in cosine space. When spike majority agrees on one
 * side of the pair, allow a tighter lock gap (2pt) so #8 vs #2 / #9 vs #5 / etc.
 * do not force endless re-moves.
 */
export const KNOWN_NEAR_TWIN_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [2, 8],
  [3, 23],
  [5, 9],
  [8, 14],
  [8, 20],
  [14, 20],
  [21, 36],
  [27, 35],
  [30, 31],
];

export function isKnownNearTwin(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return KNOWN_NEAR_TWIN_PAIRS.some(([x, y]) => x === lo && y === hi);
}

/**
 * Soft-lock gate for GoldChain (#33) over Coin (#29).
 * Field #33 often ~93 vs ~91 (2pt); true #29 self-locks with a clearer ≥5pt lead.
 */
export function isGoldChainVsCoinSoftLock(
  topSoundId: number,
  runnerSoundId: number | undefined,
  topConfidence: number,
): boolean {
  return (
    topSoundId === 33 &&
    runnerSoundId === 29 &&
    topConfidence >= 92
  );
}

/**
 * One-way (directed) confusion: dull/neighbor sink IDs that steal the true
 * promoteId when it is close in rank. Append rows as field confirms pairs —
 * do not seed hypotheticals (#24→#15 etc.).
 */
export interface DirectedSinkOverride {
  sinkId: number;
  promoteId: number;
  /** Max confidence gap (sink − promote) still eligible for promotion. */
  maxGapPts: number;
  /** Optional: only fire promote when live centroid is above this (Hz). */
  minCentroidHz?: number;
  /** How deep to search for promoteId (default 3). */
  topN?: number;
  /**
   * Refuse to lock this sink below this confidence (true self-locks are ~96%+).
   * Does **not** require minCentroidHz — quiet captures often lose brightness
   * and would otherwise skip the reject (#19 → #28 @ 68%).
   */
  rejectLockBelow?: number;
  /** Only promote when live centroid is clearly closer to promote FP than sink FP. */
  requireCloserCentroid?: boolean;
}

/**
 * Field-confirmed directed sinks (promote still needs centroid gate + rank).
 * Reject-below fires on low-conf sink tops even when promote is absent.
 * Brent: true #31/#5/#28 self-lock ~96–99% — weak field tops on those IDs are not “really X”.
 */
export const DIRECTED_SINK_OVERRIDES: ReadonlyArray<DirectedSinkOverride> = [
  {
    sinkId: 28,
    promoteId: 19,
    maxGapPts: 15,
    minCentroidHz: 2900,
    topN: 12,
    rejectLockBelow: 80,
    requireCloserCentroid: true,
  },
  {
    sinkId: 31,
    promoteId: 6,
    maxGapPts: 8,
    // Above typical true-#31 re-extract drift (~2.3k); true #6 FP ~2466.
    minCentroidHz: 2420,
    topN: 12,
    rejectLockBelow: 94,
    requireCloserCentroid: true,
  },
  {
    sinkId: 5,
    promoteId: 9,
    maxGapPts: 10,
    minCentroidHz: 3600,
    topN: 12,
    rejectLockBelow: 94,
    requireCloserCentroid: true,
  },
];

/**
 * If the top match is a known sink and `promoteId` is within topN / maxGapPts
 * (and optional centroid gate), move promote to rank 0.
 * Pure re-order — does not invent scores or replace majority voting.
 */
export function resolveDirectedSinks(
  matches: MatchResult[],
  capturedCentroid?: number,
  overrides: ReadonlyArray<DirectedSinkOverride> = DIRECTED_SINK_OVERRIDES,
): MatchResult[] {
  if (matches.length < 2 || overrides.length === 0) return matches;
  const top = matches[0];

  for (const rule of overrides) {
    if (top.soundId !== rule.sinkId) continue;
    if (
      rule.minCentroidHz != null &&
      (capturedCentroid == null || !(capturedCentroid > rule.minCentroidHz))
    ) {
      continue;
    }
    const depth = Math.max(1, rule.topN ?? 3);
    const promote = matches.slice(0, depth).find((m) => m.soundId === rule.promoteId);
    if (!promote) continue;
    const gap = top.confidence - promote.confidence;
    if (gap > rule.maxGapPts) continue;
    if (
      rule.requireCloserCentroid &&
      capturedCentroid != null &&
      top.spectralCentroid > 0 &&
      promote.spectralCentroid > 0
    ) {
      const dSink = Math.abs(capturedCentroid - top.spectralCentroid);
      const dProm = Math.abs(capturedCentroid - promote.spectralCentroid);
      // Promote must be clearly closer in pitch (≥120 Hz).
      if (!(dProm + 120 < dSink)) continue;
    }
    return [promote, ...matches.filter((m) => m.soundId !== rule.promoteId)];
  }
  return matches;
}

/**
 * Refuse locking a dull/confused sink at low confidence when the true ID often
 * never ranks (field #19 → #28 @ 68%; #6 → #31 @ 93% with #6 absent).
 * True self-locks for these sinks are ~96%+ — safe to demand a louder retry.
 */
export function directedSinkRejectReason(
  top: MatchResult,
  _capturedCentroid?: number,
  overrides: ReadonlyArray<DirectedSinkOverride> = DIRECTED_SINK_OVERRIDES,
): string | null {
  for (const rule of overrides) {
    if (rule.rejectLockBelow == null) continue;
    if (top.soundId !== rule.sinkId) continue;
    if (top.confidence >= rule.rejectLockBelow) continue;
    return `Stop & Match: Group #${rule.sinkId} @ ${top.confidence}% is a weak/dull sink lock (often #${rule.promoteId}). Move louder/closer and retry — do not treat this as a lock.`;
  }
  return null;
}

/** Dull sinks that steal brighter cargo when live pitch is still crisp. */
const DULL_SINK_IDS = new Set([7, 28, 31]);

/**
 * When the live centroid strongly disagrees with the top fingerprint’s pitch,
 * promote a nearer-centroid candidate (field: #31/#28 dull vs #6 bright,
 * #5/#1 vs #9, #21 vs #5, #30 vs #4). Prefer pitch over blind ID overrides.
 */
export function resolveCentroidDisagreement(
  matches: MatchResult[],
  capturedCentroid?: number,
): MatchResult[] {
  if (capturedCentroid == null || matches.length < 2) return matches;
  const top = matches[0];
  if (!(top.spectralCentroid > 0)) return matches;
  const topDelta = Math.abs(capturedCentroid - top.spectralCentroid);
  const dullTop =
    DULL_SINK_IDS.has(top.soundId) &&
    capturedCentroid > top.spectralCentroid + 400;
  // Top already pitch-aligned — leave ranking alone (unless dull sink on clearly brighter live).
  if (topDelta < 400 && !dullTop) return matches;

  const searchN = Math.min(matches.length, 14);
  let best = top;
  let bestDelta = topDelta;
  for (let i = 0; i < searchN; i++) {
    const m = matches[i];
    if (!(m.spectralCentroid > 0)) continue;
    const d = Math.abs(capturedCentroid - m.spectralCentroid);
    const needCloser = dullTop ? 200 : 250;
    if (d + needCloser < bestDelta) {
      best = m;
      bestDelta = d;
    }
  }
  if (best.soundId === top.soundId) return matches;
  const gap = top.confidence - best.confidence;
  const maxGap = dullTop
    ? 22
    : topDelta >= 900
      ? 22
      : topDelta >= 650
        ? 16
        : 10;
  if (gap > maxGap) return matches;
  return [best, ...matches.filter((m) => m.soundId !== best.soundId)];
}

/**
 * Exact-sound near-tie: if runner is within maxGapPts and live pitch is clearly
 * closer to the runner FP than the top FP, promote the runner.
 * Field #6: #31 @93.7 vs #6 @92.6 with brighter live → lock #6.
 */
export function promotePitchCloserRunner(
  matches: MatchResult[],
  capturedCentroid?: number,
  maxGapPts = 2.5,
): MatchResult[] {
  if (capturedCentroid == null || matches.length < 2) return matches;
  const top = matches[0];
  const runner = matches[1];
  if (!(top.spectralCentroid > 0) || !(runner.spectralCentroid > 0)) return matches;
  const gap = top.confidence - runner.confidence;
  if (gap < 0 || gap > maxGapPts) return matches;
  const dTop = Math.abs(capturedCentroid - top.spectralCentroid);
  const dRun = Math.abs(capturedCentroid - runner.spectralCentroid);
  if (!(dRun + 80 < dTop)) return matches;
  return [runner, top, ...matches.slice(2)];
}

/** Match → pitch prior → directed sinks → near-tie pitch runner (burst + Self-Test). */
export function rankMatchesWithPriors(
  matches: MatchResult[],
  capturedCentroid?: number,
): MatchResult[] {
  return promotePitchCloserRunner(
    resolveDirectedSinks(
      resolveCentroidDisagreement(matches, capturedCentroid),
      capturedCentroid,
    ),
    capturedCentroid,
  );
}

/** Hard refuse dull statue sink locks that aren't real self-locks (~96%+). */
export function hardRejectDullSink(top: MatchResult): string | null {
  // Always block — must run on the *final* top immediately before lock (pitchLock
  // previously bypassed this and locked #28 @ 75.9% after residual had promoted #19).
  if (top.soundId === 28 && top.confidence < 80) {
    return `Stop & Match: Group #28 @ ${top.confidence}% is too weak to lock (true #28 self-locks ~96%). Quiet toolbox is often #19 — move louder/closer or retry.`;
  }
  return null;
}

/**
 * Dull sinks that steal quiet toolbox (#19) when it lands soft in-game.
 * Do **not** include #31 (Desk Clock) — long clock clicks score mid-dull and
 * were getting residual-promoted to #19 when a lobe was windowed alone.
 * True #31↔#6 confusion stays on {@link DIRECTED_SINK_OVERRIDES}.
 */
const QUIET19_DULL_SINKS = new Set([28, 2, 7]);
/** Mid wood/blunt cluster that quiet #19 drifts into (#14/#2 field, #20 WAV). */
const QUIET19_WOOD_CLUSTER = new Set([2, 8, 14, 17, 20, 30]);

/**
 * Residual quiet toolbox (#19): in-game / sample material is genuinely dull — not just
 * a bad mic take. Do **not** map all dull audio to #19.
 *
 * Promote #19 when nothing else self-locks hard (≥92%) and:
 * - weak dull sink (&lt;88%), especially #28 &lt;80% regardless of centroid, OR
 * - mid wood-cluster (&lt;85%) with live centroid in quiet-container band (~2.3–3.8 kHz)
 *   and modest highBand (field: #14@80 vs #2@79).
 */
/**
 * Residual #19 display/lock confidence: at least 78, and ≥1pt above the best
 * non-19 runner so a floored 78 cannot sit behind #2/#14 @ 78.2+.
 */
export function quiet19ResidualConfidence(
  m19Confidence: number,
  bestOtherConfidence: number | undefined,
): number {
  const floor = 78;
  const aboveRunner =
    bestOtherConfidence != null ? bestOtherConfidence + 1 : floor;
  return Math.max(m19Confidence, floor, aboveRunner);
}

export function resolveQuiet19Residual(
  matches: MatchResult[],
  capturedCentroid?: number,
  capturedHighRatio?: number,
): MatchResult[] {
  if (matches.length === 0) return matches;
  const top = matches[0];
  if (top.soundId === 19) {
    // Already #19 on top (often floored soft residual): mark + beat runner.
    // Field: #19@78 vs #2/#14@78.2+ previously stayed ambiguous even with 0pt margin.
    if (top.confidence <= 80 || top.quiet19Residual) {
      const rest = matches.slice(1);
      const bestOther =
        rest.length > 0
          ? rest.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).confidence
          : undefined;
      return [
        {
          ...top,
          confidence: quiet19ResidualConfidence(top.confidence, bestOther),
          quiet19Residual: true,
        },
        ...rest,
      ];
    }
    return matches;
  }
  // Never override a hard self-lock (pristine #28/#2/#6/#20 stay put).
  if (top.confidence >= 92) return matches;

  // Desk Clock (#31) is long/multi-lobe. A decay window often tops as wood/#2 then
  // quiet-19 steals — while #31 is still close in rank on the clock centroid band.
  const m31 = matches.find((m) => m.soundId === 31);
  if (
    m31 &&
    m31.confidence >= 82 &&
    top.confidence - m31.confidence <= 10 &&
    capturedCentroid != null &&
    capturedCentroid >= 1900 &&
    capturedCentroid <= 2700
  ) {
    if (top.soundId !== 31 && top.confidence - m31.confidence <= 5) {
      return [m31, ...matches.filter((m) => m.soundId !== 31)];
    }
    return matches;
  }

  const bestOther = matches.reduce((a, b) =>
    a.soundId === 19 ? b : b.soundId === 19 ? a : a.confidence >= b.confidence ? a : b,
  );
  const nothingStrong = bestOther.soundId === 19 || bestOther.confidence < 92;

  const dullWeak =
    QUIET19_DULL_SINKS.has(top.soundId) && top.confidence < 88;
  // #28 below 80 is never a real self-lock — residual even if centroid is statue-dull.
  const weak28 =
    top.soundId === 28 && top.confidence < 80 && nothingStrong;
  const midCent =
    capturedCentroid != null &&
    capturedCentroid >= 2300 &&
    capturedCentroid <= 3800;
  const modestHigh =
    capturedHighRatio == null || capturedHighRatio < 0.38;
  // <93 catches toolbox WAVs topping #20@~91; field #14@~80 also fits.
  const woodWeakMid =
    QUIET19_WOOD_CLUSTER.has(top.soundId) &&
    top.confidence < 93 &&
    midCent &&
    modestHigh &&
    nothingStrong;

  const dullBandResidual =
    dullWeak &&
    nothingStrong &&
    (capturedCentroid == null ||
      weak28 ||
      (capturedCentroid >= 2000 && capturedCentroid <= 4000));

  if (!weak28 && !dullBandResidual && !woodWeakMid) return matches;

  const m19 = matches.find((m) => m.soundId === 19);
  if (!m19) return matches;
  const others = matches.filter((m) => m.soundId !== 19);
  const bestRunnerConf =
    others.length > 0
      ? others.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).confidence
      : undefined;
  // Floor + beat runner so lock margin / UI show a clear #19 lead.
  const promoted: MatchResult = {
    ...m19,
    confidence: quiet19ResidualConfidence(m19.confidence, bestRunnerConf),
    quiet19Residual: true,
  };
  return [promoted, ...others];
}

/**
 * Field electronics (#10): in-game / loopback often lands ~3.3–3.6 kHz with a strong
 * upper-third band, while the OGG FP is ~4.6 kHz. Centroid prior then buries #10 under
 * weak #32/#21/#34 tops (~76–79%) even though #10 shape cosine stays ~0.92 and true
 * teapot/solar self-lock at ≥95%.
 *
 * Promote #10 when:
 * - nothing else self-locks hard (≥90%),
 * - upper-third energy ≥0.30 (separates from #32 ~0.27 / #16 ~0.17),
 * - highBand in dulled-electronics band (~0.52–0.75),
 * - raw shape cosine vs #10 FP ≥0.84.
 */
export function resolveField10Residual(
  matches: MatchResult[],
  spectrumVector: number[] | undefined,
  fingerprints: FingerprintsFile,
  capturedHighRatio?: number,
): MatchResult[] {
  if (!spectrumVector || matches.length === 0) return matches;
  const top = matches[0];
  if (top.soundId === 10) {
    if (top.field10Residual || top.confidence <= 88) {
      const rest = matches.slice(1);
      const bestOther =
        rest.length > 0
          ? rest.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).confidence
          : undefined;
      return [
        {
          ...top,
          confidence: Math.max(top.confidence, 78, (bestOther ?? 0) + 1),
          field10Residual: true,
        },
        ...rest,
      ];
    }
    return matches;
  }
  if (top.confidence >= 90) return matches;

  const hi3 = upperThirdRatio(spectrumVector);
  if (hi3 < 0.3) return matches;
  const high =
    capturedHighRatio ?? highBandRatio(spectrumVector);
  if (high < 0.52 || high > 0.78) return matches;

  const fp10 = fingerprints.fingerprints['10']?.pickup;
  if (!fp10?.spectrumVector) return matches;
  const shape = cosineSimilarity(spectrumVector, fp10.spectrumVector);
  if (shape < 0.84) return matches;

  const shapeConf = Math.round(shape * 1000) / 10;
  const m10 = matches.find((m) => m.soundId === 10);
  const others = matches.filter((m) => m.soundId !== 10);
  const bestRunner =
    others.length > 0
      ? others.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).confidence
      : undefined;
  const promoted: MatchResult = {
    soundId: 10,
    confidence: Math.max(
      m10?.confidence ?? 0,
      shapeConf,
      78,
      (bestRunner ?? 0) + 1,
    ),
    kind: 'pickup',
    items: m10?.items ?? [],
    spectralCentroid: fp10.spectralCentroid,
    spectrumVector: m10?.spectrumVector,
    capturedCentroid: m10?.capturedCentroid,
    field10Residual: true,
  };
  return [promoted, ...others];
}

/**
 * PCM live300 window — same onset+~300ms bin-average as fingerprint extract /
 * offline selftest, using {@link fftLinearMagnitudes} at the given sample rate.
 * Prefer this for browser Self-Test (AnalyserNode seek/ring-buffer averages diverge).
 */
export function analyzePcmLive300Window(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number,
  bands = 32,
): { spectrumVector: number[]; centroid: number; onsetMs: number; frames: number } {
  const hopEnv = Math.max(1, Math.floor(sampleRate * 0.01));
  const envelope: number[] = [];
  for (let i = 0; i + hopEnv <= samples.length; i += hopEnv) {
    let sum = 0;
    for (let k = 0; k < hopEnv; k++) {
      const v = samples[i + k];
      sum += v * v;
    }
    envelope.push(Math.sqrt(sum / hopEnv));
  }
  let maxRms = 0;
  for (const r of envelope) maxRms = Math.max(maxRms, r);
  const floor = Math.max(0.02, maxRms * 0.25);
  let onset = 0;
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] >= floor) {
      onset = i * hopEnv;
      break;
    }
  }

  const sliceSamples = Math.floor((300 / 1000) * sampleRate);
  const end = Math.min(samples.length, onset + sliceSamples);
  // Denser hops on short pickups (#19 ~220ms) so 48k/4096 still captures attack.
  const hop = Math.max(
    1,
    Math.floor(fftSize / (end - onset < fftSize * 2 ? 8 : 4)),
  );
  const bandAccum = new Array(bands).fill(0);
  const centroids: number[] = [];
  let frames = 0;
  const scratch = new Float32Array(fftSize);

  for (let start = onset; start + fftSize <= end; start += hop) {
    for (let i = 0; i < fftSize; i++) scratch[i] = samples[start + i] || 0;
    const linMag = fftLinearMagnitudes(scratch);
    const frameBands = magnitudeToBands(linMag, sampleRate, fftSize, bands);
    for (let i = 0; i < bands; i++) bandAccum[i] += frameBands[i];
    centroids.push(spectralCentroidHz(linMag, sampleRate, fftSize));
    frames += 1;
  }
  if (frames === 0) {
    // Allow a slightly pre-onset frame when the clip is shorter than fftSize.
    const start = Math.max(0, Math.min(onset, Math.max(0, samples.length - fftSize)));
    for (let i = 0; i < fftSize; i++) scratch[i] = samples[start + i] || 0;
    const linMag = fftLinearMagnitudes(scratch);
    const frameBands = magnitudeToBands(linMag, sampleRate, fftSize, bands);
    for (let i = 0; i < bands; i++) bandAccum[i] = frameBands[i];
    centroids.push(spectralCentroidHz(linMag, sampleRate, fftSize));
    frames = 1;
  }

  for (let i = 0; i < bands; i++) bandAccum[i] /= frames;
  const max = Math.max(...bandAccum, 1e-9);
  return {
    spectrumVector: bandAccum.map((v) => v / max),
    centroid: centroids.reduce((a, b) => a + b, 0) / centroids.length,
    onsetMs: (onset / sampleRate) * 1000,
    frames,
  };
}

export function matchSpectrumAgainstFingerprints(
  spectrumVector: number[],
  fingerprints: FingerprintsFile,
  candidateSoundIds: number[],
  kind: SoundKind | 'auto' = 'pickup',
  capturedCentroid?: number,
): MatchResult[] {
  const results: MatchResult[] = [];
  // Field Merchant: players only hear pickup. Default / 'auto' → pickup only.
  const kinds: SoundKind[] =
    kind === 'drop' ? ['drop'] : kind === 'auto' ? ['pickup'] : [kind];
  const capturedHighRatio = highBandRatio(spectrumVector);

  for (const soundId of candidateSoundIds) {
    const fp = fingerprints.fingerprints[String(soundId)];
    if (!fp) continue;
    for (const k of kinds) {
      const side = fp[k];
      if (!side?.spectrumVector) continue;

      const rawCos = cosineSimilarity(spectrumVector, side.spectrumVector);
      const shapeCos = centeredCosine(spectrumVector, side.spectrumVector);
      const fpHighRatio = highBandRatio(side.spectrumVector);
      // Penalize dark/bass (#4 ~0.35) vs bright/gritty (#5 ~0.68) tilt mismatches.
      const tiltPenalty = Math.max(0, 1 - Math.abs(capturedHighRatio - fpHighRatio) * 1.8);

      let score = rawCos * 0.45 + shapeCos * 0.35 + tiltPenalty * 0.2;

      // Centroid prior — slightly tighter than 1500/0.25; heavy pitch breaks use
      // {@link resolveCentroidDisagreement} so we don't overturn clean self-matches.
      // #10 (electronics): field mic often lands ~3.3–3.6 kHz vs FP ~4.6 kHz — use a
      // wider prior so shape can still surface #10 before {@link resolveField10Residual}.
      if (capturedCentroid != null && side.spectralCentroid) {
        const delta = Math.abs(capturedCentroid - side.spectralCentroid);
        if (soundId === 10) {
          const prior = Math.max(0, 1 - delta / 2000);
          score = score * 0.8 + prior * 0.2;
        } else {
          const prior = Math.max(0, 1 - delta / 1400);
          score = score * 0.72 + prior * 0.28;
        }
      }

      results.push({
        soundId,
        confidence: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 10,
        kind: k,
        items: [],
        spectralCentroid: side.spectralCentroid,
      });
    }
  }

  // Keep best kind per soundId
  const bestBySound = new Map<number, MatchResult>();
  for (const r of results) {
    const prev = bestBySound.get(r.soundId);
    if (!prev || r.confidence > prev.confidence) bestBySound.set(r.soundId, r);
  }
  return Array.from(bestBySound.values()).sort((a, b) => b.confidence - a.confidence);
}

export class AudioMatcher {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastTrigger = 0;
  private status: MatcherStatus = 'idle';
  private noiseFloor: number;
  private sliceMs: number;
  private cooldownMs: number;
  private kind: SoundKind | 'auto';
  private focusGraceMs: number;
  private focusBlockUntil = 0;
  private startGraceUntil = 0;
  private listeningPaused = false;
  private captureSource: CaptureSourceKind | null = null;
  private sensitivityLevel: SensitivityLevel;
  private fluxThreshold: number;
  private minConfidence: number;
  private startGraceMs: number;
  private peakWindowMs: [number, number];
  /** Rolling quiet-baseline RMS for transient (flux) detection. */
  private rmsBaseline = 0;
  /**
   * When false (default after Start Listening), auto-onset is muted — raid noise ignored.
   * Opened by setAtShop(true) after ~500ms shop-idle calibration (burst-ready).
   * Auto-onset still requires `autoDetectArmed` (off by default — burst-only primary).
   */
  private atShopGate = false;
  /** Explicit opt-in; heal/ambient must not lock while merely “At Shop”. */
  private autoDetectArmed = false;
  /**
   * Base lock margin for weak tops. Strong tops use a lower bar via
   * {@link lockMarginRequired}. Field: #1 often lands ~94–97% with a runner
   * ~4–5pts behind (#5/#25) — flat 5–8pt rules refused correct locks.
   */
  private autoMarginPts = 8;
  /** Last burst top ID — second consecutive same top with ≥3pt gap can lock. */
  private lastBurstTopId: number | null = null;

  /**
   * Adaptive gap: high confidence → smaller required margin.
   * Near-twin runners stay stricter; non-twins (e.g. #35 vs #21) soften so a
   * clear 3pt lead can lock instead of demanding 8.
   */
  private lockMarginRequired(
    topConfidence: number,
    opts?: {
      nearTwinMajority?: boolean;
      runnerIsNearTwin?: boolean;
      /** Quiet #19 residual — skip margin so floored ~78% can lock vs ~77–78% runners. */
      quiet19Residual?: boolean;
      /** Field #10 electronics residual — skip margin after promote. */
      field10Residual?: boolean;
      /**
       * GoldChain #33 vs Coin #29: field #33 often ~93 vs ~91 (2pt) while true #29
       * self-locks with ≥5pt — allow 2pt when #33 is clearly on top (≥92).
       */
      goldChainVsCoin?: boolean;
    },
  ): number {
    // Residual #19 / field #10: margin skipped (force-lock path).
    if (opts?.quiet19Residual || opts?.field10Residual) return 0;
    if (opts?.goldChainVsCoin) return 2;
    if (opts?.nearTwinMajority) return 2;
    const twin = opts?.runnerIsNearTwin === true;
    if (topConfidence >= 94) return twin ? 3 : 2;
    if (topConfidence >= 88) return twin ? 4 : 3;
    if (topConfidence >= 82) return twin ? 5 : 3;
    return twin ? this.autoMarginPts : 5;
  }
  private shopPhase: ShopPhase = 'in-raid';
  private shopCalibrating = false;
  private burstRecording = false;
  private burstFrames: BurstFrame[] = [];
  private burstStartedAt = 0;
  /** Continuous mono PCM while Start Moving Item → Stop & Match. */
  private burstPcmChunks: Float32Array[] = [];
  /** Backup PCM from AnalyserNode time-domain hops when ScriptProcessor tee is empty. */
  private burstAnalyserPcmChunks: Float32Array[] = [];
  private burstProcessor: ScriptProcessorNode | null = null;
  /** Zero-gain → destination keeps ScriptProcessor alive without audible output. */
  private burstMute: GainNode | null = null;
  /** Dual+Multi: count spikes → auto Stop & Match (same pcm300 path). */
  private multiContinuousArmed = false;
  private multiSpikeCount = 0;
  private multiLastSpikeAt = 0;
  private multiPrevRms = 0;
  private multiFinalizing = false;
  private multiCooldownUntil = 0;
  private onStatus?: (s: MatcherStatus, detail?: string) => void;
  private onMatch?: (payload: MatchPayload) => void;
  private onMultiProgress?: (p: MultiScanProgress) => void;
  private fingerprints: FingerprintsFile;
  private candidateSoundIds: number[] = [];
  private onFocusBound = () => this.armFocusGrace();

  constructor(
    fingerprints: FingerprintsFile,
    opts: MatcherOptions = {},
  ) {
    this.fingerprints = fingerprints;
    this.sensitivityLevel = opts.sensitivity ?? 'med';
    const preset = presetFor(this.sensitivityLevel, null);
    this.noiseFloor = opts.noiseFloor ?? preset.noiseFloor;
    this.fluxThreshold = preset.fluxThreshold;
    this.minConfidence = preset.minConfidence;
    this.startGraceMs = preset.startGraceMs;
    this.peakWindowMs = preset.peakWindowMs;
    this.sliceMs = opts.sliceMs ?? 300;
    this.cooldownMs = opts.cooldownMs ?? 800;
    this.kind = opts.kind ?? fingerprints.matchSide ?? 'pickup';
    this.focusGraceMs = opts.focusGraceMs ?? 0;
  }

  setCallbacks(cbs: {
    onStatus?: (s: MatcherStatus, detail?: string) => void;
    onMatch?: (payload: MatchPayload) => void;
    onMultiProgress?: (p: MultiScanProgress) => void;
  }) {
    this.onStatus = cbs.onStatus;
    this.onMatch = cbs.onMatch;
    this.onMultiProgress = cbs.onMultiProgress;
  }

  isMultiContinuousArmed() {
    return this.multiContinuousArmed;
  }

  getMultiSpikeCount() {
    return this.multiSpikeCount;
  }

  private emitMultiProgress(phase: MultiScanPhase, detail?: string) {
    this.onMultiProgress?.({
      spikeCount: this.multiSpikeCount,
      targetN: MULTI_SPIKE_TARGET_N,
      phase,
      detail,
    });
  }

  private clearMultiState() {
    this.multiContinuousArmed = false;
    this.multiSpikeCount = 0;
    this.multiLastSpikeAt = 0;
    this.multiPrevRms = 0;
    this.multiFinalizing = false;
    this.multiCooldownUntil = 0;
  }

  setCandidates(soundIds: number[]) {
    this.candidateSoundIds = soundIds;
  }

  setNoiseFloor(v: number) {
    this.noiseFloor = v;
  }

  setCooldownMs(v: number) {
    this.cooldownMs = v;
  }

  setFocusGraceMs(v: number) {
    this.focusGraceMs = v;
  }

  /** Apply Low/Med/High; mic/loopback uses one notch stricter effective preset. */
  setSensitivity(level: SensitivityLevel) {
    this.sensitivityLevel = level;
    this.applyPreset(presetFor(level, this.captureSource));
  }

  getSensitivity() {
    return this.sensitivityLevel;
  }

  getMinConfidence() {
    return this.minConfidence;
  }

  private applyPreset(preset: SensitivityPreset) {
    this.noiseFloor = preset.noiseFloor;
    this.fluxThreshold = preset.fluxThreshold;
    this.minConfidence = preset.minConfidence;
    this.startGraceMs = preset.startGraceMs;
    this.peakWindowMs = preset.peakWindowMs;
  }

  /** Pause onset detection (single-item lock) without tearing down the stream. */
  setListeningPaused(paused: boolean) {
    this.listeningPaused = paused;
    if (paused) return;
    // Continuous / after-lock polish: always unlock shopPhase even when status is
    // still `done` (or already `listening` with a sticky locked phase).
    if (this.shopPhase === 'locked') {
      this.shopPhase = this.atShopGate ? 'at-shop' : 'in-raid';
    }
    if (this.analyser && this.status !== 'capturing' && this.status !== 'matching') {
      this.resumeListening();
    }
  }

  isListeningPaused() {
    return this.listeningPaused;
  }

  getStatus() {
    return this.status;
  }

  getCaptureSource() {
    return this.captureSource;
  }

  isAtShopGate() {
    return this.atShopGate;
  }

  isAutoDetectArmed() {
    return this.autoDetectArmed;
  }

  isBurstRecording() {
    return this.burstRecording;
  }

  getShopPhase() {
    return this.shopPhase;
  }

  /** Opt-in auto-onset while At Shop. Off by default — burst Move/Match is primary. */
  setAutoDetectArmed(on: boolean) {
    this.autoDetectArmed = on;
    if (!this.analyser) return;
    if (on && this.atShopGate) {
      this.listeningPaused = false;
      this.shopPhase = 'at-shop';
      this.resumeListening(
        `At Shop · auto-detect ARMED (gap scales with confidence) — or use Move Item`,
      );
    } else if (this.atShopGate) {
      this.listeningPaused = true;
      this.shopPhase = 'at-shop';
      this.setStatus(
        'listening',
        'At Shop · burst-only (auto-detect off) — Start Moving Item, then Stop & Match',
      );
    }
  }

  private armFocusGrace() {
    if (this.focusGraceMs > 0) {
      this.focusBlockUntil = performance.now() + this.focusGraceMs;
    }
  }

  private setStatus(s: MatcherStatus, detail?: string) {
    this.status = s;
    this.onStatus?.(s, detail);
  }

  private shopStatusDetail(): string {
    switch (this.shopPhase) {
      case 'calibrating':
        return 'At Shop (calibrating)… sampling idle ~500ms';
      case 'at-shop':
        if (!this.atShopGate) return 'At Shop';
        return this.autoDetectArmed
          ? `At Shop · auto-detect ARMED · baseline ${this.rmsBaseline.toFixed(3)}`
          : `At Shop · burst-only · baseline ${this.rmsBaseline.toFixed(3)} — Start Moving Item`;
      case 'recording':
        return 'Recording moves… drag the same Mystery Cargo a few times, then Stop & Match';
      case 'locked':
        return 'Locked Group — give 👍 / 👎 or skip';
      case 'in-raid':
      default:
        return 'In Raid (gate closed / listening paused) — click At Shop at the merchant';
    }
  }

  /** Always surfaces status — never silently return when paused. */
  private surfaceListening(detail: string) {
    if (!this.analyser) return;
    if (this.shopPhase === 'recording') return;
    this.setStatus('listening', detail);
  }

  private resumeListening(detail?: string) {
    if (!this.analyser) return;
    if (this.shopPhase === 'recording') return;
    if (this.atShopGate && this.shopPhase !== 'locked') this.shopPhase = 'at-shop';
    if (!this.atShopGate) this.shopPhase = 'in-raid';
    // Burst-only default: stay paused unless auto-detect is armed.
    if (this.atShopGate && !this.autoDetectArmed) this.listeningPaused = true;
    this.setStatus('listening', detail ?? this.shopStatusDetail());
  }

  /**
   * At Shop toggle. Off → gate closed + pause listening. On → ~500ms idle calibrate;
   * burst-ready (auto-detect stays off unless armed).
   */
  async setAtShop(on: boolean): Promise<void> {
    if (!this.analyser || !this.ctx) {
      throw new Error('Start Listening first, then click At Shop at the Field Merchant.');
    }
    if (!on) {
      this.atShopGate = false;
      this.autoDetectArmed = false;
      this.shopCalibrating = false;
      this.burstRecording = false;
      this.burstFrames = [];
      this.lastBurstTopId = null;
      this.clearMultiState();
      this.stopBurstPcmCapture();
      this.listeningPaused = true;
      this.shopPhase = 'in-raid';
      this.emitMultiProgress('idle');
      this.surfaceListening(
        'In Raid (gate closed) — listening paused. Click At Shop when back at the merchant.',
      );
      return;
    }
    await this.calibrateShopIdle();
  }

  /** Sample ~500ms of shop idle; lock baseline + adaptive thresholds; ready for burst. */
  async calibrateShopIdle(sampleMs = 500): Promise<{ baseline: number; noiseFloor: number; flux: number }> {
    if (!this.analyser || !this.ctx) {
      throw new Error('No audio capture — Start Listening first.');
    }
    this.burstRecording = false;
    this.burstFrames = [];
    this.stopBurstPcmCapture();
    this.shopCalibrating = true;
    this.shopPhase = 'calibrating';
    this.atShopGate = false;
    this.setStatus('listening', this.shopStatusDetail());

    const samples: number[] = [];
    const start = performance.now();
    const buf = new Uint8Array(this.analyser.fftSize);
    while (performance.now() - start < sampleMs) {
      this.analyser.getByteTimeDomainData(buf);
      samples.push(this.timeDomainRms(buf));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }

    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1);
    const variance =
      samples.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(samples.length, 1);
    const std = Math.sqrt(variance);
    const preset = presetFor(this.sensitivityLevel, this.captureSource);

    this.rmsBaseline = mean;
    this.noiseFloor = Math.max(preset.noiseFloor * 0.85, mean + std * 2.2, mean * 1.8 + 0.02);
    this.fluxThreshold = Math.max(preset.fluxThreshold * 0.9, std * 2.5, 0.035);
    this.atShopGate = true;
    this.shopCalibrating = false;
    this.shopPhase = 'at-shop';
    this.startGraceUntil = performance.now() + 200;
    // Burst-only until user arms auto-detect.
    this.listeningPaused = !this.autoDetectArmed;
    this.resumeListening();
    return {
      baseline: this.rmsBaseline,
      noiseFloor: this.noiseFloor,
      flux: this.fluxThreshold,
    };
  }

  /** Tee continuous mono PCM off the capture graph (silent gain → speakers). */
  private startBurstPcmCapture(): void {
    this.stopBurstPcmCapture();
    if (!this.ctx || !this.source) return;
    this.burstPcmChunks = [];
    // ScriptProcessor is deprecated but works without a worklet file (GitHub Pages friendly).
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    proc.onaudioprocess = (ev) => {
      if (!this.burstRecording) return;
      const input = ev.inputBuffer.getChannelData(0);
      this.burstPcmChunks.push(new Float32Array(input));
      // Cap ~25s @ 48k to avoid runaway memory
      let samples = 0;
      for (const c of this.burstPcmChunks) samples += c.length;
      while (samples > 48_000 * 25 && this.burstPcmChunks.length > 1) {
        samples -= this.burstPcmChunks.shift()!.length;
      }
    };
    this.source.connect(proc);
    proc.connect(mute);
    mute.connect(this.ctx.destination);
    this.burstProcessor = proc;
    this.burstMute = mute;
  }

  private stopBurstPcmCapture(): {
    samples: Float32Array;
    sampleRate: number;
    blob: Blob | null;
    pcmSource: 'script-processor' | 'analyser-hop' | 'empty';
  } {
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    try {
      this.burstProcessor?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.burstMute?.disconnect();
    } catch {
      /* ignore */
    }
    // Keep MediaStreamSource → Analyser; only tear the PCM tee.
    this.burstProcessor = null;
    this.burstMute = null;
    let samples = concatFloat32(this.burstPcmChunks);
    this.burstPcmChunks = [];
    let pcmSource: 'script-processor' | 'analyser-hop' | 'empty' = 'empty';
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    // ScriptProcessor often stays silent while Analyser still sees audio — use hop PCM.
    if (samples.length < sampleRate * 0.08 || peak < 0.004) {
      const backup = concatFloat32(this.burstAnalyserPcmChunks);
      let backupPeak = 0;
      for (let i = 0; i < backup.length; i++) {
        backupPeak = Math.max(backupPeak, Math.abs(backup[i]));
      }
      if (backup.length >= sampleRate * 0.08 && backupPeak >= 0.004) {
        samples = backup;
        peak = backupPeak;
        pcmSource = 'analyser-hop';
      }
    } else {
      pcmSource = 'script-processor';
    }
    this.burstAnalyserPcmChunks = [];
    const blob = samples.length > 0 ? encodeWavMono(samples, sampleRate) : null;
    return { samples, sampleRate, blob, pcmSource };
  }

  private burstDiag(opts: {
    peakRms: number;
    baseline: number;
    threshold: number;
    frameCount: number;
    spikeCount: number;
    captureDurationMs: number;
  }): string {
    return [
      `peak ${opts.peakRms.toFixed(3)}`,
      `floor ${opts.baseline.toFixed(3)}`,
      `thr ${opts.threshold.toFixed(3)}`,
      `frames ${opts.frameCount}`,
      `spikes ${opts.spikeCount}`,
      `wav ${Math.round(opts.captureDurationMs)}ms`,
    ].join(' · ');
  }

  /** Primary shop workflow: start buffering while user moves one cargo a few times. */
  async startItemMoveBurst(): Promise<void> {
    if (!this.analyser || !this.ctx) {
      throw new Error('Start Listening first.');
    }
    if (!this.atShopGate) {
      await this.calibrateShopIdle();
    }
    this.listeningPaused = true;
    this.burstRecording = true;
    this.burstFrames = [];
    this.burstAnalyserPcmChunks = [];
    this.burstStartedAt = performance.now();
    this.startBurstPcmCapture();
    this.shopPhase = 'recording';
    this.setStatus('capturing', this.shopStatusDetail());
  }

  /**
   * Dual + Multiple Items: arm continuous burst — count cargo moves to N=3
   * (early lock at 2 when majority vote + conf ≥90), then same Stop & Match matcher.
   */
  async startMultiContinuous(): Promise<void> {
    this.multiContinuousArmed = true;
    this.multiSpikeCount = 0;
    this.multiLastSpikeAt = 0;
    this.multiPrevRms = 0;
    this.multiFinalizing = false;
    this.multiCooldownUntil = 0;
    this.autoDetectArmed = false;
    await this.startItemMoveBurst();
    this.emitMultiProgress(
      'armed',
      `Multi armed — move each cargo ${MULTI_SPIKE_TARGET_N}× (always waits for ${MULTI_SPIKE_TARGET_N})`,
    );
    this.setStatus(
      'capturing',
      `Multi scan 0/${MULTI_SPIKE_TARGET_N} — drag cargo ${MULTI_SPIKE_TARGET_N} clean times`,
    );
  }

  /** Disarm Multi continuous (keeps At Shop). Optionally finalize current buffer. */
  async stopMultiContinuous(opts?: { match?: boolean }): Promise<BurstMatchResult | null> {
    const wasArmed = this.multiContinuousArmed;
    this.multiContinuousArmed = false;
    this.multiFinalizing = false;
    this.multiCooldownUntil = 0;
    this.emitMultiProgress('idle', 'Multi disarmed');
    if (!wasArmed && !this.burstRecording) return null;
    if (opts?.match && this.burstRecording) {
      return this.stopItemMoveBurst();
    }
    if (this.burstRecording) {
      this.stopBurstPcmCapture();
      this.burstRecording = false;
      this.burstFrames = [];
      this.burstAnalyserPcmChunks = [];
      this.shopPhase = this.atShopGate ? 'at-shop' : 'in-raid';
      this.listeningPaused = true;
      this.surfaceListening('Multi stopped — still At Shop (burst-ready)');
    }
    return null;
  }

  /** After a Multi lock (or Force Stop & Match), cooldown then listen for the next cargo. */
  async rearmMultiAfterMatch(detail?: string): Promise<void> {
    if (!this.multiContinuousArmed) return;
    this.multiCooldownUntil = performance.now() + MULTI_COOLDOWN_MS;
    this.multiSpikeCount = 0;
    this.multiLastSpikeAt = 0;
    this.multiPrevRms = 0;
    this.emitMultiProgress('cooldown', detail ?? 'Cooldown…');
    await new Promise((r) => setTimeout(r, MULTI_COOLDOWN_MS));
    this.multiCooldownUntil = 0;
    this.multiFinalizing = false;
    if (!this.multiContinuousArmed || !this.atShopGate || !this.analyser) {
      this.emitMultiProgress('idle');
      return;
    }
    this.listeningPaused = true;
    this.burstRecording = true;
    this.burstFrames = [];
    this.burstAnalyserPcmChunks = [];
    this.burstStartedAt = performance.now();
    this.startBurstPcmCapture();
    this.shopPhase = 'recording';
    this.emitMultiProgress(
      'armed',
      `Ready for next cargo — move it ${MULTI_SPIKE_TARGET_N}×`,
    );
    this.setStatus(
      'capturing',
      `Multi scan 0/${MULTI_SPIKE_TARGET_N} — next cargo`,
    );
  }

  private async commitMultiBurst(): Promise<void> {
    if (!this.multiContinuousArmed || this.multiFinalizing) return;
    this.multiFinalizing = true;
    this.emitMultiProgress('matching', `Matching ${this.multiSpikeCount} moves…`);
    try {
      const result = await this.stopItemMoveBurst();
      this.emitMultiProgress(
        result.ok ? 'cooldown' : 'armed',
        result.reason,
      );
      if (!this.multiContinuousArmed) {
        this.multiFinalizing = false;
        return;
      }
      await this.rearmMultiAfterMatch(result.reason);
    } catch (err) {
      this.multiFinalizing = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.emitMultiProgress('armed', msg);
      this.surfaceListening(`Multi match error: ${msg}`);
    }
  }

  private failBurst(partial: Omit<BurstMatchResult, 'ok'>): BurstMatchResult {
    this.shopPhase = 'at-shop';
    this.listeningPaused = true;
    if (!this.multiContinuousArmed) {
      this.autoDetectArmed = false; // don't leave auto open after a failed burst
    }
    this.surfaceListening(partial.reason);
    return { ok: false, ...partial };
  }

  /** Stop burst buffer, isolate loudest transients above shop baseline, average & match. */
  async stopItemMoveBurst(): Promise<BurstMatchResult> {
    const pcm = this.stopBurstPcmCapture();
    const captureDurationMs =
      pcm.sampleRate > 0 ? (pcm.samples.length / pcm.sampleRate) * 1000 : 0;
    const captureBase = {
      captureBlob: pcm.blob,
      captureSampleRate: pcm.sampleRate,
      captureDurationMs,
      captureSamples: pcm.samples.length,
    };
    const empty = {
      matches: [] as MatchResult[],
      frameCount: 0,
      spikeCount: 0,
      peakRms: 0,
      baseline: this.rmsBaseline,
      threshold: 0,
      ...captureBase,
    };
    if (!this.analyser || !this.ctx) {
      return this.failBurst({
        ...empty,
        reason: `Stop & Match failed — audio capture is gone. Start Listening again. (${this.burstDiag({
          peakRms: 0,
          baseline: this.rmsBaseline,
          threshold: 0,
          frameCount: 0,
          spikeCount: 0,
          captureDurationMs,
        })})`,
      });
    }

    this.burstRecording = false;
    const frames = this.burstFrames.slice();
    this.burstFrames = [];
    // Stay paused (burst-only) until a successful lock or user arms auto.
    this.listeningPaused = true;

    const sortedRms = frames.map((f) => f.rms).sort((a, b) => a - b);
    const p20 =
      sortedRms.length > 0
        ? sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.2))]
        : 0;
    const p90 =
      sortedRms.length > 0
        ? sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.9))]
        : 0;
    // Quiet floor from the recording itself: if calibrate ran while the user was
    // already moving (Start Moving without At Shop), rmsBaseline can be inflated.
    // Prefer the quieter of calibrated vs ~p20 of this burst (+10% headroom).
    const effectiveBaseline = Math.min(this.rmsBaseline, p20 * 1.1);
    // Soft spike bar — prefer detecting quiet cargo moves over empty “no-op”.
    const threshold = Math.max(
      effectiveBaseline + Math.max(this.fluxThreshold * 0.2, 0.004),
      effectiveBaseline * 1.12 + 0.003,
      Math.min(p90 * 0.65, effectiveBaseline + 0.04),
    );

    const diagFor = (peakRms: number, spikeCount: number, frameCount = frames.length) =>
      this.burstDiag({
        peakRms,
        baseline: effectiveBaseline,
        threshold,
        frameCount,
        spikeCount,
        captureDurationMs,
      });

    if (frames.length === 0) {
      return this.failBurst({
        ...empty,
        threshold,
        reason: `Stop & Match: no analyser frames buffered. (${diagFor(0, 0, 0)}) Play captured audio below — if silent, mic/loopback isn’t reaching the site.`,
      });
    }

    this.setStatus('matching', `Matching move burst… ${frames.length} frames`);

    const peaks: BurstFrame[] = [];
    for (let i = 1; i < frames.length - 1; i++) {
      const f = frames[i];
      if (f.rms >= threshold && f.rms >= frames[i - 1].rms && f.rms >= frames[i + 1].rms) {
        peaks.push(f);
      }
    }
    peaks.sort((a, b) => b.rms - a.rms);
    // Cap at 3 loudest well-separated spikes — field: 2–3 clicks stabilize;
    // 4–6+ add decay/release tails that swing % and flip near-twins (#20, #35).
    const MAX_SPIKES = 3;
    const chosen: BurstFrame[] = [];
    for (const p of peaks) {
      if (chosen.some((c) => Math.abs(c.t - p.t) < 60)) continue;
      chosen.push(p);
      if (chosen.length >= MAX_SPIKES) break;
    }
    if (!chosen.length) {
      const loud = [...frames].sort((a, b) => b.rms - a.rms);
      for (const f of loud) {
        if (f.rms < threshold) break;
        if (chosen.some((c) => Math.abs(c.t - f.t) < 60)) continue;
        chosen.push(f);
        if (chosen.length >= MAX_SPIKES) break;
      }
    }
    // Always attempt match: take absolute loudest frames even under threshold.
    if (!chosen.length) {
      const loud = [...frames].sort((a, b) => b.rms - a.rms).slice(0, MAX_SPIKES);
      chosen.push(...loud);
    }

    const peakRms = Math.max(...chosen.map((c) => c.rms), ...frames.map((f) => f.rms), 0);
    const quiet = peakRms < effectiveBaseline + 0.003;

    // Align with live300 fingerprints: average frames from ~peak−16ms … peak+280ms
    // (≈300ms post-onset window), not the single peak spectrum alone.
    const LIVE300_PRE_MS = 16;
    const LIVE300_POST_MS = 280;
    const bands = chosen[0].spectrum.length;
    const avg = new Array(bands).fill(0);
    let centroidSum = 0;
    let windowsUsed = 0;

    const candidates =
      this.candidateSoundIds.length > 0
        ? this.candidateSoundIds
        : Object.keys(this.fingerprints.fingerprints).map(Number);

    type SpikeVote = { soundId: number; confidence: number; spectrum: number[]; centroid: number };
    const spikeVotes: SpikeVote[] = [];

    for (const c of chosen) {
      const win = frames.filter(
        (f) => f.t >= c.t - LIVE300_PRE_MS && f.t <= c.t + LIVE300_POST_MS,
      );
      const slice = win.length > 0 ? win : [c];
      const local = new Array(bands).fill(0);
      let localCentroid = 0;
      for (const f of slice) {
        for (let i = 0; i < bands; i++) local[i] += f.spectrum[i] || 0;
        localCentroid += f.centroid;
      }
      for (let i = 0; i < bands; i++) {
        local[i] /= slice.length;
        avg[i] += local[i];
      }
      const spikeCentroid = localCentroid / slice.length;
      centroidSum += spikeCentroid;
      windowsUsed += 1;

      const localMax = Math.max(...local, 1e-9);
      const spikeSpectrum = local.map((v) => v / localMax);
      const spikeRank = rankMatchesWithPriors(
        matchSpectrumAgainstFingerprints(
          spikeSpectrum,
          this.fingerprints,
          candidates,
          this.kind,
          spikeCentroid,
        ),
        spikeCentroid,
      );
      if (spikeRank[0]) {
        spikeVotes.push({
          soundId: spikeRank[0].soundId,
          confidence: spikeRank[0].confidence,
          spectrum: spikeSpectrum,
          centroid: spikeCentroid,
        });
      }
    }
    const denom = Math.max(windowsUsed, 1);
    for (let i = 0; i < bands; i++) avg[i] /= denom;
    const max = Math.max(...avg, 1e-9);
    let spectrumVector = avg.map((v) => v / max);
    let centroid = centroidSum / denom;
    const peakMs = Math.round(peakRms * 1000);

    // Majority vote across spikes — resists one dull/decay window flipping the average.
    const voteCount = new Map<number, { n: number; confSum: number }>();
    for (const v of spikeVotes) {
      const prev = voteCount.get(v.soundId) ?? { n: 0, confSum: 0 };
      prev.n += 1;
      prev.confSum += v.confidence;
      voteCount.set(v.soundId, prev);
    }
    let majorityId: number | null = null;
    let majorityN = 0;
    let majorityConf = 0;
    for (const [id, info] of voteCount) {
      const avgConf = info.confSum / info.n;
      if (
        info.n > majorityN ||
        (info.n === majorityN && avgConf > majorityConf)
      ) {
        majorityId = id;
        majorityN = info.n;
        majorityConf = avgConf;
      }
    }
    const majorityOk = majorityId != null && majorityN >= 2 && majorityN > spikeVotes.length / 2;

    let allMatches = rankMatchesWithPriors(
      matchSpectrumAgainstFingerprints(
        spectrumVector,
        this.fingerprints,
        candidates,
        this.kind,
        centroid,
      ),
      centroid,
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));

    // If spike majority disagrees with averaged top, promote the majority ID
    // (use that spike's spectrum so reported confidence matches the winner).
    if (majorityOk && majorityId != null && allMatches[0]?.soundId !== majorityId) {
      const bestSpike = spikeVotes
        .filter((v) => v.soundId === majorityId)
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (bestSpike) {
        spectrumVector = bestSpike.spectrum;
        centroid = bestSpike.centroid;
        allMatches = rankMatchesWithPriors(
          matchSpectrumAgainstFingerprints(
            spectrumVector,
            this.fingerprints,
            candidates,
            this.kind,
            centroid,
          ),
          centroid,
        ).map((m) => ({
          ...m,
          spectrumVector,
          capturedCentroid: centroid,
        }));
      }
    }

    // Prefer Self-Test-aligned PCM live300 on the burst WAV tee when present.
    // AnalyserNode peak windows were the main exact-OGG vs Self-Test skew (#6/#9/#19).
    let matchSource: 'pcm-live300' | 'analyser-spikes' = 'analyser-spikes';
    const minPcmSamples = Math.floor(pcm.sampleRate * 0.08);
    if (pcm.samples.length >= minPcmSamples) {
      let pcmPeak = 0;
      for (let i = 0; i < pcm.samples.length; i++) {
        const a = Math.abs(pcm.samples[i]);
        if (a > pcmPeak) pcmPeak = a;
      }
      // Low bar — quiet cargo (#19) still needs pcm300; spike fallback was the skew.
      if (pcmPeak >= 0.002) {
        const pcmWin = analyzePcmLive300Window(
          pcm.samples,
          pcm.sampleRate,
          analyserFftSize(pcm.sampleRate),
          this.fingerprints.vectorBands || 32,
        );
        spectrumVector = pcmWin.spectrumVector;
        centroid = pcmWin.centroid;
        allMatches = rankMatchesWithPriors(
          matchSpectrumAgainstFingerprints(
            spectrumVector,
            this.fingerprints,
            candidates,
            this.kind,
            centroid,
          ),
          centroid,
        ).map((m) => ({
          ...m,
          spectrumVector,
          capturedCentroid: centroid,
        }));
        matchSource = 'pcm-live300';
      }
    }

    // Quiet toolbox residual (#19 is dull in-game) — only when nothing else self-locks hard.
    allMatches = resolveQuiet19Residual(
      allMatches,
      centroid,
      highBandRatio(spectrumVector),
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));
    // Field electronics (#10) dulled by mic — promote before weak #32/#21 bury it.
    allMatches = resolveField10Residual(
      allMatches,
      spectrumVector,
      this.fingerprints,
      highBandRatio(spectrumVector),
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));

    const floor = Math.max(48, this.minConfidence - 8);
    const matches = allMatches.filter((m) => m.confidence >= floor);
    let top = matches[0];
    let runner = matches[1] ?? allMatches[1];
    const weak = allMatches[0];
    const stats = diagFor(peakRms, chosen.length);
    // Lead with match source so deploy/path is obvious (Brent: still seeing vote/spikes).
    const sourceNote =
      matchSource === 'pcm-live300'
        ? `pcm300/${pcm.pcmSource}`
        : 'spikes-only';
    const voteNote =
      matchSource === 'pcm-live300'
        ? ` · ${sourceNote}`
        : ` · ${sourceNote}` +
          (majorityOk && majorityId != null
            ? ` · vote ${majorityN}/${spikeVotes.length}→#${majorityId}`
            : spikeVotes.length
              ? ` · votes ${[...voteCount.entries()].map(([id, i]) => `#${id}×${i.n}`).join(',')}`
              : '');

    if (!top) {
      const quietNote = quiet
        ? ' Too quiet vs shop floor — check mic/loopback level, then Play captured audio.'
        : '';
      return this.failBurst({
        matches: allMatches.slice(0, 3),
        frameCount: frames.length,
        spikeCount: chosen.length,
        peakRms,
        baseline: effectiveBaseline,
        threshold,
        ...captureBase,
        reason: weak
          ? `Stop & Match: weak match Group #${weak.soundId} at ${weak.confidence}% (need ≥${floor}%).${quietNote} (${stats}${voteNote})`
          : `Stop & Match: no fingerprint match.${quietNote} (${stats}${voteNote})`,
      });
    }

    let margin = runner ? top.confidence - runner.confidence : 99;
    let runnerIsNearTwin =
      runner != null && isKnownNearTwin(top.soundId, runner.soundId);
    const nearTwinMajority =
      majorityOk &&
      runnerIsNearTwin &&
      majorityId === top.soundId &&
      matchSource !== 'pcm-live300';
    let needGap = this.lockMarginRequired(top.confidence, {
      nearTwinMajority,
      runnerIsNearTwin,
      quiet19Residual: top.quiet19Residual === true,
      field10Residual: top.field10Residual === true,
      goldChainVsCoin: isGoldChainVsCoinSoftLock(
        top.soundId,
        runner?.soundId,
        top.confidence,
      ),
    });
    // Same top again with at least a 3pt lead → lock (field: #1 needs 2–3 tries).
    const streakOk =
      this.lastBurstTopId === top.soundId && margin >= 3 && top.confidence >= 90;
    // Near-tie + live pitch closer to runner FP → prefer runner (#31@93.7 vs #6@92.6).
    // Must NOT steal back onto a weak #28 after quiet-19 residual (field lock bug).
    let pitchLock = false;
    if (margin < needGap && !streakOk && runner && centroid != null) {
      const pitched = promotePitchCloserRunner(allMatches, centroid, 2.5);
      const pitchedTop = pitched[0];
      if (
        pitchedTop &&
        pitchedTop.soundId !== top.soundId &&
        !hardRejectDullSink(pitchedTop)
      ) {
        allMatches = pitched.map((m) => ({
          ...m,
          spectrumVector,
          capturedCentroid: centroid,
        }));
        // Re-apply residual — pitch may have moved onto wood/#2 mid scores.
        allMatches = resolveQuiet19Residual(
          allMatches,
          centroid,
          highBandRatio(spectrumVector),
        ).map((m) => ({
          ...m,
          spectrumVector,
          capturedCentroid: centroid,
        }));
        allMatches = resolveField10Residual(
          allMatches,
          spectrumVector,
          this.fingerprints,
          highBandRatio(spectrumVector),
        ).map((m) => ({
          ...m,
          spectrumVector,
          capturedCentroid: centroid,
        }));
        top = allMatches[0];
        runner = allMatches[1];
        pitchLock = top.soundId === pitchedTop.soundId;
        margin = runner ? Math.abs(top.confidence - runner.confidence) : 99;
        runnerIsNearTwin =
          runner != null && isKnownNearTwin(top.soundId, runner.soundId);
        needGap = this.lockMarginRequired(top.confidence, {
          nearTwinMajority: false,
          runnerIsNearTwin,
          quiet19Residual: top.quiet19Residual === true,
          field10Residual: top.field10Residual === true,
          goldChainVsCoin: isGoldChainVsCoinSoftLock(
            top.soundId,
            runner?.soundId,
            top.confidence,
          ),
        });
      }
    }

    // Absolute gate: never lock weak #28 — runs on FINAL top (after residual + pitch).
    const finalReject = hardRejectDullSink(top) ?? directedSinkRejectReason(top, centroid);
    if (finalReject) {
      this.lastBurstTopId = null;
      return this.failBurst({
        matches: allMatches.slice(0, 3),
        frameCount: frames.length,
        spikeCount: chosen.length,
        peakRms,
        baseline: effectiveBaseline,
        threshold,
        ...captureBase,
        reason: `${finalReject} (${stats}${voteNote})`,
      });
    }

    // Quiet #19 / field #10 residual always locks once ranked top (conf boosted above runner).
    const residual19Lock = top.quiet19Residual === true && top.soundId === 19;
    const residual10Lock = top.field10Residual === true && top.soundId === 10;
    if (
      margin < needGap &&
      !streakOk &&
      !pitchLock &&
      !residual19Lock &&
      !residual10Lock
    ) {
      this.lastBurstTopId = top.soundId;
      const tip =
        chosen.length < 2
          ? ' Move the cargo 2–3 times before Stop & Match.'
          : ' Move the same cargo again (2–3 clean clicks).';
      return this.failBurst({
        matches: allMatches.slice(0, 3),
        frameCount: frames.length,
        spikeCount: chosen.length,
        peakRms,
        baseline: effectiveBaseline,
        threshold,
        ...captureBase,
        reason: `Stop & Match: ambiguous (Group #${top.soundId} ${top.confidence}% vs #${runner?.soundId} ${runner?.confidence}%, need ≥${needGap}pt gap).${tip}`,
      });
    }

    this.lastBurstTopId = null;
    this.shopPhase = 'locked';
    this.listeningPaused = true;
    const residualNote = residual19Lock
      ? ' · quiet19-residual'
      : residual10Lock
        ? ' · field10-residual'
        : '';
    const reason = `Locked Group #${top.soundId} · ${top.confidence}% · ${sourceNote}${residualNote} (${stats}${voteNote})`;
    this.setStatus('done', reason);
    this.onMatch?.({
      matches: allMatches.filter((m) => m.confidence >= floor),
      peakMs,
      spectrumVector,
      capturedCentroid: centroid,
      source: 'burst',
      captureBlob: captureBase.captureBlob,
      captureDurationMs: captureBase.captureDurationMs,
    });
    return {
      ok: true,
      reason,
      matches: allMatches.filter((m) => m.confidence >= floor),
      frameCount: frames.length,
      spikeCount: chosen.length,
      peakRms,
      baseline: effectiveBaseline,
      threshold,
      ...captureBase,
    };
  }

  /** Attach any MediaStream with audio (display share or mic/loopback) into the matcher pipeline. */
  private attachBoot(boot: BootstrappedCapture): void {
    this.stream = boot.stream;
    this.ctx = boot.ctx;
    this.captureSource = boot.sourceKind;
    // Mic is noisier — apply stricter effective preset for this source.
    this.applyPreset(presetFor(this.sensitivityLevel, boot.sourceKind));
    this.rmsBaseline = 0;
    this.atShopGate = false;
    this.autoDetectArmed = false;
    this.shopCalibrating = false;
    this.burstRecording = false;
    this.burstFrames = [];
    this.clearMultiState();
    this.stopBurstPcmCapture();
    this.shopPhase = 'in-raid';
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = analyserFftSize(this.ctx.sampleRate);
    this.analyser.smoothingTimeConstant = 0.15;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    // Do not connect to destination — keep capture silent.

    this.stream.getVideoTracks().forEach((t) => {
      t.addEventListener('ended', () => void this.stop());
    });
    this.stream.getAudioTracks().forEach((t) => {
      t.addEventListener('ended', () => {
        this.setStatus(
          'error',
          boot.sourceKind === 'microphone'
            ? 'Mic / loopback track ended — re-select the input device.'
            : 'Audio track ended — re-share with system/tab audio, or use mic/loopback.',
        );
        void this.stop();
      });
    });

    window.addEventListener('focus', this.onFocusBound);
    document.addEventListener('visibilitychange', this.onFocusBound);
    this.listeningPaused = false;
    this.armFocusGrace();
    this.startGraceUntil = performance.now() + this.startGraceMs;
    this.lastTrigger = 0;

    const via =
      boot.sourceKind === 'microphone' ? 'via mic/loopback' : 'via screen share';
    this.setStatus(
      'listening',
      `In Raid (gate closed) · ${via} — raid noise ignored until At Shop / Move Item`,
    );
    this.loop();
  }

  /** Primary: capture via getDisplayMedia (must include audio). */
  async startCapture(): Promise<void> {
    // CRITICAL: create AudioContext synchronously under the click gesture,
    // before any await (stop / getDisplayMedia) clears user activation.
    const gestureCtx = new AudioContext();
    void gestureCtx.resume();

    await this.stop({ skipStatus: true });

    let boot;
    try {
      boot = await captureDisplayWithAudio(gestureCtx);
    } catch (err) {
      await gestureCtx.close().catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus('error', msg);
      throw err instanceof Error ? err : new Error(msg);
    }

    this.attachBoot(boot);
  }

  /** Fallback: capture via getUserMedia mic / virtual loopback device. */
  async startCaptureFromMic(deviceId?: string): Promise<void> {
    const gestureCtx = new AudioContext();
    void gestureCtx.resume();

    await this.stop({ skipStatus: true });

    let boot;
    try {
      boot = await captureMicWithAudio(deviceId, gestureCtx);
    } catch (err) {
      await gestureCtx.close().catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus('error', msg);
      throw err instanceof Error ? err : new Error(msg);
    }

    this.attachBoot(boot);
  }

  async stop(opts?: { skipStatus?: boolean }): Promise<void> {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('focus', this.onFocusBound);
    document.removeEventListener('visibilitychange', this.onFocusBound);
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.captureSource = null;
    this.listeningPaused = false;
    this.atShopGate = false;
    this.autoDetectArmed = false;
    this.shopCalibrating = false;
    this.burstRecording = false;
    this.burstFrames = [];
    this.lastBurstTopId = null;
    this.clearMultiState();
    this.stopBurstPcmCapture();
    this.shopPhase = 'in-raid';
    this.rmsBaseline = 0;
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    if (!opts?.skipStatus && this.status !== 'idle') this.setStatus('idle');
  }

  /** Manually trigger a 300ms capture (for testing without onset). */
  async captureOnce(): Promise<MatchResult[]> {
    if (!this.analyser || !this.ctx) return [];
    return this.captureAndMatch(this.noiseFloor);
  }

  private timeDomainRms(buf: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  private loop = () => {
    if (!this.analyser || !this.ctx) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    const rms = this.timeDomainRms(buf);
    const now = performance.now();
    const focusBlocked = now < this.focusBlockUntil;
    const startBlocked = now < this.startGraceUntil;

    // Manual move burst / Multi continuous: buffer spectra until Stop & Match or auto-N.
    if (this.burstRecording && !this.shopCalibrating) {
      const timeFloat = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(timeFloat);
      const linMag = fftLinearMagnitudes(timeFloat);
      const spectrum = magnitudeToBands(
        linMag,
        this.ctx.sampleRate,
        this.analyser.fftSize,
        this.fingerprints.vectorBands || 32,
      );
      const centroid = spectralCentroidHz(
        linMag,
        this.ctx.sampleRate,
        this.analyser.fftSize,
      );
      this.burstFrames.push({ t: now - this.burstStartedAt, rms, spectrum, centroid });
      // Cap ~20s of recording
      if (this.burstFrames.length > 1200) this.burstFrames.shift();
      // Non-overlapping hop of new samples for PCM-live300 backup (~1/raf advance).
      const hop = Math.max(1, Math.floor(this.ctx.sampleRate / 70));
      const offset = Math.max(0, timeFloat.length - hop);
      this.burstAnalyserPcmChunks.push(timeFloat.slice(offset));
      if (this.burstAnalyserPcmChunks.length > 2000) this.burstAnalyserPcmChunks.shift();

      // Multi continuous: count cargo-move spikes → auto-finalize with same matcher.
      if (
        this.multiContinuousArmed &&
        !this.multiFinalizing &&
        now >= this.multiCooldownUntil
      ) {
        const thr = Math.max(
          this.rmsBaseline + Math.max(this.fluxThreshold * 0.2, 0.004),
          this.rmsBaseline * 1.12 + 0.003,
        );
        const rising =
          rms >= thr &&
          rms > this.multiPrevRms * 1.12 &&
          now - this.multiLastSpikeAt >= MULTI_SPIKE_SEP_MS;
        if (rising) {
          this.multiLastSpikeAt = now;
          this.multiSpikeCount += 1;
          this.emitMultiProgress(
            'counting',
            `Move ${this.multiSpikeCount}/${MULTI_SPIKE_TARGET_N}`,
          );
          this.setStatus(
            'capturing',
            `Multi scan ${this.multiSpikeCount}/${MULTI_SPIKE_TARGET_N}`,
          );
          // Always wait for N=3 — early lock at 2 mixed the next cargo into the buffer.
          if (this.multiSpikeCount >= MULTI_SPIKE_TARGET_N) {
            void this.commitMultiBurst();
          }
        }
        this.multiPrevRms = rms;
      }

      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    // Adapt baseline only on quiet frames when gate is open (shop calibrated).
    if (
      this.atShopGate &&
      this.status === 'listening' &&
      !this.listeningPaused &&
      !this.shopCalibrating
    ) {
      if (this.rmsBaseline === 0) {
        this.rmsBaseline = rms;
      } else if (rms < this.noiseFloor * 1.15) {
        this.rmsBaseline = this.rmsBaseline * 0.97 + rms * 0.03;
      }
    }

    const flux = rms - this.rmsBaseline;
    const sharpTransient = flux >= this.fluxThreshold && rms >= this.noiseFloor;

    // Auto-onset only when At Shop AND user armed auto-detect (burst-only by default).
    if (
      this.atShopGate &&
      this.autoDetectArmed &&
      !this.listeningPaused &&
      !focusBlocked &&
      !startBlocked &&
      !this.shopCalibrating &&
      this.status === 'listening' &&
      sharpTransient &&
      now - this.lastTrigger > this.cooldownMs
    ) {
      this.lastTrigger = now;
      void this.captureAndMatch(rms, flux);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private async captureAndMatch(
    onsetRms?: number,
    onsetFlux?: number,
  ): Promise<MatchResult[]> {
    if (!this.analyser || !this.ctx) return [];
    const peakMs = Math.round((onsetRms ?? 0) * 1000);
    this.setStatus(
      'capturing',
      `Checking sound… peak~${peakMs} · flux=${(onsetFlux ?? 0).toFixed(3)}`,
    );

    const frames: number[][] = [];
    const centroids: number[] = [];
    const envelope: number[] = [];
    const start = performance.now();
    const timeFloat = new Float32Array(this.analyser.fftSize);
    const timeByte = new Uint8Array(this.analyser.fftSize);
    let peakRms = 0;
    let peakAtMs = 0;

    while (performance.now() - start < this.sliceMs) {
      // Linear FFT from time domain — fingerprint-aligned (avoids dB/byte collapse
      // that flips #36→#7 / #22→#21 on late windows).
      this.analyser.getFloatTimeDomainData(timeFloat);
      this.analyser.getByteTimeDomainData(timeByte);
      const linMag = fftLinearMagnitudes(timeFloat);
      const frameRms = this.timeDomainRms(timeByte);
      const elapsed = performance.now() - start;
      envelope.push(frameRms);
      if (frameRms > peakRms) {
        peakRms = frameRms;
        peakAtMs = elapsed;
      }
      frames.push(
        magnitudeToBands(
          linMag,
          this.ctx.sampleRate,
          this.analyser.fftSize,
          this.fingerprints.vectorBands || 32,
        ),
      );
      centroids.push(
        spectralCentroidHz(linMag, this.ctx.sampleRate, this.analyser.fftSize),
      );
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }

    const [peakMin, peakMax] = this.peakWindowMs;
    // Merchant pickup/drop: short attack then decay. Reject late-rising ambient.
    if (peakAtMs < peakMin || peakAtMs > peakMax) {
      this.resumeListening(
        `Listening… ignored late peak (${Math.round(peakAtMs)}ms; want ≤${peakMax}ms)`,
      );
      return [];
    }

    // Crest: peak should exceed mean envelope (spike vs continuous footsteps).
    const meanEnv =
      envelope.reduce((a, b) => a + b, 0) / Math.max(envelope.length, 1);
    const crest = peakRms / Math.max(meanEnv, 1e-6);
    if (crest < 1.45) {
      this.resumeListening(
        `Listening… ignored sustained noise (crest ${crest.toFixed(2)} < 1.45)`,
      );
      return [];
    }

    // Early energy should dominate the tail (decay after attack).
    const cut = Math.max(1, Math.floor(envelope.length * 0.4));
    const earlyMax = Math.max(...envelope.slice(0, cut), 0);
    const tail =
      envelope.slice(cut).reduce((a, b) => a + b, 0) /
      Math.max(envelope.length - cut, 1);
    if (earlyMax < tail * 1.4) {
      this.resumeListening(
        'Listening… ignored rising/sustained ambient (no attack–decay shape)',
      );
      return [];
    }

    // Centroid drift: decay windows collapse brightness and flip near-neighbors.
    const earlyCentN = Math.max(1, Math.floor(centroids.length * 0.4));
    const earlyCentroid =
      centroids.slice(0, earlyCentN).reduce((a, b) => a + b, 0) / earlyCentN;
    const fullCentroid =
      centroids.reduce((a, b) => a + b, 0) / Math.max(centroids.length, 1);
    if (Math.abs(earlyCentroid - fullCentroid) > 800) {
      this.resumeListening(
        `Listening… ignored centroid drift (${Math.round(earlyCentroid)}→${Math.round(fullCentroid)} Hz) — late/decay window`,
      );
      return [];
    }

    this.setStatus('matching', 'Matching…');

    // Equal-average over the live300 slice (linear FFT). Attack/decay shape is
    // gated above; extra front-weighting hurt #36 vs near-neighbors on real clips.
    const bands = frames[0]?.length || 32;
    const avg = new Array(bands).fill(0);
    for (const f of frames) {
      for (let i = 0; i < bands; i++) avg[i] += f[i] || 0;
    }
    for (let i = 0; i < bands; i++) avg[i] /= Math.max(frames.length, 1);
    const max = Math.max(...avg, 1e-9);
    const spectrumVector = avg.map((v) => v / max);
    const centroid =
      centroids.reduce((a, b) => a + b, 0) / Math.max(centroids.length, 1);

    const candidates =
      this.candidateSoundIds.length > 0
        ? this.candidateSoundIds
        : Object.keys(this.fingerprints.fingerprints).map(Number);

    let allMatches = rankMatchesWithPriors(
      matchSpectrumAgainstFingerprints(
        spectrumVector,
        this.fingerprints,
        candidates,
        this.kind,
        centroid,
      ),
      centroid,
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));
    allMatches = resolveQuiet19Residual(
      allMatches,
      centroid,
      highBandRatio(spectrumVector),
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));
    allMatches = resolveField10Residual(
      allMatches,
      spectrumVector,
      this.fingerprints,
      highBandRatio(spectrumVector),
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));

    // Auto path: stricter floor + require clear winner vs runner-up (heal/ambient often ties ~95%).
    const autoFloor = Math.max(this.minConfidence, 68);
    const matches = allMatches.filter((m) => m.confidence >= autoFloor);
    const top = matches[0];
    const runner = matches[1] ?? allMatches[1];
    const weak = allMatches[0];

    if (!top) {
      this.surfaceListening(
        weak
          ? `Auto… weak match ignored (Group ${weak.soundId} ${weak.confidence}% < ${autoFloor}% floor)`
          : 'At Shop · auto armed — no fingerprint match yet',
      );
      return [];
    }

    const sinkReject = hardRejectDullSink(top) ?? directedSinkRejectReason(top, centroid);
    if (sinkReject) {
      this.surfaceListening(sinkReject);
      return [];
    }

    const margin = runner ? top.confidence - runner.confidence : 99;
    const runnerIsNearTwin =
      runner != null && isKnownNearTwin(top.soundId, runner.soundId);
    const residual19Lock = top.quiet19Residual === true && top.soundId === 19;
    const residual10Lock = top.field10Residual === true && top.soundId === 10;
    const needGap = this.lockMarginRequired(top.confidence, {
      runnerIsNearTwin,
      quiet19Residual: residual19Lock,
      field10Residual: residual10Lock,
      goldChainVsCoin: isGoldChainVsCoinSoftLock(
        top.soundId,
        runner?.soundId,
        top.confidence,
      ),
    });
    if (margin < needGap && !residual19Lock && !residual10Lock) {
      this.surfaceListening(
        `Auto… ambiguous (Group #${top.soundId} ${top.confidence}% vs #${runner?.soundId} ${runner?.confidence}%, need ≥${needGap}pt gap). Use Move Item burst instead.`,
      );
      return [];
    }

    this.shopPhase = 'locked';
    this.setStatus(
      'done',
      `Locked Group #${top.soundId} · audio ${top.confidence}% (auto${residual19Lock ? ' · quiet19-residual' : residual10Lock ? ' · field10-residual' : ''})`,
    );
    this.onMatch?.({
      matches,
      peakMs,
      spectrumVector,
      capturedCentroid: centroid,
      source: 'auto',
    });

    setTimeout(() => {
      if (this.analyser && this.status === 'done' && !this.listeningPaused) {
        this.shopPhase = 'at-shop';
        this.setStatus('listening', this.shopStatusDetail());
      }
    }, 400);

    return matches;
  }
}

/**
 * Play a reference OGG for Manual Mode audition only.
 * Live Automatic matching does NOT call this — it compares mic/loopback FFT
 * against precomputed fingerprint vectors in fingerprints.json.
 */
export function playReferenceSound(
  filePath: string,
  volume = 0.7,
): HTMLAudioElement {
  const url = assetUrl(filePath);
  const audio = new Audio(url);
  audio.volume = volume;
  // Click handler = user gesture, so autoplay policy is satisfied.
  void audio.play().catch((err) => {
    console.warn('[playReferenceSound] failed', url, err);
  });
  return audio;
}
