#!/usr/bin/env node
/**
 * Offline self-test: decode public/sounds/*.ogg, extract band vectors,
 * match against fingerprints.json with the same cosine + centroid prior
 * as src/utils/audioMatcher.ts matchSpectrumAgainstFingerprints.
 *
 * Modes:
 *   reextract — full-file analyzePcm (same as fingerprint generator)
 *   live300   — ~300ms post-onset average (closer to live AnalyserNode slice)
 *
 * Usage: node scripts/offlineSelftest.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOUNDS_DIR = join(ROOT, 'public/sounds');
const FP_PATH = join(ROOT, 'src/data/fingerprints.json');
const MERCHANT_PATH = join(ROOT, 'src/data/merchantData.json');
const STORE_INTERNAL = '/cursor/stores/bc-5c080d60-6249-418b-b13a-8bf42c7f6cd6/internal';
const OUT_MD = join(STORE_INTERNAL, 'offline-selftest-results.md');
const OUT_JSON = join(STORE_INTERNAL, 'offline-selftest-results.json');

const FFT_SIZE = 2048;
const BANDS = 32;
const FP_SAMPLE_RATE = 22050;
const LIVE_SLICE_MS = 300;
const NEAR_TIE_GAP = 3; // pts

function decodeOggToPcm(filePath, sampleRate = FP_SAMPLE_RATE) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() || 'ffmpeg failed');
  }
  const buf = result.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function fft(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]];
      ;[im[i], im[j]] = [im[j], im[i]];
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
        const angle = -step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
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

function magnitudeToBands(magnitudes, sampleRate, fftSize, bands = BANDS) {
  const half = magnitudes.length;
  const bandVec = new Array(bands).fill(0);
  const bandCounts = new Array(bands).fill(0);
  const minF = 80;
  const maxF = Math.min(sampleRate / 2, 8000);
  for (let i = 1; i < half; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < minF || freq > maxF) continue;
    const t = Math.log(freq / minF) / Math.log(maxF / minF);
    const bi = Math.min(bands - 1, Math.floor(t * bands));
    bandVec[bi] += magnitudes[i];
    bandCounts[bi] += 1;
  }
  for (let bi = 0; bi < bands; bi++) {
    if (bandCounts[bi] > 0) bandVec[bi] /= bandCounts[bi];
  }
  const max = Math.max(...bandVec, 1e-9);
  return bandVec.map((v) => v / max);
}

function spectralCentroidHz(magnitudes, sampleRate, fftSize) {
  let num = 0;
  let den = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    num += freq * magnitudes[i];
    den += magnitudes[i];
  }
  return den > 0 ? num / den : 0;
}

function cosineSimilarity(a, b) {
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

function centeredCosine(a, b) {
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

function highBandRatio(vec) {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  const upper = vec.slice(16).reduce((s, v) => s + v, 0);
  return upper / total;
}

/** Mirror of audioMatcher.matchSpectrumAgainstFingerprints (pickup-only + Gemini scoring). */
function matchSpectrumAgainstFingerprints(
  spectrumVector,
  fingerprints,
  candidateSoundIds,
  kind = 'pickup',
  capturedCentroid,
) {
  const results = [];
  const kinds = kind === 'drop' ? ['drop'] : kind === 'auto' ? ['pickup'] : [kind];
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
      const tiltPenalty = Math.max(0, 1 - Math.abs(capturedHighRatio - fpHighRatio) * 1.8);
      let score = rawCos * 0.45 + shapeCos * 0.35 + tiltPenalty * 0.2;
      if (capturedCentroid != null && side.spectralCentroid) {
        const delta = Math.abs(capturedCentroid - side.spectralCentroid);
        const prior = Math.max(0, 1 - delta / 2200);
        score = score * 0.78 + prior * 0.22;
      }
      results.push({
        soundId,
        confidence: Math.round(Math.max(0, Math.min(1, score)) * 1000) / 10,
        kind: k,
        spectralCentroid: side.spectralCentroid,
      });
    }
  }

  const bestBySound = new Map();
  for (const r of results) {
    const prev = bestBySound.get(r.soundId);
    if (!prev || r.confidence > prev.confidence) bestBySound.set(r.soundId, r);
  }
  return Array.from(bestBySound.values()).sort((a, b) => b.confidence - a.confidence);
}

function frameMagnitude(samples, start, window, fftSize) {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    re[i] = (samples[start + i] || 0) * window[i];
  }
  fft(re, im);
  const half = fftSize / 2;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Full-file average — same as extractMerchantData.analyzePcm band vector. */
function extractReextract(samples, sampleRate = FP_SAMPLE_RATE) {
  const window = hannWindow(FFT_SIZE);
  const half = FFT_SIZE / 2;
  const magAccum = new Float64Array(half);
  let frames = 0;
  const hop = FFT_SIZE / 2;
  for (let start = 0; start + FFT_SIZE <= samples.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = samples[start + i] * window[i];
      energy += v * v;
    }
    if (energy < 1e-8) continue;
    const mag = frameMagnitude(samples, start, window, FFT_SIZE);
    for (let i = 0; i < half; i++) magAccum[i] += mag[i];
    frames++;
  }
  if (frames === 0) {
    const mag = frameMagnitude(samples, 0, window, FFT_SIZE);
    for (let i = 0; i < half; i++) magAccum[i] = mag[i];
    frames = 1;
  }
  const magnitudes = Array.from(magAccum, (v) => v / frames);
  return {
    spectrumVector: magnitudeToBands(magnitudes, sampleRate, FFT_SIZE, BANDS),
    centroid: spectralCentroidHz(magnitudes, sampleRate, FFT_SIZE),
    frames,
  };
}

/**
 * Live-like: find first energetic hop, then average ~300ms of frames
 * (mirrors AudioMatcher captureAndMatch slice averaging).
 */
function extractLive300(samples, sampleRate = FP_SAMPLE_RATE) {
  const window = hannWindow(FFT_SIZE);
  const hop = Math.floor(FFT_SIZE / 4); // denser hops like rAF analyser polls
  const hopEnv = Math.max(1, Math.floor(sampleRate * 0.01));
  let onset = 0;
  let maxRms = 0;
  for (let i = 0; i + hopEnv <= samples.length; i += hopEnv) {
    let sum = 0;
    for (let k = 0; k < hopEnv; k++) sum += samples[i + k] * samples[i + k];
    const rms = Math.sqrt(sum / hopEnv);
    if (rms > maxRms) maxRms = rms;
  }
  const floor = Math.max(0.02, maxRms * 0.25);
  for (let i = 0; i + hopEnv <= samples.length; i += hopEnv) {
    let sum = 0;
    for (let k = 0; k < hopEnv; k++) sum += samples[i + k] * samples[i + k];
    if (Math.sqrt(sum / hopEnv) >= floor) {
      onset = i;
      break;
    }
  }

  const sliceSamples = Math.floor((LIVE_SLICE_MS / 1000) * sampleRate);
  const end = Math.min(samples.length, onset + sliceSamples);
  const bandAccum = new Array(BANDS).fill(0);
  const centroids = [];
  let frames = 0;
  for (let start = onset; start + FFT_SIZE <= end; start += hop) {
    const mag = frameMagnitude(samples, start, window, FFT_SIZE);
    const bands = magnitudeToBands(mag, sampleRate, FFT_SIZE, BANDS);
    for (let i = 0; i < BANDS; i++) bandAccum[i] += bands[i];
    centroids.push(spectralCentroidHz(mag, sampleRate, FFT_SIZE));
    frames++;
  }
  if (frames === 0) {
    return extractReextract(samples, sampleRate);
  }
  for (let i = 0; i < BANDS; i++) bandAccum[i] /= frames;
  const max = Math.max(...bandAccum, 1e-9);
  return {
    spectrumVector: bandAccum.map((v) => v / max),
    centroid: centroids.reduce((a, b) => a + b, 0) / centroids.length,
    frames,
    onsetMs: (onset / sampleRate) * 1000,
  };
}

function scoreOne(vec, centroid, fingerprints, ids, matchKind) {
  const ranked = matchSpectrumAgainstFingerprints(
    vec,
    fingerprints,
    ids,
    matchKind,
    centroid,
  );
  const top = ranked[0];
  const second = ranked[1];
  return {
    topId: top?.soundId ?? null,
    topKind: top?.kind ?? null,
    confidence: top?.confidence ?? 0,
    secondId: second?.soundId ?? null,
    secondConf: second?.confidence ?? 0,
    gap: top && second ? Number((top.confidence - second.confidence).toFixed(1)) : 99,
    ranked: ranked.slice(0, 5),
  };
}

function main() {
  const fingerprints = JSON.parse(readFileSync(FP_PATH, 'utf8'));
  const merchant = JSON.parse(readFileSync(MERCHANT_PATH, 'utf8'));
  const ids = merchant.soundIds.map((s) => s.soundId).sort((a, b) => a - b);
  const allIds = Object.keys(fingerprints.fingerprints).map(Number).sort((a, b) => a - b);

  const rows = [];
  let reextractHit = 0;
  let reextractN = 0;
  let liveHit = 0;
  let liveN = 0;
  let storedHit = 0;
  let storedN = 0;

  // Pickup-only: Field Merchant does not play drop when dragging cargo.
  for (const sound of merchant.soundIds) {
    const kind = 'pickup';
    const base = sound.pickupSound;
    const file = join(SOUNDS_DIR, `${base}.ogg`);
    const expected = sound.soundId;
    const row = {
      soundId: expected,
      kind,
      file: `${base}.ogg`,
      missing: !existsSync(file),
    };

    if (row.missing) {
      rows.push(row);
      continue;
    }

    // Sanity: stored fingerprint vector vs DB (should be ~100% to self)
    const stored = fingerprints.fingerprints[String(expected)]?.[kind];
    if (stored?.spectrumVector) {
      const s = scoreOne(stored.spectrumVector, stored.spectralCentroid, fingerprints, allIds, 'pickup');
      row.stored = s;
      storedN++;
      if (s.topId === expected) storedHit++;
    }

    try {
      const pcm = decodeOggToPcm(file, FP_SAMPLE_RATE);

      // "Re-extract" now means live300 (same window fingerprints were built with).
      const rex = extractLive300(pcm, FP_SAMPLE_RATE);
      const rAuto = scoreOne(rex.spectrumVector, rex.centroid, fingerprints, allIds, 'pickup');
      row.reextract = { ...rAuto, frames: rex.frames, onsetMs: rex.onsetMs };
      reextractN++;
      if (rAuto.topId === expected) reextractHit++;

      const live = extractLive300(pcm, FP_SAMPLE_RATE);
      const lAuto = scoreOne(live.spectrumVector, live.centroid, fingerprints, allIds, 'pickup');
      row.live300 = {
        ...lAuto,
        frames: live.frames,
        onsetMs: live.onsetMs,
      };
      liveN++;
      if (lAuto.topId === expected) liveHit++;
    } catch (err) {
      row.error = err.message;
    }

    rows.push(row);
  }

  const missesRe = rows.filter((r) => r.reextract && r.reextract.topId !== r.soundId);
  const missesLive = rows.filter((r) => r.live300 && r.live300.topId !== r.soundId);
  const nearTiesLive = rows.filter(
    (r) => r.live300 && r.live300.topId === r.soundId && r.live300.gap < NEAR_TIE_GAP,
  );
  const nearTiesWrong = rows.filter(
    (r) => r.live300 && r.live300.topId !== r.soundId && r.live300.gap < NEAR_TIE_GAP,
  );

  mkdirSync(STORE_INTERNAL, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    soundCount: ids.length,
    filesTested: { reextract: reextractN, live300: liveN, storedSelf: storedN },
    passRate: {
      storedSelf: storedN ? storedHit / storedN : 0,
      reextractAuto: reextractN ? reextractHit / reextractN : 0,
      live300Auto: liveN ? liveHit / liveN : 0,
    },
    missCounts: { reextract: missesRe.length, live300: missesLive.length },
    nearTieCorrectLive: nearTiesLive.length,
    nearTieWrongLive: nearTiesWrong.length,
  };

  writeFileSync(
    OUT_JSON,
    JSON.stringify({ summary, rows }, null, 2),
  );

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const lines = [];
  lines.push('---');
  lines.push('cursor:');
  lines.push('  subagentId: "bc-16755c49-fc7c-5eac-8b94-7b0f6ed7ab2b"');
  lines.push('---');
  lines.push('');
  lines.push('# Offline fingerprint self-test');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Mode | Pass rate | N | Misses |');
  lines.push('|------|-----------|---|--------|');
  lines.push(
    `| Stored vector → self (sanity) | **${pct(summary.passRate.storedSelf)}** | ${storedN} | ${storedN - storedHit} |`,
  );
  lines.push(
    `| Re-extract live300 (= fingerprint window) | **${pct(summary.passRate.reextractAuto)}** | ${reextractN} | ${missesRe.length} |`,
  );
  lines.push(
    `| Live300 pickup-only | **${pct(summary.passRate.live300Auto)}** | ${liveN} | ${missesLive.length} |`,
  );
  lines.push('');
  lines.push(
    `Near-ties (correct but gap < ${NEAR_TIE_GAP}pt, live300): ${nearTiesLive.length}. Wrong near-ties: ${nearTiesWrong.length}.`,
  );
  lines.push('');
  lines.push(
    `Fingerprint meta: matchSide=${fingerprints.matchSide || 'n/a'} windowMs=${fingerprints.windowMs || 'n/a'} analysis=${fingerprints.analysis || 'n/a'}`,
  );
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push(
    '- **Pickup-only:** Field Merchant drag plays pickup; drop vectors are ignored.',
  );
  lines.push(
    '- **Stored self** must be ~100% (cosine of fingerprint vs itself).',
  );
  lines.push(
    '- **Live300** averages ~300ms after onset — same window used to build `fingerprints.json`. Pass rate should be high if generator and matcher agree.',
  );
  lines.push('');

  if (missesLive.length) {
    lines.push('## Live300 misses');
    lines.push('');
    lines.push('| Expected | Kind | File | Top | Conf | #2 | Gap |');
    lines.push('|----------|------|------|-----|------|----|-----|');
    for (const r of missesLive) {
      const m = r.live300;
      lines.push(
        `| ${r.soundId} | ${r.kind} | ${r.file} | #${m.topId} (${m.topKind}) | ${m.confidence}% | #${m.secondId} ${m.secondConf}% | ${m.gap} |`,
      );
    }
    lines.push('');
  }

  if (missesRe.length) {
    lines.push('## Re-extract misses');
    lines.push('');
    lines.push('| Expected | Kind | File | Top | Conf | #2 | Gap |');
    lines.push('|----------|------|------|-----|------|----|-----|');
    for (const r of missesRe) {
      const m = r.reextract;
      lines.push(
        `| ${r.soundId} | ${r.kind} | ${r.file} | #${m.topId} (${m.topKind}) | ${m.confidence}% | #${m.secondId} ${m.secondConf}% | ${m.gap} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Per-file live300 (auto)');
  lines.push('');
  lines.push('| ID | Kind | Top | Conf | Gap | Flag |');
  lines.push('|----|------|-----|------|-----|------|');
  for (const r of rows) {
    if (!r.live300) {
      lines.push(`| ${r.soundId} | ${r.kind} | — | — | — | ${r.missing ? 'MISSING' : r.error || 'ERR'} |`);
      continue;
    }
    const m = r.live300;
    const ok = m.topId === r.soundId;
    const flag = !ok ? 'MISS' : m.gap < NEAR_TIE_GAP ? 'NEAR-TIE' : 'OK';
    lines.push(
      `| ${r.soundId} | ${r.kind} | #${m.topId} | ${m.confidence}% | ${m.gap} | ${flag} |`,
    );
  }
  lines.push('');

  // Root-cause note
  const liveRate = summary.passRate.live300Auto;
  const reRate = summary.passRate.reextractAuto;
  lines.push('## Root-cause note');
  lines.push('');
  if (liveRate >= 0.95) {
    lines.push(
      'Pickup-only live300 fingerprints look healthy offline. Remaining shop misses are more likely capture/onset/gating (mic level, burst threshold) or near-tie clusters than ID map errors.',
    );
  } else if (liveRate >= 0.85) {
    lines.push(
      'Pickup live300 is improved but still has misses/near-ties among similar clusters — consider burst multi-spike averaging and margin rules.',
    );
  } else {
    lines.push(
      '**Pickup live300 still weak:** regenerate via `npm run fingerprints` or inspect shared/confused OGGs among near-tie soundIds.',
    );
  }
  lines.push('');

  writeFileSync(OUT_MD, lines.join('\n'));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${OUT_MD}`);
  console.log(`wrote ${OUT_JSON}`);
}

main();
