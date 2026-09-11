// Uses an existing Playwright installation; no website test dependency or artifacts.
// node scripts/verify-fold-drag.mjs <playwright-package-path> [base-url] [--serve]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const origin = process.argv[3] || 'http://127.0.0.1:3000';
const checks = [];
const errors = [];
let server;
let browser;
let serverLog = '';
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
try {
  if (process.argv.includes('--serve')) {
    server = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev', '--hostname', '127.0.0.1', '--port', new URL(origin).port || '3000'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (chunk) => { serverLog = (serverLog + chunk).slice(-6000); });
    server.stderr.on('data', (chunk) => { serverLog = (serverLog + chunk).slice(-6000); });
    const deadline = Date.now() + 55000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      if (server.exitCode !== null) throw new Error('Dev server exited: ' + serverLog);
      try { ready = (await fetch(origin, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Dev server ready within 55 seconds: ' + serverLog);
  }
  browser = await chromium.launch({ headless: true, ...(process.env.FOLD_CHROMIUM_PATH ? { executablePath: process.env.FOLD_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.room-current img').waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('.stage');
    return element && Object.keys(element).some((key) => key.startsWith('__reactProps$'));
  });
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      window.__foldPointerId = event.pointerId;
      window.__foldPointerTime = event.timeStamp;
    }, true);
    window.__foldPeakImages = document.querySelectorAll('img').length;
    window.__foldPeakRooms = document.querySelectorAll('.museum-room').length;
    new MutationObserver(() => {
      window.__foldPeakImages = Math.max(window.__foldPeakImages, document.querySelectorAll('img').length);
      window.__foldPeakRooms = Math.max(window.__foldPeakRooms, document.querySelectorAll('.museum-room').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  const snap = () => page.locator('.museum').evaluate((el) => ({
    depth: Number(el.dataset.depth), facing: Number(el.dataset.facing),
    dragging: el.querySelector('.stage').classList.contains('action-dragging'),
    transform: el.querySelector('.room-current').style.transform,
    rooms: el.querySelectorAll('.museum-room').length,
    images: document.querySelectorAll('img').length,
  }));
  const pause = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const stageBox = await page.locator('.stage').boundingBox();
  const x = stageBox.x + stageBox.width * 0.5;
  const y = stageBox.y + stageBox.height * 0.5;
  async function begin() { await page.mouse.move(x, y); await page.mouse.down(); }
  async function cancel(type = 'pointercancel') {
    await page.locator('.stage').evaluate((el, eventType) => {
      el.dispatchEvent(new PointerEvent(eventType, { pointerId: window.__foldPointerId, bubbles: true }));
    }, type);
    await page.mouse.up(); await pause();
  }
  await page.locator('.room-current .artwork-frame').click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  checks.push('ordinary artwork click opens inspection');
  const initial = await snap();
  await begin();
  await page.mouse.move(x, y - 5); await pause();
  check('under 8px slop remains idle', !(await snap()).dragging && (await snap()).transform === '');
  await page.mouse.move(x + 12, y - 12); await pause();
  check('ambiguous diagonal remains unresolved', !(await snap()).dragging);
  await page.mouse.move(x + 12, y - 28); await pause();
  const walk = await snap();
  check('dominant vertical motion locks and transforms', walk.dragging && walk.transform !== '');
  check('drag preserves settled depth and three-room/image window', walk.depth === initial.depth && walk.rooms === 3 && walk.images === 3);
  await page.keyboard.press('ArrowUp'); await page.mouse.wheel(0, -120);
  check('keyboard and wheel cannot navigate during drag', (await snap()).depth === initial.depth);
  check('navigation controls gated while dragging', await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => button.disabled)));
  await page.mouse.move(x + 120, y - 60); await pause();
  check('locked vertical intent survives later horizontal dominance', (await snap()).dragging && (await snap()).facing === initial.facing);
  await page.mouse.move(x + 120, y + 60); await pause();
  check('reversal updates live transform', (await snap()).transform !== walk.transform);
  await cancel();
  check('cancellation starts a visible return without committing', (await snap()).dragging && (await snap()).transform !== '' && (await snap()).depth === initial.depth);
  await page.locator('.stage.action-idle').waitFor({ timeout: 3000 });
  check('cancellation settles at origin and restores controls', (await snap()).transform === '' && (await snap()).depth === initial.depth
    && await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => !button.disabled)));
  await begin(); await page.mouse.move(x, y - 70); await pause(); await cancel('lostpointercapture');
  check('capture loss starts the same bounded return', (await snap()).dragging && (await snap()).depth === initial.depth);
  await page.locator('.stage.action-idle').waitFor({ timeout: 3000 });
  check('capture-loss return cannot strand the fold', (await snap()).transform === ''
    && await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => !button.disabled)));
  await begin(); await page.mouse.move(x + 50, y - 10); await pause();
  check('horizontal lock does not start live walking', !(await snap()).dragging && (await snap()).transform === '');
  await page.mouse.move(x + 50, y - 130); await pause(); await page.mouse.up();
  await page.waitForTimeout(550);
  check('horizontal intent stays a single discrete turn', (await snap()).depth === initial.depth && (await snap()).facing !== initial.facing);
  const beforeRelease = await snap();
  await page.evaluate(() => {
    window.__foldDepthChanges = [];
    new MutationObserver((records) => {
      for (const record of records) window.__foldDepthChanges.push(Number(record.target.dataset.depth));
    }).observe(document.querySelector('.museum'), { attributes: true, attributeFilter: ['data-depth'] });
  });
  const roomSpan = Math.max(180, Math.min(420, stageBox.height * 0.65));
  await begin(); await page.mouse.move(x, y - roomSpan * 0.7);
  await page.waitForTimeout(150); await page.mouse.up(); await pause();
  const released = await snap();
  check('release retains live pose and origin while settling', released.dragging
    && released.transform !== '' && released.depth === beforeRelease.depth);
  await page.keyboard.press('ArrowUp');
  check('release keeps navigation gated', await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => button.disabled)));
  await page.locator('.stage.action-idle').waitFor({ timeout: 3000 });
  const landed = await snap();
  check('one-room release commits exactly once from captured origin', landed.depth === beforeRelease.depth + 1
    && landed.facing === beforeRelease.facing
    && JSON.stringify(await page.evaluate(() => window.__foldDepthChanges)) === JSON.stringify([landed.depth]));
  check('landing clears reused room transforms and keeps three views', landed.transform === ''
    && landed.rooms === 3 && landed.images === 3
    && await page.locator('.room-current').evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      return transform === 'none' || new DOMMatrixReadOnly(transform).isIdentity;
    }));
  check('drag release suppresses accidental inspection', await page.getByRole('dialog').count() === 0);
  await page.evaluate(() => { window.__foldDepthChanges = []; });
  await begin(); await page.mouse.move(x, y - 24); await page.waitForTimeout(150);
  await page.mouse.up(); await pause();
  check('short locked release still settles instead of snapping', (await snap()).dragging && (await snap()).transform !== '');
  await page.locator('.stage.action-idle').waitFor({ timeout: 3000 });
  check('zero-target completion never commits world position', (await snap()).depth === landed.depth
    && (await snap()).transform === '' && await page.evaluate(() => window.__foldDepthChanges.length === 0));
  // Controlled event timestamps isolate release velocity from automation/host latency.
  // Real pointerdown establishes capture; synthetic move/up use that same pointer.
  // The full controller still runs on real RAF; no production hooks or fake physics.
  async function verifyRelease(name, offset, held, delta) {
    const before = await snap();
    const identity = (element) => [element.dataset.room, element.dataset.fold,
      element.style.getPropertyValue('--room-accent'), element.querySelector('h2').textContent,
      element.querySelector('img')?.getAttribute('src')];
    const beforeIdentity = await page.locator('.room-current').evaluate(identity);
    // Before motion, only adjacent destinations have a preview in the idle window.
    const expectedRoom = Math.abs(delta) <= 1
      ? await page.locator('.museum-room[data-offset="' + delta + '"]').evaluate(identity)
      : null;
    await page.evaluate(() => { window.__foldDepthChanges = []; });
    await begin();
    await page.locator('.stage').evaluate((element, gesture) => {
      const pointerId = window.__foldPointerId;
      const startTime = window.__foldPointerTime;
      const settledDepth = Number(document.querySelector('.museum').dataset.depth);
      const announcement = document.querySelector('[role="status"]').textContent;
      let previousNodes = new Map([...element.querySelectorAll('.museum-room')].map((room) =>
        [Number(room.dataset.depth), { room, image: room.querySelector('img') }]));
      window.__foldWindows = [];
      const windowObserver = new MutationObserver(() => {
        if (!element.hasAttribute('data-fold-drag')) return;
        const rooms = [...element.querySelectorAll('.museum-room')];
        const center = rooms.find((room) => room.dataset.offset === '0');
        const anchor = Number(center?.dataset.depth) - settledDepth;
        const rows = rooms.map((room) => {
          const depth = Number(room.dataset.depth);
          const translation = room.style.transform.match(/translateX\(([-.\de+]+)%\)/i);
          const relative = translation ? Number(translation[1]) / 135 : NaN;
          const previous = previousNodes.get(depth);
          return { depth, offset: Number(room.dataset.offset), relative,
            progress: depth - settledDepth - relative,
            stable: !previous || (previous.room === room && previous.image === room.querySelector('img')),
            opacity: Number(room.style.opacity),
            transition: getComputedStyle(room).transitionDuration };
        });
        window.__foldWindows.push({ anchor, rows,
          images: document.querySelectorAll('img').length,
          focused: document.activeElement === element,
          announced: document.querySelector('[role="status"]').textContent === announcement });
        previousNodes = new Map(rooms.map((room) =>
          [Number(room.dataset.depth), { room, image: room.querySelector('img') }]));
      });
      // Observe committed window/role mutations, after layout effects have painted.
      windowObserver.observe(element, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'data-depth', 'data-offset'] });
      window.__foldWindowObserver = windowObserver;
      const send = (type, fraction, milliseconds) => {
        const event = new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'mouse',
          isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
          clientX: gesture.x, clientY: gesture.y - gesture.roomSpan * gesture.offset * fraction });
        Object.defineProperty(event, 'timeStamp', { value: startTime + milliseconds });
        element.dispatchEvent(event);
      };
      for (let sample = 1; sample <= 4; sample++) send('pointermove', sample / 4, sample * 12.5);
      window.__foldAudit = [];
      const audit = () => {
        const museum = document.querySelector('.museum');
        const rooms = [...museum.querySelectorAll('.museum-room')];
        const busy = element.classList.contains('action-dragging');
        window.__foldAudit.push({ depth: Number(museum.dataset.depth), facing: Number(museum.dataset.facing), busy,
          gated: [...museum.querySelectorAll('.movement button, .room-current button')].every((button) => button.disabled)
            && rooms.every((room) => room.inert),
          rooms: rooms.length, images: document.querySelectorAll('img').length,
          finite: rooms.every((room) => !/NaN|Infinity/.test(room.getAttribute('style') || '')) });
        if (busy || element.hasAttribute('data-fold-drag')) requestAnimationFrame(audit);
      };
      send('pointerup', 1, gesture.held ? 200 : 50);
      requestAnimationFrame(audit);
    }, { x, y, roomSpan, offset, held });
    await page.mouse.up(); await pause();
    const during = await snap();
    check(name + ': retains origin and live pose after release', during.dragging
      && during.depth === before.depth && during.facing === before.facing && during.transform !== '');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    await page.mouse.wheel(0, -120);
    // A second press and a late cancel cannot steal an already detached release.
    await page.locator('.stage').evaluate((element) => {
      const releasedPointerId = window.__foldPointerId;
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true,
        pointerId: releasedPointerId + 100, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: releasedPointerId }));
    });
    await page.locator('.stage.action-idle').waitFor({ timeout: 3000 }); await pause();
    const after = await snap();
    const audit = await page.evaluate(() => window.__foldAudit);
    const windows = await page.evaluate(() => {
      window.__foldWindowObserver.disconnect();
      return window.__foldWindows;
    });
    check(name + ': exact integer destination and one-or-zero commit', Number.isInteger(after.depth)
      && after.depth === before.depth + delta
      && JSON.stringify(await page.evaluate(() => window.__foldDepthChanges)) === JSON.stringify(delta ? [after.depth] : []));
    const afterIdentity = await page.locator('.room-current').evaluate(identity);
    check(name + ': settled facing and available preview identity agree', after.facing === before.facing
      && (expectedRoom === null || JSON.stringify(afterIdentity) === JSON.stringify(expectedRoom)));
    check(name + ': every settling frame is gated at the captured origin', audit.some((frame) => frame.busy)
      && audit.every((frame) => Number.isInteger(frame.depth) && frame.facing === before.facing
        && (frame.busy ? frame.gated && frame.depth === before.depth : frame.depth === after.depth)));
    check(name + ': finite three-view window throughout', audit.every((frame) => frame.finite && frame.rooms === 3 && frame.images <= 3)
      && after.rooms === 3 && after.images === 3);
    check(name + ': integer window follows continuous progress before paint', windows.length > 0
      && windows.every((sample) => Number.isInteger(sample.anchor) && sample.rows.length === 3
        && sample.rows.every((row, index) => row.offset === index - 1
          && row.depth === before.depth + sample.anchor + row.offset
          && Number.isFinite(row.relative)
          && Math.abs(row.progress - sample.rows[0].progress) < 0.00001
          && Math.abs(sample.anchor - row.progress) <= 0.50001
          && row.transition === '0s')));
    check(name + ': swaps retain room/image nodes, focus, and announcement',
      windows.every((sample) => sample.rows.every((row) => row.stable)
        && sample.images <= 3 && sample.focused && sample.announced));
    check(name + ': window never fades entirely out during travel',
      windows.every((sample) => sample.rows.some((row) => row.opacity === 1)));
    if (Math.abs(delta) > 1) {
      check(name + ': renders every intermediate integer anchor',
        Array.from({ length: Math.abs(delta) }, (_, index) => Math.sign(delta) * (index + 1))
          .every((anchor) => windows.some((sample) => sample.anchor === anchor)));
    }
    check(name + ': styles and controls restored without inspection', await page.locator('.stage').evaluate((element) =>
      !element.hasAttribute('data-fold-drag')
      && [...element.querySelectorAll('.museum-room, .paper-left, .paper-right')].every((node) => node.style.transform === '')
      && [...element.querySelectorAll('.museum-room')].every((node) => node.style.opacity === '')
      && element.querySelectorAll('.room-current').length === 1 && !element.querySelector('.room-current').inert
      && new DOMMatrixReadOnly(getComputedStyle(element.querySelector('.room-current')).transform).isIdentity)
      && await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => !button.disabled))
      && await page.getByRole('dialog').count() === 0);
    return { before, after, beforeIdentity, afterIdentity };
  }
  check('expanded releases start at a nonzero integer origin', landed.depth !== 0 && Number.isInteger(landed.depth));
  await verifyRelease('held short forward', 0.2, true, 0);
  await verifyRelease('fast short forward', 0.2, false, 1);
  await verifyRelease('held short backward', -0.2, true, 0);
  await verifyRelease('fast short backward', -0.2, false, -1);
  await verifyRelease('ordinary forward', 0.7, true, 1);
  await verifyRelease('ordinary backward', -0.7, true, -1);
  check('paired releases return exactly to the nonzero origin', (await snap()).depth === landed.depth
    && (await snap()).facing === landed.facing);
  const twoForward = await verifyRelease('high release forward two rooms', 0.65, false, 2);
  const twoBackward = await verifyRelease('high release backward two rooms', -0.65, false, -2);
  check('two-room inverse restores exact origin and descriptor',
    twoBackward.after.depth === twoForward.before.depth
    && JSON.stringify(twoBackward.afterIdentity) === JSON.stringify(twoForward.beforeIdentity));
  const threeForward = await verifyRelease('maximum release forward three rooms', 1, false, 3);
  const threeBackward = await verifyRelease('maximum release backward three rooms', -1, false, -3);
  check('three-room inverse restores exact origin and descriptor',
    threeBackward.after.depth === threeForward.before.depth
    && JSON.stringify(threeBackward.afterIdentity) === JSON.stringify(threeForward.beforeIdentity));
  const beforeInterruptedPending = await snap();
  await begin(); await page.mouse.move(x, y - 5); await pause();
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(650);
  await page.mouse.move(x, y - 80); await pause();
  check('alternate navigation clears pending origin before later pointer movement', !(await snap()).dragging && (await snap()).depth === beforeInterruptedPending.depth + 1);
  await page.mouse.up(); await pause();
  const beforeLongGap = await snap();
  await begin(); await page.mouse.move(x, y - 80); await pause(); await cancel();
  await page.evaluate(() => {
    const deadline = performance.now() + 300;
    while (performance.now() < deadline) { /* Deliberately block one frame. */ }
  });
  await page.locator('.stage.action-idle').waitFor({ timeout: 1000 });
  check('long frame gap aborts cancellation safely at origin', (await snap()).transform === ''
    && (await snap()).depth === beforeLongGap.depth);
  await begin(); await page.mouse.move(x, y - 80); await pause(); await cancel();
  check('return is active before motion preference changes', (await snap()).dragging);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await pause();
  check('enabling reduced motion completes an active return immediately', !(await snap()).dragging
    && (await snap()).transform === '' && (await snap()).depth === beforeLongGap.depth);
  const reducedBefore = await snap();
  await begin(); await page.mouse.move(x, y - 80); await pause();
  check('reduced motion has no live perspective transform', (await snap()).transform === '');
  await cancel();
  check('reduced-motion cancellation cleans up immediately', !(await snap()).dragging && (await snap()).depth === reducedBefore.depth);
  await begin(); await page.mouse.move(x, y - 80); await pause();
  await page.mouse.up(); await page.waitForTimeout(250);
  check('reduced-motion release still navigates once', (await snap()).depth === reducedBefore.depth + 1);
  check('never mounted a fourth image', await page.evaluate(() => window.__foldPeakImages <= 3));
  check('never mounted a fourth room', await page.evaluate(() => window.__foldPeakRooms <= 3));
  check('no browser runtime errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completed: checks, failure: error.message, errors, serverLog }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else server.kill('SIGTERM');
  }
}
