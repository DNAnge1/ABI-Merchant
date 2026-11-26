/**
 * Phase 2 — ranked best-guess from existing matcher scores.
 * Does not change lock floors; normalizes relative probs over the displayed pool.
 */

import type { MatchResult, MerchantItem, SoundKind } from './audioMatcher';

export const DEFAULT_TOP_N = 3;

/**
 * Live narrowing re-ranks ~every 450ms. Without stickiness, close scores
 * (and even mid-window spectrum drift) thrash the displayed Group ID.
 * Challenger must beat the sticky top by this many confidence points.
 */
export const LIVE_STICKY_MARGIN_PTS = 6;

/**
 * Onset timestamps within this window (ms) are treated as the same clean
 * click — do not reset sticky just because peak sample jittered.
 * Kept tight; refractory + consensus handle decay re-triggers.
 */
export const LIVE_ONSET_RESET_MS = 80;

/**
 * A hit at or above this confidence is "strong" — a lone weaker tick
 * (e.g. decay lobe ~75%) must not overwrite it.
 */
export const LIVE_STRONG_CONF_PTS = 88;

/** Votes below this are low-confidence outliers once a strong hit exists. */
export const LIVE_WEAK_CONF_PTS = 80;

/** Keep this many clean-onset votes for confidence-weighted consensus. */
export const LIVE_VOTE_HISTORY = 5;

/**
 * Distinct clean onsets that must agree on a new Group ID before overthrowing
 * an existing strong consensus (≥ LIVE_STRONG_CONF_PTS).
 */
export const LIVE_VOTE_AGREE_N = 2;

export type LiveOnsetVote = {
  soundId: number;
  confidence: number;
  onsetMs: number;
  matches: MatchResult[];
};

export type LiveConsensusState = {
  /** Displayed primary sound id (null until first solid vote). */
  soundId: number | null;
  /** Onset ms of the vote that last set / reinforced consensus. */
  onsetMs: number | null;
  /** Best confidence observed for the consensus soundId. */
  confidence: number;
  /** Recent clean-onset votes (newest last), capped at LIVE_VOTE_HISTORY. */
  votes: LiveOnsetVote[];
  /** Matches reorder for UI (sticky/consensus primary first). */
  matches: MatchResult[];
};

export function emptyLiveConsensus(): LiveConsensusState {
  return {
    soundId: null,
    onsetMs: null,
    confidence: 0,
    votes: [],
    matches: [],
  };
}

/**
 * Keep the displayed live top stable while scores are close (same onset).
 * - New clean onset → adopt raw top (reset sticky).
 * - Same onset → keep sticky unless challenger leads by ≥ margin, or sticky
 *   drops out of the scored set.
 * Reorders matches so sticky is primary for buildBestGuessPool / UI.
 */
export function stabilizeLiveMatches(
  matches: MatchResult[],
  sticky: { soundId: number | null; onsetMs: number | null },
  onsetMs: number,
  opts?: { marginPts?: number; onsetResetMs?: number },
): { matches: MatchResult[]; soundId: number; onsetMs: number } {
  if (matches.length === 0) {
    return { matches, soundId: sticky.soundId ?? 0, onsetMs };
  }
  const margin = opts?.marginPts ?? LIVE_STICKY_MARGIN_PTS;
  const onsetReset = opts?.onsetResetMs ?? LIVE_ONSET_RESET_MS;
  const rawTop = matches[0];

  const stickyId = sticky.soundId;
  const stickyOnset = sticky.onsetMs;
  const newOnset =
    stickyOnset == null || Math.abs(onsetMs - stickyOnset) >= onsetReset;
  if (newOnset || stickyId == null) {
    return { matches, soundId: rawTop.soundId, onsetMs };
  }

  const stickyIdx = matches.findIndex((m) => m.soundId === stickyId);
  if (stickyIdx < 0) {
    // Sticky fell out of top-N scores — adopt fresh ranking.
    return { matches, soundId: rawTop.soundId, onsetMs };
  }

  const stickyMatch = matches[stickyIdx];
  if (rawTop.soundId === stickyId) {
    return { matches, soundId: stickyId, onsetMs };
  }

  // Strict > so a challenger exactly at sticky+margin does not thrash.
  if (rawTop.confidence > stickyMatch.confidence + margin) {
    return { matches, soundId: rawTop.soundId, onsetMs };
  }

  // Hold sticky on top; refresh its score from this peek; keep runners after.
  const rest = matches.filter((m) => m.soundId !== stickyId);
  return {
    matches: [stickyMatch, ...rest],
    soundId: stickyId,
    onsetMs: stickyOnset,
  };
}

function reorderPrimary(
  matches: MatchResult[],
  soundId: number,
): MatchResult[] {
  const idx = matches.findIndex((m) => m.soundId === soundId);
  if (idx <= 0) return matches;
  const primary = matches[idx];
  return [primary, ...matches.filter((m) => m.soundId !== soundId)];
}

function weightedVoteWinner(
  votes: LiveOnsetVote[],
): { soundId: number; weight: number; bestConf: number } | null {
  if (votes.length === 0) return null;
  const byId = new Map<number, { weight: number; bestConf: number; count: number }>();
  for (const v of votes) {
    const cur = byId.get(v.soundId) ?? { weight: 0, bestConf: 0, count: 0 };
    cur.weight += Math.max(v.confidence, 0.01);
    cur.bestConf = Math.max(cur.bestConf, v.confidence);
    cur.count += 1;
    byId.set(v.soundId, cur);
  }
  let best: { soundId: number; weight: number; bestConf: number } | null = null;
  for (const [soundId, stats] of byId) {
    if (
      !best ||
      stats.weight > best.weight ||
      (stats.weight === best.weight && stats.bestConf > best.bestConf)
    ) {
      best = { soundId, weight: stats.weight, bestConf: stats.bestConf };
    }
  }
  return best;
}

function distinctOnsetAgreeCount(
  votes: LiveOnsetVote[],
  soundId: number,
  sinceOnsetMs: number | null,
): number {
  const seen = new Set<number>();
  for (const v of votes) {
    if (v.soundId !== soundId) continue;
    if (sinceOnsetMs != null && v.onsetMs <= sinceOnsetMs) continue;
    // Bucket near-identical onset jitter as one click.
    const bucket = Math.round(v.onsetMs / LIVE_ONSET_RESET_MS);
    seen.add(bucket);
  }
  return seen.size;
}

/**
 * Confidence-weighted consensus across recent clean onsets.
 *
 * - `peek == null` → freeze: return prior consensus unchanged (silence / no onset).
 * - Same onset re-peek → stabilize within-onset, refresh scores.
 * - New onset → record vote; never let a lone weak (~75%) overwrite a strong
 *   (≥88–90%) hit unless LIVE_VOTE_AGREE_N distinct clean onsets agree.
 */
export function applyLiveConsensus(
  state: LiveConsensusState,
  peek: { matches: MatchResult[]; onsetMs: number } | null,
  opts?: {
    strongPts?: number;
    weakPts?: number;
    historyN?: number;
    agreeN?: number;
    marginPts?: number;
    onsetResetMs?: number;
  },
): LiveConsensusState {
  if (!peek || peek.matches.length === 0) {
    // Freeze-on-silence: keep last solid consensus on screen.
    return state;
  }

  const strongPts = opts?.strongPts ?? LIVE_STRONG_CONF_PTS;
  const weakPts = opts?.weakPts ?? LIVE_WEAK_CONF_PTS;
  const historyN = opts?.historyN ?? LIVE_VOTE_HISTORY;
  const agreeN = opts?.agreeN ?? LIVE_VOTE_AGREE_N;
  const onsetReset = opts?.onsetResetMs ?? LIVE_ONSET_RESET_MS;

  const sameOnset =
    state.onsetMs != null &&
    Math.abs(peek.onsetMs - state.onsetMs) < onsetReset;

  // Within the same clean onset: hysteresis only — do not append a new vote.
  if (sameOnset && state.soundId != null) {
    const stabilized = stabilizeLiveMatches(
      peek.matches,
      { soundId: state.soundId, onsetMs: state.onsetMs },
      peek.onsetMs,
      opts,
    );
    const primary =
      stabilized.matches.find((m) => m.soundId === stabilized.soundId) ??
      stabilized.matches[0];
    return {
      ...state,
      soundId: stabilized.soundId,
      onsetMs: stabilized.onsetMs,
      confidence: Math.max(state.confidence, primary?.confidence ?? 0),
      matches: stabilized.matches,
    };
  }

  // New clean onset (or first vote).
  const rawTop = peek.matches[0];
  const vote: LiveOnsetVote = {
    soundId: rawTop.soundId,
    confidence: rawTop.confidence,
    onsetMs: peek.onsetMs,
    matches: peek.matches,
  };
  const votes = [...state.votes, vote].slice(-historyN);

  // First solid vote → adopt.
  if (state.soundId == null) {
    return {
      soundId: vote.soundId,
      onsetMs: vote.onsetMs,
      confidence: vote.confidence,
      votes,
      matches: peek.matches,
    };
  }

  // Same group reinforced.
  if (vote.soundId === state.soundId) {
    return {
      soundId: state.soundId,
      onsetMs: vote.onsetMs,
      confidence: Math.max(state.confidence, vote.confidence),
      votes,
      matches: reorderPrimary(peek.matches, state.soundId),
    };
  }

  const hasStrong = state.confidence >= strongPts;
  const voteWeak = vote.confidence < weakPts;
  const voteStrong = vote.confidence >= strongPts;

  // Once a strong hit exists: ignore low-confidence outliers.
  if (hasStrong && voteWeak) {
    return {
      ...state,
      votes,
      matches: reorderPrimary(peek.matches, state.soundId),
    };
  }

  // Strong consensus: challenger needs multiple distinct clean onsets agreeing,
  // or a single strong challenger that also wins weighted vote of recent history.
  if (hasStrong) {
    const agree = distinctOnsetAgreeCount(votes, vote.soundId, state.onsetMs);
    const winner = weightedVoteWinner(votes);
    const weightedOk =
      winner != null &&
      winner.soundId === vote.soundId &&
      (voteStrong || agree >= agreeN);

    if (agree < agreeN && !weightedOk) {
      return {
        ...state,
        votes,
        matches: reorderPrimary(peek.matches, state.soundId),
      };
    }
  } else {
    // No strong lock yet — confidence-weighted vote across recent onsets.
    const winner = weightedVoteWinner(votes);
    if (winner && winner.soundId !== vote.soundId) {
      // Keep prior if weighted history still prefers it and new vote isn't strong.
      if (!voteStrong && winner.soundId === state.soundId) {
        return {
          ...state,
          votes,
          matches: reorderPrimary(peek.matches, state.soundId),
        };
      }
    }
  }

  // Adopt challenger.
  return {
    soundId: vote.soundId,
    onsetMs: vote.onsetMs,
    confidence: vote.confidence,
    votes,
    matches: peek.matches,
  };
}

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
