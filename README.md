# ABI Field Merchant Scanner

100% client-side static web app for *Arena Breakout: Infinite* (Season 7). Identify Mystery Cargo by matching in-game pickup/drop audio against the 38 Sound IDs from [abibuilder.com/merchant](https://abibuilder.com/merchant).

**Players need zero install.** Open the hosted site (GitHub Pages / custom domain) in **Chrome** or **Edge**. No `npm`, Playwright, or ffmpeg.

**Privacy:** audio never leaves the device. No backend.

## Player flow

### Automatic Mode (default)
1. **Top setup:** Monitor (Single | Dual) + Scan Style (Single Item | Multiple Items Continuous). Single locks Continuous (Alt+Tab grace 1.5s) and unlocks Sound Alerts / Mini-Overlay.
2. **Verify / Test Audio Access** — `getDisplayMedia` tracks, RMS meter, Chromium/Brave/FF-Safari guides, Manual fallback.
3. **Start Listening** — share game audio.
4. **Style A (Single Item):** Ready → lock Group # + confidence → size-grouped Red % → 👍 / 👎 / ⏭️ (Space/Esc). 👎 logs miss + spectral snapshot.
5. **Style B (Dual Continuous):** ~600ms debounce, live merchant slots with Group #, Red glow, per-slot 👍👎✕, Clear All / New Merchant Refresh.

### Manual Mode + Accuracy
- Filter pills + 38-ID sound board → size-grouped results
- **Accuracy Stats** (Total Scans, 👍 Accuracy %, Reds Found) + **Export Calibration Log (JSON)** (`localStorage` schema v1, DB-ready)

## Committed static assets (Pages OOTB)

- `src/data/merchantData.json`
- `src/data/fingerprints.json`
- `public/sounds/*.ogg` (76 = 38 pickup + 38 drop)

GitHub Pages builds **only** these assets — no scrape/extract in CI.

## Dev / maintainers

```bash
npm install
npm run dev
npm run build
```

Refresh data (maintainers only):

```bash
npx playwright install chromium
npm run extract   # needs ffmpeg; not used by Pages
```

## Pages build path

`.github/workflows/deploy-pages.yml` on `main`: verify committed JSON + 76 OGGs → `GITHUB_PAGES=1 npm run build` → deploy `dist/`.

## Versioning

Footer shows `v{package.json}` (Vite `__APP_VERSION__`).

- **Pre-publish:** `0.9.<PR_number>` (e.g. PR #30 → `0.9.30`)
- **After public publish:** `1.0.<PR_number>` per PR
