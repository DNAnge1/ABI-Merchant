/**
 * Built-in self-test: decode each pickup OGG at the browser AudioContext sample
 * rate, run the same PCM live300 onset+window FFT as fingerprint extract /
 * offline selftest ({@link analyzePcmLive300Window}), then score.
 *
 * Avoids AnalyserNode seek/ring-buffer averages that diverged from field burst
 * locks after the linear-FFT align (Oct 29 field vs Self-Test MISSes).
 */

import { assetUrl } from './assetUrl';
import {
  analyserFftSize,
  analyzePcmLive300Window,
  matchSpectrumAgainstFingerprints,
  resolveDirectedSinks,
  type FingerprintsFile,
  type MatchResult,
} from './audioMatcher';

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

async function decodePickup(
  ctx: AudioContext,
  file: string,
): Promise<AudioBuffer> {
  const res = await fetch(assetUrl(file));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
  const ab = await res.arrayBuffer();
  return ctx.decodeAudioData(ab.slice(0));
}

export type SelftestProgress = (done: number, total: number, row?: SelftestRow) => void;

/**
 * Score all pickup fingerprints via PCM live300 at the browser sample rate.
 * Mutes nothing — no playback; decode only.
 */
export async function runBrowserAnalyserSelftest(
  fingerprints: FingerprintsFile,
  onProgress?: SelftestProgress,
): Promise<SelftestReport> {
  const startedAt = new Date().toISOString();
  const ctx = new AudioContext();
  await ctx.resume();

  const fftSize = analyserFftSize(ctx.sampleRate);
  const bands = fingerprints.vectorBands || 32;

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
        // Mixdown if decode is multi-channel (rare for merchant OGGs).
        let samples = buffer.getChannelData(0);
        if (buffer.numberOfChannels > 1) {
          const mixed = new Float32Array(buffer.length);
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let s = 0; s < data.length; s++) mixed[s] += data[s];
          }
          const inv = 1 / buffer.numberOfChannels;
          for (let s = 0; s < mixed.length; s++) mixed[s] *= inv;
          samples = mixed;
        }
        const { spectrumVector, centroid } = analyzePcmLive300Window(
          samples,
          buffer.sampleRate,
          fftSize,
          bands,
        );
        const matches: MatchResult[] = resolveDirectedSinks(
          matchSpectrumAgainstFingerprints(
            spectrumVector,
            fingerprints,
            candidates,
            'pickup',
            centroid,
          ),
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
