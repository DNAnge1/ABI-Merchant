/**
 * Capture Catch HUD screenshots via Playwright.
 * Usage: node scripts/catchHudScreenshots.mjs [outDir] [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir =
  process.argv[2] ||
  '/cursor/stores/bc-5c080d60-6249-418b-b13a-8bf42c7f6cd6/media/catch-hud';
const baseUrl = (process.argv[3] || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function shot(path, url, opts = {}) {
  const page = await browser.newPage({
    viewport: opts.viewport || { width: 980, height: 1200 },
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (opts.waitFor) {
    await page.waitForSelector(opts.waitFor, { timeout: 15000 });
  }
  await page.waitForTimeout(opts.delayMs ?? 600);
  if (opts.clickAccuracy) {
    const acc = page.locator('summary', { hasText: /Accuracy/i }).first();
    if (await acc.isVisible().catch(() => false)) await acc.click();
  }
  if (opts.openAdvanced) {
    const adv = page.locator('summary', { hasText: /Advanced/i }).first();
    if (await adv.isVisible().catch(() => false)) await adv.click();
  }
  await page.screenshot({
    path: join(outDir, path),
    fullPage: opts.fullPage !== false,
  });
  await page.close();
  console.log('wrote', path);
}

// Real Catch idle (wizard → listen)
{
  const page = await browser.newPage({ viewport: { width: 980, height: 1200 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Catch/i }).first().click();
  await page.waitForTimeout(400);
  const single = page.getByRole('button', { name: /Single/i }).first();
  if (await single.isVisible().catch(() => false)) {
    await single.click();
    await page.waitForTimeout(300);
  }
  const suggested = page.getByRole('button', { name: /Use Suggested/i });
  if (await suggested.isVisible().catch(() => false)) {
    await suggested.click();
  } else {
    const next = page.getByRole('button', { name: /^Next$/i });
    if (await next.isVisible().catch(() => false)) await next.click();
  }
  await page.waitForSelector('[data-catch-hud="v2"]', { timeout: 12000 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(outDir, 'catch-idle-layout.png'),
    fullPage: true,
  });
  await page.close();
  console.log('wrote catch-idle-layout.png');
}

// Demo lock — result card hierarchy + pills + Advanced collapsed
await shot('result-card-hierarchy.png', `${baseUrl}?catchDemo=1`, {
  waitFor: '[data-tactical-result="catch-hud"]',
  delayMs: 800,
});

// Same demo — open Accuracy bar for scroll stack feel
await shot('listen-scroll-stack.png', `${baseUrl}?catchDemo=1`, {
  waitFor: '[data-catch-hud="v2"]',
  delayMs: 700,
  clickAccuracy: true,
  viewport: { width: 980, height: 900 },
  fullPage: true,
});

// Setup-error look: idle Catch + inject the real error banner markup classes
{
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Catch/i }).first().click();
  await page.waitForTimeout(350);
  const single = page.getByRole('button', { name: /Single/i }).first();
  if (await single.isVisible().catch(() => false)) await single.click();
  const suggested = page.getByRole('button', { name: /Use Suggested/i });
  if (await suggested.isVisible().catch(() => false)) await suggested.click();
  else {
    const next = page.getByRole('button', { name: /^Next$/i });
    if (await next.isVisible().catch(() => false)) await next.click();
  }
  await page.waitForSelector('[data-catch-hud="v2"]', { timeout: 12000 });
  await page.evaluate(() => {
    const host = document.querySelector('[data-catch-hud="v2"]');
    if (!host) return;
    const existing = host.querySelector('[data-catch-error]');
    if (existing) return;
    const slot = document.createElement('div');
    slot.setAttribute('data-catch-error', 'setup');
    slot.setAttribute('role', 'alert');
    slot.className =
      'rounded-lg border border-[var(--warn)]/50 bg-[#2a2208] px-3 py-2.5 space-y-2';
    slot.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--mythic-gold)]">Audio setup error</p>
          <p class="m-0 mt-1 text-[12px] text-[var(--text)] leading-relaxed">Share canceled or denied — Retest and enable Share audio.</p>
          <details class="mt-1.5"><summary class="cursor-pointer text-[10px] text-[var(--muted)]">Details ▾</summary></details>
        </div>
        <button type="button" class="rounded-lg px-3 py-1.5 text-[12px] font-semibold bg-[var(--accent)] text-[#041412] shrink-0">Retest</button>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span class="text-[var(--ok)] underline underline-offset-2">Fix →</span>
        <span class="text-[var(--muted)] underline underline-offset-2">Clear</span>
        <span class="text-[var(--muted)] underline underline-offset-2">Start over</span>
      </div>`;
    const circle = host.querySelector('[data-catch-state]')?.closest('.rounded-\\[14px\\]');
    const panel = host.querySelector('[data-catch-state]')?.parentElement?.parentElement;
    (panel || circle || host.lastElementChild).after(slot);
  });
  await page.waitForTimeout(400);
  const err = page.locator('[data-catch-error="setup"]');
  await err.screenshot({ path: join(outDir, 'setup-error.png') });
  await page.close();
  console.log('wrote setup-error.png');
}

await browser.close();
console.log(JSON.stringify({ outDir }, null, 2));
