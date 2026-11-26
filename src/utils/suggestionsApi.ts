/**
 * Fire-and-forget / soft-fail Suggestions board via Cloudflare Worker + D1.
 * Optimistic localStorage keeps UX responsive when offline.
 */

import { COMMUNITY_VOTE_WORKER_URL } from './communityVotes';

const VOTED_KEY = 'abi-merchant.suggestions.voted.v1';
const CACHE_KEY = 'abi-merchant.suggestions.cache.v1';
const MIN_LEN = 8;
const MAX_LEN = 280;
const MIN_DWELL_MS = 2500;

export type SuggestionSort = 'top' | 'newest';

export interface Suggestion {
  id: string;
  body: string;
  createdAt: number;
  upvoteCount: number;
}

export interface SuggestionsList {
  sort: SuggestionSort;
  suggestions: Suggestion[];
}

function readVoted(): Set<string> {
  try {
    const raw = localStorage.getItem(VOTED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeVoted(ids: Set<string>): void {
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode */
  }
}

export function hasLocalUpvote(id: string): boolean {
  return readVoted().has(id);
}

export function markLocalUpvote(id: string): void {
  const s = readVoted();
  s.add(id);
  writeVoted(s);
}

export function cacheSuggestions(sort: SuggestionSort, list: Suggestion[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ sort, suggestions: list, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readCachedSuggestions(sort: SuggestionSort): Suggestion[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { sort?: string; suggestions?: Suggestion[] };
    if (data.sort !== sort || !Array.isArray(data.suggestions)) return null;
    return data.suggestions;
  } catch {
    return null;
  }
}

export function validateSuggestionBody(body: string): string | null {
  const text = body.trim();
  if (text.length < MIN_LEN || text.length > MAX_LEN) {
    return `Keep it between ${MIN_LEN} and ${MAX_LEN} characters.`;
  }
  if (/https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|gg|xyz)\b/i.test(text)) {
    return 'URLs aren’t allowed — describe the idea in plain text.';
  }
  return null;
}

export { MIN_DWELL_MS, MIN_LEN, MAX_LEN };

/** GET /suggestions — null when Worker unreachable. */
export async function fetchSuggestions(sort: SuggestionSort): Promise<SuggestionsList | null> {
  try {
    const res = await fetch(
      `${COMMUNITY_VOTE_WORKER_URL}/suggestions?sort=${encodeURIComponent(sort)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as SuggestionsList;
    if (!Array.isArray(data.suggestions)) return null;
    cacheSuggestions(sort, data.suggestions);
    return data;
  } catch {
    return null;
  }
}

/**
 * POST /suggestions — returns created row or null on soft failure.
 * Honeypot must stay empty; dwellMs from when the form opened.
 */
export async function postSuggestion(opts: {
  body: string;
  dwellMs: number;
  honeypot?: string;
}): Promise<Suggestion | null> {
  const err = validateSuggestionBody(opts.body);
  if (err) return null;
  try {
    const res = await fetch(`${COMMUNITY_VOTE_WORKER_URL}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        body: opts.body.trim(),
        dwellMs: opts.dwellMs,
        honeypot: opts.honeypot ?? '',
      }),
      keepalive: true,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Suggestion & { ok?: boolean };
    if (!data?.id || !data.body) return null;
    return {
      id: data.id,
      body: data.body,
      createdAt: data.createdAt,
      upvoteCount: data.upvoteCount ?? 0,
    };
  } catch {
    return null;
  }
}

/** POST /suggestions/:id/upvote — optimistic local mark; returns updated or null. */
export async function upvoteSuggestion(id: string): Promise<Suggestion | null> {
  markLocalUpvote(id);
  try {
    const res = await fetch(`${COMMUNITY_VOTE_WORKER_URL}/suggestions/${id}/upvote`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      keepalive: true,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Suggestion;
    if (!data?.id) return null;
    return data;
  } catch {
    return null;
  }
}
