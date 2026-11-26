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

Endpoints: `POST /vote`, `POST /event`, `GET /stats`. CORS allows `https://dnange1.github.io` and `http://localhost:5173`.

Tables: `sound_votes` (+ `scan_count` / `red_count`), `site_counters`, `daily_stats`, `map_mode_counts`. No raw event logs.

This folder is **not** part of the Vite / GitHub Pages build.
