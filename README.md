# ABI Merchant — Field Merchant scanner

Free, **static** browser tool for *Arena Breakout: Infinite*. It listens to cargo pickup audio on your PC and shows likely items, **Red Chance**, and (when you set raid filters) **expected value / payback**.

Nothing installs. Audio stays on your device. Not affiliated with Morefun Studios, Tencent, or ABI Builder.

---

## Open the live tool

1. Use **Chrome** or **Edge** on a Windows PC (best for sharing game audio).
2. Open: **[https://dnange1.github.io/ABI-Merchant/](https://dnange1.github.io/ABI-Merchant/)**
3. You should see **Start Scan** (big circle) and **Manual Mode**.

If the link 404s, the latest merge may still be deploying — wait a minute and refresh, or check the repo’s **Actions → Deploy GitHub Pages**.

---

## Quick start (Start Scan)

### 1. Setup (monitors + style)

1. Click **Start Scan**.
2. Choose **Single** or **Multi** monitors, then scan style (single item vs continuous / multi).
3. Finish the short wizard (sensitivity is fine on **Med** to start).

### 2. Share game audio

1. On the Start Scan screen, click **Start Listening**.
2. In Chrome/Edge’s share dialog:
   - Prefer the **Window** tab → **Arena Breakout: Infinite**
   - Turn **Share audio** / **Also share system audio** **on**
   - Avoid sharing the whole desktop unless window share has no audio
3. Click **At Shop** when you are at the Field Merchant.

**Cleaner locks**

- Game SFX volume roughly **80–100%**
- Turn **off** SteelSeries Sonar / Razer THX / Dolby Atmos / Windows Sonic for the game
- Hover the cargo, then **click-drag once** (avoid rapid double-clicks)
- If capture fails after swapping headphones ↔ speakers: **Retest**, or open **Troubleshooting** (top right) for Windows exclusive-mode steps (`Win+R` → `mmsys.cpl` → Playback → Properties → Advanced → uncheck exclusive control)

### 3. Set raid context (Map / Mode + cargo)

Use the sticky **Raid context** bar:

| Control | What it does |
|---|---|
| **Map / mode** | Picks the explorer loot **pool** for that raid (e.g. Farm Lockdown) |
| **Cargo type** | Mystery Cargo, Tools, etc. |
| **Cargo price** | Tooltip Koen price on the box |

Leave **Any** if you are unsure — sound matching still works; EV/payback is more accurate when type + price are set.

### 4. Read the result card

After a lock (or best guess):

- **Red Chance** — chance the cargo is Mythic / red (rarity ≥ 6), after your size + raid filters
- **Expected value** — weighted average contact price of remaining candidates
- **Payback** — EV ÷ cargo price × 100 (**100%** ≈ break-even; higher is better). Needs a cargo price in Raid context
- Item tiles show **%**, size, and rarity-colored borders

Size checkboxes only list sizes in the locked sound group. Wrong size → 0% / excluded; remaining % are redistributed.

👍 / 👎 / Skip help calibration (optional). Votes also sync in the background to a Cloudflare Worker for community accuracy stats; localStorage still works if the Worker is offline.

---

## Manual Mode

Use when you do not want display capture: pick filters + a Sound ID from the board and audition pickup samples. Same raid context filters apply.

---

## What runs fully offline (vendored)

Shipped **in this repo** for GitHub Pages — **no live CDN calls required** for normal use:

| Asset | Path | Notes |
|---|---|---|
| Item catalog + pools | `src/data/merchantData.json` | Sounds, items, profiles, mapModes, weighted pools |
| Fingerprints | `src/data/fingerprints.json` | Matcher templates |
| Pickup/drop audio | `public/sounds/*.ogg` | 76 files |
| Item thumbnails | `public/icons/{id}.png` | 189 PNGs (mirrored from the public explorer CDN at extract time) |

`iconRemote` in JSON is **maintainer-only** (re-download source). The UI loads **local** `/icons/…` via Vite `base` (`assetUrl`).

### Still remote (optional / not required to play)

| Thing | Why |
|---|---|
| Maintainer `npm run extract` against abibuilder / Wayback | Refresh pools when the season changes — **not** used by the live Pages site |
| Community 👍/👎 Worker (`abi-merchant-counter`) | Fire-and-forget tallies; UI never depends on it |
| External links in the footer / README | Attribution only |

If hexaov91 or abibuilder move or go down, **players are fine** until the next data refresh; only maintainers re-running extract need those hosts.

---

## Privacy & credit

- Audio analysis is **100% local**
- Catalog structure courtesy of the public explorer: [abibuilder.com/merchant](https://abibuilder.com/merchant)
- Independent fan tool — not an official partner product

---

## Maintainers

```bash
npm install
npm run dev
npm run build
GITHUB_PAGES=1 npm run build   # same as CI
npm run selftest:audio
```

Refresh catalog (needs Playwright + ffmpeg; not run in Pages CI):

```bash
npx playwright install chromium
npm run extract
# or: node scripts/extractMerchantData.js --from-html /path/to/saved-merchant.html
```

### Versioning

Footer shows `v{package.json}`. Pre-publish: `0.9.<PR#>`.

### Pages deploy

`.github/workflows/deploy-pages.yml` on `main`: verifies committed JSON + 76 OGGs + 189 icons → `GITHUB_PAGES=1 npm run build` → deploy `dist/`. The `/worker` folder is ignored by Vite (not part of Pages).

### Cloudflare Worker (community votes + miss reports)

See [`worker/README.md`](worker/README.md). Votes, Suggestions, and public miss / confusion reports (numbers-only — never audio) live on `abi-merchant-counter` + D1. Brent deploys with `wrangler` (login + D1 migrate + deploy); no tokens live in this repo.
