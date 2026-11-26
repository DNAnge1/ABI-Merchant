/**
 * abi-merchant-counter — global community tallies for ABI Merchant.
 * Bound to D1 `abi-merchant-stats` via `DB`.
 *
 * Free-tier light: coarse counters + daily rollups; no raw event logs.
 */

export interface Env {
  DB: D1Database;
  /** Optional: PATCH /suggestions/:id with header X-Admin-Key to hide spam */
  ADMIN_KEY?: string;
  /** Optional salt for IP hashing; falls back to a stable app constant */
  IP_HASH_SALT?: string;
}

const ALLOWED_ORIGINS = new Set([
  'https://dnange1.github.io',
  'http://localhost:5173',
]);

const MIN_SOUND_ID = 1;
const MAX_SOUND_ID = 38;
const MAX_MAP_MODE_LEN = 64;
const DAILY_WINDOW_DAYS = 30;
const TOP_MAP_MODES = 10;

/** Suggestions anti-spam limits */
const SUGGESTION_MIN_LEN = 8;
const SUGGESTION_MAX_LEN = 280;
const SUGGESTION_MIN_DWELL_MS = 2500;
const SUGGESTION_POST_WINDOW_MS = 60 * 60 * 1000; // 1h
const SUGGESTION_MAX_POSTS_PER_WINDOW = 3;
const SUGGESTION_UPVOTE_COOLDOWN_MS = 800; // soft burst guard per IP
const SUGGESTION_LIST_LIMIT = 50;
const DEFAULT_IP_HASH_SALT = 'abi-merchant-suggestions-v1';
const URL_IN_TEXT = /https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|cn)\b/i;

/** Whitelisted site_counters keys (POST /event). */
const SITE_COUNTER_KEYS = new Set([
  'visits',
  'scans_total',
  'scans_auto',
  'scans_manual',
  'scans_fallback',
  'reds_found',
  'pip_opens',
  'capture_display',
  'capture_mic',
]);

/** Special event: updates map_mode_counts (not site_counters). */
const MAP_MODE_EVENT = 'map_mode';

type VoteKind = 'up' | 'down';

interface SoundVoteRow {
  sound_id: number;
  up_count: number;
  down_count: number;
  scan_count: number;
  red_count: number;
}

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newSuggestionId(): string {
  return crypto.randomUUID();
}

interface SuggestionRow {
  id: string;
  body: string;
  created_at: number;
  upvote_count: number;
}

function mapSuggestion(row: SuggestionRow) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    upvoteCount: row.upvote_count,
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function parseSoundId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_SOUND_ID || n > MAX_SOUND_ID) return null;
  return n;
}

/** UTC calendar day YYYY-MM-DD. */
function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function parseMapMode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MAP_MODE_LEN) return null;
  // Keep path-ish ids safe: letters, digits, dash, underscore, slash, colon, dot.
  if (!/^[a-zA-Z0-9_./:-]+$/.test(trimmed)) return null;
  return trimmed;
}

async function handleVote(request: Request, env: Env, origin: string | null): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
  }

  const body = payload as { soundId?: unknown; vote?: unknown };
  const soundId = parseSoundId(body.soundId);
  if (soundId == null) {
    return jsonResponse(
      { error: `soundId must be an integer ${MIN_SOUND_ID}–${MAX_SOUND_ID}` },
      400,
      origin,
    );
  }

  const vote = body.vote;
  if (vote !== 'up' && vote !== 'down') {
    return jsonResponse({ error: "vote must be 'up' or 'down'" }, 400, origin);
  }

  const column: VoteKind = vote;
  const day = utcDay();
  const voteInc =
    column === 'up'
      ? `UPDATE sound_votes SET up_count = up_count + 1 WHERE sound_id = ?`
      : `UPDATE sound_votes SET down_count = down_count + 1 WHERE sound_id = ?`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sound_votes (sound_id, up_count, down_count, scan_count, red_count)
       VALUES (?, 0, 0, 0, 0)
       ON CONFLICT(sound_id) DO NOTHING`,
    ).bind(soundId),
    env.DB.prepare(voteInc).bind(soundId),
    env.DB.prepare(
      `INSERT INTO daily_stats (day, visits, scans, votes, reds_found)
       VALUES (?, 0, 0, 1, 0)
       ON CONFLICT(day) DO UPDATE SET votes = votes + 1`,
    ).bind(day),
  ]);

  const row = await env.DB.prepare(
    `SELECT sound_id, up_count, down_count, scan_count, red_count
     FROM sound_votes WHERE sound_id = ?`,
  )
    .bind(soundId)
    .first<SoundVoteRow>();

  if (!row) {
    return jsonResponse({ error: 'Failed to read updated counts' }, 500, origin);
  }

  return jsonResponse(
    {
      soundId: row.sound_id,
      upCount: row.up_count,
      downCount: row.down_count,
      scanCount: row.scan_count,
      redCount: row.red_count,
    },
    200,
    origin,
  );
}

/**
 * POST /event — whitelist keys only; atomic upsert via batch.
 * Body: { key: string, soundId?: number, mapMode?: string }
 */
async function handleEvent(request: Request, env: Env, origin: string | null): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
  }

  const body = payload as { key?: unknown; soundId?: unknown; mapMode?: unknown };
  const key = typeof body.key === 'string' ? body.key : '';

  if (key === MAP_MODE_EVENT) {
    const mapMode = parseMapMode(body.mapMode);
    if (!mapMode) {
      return jsonResponse(
        { error: 'mapMode required (safe string, max 64 chars)' },
        400,
        origin,
      );
    }
    await env.DB.prepare(
      `INSERT INTO map_mode_counts (map_mode, count)
       VALUES (?, 1)
       ON CONFLICT(map_mode) DO UPDATE SET count = count + 1`,
    )
      .bind(mapMode)
      .run();
    return jsonResponse({ ok: true, key, mapMode }, 200, origin);
  }

  if (!SITE_COUNTER_KEYS.has(key)) {
    return jsonResponse({ error: 'Unknown or disallowed event key' }, 400, origin);
  }

  const day = utcDay();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO site_counters (key, count)
       VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET count = count + 1`,
    ).bind(key),
  ];

  // Map event → daily_stats column (scans_* modes don't double-count daily scans).
  if (key === 'visits') {
    statements.push(
      env.DB.prepare(
        `INSERT INTO daily_stats (day, visits, scans, votes, reds_found)
         VALUES (?, 1, 0, 0, 0)
         ON CONFLICT(day) DO UPDATE SET visits = visits + 1`,
      ).bind(day),
    );
  } else if (key === 'scans_total') {
    statements.push(
      env.DB.prepare(
        `INSERT INTO daily_stats (day, visits, scans, votes, reds_found)
         VALUES (?, 0, 1, 0, 0)
         ON CONFLICT(day) DO UPDATE SET scans = scans + 1`,
      ).bind(day),
    );
    const soundId = parseSoundId(body.soundId);
    if (soundId != null) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO sound_votes (sound_id, up_count, down_count, scan_count, red_count)
           VALUES (?, 0, 0, 0, 0)
           ON CONFLICT(sound_id) DO NOTHING`,
        ).bind(soundId),
        env.DB.prepare(
          `UPDATE sound_votes SET scan_count = scan_count + 1 WHERE sound_id = ?`,
        ).bind(soundId),
      );
    }
  } else if (key === 'reds_found') {
    statements.push(
      env.DB.prepare(
        `INSERT INTO daily_stats (day, visits, scans, votes, reds_found)
         VALUES (?, 0, 0, 0, 1)
         ON CONFLICT(day) DO UPDATE SET reds_found = reds_found + 1`,
      ).bind(day),
    );
    const soundId = parseSoundId(body.soundId);
    if (soundId != null) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO sound_votes (sound_id, up_count, down_count, scan_count, red_count)
           VALUES (?, 0, 0, 0, 0)
           ON CONFLICT(sound_id) DO NOTHING`,
        ).bind(soundId),
        env.DB.prepare(
          `UPDATE sound_votes SET red_count = red_count + 1 WHERE sound_id = ?`,
        ).bind(soundId),
      );
    }
  }
  // scans_auto / scans_manual / scans_fallback / pip / capture — site_counters only

  await env.DB.batch(statements);
  return jsonResponse({ ok: true, key }, 200, origin);
}

function extremeBy(
  rows: SoundVoteRow[],
  score: (r: SoundVoteRow) => number,
  prefer: 'max' | 'min',
): SoundVoteRow | null {
  const eligible = rows.filter((r) => score(r) > 0);
  if (eligible.length === 0) return null;
  let best = eligible[0];
  for (let i = 1; i < eligible.length; i++) {
    const s = score(eligible[i]);
    const b = score(best);
    if (prefer === 'max' ? s > b : s < b) best = eligible[i];
  }
  return best;
}

async function handleStats(env: Env, origin: string | null): Promise<Response> {
  const day = utcDay();
  // Approximate 30-day window with string compare on YYYY-MM-DD.
  const since = new Date(`${day}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - (DAILY_WINDOW_DAYS - 1));
  const sinceDay = since.toISOString().slice(0, 10);

  const [soundsRes, countersRes, dailyRes, mapRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT sound_id, up_count, down_count,
              COALESCE(scan_count, 0) AS scan_count,
              COALESCE(red_count, 0) AS red_count
       FROM sound_votes ORDER BY sound_id ASC`,
    ),
    env.DB.prepare(`SELECT key, count FROM site_counters`),
    env.DB.prepare(
      `SELECT day, visits, scans, votes, reds_found
       FROM daily_stats
       WHERE day >= ?
       ORDER BY day ASC`,
    ).bind(sinceDay),
    env.DB.prepare(
      `SELECT map_mode, count FROM map_mode_counts
       ORDER BY count DESC, map_mode ASC
       LIMIT ?`,
    ).bind(TOP_MAP_MODES),
  ]);

  const soundRows = (soundsRes.results ?? []) as SoundVoteRow[];
  const sounds = soundRows.map((r) => ({
    soundId: r.sound_id,
    upCount: r.up_count,
    downCount: r.down_count,
    scanCount: r.scan_count ?? 0,
    redCount: r.red_count ?? 0,
  }));

  let totalUp = 0;
  let totalDown = 0;
  for (const s of sounds) {
    totalUp += s.upCount;
    totalDown += s.downCount;
  }
  const scored = totalUp + totalDown;
  const accuracyPct =
    scored === 0 ? 0 : Math.round((totalUp / scored) * 1000) / 10;

  const mostVoted = extremeBy(soundRows, (r) => r.up_count + r.down_count, 'max');
  const leastVoted = extremeBy(soundRows, (r) => r.up_count + r.down_count, 'min');
  const mostScanned = extremeBy(soundRows, (r) => r.scan_count ?? 0, 'max');
  const leastScanned = extremeBy(soundRows, (r) => r.scan_count ?? 0, 'min');
  const topRed = extremeBy(soundRows, (r) => r.red_count ?? 0, 'max');

  const counters: Record<string, number> = {};
  for (const row of (countersRes.results ?? []) as { key: string; count: number }[]) {
    counters[row.key] = row.count;
  }

  const daily = ((dailyRes.results ?? []) as {
    day: string;
    visits: number;
    scans: number;
    votes: number;
    reds_found: number;
  }[]).map((r) => ({
    day: r.day,
    visits: r.visits,
    scans: r.scans,
    votes: r.votes,
    redsFound: r.reds_found,
  }));

  const topMapModes = ((mapRes.results ?? []) as { map_mode: string; count: number }[]).map(
    (r) => ({
      mapMode: r.map_mode,
      count: r.count,
    }),
  );

  return jsonResponse(
    {
      counters,
      daily,
      topMapModes,
      sounds,
      aggregates: {
        totalUp,
        totalDown,
        totalVotes: scored,
        accuracyPct,
        soundsWithVotes: sounds.filter((s) => s.upCount + s.downCount > 0).length,
        mostVoted: mostVoted
          ? {
              soundId: mostVoted.sound_id,
              upCount: mostVoted.up_count,
              downCount: mostVoted.down_count,
            }
          : null,
        leastVoted: leastVoted
          ? {
              soundId: leastVoted.sound_id,
              upCount: leastVoted.up_count,
              downCount: leastVoted.down_count,
            }
          : null,
        mostScanned: mostScanned
          ? { soundId: mostScanned.sound_id, scanCount: mostScanned.scan_count }
          : null,
        leastScanned: leastScanned
          ? { soundId: leastScanned.sound_id, scanCount: leastScanned.scan_count }
          : null,
        topRedSoundId: topRed ? topRed.sound_id : null,
      },
    },
    200,
    origin,
    { 'Cache-Control': 'public, max-age=30' },
  );
}

async function handleListSuggestions(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort') === 'newest' ? 'newest' : 'top';
  const orderSql =
    sort === 'newest'
      ? 'created_at DESC'
      : 'upvote_count DESC, created_at DESC';

  const { results } = await env.DB.prepare(
    `SELECT id, body, created_at, upvote_count
     FROM suggestions
     WHERE hidden = 0
     ORDER BY ${orderSql}
     LIMIT ?`,
  )
    .bind(SUGGESTION_LIST_LIMIT)
    .all<SuggestionRow>();

  return jsonResponse(
    {
      sort,
      suggestions: (results ?? []).map(mapSuggestion),
    },
    200,
    origin,
    { 'Cache-Control': 'public, max-age=15' },
  );
}

async function handleCreateSuggestion(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
  }

  const body = payload as {
    body?: unknown;
    honeypot?: unknown;
    dwellMs?: unknown;
    website?: unknown; // alt honeypot name
  };

  // Honeypot: any non-empty value → pretend success (don't tip bots)
  const honey =
    (typeof body.honeypot === 'string' && body.honeypot.trim()) ||
    (typeof body.website === 'string' && body.website.trim());
  if (honey) {
    return jsonResponse(
      {
        id: newSuggestionId(),
        body: '',
        createdAt: Date.now(),
        upvoteCount: 0,
        ok: true,
      },
      201,
      origin,
    );
  }

  const dwellMs = typeof body.dwellMs === 'number' ? body.dwellMs : Number(body.dwellMs);
  if (!Number.isFinite(dwellMs) || dwellMs < SUGGESTION_MIN_DWELL_MS) {
    return jsonResponse(
      { error: `dwellMs must be ≥ ${SUGGESTION_MIN_DWELL_MS}` },
      400,
      origin,
    );
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length < SUGGESTION_MIN_LEN || text.length > SUGGESTION_MAX_LEN) {
    return jsonResponse(
      {
        error: `body must be ${SUGGESTION_MIN_LEN}–${SUGGESTION_MAX_LEN} characters`,
      },
      400,
      origin,
    );
  }
  if (URL_IN_TEXT.test(text)) {
    return jsonResponse({ error: 'URLs are not allowed in suggestions' }, 400, origin);
  }

  const salt = env.IP_HASH_SALT || DEFAULT_IP_HASH_SALT;
  const ipHash = await hashIp(clientIp(request), salt);
  const now = Date.now();

  const rate = await env.DB.prepare(
    `SELECT window_start, post_count FROM suggestion_rate WHERE ip_hash = ?`,
  )
    .bind(ipHash)
    .first<{ window_start: number; post_count: number }>();

  let windowStart = rate?.window_start ?? now;
  let postCount = rate?.post_count ?? 0;
  if (!rate || now - windowStart > SUGGESTION_POST_WINDOW_MS) {
    windowStart = now;
    postCount = 0;
  }
  if (postCount >= SUGGESTION_MAX_POSTS_PER_WINDOW) {
    return jsonResponse({ error: 'Rate limit — try again later' }, 429, origin);
  }

  const id = newSuggestionId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO suggestions (id, body, created_at, upvote_count, hidden, author_hash)
       VALUES (?, ?, ?, 0, 0, ?)`,
    ).bind(id, text, now, ipHash),
    env.DB.prepare(
      `INSERT INTO suggestion_rate (ip_hash, window_start, post_count, last_upvote_at)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(ip_hash) DO UPDATE SET
         window_start = excluded.window_start,
         post_count = excluded.post_count`,
    ).bind(ipHash, windowStart, postCount + 1),
  ]);

  return jsonResponse(
    { id, body: text, createdAt: now, upvoteCount: 0, ok: true },
    201,
    origin,
  );
}

async function handleUpvoteSuggestion(
  suggestionId: string,
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(suggestionId)) {
    return jsonResponse({ error: 'Invalid suggestion id' }, 400, origin);
  }

  const salt = env.IP_HASH_SALT || DEFAULT_IP_HASH_SALT;
  const voterHash = await hashIp(clientIp(request), salt);
  const now = Date.now();

  const existing = await env.DB.prepare(
    `SELECT id, body, created_at, upvote_count, hidden FROM suggestions WHERE id = ?`,
  )
    .bind(suggestionId)
    .first<SuggestionRow & { hidden: number }>();

  if (!existing || existing.hidden) {
    return jsonResponse({ error: 'Suggestion not found' }, 404, origin);
  }

  const already = await env.DB.prepare(
    `SELECT 1 AS ok FROM suggestion_votes WHERE suggestion_id = ? AND voter_hash = ?`,
  )
    .bind(suggestionId, voterHash)
    .first<{ ok: number }>();

  if (already) {
    return jsonResponse(
      { ...mapSuggestion(existing), alreadyVoted: true },
      200,
      origin,
    );
  }

  const rate = await env.DB.prepare(
    `SELECT last_upvote_at FROM suggestion_rate WHERE ip_hash = ?`,
  )
    .bind(voterHash)
    .first<{ last_upvote_at: number }>();

  if (rate && now - rate.last_upvote_at < SUGGESTION_UPVOTE_COOLDOWN_MS) {
    return jsonResponse({ error: 'Slow down' }, 429, origin);
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO suggestion_votes (suggestion_id, voter_hash, created_at)
         VALUES (?, ?, ?)`,
      ).bind(suggestionId, voterHash, now),
      env.DB.prepare(
        `UPDATE suggestions SET upvote_count = upvote_count + 1 WHERE id = ? AND hidden = 0`,
      ).bind(suggestionId),
      env.DB.prepare(
        `INSERT INTO suggestion_rate (ip_hash, window_start, post_count, last_upvote_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET last_upvote_at = excluded.last_upvote_at`,
      ).bind(voterHash, now, now),
    ]);
  } catch {
    // Unique conflict race — treat as already voted
    const row = await env.DB.prepare(
      `SELECT id, body, created_at, upvote_count FROM suggestions WHERE id = ?`,
    )
      .bind(suggestionId)
      .first<SuggestionRow>();
    return jsonResponse(
      { ...(row ? mapSuggestion(row) : mapSuggestion(existing)), alreadyVoted: true },
      200,
      origin,
    );
  }

  const updated = await env.DB.prepare(
    `SELECT id, body, created_at, upvote_count FROM suggestions WHERE id = ?`,
  )
    .bind(suggestionId)
    .first<SuggestionRow>();

  return jsonResponse(
    { ...(updated ? mapSuggestion(updated) : mapSuggestion(existing)), alreadyVoted: false },
    200,
    origin,
  );
}

async function handlePatchSuggestion(
  suggestionId: string,
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  const adminKey = env.ADMIN_KEY;
  const provided = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || provided !== adminKey) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }

  if (!/^[0-9a-f-]{36}$/i.test(suggestionId)) {
    return jsonResponse({ error: 'Invalid suggestion id' }, 400, origin);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
  }

  const body = payload as { hidden?: unknown };
  if (typeof body.hidden !== 'boolean') {
    return jsonResponse({ error: 'hidden boolean required' }, 400, origin);
  }

  const result = await env.DB.prepare(
    `UPDATE suggestions SET hidden = ? WHERE id = ?`,
  )
    .bind(body.hidden ? 1 : 0, suggestionId)
    .run();

  if (!result.meta.changes) {
    return jsonResponse({ error: 'Suggestion not found' }, 404, origin);
  }

  return jsonResponse({ id: suggestionId, hidden: body.hidden, ok: true }, 200, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (url.pathname === '/vote' && request.method === 'POST') {
      return handleVote(request, env, origin);
    }

    if (url.pathname === '/event' && request.method === 'POST') {
      return handleEvent(request, env, origin);
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      return handleStats(env, origin);
    }

    if (url.pathname === '/suggestions' && request.method === 'GET') {
      return handleListSuggestions(request, env, origin);
    }

    if (url.pathname === '/suggestions' && request.method === 'POST') {
      return handleCreateSuggestion(request, env, origin);
    }

    const upvoteMatch = url.pathname.match(/^\/suggestions\/([0-9a-f-]{36})\/upvote$/i);
    if (upvoteMatch && request.method === 'POST') {
      return handleUpvoteSuggestion(upvoteMatch[1], request, env, origin);
    }

    const patchMatch = url.pathname.match(/^\/suggestions\/([0-9a-f-]{36})$/i);
    if (patchMatch && request.method === 'PATCH') {
      return handlePatchSuggestion(patchMatch[1], request, env, origin);
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return jsonResponse(
        {
          name: 'abi-merchant-counter',
          endpoints: [
            'POST /vote',
            'POST /event',
            'GET /stats',
            'GET /suggestions',
            'POST /suggestions',
            'POST /suggestions/:id/upvote',
            'PATCH /suggestions/:id',
          ],
        },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
};
