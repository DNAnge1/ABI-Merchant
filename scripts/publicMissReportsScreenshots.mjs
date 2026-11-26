/**
 * Screenshots for public miss reports / confusion stats (Phase 2).
 * Usage: node scripts/publicMissReportsScreenshots.mjs [outDir] [baseUrl]
 */
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir =
  process.argv[2] ||
  '/cursor/stores/bc-5c080d60-6249-418b-b13a-8bf42c7f6cd6/media/public-miss-reports';
const artifactDir = '/opt/cursor/artifacts';
const baseUrl = (process.argv[3] || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
mkdirSync(outDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });

const mockStats = {
  totals: { total: 42, misses: 28, hits: 14 },
  topMisidentified: [
    { expectedId: 2, predictedId: 8, hits: 9, label: '#2 → #8' },
    { expectedId: 8, predictedId: 20, hits: 7, label: '#8 → #20' },
    { expectedId: 8, predictedId: 7, hits: 4, label: '#8 → #7' },
    { expectedId: 20, predictedId: 8, hits: 3, label: '#20 → #8' },
    { expectedId: 14, predictedId: 8, hits: 2, label: '#14 → #8' },
  ],
  topPredictedAsWrong: [
    { soundId: 8, hits: 14 },
    { soundId: 20, hits: 7 },
    { soundId: 7, hits: 4 },
  ],
  daily: [
    { day: '2026-11-20', total: 3, misses: 2 },
    { day: '2026-11-21', total: 5, misses: 3 },
    { day: '2026-11-22', total: 4, misses: 2 },
    { day: '2026-11-23', total: 7, misses: 5 },
    { day: '2026-11-24', total: 6, misses: 4 },
    { day: '2026-11-25', total: 8, misses: 6 },
    { day: '2026-11-26', total: 9, misses: 6 },
  ],
  windowDays: 30,
};

const browser = await chromium.launch({ headless: true });

function saveBoth(name, fromPath) {
  const dest = join(outDir, name);
  copyFileSync(fromPath, dest);
  copyFileSync(fromPath, join(artifactDir, name));
  console.log('wrote', dest);
}

async function mockReportsApi(page) {
  await page.route('**/reports/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockStats),
    });
  });
  await page.route('**/reports', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [], count: 0 }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'demo', ok: true }),
    });
  });
}

{
  const page = await browser.newPage({ viewport: { width: 980, height: 1200 } });
  await mockReportsApi(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('footer', { timeout: 15000 });

  const statsBtn = page.getByRole('button', { name: /^Stats$/i });
  if (await statsBtn.count()) {
    await statsBtn.first().click();
  } else {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, a')];
      btns.find((el) => /^stats$/i.test((el.textContent || '').trim()))?.click();
    });
  }
  await page.waitForSelector('[data-stats-page]', { timeout: 10000 });
  await page.waitForSelector('[data-confusion-stats="ready"]', { timeout: 10000 });
  await page.waitForSelector('[data-top-misidentified]', { timeout: 5000 });
  await page.waitForTimeout(500);
  const statsShot = join(outDir, 'stats-confusion-graphs.png');
  await page.locator('[data-stats-page]').screenshot({ path: statsShot });
  saveBoth('stats-confusion-graphs.png', statsShot);
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 980, height: 1100 } });
  await mockReportsApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('abi-merchant.calibrationDebug', '1');
    localStorage.setItem('abi-merchant.calibrationAutoSave', '1');
  });
  // catchDemo lands on Listen HUD with a lock; debug=1 forces calibration pref on.
  await page.goto(`${baseUrl}?debug=1&catchDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  let panel = page.locator('[data-calibration-debug="open"]');
  if (!(await panel.count())) {
    const collapsed = page.locator('[data-calibration-debug="collapsed"]');
    if (await collapsed.count()) {
      await page.getByRole('button', { name: /Open panel/i }).first().click();
      await page.waitForTimeout(400);
    } else {
      const link = page.getByRole('button', { name: /Calibration \/ Confusion/i });
      if (await link.count()) {
        await link.first().click();
        await page.waitForTimeout(500);
        const openBtn = page.getByRole('button', { name: /Open panel/i });
        if (await openBtn.count()) await openBtn.first().click();
      }
    }
    panel = page.locator('[data-calibration-debug="open"]');
  }

  if (await panel.count()) {
    const auto = panel.locator('label').filter({ hasText: /Auto-save to Worker/i }).locator('input');
    if (await auto.count() && !(await auto.first().isChecked())) {
      await auto.first().check();
    }
    const calShot = join(outDir, 'calibration-autosave.png');
    await panel.first().screenshot({ path: calShot });
    saveBoth('calibration-autosave.png', calShot);
  } else {
    console.warn('calibration panel not found — scrolling full listen page');
    const calShot = join(outDir, 'calibration-autosave.png');
    await page.screenshot({ path: calShot, fullPage: true });
    saveBoth('calibration-autosave.png', calShot);
  }
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 560, height: 720 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const faqBtn = page.getByRole('button', { name: /Trust & safety FAQ/i });
  await faqBtn.first().click();
  await page.waitForSelector('[data-faq-modal]', { timeout: 8000 });
  const audioQ = page.getByRole('button', { name: /Where does game audio go/i });
  await audioQ.first().click();
  await page.waitForTimeout(350);
  const faqShot = join(outDir, 'privacy-faq-no-audio.png');
  await page.locator('[data-faq-modal]').screenshot({ path: faqShot });
  saveBoth('privacy-faq-no-audio.png', faqShot);
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
  await mockReportsApi(page);
  await page.goto(`${baseUrl}?missDemo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=What was it actually?', { timeout: 12000 });
  await page.waitForTimeout(400);
  const missShot = join(outDir, 'miss-feedback-modal.png');
  const modal = page.locator('text=What was it actually?').locator('xpath=ancestor::div[contains(@class,\"max-w\")]').first();
  if (await modal.count()) {
    await modal.screenshot({ path: missShot });
  } else {
    await page.screenshot({ path: missShot });
  }
  saveBoth('miss-feedback-modal.png', missShot);
  await page.close();
}

await browser.close();
console.log('done');
