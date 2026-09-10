// Pure, dependency-free checks. Run: node --experimental-strip-types scripts/verify-fold-physics.mjs
import assert from 'node:assert/strict';
import {
  resolveRelease, startFold, stepFold, getFoldWindow,
} from '../lib/fold-physics.ts';

const h = 1 / 120;
const config = Object.freeze({
  sampleWindowSeconds: 0.1, maxSamples: 16,
  maxVelocityRoomsPerSecond: 8, decayPerSecond: 4.5,
  maxTravelRooms: 3, multiRoomVelocity: 3,
  dragLimitRooms: 1, dragResistanceRooms: 0.15,
  spinVelocity: 5.5, spinFullVelocity: 8, stepVelocity: 1.5,
  coastExitVelocity: 0.35, coastMaxSeconds: 0.32,
  springFrequencyHz: 3, normalDampingRatio: 1, hardDampingRatio: 0.82,
  maxVisualOvershootRooms: 0.18, positionEpsilonRooms: 0.001,
  velocityEpsilon: 0.01, maxReleaseSeconds: 2,
});
const pointer = (x, v) => ({ kind: 'pointer', offsetRooms: x, velocityRoomsPerSecond: v });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12,
  `${actual} != ${expected}`);

function invariant(state, plan, tuning = config) {
  assert.deepEqual(state.plan, plan);
  for (const key of ['offsetRooms', 'velocityRoomsPerSecond', 'elapsedSeconds', 'phaseSeconds']) {
    assert.ok(Number.isFinite(state[key]), key);
  }
  assert.ok(state.elapsedSeconds >= 0 && state.phaseSeconds >= 0);
  assert.ok(state.phaseSeconds <= state.elapsedSeconds);
  const lower = Math.min(0, plan.startOffsetRooms, plan.targetDelta) - tuning.maxVisualOvershootRooms;
  const upper = Math.max(0, plan.startOffsetRooms, plan.targetDelta) + tuning.maxVisualOvershootRooms;
  assert.ok(state.offsetRooms >= lower && state.offsetRooms <= upper, 'visual bounds');
  const window = getFoldWindow(state.offsetRooms);
  assert.ok(Number.isInteger(window.anchorDelta));
  assert.ok(!Object.is(window.anchorDelta, -0));
  assert.ok(Math.abs(window.localOffsetRooms) <= 0.5);
  close(window.anchorDelta + window.localOffsetRooms, state.offsetRooms);
  if (state.phase === 'done') {
    assert.equal(state.offsetRooms, plan.targetDelta);
    assert.equal(state.velocityRoomsPerSecond, 0);
    assert.ok(Number.isInteger(state.offsetRooms));
    assert.ok(!Object.is(state.offsetRooms, -0));
  }
}

// Simulate the future controller's bounded accumulator; no RAF, DOM, or timers.
function simulate(plan, hz = 120, tuning = config) {
  let state = startFold(Object.freeze(plan));
  let accumulator = 0;
  let steps = 0;
  let peak = Math.abs(state.offsetRooms);
  invariant(state, plan, tuning);
  for (let frame = 0; frame < hz * 4 && state.phase !== 'done'; frame++) {
    accumulator = Math.min(accumulator + 1 / hz, 0.05);
    let substeps = 0;
    while (accumulator + 1e-12 >= h && substeps < 6 && state.phase !== 'done') {
      const previous = Object.freeze(state);
      state = stepFold(previous, h, tuning);
      assert.notEqual(state, previous);
      assert.ok(state.elapsedSeconds > previous.elapsedSeconds);
      invariant(state, plan, tuning);
      peak = Math.max(peak, Math.abs(state.offsetRooms));
      accumulator = Math.max(0, accumulator - h);
      substeps++;
      steps++;
    }
  }
  assert.equal(state.phase, 'done', 'must finish');
  assert.ok(state.elapsedSeconds <= tuning.maxReleaseSeconds + h);
  for (let i = 0; i < 10; i++) assert.equal(stepFold(state, h, tuning), state, 'absorbing done');
  return { state, steps, peak };
}

const cases = [
  ['slow return', pointer(0.2, 0), 0],
  ['slow forward', pointer(0.6, 0), 1],
  ['slow backward', pointer(-0.6, 0), -1],
  ['fast forward', pointer(0.65, 5), 2],
  ['fast backward', pointer(-0.65, -5), -2],
  ['hard forward', pointer(1, 8), 3],
  ['hard backward', pointer(-1, -8), -3],
  ['zero-target moving', pointer(-0.2, 0.5), 0],
  ['zero-target still', pointer(0, 0), 0],
  ['cancel forward', { kind: 'cancel', offsetRooms: 1.12 }, 0],
  ['cancel backward', { kind: 'cancel', offsetRooms: -1.12 }, 0],
  ['step forward', { kind: 'step', direction: 1 }, 1],
  ['step backward', { kind: 'step', direction: -1 }, -1],
];
for (const [name, input, target] of cases) {
  const plan = resolveRelease(input, config);
  assert.equal(plan.targetDelta, target, name);
  const reference = simulate(plan);
  assert.ok(reference.state.elapsedSeconds < config.maxReleaseSeconds, 'natural settle, not safety timeout');
  for (const hz of [30, 60]) assert.deepEqual(simulate(plan, hz), reference, name + ' schedule');
  console.log(`PASS ${name}: target ${target}, ${reference.steps} fixed steps; 30/60/120Hz identical`);
}

// Matched opposite inputs restore integer depth, including half ties and zero.
for (const x of [0, 0.2, 0.5, 0.65, 1, 1.14]) {
  for (const v of [-8, -5, -3, -0.5, 0, 0.5, 3, 5, 8]) {
    const plan = resolveRelease(pointer(x, v), config);
    const mirror = resolveRelease(pointer(-x, -v), config);
    assert.equal(mirror.targetDelta, -plan.targetDelta || 0);
    const forward = simulate(plan);
    const backward = simulate(mirror);
    assert.equal(forward.state.offsetRooms + backward.state.offsetRooms, 0);
    assert.equal(forward.steps, backward.steps);
    const originDepth = -37;
    assert.equal(originDepth + forward.state.offsetRooms + backward.state.offsetRooms, originDepth);
  }
}
for (const [x, expected] of [[0, 0], [-0, 0], [0.2, 0], [-0.2, 0],
  [0.49999999999999994, 0], [-0.49999999999999994, 0],
  [0.5, 1], [-0.5, -1], [1.5, 2], [-1.5, -2], [3.18, 3], [-3.18, -3]]) {
  const window = getFoldWindow(x);
  assert.equal(window.anchorDelta, expected);
  assert.ok(Math.abs(window.localOffsetRooms) <= 0.5);
}

// Exact coast law and momentum-preserving handoff (no spring in the same step).
const coast = startFold(resolveRelease(pointer(0.65, 5), config));
assert.equal(coast.phase, 'coasting');
const coastStep = stepFold(coast, h, config);
const expectedV = 5 * Math.exp(-config.decayPerSecond * h);
close(coastStep.velocityRoomsPerSecond, expectedV);
close(coastStep.offsetRooms, 0.65 + (5 - expectedV) / config.decayPerSecond);
assert.equal(coastStep.phase, 'coasting');
for (const tuning of [{ ...config, coastMaxSeconds: h }, { ...config, coastExitVelocity: 5 }]) {
  const transition = stepFold(coast, h, tuning);
  assert.equal(transition.phase, 'settling');
  assert.equal(transition.phaseSeconds, 0);
  close(transition.velocityRoomsPerSecond, coastStep.velocityRoomsPerSecond);
  close(transition.offsetRooms, coastStep.offsetRooms);
}
const crossing = stepFold({ ...coast, offsetRooms: 1.99 }, h, config);
assert.equal(crossing.phase, 'settling');
assert.ok(crossing.offsetRooms > coast.plan.targetDelta);
close(crossing.velocityRoomsPerSecond, expectedV);

// Semi-implicit spring uses the release's selected damping, not a fresh default.
const spring = startFold(resolveRelease({ kind: 'step', direction: 1 }, config));
const omega = 2 * Math.PI * config.springFrequencyHz;
const springV = 1.5 + (omega * omega - 2 * omega * 1.5) * h;
const springStep = stepFold(spring, h, config);
close(springStep.velocityRoomsPerSecond, springV);
close(springStep.offsetRooms, springV * h);

// Both sides of the visual bound, exact contact, and inward momentum preservation.
for (const sign of [-1, 1]) {
  const plan = resolveRelease(pointer(sign, sign * 8), { ...config, maxTravelRooms: 1 });
  const bounded = simulate(plan);
  assert.ok(bounded.peak <= 1.18);
  const state = startFold(plan);
  const bound = sign * 1.18;
  const contact = stepFold({ ...state, phase: 'coasting', offsetRooms: bound, velocityRoomsPerSecond: 0 }, h, config);
  assert.equal(contact.phase, 'settling');
  assert.equal(contact.offsetRooms, bound);
  const outward = stepFold({ ...state, phase: 'coasting', offsetRooms: bound, velocityRoomsPerSecond: sign * 8 }, h, config);
  assert.equal(outward.phase, 'settling');
  assert.equal(outward.offsetRooms, bound);
  assert.equal(outward.velocityRoomsPerSecond, 0);
  // An externally supplied out-of-bound snapshot is clamped without cancelling inward motion.
  const inward = stepFold({ ...state, phase: 'coasting', offsetRooms: sign * 1.3, velocityRoomsPerSecond: -sign }, h, config);
  assert.equal(inward.phase, 'settling');
  assert.equal(inward.offsetRooms, bound);
  close(inward.velocityRoomsPerSecond, -sign * Math.exp(-config.decayPerSecond * h));
}

// Position alone or velocity alone must not end a release.
assert.notEqual(stepFold({ ...spring, offsetRooms: 1, velocityRoomsPerSecond: 1 }, h / 100, config).phase, 'done');
assert.notEqual(stepFold({ ...spring, offsetRooms: 0.8, velocityRoomsPerSecond: 0 }, h / 100, config).phase, 'done');
const timedOut = stepFold(spring, h, { ...config, maxReleaseSeconds: h });
assert.equal(timedOut.phase, 'done');
assert.equal(timedOut.offsetRooms, 1);
assert.equal(timedOut.velocityRoomsPerSecond, 0);
assert.equal(stepFold(timedOut, h, config), timedOut);

// Validate input snapshots/configuration rather than returning NaN or Infinity.
for (const dt of [0, -h, NaN, Infinity, h * 2]) {
  assert.throws(() => stepFold(spring, dt, config), RangeError);
}
for (const x of [NaN, Infinity, -Infinity]) {
  assert.throws(() => getFoldWindow(x), RangeError);
  assert.throws(() => startFold({ ...spring.plan, startOffsetRooms: x }), RangeError);
  assert.throws(() => stepFold({ ...spring, velocityRoomsPerSecond: x }, h, config), RangeError);
}
for (const key of ['decayPerSecond', 'coastExitVelocity', 'coastMaxSeconds',
  'springFrequencyHz', 'positionEpsilonRooms', 'velocityEpsilon', 'maxReleaseSeconds']) {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => stepFold(spring, h, { ...config, [key]: value }), RangeError);
  }
}
for (const value of [-1, 0.5, NaN, Infinity]) {
  assert.throws(() => stepFold(spring, h, { ...config, maxVisualOvershootRooms: value }), RangeError);
}
assert.throws(() => startFold({ ...spring.plan, targetDelta: 0.5 }), RangeError);
assert.throws(() => stepFold({ ...spring, phaseSeconds: 1 }, h, config), RangeError);
assert.throws(() => stepFold({ ...spring, phase: 'done' }, h, config), RangeError);
assert.throws(() => stepFold(spring, h, { ...config, springFrequencyHz: Number.MAX_VALUE }), RangeError);
const mutablePlan = { ...spring.plan };
const captured = startFold(mutablePlan);
mutablePlan.targetDelta = -1;
assert.equal(captured.plan.targetDelta, 1);
assert.ok(Object.isFrozen(captured.plan));
console.log('PASS symmetry, finite states, exact completion, absorbing done, windows, coast/spring, bounds, timeout, and validation');
