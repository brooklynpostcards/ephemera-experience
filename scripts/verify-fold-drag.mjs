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
const reversals = [];
const spinReleases = [];
const ordinaryNavigation = [];
const exhibitGeometry = [];
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
      window.__foldPointerX = event.clientX;
      window.__foldPointerY = event.clientY;
    }, true);
    window.__foldReadLeaves = () => [...document.querySelectorAll('.museum-room')].map((room) => {
      const angle = (selector) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(room.querySelector(selector)).transform);
        return Math.atan2(-matrix.m13, matrix.m11) * 180 / Math.PI;
      };
      const left = angle('.paper-left');
      const right = angle('.paper-right');
      const fold = room.dataset.fold;
      const crease = fold === 'left' ? right - 40 : left + 40;
      const spin = fold === 'left' ? left + 40 - crease : right - 40 - crease;
      return { depth: Number(room.dataset.depth), left, right, fold, crease, spin };
    });
    window.__foldVisibleExhibitArea = () => {
      const stage = document.querySelector('.stage').getBoundingClientRect();
      return Math.max(0, ...[...document.querySelectorAll('.museum-room')].map((room) => {
        if (Number(getComputedStyle(room).opacity) <= 0.01) return 0;
        const artwork = room.querySelector('.artwork-frame img');
        if (!artwork) return 0;
        const box = artwork.getBoundingClientRect();
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return 0;
        const width = Math.min(box.right, stage.right, innerWidth) - Math.max(box.left, stage.left, 0);
        const height = Math.min(box.bottom, stage.bottom, innerHeight) - Math.max(box.top, stage.top, 0);
        return Math.max(0, width) * Math.max(0, height);
      }));
    };
    window.__foldPeakImages = document.querySelectorAll('img').length;
    window.__foldPeakRooms = document.querySelectorAll('.museum-room').length;
    window.__foldCommittedRoomCounts = new Set([window.__foldPeakRooms]);
    window.__foldMountPeak = { mutations: 0, rooms: window.__foldPeakRooms, images: window.__foldPeakImages };
    // Count synchronously after native DOM writes as well as after React commits.
    // This catches an add-before-remove peak hidden by MutationObserver batching.
    for (const [prototype, methods] of [
      [Node.prototype, ['appendChild', 'insertBefore', 'removeChild', 'replaceChild']],
      [Element.prototype, ['append', 'prepend', 'replaceChildren', 'before', 'after',
        'replaceWith', 'remove', 'insertAdjacentElement', 'insertAdjacentHTML']],
    ]) {
      for (const method of methods) {
        const native = prototype[method];
        prototype[method] = function (...args) {
          const connected = this.isConnected;
          const result = Reflect.apply(native, this, args);
          if (connected || this.isConnected) {
            const peak = window.__foldMountPeak;
            peak.mutations += 1;
            peak.rooms = Math.max(peak.rooms, document.querySelectorAll('.museum-room').length);
            peak.images = Math.max(peak.images, document.querySelectorAll('img').length);
          }
          return result;
        };
      }
    }
    new MutationObserver(() => {
      window.__foldPeakImages = Math.max(window.__foldPeakImages, document.querySelectorAll('img').length);
      window.__foldPeakRooms = Math.max(window.__foldPeakRooms, document.querySelectorAll('.museum-room').length);
      window.__foldCommittedRoomCounts.add(document.querySelectorAll('.museum-room').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  const snap = () => page.locator('.museum').evaluate((el) => ({
    depth: Number(el.dataset.depth), facing: Number(el.dataset.facing),
    dragging: el.querySelector('.stage').classList.contains('action-dragging'),
    transform: el.querySelector('.room-current').style.transform,
    rooms: el.querySelectorAll('.museum-room').length,
    images: document.querySelectorAll('img').length,
  }));
  // The unspun leaf independently exposes the unchanged Task 28 base crease.
  const boundedLeaves = (rows, allowSpin = false) => rows.length === 3 && rows.every(({ left, right, fold, crease, spin }) =>
    Number.isFinite(left) && Number.isFinite(right) && Number.isFinite(crease) && Number.isFinite(spin)
    && Math.abs(crease) <= 32.0001
    && (fold === 'left' ? right >= 7.9999 && right <= 72.0001 : left >= -72.0001 && left <= -7.9999)
    && (allowSpin ? Math.abs(spin) <= 90.0001 && Math.abs(left) <= 162.0001 && Math.abs(right) <= 162.0001
      : left >= -72.0001 && left <= -7.9999 && right >= 7.9999 && right <= 72.0001 && Math.abs(spin) < 0.0001));
  const idleLeaves = (rows) => boundedLeaves(rows) && rows.every(({ left, right }) =>
    Math.abs(left + 40) < 0.0001 && Math.abs(right - 40) < 0.0001);
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
  async function verifyOrdinaryNavigation(input, delta) {
    const name = input + (delta > 0 ? ' forward' : ' backward');
    const before = await snap();
    // A distinct native wheel burst starts only after the existing 240ms suppression gap.
    if (input === 'wheel') { await page.waitForTimeout(260); await page.mouse.move(x, y); }
    await page.evaluate(() => {
      window.__foldDepthChanges = [];
      window.__foldNavigationAudit = [];
      window.__foldSampleNavigation = true;
      const audit = () => {
        const stage = document.querySelector('.stage');
        window.__foldNavigationAudit.push({ busy: !stage.classList.contains('action-idle'),
          leaves: window.__foldReadLeaves(), rooms: stage.querySelectorAll('.museum-room').length,
          images: document.querySelectorAll('img').length });
        if (window.__foldSampleNavigation) requestAnimationFrame(audit);
      };
      requestAnimationFrame(audit);
    });
    if (input === 'wheel') await page.mouse.wheel(0, -120 * delta);
    else await page.getByRole('button', { name: delta > 0 ? 'Next room' : 'Previous room', exact: true }).click();
    await page.locator('.stage:not(.action-idle)').waitFor();
    await page.locator('.stage.action-idle').waitFor({ timeout: 3000 }); await pause();
    const frames = await page.evaluate(() => {
      window.__foldSampleNavigation = false;
      return window.__foldNavigationAudit;
    });
    const after = await snap();
    check(name + ': ordinary navigation advances exactly one integer room once',
      after.depth === before.depth + delta && Number.isInteger(after.depth) && after.facing === before.facing
      && JSON.stringify(await page.evaluate(() => window.__foldDepthChanges)) === JSON.stringify([after.depth]));
    check(name + ': ordinary navigation stays unspun throughout its visible transition',
      frames.some((frame) => frame.busy) && frames.every((frame) => boundedLeaves(frame.leaves)));
    check(name + ': ordinary navigation keeps three views and restores idle artwork controls',
      frames.every((frame) => frame.rooms === 3 && frame.images <= 3)
      && after.rooms === 3 && after.images === 3 && idleLeaves(await page.evaluate(() => window.__foldReadLeaves()))
      && await page.locator('.movement button, .room-current button').evaluateAll((buttons) => buttons.every((button) => !button.disabled)));
    ordinaryNavigation.push({ input, delta, frames: frames.length, before: before.depth, after: after.depth });
  }
  async function compete(phase) {
    const unchanged = await page.locator('.stage').evaluate((element, phase) => {
      const owner = window.__foldPointerId;
      const pointerTime = window.__foldPointerTime;
      // Force only the existing long-gap completion route, then compete in this
      // same JS turn before React can reconcile the landing. No fake controller.
      if (phase === 'completion') window.__foldCurrentTick(performance.now() + 1000);
      const snapshot = () => JSON.stringify({
        depth: document.querySelector('.museum').dataset.depth,
        facing: document.querySelector('.museum').dataset.facing,
        status: document.querySelector('[role="status"]').textContent,
        stage: element.className, drag: element.hasAttribute('data-fold-drag'),
        rooms: [...element.querySelectorAll('.museum-room')].map((room) =>
          [room.dataset.depth, room.dataset.offset, room.getAttribute('style'), room.inert]),
        images: document.querySelectorAll('img').length,
        dialog: document.querySelector('[role="dialog"]')?.textContent,
      });
      const before = snapshot();
      const send = (type, pointerId, sign, extra = {}) => element.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId,
          pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
          clientX: 600 + sign * 80, clientY: 450 + sign * 250, ...extra }));
      try {
        for (const sign of [1, -1, 1, -1]) {
          // Reusing the captured ID makes an erroneous replacement capturable.
          send('pointerdown', owner, sign);
          send('pointerdown', owner, sign, { isPrimary: false, pointerType: 'touch' });
          send('pointerdown', owner + 100, sign);
          send('pointerdown', owner + 101, sign, { isPrimary: false, pointerType: 'touch' });
          for (const id of [owner + 100, owner + 101]) {
            for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
              send(type, id, sign);
            }
          }
          if (['release', 'return', 'inspection', 'completion'].includes(phase)) {
            for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
              send(type, owner, sign);
            }
          }
          if (phase !== 'pending') {
            for (const key of [sign > 0 ? 'ArrowUp' : 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']) {
              element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
            }
            element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: sign * 120 }));
            for (const button of document.querySelectorAll('.movement button, .room-current button')) button.click();
          }
        }
        return snapshot() === before;
      } finally {
        // The verifier's document listener also sees injected pointer-down events.
        window.__foldPointerId = owner;
        window.__foldPointerTime = pointerTime;
      }
    }, phase);
    check(phase + ': rapid competing inputs cannot replace ownership or mutate the scene', unchanged);
  }
  async function verifyInspectionMounts(name) {
    const before = await snap();
    const src = await page.locator('.room-current img').getAttribute('src');
    await page.locator('.stage').evaluate((element) => {
      window.__foldInspectionNodes = [...element.querySelectorAll('.museum-room')]
        .map((room) => ({ room, image: room.querySelector('img') }));
    });
    await page.getByRole('button', { name: 'Inspect object', exact: true }).click();
    await page.getByRole('dialog').waitFor(); await pause();
    await compete('inspection');
    check(name + ': inspection substitutes the landing image within three mounts',
      (await snap()).rooms === 3 && (await snap()).images === 3
      && await page.locator('.stage img').count() === 2
      && await page.locator('.room-current .frame-empty').count() === 1
      && await page.getByRole('dialog').locator('img').count() === 1
      && await page.getByRole('dialog').locator('img').getAttribute('src') === src);
    check(name + ': inspection keeps settled world state and room/neighbor identities',
      (await snap()).depth === before.depth && (await snap()).facing === before.facing
      && await page.evaluate(() => window.__foldInspectionNodes.every(({ room, image }) =>
        room.isConnected && (room.dataset.offset === '0' ? !image.isConnected
          : image.isConnected && room.querySelector('img') === image))));
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' }); await pause();
    check(name + ': closing inspection restores one image per room and frame focus',
      (await snap()).rooms === 3 && (await snap()).images === 3
      && (await snap()).depth === before.depth && (await snap()).facing === before.facing
      && await page.locator('.room-current img').getAttribute('src') === src
      && await page.locator('.stage').evaluate((element) =>
        document.querySelectorAll('[data-slot="dialog-portal"] img').length === 0
        && document.activeElement === element.querySelector('.room-current button')
        && window.__foldInspectionNodes.every(({ room, image }) =>
          room.isConnected && room.querySelectorAll('img').length === 1
          && (room.dataset.offset === '0' || room.querySelector('img') === image))));
    await page.evaluate(() => { delete window.__foldInspectionNodes; });
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
  await compete('pending');
  await page.mouse.move(x + 12, y - 12); await pause();
  check('ambiguous diagonal remains unresolved', !(await snap()).dragging);
  await page.mouse.move(x + 12, y - 28); await pause();
  const walk = await snap();
  check('dominant vertical motion locks and transforms', walk.dragging && walk.transform !== '');
  check('drag preserves settled depth and three-room/image window', walk.depth === initial.depth && walk.rooms === 3 && walk.images === 3);
  await compete('drag');
  await page.keyboard.press('ArrowUp'); await page.mouse.wheel(0, -120);
  check('keyboard and wheel cannot navigate during drag', (await snap()).depth === initial.depth);
  check('navigation controls gated while dragging', await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => button.disabled)));
  await page.mouse.move(x + 120, y - 60); await pause();
  check('locked vertical intent survives later horizontal dominance', (await snap()).dragging && (await snap()).facing === initial.facing);
  await page.mouse.move(x + 120, y + 60); await pause();
  check('reversal updates live transform', (await snap()).transform !== walk.transform);
  check('signed drag reversal keeps all computed paper angles bounded',
    boundedLeaves(await page.evaluate(() => window.__foldReadLeaves())));
  await cancel();
  check('cancellation starts a visible return without committing', (await snap()).dragging && (await snap()).transform !== '' && (await snap()).depth === initial.depth);
  await compete('return');
  await page.locator('.stage.action-idle').waitFor({ timeout: 3000 });
  check('cancellation settles at origin and restores controls', (await snap()).transform === '' && (await snap()).depth === initial.depth
    && await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => !button.disabled)));
  check('negative drag cancellation restores every idle leaf',
    idleLeaves(await page.evaluate(() => window.__foldReadLeaves())));
  await begin(); await page.mouse.move(x, y - 70); await pause(); await cancel('lostpointercapture');
  check('capture loss starts the same bounded return', (await snap()).dragging && (await snap()).depth === initial.depth);
  await page.locator('.stage.action-idle').waitFor({ timeout: 3000 });
  check('capture-loss return cannot strand the fold', (await snap()).transform === ''
    && await page.locator('.movement button').evaluateAll((buttons) => buttons.every((button) => !button.disabled)));
  check('positive capture-loss cancellation restores every idle leaf',
    idleLeaves(await page.evaluate(() => window.__foldReadLeaves())));
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
  // Match the controller's integer clientHeight, not fractional bounding-box height.
  const roomSpan = await page.locator('.stage').evaluate((element) =>
    Math.max(180, Math.min(420, element.clientHeight * 0.65)));
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
  async function verifyRelease(name, offset, held, delta, interruption = null, cancelGesture = false) {
    const before = await snap();
    // Four linear samples span 50ms; held/cancelled releases cannot spin.
    let eligibleSpin = !held && !cancelGesture && delta !== 0 && Math.abs(offset) / 0.05 > 5.50001;
    const beforeStatus = await page.getByRole('status').textContent();
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
      // Anchor to the actual native down event; browser coordinates may be quantized.
      const startX = window.__foldPointerX;
      const startY = window.__foldPointerY;
      const settledDepth = Number(document.querySelector('.museum').dataset.depth);
      const announcement = document.querySelector('[role="status"]').textContent;
      const orientation = () => [...document.querySelectorAll('.room-heading, .navigation-area, .movement')]
        .map((node) => {
          const box = node.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height, getComputedStyle(node).transform];
        });
      const originalOrientation = JSON.stringify(orientation());
      window.__foldStatusChanges = [];
      const statusObserver = new MutationObserver(() => {
        window.__foldStatusChanges.push(document.querySelector('[role="status"]').textContent);
      });
      statusObserver.observe(document.querySelector('[role="status"]'),
        { childList: true, characterData: true, subtree: true });
      window.__foldStatusObserver = statusObserver;
      window.__foldLandingCleanup = [];
      window.__foldLeafCleanup = [];
      const nativeRemoveProperty = CSSStyleDeclaration.prototype.removeProperty;
      window.__foldRestoreRemoveProperty = () => {
        CSSStyleDeclaration.prototype.removeProperty = nativeRemoveProperty;
      };
      CSSStyleDeclaration.prototype.removeProperty = function (property) {
        const current = element.querySelector('.room-current');
        const landing = property === 'transform' && this === current?.style
          && element.classList.contains('action-idle');
        const leaf = property === 'transform' && element.classList.contains('action-idle')
          ? [...element.querySelectorAll('.paper-left, .paper-right')].find((node) => node.style === this)
          : null;
        const leafBefore = leaf ? getComputedStyle(leaf).transform : null;
        const before = landing ? getComputedStyle(current).transform : null;
        const result = Reflect.apply(nativeRemoveProperty, this, [property]);
        if (landing) window.__foldLandingCleanup.push({
          depth: Number(current.dataset.depth), before,
          after: getComputedStyle(current).transform,
        });
        if (leaf) window.__foldLeafCleanup.push({ before: leafBefore,
          after: getComputedStyle(leaf).transform });
        return result;
      };
      let previousNodes = new Map([...element.querySelectorAll('.museum-room')].map((room) =>
        [Number(room.dataset.depth), { room, image: room.querySelector('img'),
          leftNode: room.querySelector('.paper-left'), rightNode: room.querySelector('.paper-right') }]));
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
          const leafAngle = (selector) => Number(room.querySelector(selector).style.transform.match(/rotateY\(([-.\de+]+)deg\)/i)?.[1]);
          const left = leafAngle('.paper-left');
          const right = leafAngle('.paper-right');
          const fold = room.dataset.fold;
          const crease = fold === 'left' ? right - 40 : left + 40;
          const spin = fold === 'left' ? left + 40 - crease : right - 40 - crease;
          const handedness = room.dataset.fold === 'left' ? 1 : -1;
          const continuous = previous?.relative === undefined
            || Math.abs(crease - previous.crease) <= 32 * Math.PI * Math.abs(relative - previous.relative) + 0.0001;
          return { depth, left, right, fold, spin, continuous, crease, handedness, offset: Number(room.dataset.offset), relative,
            progress: depth - settledDepth - relative,
            stable: !previous || (previous.room === room && previous.image === room.querySelector('img')
              && previous.leftNode === room.querySelector('.paper-left') && previous.rightNode === room.querySelector('.paper-right')),
            opacity: Number(room.style.opacity),
            transition: getComputedStyle(room).transitionDuration };
        });
        window.__foldWindows.push({ anchor, rows,
          images: document.querySelectorAll('img').length,
          focused: document.activeElement === element,
          announced: document.querySelector('[role="status"]').textContent === announcement });
        previousNodes = new Map(rooms.map((room, index) =>
          [Number(room.dataset.depth), { room, image: room.querySelector('img'),
            relative: rows[index].relative, crease: rows[index].crease,
            leftNode: room.querySelector('.paper-left'), rightNode: room.querySelector('.paper-right') }]));
      });
      // Observe committed window/role mutations, after layout effects have painted.
      windowObserver.observe(element, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'data-depth', 'data-offset'] });
      window.__foldWindowObserver = windowObserver;
      const emittedSamples = [{ time: 0, offset: 0 }];
      const send = (type, fraction, milliseconds) => {
        const event = new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'mouse',
          isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
          clientX: startX, clientY: startY - gesture.roomSpan * gesture.offset * fraction });
        Object.defineProperty(event, 'timeStamp', { value: startTime + milliseconds });
        element.dispatchEvent(event);
        const sample = { time: (event.timeStamp - startTime) / 1000,
          offset: (startY - event.clientY) / gesture.roomSpan };
        if (emittedSamples.at(-1).time === sample.time) emittedSamples.pop();
        emittedSamples.push(sample);
      };
      for (let sample = 1; sample <= 4; sample++) send('pointermove', sample / 4, sample * 12.5);
      window.__foldDragLeaves = window.__foldReadLeaves();
      window.__foldAudit = [];
      const audit = () => {
        const museum = document.querySelector('.museum');
        const rooms = [...museum.querySelectorAll('.museum-room')];
        const busy = element.classList.contains('action-dragging');
        window.__foldAudit.push({ depth: Number(museum.dataset.depth), facing: Number(museum.dataset.facing), busy,
          announcement: museum.querySelector('[role="status"]').textContent,
          gated: [...museum.querySelectorAll('.movement button, .room-current button')].every((button) => button.disabled)
            && rooms.every((room) => room.inert),
          rooms: rooms.length, images: document.querySelectorAll('img').length,
          leaves: window.__foldReadLeaves(),
          visibleExhibitArea: window.__foldVisibleExhibitArea(),
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          orientationStable: !busy || JSON.stringify(orientation()) === originalOrientation,
          finite: rooms.every((room) => !/NaN|Infinity/.test(room.getAttribute('style') || '')) });
        if (busy || element.hasAttribute('data-fold-drag')) requestAnimationFrame(audit);
      };
      // Retain the actual controller callback for stale-generation replay. Scheduling
      // and timestamps remain native; the wrapper exists only during pointer-up.
      const nativeFrame = window.requestAnimationFrame;
      window.__foldPreviousTick = window.__foldCurrentTick;
      window.__foldCurrentTick = null;
      window.requestAnimationFrame = (callback) => {
        window.__foldCurrentTick = callback;
        return nativeFrame.call(window, callback);
      };
      try {
        send(gesture.cancelGesture ? 'pointercancel' : 'pointerup', 1, gesture.held ? 200 : 50);
        window.__foldReleaseLeaves = window.__foldReadLeaves();
        const releaseSample = emittedSamples.at(-1);
        const recent = emittedSamples.filter((sample) => sample.time >= releaseSample.time - 0.1);
        // Pairwise slope avoids depending on the production estimator implementation.
        let numerator = 0, denominator = 0;
        for (let i = 0; i < recent.length; i++) for (let j = i + 1; j < recent.length; j++) {
          const dt = recent[j].time - recent[i].time;
          numerator += dt * (recent[j].offset - recent[i].offset);
          denominator += dt * dt;
        }
        window.__foldInputCapture = { offset: releaseSample.offset,
          velocity: gesture.cancelGesture || denominator === 0 ? 0 : Math.max(-8, Math.min(8, numerator / denominator)),
          geometricDownError: gesture.y - startY,
          geometricRoomSpan: Math.max(180, Math.min(420, element.getBoundingClientRect().height * 0.65)),
          controllerRoomSpan: Math.max(180, Math.min(420, element.clientHeight * 0.65)) };
      } finally {
        window.requestAnimationFrame = nativeFrame;
      }
      requestAnimationFrame(audit);
    }, { x, y, roomSpan, offset, held, cancelGesture });
    await page.mouse.up(); await pause();
    const during = await snap();
    const capture = await page.evaluate(() => window.__foldInputCapture);
    eligibleSpin = !cancelGesture && delta !== 0 && Math.abs(capture.velocity) > 5.5000001;
    check(name + ': retains origin and live pose after release', during.dragging
      && during.depth === before.depth && during.facing === before.facing && during.transform !== '');
    check(name + ': signed drag paints bounded computed leaf angles',
      boundedLeaves(await page.evaluate(() => window.__foldDragLeaves)));
    check(name + ': release starts with exactly the unspun drag pose',
      boundedLeaves(await page.evaluate(() => window.__foldReleaseLeaves)));
    await compete('release');
    if (await page.evaluate(() => Boolean(window.__foldPreviousTick))) {
      await page.evaluate(() => {
        // Without the generation guard, this old timestamp would finish the new release.
        window.__foldPreviousTick(performance.now() + 1000);
      });
      await pause();
      check(name + ': stale frame cannot finish a newer release', (await snap()).dragging
        && (await snap()).depth === before.depth
        && await page.getByRole('status').textContent() === beforeStatus);
    }
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    await page.mouse.wheel(0, -120);
    // A second press and a late cancel cannot steal an already detached release.
    await page.locator('.stage').evaluate((element) => {
      const releasedPointerId = window.__foldPointerId;
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true,
        pointerId: releasedPointerId + 100, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: releasedPointerId }));
    });
    if (interruption) {
      check(name + ': interrupts a resolved release at its captured origin', (await snap()).dragging
        && (await snap()).depth === before.depth);
      if (interruption === 'reduced-motion') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
      } else if (interruption === 'completion') {
        await compete('completion');
      } else {
        assert.equal(interruption, 'long-gap');
        await page.evaluate(() => {
          const deadline = performance.now() + 300;
          while (performance.now() < deadline) { /* One real frame gap exceeds 0.25s. */ }
        });
      }
    }
    await page.locator('.stage.action-idle').waitFor({ timeout: 3000 }); await pause();
    const after = await snap();
    const landingCleanup = await page.evaluate(() => {
      window.__foldRestoreRemoveProperty();
      return window.__foldLandingCleanup;
    });
    if (!interruption) {
      check(name + ': natural settle reaches the final room pose before cleanup',
        landingCleanup.length === 1 && landingCleanup[0].depth === after.depth
        && await page.evaluate(({ before, after }) =>
          new DOMMatrixReadOnly(before).isIdentity && new DOMMatrixReadOnly(after).isIdentity,
        landingCleanup[0]));
    }
    if (!interruption) {
      check(name + ': all six natural-landing leaves match before and after cleanup',
        await page.evaluate(() => window.__foldLeafCleanup.length === 6
          && window.__foldLeafCleanup.every(({ before, after }) => {
            const first = new DOMMatrixReadOnly(before).toFloat64Array();
            const last = new DOMMatrixReadOnly(after).toFloat64Array();
            return first.every((value, index) => Math.abs(value - last[index]) < 0.000001);
          })));
    }
    check(name + ': final computed leaves equal the idle paper pose',
      idleLeaves(await page.evaluate(() => window.__foldReadLeaves())));
    await page.evaluate(() => {
      window.__foldCurrentTick(performance.now() + 1000);
      window.__foldCurrentTick(performance.now() + 2000);
    });
    await pause();
    check(name + ': repeated late frames cannot change completed state',
      JSON.stringify(await snap()) === JSON.stringify(after));
    const audit = await page.evaluate(() => window.__foldAudit);
    const windows = await page.evaluate(() => {
      window.__foldWindowObserver.disconnect();
      return window.__foldWindows;
    });
    const statusChanges = await page.evaluate(() => {
      window.__foldStatusObserver.disconnect();
      return window.__foldStatusChanges;
    });
    const afterStatus = await page.getByRole('status').textContent();
    const expectedStatus = await page.locator('.room-current').evaluate((element, facing) =>
      'Room ' + element.dataset.room + ', facing ' + ['North', 'East', 'South', 'West'][facing]
      + '. ' + element.querySelector('h2').textContent + '.', after.facing);
    check(name + ': announcement changes only to the final room',
      afterStatus === expectedStatus
      && JSON.stringify(statusChanges) === JSON.stringify(delta ? [afterStatus] : [])
      && audit.every((frame) => frame.announcement === (frame.busy ? beforeStatus : afterStatus)));
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
    check(name + ': release keeps finite bounded computed leaf angles',
      audit.length > 0 && audit.every((frame) => boundedLeaves(frame.leaves, eligibleSpin)));
    check(name + ': anchor swaps preserve continuous signed room-relative creases',
      windows.length > 0 && windows.every((sample) => boundedLeaves(sample.rows, eligibleSpin)
        && sample.rows.every((row) => row.continuous
          && (Math.abs(row.relative) >= 1 ? Math.abs(row.crease) < 0.0001
            : Math.abs(row.crease) < 0.0001 || Math.sign(row.crease) === -Math.sign(row.relative) * row.handedness))));
    check(name + ': only eligible signed releases spin the deterministic moving leaf',
      audit.every((frame) => frame.leaves.every((row) => Math.abs(row.spin) < 0.0001
        || eligibleSpin && Math.sign(row.spin) === Math.sign(offset) * (row.fold === 'left' ? 1 : -1)))
      && (!eligibleSpin || interruption || audit.some((frame) => frame.leaves.some((row) => Math.abs(row.spin) > 0.01))));
    check(name + ': reduced frames suppress spin and orientation UI remains stationary',
      audit.every((frame) => frame.orientationStable && (!frame.reduced || idleLeaves(frame.leaves))));
    const paintErrors = windows.flatMap((sample) => sample.rows.map((row) => {
      const travel = delta - capture.offset;
      const q = travel === 0 ? 0 : Math.max(0, Math.min(1, (row.progress - capture.offset) / travel));
      const strength = cancelGesture || delta === 0 ? 0 : Math.max(0, Math.min(1, (Math.abs(capture.velocity) - 5.5) / 2.5));
      const wave = q === 0 || q === 1 ? 0 : Math.sin(Math.PI * q) ** 2;
      const weight = Math.abs(row.relative) >= 1 ? 0 : Math.cos(Math.PI * row.relative / 2) ** 2;
      const expected = 90 * strength * Math.sign(capture.velocity) * wave * weight * row.handedness;
      // Chromium serializes inline transforms to six significant digits. Bound the
      // two angle roundoffs plus recovered-progress error times the curve derivative.
      const tolerance = 0.0006 + (travel === 0 ? 0
        : 0.000005 * 90 * strength * (Math.PI / Math.abs(travel) + Math.PI / 2));
      return { error: Math.abs(row.spin - expected), tolerance, expected, actual: row.spin, progress: row.progress };
    }));
    const worstPaint = paintErrors.reduce((worst, row) => row.error > worst.error ? row : worst, { error: 0 });
    assert.ok(paintErrors.every(({ error, tolerance }) => error < tolerance),
      name + ': spin repaint mismatch ' + JSON.stringify({ capture, worstPaint }));
    checks.push(name + ': anchor repaint uses captured displacement and moving-leaf spin weight');
    spinReleases.push({ name, velocity: capture.velocity, geometricDownError: capture.geometricDownError,
      geometricRoomSpan: capture.geometricRoomSpan, controllerRoomSpan: capture.controllerRoomSpan,
      maxPaintError: Math.max(0, ...paintErrors.map(({ error }) => error)),
      peakSpin: Math.max(0, ...audit.flatMap((frame) => frame.leaves.map((row) => Math.abs(row.spin)))) });
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
    if (Math.abs(delta) > 1 && !interruption) {
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
    if (Math.abs(delta) > 1 && !interruption) {
      const activeAreas = audit.filter((frame) => frame.busy).map((frame) => frame.visibleExhibitArea);
      check(name + ': active travel keeps visible exhibit geometry inside the clipped stage',
        activeAreas.length > 0 && activeAreas.every((area) => Number.isFinite(area) && area > 0));
      check(name + ': landing artwork and movement controls receive hits and focus',
        await page.evaluate(() => {
          const previousFocus = document.activeElement;
          try {
            return [...document.querySelectorAll('.room-current .artwork-frame, .movement button')].every((control) => {
              const box = control.getBoundingClientRect();
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              if (control.disabled || !hit || !control.contains(hit)) return false;
              control.focus({ preventScroll: true });
              return document.activeElement === control;
            });
          } finally { previousFocus?.focus({ preventScroll: true }); }
        }));
      exhibitGeometry.push({ name, activeFrames: activeAreas.length, minVisibleArea: Math.min(...activeAreas) });
    }
    check(name + ': final window and focus agree with the committed depth',
      await page.locator('.stage').evaluate((element, depth) =>
        document.activeElement === element
        && [...element.querySelectorAll('.museum-room')].every((room, index) =>
          Number(room.dataset.depth) === depth + index - 1
          && Number(room.dataset.offset) === index - 1
          && room.inert === (index !== 1)), after.depth));
    if (interruption === 'reduced-motion') {
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await pause();
    }
    return { before, after, beforeIdentity, afterIdentity };
  }
  check('expanded releases start at a nonzero integer origin', landed.depth !== 0 && Number.isInteger(landed.depth));
  await verifyRelease('cancel forward paper drag', 0.7, true, 0, null, true);
  await verifyRelease('cancel backward paper drag', -0.7, true, 0, null, true);
  await verifyRelease('held short forward', 0.2, true, 0);
  await verifyRelease('fast short forward', 0.2, false, 1);
  await verifyRelease('held short backward', -0.2, true, 0);
  await verifyRelease('fast short backward', -0.2, false, -1);
  await verifyRelease('ordinary forward', 0.7, true, 1);
  await verifyRelease('ordinary backward', -0.7, true, -1);
  check('paired releases return exactly to the nonzero origin', (await snap()).depth === landed.depth
    && (await snap()).facing === landed.facing);
  const twoForward = await verifyRelease('high release forward two rooms', 0.65, false, 2);
  await verifyInspectionMounts('after +2 landing');
  const twoBackward = await verifyRelease('high release backward two rooms', -0.65, false, -2);
  await verifyInspectionMounts('after -2 landing');
  check('two-room inverse restores exact origin and descriptor',
    twoBackward.after.depth === twoForward.before.depth
    && JSON.stringify(twoBackward.afterIdentity) === JSON.stringify(twoForward.beforeIdentity));
  const threeForward = await verifyRelease('maximum release forward three rooms', 1, false, 3);
  await verifyInspectionMounts('after +3 landing');
  const threeBackward = await verifyRelease('maximum release backward three rooms', -1, false, -3);
  await verifyInspectionMounts('after -3 landing');
  check('three-room inverse restores exact origin and descriptor',
    threeBackward.after.depth === threeForward.before.depth
    && JSON.stringify(threeBackward.afterIdentity) === JSON.stringify(threeForward.beforeIdentity));
  // Signed nominal release speeds immediately below, at, and above the 5.5 threshold.
  // The exact-threshold case tolerates only computed-matrix serialization noise.
  for (const [offset, delta] of [[0.27, 1], [0.275, 1], [0.28, 2]]) {
    for (const sign of [1, -1]) {
      await verifyRelease('spin threshold ' + sign * offset / 0.05,
        sign * offset, false, sign * delta);
    }
  }
  // Resolved-release interruption is distinct from the existing cancellation-return tests.
  for (const interruption of ['reduced-motion', 'long-gap']) {
    for (const [offset, delta] of [[0.65, 2], [1, 3], [-0.65, -2], [-1, -3], [0.2, 0]]) {
      await verifyRelease(interruption + ' target ' + delta, offset, delta === 0, delta, interruption);
    }
  }
  // Reach each origin using public controls; never inject production world state.
  // Both outbound signs cross zero, and the full three-room fingerprint must return.
  const fingerprintWindow = () => page.locator('.museum-room').evaluateAll((rooms) =>
    rooms.map((room) => ({
      depth: Number(room.dataset.depth), offset: Number(room.dataset.offset),
      number: room.dataset.room, fold: room.dataset.fold,
      accent: room.style.getPropertyValue('--room-accent'),
      title: room.querySelector('h2').textContent, src: room.querySelector('img')?.getAttribute('src'),
    })));
  for (const [depth, facing, offset, delta] of [
    [-1, 0, 0.65, 2], [-1, 1, 1, 3], [1, 2, -0.65, -2], [1, 3, -1, -3],
  ]) {
    let setup = await snap();
    for (let step = 0; step < 12 && (setup.depth !== depth || setup.facing !== facing); step++) {
      const command = setup.depth !== depth
        ? (setup.depth < depth ? 'Next room' : 'Previous room') : 'Turn right';
      await page.getByRole('button', { name: command, exact: true }).click();
      await page.locator('.stage.action-idle').waitFor({ timeout: 3000 }); await pause();
      setup = await snap();
    }
    const name = 'round trip from depth ' + depth + ' facing ' + facing + ' via ' + delta;
    check(name + ': reaches the signed origin and facing', setup.depth === depth && setup.facing === facing);
    const originalWindow = await fingerprintWindow();
    const originalStatus = await page.getByRole('status').textContent();
    const outward = await verifyRelease(name + ' outbound', offset, false, delta);
    const returning = await verifyRelease(name + ' return', -offset, false, -delta);
    check(name + ': crosses zero and restores exact world/window identity',
      Math.sign(outward.after.depth) === -Math.sign(depth)
      && outward.after.depth === depth + delta && outward.after.facing === facing
      && returning.before.depth === outward.after.depth
      && returning.after.depth === depth && returning.after.facing === facing
      && JSON.stringify(returning.afterIdentity) === JSON.stringify(outward.beforeIdentity)
      && JSON.stringify(await fingerprintWindow()) === JSON.stringify(originalWindow)
      && await page.getByRole('status').textContent() === originalStatus);
    reversals.push({ origin: depth, facing, delta,
      destination: outward.after.depth, returned: returning.after.depth });
  }
  const beforeInterruptedPending = await snap();
  // Begin immediately after each observed idle reconciliation, with no cooldown.
  const rapidOrigin = await snap();
  const rapidWindow = await fingerprintWindow();
  await verifyRelease('completion reconciliation forward', 0.65, false, 2, 'completion');
  await verifyRelease('completion reconciliation backward', -0.65, false, -2, 'completion');
  for (const [offset, delta] of [[0.65, 2], [-0.65, -2], [1, 3], [-1, -3]]) {
    await verifyRelease('rapid alternating ' + delta, offset, false, delta);
  }
  check('rapid accepted opposite gestures restore the exact origin and window',
    (await snap()).depth === rapidOrigin.depth && (await snap()).facing === rapidOrigin.facing
    && JSON.stringify(await fingerprintWindow()) === JSON.stringify(rapidWindow));
  await begin(); await page.mouse.move(x, y - 5); await pause();
  await page.evaluate(() => {
    window.__foldStepLeaves = [];
    window.__foldSampleStep = true;
    const audit = () => {
      window.__foldStepLeaves.push(window.__foldReadLeaves());
      if (window.__foldSampleStep) requestAnimationFrame(audit);
    };
    requestAnimationFrame(audit);
  });
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(650);
  const stepLeaves = await page.evaluate(() => {
    window.__foldSampleStep = false;
    return window.__foldStepLeaves;
  });
  check('fixed keyboard step never receives moving-leaf spin',
    stepLeaves.length > 0 && stepLeaves.every((rows) => boundedLeaves(rows)));
  await page.mouse.move(x, y - 80); await pause();
  check('alternate navigation clears pending origin before later pointer movement', !(await snap()).dragging && (await snap()).depth === beforeInterruptedPending.depth + 1);
  await page.mouse.up(); await pause();
  for (const input of ['wheel', 'button']) {
    for (const delta of [1, -1]) await verifyOrdinaryNavigation(input, delta);
  }
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
  check('reduced-motion interruption restores every idle leaf',
    idleLeaves(await page.evaluate(() => window.__foldReadLeaves())));
  const reducedBefore = await snap();
  await begin(); await page.mouse.move(x, y - 80); await pause();
  check('reduced motion has no live perspective transform', (await snap()).transform === '');
  await cancel();
  check('reduced-motion cancellation cleans up immediately', !(await snap()).dragging && (await snap()).depth === reducedBefore.depth);
  await begin(); await page.mouse.move(x, y - 80); await pause();
  await page.mouse.up(); await page.waitForTimeout(250);
  check('reduced-motion release still navigates once', (await snap()).depth === reducedBefore.depth + 1);
  check('reduced-motion drag cancellation and release leave every paper leaf idle',
    idleLeaves(await page.evaluate(() => window.__foldReadLeaves())));
  check('never mounted a fourth image', await page.evaluate(() => window.__foldPeakImages <= 3));
  check('never mounted a fourth room', await page.evaluate(() => window.__foldPeakRooms <= 3));
  const mountPeak = await page.evaluate(() => window.__foldMountPeak);
  check('synchronous mount instrumentation observed native DOM writes', mountPeak.mutations > 0);
  assert.ok(mountPeak.rooms <= 3 && mountPeak.images <= 3,
    'Synchronous mount limit: ' + JSON.stringify(mountPeak));
  checks.push('no fourth room or image even within a DOM mutation batch');
  check('exactly three rooms after every observed commit', await page.evaluate(() =>
    window.__foldCommittedRoomCounts.size === 1 && window.__foldCommittedRoomCounts.has(3)));
  check('no browser runtime errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks, mountPeak, reversals, spinReleases, ordinaryNavigation, exhibitGeometry, errors }, null, 2));
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
