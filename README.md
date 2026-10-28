# ABI Field Merchant Scanner

100% client-side static web app for *Arena Breakout: Infinite* (Season 7). Identify Mystery Cargo by matching in-game pickup/drop audio against the 38 Sound IDs from [abibuilder.com/merchant](https://abibuilder.com/merchant).

**Players need zero install.** Open the hosted site (GitHub Pages / custom domain) in **Chrome** or **Edge**. No `npm`, Playwright, or ffmpeg.

**Privacy:** audio never leaves the device. No backend.

## Player flow

### Automatic Mode (default)
1. Game on a windowed / second monitor; open this site in Chrome/Edge.
2. **Verify / Test Audio Access** — confirms `getDisplayMedia` audio (fixes for Chromium/Windows system audio, Brave Shields; Firefox/Safari → Manual Mode).
3. **Start Listening** — share game window/tab **with audio**.
4. Grab/drag Mystery Cargo — onset detect matches **all 38 Sound IDs** (no size/price pre-filter).
5. **Size-grouped results**: cards for 1x1 / 1x2 / 2x1 / 2x2 / 2x3 / 3x2 (rotations labeled) with per-size **Red chance %**, candidates (Reds first: name, rarity, Koen, cargo price tiers).

### Manual Mode
- Size / cargo type / cargo price **filter pills**
- Sound board: Pick up / Drop for all 38 IDs
- Click a Sound ID → same size-grouped results view

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
