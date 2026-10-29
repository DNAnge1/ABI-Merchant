/**
 * Built-in self-test: decode each pickup OGG through a live AnalyserNode at the
 * browser AudioContext sample rate, poll getFloatTimeDomainData + linear FFT
 * for ~300ms (same path as captureAndMatch / burst), and score against fingerprints.
 */

import { assetUrl } from './assetUrl';
import {
  analyserFftSize,
  fftLinearMagnitudes,
  magnitudeToBands,
  matchSpectrumAgainstFingerprints,
  spectralCentroidHz,
  type FingerprintsFile,
  type MatchResult,
} from './audioMatcher';

const SLICE_MS = 300;
const ONSET_WAIT_MS = 280;
const ONSET_RMS = 0.018;

export interface SelftestRow {
  soundId: number;
  file: string;
  pass: boolean;
  topId: number | null;
  topConfidence: number;
  expectedConfidence: number;
  centroid: number;
  sampleRate: number;
  fftSize: number;
  error?: string;
}

export interface SelftestReport {
  ok: boolean;
  passed: number;
  total: number;
  passRate: number;
  sampleRate: number;
  fftSize: number;
  rows: SelftestRow[];
  startedAt: string;
  finishedAt: string;
}

function raf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function decodePickup(
  ctx: AudioContext,
  file: string,
): Promise<AudioBuffer> {
  const res = await fetch(assetUrl(file));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
  const ab = await res.arrayBuffer();
  return ctx.decodeAudioData(ab.slice(0));
}

function timeDomainRms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/**
 * Play buffer into analyser (muted). Prefer fingerprint onsetMs (live300-aligned);
 * fall back to RMS onset if onset unknown. Uses linear FFT on float time-domain
 * data — matches live burst / captureAndMatch (not getByteFrequencyData).
 */
async function captureLiveSpectrum(
  ctx: AudioContext,
  analyser: AnalyserNode,
  buffer: AudioBuffer,
  onsetMs?: number,
): Promise<{ spectrumVector: number[]; centroid: number }> {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(analyser);

  const timeFloat = new Float32Array(analyser.fftSize);
  const frames: number[][] = [];
  const centroids: number[] = [];

  // Start ~16ms before stored onset so the first analyser frames catch the attack.
  const offsetSec =
    onsetMs != null && Number.isFinite(onsetMs)
      ? Math.max(0, (onsetMs - 16) / 1000)
      : 0;
  src.start(0, offsetSec);

  if (onsetMs == null) {
    const t0 = performance.now();
    while (performance.now() - t0 < ONSET_WAIT_MS) {
      analyser.getFloatTimeDomainData(timeFloat);
      if (timeDomainRms(timeFloat) >= ONSET_RMS) break;
      await raf();
    }
  } else {
    // Brief settle for AnalyserNode after seek-start.
    for (let i = 0; i < 2; i++) await raf();
  }

  const sliceStart = performance.now();
  while (performance.now() - sliceStart < SLICE_MS) {
    analyser.getFloatTimeDomainData(timeFloat);
    const linMag = fftLinearMagnitudes(timeFloat);
    frames.push(
      magnitudeToBands(linMag, ctx.sampleRate, analyser.fftSize, 32),
    );
    centroids.push(spectralCentroidHz(linMag, ctx.sampleRate, analyser.fftSize));
    await raf();
  }

  try {
    src.stop();
  } catch {
    /* already ended */
  }
  src.disconnect();

  if (frames.length === 0) {
    analyser.getFloatTimeDomainData(timeFloat);
    const linMag = fftLinearMagnitudes(timeFloat);
    frames.push(magnitudeToBands(linMag, ctx.sampleRate, analyser.fftSize, 32));
    centroids.push(spectralCentroidHz(linMag, ctx.sampleRate, analyser.fftSize));
  }

  const bands = frames[0]?.length || 32;
  const avg = new Array(bands).fill(0);
  for (const f of frames) {
    for (let i = 0; i < bands; i++) avg[i] += f[i] || 0;
  }
  const n = Math.max(frames.length, 1);
  for (let i = 0; i < bands; i++) avg[i] /= n;
  const max = Math.max(...avg, 1e-9);
  const spectrumVector = avg.map((v) => v / max);
  const centroid = centroids.reduce((a, b) => a + b, 0) / Math.max(centroids.length, 1);
  return { spectrumVector, centroid };
}

export type SelftestProgress = (done: number, total: number, row?: SelftestRow) => void;

/**
 * Score all pickup fingerprints via live AnalyserNode + linear FFT.
 * Mutes output so the UI can run it without blasting speakers.
 */
export async function runBrowserAnalyserSelftest(
  fingerprints: FingerprintsFile,
  onProgress?: SelftestProgress,
): Promise<SelftestReport> {
  const startedAt = new Date().toISOString();
  const ctx = new AudioContext();
  await ctx.resume();

  const fftSize = analyserFftSize(ctx.sampleRate);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  // No temporal smoothing — fingerprints are unaveraged hop FFT frames; smoothing
  // would smear seek-start silence into the live300 window.
  analyser.smoothingTimeConstant = 0;
  // Keep the graph alive without audible output.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  analyser.connect(mute);
  mute.connect(ctx.destination);

  const entries = Object.values(fingerprints.fingerprints)
    .filter((fp) => fp.pickup?.file)
    .sort((a, b) => a.soundId - b.soundId);
  const candidates = entries.map((e) => e.soundId);
  const rows: SelftestRow[] = [];
  let passed = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const fp = entries[i];
      const file = fp.pickup!.file;
      const base: SelftestRow = {
        soundId: fp.soundId,
        file,
        pass: false,
        topId: null,
        topConfidence: 0,
        expectedConfidence: 0,
        centroid: 0,
        sampleRate: ctx.sampleRate,
        fftSize,
      };
      try {
        const buffer = await decodePickup(ctx, file);
        const { spectrumVector, centroid } = await captureLiveSpectrum(
          ctx,
          analyser,
          buffer,
          fp.pickup?.onsetMs,
        );
        const matches: MatchResult[] = matchSpectrumAgainstFingerprints(
          spectrumVector,
          fingerprints,
          candidates,
          'pickup',
          centroid,
        );
        const top = matches[0];
        const expected = matches.find((m) => m.soundId === fp.soundId);
        base.centroid = Math.round(centroid);
        base.topId = top?.soundId ?? null;
        base.topConfidence = top?.confidence ?? 0;
        base.expectedConfidence = expected?.confidence ?? 0;
        base.pass = top?.soundId === fp.soundId;
        if (base.pass) passed += 1;
      } catch (err) {
        base.error = err instanceof Error ? err.message : String(err);
      }
      rows.push(base);
      onProgress?.(i + 1, entries.length, base);
    }
  } finally {
    await ctx.close().catch(() => undefined);
  }

  const total = rows.length;
  const finishedAt = new Date().toISOString();
  return {
    ok: passed === total && total > 0,
    passed,
    total,
    passRate: total ? Math.round((passed / total) * 1000) / 10 : 0,
    sampleRate: rows[0]?.sampleRate ?? 0,
    fftSize,
    rows,
    startedAt,
    finishedAt,
  };
}
