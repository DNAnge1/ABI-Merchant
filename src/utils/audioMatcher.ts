/**
 * Real-time Web Audio matcher for Field Merchant mystery cargo sounds.
 * Uses AnalyserNode (fftSize 2048), onset detection, 300ms spectral slices,
 * and cosine similarity against precomputed fingerprints filtered by cargo size+price.
 */

import { captureDisplayWithAudio } from './displayCapture';

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
}

export interface MatcherOptions {
  /** RMS energy threshold for onset (0–1 scale of analyser). Default 0.18 */
  noiseFloor?: number;
  /** Capture window after onset in ms. Default 300 */
  sliceMs?: number;
  /** Cooldown between detections in ms. Default 800; continuous ~600 */
  cooldownMs?: number;
  /** Prefer pickup, drop, or auto (try both, take best). Default auto */
  kind?: SoundKind | 'auto';
  /**
   * After the browser window regains focus, ignore onsets for this many ms
   * (single-monitor Alt+Tab grace). 0 = off.
   */
  focusGraceMs?: number;
}

export type MatcherStatus =
  | 'idle'
  | 'listening'
  | 'capturing'
  | 'matching'
  | 'done'
  | 'error';

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

function magnitudeToBands(
  magnitudes: Float32Array | Uint8Array,
  sampleRate: number,
  fftSize: number,
  bands = 32,
): number[] {
  const half = magnitudes.length;
  const isByte = magnitudes instanceof Uint8Array;
  const bandVec = new Array(bands).fill(0);
  const minF = 80;
  const maxF = Math.min(sampleRate / 2, 8000);
  for (let i = 1; i < half; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < minF || freq > maxF) continue;
    const t = Math.log(freq / minF) / Math.log(maxF / minF);
    const bi = Math.min(bands - 1, Math.floor(t * bands));
    const mag = isByte ? (magnitudes as Uint8Array)[i] / 255 : (magnitudes as Float32Array)[i];
    bandVec[bi] += mag;
  }
  const max = Math.max(...bandVec, 1e-9);
  return bandVec.map((v) => v / max);
}

function spectralCentroidHz(
  magnitudes: Float32Array | Uint8Array,
  sampleRate: number,
  fftSize: number,
): number {
  const isByte = magnitudes instanceof Uint8Array;
  let num = 0;
  let den = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    const mag = isByte ? (magnitudes as Uint8Array)[i] / 255 : (magnitudes as Float32Array)[i];
    const freq = (i * sampleRate) / fftSize;
    num += freq * mag;
    den += mag;
  }
  return den > 0 ? num / den : 0;
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
  kind: SoundKind | 'auto' = 'auto',
  capturedCentroid?: number,
): MatchResult[] {
  const results: MatchResult[] = [];
  const kinds: SoundKind[] =
    kind === 'auto' ? ['pickup', 'drop'] : [kind];

  for (const soundId of candidateSoundIds) {
    const fp = fingerprints.fingerprints[String(soundId)];
    if (!fp) continue;
    for (const k of kinds) {
      const side = fp[k];
      if (!side?.spectrumVector) continue;
      let score = cosineSimilarity(spectrumVector, side.spectrumVector);
      // Soft centroid prior (±2kHz tolerance)
      if (capturedCentroid != null && side.spectralCentroid) {
        const delta = Math.abs(capturedCentroid - side.spectralCentroid);
        const prior = Math.max(0, 1 - delta / 4000);
        score = score * 0.85 + prior * 0.15;
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
  private listeningPaused = false;
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
    this.noiseFloor = opts.noiseFloor ?? 0.18;
    this.sliceMs = opts.sliceMs ?? 300;
    this.cooldownMs = opts.cooldownMs ?? 800;
    this.kind = opts.kind ?? 'auto';
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

  /** Pause onset detection (single-item lock) without tearing down the stream. */
  setListeningPaused(paused: boolean) {
    this.listeningPaused = paused;
    if (!paused && this.analyser && this.status !== 'listening' && this.status !== 'capturing') {
      this.setStatus('listening', 'Listening… grab or drag Mystery Cargo in-game');
    }
  }

  isListeningPaused() {
    return this.listeningPaused;
  }

  getStatus() {
    return this.status;
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

  /** Capture game window via getDisplayMedia (must include audio). */
  async startCapture(): Promise<void> {
    // CRITICAL: create AudioContext synchronously under the click gesture,
    // before any await (stop / getDisplayMedia) clears user activation.
    const gestureCtx = new AudioContext();
    void gestureCtx.resume();

    // Tear down prior session without touching gestureCtx
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

    this.stream = boot.stream;
    this.ctx = boot.ctx;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.2;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    // Do not connect to destination — keep capture silent.

    this.stream.getVideoTracks().forEach((t) => {
      t.addEventListener('ended', () => void this.stop());
    });
    this.stream.getAudioTracks().forEach((t) => {
      t.addEventListener('ended', () => {
        this.setStatus('error', 'Audio track ended — re-share with system/tab audio');
        void this.stop();
      });
    });

    window.addEventListener('focus', this.onFocusBound);
    document.addEventListener('visibilitychange', this.onFocusBound);
    this.listeningPaused = false;
    this.armFocusGrace();

    this.setStatus('listening', 'Listening… grab or drag Mystery Cargo in-game');
    this.loop();
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
    this.listeningPaused = false;
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    if (!opts?.skipStatus && this.status !== 'idle') this.setStatus('idle');
  }

  /** Manually trigger a 300ms capture (for testing without onset). */
  async captureOnce(): Promise<MatchResult[]> {
    if (!this.analyser || !this.ctx) return [];
    return this.captureAndMatch();
  }

  private loop = () => {
    if (!this.analyser || !this.ctx) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    const focusBlocked = now < this.focusBlockUntil;
    if (
      !this.listeningPaused &&
      !focusBlocked &&
      this.status === 'listening' &&
      rms >= this.noiseFloor &&
      now - this.lastTrigger > this.cooldownMs
    ) {
      this.lastTrigger = now;
      void this.captureAndMatch(rms);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private async captureAndMatch(peakRms?: number): Promise<MatchResult[]> {
    if (!this.analyser || !this.ctx) return [];
    const peakMs = Math.round((peakRms ?? 0) * 1000);
    this.setStatus('capturing', `Checking Sound: Peak ${peakMs} ms`);

    const frames: number[][] = [];
    const centroids: number[] = [];
    const start = performance.now();
    const freqBuf = new Uint8Array(this.analyser.frequencyBinCount);

    while (performance.now() - start < this.sliceMs) {
      this.analyser.getByteFrequencyData(freqBuf);
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

    const matches = matchSpectrumAgainstFingerprints(
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

    this.setStatus(
      'done',
      matches[0]
        ? `Done: Group ${matches[0].soundId} · audio ${matches[0].confidence}%`
        : 'Done: no match',
    );
    this.onMatch?.({ matches, peakMs, spectrumVector, capturedCentroid: centroid });

    // Continuous mode resumes listening; single-item mode keeps paused via setListeningPaused
    setTimeout(() => {
      if (this.analyser && this.status === 'done' && !this.listeningPaused) {
        this.setStatus('listening', 'Listening…');
      }
    }, 400);

    return matches;
  }
}

/** Play a local reference sound from /sounds */
export function playReferenceSound(filePath: string, volume = 0.7): HTMLAudioElement {
  const audio = new Audio(filePath);
  audio.volume = volume;
  void audio.play().catch(() => undefined);
  return audio;
}
