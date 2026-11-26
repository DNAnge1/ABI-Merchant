/**
 * Screenshots for pools-in-raid-context + live consensus hop hold.
 * Usage: node scripts/poolsInRaidContextScreenshots.mjs [outDir] [baseUrl]
 */
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir =
  process.argv[2] ||
  '/cursor/stores/bc-5c080d60-6249-418b-b13a-8bf42c7f6cd6/media/pools-in-raid-context';
const artifactDir = '/opt/cursor/artifacts';
const baseUrl = (process.argv[3] || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
mkdirSync(outDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

function saveBoth(name, fromPath) {
  const dest = join(outDir, name);
  copyFileSync(fromPath, dest);
  copyFileSync(fromPath, join(artifactDir, name));
  console.log('wrote', dest);
}

{
  const page = await browser.newPage({ viewport: { width: 980, height: 1000 } });
  await page.goto(`${baseUrl}?liveStickyDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tactical-result], [data-catch-hud="v2"]', {
    timeout: 15000,
  });
  await page.waitForTimeout(2800);

  const primary = await page.evaluate(() => {
    const el = document.querySelector('[data-live-primary-sound]');
    return el ? Number(el.getAttribute('data-live-primary-sound')) : null;
  });
  console.log('live consensus primary soundId:', primary);
  if (primary != null && primary !== 1) {
    console.error('FAIL: expected consensus Group #1, got', primary);
    process.exitCode = 1;
  }

  const poolsInRaid = await page.locator('[data-raid-context] [data-pools-in-raid-context]').count();
  const floatingPools = await page.locator('button', {
    hasText: 'Pools — map/mode weight explainer →',
  }).count();
  const footerLabel = await page.locator('footer button', { hasText: /^Map Pools$/ }).count();
  const footerOld = await page.locator('footer button', { hasText: /^Map \/ Mode$/ }).count();
  const hintFooter = await page.locator('[data-raid-context]', {
    hasText: 'Footer → Map',
  }).count();

  console.log({
    poolsInRaid,
    floatingPools,
    footerLabel,
    footerOld,
    hintFooter,
  });

  if (poolsInRaid < 1) {
    console.error('FAIL: expected Pools link inside Raid Context');
    process.exitCode = 1;
  }
  // One inside Raid Context only — floating sibling must be gone (count === poolsInRaid).
  if (floatingPools !== poolsInRaid) {
    console.error('FAIL: floating Pools link still outside Raid Context, count=', floatingPools);
    process.exitCode = 1;
  }
  if (footerLabel !== 1) {
    console.error('FAIL: footer should say Map Pools');
    process.exitCode = 1;
  }
  if (footerOld !== 0) {
    console.error('FAIL: old footer Map / Mode label still present');
    process.exitCode = 1;
  }
  if (hintFooter !== 0) {
    console.error('FAIL: Footer → Map hint still in Raid Context');
    process.exitCode = 1;
  }

  const tmpLive = join(artifactDir, '_tmp-consensus-hold.png');
  await page.screenshot({ path: tmpLive, fullPage: true });
  saveBoth('01-live-consensus-holds-group-1.png', tmpLive);

  const tmpRaid = join(artifactDir, '_tmp-raid-pools.png');
  await page.locator('[data-raid-context]').first().screenshot({ path: tmpRaid });
  saveBoth('02-pools-link-in-raid-context.png', tmpRaid);

  const tmpFooter = join(artifactDir, '_tmp-footer-map-pools.png');
  await page.locator('footer').first().screenshot({ path: tmpFooter });
  saveBoth('03-footer-map-pools.png', tmpFooter);

  await page.close();
}

await browser.close();
console.log('done');
