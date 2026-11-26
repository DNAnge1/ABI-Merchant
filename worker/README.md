# abi-merchant-counter

Cloudflare Worker + D1 store for global 👍/👎 accuracy tallies.

- **Worker URL:** `https://abi-merchant-counter.brent-reichert.workers.dev`
- **D1:** `abi-merchant-stats` (binding `DB`)

## Deploy (Brent — needs Cloudflare login)

```bash
cd worker
npm install
npx wrangler login          # once, if not already authenticated
npm run db:migrate:remote   # apply sound_votes migration to remote D1
npm run deploy              # publish Worker
```

Local smoke:

```bash
npm run db:migrate:local
npm run dev
```

Endpoints: `POST /vote`, `GET /stats`. CORS allows `https://dnange1.github.io` and `http://localhost:5173`.

This folder is **not** part of the Vite / GitHub Pages build.
