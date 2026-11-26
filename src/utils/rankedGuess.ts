/**
 * Phase 2 — ranked best-guess from existing matcher scores.
 * Does not change lock floors; normalizes relative probs over the displayed pool.
 */

import type { MatchResult, MerchantItem, SoundKind } from './audioMatcher';

export const DEFAULT_TOP_N = 3;

export type RankedSoundCandidate = {
  soundId: number;
  confidence: number;
  /** Relative probability among the displayed top-N (sums ~100). */
  relativeProb: number;
  kind: SoundKind;
  items: MerchantItem[];
};

export type BestGuessPool = {
  candidates: RankedSoundCandidate[];
  primary: RankedSoundCandidate;
  /**
   * Weighted Red / Mythic chance over the displayed candidate pool
   * (group relativeProb × share of red items in that group).
   * Isolated single-item primary → 100 when that item is red, else 0.
   */
  redChancePercent: number;
  /** True when the primary sound group has exactly one item. */
  isolatedItem: boolean;
  lowConfidence: boolean;
};

/**
 * Normalize raw similarity scores into relative percentages that sum to 100.
 * Softmax-free: proportional to max(score, ε) so near-zero runners still show.
 */
export function normalizeRelativeProbs(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const floors = scores.map((s) => Math.max(s, 0.01));
  const sum = floors.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const even = Math.floor(100 / scores.length);
    const rem = 100 - even * scores.length;
    return scores.map((_, i) => even + (i < rem ? 1 : 0));
  }
  const raw = floors.map((s) => (s / sum) * 100);
  const rounded = raw.map((p) => Math.round(p * 10) / 10);
  // Fix rounding drift on the largest entry so the strip sums ~100.
  const drift =
    Math.round((100 - rounded.reduce((a, b) => a + b, 0)) * 10) / 10;
  if (drift !== 0 && rounded.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < rounded.length; i++) {
      if (rounded[i] > rounded[maxIdx]) maxIdx = i;
    }
    rounded[maxIdx] = Math.round((rounded[maxIdx] + drift) * 10) / 10;
  }
  return rounded;
}

/**
 * Red chance weighted by group relative probability and equal item share within group.
 * Isolated single-item primary → 100% if Mythic/red, else 0% (locked highlight).
 */
export function weightedRedChancePercent(
  candidates: RankedSoundCandidate[],
): number {
  if (candidates.length === 0) return 0;
  const primary = candidates[0];
  if (primary.items.length === 1) {
    return primary.items[0].rarity >= 6 ? 100 : 0;
  }
  let red = 0;
  for (const c of candidates) {
    if (c.items.length === 0 || c.relativeProb <= 0) continue;
    const redShare =
      c.items.filter((i) => i.rarity >= 6).length / c.items.length;
    red += (c.relativeProb / 100) * redShare * 100;
  }
  return Math.round(red * 10) / 10;
}

/**
 * Build top-N ranked sound candidates from matcher scores + catalog items.
 */
export function buildBestGuessPool(
  matches: MatchResult[],
  allItems: MerchantItem[],
  opts?: { topN?: number; lowConfidence?: boolean },
): BestGuessPool | null {
  const topN = opts?.topN ?? DEFAULT_TOP_N;
  const sliced = matches.slice(0, topN).filter((m) => m != null);
  if (sliced.length === 0) return null;

  const probs = normalizeRelativeProbs(sliced.map((m) => m.confidence));
  const candidates: RankedSoundCandidate[] = sliced.map((m, i) => ({
    soundId: m.soundId,
    confidence: m.confidence,
    relativeProb: probs[i] ?? 0,
    kind: m.kind,
    items: allItems.filter((it) => it.soundId === m.soundId),
  }));

  const primary = candidates[0];
  return {
    candidates,
    primary,
    redChancePercent: weightedRedChancePercent(candidates),
    isolatedItem: primary.items.length === 1,
    lowConfidence: opts?.lowConfidence === true,
  };
}
