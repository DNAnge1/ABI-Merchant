#!/usr/bin/env node
/**
 * Fingerprint representation Step-1 baseline scoreboard (ABI-108).
 *
 * Offline harness — no matcher DSP rewrite. Reports:
 *   1. Cosine-input diagnosis (non-neg band avgs? Up/Down blended?)
 *   2. Pairwise focus: #2↔#8, #8↔#20, #8↔#7 (clean + simple muffle)
 *   3. 38-group Top-1 (clean + muffled) against fingerprints.json
 *   4. Labeled field WAVs under the Project media/ tree
 *
 * Usage:
 *   node scripts/fingerprintScoreboard.mjs
 *   npm run selftest:scoreboard
 *
 * Writes:
 *   /cursor/stores/.../docs/fingerprint-baseline.md
 *   /cursor/stores/.../internal/fingerprint-baseline.json
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOUNDS_DIR = join(ROOT, 'public/sounds');
const FP_PATH = join(ROOT, 'src/data/fingerprints.json');
const MERCHANT_PATH = join(ROOT, 'src/data/merchantData.json');
const PKG_PATH = join(ROOT, 'package.json');

const STORE = '/cursor/stores/bc-5c080d60-6249-418b-b13a-8bf42c7f6cd6';
const MEDIA_ROOT = join(STORE, 'media');
const OUT_MD = join(STORE, 'docs/fingerprint-baseline.md');
const OUT_JSON = join(STORE, 'internal/fingerprint-baseline.json');

const FFT_SIZE = 2048;
const BANDS = 32;
const FP_SAMPLE_RATE = 22050;
const LIVE_SLICE_MS = 300;
const FP_NYQUIST_HZ = 11025;
const CENTROID_MIN_HZ = 50;
const FOCUS_IDS = [2, 8, 20, 7];
const FOCUS_PAIRS = [
  [2, 8],
  [8, 20],
  [8, 7],
];
/** Simple one-pole lowpass ~2.5 kHz @ 22.05 kHz — reproducible "muffle" baseline. */
const MUFFLE_CUTOFF_HZ = 2500;

const FIELD_MEDIA_DIRS = [
  'id2-vs-id8',
  'id2-vs-id8-round2',
  'id2-vs-id8-round3',
  'burst-wav-diagnosis',
  'burst-oct29',
];

/** Explicit labels when filename parsing is ambiguous. */
const FIELD_LABEL_OVERRIDES = {
  'expander-claimed-as-lion.wav': 17,
  'TEASET_NObLOWTORCH.wav': 32,
  'battery-claimed.wav': 6,
  'lion-battery.wav': 28,
  'toolbox-claimed.wav': 19,
  'vector-pro-mislock-as-19.wav': 10,
  // burst-wav-diagnosis: Brent notes first clip likely expander (#17)
  'abi-burst-capture-1795741089511_d6e2.wav': 17,
  'abi-burst-capture-1795743380451_810d.wav': 17,
};

function decodeAudioToPcm(filePath, sampleRate = FP_SAMPLE_RATE) {
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
    { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() || `ffmpeg failed: ${filePath}`);
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

function interpolateEmptyBands(bandVec, bandCounts) {
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
  interpolateEmptyBands(bandVec, bandCounts);
  const max = Math.max(...bandVec, 1e-9);
  return bandVec.map((v) => v / max);
}

function spectralCentroidHz(magnitudes, sampleRate, fftSize) {
  let num = 0;
  let den = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < CENTROID_MIN_HZ || freq > FP_NYQUIST_HZ) continue;
    num += freq * magnitudes[i];
    den += magnitudes[i];
  }
  if (den <= 0) return 0;
  return Math.min(FP_NYQUIST_HZ, Math.max(CENTROID_MIN_HZ, num / den));
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

function l2Distance(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function highBandRatio(vec) {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  const upper = vec.slice(16).reduce((s, v) => s + v, 0);
  return upper / total;
}

function bassLobeRatio(vec) {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  let bass = 0;
  for (let i = 0; i < Math.min(4, vec.length); i++) bass += vec[i];
  return bass / total;
}

function midLobeRatio(vec) {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  let mid = 0;
  for (let i = 4; i <= 9 && i < vec.length; i++) mid += vec[i];
  return mid / total;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

/**
 * Mirror of audioMatcher.matchSpectrumAgainstFingerprints (pickup + live priors).
 * Centroid: non-#10 → 1400 Hz / 0.28; #10 → 2000 Hz / 0.2.
 */
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
        spectralCentroid: side.spectralCentroid,
        rawCos: round4(rawCos),
        shapeCos: round4(shapeCos),
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

/** Live300 post-onset bin-avg — same window fingerprints were built with. */
function extractLive300(samples, sampleRate = FP_SAMPLE_RATE) {
  const window = hannWindow(FFT_SIZE);
  const hop = Math.floor(FFT_SIZE / 4);
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
    const mag = frameMagnitude(samples, Math.max(0, samples.length - FFT_SIZE), window, FFT_SIZE);
    const bands = magnitudeToBands(mag, sampleRate, FFT_SIZE, BANDS);
    return {
      spectrumVector: bands,
      centroid: spectralCentroidHz(mag, sampleRate, FFT_SIZE),
      frames: 1,
      onsetMs: (onset / sampleRate) * 1000,
      peakAbs: peakAbs(samples),
    };
  }
  for (let i = 0; i < BANDS; i++) bandAccum[i] /= frames;
  const max = Math.max(...bandAccum, 1e-9);
  return {
    spectrumVector: bandAccum.map((v) => v / max),
    centroid: centroids.reduce((a, b) => a + b, 0) / centroids.length,
    frames,
    onsetMs: (onset / sampleRate) * 1000,
    peakAbs: peakAbs(samples),
  };
}

function peakAbs(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
}

/** One-pole lowpass — simple reproducible muffle (not the future calibrated path). */
function applySimpleMuffle(samples, sampleRate = FP_SAMPLE_RATE, cutoffHz = MUFFLE_CUTOFF_HZ) {
  const out = new Float32Array(samples.length);
  const x = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = (1 - x) * samples[i] + x * prev;
    out[i] = prev;
  }
  return out;
}

function scoreOne(vec, centroid, fingerprints, ids) {
  const ranked = matchSpectrumAgainstFingerprints(vec, fingerprints, ids, 'pickup', centroid);
  const top = ranked[0];
  const second = ranked[1];
  const expectedRank = (expectedId) => {
    const idx = ranked.findIndex((r) => r.soundId === expectedId);
    return idx < 0 ? null : idx + 1;
  };
  return {
    topId: top?.soundId ?? null,
    confidence: top?.confidence ?? 0,
    secondId: second?.soundId ?? null,
    secondConf: second?.confidence ?? 0,
    gap: top && second ? round1(top.confidence - second.confidence) : 99,
    rawCosTop: top?.rawCos ?? null,
    ranked: ranked.slice(0, 5),
    expectedRank,
  };
}

function pairMetrics(va, vb, ca, cb) {
  return {
    cosine: round4(cosineSimilarity(va, vb)),
    centeredCosine: round4(centeredCosine(va, vb)),
    l2: round4(l2Distance(va, vb)),
    centroidDeltaHz: Math.round(Math.abs(ca - cb)),
    highBandDelta: round4(Math.abs(highBandRatio(va) - highBandRatio(vb))),
    bassA: round4(bassLobeRatio(va)),
    bassB: round4(bassLobeRatio(vb)),
    midA: round4(midLobeRatio(va)),
    midB: round4(midLobeRatio(vb)),
  };
}

function vectorStats(vec) {
  const min = Math.min(...vec);
  const max = Math.max(...vec);
  const neg = vec.filter((x) => x < 0).length;
  const zero = vec.filter((x) => x === 0).length;
  return { bands: vec.length, min: round4(min), max: round4(max), neg, zero };
}

function diagnoseCosineInputs(fingerprints, merchant) {
  const focus = {};
  for (const id of FOCUS_IDS) {
    const fp = fingerprints.fingerprints[String(id)];
    const side = fp?.pickup;
    if (!side?.spectrumVector) continue;
    focus[id] = {
      itemNames: fp.itemNames,
      file: side.file,
      name: side.name,
      centroid: side.spectralCentroid,
      windowMs: side.windowMs,
      ...vectorStats(side.spectrumVector),
      bass: round4(bassLobeRatio(side.spectrumVector)),
      mid: round4(midLobeRatio(side.spectrumVector)),
      high: round4(highBandRatio(side.spectrumVector)),
    };
  }

  const allVecs = Object.values(fingerprints.fingerprints)
    .map((f) => f.pickup?.spectrumVector)
    .filter(Boolean);
  const anyNeg = allVecs.some((v) => v.some((x) => x < 0));
  const dropPresent = Object.values(fingerprints.fingerprints).filter((f) => f.drop).length;

  // Optional: Up vs Down live300 for focus #2/#8 when Down OGGs exist
  const upDown = {};
  for (const id of [2, 8]) {
    const sound = merchant.soundIds.find((s) => s.soundId === id);
    if (!sound) continue;
    const upPath = join(SOUNDS_DIR, `${sound.pickupSound}.ogg`);
    const downPath = join(SOUNDS_DIR, `${sound.dropSound}.ogg`);
    if (!existsSync(upPath) || !existsSync(downPath)) continue;
    try {
      const up = extractLive300(decodeAudioToPcm(upPath));
      const down = extractLive300(decodeAudioToPcm(downPath));
      const blendRaw = up.spectrumVector.map((v, i) => (v + down.spectrumVector[i]) / 2);
      const blendMax = Math.max(...blendRaw, 1e-9);
      const blend = blendRaw.map((v) => v / blendMax);
      upDown[id] = {
        pickupFile: sound.pickupSound,
        dropFile: sound.dropSound,
        upVsDownCosine: round4(cosineSimilarity(up.spectrumVector, down.spectrumVector)),
        upCentroid: round1(up.centroid),
        downCentroid: round1(down.centroid),
        blendReady: true,
        blend,
        up: up.spectrumVector,
        down: down.spectrumVector,
      };
    } catch (err) {
      upDown[id] = { error: err.message };
    }
  }

  let blendPair = null;
  if (upDown[2]?.blend && upDown[8]?.blend) {
    blendPair = {
      upOnlyCosine: round4(cosineSimilarity(upDown[2].up, upDown[8].up)),
      downOnlyCosine: round4(cosineSimilarity(upDown[2].down, upDown[8].down)),
      blendCosine: round4(cosineSimilarity(upDown[2].blend, upDown[8].blend)),
    };
  }

  // Largest band gaps for stored #2 vs #8
  const v2 = fingerprints.fingerprints['2']?.pickup?.spectrumVector;
  const v8 = fingerprints.fingerprints['8']?.pickup?.spectrumVector;
  let bandGaps = [];
  if (v2 && v8) {
    bandGaps = v2
      .map((v, i) => ({ band: i, a: v, b: v8[i], abs: Math.abs(v - v8[i]) }))
      .sort((x, y) => y.abs - x.abs)
      .slice(0, 8)
      .map((g) => ({
        band: g.band,
        id2: round4(g.a),
        id8: round4(g.b),
        abs: round4(g.abs),
      }));
  }

  return {
    meta: {
      generatedAt: fingerprints.generatedAt,
      matchSide: fingerprints.matchSide,
      windowMs: fingerprints.windowMs,
      analysis: fingerprints.analysis,
      vectorBands: fingerprints.vectorBands,
      sampleRate: fingerprints.sampleRate,
      fftSize: fingerprints.fftSize,
    },
    allVectorsNonNegative: !anyNeg,
    dropSidesInJson: dropPresent,
    pickupOnly: fingerprints.matchSide === 'pickup' && dropPresent === 0,
    focus,
    bandGaps2vs8: bandGaps,
    upDownProbe: Object.fromEntries(
      Object.entries(upDown).map(([id, v]) => [
        id,
        {
          pickupFile: v.pickupFile,
          dropFile: v.dropFile,
          upVsDownCosine: v.upVsDownCosine,
          upCentroid: v.upCentroid,
          downCentroid: v.downCentroid,
          error: v.error,
        },
      ]),
    ),
    blendPair2vs8: blendPair,
    verdict: [
      'Cosine inputs are non-negative peak-normalized 32-band log averages (live300-post-onset-binavg).',
      'Fingerprints are pickup-only (Up.ogg); drop sides are null — not Up/Down blended.',
      blendPair
        ? `Stored/re-extract Up↔Up #2/#8 cos≈${blendPair.upOnlyCosine}; hypothetical Up/Down blend would drop to ≈${blendPair.blendCosine}; Down↔Down ≈${blendPair.downOnlyCosine}.`
        : 'Up/Down blend probe unavailable.',
      'All-positive broadband vectors keep #2↔#8 near-twin (cos≈0.94) despite bass/mid lobe gaps.',
    ],
  };
}

function loadPickupPcm(merchant, soundId) {
  const sound = merchant.soundIds.find((s) => s.soundId === soundId);
  if (!sound) return null;
  const file = join(SOUNDS_DIR, `${sound.pickupSound}.ogg`);
  if (!existsSync(file)) return null;
  return {
    sound,
    file,
    pcm: decodeAudioToPcm(file),
  };
}

function runPairwise(fingerprints, merchant, allIds) {
  const cached = {};
  for (const id of FOCUS_IDS) {
    const loaded = loadPickupPcm(merchant, id);
    if (!loaded) continue;
    const clean = extractLive300(loaded.pcm);
    const muffled = extractLive300(applySimpleMuffle(loaded.pcm));
    const stored = fingerprints.fingerprints[String(id)]?.pickup;
    cached[id] = {
      name: loaded.sound.pickupSound,
      stored: stored?.spectrumVector,
      storedCentroid: stored?.spectralCentroid,
      clean,
      muffled,
    };
  }

  const pairs = [];
  for (const [a, b] of FOCUS_PAIRS) {
    const A = cached[a];
    const B = cached[b];
    if (!A?.stored || !B?.stored) continue;
    const storedPair = pairMetrics(A.stored, B.stored, A.storedCentroid, B.storedCentroid);
    const cleanPair = pairMetrics(
      A.clean.spectrumVector,
      B.clean.spectrumVector,
      A.clean.centroid,
      B.clean.centroid,
    );
    const muffPair = pairMetrics(
      A.muffled.spectrumVector,
      B.muffled.spectrumVector,
      A.muffled.centroid,
      B.muffled.centroid,
    );
    // Cross: muffled query A vs stored B / A (Top confusion cue)
    const muffAvsFp = scoreOne(A.muffled.spectrumVector, A.muffled.centroid, fingerprints, allIds);
    const muffBvsFp = scoreOne(B.muffled.spectrumVector, B.muffled.centroid, fingerprints, allIds);
    const cleanAvsFp = scoreOne(A.clean.spectrumVector, A.clean.centroid, fingerprints, allIds);
    const cleanBvsFp = scoreOne(B.clean.spectrumVector, B.clean.centroid, fingerprints, allIds);
    pairs.push({
      a,
      b,
      stored: storedPair,
      cleanReextract: cleanPair,
      muffled: muffPair,
      cleanTop1: {
        a: { expected: a, topId: cleanAvsFp.topId, conf: cleanAvsFp.confidence, gap: cleanAvsFp.gap },
        b: { expected: b, topId: cleanBvsFp.topId, conf: cleanBvsFp.confidence, gap: cleanBvsFp.gap },
      },
      muffledTop1: {
        a: { expected: a, topId: muffAvsFp.topId, conf: muffAvsFp.confidence, gap: muffAvsFp.gap },
        b: { expected: b, topId: muffBvsFp.topId, conf: muffBvsFp.confidence, gap: muffBvsFp.gap },
      },
    });
  }
  return pairs;
}

function runTop1(fingerprints, merchant, allIds) {
  const rows = [];
  let cleanHit = 0;
  let muffHit = 0;
  let n = 0;
  for (const sound of merchant.soundIds) {
    const file = join(SOUNDS_DIR, `${sound.pickupSound}.ogg`);
    const row = {
      soundId: sound.soundId,
      file: `${sound.pickupSound}.ogg`,
      missing: !existsSync(file),
    };
    if (row.missing) {
      rows.push(row);
      continue;
    }
    try {
      const pcm = decodeAudioToPcm(file);
      const clean = extractLive300(pcm);
      const muff = extractLive300(applySimpleMuffle(pcm));
      const c = scoreOne(clean.spectrumVector, clean.centroid, fingerprints, allIds);
      const m = scoreOne(muff.spectrumVector, muff.centroid, fingerprints, allIds);
      row.clean = {
        topId: c.topId,
        conf: c.confidence,
        secondId: c.secondId,
        gap: c.gap,
        ok: c.topId === sound.soundId,
        onsetMs: round1(clean.onsetMs),
      };
      row.muffled = {
        topId: m.topId,
        conf: m.confidence,
        secondId: m.secondId,
        gap: m.gap,
        ok: m.topId === sound.soundId,
        onsetMs: round1(muff.onsetMs),
      };
      n++;
      if (row.clean.ok) cleanHit++;
      if (row.muffled.ok) muffHit++;
    } catch (err) {
      row.error = err.message;
    }
    rows.push(row);
  }
  return {
    n,
    cleanPass: n ? cleanHit / n : 0,
    muffledPass: n ? muffHit / n : 0,
    cleanMisses: rows.filter((r) => r.clean && !r.clean.ok).map((r) => ({
      soundId: r.soundId,
      topId: r.clean.topId,
      conf: r.clean.conf,
      secondId: r.clean.secondId,
      gap: r.clean.gap,
    })),
    muffledMisses: rows.filter((r) => r.muffled && !r.muffled.ok).map((r) => ({
      soundId: r.soundId,
      topId: r.muffled.topId,
      conf: r.muffled.conf,
      secondId: r.muffled.secondId,
      gap: r.muffled.gap,
    })),
    rows,
  };
}

function parseFieldLabel(fileName) {
  if (FIELD_LABEL_OVERRIDES[fileName] != null) {
    return { expectedId: FIELD_LABEL_OVERRIDES[fileName], source: 'override' };
  }
  const expPred = fileName.match(/clip-exp(\d+)-pred(\d+)/i);
  if (expPred) {
    return {
      expectedId: Number(expPred[1]),
      predictedHint: Number(expPred[2]),
      source: 'clip-exp',
    };
  }
  const leading = fileName.match(/^(\d+)[-_]/);
  if (leading) {
    return { expectedId: Number(leading[1]), source: 'leading-id' };
  }
  return null;
}

function walkWavs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkWavs(p, out);
    else if (/\.wav$/i.test(name)) out.push(p);
  }
  return out;
}

function discoverLabeledFieldWavs() {
  const found = [];
  for (const sub of FIELD_MEDIA_DIRS) {
    const dir = join(MEDIA_ROOT, sub);
    for (const path of walkWavs(dir)) {
      const name = basename(path);
      const label = parseFieldLabel(name);
      if (!label) continue;
      found.push({
        path,
        rel: relative(MEDIA_ROOT, path),
        file: name,
        expectedId: label.expectedId,
        predictedHint: label.predictedHint ?? null,
        labelSource: label.source,
      });
    }
  }
  // Also pick up root-level labeled media WAV if any (TEASET etc.)
  if (existsSync(MEDIA_ROOT)) {
    for (const name of readdirSync(MEDIA_ROOT)) {
      if (!/\.wav$/i.test(name)) continue;
      const label = parseFieldLabel(name);
      if (!label) continue;
      found.push({
        path: join(MEDIA_ROOT, name),
        rel: name,
        file: name,
        expectedId: label.expectedId,
        predictedHint: null,
        labelSource: label.source,
      });
    }
  }
  // Dedupe by basename preferring longer path (round folders)
  const byName = new Map();
  for (const f of found) {
    const prev = byName.get(f.file);
    if (!prev || f.rel.length > prev.rel.length) byName.set(f.file, f);
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.rel.localeCompare(b.rel),
  );
}

function runFieldWavs(fingerprints, allIds) {
  const clips = discoverLabeledFieldWavs();
  const rows = [];
  let scored = 0;
  let hit = 0;
  let silent = 0;
  for (const clip of clips) {
    const row = {
      rel: clip.rel,
      expectedId: clip.expectedId,
      predictedHint: clip.predictedHint,
      labelSource: clip.labelSource,
    };
    try {
      const pcm = decodeAudioToPcm(clip.path);
      const peak = peakAbs(pcm);
      if (peak < 1e-5) {
        row.silent = true;
        silent++;
        rows.push(row);
        continue;
      }
      const live = extractLive300(pcm);
      const s = scoreOne(live.spectrumVector, live.centroid, fingerprints, allIds);
      const expRank = s.expectedRank(clip.expectedId);
      const exp = s.ranked.find((r) => r.soundId === clip.expectedId);
      row.peakAbs = round4(peak);
      row.onsetMs = round1(live.onsetMs);
      row.centroid = round1(live.centroid);
      row.topId = s.topId;
      row.conf = s.confidence;
      row.secondId = s.secondId;
      row.gap = s.gap;
      row.expectedRank = expRank;
      row.expectedConf = exp?.confidence ?? null;
      row.ok = s.topId === clip.expectedId;
      row.bass = round4(bassLobeRatio(live.spectrumVector));
      row.mid = round4(midLobeRatio(live.spectrumVector));
      scored++;
      if (row.ok) hit++;
    } catch (err) {
      row.error = err.message;
    }
    rows.push(row);
  }
  return {
    discovered: clips.length,
    scored,
    silent,
    pass: scored ? hit / scored : 0,
    hits: hit,
    rows,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function renderMarkdown(pkgVersion, report) {
  const lines = [];
  lines.push('---');
  lines.push('title: Fingerprint representation Step 1 baseline');
  lines.push(`version: ${pkgVersion}`);
  lines.push('status: baseline');
  lines.push('tracker: ABI-108');
  lines.push('---');
  lines.push('');
  lines.push('# Fingerprint baseline scoreboard (Step 1)');
  lines.push('');
  lines.push(
    `**Harness:** \`npm run selftest:scoreboard\` · **App:** \`${pkgVersion}\` · **Generated:** ${report.generatedAt}`,
  );
  lines.push('');
  lines.push(
    'Surgical Step 1 only — diagnose cosine inputs + print offline scoreboard. No tilt/contrast, peak-anchored, Up/Down blend, or calibrated-muffle rewrite yet.',
  );
  lines.push('');

  lines.push('## Why #2 vs #8 cosine ≈ 0.94');
  lines.push('');
  for (const v of report.diagnosis.verdict) {
    lines.push(`- ${v}`);
  }
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Analysis | \`${report.diagnosis.meta.analysis}\` |`);
  lines.push(`| matchSide | \`${report.diagnosis.meta.matchSide}\` |`);
  lines.push(`| windowMs | ${report.diagnosis.meta.windowMs} |`);
  lines.push(`| vectorBands | ${report.diagnosis.meta.vectorBands} |`);
  lines.push(
    `| All FP bands non-negative | **${report.diagnosis.allVectorsNonNegative ? 'yes' : 'no'}** |`,
  );
  lines.push(
    `| Drop sides in fingerprints.json | **${report.diagnosis.dropSidesInJson}** (pickup-only) |`,
  );
  if (report.diagnosis.blendPair2vs8) {
    const b = report.diagnosis.blendPair2vs8;
    lines.push(`| #2↔#8 Up↔Up cosine | **${b.upOnlyCosine}** |`);
    lines.push(`| #2↔#8 Down↔Down cosine | ${b.downOnlyCosine} |`);
    lines.push(`| #2↔#8 hypothetical Up/Down blend | ${b.blendCosine} |`);
  }
  lines.push('');

  lines.push('### Focus fingerprint vectors');
  lines.push('');
  lines.push('| ID | File | Centroid | Bass | Mid | High | Min band |');
  lines.push('|----|------|----------|------|-----|------|----------|');
  for (const id of FOCUS_IDS) {
    const f = report.diagnosis.focus[id];
    if (!f) continue;
    lines.push(
      `| #${id} | \`${f.name}\` | ${f.centroid} Hz | ${f.bass} | ${f.mid} | ${f.high} | ${f.min} |`,
    );
  }
  lines.push('');

  if (report.diagnosis.bandGaps2vs8?.length) {
    lines.push('### Largest stored band gaps (#2 vs #8)');
    lines.push('');
    lines.push('| Band | #2 | #8 | \\|Δ\\| |');
    lines.push('|------|----|----|-----|');
    for (const g of report.diagnosis.bandGaps2vs8) {
      lines.push(`| ${g.band} | ${g.id2} | ${g.id8} | ${g.abs} |`);
    }
    lines.push('');
  }

  lines.push('## Pairwise focus (clean + muffled)');
  lines.push('');
  lines.push(
    `Muffle = one-pole lowpass @ ${MUFFLE_CUTOFF_HZ} Hz (stress probe only — deliberately harsher than typical mic dulling; calibrated muffle waits for greenlight).`,
  );
  lines.push('');
  lines.push(
    'Note: muffled **pairwise cosine stays ~0.94** for #2↔#8 — LP does not separate the twins; both queries instead sink toward dull neighbors (often #28) in Top-1.',
  );
  lines.push('');
  lines.push('| Pair | Stored cos | Clean cos | Muffled cos | Clean Top-1 A/B | Muffled Top-1 A/B |');
  lines.push('|------|------------|-----------|-------------|-----------------|-------------------|');
  for (const p of report.pairwise) {
    const cA = p.cleanTop1.a;
    const cB = p.cleanTop1.b;
    const mA = p.muffledTop1.a;
    const mB = p.muffledTop1.b;
    const fmt = (x) =>
      `#${x.expected}→#${x.topId}@${x.conf}%${x.topId === x.expected ? '' : ' MISS'}`;
    lines.push(
      `| #${p.a}↔#${p.b} | **${p.stored.cosine}** | ${p.cleanReextract.cosine} | ${p.muffled.cosine} | ${fmt(cA)} / ${fmt(cB)} | ${fmt(mA)} / ${fmt(mB)} |`,
    );
  }
  lines.push('');
  lines.push('| Pair | Stored ccos | L2 | Cent ΔHz | Bass A/B | Mid A/B |');
  lines.push('|------|-------------|----|----------|----------|---------|');
  for (const p of report.pairwise) {
    const s = p.stored;
    lines.push(
      `| #${p.a}↔#${p.b} | ${s.centeredCosine} | ${s.l2} | ${s.centroidDeltaHz} | ${s.bassA}/${s.bassB} | ${s.midA}/${s.midB} |`,
    );
  }
  lines.push('');

  lines.push('## 38-group Top-1 (pickup live300)');
  lines.push('');
  lines.push('| Mode | Pass | N | Misses |');
  lines.push('|------|------|---|--------|');
  lines.push(
    `| Clean | **${pct(report.top1.cleanPass)}** | ${report.top1.n} | ${report.top1.cleanMisses.length} |`,
  );
  lines.push(
    `| Muffled (${MUFFLE_CUTOFF_HZ} Hz LP) | **${pct(report.top1.muffledPass)}** | ${report.top1.n} | ${report.top1.muffledMisses.length} |`,
  );
  lines.push('');

  if (report.top1.cleanMisses.length) {
    lines.push('### Clean misses');
    lines.push('');
    lines.push('| Expected | Top | Conf | #2 | Gap |');
    lines.push('|----------|-----|------|----|-----|');
    for (const m of report.top1.cleanMisses) {
      lines.push(`| #${m.soundId} | #${m.topId} | ${m.conf}% | #${m.secondId} | ${m.gap} |`);
    }
    lines.push('');
  } else {
    lines.push('Clean: **0 misses** (38/38).');
    lines.push('');
  }

  if (report.top1.muffledMisses.length) {
    lines.push('### Muffled misses');
    lines.push('');
    lines.push('| Expected | Top | Conf | #2 | Gap |');
    lines.push('|----------|-----|------|----|-----|');
    for (const m of report.top1.muffledMisses) {
      lines.push(`| #${m.soundId} | #${m.topId} | ${m.conf}% | #${m.secondId} | ${m.gap} |`);
    }
    lines.push('');
  } else {
    lines.push('Muffled: **0 misses**.');
    lines.push('');
  }

  lines.push('### Per-ID Top-1');
  lines.push('');
  lines.push('| ID | Clean top | Conf | Gap | Muff top | Conf | Gap | Flag |');
  lines.push('|----|-----------|------|-----|----------|------|-----|------|');
  for (const r of report.top1.rows) {
    if (!r.clean) {
      lines.push(`| ${r.soundId} | — | — | — | — | — | — | ${r.missing ? 'MISSING' : r.error || 'ERR'} |`);
      continue;
    }
    const flag = !r.clean.ok
      ? 'CLEAN-MISS'
      : !r.muffled.ok
        ? 'MUFF-MISS'
        : r.clean.gap < 3
          ? 'NEAR-TIE'
          : 'OK';
    lines.push(
      `| ${r.soundId} | #${r.clean.topId} | ${r.clean.conf}% | ${r.clean.gap} | #${r.muffled.topId} | ${r.muffled.conf}% | ${r.muffled.gap} | ${flag} |`,
    );
  }
  lines.push('');

  lines.push('## Labeled field WAVs');
  lines.push('');
  lines.push(
    `Scanned \`${FIELD_MEDIA_DIRS.join('`, `')}\` (+ media root). Labels from \`clip-expN-\`, leading \`N-\`, or overrides (expander→#17, etc.).`,
  );
  lines.push('');
  lines.push(
    `| Scored | Pass | Silent skipped | Discovered |`,
  );
  lines.push('|--------|------|----------------|------------|');
  lines.push(
    `| ${report.field.scored} | **${pct(report.field.pass)}** (${report.field.hits}/${report.field.scored}) | ${report.field.silent} | ${report.field.discovered} |`,
  );
  lines.push('');
  lines.push('| File | Exp | Top | Conf | Rank(exp) | Gap | Bass/Mid | Flag |');
  lines.push('|------|-----|-----|------|-----------|-----|----------|------|');
  for (const r of report.field.rows) {
    if (r.silent) {
      lines.push(`| \`${r.rel}\` | #${r.expectedId} | — | — | — | — | — | SILENT |`);
      continue;
    }
    if (r.error) {
      lines.push(`| \`${r.rel}\` | #${r.expectedId} | — | — | — | — | — | ERR |`);
      continue;
    }
    const flag = r.ok ? 'OK' : 'MISS';
    lines.push(
      `| \`${r.rel}\` | #${r.expectedId} | #${r.topId} | ${r.conf}% | ${r.expectedRank ?? '—'} | ${r.gap} | ${r.bass}/${r.mid} | ${flag} |`,
    );
  }
  lines.push('');

  lines.push('## Next (await greenlight)');
  lines.push('');
  lines.push('1. Tilt / contrast features');
  lines.push('2. Peak-anchored windows');
  lines.push('3. Up/Down blend or dual-side FP (blend alone drops #2↔#8 cos ~0.94→~0.86 offline)');
  lines.push('4. Calibrated muffle (replace this baseline LP probe)');
  lines.push('');
  lines.push('## Machine JSON');
  lines.push('');
  lines.push('`internal/fingerprint-baseline.json`');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  const fingerprints = JSON.parse(readFileSync(FP_PATH, 'utf8'));
  const merchant = JSON.parse(readFileSync(MERCHANT_PATH, 'utf8'));
  const allIds = Object.keys(fingerprints.fingerprints)
    .map(Number)
    .sort((a, b) => a - b);

  console.log('[scoreboard] diagnosing cosine inputs…');
  const diagnosis = diagnoseCosineInputs(fingerprints, merchant);
  console.log('[scoreboard] pairwise focus clean+muffled…');
  const pairwise = runPairwise(fingerprints, merchant, allIds);
  console.log('[scoreboard] 38-group Top-1 clean+muffled…');
  const top1 = runTop1(fingerprints, merchant, allIds);
  console.log('[scoreboard] labeled field WAVs…');
  const field = runFieldWavs(fingerprints, allIds);

  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: pkg.version,
    muffleCutoffHz: MUFFLE_CUTOFF_HZ,
    diagnosis,
    pairwise,
    top1: {
      n: top1.n,
      cleanPass: top1.cleanPass,
      muffledPass: top1.muffledPass,
      cleanMisses: top1.cleanMisses,
      muffledMisses: top1.muffledMisses,
      rows: top1.rows,
    },
    field,
  };

  mkdirSync(dirname(OUT_MD), { recursive: true });
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeFileSync(OUT_MD, renderMarkdown(pkg.version, report));

  const summary = {
    appVersion: pkg.version,
    stored2vs8: pairwise.find((p) => p.a === 2 && p.b === 8)?.stored?.cosine,
    blend2vs8: diagnosis.blendPair2vs8,
    top1Clean: pct(top1.cleanPass),
    top1Muffled: pct(top1.muffledPass),
    fieldPass: `${field.hits}/${field.scored}`,
    outMd: OUT_MD,
    outJson: OUT_JSON,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
