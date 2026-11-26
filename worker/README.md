# abi-merchant-counter

Cloudflare Worker + D1 store for global community tallies (votes + coarse site/daily counters).

- **Worker URL:** `https://abi-merchant-counter.brent-reichert.workers.dev`
- **D1:** `abi-merchant-stats` (binding `DB`)

## Deploy (Brent — needs Cloudflare login)

```bash
cd worker
npm install
npx wrangler login          # once, if not already authenticated
npm run db:migrate:remote   # apply migrations to remote D1
npm run deploy              # publish Worker
```

Prefer GitHub Actions **Deploy Cloudflare Worker** after merge (`worker/**` path filter or workflow_dispatch).

Local smoke:

```bash
npm run db:migrate:local
npm run dev
```

Endpoints: `POST /vote`, `POST /event`, `GET /stats`, `GET|POST /suggestions`, `POST /suggestions/:id/upvote`, `PATCH /suggestions/:id` (admin). CORS allows `https://dnange1.github.io` and `http://localhost:5173`.

Tables: `sound_votes` (+ `scan_count` / `red_count`), `site_counters`, `daily_stats`, `map_mode_counts`, `suggestions`, `suggestion_votes`, `suggestion_rate`. No raw event logs / no raw IPs (SHA-256 hashes only).

### Suggestions secrets (optional)

```bash
npx wrangler secret put ADMIN_KEY      # required for PATCH hide
npx wrangler secret put IP_HASH_SALT   # optional; rotates hashed-IP identity
```

`PATCH /suggestions/:id` with header `X-Admin-Key: <ADMIN_KEY>` and body `{ "hidden": true }`.

This folder is **not** part of the Vite / GitHub Pages build.
