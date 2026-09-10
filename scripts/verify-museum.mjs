// Uses an existing Playwright installation; does not add a website dependency.
// node scripts/verify-museum.mjs <playwright-package-path> [base-url]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const origin = process.argv[3] || 'http://localhost:3000';
const output = resolve('outputs');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const checks = [];
page.on('pageerror', (error) => errors.push(error.message));
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const idle = () => page.waitForSelector('.action-idle');
const state = () => page.locator('.museum').evaluate((el) => ({
  depth: Number(el.dataset.depth), facing: Number(el.dataset.facing),
  src: el.querySelector('.room-current img')?.getAttribute('src'),
}));
async function act(name) { await page.getByRole('button', { name, exact: true }).click(); await idle(); }
try {
  await page.goto(origin);
  await page.locator('.room-current img').evaluate((img) => img.decode());
  await page.evaluate(() => {
    window.__museumPeak = document.querySelectorAll('img').length;
    new MutationObserver(() => {
      window.__museumPeak = Math.max(window.__museumPeak, document.querySelectorAll('img').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  check('correct page title', (await page.title()).includes('Ephemera'));
  check('initial three rooms', await page.locator('.museum-room').count() === 3);
  check('initial three images', await page.locator('img').count() === 3);
  const initial = await state();
  await page.screenshot({ path: resolve(output, 'museum-desktop.png') });
  await act('Next room'); await act('Next room');
  check('forward advances two rooms', (await state()).depth === 2);
  await act('Previous room'); await act('Previous room');
  assert.deepEqual(await state(), initial); checks.push('backtracking restores exact initial state');
  await act('Turn right'); check('right rotates facing', (await state()).facing === 1);
  await act('Turn left'); assert.deepEqual(await state(), initial); checks.push('turns reverse');
  await page.getByRole('button', { name: 'Inspect object', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  check('inspection stays within three images', await page.locator('img').count() === 3);
  check('inspection image fully contained', await page.locator('.inspection-image img').evaluate((el) => getComputedStyle(el).objectFit === 'contain'));
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
  check('focus restored to object', await page.locator('.room-current .artwork-frame').evaluate((el) => el === document.activeElement));
  await page.keyboard.press('ArrowUp'); await idle();
  check('keyboard moves once', (await state()).depth === 1);
  await page.keyboard.press('ArrowDown'); await idle();
  await page.locator('.stage').hover();
  await page.mouse.wheel(0, -120); await idle();
  check('wheel moves forward', (await state()).depth === 1);
  await page.locator('.stage').evaluate(async (el) => {
    for (let i = 0; i < 20; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 35));
    }
  });
  await idle();
  check('wheel momentum only adds one room', (await state()).depth <= 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let i = 0; i < 30; i++) await act('Next room');
  check('three rooms after thirty moves', await page.locator('.museum-room').count() === 3);
  check('three images after thirty moves', await page.locator('img').count() === 3);
  check('never mounted a fourth image', await page.evaluate(() => window.__museumPeak <= 3));
  check('neighbors inert', await page.locator('.museum-room:not(.room-current)').evaluateAll((els) => els.every((el) => el.inert && el.getAttribute('aria-hidden') === 'true')));
  await page.getByRole('button', { name: 'Next room', exact: true }).click();
  check('reduced motion has no room transition', await page.locator('.room-current').evaluate((el) => getComputedStyle(el).transitionDuration === '0s'));
  await idle();
  for (const [width, height] of [[360, 640], [768, 1024], [1440, 900], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const image = document.querySelector('.room-current img');
      const rect = image.getBoundingClientRect();
      return { horizontal: document.documentElement.scrollWidth > innerWidth,
        imageVisible: rect.width > 40 && rect.height > 40 && rect.left >= 0 && rect.right <= innerWidth,
        fit: getComputedStyle(image).objectFit,
        buttons: [...document.querySelectorAll('.movement button')].every((el) => { const r=el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth; }) };
    });
    check(`layout ${width}x${height}`, !layout.horizontal && layout.imageVisible && layout.fit === 'contain' && layout.buttons);
    if (width === 360) await page.screenshot({ path: resolve(output, 'museum-mobile.png'), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  check('dark theme applied', await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme === 'dark'));
  await page.locator('.room-current img').evaluate((img) => { img.src = '/exhibits/missing-test-image.jpg'; });
  await page.getByText('Image unavailable', { exact: true }).waitFor();
  checks.push('broken image has visible fallback');
  await act('Next room');
  await page.locator('.room-current img').waitFor();
  checks.push('movement recovers after image failure');
  check('no browser runtime errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'museum-failure.png'), fullPage: true });
  console.error(JSON.stringify({ completed: checks, errors, failure: error.message }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
