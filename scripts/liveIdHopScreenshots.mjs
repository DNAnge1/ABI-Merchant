/**
 * Screenshots for live ID sticky + WIP Entry-only + ChromeBar/error UX.
 * Usage: node scripts/liveIdHopScreenshots.mjs [outDir] [baseUrl]
 */
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir =
  process.argv[2] ||
  '/cursor/stores/bc-5c080d60-6249-418b-b13a-8bf42c7f6cd6/media/live-id-hop-fix';
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
  const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
  await page.goto(`${baseUrl}?liveStickyDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tactical-result], [data-catch-hud="v2"]', {
    timeout: 15000,
  });
  await page.waitForTimeout(2200);
  const primary = await page.evaluate(() => {
    const el = document.querySelector('[data-live-primary-sound]');
    return el ? Number(el.getAttribute('data-live-primary-sound')) : null;
  });
  console.log('live sticky primary soundId:', primary);
  if (primary != null && primary !== 1) {
    console.error('FAIL: expected sticky Group #1, got', primary);
    process.exitCode = 1;
  }
  // Centered WIP chip in ChromeBar; no Start button
  const wipChip = await page.locator('header [data-wip-header]').count();
  const bodyWip = await page.locator('[data-catch-hud] [data-wip-header]').count();
  const chromeStart = await page.locator('header button', { hasText: /^Start$/ }).count();
  const wipCenter = await page.evaluate(() => {
    const chip = document.querySelector('header [data-wip-header]');
    const header = document.querySelector('header');
    if (!chip || !header) return null;
    const cr = chip.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    return Math.round(cr.left + cr.width / 2 - (hr.left + hr.width / 2));
  });
  console.log(
    'listen chrome wip chips:',
    wipChip,
    'body wip:',
    bodyWip,
    'chrome Start:',
    chromeStart,
    'wip center Δx:',
    wipCenter,
  );
  if (wipChip !== 1) {
    console.error('FAIL: expected centered WIP chip in ChromeBar on Listen');
    process.exitCode = 1;
  }
  if (bodyWip !== 0) {
    console.error('FAIL: WIP chip must not sit in Listen body');
    process.exitCode = 1;
  }
  if (chromeStart !== 0) {
    console.error('FAIL: ChromeBar Start button should be removed');
    process.exitCode = 1;
  }
  if (wipCenter != null && Math.abs(wipCenter) > 40) {
    console.error('FAIL: WIP chip not centered in ChromeBar, Δx=', wipCenter);
    process.exitCode = 1;
  }
  const tmp = join(artifactDir, '_tmp-live-sticky.png');
  await page.screenshot({ path: tmp, fullPage: true });
  saveBoth('01-live-sticky-holds-group-1.png', tmp);
  const tmpChrome = join(artifactDir, '_tmp-chrome-listen.png');
  await page.locator('header').first().screenshot({ path: tmpChrome });
  saveBoth('04-chromebar-listen-wip-centered-no-start.png', tmpChrome);
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-wip-banner]', { timeout: 8000 });
  const tmp = join(artifactDir, '_tmp-entry-wip.png');
  await page.screenshot({ path: tmp, fullPage: false });
  saveBoth('05-entry-wip-full-banner.png', tmp);
  await page.locator('[data-wip-banner]').click();
  await page.waitForSelector('[data-wip-modal]', { timeout: 8000 });
  await page.waitForTimeout(300);
  const gap = await page.evaluate(() => {
    const issues = [...document.querySelectorAll('[data-wip-modal] a')].find((a) =>
      /Issues/i.test(a.textContent || ''),
    );
    const suggest = [...document.querySelectorAll('[data-wip-modal] button')].find((b) =>
      /Suggestions/i.test(b.textContent || ''),
    );
    if (!issues || !suggest) return null;
    const ir = issues.getBoundingClientRect();
    const sr = suggest.getBoundingClientRect();
    return Math.round(sr.top - ir.bottom);
  });
  console.log('Issues→Suggestions gap px:', gap);
  if (gap != null && gap < 24) {
    console.error('FAIL: Issues/Suggestions spacing still tight:', gap);
    process.exitCode = 1;
  }
  const tmpModal = join(artifactDir, '_tmp-wip-modal.png');
  await page.locator('[data-wip-modal]').screenshot({ path: tmpModal });
  saveBoth('02-wip-modal-issues-suggestions-spacing.png', tmpModal);
  const tmpFull = join(artifactDir, '_tmp-wip-full.png');
  await page.screenshot({ path: tmpFull, fullPage: false });
  saveBoth('03-wip-modal-full-viewport.png', tmpFull);
  await page.close();
}

{
  // Verify/share error → centered modal (not sticky strip); close → yellow chip
  const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
  await page.goto(`${baseUrl}?catchDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    // Drive the same UI path App uses for capture/share failure.
    window.dispatchEvent(new CustomEvent('abi-demo-verify-error'));
  });
  // Inject via React is hard; set location with hash demo instead — click path:
  // Use page to open verify by forcing DOM... Fall back: evaluate internal if demo hook exists.
  const hasHook = await page.evaluate(() => typeof window.__ABI_DEMO_VERIFY_ERROR__ === 'function');
  if (hasHook) {
    await page.evaluate(() => window.__ABI_DEMO_VERIFY_ERROR__());
  } else {
    // Navigate with query the app understands
    await page.goto(`${baseUrl}?catchDemo=1&verifyErrorDemo=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
  }
  const modal = page.locator('[data-verify-modal]');
  const modalVisible = await modal.isVisible().catch(() => false);
  console.log('verify modal visible:', modalVisible);
  if (!modalVisible) {
    console.error('FAIL: expected centered verify/error modal');
    process.exitCode = 1;
  } else {
    // Must be centered, not a top sticky strip
    const box = await modal.locator('.relative').first().boundingBox();
    const vp = page.viewportSize();
    if (box && vp) {
      const mid = box.y + box.height / 2;
      const centered = Math.abs(mid - vp.height / 2) < vp.height * 0.25;
      console.log('modal vertical center delta:', Math.round(mid - vp.height / 2));
      if (!centered) {
        console.error('FAIL: verify panel not centered');
        process.exitCode = 1;
      }
    }
    const tmp = join(artifactDir, '_tmp-verify-modal.png');
    await page.screenshot({ path: tmp, fullPage: false });
    saveBoth('06-verify-error-centered-modal.png', tmp);
    await page.locator('[data-verify-modal] button', { hasText: /^Close$/ }).first().click();
    await page.waitForTimeout(400);
    const chip = page.locator('[data-session-error-chip]');
    const chipVisible = await chip.isVisible().catch(() => false);
    console.log('error chip after close:', chipVisible);
    if (!chipVisible) {
      console.error('FAIL: yellow reopen chip missing after closing verify modal');
      process.exitCode = 1;
    }
    const tmpChip = join(artifactDir, '_tmp-error-chip.png');
    await page.screenshot({ path: tmpChip, fullPage: false });
    saveBoth('07-error-chip-after-close.png', tmpChip);
  }
  await page.close();
}

await browser.close();
console.log('done');
