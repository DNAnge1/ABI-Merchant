/**
 * Real-time Web Audio matcher for Field Merchant mystery cargo sounds.
 * Uses AnalyserNode (fftSize 2048), onset detection, 300ms spectral slices,
 * and cosine similarity against precomputed fingerprints filtered by cargo size+price.
 */

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
  /** RMS energy threshold for onset (0–1 scale of analyser). Default from sensitivity. */
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
    if (!paused && this.analyser && this.status !== 'listening' && this.status !== 'capturing') {
      this.setStatus(
        'listening',
        'Listening… waiting for next cargo sound. Stop when done.',
      );
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

  private armFocusGrace() {
    if (this.focusGraceMs > 0) {
      this.focusBlockUntil = performance.now() + this.focusGraceMs;
    }
  }

  private setStatus(s: MatcherStatus, detail?: string) {
    this.status = s;
    this.onStatus?.(s, detail);
  }

  private resumeListening(detail: string) {
    if (!this.analyser || this.listeningPaused) return;
    this.setStatus('listening', detail);
  }

  /** Attach any MediaStream with audio (display share or mic/loopback) into the matcher pipeline. */
  private attachBoot(boot: BootstrappedCapture): void {
    this.stream = boot.stream;
    this.ctx = boot.ctx;
    this.captureSource = boot.sourceKind;
    // Mic is noisier — apply stricter effective preset for this source.
    this.applyPreset(presetFor(this.sensitivityLevel, boot.sourceKind));
    this.rmsBaseline = 0;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
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
    const strictNote =
      boot.sourceKind === 'microphone' ? '; mic uses stricter onset' : '';
    this.setStatus(
      'listening',
      `Listening… waiting for Field Merchant sounds (${via}${strictNote}; OK if not in raid yet). Stop when done.`,
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

    // Adapt baseline only on quiet frames so flux stays sharp for real onsets.
    if (this.status === 'listening' && !this.listeningPaused) {
      if (this.rmsBaseline === 0) {
        this.rmsBaseline = rms;
      } else if (rms < this.noiseFloor * 1.15) {
        this.rmsBaseline = this.rmsBaseline * 0.94 + rms * 0.06;
      }
    }

    const flux = rms - this.rmsBaseline;
    const sharpTransient = flux >= this.fluxThreshold && rms >= this.noiseFloor;

    if (
      !this.listeningPaused &&
      !focusBlocked &&
      !startBlocked &&
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

    const matches = allMatches.filter((m) => m.confidence >= this.minConfidence);
    const top = matches[0];
    const weak = allMatches[0];

    if (!top) {
      this.resumeListening(
        weak
          ? `Listening… weak match ignored (Group ${weak.soundId} ${weak.confidence}% < ${this.minConfidence}% floor)`
          : 'Listening… no fingerprint match — still waiting for cargo',
      );
      return [];
    }

    this.setStatus(
      'done',
      `Done: Group ${top.soundId} · audio ${top.confidence}%`,
    );
    this.onMatch?.({ matches, peakMs, spectrumVector, capturedCentroid: centroid });

    // Continuous mode resumes listening; single-item mode keeps paused via setListeningPaused
    setTimeout(() => {
      if (this.analyser && this.status === 'done' && !this.listeningPaused) {
        this.setStatus('listening', 'Listening… waiting for next cargo sound.');
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
