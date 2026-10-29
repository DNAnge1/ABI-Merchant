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
}

export interface MatchPayload {
  matches: MatchResult[];
  peakMs: number;
  spectrumVector: number[];
  capturedCentroid: number;
  /** How the match was produced — burst bypasses auto margin rules in the UI. */
  source?: 'auto' | 'burst';
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
 */
function byteToLinearMag(byteVal: number): number {
  if (byteVal <= 0) return 0;
  const db = -100 + (byteVal / 255) * 70;
  return Math.pow(10, db / 20);
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
function highBandRatio(vec: number[]): number {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  const upper = vec.slice(16).reduce((s, v) => s + v, 0);
  return upper / total;
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

      // Tighter centroid prior (2200Hz scale vs old 4000Hz).
      if (capturedCentroid != null && side.spectralCentroid) {
        const delta = Math.abs(capturedCentroid - side.spectralCentroid);
        const prior = Math.max(0, 1 - delta / 2200);
        score = score * 0.78 + prior * 0.22;
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
  /** Auto matches: top confidence must beat runner-up by this many points. */
  private autoMarginPts = 4;
  private shopPhase: ShopPhase = 'in-raid';
  private shopCalibrating = false;
  private burstRecording = false;
  private burstFrames: BurstFrame[] = [];
  private burstStartedAt = 0;
  /** Continuous mono PCM while Start Moving Item → Stop & Match. */
  private burstPcmChunks: Float32Array[] = [];
  private burstProcessor: ScriptProcessorNode | null = null;
  /** Zero-gain → destination keeps ScriptProcessor alive without audible output. */
  private burstMute: GainNode | null = null;
  private onStatus?: (s: MatcherStatus, detail?: string) => void;
  private onMatch?: (payload: MatchPayload) => void;
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
  }) {
    this.onStatus = cbs.onStatus;
    this.onMatch = cbs.onMatch;
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
        `At Shop · auto-detect ARMED (margin ≥${this.autoMarginPts}pts) — or use Move Item`,
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
      this.stopBurstPcmCapture();
      this.listeningPaused = true;
      this.shopPhase = 'in-raid';
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
    const samples = concatFloat32(this.burstPcmChunks);
    this.burstPcmChunks = [];
    const blob = samples.length > 0 ? encodeWavMono(samples, sampleRate) : null;
    return { samples, sampleRate, blob };
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
    this.burstStartedAt = performance.now();
    this.startBurstPcmCapture();
    this.shopPhase = 'recording';
    this.setStatus('capturing', this.shopStatusDetail());
  }

  private failBurst(partial: Omit<BurstMatchResult, 'ok'>): BurstMatchResult {
    this.shopPhase = 'at-shop';
    this.listeningPaused = true;
    this.autoDetectArmed = false; // don't leave auto open after a failed burst
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
    const chosen: BurstFrame[] = [];
    for (const p of peaks) {
      if (chosen.some((c) => Math.abs(c.t - p.t) < 60)) continue;
      chosen.push(p);
      if (chosen.length >= 6) break;
    }
    if (!chosen.length) {
      const loud = [...frames].sort((a, b) => b.rms - a.rms);
      for (const f of loud) {
        if (f.rms < threshold) break;
        if (chosen.some((c) => Math.abs(c.t - f.t) < 60)) continue;
        chosen.push(f);
        if (chosen.length >= 4) break;
      }
    }
    // Always attempt match: take absolute loudest frames even under threshold.
    if (!chosen.length) {
      const loud = [...frames].sort((a, b) => b.rms - a.rms).slice(0, 4);
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
      centroidSum += localCentroid / slice.length;
      windowsUsed += 1;
    }
    const denom = Math.max(windowsUsed, 1);
    for (let i = 0; i < bands; i++) avg[i] /= denom;
    const max = Math.max(...avg, 1e-9);
    const spectrumVector = avg.map((v) => v / max);
    const centroid = centroidSum / denom;
    const peakMs = Math.round(peakRms * 1000);

    const candidates =
      this.candidateSoundIds.length > 0
        ? this.candidateSoundIds
        : Object.keys(this.fingerprints.fingerprints).map(Number);

    const allMatches = matchSpectrumAgainstFingerprints(
      spectrumVector,
      this.fingerprints,
      candidates,
      this.kind,
      centroid,
    ).map((m) => ({
      ...m,
      spectrumVector,
      capturedCentroid: centroid,
    }));

    const floor = Math.max(48, this.minConfidence - 8);
    const matches = allMatches.filter((m) => m.confidence >= floor);
    const top = matches[0];
    const weak = allMatches[0];
    const stats = diagFor(peakRms, chosen.length);

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
          ? `Stop & Match: weak match Group #${weak.soundId} at ${weak.confidence}% (need ≥${floor}%).${quietNote} (${stats})`
          : `Stop & Match: no fingerprint match.${quietNote} (${stats})`,
      });
    }

    this.shopPhase = 'locked';
    this.listeningPaused = true;
    const reason = `Locked Group #${top.soundId} · ${top.confidence}% · ${chosen.length} spikes (${stats})`;
    this.setStatus('done', reason);
    this.onMatch?.({
      matches,
      peakMs,
      spectrumVector,
      capturedCentroid: centroid,
      source: 'burst',
    });
    return {
      ok: true,
      reason,
      matches,
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

    // Manual move burst: buffer spectra continuously until Stop & Match.
    if (this.burstRecording && !this.shopCalibrating) {
      const freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(freqBuf);
      const spectrum = magnitudeToBands(
        freqBuf,
        this.ctx.sampleRate,
        this.analyser.fftSize,
        this.fingerprints.vectorBands || 32,
      );
      const centroid = spectralCentroidHz(
        freqBuf,
        this.ctx.sampleRate,
        this.analyser.fftSize,
      );
      this.burstFrames.push({ t: now - this.burstStartedAt, rms, spectrum, centroid });
      // Cap ~20s of recording
      if (this.burstFrames.length > 1200) this.burstFrames.shift();
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
    const freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    const timeBuf = new Uint8Array(this.analyser.fftSize);
    let peakRms = 0;
    let peakAtMs = 0;

    while (performance.now() - start < this.sliceMs) {
      this.analyser.getByteFrequencyData(freqBuf);
      this.analyser.getByteTimeDomainData(timeBuf);
      const frameRms = this.timeDomainRms(timeBuf);
      const elapsed = performance.now() - start;
      envelope.push(frameRms);
      if (frameRms > peakRms) {
        peakRms = frameRms;
        peakAtMs = elapsed;
      }
      frames.push(
        magnitudeToBands(
          freqBuf,
          this.ctx.sampleRate,
          this.analyser.fftSize,
          this.fingerprints.vectorBands || 32,
        ),
      );
      centroids.push(
        spectralCentroidHz(freqBuf, this.ctx.sampleRate, this.analyser.fftSize),
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
    if (crest < 1.3) {
      this.resumeListening(
        `Listening… ignored sustained noise (crest ${crest.toFixed(2)} < 1.3)`,
      );
      return [];
    }

    // Early energy should dominate the tail (decay after attack).
    const cut = Math.max(1, Math.floor(envelope.length * 0.45));
    const earlyMax = Math.max(...envelope.slice(0, cut), 0);
    const tail =
      envelope.slice(cut).reduce((a, b) => a + b, 0) /
      Math.max(envelope.length - cut, 1);
    if (earlyMax < tail * 1.15) {
      this.resumeListening(
        'Listening… ignored rising/sustained ambient (no attack–decay shape)',
      );
      return [];
    }

    this.setStatus('matching', 'Matching…');

    const bands = frames[0]?.length || 32;
    const avg = new Array(bands).fill(0);
    for (const f of frames) {
      for (let i = 0; i < bands; i++) avg[i] += f[i] || 0;
    }
    for (let i = 0; i < bands; i++) avg[i] /= Math.max(frames.length, 1);
    const max = Math.max(...avg, 1e-9);
    const spectrumVector = avg.map((v) => v / max);
    const centroid = centroids.reduce((a, b) => a + b, 0) / Math.max(centroids.length, 1);

    const candidates =
      this.candidateSoundIds.length > 0
        ? this.candidateSoundIds
        : Object.keys(this.fingerprints.fingerprints).map(Number);

    const allMatches = matchSpectrumAgainstFingerprints(
      spectrumVector,
      this.fingerprints,
      candidates,
      this.kind,
      centroid,
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

    const margin = runner ? top.confidence - runner.confidence : 99;
    if (margin < this.autoMarginPts) {
      this.surfaceListening(
        `Auto… ambiguous (Group #${top.soundId} ${top.confidence}% vs #${runner?.soundId} ${runner?.confidence}%, need ≥${this.autoMarginPts}pt gap). Use Move Item burst instead.`,
      );
      return [];
    }

    this.shopPhase = 'locked';
    this.setStatus(
      'done',
      `Locked Group #${top.soundId} · audio ${top.confidence}% (auto)`,
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
