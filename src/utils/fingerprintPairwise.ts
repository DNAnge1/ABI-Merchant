/**
 * Offline pairwise similarity across pickup fingerprint spectrum vectors.
 * Used by Calibration Debug Panel neighbor callouts and docs reports.
 */

import type { FingerprintsFile } from './audioMatcher';

export type PairwiseScore = {
  a: number;
  b: number;
  cosine: number;
  centeredCosine: number;
  l2: number;
  centroidDeltaHz: number;
  highBandDelta: number;
};

export type NeighborHit = {
  soundId: number;
  cosine: number;
  centeredCosine: number;
  l2: number;
  centroidDeltaHz: number;
};

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

function l2Distance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function highBandRatio(vec: number[]): number {
  const total = vec.reduce((s, v) => s + v, 0) || 1e-9;
  const upper = vec.slice(16).reduce((s, v) => s + v, 0);
  return upper / total;
}

export function pickupVector(
  fingerprints: FingerprintsFile,
  soundId: number,
): { spectrum: number[]; energy: number[]; centroid: number } | null {
  const side = fingerprints.fingerprints[String(soundId)]?.pickup;
  if (!side?.spectrumVector?.length) return null;
  return {
    spectrum: side.spectrumVector,
    energy: side.energyVector?.length ? side.energyVector : side.spectrumVector,
    centroid: side.spectralCentroid ?? 0,
  };
}

/** Score one fingerprint pair (pickup side). */
export function scoreFingerprintPair(
  fingerprints: FingerprintsFile,
  a: number,
  b: number,
): PairwiseScore | null {
  const va = pickupVector(fingerprints, a);
  const vb = pickupVector(fingerprints, b);
  if (!va || !vb) return null;
  return {
    a,
    b,
    cosine: Math.round(cosineSimilarity(va.spectrum, vb.spectrum) * 10000) / 10000,
    centeredCosine:
      Math.round(centeredCosine(va.spectrum, vb.spectrum) * 10000) / 10000,
    l2: Math.round(l2Distance(va.spectrum, vb.spectrum) * 10000) / 10000,
    centroidDeltaHz: Math.round(Math.abs(va.centroid - vb.centroid)),
    highBandDelta:
      Math.round(
        Math.abs(highBandRatio(va.energy) - highBandRatio(vb.energy)) * 10000,
      ) / 10000,
  };
}

/** All unique pairs among sound IDs that have pickup vectors, sorted by cosine desc. */
export function allPairwisePickup(
  fingerprints: FingerprintsFile,
): PairwiseScore[] {
  const ids = Object.keys(fingerprints.fingerprints)
    .map(Number)
    .filter((id) => pickupVector(fingerprints, id))
    .sort((a, b) => a - b);
  const out: PairwiseScore[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const score = scoreFingerprintPair(fingerprints, ids[i], ids[j]);
      if (score) out.push(score);
    }
  }
  return out.sort((x, y) => y.cosine - x.cosine);
}

/** Top-N neighbors of one sound ID by raw cosine. */
export function topNeighbors(
  fingerprints: FingerprintsFile,
  soundId: number,
  n = 5,
): NeighborHit[] {
  const self = pickupVector(fingerprints, soundId);
  if (!self) return [];
  const hits: NeighborHit[] = [];
  for (const key of Object.keys(fingerprints.fingerprints)) {
    const other = Number(key);
    if (other === soundId) continue;
    const v = pickupVector(fingerprints, other);
    if (!v) continue;
    hits.push({
      soundId: other,
      cosine: Math.round(cosineSimilarity(self.spectrum, v.spectrum) * 10000) / 10000,
      centeredCosine:
        Math.round(centeredCosine(self.spectrum, v.spectrum) * 10000) / 10000,
      l2: Math.round(l2Distance(self.spectrum, v.spectrum) * 10000) / 10000,
      centroidDeltaHz: Math.round(Math.abs(self.centroid - v.centroid)),
    });
  }
  return hits.sort((a, b) => b.cosine - a.cosine).slice(0, n);
}

/** Live capture vs fingerprint feature distances (expected + predicted). */
export function liveFeatureDistances(
  liveSpectrum: number[],
  liveCentroid: number,
  fingerprints: FingerprintsFile,
  expectedId: number,
  predictedId: number,
): {
  expected: { cosine: number; l2: number; centroidDeltaHz: number; highBandDelta: number } | null;
  predicted: { cosine: number; l2: number; centroidDeltaHz: number; highBandDelta: number } | null;
  expectedVsPredictedFp: PairwiseScore | null;
} {
  const exp = pickupVector(fingerprints, expectedId);
  const pred = pickupVector(fingerprints, predictedId);
  const pack = (
    v: { spectrum: number[]; energy: number[]; centroid: number } | null,
  ) => {
    if (!v) return null;
    return {
      cosine: Math.round(cosineSimilarity(liveSpectrum, v.spectrum) * 10000) / 10000,
      l2: Math.round(l2Distance(liveSpectrum, v.spectrum) * 10000) / 10000,
      centroidDeltaHz: Math.round(Math.abs(liveCentroid - v.centroid)),
      highBandDelta:
        Math.round(
          Math.abs(highBandRatio(liveSpectrum) - highBandRatio(v.energy)) * 10000,
        ) / 10000,
    };
  };
  return {
    expected: pack(exp),
    predicted: pack(pred),
    expectedVsPredictedFp: scoreFingerprintPair(fingerprints, expectedId, predictedId),
  };
}
