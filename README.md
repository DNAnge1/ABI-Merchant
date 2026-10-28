# ABI Field Merchant Scanner

100% client-side static web app for *Arena Breakout: Infinite* (Season 7). Identify Mystery Cargo contents by matching in-game pickup/drop audio against the 38 Sound IDs from [abibuilder.com/merchant](https://abibuilder.com/merchant), filtered by cargo size and price.

**Privacy:** audio never leaves the device. No backend. Hostable on GitHub Pages.

## Quick start

```bash
npm install
npm run extract   # scrape merchant data, download sounds, build fingerprints
npm run dev       # http://localhost:5173
```

Build for production:

```bash
npm run build
npm run preview
```

For GitHub Pages builds, set `GITHUB_PAGES=1` so the Vite `base` is `/ABI-Merchant/`.

## Phase 1 — extract script

`scripts/extractMerchantData.js` (Node + Playwright):

1. Opens `https://abibuilder.com/merchant` (falls back to Wayback if Cloudflare blocks)
2. Parses Sound IDs, items, rarities, sizes, and cargo sources
3. Writes `src/data/merchantData.json`
4. Downloads pickup/drop `.ogg` files into `public/sounds/`
5. Runs offline FFT analysis (dominant peaks, spectral centroid, duration envelope) into `src/data/fingerprints.json`

Requires: Node 20+, Playwright Chromium (`npx playwright install chromium`), and `ffmpeg` on `PATH`.

## Phase 2 — matcher UI

Vite + React + TypeScript + Tailwind dark compact UI:

- 4-step status bar (Select → Listening → Drag Cargo → Match Ready)
- Cargo size / type / price filters + merchant candidate grid
- Mythic (red) highlighting
- Manual 38-sound Pick up / Drop board
- `src/utils/audioMatcher.ts` — `AudioContext` + `AnalyserNode` (`fftSize=2048`), onset detection, 300ms slice, cosine similarity vs fingerprints filtered by size+price

Capture uses:

```js
navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
```

Share the game window/tab **with audio** when prompted.

## Scripts

| Command | Description |
|--------|-------------|
| `npm run extract` | Refresh merchant data, sounds, fingerprints |
| `npm run dev` | Local Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview production build |

## Notes

- Live HTML scrape may hit Cloudflare; the extract script falls back to a Wayback snapshot. Audio CDN (`/audio/merchant/*.ogg`) is usually reachable directly.
- Re-run `npm run extract` after game patches when abibuilder updates Sound ID mappings.
