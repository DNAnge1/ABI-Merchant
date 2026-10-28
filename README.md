# ABI Field Merchant Scanner

100% client-side static web app for *Arena Breakout: Infinite* (Season 7). Identify Mystery Cargo by matching in-game pickup/drop audio against the 38 Sound IDs from [abibuilder.com/merchant](https://abibuilder.com/merchant), filtered by cargo size and price.

**Players need zero install.** Open the hosted site (GitHub Pages / custom domain) in Chrome or Edge. No `npm`, Playwright, or ffmpeg.

**Privacy:** audio never leaves the device. No backend.

## Player flow (hosted)

1. Put the game on a windowed / second monitor; open this site in Chrome/Edge.
2. Set cargo **size**, **type**, and **price** to match the box you see.
3. Click **Start Listening — Capture Game Audio** and share the **game window/tab with audio**.
4. Grab or drag the Mystery Cargo in-game.
5. The app detects the audio spike, matches a Sound ID, then shows:
   - **Red / Mythic chance (%)** among candidates for that sound under your filters
   - **Exact candidate list** (Reds first) with **Koen** contact values

Reference data (`src/data/merchantData.json`, `src/data/fingerprints.json`) and all 76 pickup/drop `.ogg` files under `public/sounds/` are **committed** — GitHub Pages builds only those static assets (no scrape at deploy time).

## Dev / maintainers

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production bundle (includes committed sounds)
```

Refresh scraped data (maintainers only — not required for players or Pages):

```bash
npx playwright install chromium   # once
# ffmpeg on PATH
npm run extract
```

`npm run extract` may fall back to a Wayback snapshot if live abibuilder HTML is Cloudflare-blocked. Audio CDN URLs are usually fetchable directly.

## Pages build path

`.github/workflows/deploy-pages.yml` on `main`:

1. `npm ci`
2. Verify committed `merchantData.json`, `fingerprints.json`, and 76 OGGs
3. `GITHUB_PAGES=1 npm run build` → upload `dist/`

No extract / Playwright / ffmpeg in CI.
