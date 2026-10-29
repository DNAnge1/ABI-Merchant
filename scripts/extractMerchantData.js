#!/usr/bin/env node
/**
 * Phase 1 — scrape abibuilder.com/merchant, download pickup/drop audio,
 * and generate spectral fingerprints for the client-side matcher.
 *
 * Usage: npm run extract
 *
 * Notes:
 * - The HTML app is behind Cloudflare; Playwright may be challenged.
 * - When live scrape fails, we fall back to the latest Wayback snapshot.
 * - Audio files at /audio/merchant/*.ogg are publicly fetchable without CF.
 */

import { chromium } from 'playwright';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DATA = join(ROOT, 'src/data/merchantData.json');
const OUT_FP = join(ROOT, 'src/data/fingerprints.json');
const SOUNDS_DIR = join(ROOT, 'public/sounds');
const LIVE_URL = 'https://abibuilder.com/merchant';
const WAYBACK_URL =
  'https://web.archive.org/web/20261009010813id_/https://abibuilder.com/merchant';
const AUDIO_BASE = 'https://abibuilder.com/audio/merchant';

const KNOWN_CARGO = {
  100001: 'Flammables',
  100003: 'Building Materials',
  100004: 'Computer Parts',
  100006: 'Energy Items',
  100008: 'Tools',
  100009: 'Household Items',
  100010: 'Medical Supplies',
  100011: 'Rare Medical Supplies',
  100012: 'Collectibles',
  100013: 'Uncommon Collectibles',
  100015: 'Rare Collectibles',
  100016: 'Paper',
  100017: 'Instruments',
  100018: 'Military Items',
  100020: 'Uncommon Military Items',
  100021: 'Electronics',
  100022: 'Mystery Cargo',
  100023: 'Uncommon Mystery Cargo',
  100026: 'Rare Mystery Cargo',
};

function ensureDirs() {
  mkdirSync(SOUNDS_DIR, { recursive: true });
  mkdirSync(dirname(OUT_DATA), { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function scrapeWithPlaywright(url) {
  console.log(`[scrape] Playwright → ${url}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    // Wait for either Cloudflare pass or merchant content.
    await page.waitForTimeout(5000);
    const title = await page.title();
    if (/just a moment/i.test(title)) {
      console.warn('[scrape] Cloudflare challenge still present');
      return null;
    }
    const html = await page.content();
    // Also try to harvest network-loaded JSON if the SPA exposes it.
    const extracted = await page.evaluate(() => {
      const audio = Array.from(document.querySelectorAll('audio, [data-sound], button'))
        .map((el) => el.getAttribute('src') || el.textContent || '')
        .filter(Boolean);
      return { audioHints: audio.slice(0, 20), bodyLen: document.body?.innerText?.length ?? 0 };
    });
    console.log(`[scrape] body text length=${extracted.bodyLen}`);
    if ((extracted.bodyLen || 0) < 500) return null;
    return html;
  } finally {
    await browser.close();
  }
}

function unescapeNextPayload(s) {
  // Next.js RSC string payloads use JS-string escaping.
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function extractPayloadText(html) {
  const payloads = [];
  const re = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    payloads.push(unescapeNextPayload(m[1]));
  }
  return payloads.join('');
}

function parseMerchantHtml(html, sourceLabel) {
  const text = extractPayloadText(html);
  if (!text || text.length < 1000) {
    throw new Error('Could not find Next.js RSC merchant payload in HTML');
  }

  const cargoTypes = { ...KNOWN_CARGO };
  for (const m of text.matchAll(/\{"id":(\d+),"name":"([^"]+)"\}/g)) {
    const id = Number(m[1]);
    const name = m[2];
    if (
      /Cargo|Items|Collectibles|Electronics|Medical|Materials|Household|Military|Flammables|Tools|Paper|Instruments|Energy|Computer/i.test(
        name,
      )
    ) {
      cargoTypes[id] = name;
    }
  }

  const itemRe =
    /\{"iconId":(\d+),"rarity":(\d+),"referencePrice":(\d+),"iconAvailable":(?:true|false),"kind":"item","contactPrice":(\d+),"size":\[(\d+),(\d+)\],"category":(\d+),"soundId":(\d+),"id":(\d+),"iconUrl":"([^"]*)","name":"((?:\\.|[^"\\])*)","describe":"((?:\\.|[^"\\])*)","categoryName":"((?:\\.|[^"\\])*)","pickupSound":"([^"]*)","dropSound":"([^"]*)"\}/g;

  const itemsById = new Map();
  for (const m of text.matchAll(itemRe)) {
    const [
      ,
      iconId,
      rarity,
      referencePrice,
      contactPrice,
      sw,
      sh,
      category,
      soundId,
      id,
      iconUrl,
      name,
      describe,
      categoryName,
      pickupSound,
      dropSound,
    ] = m;
    const iid = Number(id);
    if (itemsById.has(iid)) continue;
    const unesc = (s) => {
      try {
        return JSON.parse(`"${s}"`);
      } catch {
        return s;
      }
    };
    itemsById.set(iid, {
      id: iid,
      iconId: Number(iconId),
      name: unesc(name),
      rarity: Number(rarity),
      size: `${sw}x${sh}`,
      category: unesc(categoryName),
      categoryId: Number(category),
      contactPrice: Number(contactPrice),
      referencePrice: Number(referencePrice),
      soundId: Number(soundId),
      iconUrl,
      describe: unesc(describe),
      pickupSound,
      dropSound,
      sources: [],
    });
  }

  const boxRe =
    /\{"id":(\d+),"profile":(\d+),"itemGroup":(\d+),"weight":(\d+),"typeId":(\d+),"price":(\d+),"nameKey":(\d+),"weightTotal":(\d+),"items":\[(.*?)\]\}/g;
  const sourcesByItem = new Map();
  const cargoPrices = new Set();
  const cargoTypeNames = new Set();

  for (const m of text.matchAll(boxRe)) {
    const typeId = Number(m[5]);
    const price = Number(m[6]);
    const itemsJson = m[9];
    const cargoType = cargoTypes[typeId] || `type_${typeId}`;
    cargoPrices.add(price);
    cargoTypeNames.add(cargoType);
    const srcKey = `${cargoType}@@${price}`;
    for (const im of itemsJson.matchAll(/\{"id":(\d+),"weight":(\d+)\}/g)) {
      const iid = Number(im[1]);
      if (!sourcesByItem.has(iid)) sourcesByItem.set(iid, new Map());
      const map = sourcesByItem.get(iid);
      if (!map.has(srcKey)) {
        map.set(srcKey, { cargoType, cargoPrice: price });
      }
    }
  }

  for (const [iid, item] of itemsById) {
    const map = sourcesByItem.get(iid);
    item.sources = map ? Array.from(map.values()) : [];
  }

  const sounds = new Map();
  for (const item of itemsById.values()) {
    if (!sounds.has(item.soundId)) {
      sounds.set(item.soundId, {
        soundId: item.soundId,
        pickupSound: item.pickupSound,
        dropSound: item.dropSound,
        pickupFile: `/sounds/${item.pickupSound}.ogg`,
        dropFile: `/sounds/${item.dropSound}.ogg`,
        itemIds: [],
        itemNames: [],
      });
    }
    const s = sounds.get(item.soundId);
    s.itemIds.push(item.id);
    s.itemNames.push(item.name);
  }

  const items = Array.from(itemsById.values()).map((item) => ({
    id: item.id,
    name: item.name,
    rarity: item.rarity,
    size: item.size,
    category: item.category,
    contactPrice: item.contactPrice,
    soundId: item.soundId,
    iconUrl: item.iconUrl,
    pickupSound: item.pickupSound,
    dropSound: item.dropSound,
    sources: item.sources,
  }));

  items.sort((a, b) => b.rarity - a.rarity || b.contactPrice - a.contactPrice || a.name.localeCompare(b.name));

  return {
    source: LIVE_URL,
    extractedFrom: sourceLabel,
    extractedAt: new Date().toISOString(),
    soundIds: Array.from(sounds.values()).sort((a, b) => a.soundId - b.soundId),
    items,
    cargoTypes: Array.from(cargoTypeNames).sort(),
    cargoPrices: Array.from(cargoPrices).sort((a, b) => a - b),
    sizes: Array.from(new Set(items.map((i) => i.size))).sort(),
  };
}

async function downloadAudio(soundIds) {
  const names = new Set();
  for (const s of soundIds) {
    names.add(s.pickupSound);
    names.add(s.dropSound);
  }
  console.log(`[audio] downloading ${names.size} files → ${SOUNDS_DIR}`);
  let ok = 0;
  let fail = 0;
  for (const name of names) {
    const dest = join(SOUNDS_DIR, `${name}.ogg`);
    if (existsSync(dest) && readFileSync(dest).length > 100) {
      ok++;
      continue;
    }
    const url = `${AUDIO_BASE}/${name}.ogg`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      ok++;
      console.log(`  ✓ ${name}.ogg`);
    } catch (err) {
      fail++;
      console.warn(`  ✗ ${name}.ogg — ${err.message}`);
    }
  }
  console.log(`[audio] done ok=${ok} fail=${fail}`);
  return { ok, fail };
}

/** Decode OGG to mono float32 PCM via ffmpeg. */
function decodeOggToPcm(filePath, sampleRate = 22050) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() || 'ffmpeg failed');
  }
  const buf = result.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/** In-place radix-2 Cooley–Tukey FFT on interleaved complex [re,im,...]. */
function fft(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]];
      ;[im[i], im[j]] = [im[j], im[i]];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = Math.PI / half;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = -step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const evenRe = re[i + k];
        const evenIm = im[i + k];
        const oddRe = re[i + k + half];
        const oddIm = im[i + k + half];
        const tr = wr * oddRe - wi * oddIm;
        const ti = wr * oddIm + wi * oddRe;
        re[i + k] = evenRe + tr;
        im[i + k] = evenIm + ti;
        re[i + k + half] = evenRe - tr;
        im[i + k + half] = evenIm - ti;
      }
    }
  }
}

const LIVE_SLICE_MS = 300;

/**
 * Live-aligned analysis: find first energetic onset, then average ~300ms of
 * FFT frames (mirrors AudioMatcher.captureAndMatch / offlineSelftest live300).
 * Field Merchant players only hear pickup — fingerprints are built from that window.
 */
function analyzePcmLive300(samples, sampleRate = 22050, fftSize = 2048) {
  const window = hannWindow(fftSize);
  const hopEnv = Math.max(1, Math.floor(sampleRate * 0.01));
  const envelope = [];
  for (let i = 0; i + hopEnv <= samples.length; i += hopEnv) {
    let sum = 0;
    for (let k = 0; k < hopEnv; k++) {
      const v = samples[i + k];
      sum += v * v;
    }
    envelope.push(Math.sqrt(sum / hopEnv));
  }
  const maxEnv = Math.max(...envelope, 1e-9);
  const durationEnvelope = envelope.map((v) => Number((v / maxEnv).toFixed(4)));

  let maxRms = 0;
  for (const r of envelope) maxRms = Math.max(maxRms, r);
  const floor = Math.max(0.02, maxRms * 0.25);
  let onset = 0;
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] >= floor) {
      onset = i * hopEnv;
      break;
    }
  }

  const sliceSamples = Math.floor((LIVE_SLICE_MS / 1000) * sampleRate);
  const end = Math.min(samples.length, onset + sliceSamples);
  const half = fftSize / 2;
  const hop = Math.floor(fftSize / 4); // denser hops like rAF analyser polls
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const bandAccum = new Array(32).fill(0);
  const centroids = [];
  let frames = 0;

  const frameBandsAndCentroid = (start) => {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[start + i] || 0) * window[i];
    }
    fft(re, im);
    const mag = new Float64Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
    const bands = 32;
    const bandVec = new Array(bands).fill(0);
    const bandCounts = new Array(bands).fill(0);
    const minF = 80;
    const maxF = Math.min(sampleRate / 2, 8000);
    for (let i = 1; i < half; i++) {
      const freq = (i * sampleRate) / fftSize;
      if (freq < minF || freq > maxF) continue;
      const t = Math.log(freq / minF) / Math.log(maxF / minF);
      const bi = Math.min(bands - 1, Math.floor(t * bands));
      bandVec[bi] += mag[i];
      bandCounts[bi] += 1;
    }
    // Average bins per log-band (raw += inflates highs).
    for (let bi = 0; bi < bands; bi++) {
      if (bandCounts[bi] > 0) bandVec[bi] /= bandCounts[bi];
    }
    const bandMax = Math.max(...bandVec, 1e-9);
    const normalized = bandVec.map((v) => v / bandMax);
    let num = 0;
    let den = 0;
    for (let i = 1; i < half; i++) {
      const freq = (i * sampleRate) / fftSize;
      num += freq * mag[i];
      den += mag[i];
    }
    return { normalized, centroid: den > 0 ? num / den : 0, mag };
  };

  let lastMag = null;
  for (let start = onset; start + fftSize <= end; start += hop) {
    const { normalized, centroid, mag } = frameBandsAndCentroid(start);
    for (let i = 0; i < 32; i++) bandAccum[i] += normalized[i];
    centroids.push(centroid);
    lastMag = mag;
    frames++;
  }

  if (frames === 0) {
    const start = Math.max(0, Math.min(onset, Math.max(0, samples.length - fftSize)));
    const { normalized, centroid, mag } = frameBandsAndCentroid(start);
    for (let i = 0; i < 32; i++) bandAccum[i] = normalized[i];
    centroids.push(centroid);
    lastMag = mag;
    frames = 1;
  }

  for (let i = 0; i < 32; i++) bandAccum[i] /= frames;
  const bandMax = Math.max(...bandAccum, 1e-9);
  const spectrumVector = bandAccum.map((v) => Number((v / bandMax).toFixed(5)));
  const spectralCentroid = centroids.reduce((a, b) => a + b, 0) / centroids.length;

  const magnitudes = lastMag || new Float64Array(half);
  const peakCandidates = [];
  for (let i = 1; i < half - 1; i++) {
    if (magnitudes[i] >= magnitudes[i - 1] && magnitudes[i] >= magnitudes[i + 1]) {
      peakCandidates.push({
        frequencyHz: (i * sampleRate) / fftSize,
        magnitude: magnitudes[i],
      });
    }
  }
  peakCandidates.sort((a, b) => b.magnitude - a.magnitude);
  const maxMag = peakCandidates[0]?.magnitude || 1;
  const dominantPeaks = peakCandidates.slice(0, 8).map((p) => ({
    frequencyHz: Number(p.frequencyHz.toFixed(2)),
    magnitude: Number((p.magnitude / maxMag).toFixed(4)),
  }));

  return {
    durationMs: Number(((samples.length / sampleRate) * 1000).toFixed(1)),
    sampleRate,
    fftSize,
    windowMs: LIVE_SLICE_MS,
    onsetMs: Number(((onset / sampleRate) * 1000).toFixed(1)),
    frames,
    spectralCentroid: Number(spectralCentroid.toFixed(2)),
    dominantPeaks,
    durationEnvelope,
    spectrumVector,
  };
}

/** @deprecated kept for offline tooling that wants full-file vectors */
function analyzePcm(samples, sampleRate = 22050, fftSize = 2048) {
  return analyzePcmLive300(samples, sampleRate, fftSize);
}

/**
 * Field Merchant: players only hear pickup. Build pickup-only fingerprints from
 * the same ~300ms post-onset window the live matcher captures.
 */
function generateFingerprints(merchant) {
  console.log('[fingerprint] pickup-only · ~300ms post-onset windows…');
  const fingerprints = {};
  for (const sound of merchant.soundIds) {
    const entry = {
      soundId: sound.soundId,
      pickup: null,
      drop: null, // retained for schema; matching ignores drop
      itemNames: sound.itemNames,
    };
    const base = sound.pickupSound;
    const file = join(SOUNDS_DIR, `${base}.ogg`);
    if (!existsSync(file)) {
      console.warn(`  missing pickup ${base}.ogg`);
    } else {
      try {
        const pcm = decodeOggToPcm(file);
        entry.pickup = {
          file: `/sounds/${base}.ogg`,
          name: base,
          ...analyzePcmLive300(pcm),
        };
        console.log(
          `  ✓ sound ${sound.soundId} pickup onset=${entry.pickup.onsetMs}ms centroid=${entry.pickup.spectralCentroid}Hz frames=${entry.pickup.frames}`,
        );
      } catch (err) {
        console.warn(`  ✗ ${base}: ${err.message}`);
      }
    }
    fingerprints[sound.soundId] = entry;
  }
  return {
    generatedAt: new Date().toISOString(),
    fftSize: 2048,
    sampleRate: 22050,
    vectorBands: 32,
    windowMs: LIVE_SLICE_MS,
    matchSide: 'pickup',
    analysis: 'live300-post-onset-binavg',
    fingerprints,
  };
}

async function main() {
  ensureDirs();
  const fingerprintsOnly = process.argv.includes('--fingerprints-only');

  let merchant;
  if (fingerprintsOnly) {
    if (!existsSync(OUT_DATA)) {
      throw new Error(`Missing ${OUT_DATA} — run full extract first`);
    }
    merchant = JSON.parse(readFileSync(OUT_DATA, 'utf8'));
    console.log(
      `[fingerprints-only] reusing merchantData sounds=${merchant.soundIds.length}`,
    );
  } else {
    let html = null;
    let sourceLabel = LIVE_URL;

    try {
      html = await scrapeWithPlaywright(LIVE_URL);
    } catch (err) {
      console.warn(`[scrape] Playwright live failed: ${err.message}`);
    }

    if (!html) {
      console.log('[scrape] falling back to Wayback Machine snapshot');
      sourceLabel = WAYBACK_URL;
      try {
        html = await scrapeWithPlaywright(WAYBACK_URL);
      } catch (err) {
        console.warn(`[scrape] Playwright Wayback failed: ${err.message}`);
      }
    }

    if (!html) {
      console.log('[scrape] fetching Wayback HTML via HTTP');
      html = await fetchText(WAYBACK_URL);
      sourceLabel = WAYBACK_URL + ' (HTTP)';
    }

    merchant = parseMerchantHtml(html, sourceLabel);
    console.log(
      `[data] items=${merchant.items.length} sounds=${merchant.soundIds.length} cargoTypes=${merchant.cargoTypes.length}`,
    );

    writeFileSync(OUT_DATA, JSON.stringify(merchant, null, 2));
    console.log(`[data] wrote ${OUT_DATA}`);

    await downloadAudio(merchant.soundIds);
  }

  const fp = generateFingerprints(merchant);
  writeFileSync(OUT_FP, JSON.stringify(fp, null, 2));
  console.log(`[fingerprint] wrote ${OUT_FP}`);
  console.log('[done]');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
