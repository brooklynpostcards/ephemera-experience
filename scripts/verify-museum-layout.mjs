// Reuses an existing Playwright package and running museum server; no new dependency.
// node scripts/verify-museum-layout.mjs <playwright-package-path> [base-url] [output-directory]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const origin = process.argv[3] || 'http://127.0.0.1:3000';
const output = resolve(process.argv[4] || 'outputs/museum-layout');
const checks = [];
const errors = [];
const layouts = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.FOLD_CHROMIUM_PATH ? { executablePath: process.env.FOLD_CHROMIUM_PATH } : {}) });
try {
  for (const [width, height] of [[360, 640], [1440, 900], [768, 1024], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    const size = `${width}x${height}`;
    await page.goto(origin);
    await page.waitForFunction(() => Object.keys(document.querySelector('.stage') || {})
      .some((key) => key.startsWith('__reactProps$')));
    await page.evaluate(() => {
      window.__layoutPeak = { rooms: 3, images: 3 };
      // Observe immediately after native DOM writes, including within a React commit.
      for (const [prototype, methods] of [
        [Node.prototype, ['appendChild', 'insertBefore', 'removeChild', 'replaceChild']],
        [Element.prototype, ['append', 'prepend', 'replaceChildren', 'before', 'after',
          'replaceWith', 'remove', 'insertAdjacentElement', 'insertAdjacentHTML']],
      ]) for (const method of methods) {
        const native = prototype[method];
        prototype[method] = function (...args) {
          const result = Reflect.apply(native, this, args);
          const peak = window.__layoutPeak;
          peak.rooms = Math.max(peak.rooms, document.querySelectorAll('.museum-room').length);
          peak.images = Math.max(peak.images, document.querySelectorAll('img').length);
          return result;
        };
      }
    });
    async function scene(name) {
      await page.locator('.room-current img').evaluate((img) => img.decode());
      await page.locator('.room-current .artwork-frame').scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) =>
        animation.finished.catch(() => {}))));
      const layout = await page.evaluate(() => {
        const room = document.querySelector('.room-current');
        const wall = room.querySelector('.paper-back').getBoundingClientRect();
        const frame = room.querySelector('.artwork-frame');
        const label = room.querySelector('.accession-slip');
        const image = room.querySelector('img');
        const box = frame.getBoundingClientRect();
        const slip = label.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const inside = (r, parent) => r.left >= parent.left - 1 && r.right <= parent.right + 1
          && r.top >= parent.top - 1 && r.bottom <= parent.bottom + 1;
        return { title: label.textContent.trim(), frameWidth: box.width,
          inWall: inside(box, wall) && inside(slip, wall),
          inViewport: inside(box, { left: 0, top: 0, right: innerWidth, bottom: innerHeight }),
          hit: frame === hit || frame.contains(hit),
          image: image.naturalWidth > 0 && getComputedStyle(image).objectFit === 'contain',
          overflow: document.documentElement.scrollWidth > innerWidth,
          counts: [document.querySelectorAll('.museum-room').length, document.querySelectorAll('img').length],
          clean: !document.querySelector('.stage').hasAttribute('data-fold-drag')
            && new DOMMatrixReadOnly(getComputedStyle(room).transform).isIdentity,
        };
      });
      layouts.push({ size, name, ...layout });
      await page.screenshot({ path: resolve(output, `${size}-${name}.png`), fullPage: true });
      check(`${size} ${name}: frame and title fit their paper wall`, layout.inWall);
      check(`${size} ${name}: decoded contained image is reachable`, layout.inViewport && layout.hit && layout.image);
      check(`${size} ${name}: no horizontal page overflow`, !layout.overflow);
      check(`${size} ${name}: clean landing and three rooms/images`, layout.clean && layout.counts.every((n) => n === 3));
      for (const button of await page.locator('.movement button').all()) {
        await button.scrollIntoViewIfNeeded();
        const usable = await button.evaluate((el) => {
          const r = el.getBoundingClientRect(), label = el.querySelector('span').getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth
            && r.top >= 0 && r.bottom <= innerHeight + 1 && (hit === el || el.contains(hit))
            && label.left >= r.left && label.right <= r.right && !el.disabled;
        });
        check(`${size} ${name}: ${await button.getAttribute('aria-label')} fits and is reachable`, usable);
      }
    }
    async function step(name, depth) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForFunction((expected) => document.querySelector('.museum').dataset.depth === String(expected)
        && document.querySelector('.stage').classList.contains('action-idle'), depth);
    }
    await scene('initial');
    // Real backward steps reach the longest title without injecting application state.
    await step('Previous room', -1);
    await step('Previous room', -2);
    await scene('long-title');
    await page.getByRole('button', { name: 'Inspect object', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.locator('.inspection-image img').evaluate((img) => img.decode());
    const dialog = await page.locator('.inspection').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const close = el.querySelector('.inspection-close');
      const r = close.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const parts = ['.inspection-bar', '.inspection-image', '.inspection-caption'].map((s) =>
        el.querySelector(s).getBoundingClientRect());
      return { fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
          && parts.every((p) => p.left >= box.left && p.right <= box.right && p.top >= box.top && p.bottom <= box.bottom)
          && parts[0].bottom <= parts[1].top && parts[1].bottom <= parts[2].top,
        close: r.height >= 44 && r.width >= 44 && (hit === close || close.contains(hit))
          && parseFloat(getComputedStyle(close).fontSize) >= 14,
        image: getComputedStyle(el.querySelector('img')).objectFit === 'contain',
        images: document.querySelectorAll('img').length };
    });
    await page.screenshot({ path: resolve(output, `${size}-inspection.png`) });
    check(`${size}: dialog contents fit without overlap`, dialog.fits && dialog.image);
    check(`${size}: inspection close is readable and at least 44px`, dialog.close);
    check(`${size}: inspection substitutes image`, dialog.images === 3);
    await page.getByRole('button', { name: 'Back to room' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    check(`${size}: inspection restores artwork focus`, await page.locator('.room-current .artwork-frame')
      .evaluate((el) => el === document.activeElement));
    await step('Next room', -1);
    await step('Next room', 0);
    await scene('returned');
    const peak = await page.evaluate(() => window.__layoutPeak);
    check(`${size}: synchronous mount peaks stay at three`, peak.rooms === 3 && peak.images === 3);
    await page.close();
  }
  check('no browser runtime errors', errors.length === 0);
} catch (error) {
  errors.push(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  const result = { passed: checks.length, checks, layouts, errors };
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
