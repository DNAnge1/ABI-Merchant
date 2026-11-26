/**
 * abi-merchant-counter — global community tallies for ABI Merchant.
 * Bound to D1 `abi-merchant-stats` via `DB`.
 *
 * Free-tier light: coarse counters + daily rollups; miss_reports store
 * numbers-only MissReportPayload v1 (no audio / no spectrum).
 */

export interface Env {
  DB: D1Database;
  /** Optional: PATCH hide for suggestions / miss_reports with X-Admin-Key */
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

/** Miss reports (MissReportPayload schemaVersion 1) */
const MISS_REPORT_SCHEMA_VERSION = 1;
const MISS_REPORT_SOURCES = new Set(['live-onset', 'auto', 'burst', 'player-miss']);
const MISS_REPORT_POST_WINDOW_MS = 60 * 60 * 1000; // 1h
const MISS_REPORT_MAX_POSTS_PER_WINDOW = 30;
const MISS_REPORT_LIST_LIMIT = 50;
const MISS_REPORT_TOP_PAIRS = 15;
const MISS_REPORT_MAX_PAYLOAD_CHARS = 12_000;

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

interface MissReportRow {
  id: string;
  created_at: number;
  day: string;
  schema_version: number;
  source: string;
  expected_id: number;
  predicted_id: number;
  is_match: number;
  expected_rank: number | null;
  expected_score: number | null;
  predicted_score: number | null;
  map_mode_id: string | null;
  app_version: string | null;
  payload: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalScore(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function parseOptionalRank(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SOUND_ID) return null;
  return n;
}

/** Reject audio / local-only fields; keep numbers-only MissReportPayload v1. */
function sanitizeMissReportPayload(
  raw: unknown,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: 'Body must be a JSON object' };

  if (
    'spectrumVector' in raw ||
    'clipId' in raw ||
    'clipAvailable' in raw ||
    'audio' in raw ||
    'wav' in raw ||
    'blob' in raw
  ) {
    return { ok: false, error: 'Audio / spectrum / clip fields are not accepted' };
  }

  const schemaVersion = Number(raw.schemaVersion);
  if (schemaVersion !== MISS_REPORT_SCHEMA_VERSION) {
    return { ok: false, error: `schemaVersion must be ${MISS_REPORT_SCHEMA_VERSION}` };
  }

  const source = typeof raw.source === 'string' ? raw.source : '';
  if (!MISS_REPORT_SOURCES.has(source)) {
    return {
      ok: false,
      error: `source must be one of ${[...MISS_REPORT_SOURCES].join(', ')}`,
    };
  }

  const expectedId = parseSoundId(raw.expectedId);
  const predictedId = parseSoundId(raw.predictedId);
  if (expectedId == null || predictedId == null) {
    return {
      ok: false,
      error: `expectedId and predictedId must be integers ${MIN_SOUND_ID}–${MAX_SOUND_ID}`,
    };
  }

  if (!Array.isArray(raw.top5) || raw.top5.length > 5) {
    return { ok: false, error: 'top5 must be an array of up to 5 rows' };
  }
  for (const row of raw.top5) {
    if (!isPlainObject(row) || parseSoundId(row.soundId) == null) {
      return { ok: false, error: 'top5 rows need valid soundId' };
    }
  }

  if (!isPlainObject(raw.diagnostics)) {
    return { ok: false, error: 'diagnostics object required' };
  }

  const id =
    typeof raw.id === 'string' && raw.id.length >= 8 && raw.id.length <= 64
      ? raw.id
      : crypto.randomUUID();

  const ts =
    typeof raw.ts === 'string' && raw.ts.length >= 10
      ? raw.ts
      : new Date().toISOString();

  const match = Boolean(raw.match ?? expectedId === predictedId);

  const cleaned: Record<string, unknown> = {
    ...raw,
    id,
    ts,
    schemaVersion: MISS_REPORT_SCHEMA_VERSION,
    source,
    expectedId,
    predictedId,
    match,
    expectedRank: parseOptionalRank(raw.expectedRank),
    expectedScore: parseOptionalScore(raw.expectedScore),
    predictedScore: parseOptionalScore(raw.predictedScore),
    mapModeId:
      typeof raw.mapModeId === 'string' && raw.mapModeId.length <= MAX_MAP_MODE_LEN
        ? raw.mapModeId
        : null,
    mapModeLabel:
      typeof raw.mapModeLabel === 'string' && raw.mapModeLabel.length <= 128
        ? raw.mapModeLabel
        : null,
    cargoType:
      typeof raw.cargoType === 'string' && raw.cargoType.length <= 64
        ? raw.cargoType
        : null,
    cargoPrice:
      typeof raw.cargoPrice === 'number' && Number.isFinite(raw.cargoPrice)
        ? raw.cargoPrice
        : null,
    appVersion:
      typeof raw.appVersion === 'string' && raw.appVersion.length <= 32
        ? raw.appVersion
        : null,
    sessionId:
      typeof raw.sessionId === 'string' && raw.sessionId.length <= 64
        ? raw.sessionId
        : 'unknown',
  };

  // Drop accidental local-only keys if present under other names
  delete cleaned.spectrumVector;
  delete cleaned.clipId;
  delete cleaned.clipAvailable;

  const encoded = JSON.stringify(cleaned);
  if (encoded.length > MISS_REPORT_MAX_PAYLOAD_CHARS) {
    return { ok: false, error: 'Payload too large' };
  }

  return { ok: true, payload: cleaned };
}

async function handleCreateMissReport(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
  }

  const sanitized = sanitizeMissReportPayload(raw);
  if (!sanitized.ok) {
    return jsonResponse({ error: sanitized.error }, 400, origin);
  }

  const salt = env.IP_HASH_SALT || DEFAULT_IP_HASH_SALT;
  const ipHash = await hashIp(clientIp(request), salt);
  const now = Date.now();

  const rate = await env.DB.prepare(
    `SELECT window_start, post_count FROM miss_report_rate WHERE ip_hash = ?`,
  )
    .bind(ipHash)
    .first<{ window_start: number; post_count: number }>();

  let windowStart = rate?.window_start ?? now;
  let postCount = rate?.post_count ?? 0;
  if (!rate || now - windowStart > MISS_REPORT_POST_WINDOW_MS) {
    windowStart = now;
    postCount = 0;
  }
  if (postCount >= MISS_REPORT_MAX_POSTS_PER_WINDOW) {
    return jsonResponse({ error: 'Rate limit — try again later' }, 429, origin);
  }

  const p = sanitized.payload;
  const id = String(p.id);
  const day = utcDay(new Date(typeof p.ts === 'string' ? p.ts : now));
  const expectedId = Number(p.expectedId);
  const predictedId = Number(p.predictedId);
  const isMatch = p.match ? 1 : 0;
  const payloadJson = JSON.stringify(p);

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO miss_reports (
           id, created_at, day, schema_version, source,
           expected_id, predicted_id, is_match,
           expected_rank, expected_score, predicted_score,
           map_mode_id, app_version, author_hash, hidden, payload
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).bind(
        id,
        now,
        day,
        MISS_REPORT_SCHEMA_VERSION,
        String(p.source),
        expectedId,
        predictedId,
        isMatch,
        p.expectedRank ?? null,
        p.expectedScore ?? null,
        p.predictedScore ?? null,
        p.mapModeId ?? null,
        p.appVersion ?? null,
        ipHash,
        payloadJson,
      ),
      env.DB.prepare(
        `INSERT INTO miss_report_rate (ip_hash, window_start, post_count)
         VALUES (?, ?, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET
           window_start = excluded.window_start,
           post_count = excluded.post_count`,
      ).bind(ipHash, windowStart, postCount + 1),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|constraint/i.test(msg)) {
      return jsonResponse({ id, ok: true, duplicate: true }, 200, origin);
    }
    return jsonResponse({ error: 'Failed to store report' }, 500, origin);
  }

  return jsonResponse(
    {
      id,
      ok: true,
      expectedId,
      predictedId,
      match: Boolean(isMatch),
    },
    201,
    origin,
  );
}

async function handleListMissReports(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? MISS_REPORT_LIST_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, Math.floor(limitRaw)), 100)
    : MISS_REPORT_LIST_LIMIT;
  const missesOnly = url.searchParams.get('misses') === '1';

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, day, schema_version, source,
            expected_id, predicted_id, is_match,
            expected_rank, expected_score, predicted_score,
            map_mode_id, app_version, payload
     FROM miss_reports
     WHERE hidden = 0 ${missesOnly ? 'AND is_match = 0' : ''}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<MissReportRow>();

  const reports = (results ?? []).map((row) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = null;
    }
    return {
      id: row.id,
      createdAt: row.created_at,
      day: row.day,
      schemaVersion: row.schema_version,
      source: row.source,
      expectedId: row.expected_id,
      predictedId: row.predicted_id,
      match: row.is_match === 1,
      expectedRank: row.expected_rank,
      expectedScore: row.expected_score,
      predictedScore: row.predicted_score,
      mapModeId: row.map_mode_id,
      appVersion: row.app_version,
      payload,
    };
  });

  return jsonResponse(
    { reports, count: reports.length },
    200,
    origin,
    { 'Cache-Control': 'public, max-age=15' },
  );
}

async function handleMissReportStats(
  env: Env,
  origin: string | null,
): Promise<Response> {
  const sinceDay = utcDay(new Date(Date.now() - DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const [totalsRes, pairRes, dailyRes, predictedRes] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_match = 0 THEN 1 ELSE 0 END) AS misses,
         SUM(CASE WHEN is_match = 1 THEN 1 ELSE 0 END) AS hits
       FROM miss_reports WHERE hidden = 0`,
    ),
    env.DB.prepare(
      `SELECT expected_id, predicted_id, COUNT(*) AS hits
       FROM miss_reports
       WHERE hidden = 0 AND is_match = 0
       GROUP BY expected_id, predicted_id
       ORDER BY hits DESC, expected_id ASC, predicted_id ASC
       LIMIT ?`,
    ).bind(MISS_REPORT_TOP_PAIRS),
    env.DB.prepare(
      `SELECT day,
              COUNT(*) AS total,
              SUM(CASE WHEN is_match = 0 THEN 1 ELSE 0 END) AS misses
       FROM miss_reports
       WHERE hidden = 0 AND day >= ?
       GROUP BY day
       ORDER BY day ASC`,
    ).bind(sinceDay),
    env.DB.prepare(
      `SELECT predicted_id, COUNT(*) AS hits
       FROM miss_reports
       WHERE hidden = 0 AND is_match = 0
       GROUP BY predicted_id
       ORDER BY hits DESC, predicted_id ASC
       LIMIT 10`,
    ),
  ]);

  const totalsRow = (totalsRes.results?.[0] ?? {
    total: 0,
    misses: 0,
    hits: 0,
  }) as { total: number; misses: number; hits: number };

  const topPairs = ((pairRes.results ?? []) as {
    expected_id: number;
    predicted_id: number;
    hits: number;
  }[]).map((r) => ({
    expectedId: r.expected_id,
    predictedId: r.predicted_id,
    hits: r.hits,
    label: `#${r.expected_id} → #${r.predicted_id}`,
  }));

  const daily = ((dailyRes.results ?? []) as {
    day: string;
    total: number;
    misses: number;
  }[]).map((r) => ({
    day: r.day,
    total: r.total,
    misses: r.misses,
  }));

  const topPredicted = ((predictedRes.results ?? []) as {
    predicted_id: number;
    hits: number;
  }[]).map((r) => ({
    soundId: r.predicted_id,
    hits: r.hits,
  }));

  return jsonResponse(
    {
      totals: {
        total: totalsRow.total ?? 0,
        misses: totalsRow.misses ?? 0,
        hits: totalsRow.hits ?? 0,
      },
      topMisidentified: topPairs,
      topPredictedAsWrong: topPredicted,
      daily,
      windowDays: DAILY_WINDOW_DAYS,
    },
    200,
    origin,
    { 'Cache-Control': 'public, max-age=30' },
  );
}

async function handlePatchMissReport(
  reportId: string,
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  const adminKey = env.ADMIN_KEY;
  const provided = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || provided !== adminKey) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }

  if (!reportId || reportId.length > 64) {
    return jsonResponse({ error: 'Invalid report id' }, 400, origin);
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
    `UPDATE miss_reports SET hidden = ? WHERE id = ?`,
  )
    .bind(body.hidden ? 1 : 0, reportId)
    .run();

  if (!result.meta.changes) {
    return jsonResponse({ error: 'Report not found' }, 404, origin);
  }

  return jsonResponse({ id: reportId, hidden: body.hidden, ok: true }, 200, origin);
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

    if (url.pathname === '/reports' && request.method === 'POST') {
      return handleCreateMissReport(request, env, origin);
    }

    if (url.pathname === '/reports' && request.method === 'GET') {
      return handleListMissReports(request, env, origin);
    }

    if (url.pathname === '/reports/stats' && request.method === 'GET') {
      return handleMissReportStats(env, origin);
    }

    const missPatchMatch = url.pathname.match(/^\/reports\/([^/]+)$/i);
    if (missPatchMatch && request.method === 'PATCH') {
      return handlePatchMissReport(decodeURIComponent(missPatchMatch[1]), request, env, origin);
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
            'POST /reports',
            'GET /reports',
            'GET /reports/stats',
            'PATCH /reports/:id',
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
