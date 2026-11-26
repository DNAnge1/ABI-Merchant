/**
 * abi-merchant-counter — global 👍/👎 tallies for ABI Merchant sound locks.
 * Bound to D1 `abi-merchant-stats` via `DB`.
 */

export interface Env {
  DB: D1Database;
}

const ALLOWED_ORIGINS = new Set([
  'https://dnange1.github.io',
  'http://localhost:5173',
]);

const MIN_SOUND_ID = 1;
const MAX_SOUND_ID = 38;

type VoteKind = 'up' | 'down';

interface SoundVoteRow {
  sound_id: number;
  up_count: number;
  down_count: number;
}

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function parseSoundId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_SOUND_ID || n > MAX_SOUND_ID) return null;
  return n;
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
  // Ensure row exists, then atomically increment the chosen column.
  await env.DB.prepare(
    `INSERT INTO sound_votes (sound_id, up_count, down_count)
     VALUES (?, 0, 0)
     ON CONFLICT(sound_id) DO NOTHING`,
  )
    .bind(soundId)
    .run();

  const incSql =
    column === 'up'
      ? `UPDATE sound_votes SET up_count = up_count + 1 WHERE sound_id = ?`
      : `UPDATE sound_votes SET down_count = down_count + 1 WHERE sound_id = ?`;

  await env.DB.prepare(incSql).bind(soundId).run();

  const row = await env.DB.prepare(
    `SELECT sound_id, up_count, down_count FROM sound_votes WHERE sound_id = ?`,
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
    },
    200,
    origin,
  );
}

async function handleStats(env: Env, origin: string | null): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT sound_id, up_count, down_count FROM sound_votes ORDER BY sound_id ASC`,
  ).all<SoundVoteRow>();

  const sounds = (results ?? []).map((r) => ({
    soundId: r.sound_id,
    upCount: r.up_count,
    downCount: r.down_count,
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

  return jsonResponse(
    {
      sounds,
      aggregates: {
        totalUp,
        totalDown,
        totalVotes: scored,
        accuracyPct,
        soundsWithVotes: sounds.length,
      },
    },
    200,
    origin,
  );
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

    if (url.pathname === '/stats' && request.method === 'GET') {
      return handleStats(env, origin);
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return jsonResponse(
        {
          name: 'abi-merchant-counter',
          endpoints: ['POST /vote', 'GET /stats'],
        },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
};
