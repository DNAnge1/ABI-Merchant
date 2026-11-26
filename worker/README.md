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

Endpoints: `POST /vote`, `POST /event`, `GET /stats`, `POST|GET /reports`, `GET /reports/stats`, `PATCH /reports/:id` (admin), `GET|POST /suggestions`, `POST /suggestions/:id/upvote`, `PATCH /suggestions/:id` (admin). CORS allows `https://dnange1.github.io` and `http://localhost:5173`.

Tables: `sound_votes` (+ `scan_count` / `red_count`), `site_counters`, `daily_stats`, `map_mode_counts`, `miss_reports`, `miss_report_rate`, `suggestions`, `suggestion_votes`, `suggestion_rate`. Miss reports store numbers-only `MissReportPayload` v1 JSON (no audio / spectrum). No raw IPs (SHA-256 hashes only).

### Admin / rate-limit secrets (optional)

```bash
npx wrangler secret put ADMIN_KEY      # required for PATCH hide (suggestions + miss reports)
npx wrangler secret put IP_HASH_SALT   # optional; rotates hashed-IP identity
```

`PATCH /suggestions/:id` or `PATCH /reports/:id` with header `X-Admin-Key: <ADMIN_KEY>` and body `{ "hidden": true }`.

`POST /reports` rate limit: 30 / hour / hashed IP. `GET /reports` and `GET /reports/stats` are public (Brent: open confusion summaries).

This folder is **not** part of the Vite / GitHub Pages build.
