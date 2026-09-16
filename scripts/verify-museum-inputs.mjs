// Supplements verify-fold-drag.mjs; reuses installed Playwright and a running server.
// node scripts/verify-museum-inputs.mjs <playwright-package-path> [base-url]
// CDP touch is trusted Chromium mobile emulation, not physical-device validation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const origin = process.argv[3] || 'http://127.0.0.1:3000';
const checks = [], errors = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const browser = await chromium.launch({ headless: true,
  ...(process.env.FOLD_CHROMIUM_PATH ? { executablePath: process.env.FOLD_CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => Object.keys(document.querySelector('.stage') || {})
    .some((key) => key.startsWith('__reactProps$')));
  const pause = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snap = () => page.evaluate(() => ({
    depth: Number(document.querySelector('.museum').dataset.depth),
    facing: Number(document.querySelector('.museum').dataset.facing),
    idle: document.querySelector('.stage').classList.contains('action-idle'),
    dialog: !!document.querySelector('[role="dialog"]'),
  }));
  async function unchanged(name, before) {
    await pause();
    check(name, JSON.stringify(await snap()) === JSON.stringify(before));
  }
  async function landing(name, depth, facing = 0) {
    await page.waitForFunction(([d, f]) => document.querySelector('.stage').classList.contains('action-idle')
      && Number(document.querySelector('.museum').dataset.depth) === d
      && Number(document.querySelector('.museum').dataset.facing) === f, [depth, facing]);
    check(`${name}: expected integer landing`, Number.isInteger(depth) && (await snap()).depth === depth);
    check(`${name}: three rooms/images and clean pose`, await page.evaluate(() =>
      document.querySelectorAll('.museum-room').length === 3 && document.querySelectorAll('img').length === 3
      && !document.querySelector('.stage').hasAttribute('data-fold-drag')
      && new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.room-current')).transform).isIdentity));
    check(`${name}: focus stays on stage`, await page.locator('.stage').evaluate((el) => el === document.activeElement));
  }
  await pause();
  await page.locator('.stage').focus();
  const initial = await snap();
  for (const key of ['Control+w', 'Meta+w', 'Alt+w']) {
    await page.keyboard.press(key);
    await unchanged(`${key}: modifier gate`, initial);
  }
  await page.locator('.stage').evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'w', repeat: true, bubbles: true, cancelable: true })));
  await unchanged('synthetic repeat key: ignored', initial);

  for (const [tag, editable] of [['input', null], ['textarea', null], ['select', null],
    ['div', 'true'], ['div', ''], ['div', 'plaintext-only']]) {
    await page.evaluate(([name, value]) => {
      const host = document.createElement(name);
      host.id = 'input-test-host';
      if (value !== null) {
        host.setAttribute('contenteditable', value);
        host.append(document.createElement('span'));
        host.firstChild.textContent = 'editable';
        host.firstChild.tabIndex = 0;
      }
      document.body.append(host);
      (host.firstElementChild || host).focus();
      if (value !== null) {
        // Focusing a nested editable span alone does not create a typing caret.
        const range = document.createRange();
        range.selectNodeContents(host.firstElementChild);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }, [tag, editable]);
    check(`${tag} editable=${JSON.stringify(editable)}: editable target owns focus`,
      await page.locator('#input-test-host').evaluate((el) => el === document.activeElement || el.contains(document.activeElement)));
    for (const key of ['w', 'ArrowUp', 'Enter']) {
      await page.keyboard.press(key);
      await unchanged(`${tag} editable=${JSON.stringify(editable)} ${key}: typing does not navigate or inspect`, initial);
      if (key === 'w' && tag !== 'select') check(`${tag} editable=${JSON.stringify(editable)}: w is inserted`,
        await page.locator('#input-test-host').evaluate((el) => (el.value ?? el.textContent).includes('w')));
    }
    await page.locator('#input-test-host').evaluate((el) => el.remove());
  }
  await page.locator('.stage').focus();
  await page.keyboard.press('W');
  await landing('uppercase W', 1);
  await page.keyboard.press('S');
  await landing('uppercase S', 0);

  async function wheel(init) {
    return page.locator('.stage').evaluate((el, values) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...values });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    }, init);
  }
  for (const init of [{ deltaY: -120, ctrlKey: true }, { deltaY: -120, metaKey: true }, { deltaX: 121, deltaY: -120 }]) {
    check(`synthetic wheel passthrough ${JSON.stringify(init)}`, !await wheel(init));
    await unchanged('passthrough wheel does not navigate', initial);
  }
  for (const { mode, deltas, depth } of [
    { mode: 0, deltas: [-16, -18, -1], depth: 1 },
    { mode: 1, deltas: [1, 1, 1], depth: 0 },
    { mode: 2, deltas: [-1], depth: 1 },
  ]) {
    await page.waitForTimeout(260); // A new burst uses the existing 240ms event-gap contract.
    const before = await snap();
    for (let i = 0; i < deltas.length; i++) {
      check(`wheel mode ${mode} delta ${i}: consumed`, await wheel({ deltaY: deltas[i], deltaMode: mode }));
      if (i < deltas.length - 1) await unchanged(`wheel mode ${mode}: below threshold ${i}`, before);
    }
    await landing(`wheel mode ${mode}`, depth);
  }
  await page.keyboard.press('s');
  await landing('wheel cleanup step', 0);

  await page.evaluate(() => {
    window.__inputEvents = [];
    window.__captureAttempts = 0;
    // Invoked with the original receiver through Reflect.apply below.
    // oxlint-disable-next-line typescript/unbound-method
    const nativeCapture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (...args) {
      window.__captureAttempts++;
      return Reflect.apply(nativeCapture, this, args);
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, (event) => {
        window.__inputEvents.push({ type, id: event.pointerId, pointerType: event.pointerType,
          primary: event.isPrimary, trusted: event.isTrusted, target: event.target.className });
      }, true);
    }
  });
  const box = await page.locator('.stage').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const span = Math.max(180, Math.min(420, box.height * 0.65));
  for (const init of [{ pointerType: 'pen' }, { isPrimary: false }, { button: 1 }, { button: 2 },
    { pointerType: 'touch', clientX: 23 }, { pointerType: 'touch', clientX: 337 }]) {
    const beforeAttempts = await page.evaluate(() => window.__captureAttempts);
    await page.locator('.stage').evaluate((el, values) => el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 99, pointerType: 'mouse', isPrimary: true, button: 0,
      clientX: 180, clientY: 300, ...values,
    })), init);
    check(`synthetic pointer rejected before capture: ${JSON.stringify(init)}`,
      await page.evaluate(() => window.__captureAttempts) === beforeAttempts);
    await unchanged('rejected pointer preserves state', initial);
  }
  // A fabricated inactive ID exercises capture failure rather than faking acceptance.
  const attempts = await page.evaluate(() => window.__captureAttempts);
  await page.locator('.stage').evaluate((el) => el.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerId: 99999, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 180, clientY: 300,
  })));
  check('inactive synthetic pointer attempted capture', await page.evaluate(() => window.__captureAttempts) === attempts + 1);
  await unchanged('capture failure rolls back', initial);

  for (const button of ['middle', 'right']) {
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    await page.mouse.move(x, y - 80, { steps: 4 });
    await page.mouse.up({ button });
    await unchanged(`browser mouse ${button}: rejected`, initial);
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 4 });
  check('native mouse still accepted after capture failure', !(await snap()).idle);
  await page.locator('.stage').evaluate((el) => {
    const event = window.__inputEvents.findLast((row) => row.type === 'pointerdown' && row.trusted && row.pointerType === 'mouse');
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: event.id,
      pointerType: 'mouse', buttons: 0, clientX: 180, clientY: 220 }));
  });
  await page.mouse.up();
  await landing('synthetic lost mouse button cancels native drag', 0);

  const cdp = await page.context().newCDPSession(page);
  async function touch(type, points) {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([tx, ty, id = 1]) =>
      ({ x: tx, y: ty, id, radiusX: 2, radiusY: 2, force: 1 })) });
  }
  async function swipe(name, dx, dy, depth, facing = 0, cancel = false) {
    const startY = y - dy / 2;
    const startX = x - dx / 2;
    await page.evaluate(() => { window.__inputEvents = []; });
    await touch('touchStart', [[startX, startY]]);
    for (let i = 1; i <= 5; i++) {
      await touch('touchMove', [[startX + dx * i / 5, startY + dy * i / 5]]);
      await page.waitForTimeout(25);
    }
    // Hold beyond the velocity sample window so this tests displacement, not flick tuning.
    await page.waitForTimeout(180);
    if (dy !== 0) check(`${name}: touch owns live walk before release/cancel`, !(await snap()).idle);
    await touch(cancel ? 'touchCancel' : 'touchEnd', []);
    await landing(name, depth, facing);
    const events = await page.evaluate(() => window.__inputEvents);
    check(`${name}: browser-delivered primary touch`, events.some((e) => e.type === 'pointerdown'
      && e.pointerType === 'touch' && e.primary && e.trusted));
    check(`${name}: browser capture delivered`, events.some((e) => e.type === 'gotpointercapture' && e.trusted));
    if (dy !== 0) check(`${name}: capture transfers to stage`, events.some((e) =>
      e.type === 'gotpointercapture' && e.trusted && String(e.target).startsWith('stage ')));
    if (cancel) check(`${name}: browser cancellation delivered`, events.some((e) => e.type === 'pointercancel' && e.trusted));
    check(`${name}: drag does not inspect`, !(await snap()).dialog);
  }
  await swipe('CDP touch forward', 0, -span * 0.65, 1);
  await swipe('CDP touch backward', 0, span * 0.65, 0);
  await swipe('CDP touch right turn', -100, 0, 0, 1);
  await swipe('CDP touch left turn', 100, 0, 0, 0);
  await swipe('CDP touch cancellation', 0, -span * 0.65, 0, 0, true);
  await page.locator('.room-current .artwork-frame').tap();
  await page.getByRole('dialog').waitFor();
  check('browser touch tap opens inspection', (await snap()).dialog);
  const inspecting = await snap();
  await page.keyboard.press('w');
  await unchanged('keyboard is gated during touch-opened inspection', inspecting);
  await page.getByRole('button', { name: 'Back to room' }).tap();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check('touch inspection close restores artwork focus', await page.locator('.room-current .artwork-frame')
    .evaluate((el) => el === document.activeElement));

  // Task 42: exercise the reduced-motion bypass with browser-delivered touch.
  const fingerprint = () => page.evaluate(() => JSON.stringify({
    depth: document.querySelector('.museum').dataset.depth,
    facing: document.querySelector('.museum').dataset.facing,
    status: document.querySelector('output, [role="status"]').textContent,
    rooms: [...document.querySelectorAll('.museum-room')].map((room) => ({
      data: { ...room.dataset }, title: room.querySelector('.accession-slip').textContent,
      image: room.querySelector('img').getAttribute('src'), accent: room.style.getPropertyValue('--room-accent'),
    })),
  }));
  const originFingerprint = await fingerprint();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pause();
  await page.evaluate(() => {
    const stage = document.querySelector('.stage'), museum = document.querySelector('.museum');
    const status = document.querySelector('output, [role="status"]');
    const nativeFrame = window.requestAnimationFrame;
    const audit = { frames: [], commits: [], status: [], rafCalls: 0, peakRooms: 3, peakImages: 3, writes: 0 };
    window.__touchAudit = audit;
    window.requestAnimationFrame = (callback) => {
      audit.rafCalls++;
      return nativeFrame.call(window, callback);
    };
    for (const [prototype, methods] of [
      [Node.prototype, ['appendChild', 'insertBefore', 'removeChild', 'replaceChild']],
      [Element.prototype, ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith', 'remove']],
    ]) for (const method of methods) {
      const native = prototype[method];
      prototype[method] = function (...args) {
        const result = Reflect.apply(native, this, args);
        audit.writes++;
        audit.peakRooms = Math.max(audit.peakRooms, document.querySelectorAll('.museum-room').length);
        audit.peakImages = Math.max(audit.peakImages, document.querySelectorAll('img').length);
        return result;
      };
    }
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.target === museum)) audit.commits.push(Number(museum.dataset.depth));
      if (records.some((record) => record.target === status || status.contains(record.target))) audit.status.push(status.textContent);
    });
    observer.observe(museum, { attributes: true, attributeFilter: ['data-depth', 'data-facing'] });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    let sampling = true;
    const sample = () => {
      const rooms = [...stage.querySelectorAll('.museum-room')];
      audit.frames.push({ depth: Number(museum.dataset.depth),
        rooms: rooms.length, images: document.querySelectorAll('img').length,
        clean: !stage.hasAttribute('data-fold-drag') && rooms.every((room) => room.style.transform === ''
          && room.style.opacity === '' && [...room.querySelectorAll('.paper-left,.paper-right')]
            .every((leaf) => leaf.style.transform === '')),
        stationary: new DOMMatrixReadOnly(getComputedStyle(stage.querySelector('.room-current')).transform).isIdentity,
      });
      if (sampling) nativeFrame.call(window, sample);
    };
    sample();
    window.__endTouchAudit = () => {
      sampling = false;
      observer.disconnect();
      window.requestAnimationFrame = nativeFrame;
      return audit;
    };
  });
  for (const delta of [1, -1]) await swipe(`reduced CDP touch ${delta}`, 0, -span * 0.65 * delta, delta > 0 ? 1 : 0);
  for (const delta of [1, -1]) {
    await swipe(`reduced CDP cancellation ${delta}`, 0, -span * 0.65 * delta, 0, 0, true);
    await swipe(`reduced CDP short return ${delta}`, 0, -20 * delta, 0);
  }
  const reducedAudit = await page.evaluate(() => window.__endTouchAudit());
  check('reduced touch schedules no application RAFs', reducedAudit.rafCalls === 0);
  check('reduced touch never paints perspective, crease or spin', reducedAudit.frames.length > 0
    && reducedAudit.frames.every((frame) => frame.clean && frame.stationary));
  check('reduced touch commits only the two signed steps', JSON.stringify(reducedAudit.commits) === '[1,0]');
  check('reduced touch announces only the two landings', reducedAudit.status.length === 2);
  check('reduced touch keeps integer depth and exactly three rendered rooms/images', reducedAudit.frames.every((frame) =>
    Number.isInteger(frame.depth) && frame.rooms === 3 && frame.images === 3));
  check('reduced touch respects synchronous three-room/image peaks', reducedAudit.writes > 0
    && reducedAudit.peakRooms === 3 && reducedAudit.peakImages === 3);
  check('reduced signed touch steps/cancellations restore the exact window and status', await fingerprint() === originFingerprint);

  // Both directions of the preference change while a touch owner is still held.
  for (const delta of [1, -1]) {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await pause();
    await touch('touchStart', [[x, y + delta * 50]]);
    await touch('touchMove', [[x, y - delta * 30]]);
    await pause(); // CDP may coalesce pointermove until the next browser frame.
    check(`reduce->normal ${delta}: starts with an owned, unpainted drag`, !(await snap()).idle
      && await page.locator('.room-current').evaluate((el) => el.style.transform === ''));
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await pause();
    await touch('touchMove', [[x, y - delta * 60]]);
    await pause();
    check(`reduce->normal ${delta}: live paint disables CSS interpolation`, await page.locator('.stage').evaluate((el) =>
      el.hasAttribute('data-fold-drag') && el.querySelector('.room-current').style.transform !== ''
      && getComputedStyle(el.querySelector('.room-current')).transitionDuration === '0s'));
    await touch('touchCancel', []);
    await landing(`reduce->normal ${delta}: cancelled return`, 0);
    await page.waitForTimeout(100);
    check(`reduce->normal ${delta}: no late commit`, await fingerprint() === originFingerprint);

    await touch('touchStart', [[x, y + delta * 50]]);
    await touch('touchMove', [[x, y - delta * 60]]);
    await pause();
    check(`normal->reduce ${delta}: starts with a live fold`, !(await snap()).idle
      && await page.locator('.stage').evaluate((el) => el.hasAttribute('data-fold-drag')));
    await page.emulateMedia({ reducedMotion: 'reduce' }); await pause();
    await landing(`normal->reduce ${delta}: aborts to origin`, 0);
    await touch('touchMove', [[x, y - delta * 90]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(200);
    check(`normal->reduce ${delta}: late touch cannot resume or commit`, await fingerprint() === originFingerprint);
  }
  check('no browser runtime errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks, errors,
    delivery: { touch: 'Chromium CDP mobile emulation (trusted pointer events), no physical device',
      mouseKeyboard: 'Playwright browser input; repeat/button-loss and rejected-pointer matrices are synthetic',
      wheel: 'synthetic unit/modifier/threshold supplement; native wheel bursts covered by verify-fold-drag.mjs' } }, null, 2));
} finally {
  await browser.close();
}
