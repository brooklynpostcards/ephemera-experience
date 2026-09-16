// Pure, dependency-free checks. Run: node --experimental-strip-types scripts/verify-fold-physics.mjs
import assert from 'node:assert/strict';
import { getFoldCrease, getFoldSpin, getFoldSpinWeight } from '../lib/fold-pose.ts';
import {
  captureReleaseVelocity, resolveRelease, startFold, stepFold, getFoldWindow,
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

// Room-relative crease: signed travel, bounded extremes, and exact idle at every integer.
for (const d of [NaN, Infinity, -Infinity]) assert.throws(() => getFoldCrease(d), RangeError);
for (const d of [-Number.MAX_VALUE, -3, -2, -1, -0, 0, 1, 2, 3, Number.MAX_VALUE]) {
  assert.equal(getFoldCrease(d), 0);
  assert.ok(!Object.is(getFoldCrease(d), -0));
}
close(getFoldCrease(0.5), 32);
close(getFoldCrease(-0.5), -32);
for (let i = -320; i <= 320; i++) {
  const x = i / 100;
  const { anchorDelta } = getFoldWindow(x);
  for (const roomDelta of [anchorDelta - 1, anchorDelta, anchorDelta + 1]) {
    const d = x - roomDelta;
    const crease = getFoldCrease(d);
    assert.ok(Number.isFinite(crease) && Math.abs(crease) <= 32);
    close(getFoldCrease(-d), -crease);
    for (const handedness of [-1, 1]) {
      assert.ok(-40 + handedness * crease >= -72 && -40 + handedness * crease <= -8);
      assert.ok(40 + handedness * crease >= 8 && 40 + handedness * crease <= 72);
    }
  }
}
// Retained absolute room depths have no discontinuity at any signed half-room rebase.
for (const boundary of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) {
  const before = getFoldWindow(boundary - 1e-7).anchorDelta;
  const after = getFoldWindow(boundary + 1e-7).anchorDelta;
  assert.notEqual(before, after);
  for (const roomDelta of [before - 1, before, before + 1]) {
    if (Math.abs(roomDelta - after) <= 1) {
      assert.ok(Math.abs(getFoldCrease(boundary - 1e-7 - roomDelta)
        - getFoldCrease(boundary + 1e-7 - roomDelta)) < 1e-4);
    }
  }
}
for (const endpoint of [-1, 0, 1]) {
  assert.ok(Math.abs(getFoldCrease(endpoint - 1e-6)) < 4e-10);
  assert.ok(Math.abs(getFoldCrease(endpoint + 1e-6)) < 4e-10);
}

// Spin uses captured eligibility; exact threshold, zero targets, step/cancel never earn it.
for (const sign of [-1, 1]) {
  for (const speed of [0, 5.4999, 5.5, 5.5001, 6.5, 8]) {
    const plan = resolveRelease(pointer(sign * 0.65, sign * speed), config);
    close(plan.spinStrength, Math.max(0, (speed - 5.5) / 2.5));
    const initial = startFold(plan);
    const middle = { ...initial, offsetRooms: (plan.startOffsetRooms + plan.targetDelta) / 2 };
    assert.equal(getFoldSpin(initial), 0);
    close(getFoldSpin(middle), sign * 90 * plan.spinStrength);
    assert.equal(getFoldSpin({ ...middle, phase: 'done' }), 0);
    for (const q of [-0.1, 0, 1, 1.1]) {
      assert.equal(getFoldSpin({ ...initial,
        offsetRooms: plan.startOffsetRooms + q * (plan.targetDelta - plan.startOffsetRooms) }), 0);
    }
    for (const q of [1e-6, 1 - 1e-6]) {
      assert.ok(Math.abs(getFoldSpin({ ...initial,
        offsetRooms: plan.startOffsetRooms + q * (plan.targetDelta - plan.startOffsetRooms) })) < 1e-8);
    }
  }
  for (const input of [{ kind: 'step', direction: sign }, { kind: 'cancel', offsetRooms: sign },
    pointer(-sign * 1.1, sign * 5.6)]) {
    const plan = resolveRelease(input, config);
    assert.equal(plan.spinStrength, 0);
    assert.equal(getFoldSpin({ ...startFold(plan), offsetRooms: 0.4 }), 0);
  }
  const noTravel = startFold(resolveRelease(pointer(sign * 3, sign * 8), config));
  assert.equal(getFoldSpin(noTravel), 0);
}
for (const d of [-Number.MAX_VALUE, -1, 1, Number.MAX_VALUE]) assert.equal(getFoldSpinWeight(d), 0);
for (const d of [NaN, Infinity, -Infinity]) assert.throws(() => getFoldSpinWeight(d), RangeError);
assert.equal(getFoldSpinWeight(0), 1);
for (let i = -320; i <= 320; i++) {
  const d = i / 100;
  const weight = getFoldSpinWeight(d);
  assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
  close(weight, getFoldSpinWeight(-d));
  for (const sign of [-1, 1]) {
    const crease = getFoldCrease(d) * sign;
    const spin = 90 * sign * weight;
    assert.ok(-40 + crease + spin >= -162 && -40 + crease + spin <= 82);
    assert.ok(40 + crease + spin >= -82 && 40 + crease + spin <= 162);
  }
}
// Spin-bearing retained leaves also stay continuous at signed integer-window rebases.
for (const sign of [-1, 1]) {
  for (const start of [0.65, 1]) {
    const initial = startFold(resolveRelease(pointer(sign * start, sign * 8), config));
    for (const boundary of [sign * 0.5, sign * 1.5, sign * 2.5]) {
      const lower = boundary - 1e-7, upper = boundary + 1e-7;
      const beforeAnchor = getFoldWindow(lower).anchorDelta;
      const afterAnchor = getFoldWindow(upper).anchorDelta;
      for (const roomDelta of [beforeAnchor - 1, beforeAnchor, beforeAnchor + 1]) {
        if (Math.abs(roomDelta - afterAnchor) > 1) continue;
        const angle = (x, handedness) => getFoldCrease(x - roomDelta) * handedness
          + getFoldSpin({ ...initial, offsetRooms: x }) * handedness * getFoldSpinWeight(x - roomDelta);
        for (const handedness of [-1, 1]) {
          assert.ok(Math.abs(angle(lower, handedness) - angle(upper, handedness)) < 0.001);
        }
      }
    }
  }
}
console.log('PASS captured spin threshold, signed envelope, exact endpoints, moving-leaf support and bounds');

// Pointer-up owns the final raw sample; normalization is bounded, immutable, and symmetric.
const forwardCapture = captureReleaseVelocity([
  { timeSeconds: 1, offsetRooms: 0 },
  { timeSeconds: 1.04, offsetRooms: 0.2 },
], { timeSeconds: 1.05, offsetRooms: 0.3 }, config);
const backwardCapture = captureReleaseVelocity([
  { timeSeconds: 1, offsetRooms: 0 },
  { timeSeconds: 1.04, offsetRooms: -0.2 },
], { timeSeconds: 1.05, offsetRooms: -0.3 }, config);
assert.ok(forwardCapture.velocityRoomsPerSecond > 0);
close(backwardCapture.velocityRoomsPerSecond, -forwardCapture.velocityRoomsPerSecond);
assert.ok(Number.isFinite(forwardCapture.velocityRoomsPerSecond));
assert.ok(Object.isFrozen(forwardCapture) && Object.isFrozen(forwardCapture.samples));
const heldCapture = captureReleaseVelocity([
  { timeSeconds: 1, offsetRooms: 0 },
  { timeSeconds: 1.04, offsetRooms: 0.4 },
], { timeSeconds: 1.2, offsetRooms: 0.4 }, config);
assert.equal(heldCapture.velocityRoomsPerSecond, 0);
assert.deepEqual(heldCapture.samples, [{ timeSeconds: 1.2, offsetRooms: 0.4 }]);
const duplicateCapture = captureReleaseVelocity([
  { timeSeconds: 1, offsetRooms: 0 },
  { timeSeconds: 1.05, offsetRooms: 100 },
  { timeSeconds: 1.05, offsetRooms: 200 },
  { timeSeconds: NaN, offsetRooms: Infinity },
], { timeSeconds: 1.05, offsetRooms: 0.5 }, { ...config, maxVelocityRoomsPerSecond: 4 });
assert.equal(duplicateCapture.samples.length, 2);
assert.deepEqual(duplicateCapture.samples.at(-1), { timeSeconds: 1.05, offsetRooms: 0.5 });
assert.equal(duplicateCapture.velocityRoomsPerSecond, 4);
const crowdedCapture = captureReleaseVelocity(
  Array.from({ length: 30 }, (_, index) => ({
    timeSeconds: 2 + index / 1000,
    offsetRooms: index / 100,
  })),
  { timeSeconds: 2.03, offsetRooms: 0.3 },
  config,
);
assert.equal(crowdedCapture.samples.length, config.maxSamples);
assert.deepEqual(crowdedCapture.samples.at(-1), { timeSeconds: 2.03, offsetRooms: 0.3 });
for (const releaseSample of [
  { timeSeconds: NaN, offsetRooms: 0 },
  { timeSeconds: 1, offsetRooms: Infinity },
]) {
  assert.throws(() => captureReleaseVelocity([], releaseSample, config), RangeError);
}
console.log('PASS bounded pointer-up velocity capture: fresh, held, symmetric, duplicate, finite');

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
  for (const roomDelta of [window.anchorDelta - 1, window.anchorDelta, window.anchorDelta + 1]) {
    const crease = getFoldCrease(state.offsetRooms - roomDelta);
    const spin = getFoldSpin(state) * getFoldSpinWeight(state.offsetRooms - roomDelta);
    assert.ok(Number.isFinite(spin) && Math.abs(spin) <= 90);
    if (state.phase === 'done' || plan.spinStrength === 0) assert.equal(spin, 0);
    assert.ok(Number.isFinite(crease) && Math.abs(crease) <= 32);
    if (state.phase === 'done') assert.equal(crease, 0, 'all completed leaves are exactly idle');
  }
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
  if (typeof name !== 'string' || typeof target !== 'number') {
    throw new TypeError('invalid release test case');
  }
  const plan = resolveRelease(input, config);
  assert.equal(plan.targetDelta, target, name);
  const reference = simulate(plan);
  assert.ok(reference.state.elapsedSeconds < config.maxReleaseSeconds, 'natural settle, not safety timeout');
  for (const hz of [30, 60]) assert.deepEqual(simulate(plan, hz), reference, name + ' schedule');
  console.log(`PASS ${name}: target ${target}, ${reference.steps} fixed steps; 30/60/120Hz identical`);
}

// The threshold changes the allowed target range, not the projected-distance law.
for (const sign of [-1, 1]) {
  assert.equal(resolveRelease(pointer(sign, sign * (config.multiRoomVelocity - 0.001)), config).targetDelta, sign);
  assert.equal(resolveRelease(pointer(sign, sign * config.multiRoomVelocity), config).targetDelta, sign * 2);
  assert.equal(resolveRelease(pointer(sign, sign * config.maxVelocityRoomsPerSecond),
    { ...config, maxTravelRooms: 2 }).targetDelta, sign * 2);
  assert.equal(resolveRelease(pointer(sign, sign * config.maxVelocityRoomsPerSecond), config).targetDelta, sign * 3);
}
console.log('PASS explicit multi-room threshold and symmetric two/three-room caps');

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

// Hard releases keep their captured damping through the coast-to-spring boundary.
// Check the entire mirrored trajectory as well as an actual overshoot and return.
for (const [offset, velocity] of [[0.65, 5], [1, 8]]) {
  const plan = resolveRelease(pointer(offset, velocity), config);
  assert.equal(plan.dampingRatio, config.hardDampingRatio);
  let forward = startFold(plan);
  let reverse = startFold(resolveRelease(pointer(-offset, -velocity), config));
  let checkedSpring = false, overshoot = 0;
  for (let step = 0; step < 240 && forward.phase !== 'done'; step++) {
    const previous = forward;
    forward = stepFold(forward, h, config);
    reverse = stepFold(reverse, h, config);
    invariant(forward, plan, config);
    close(forward.offsetRooms, -reverse.offsetRooms);
    close(getFoldSpin(forward), -getFoldSpin(reverse));
    if (forward.offsetRooms >= plan.targetDelta) assert.equal(getFoldSpin(forward), 0);
    close(forward.velocityRoomsPerSecond, -reverse.velocityRoomsPerSecond);
    assert.equal(forward.phase, reverse.phase);
    assert.equal(forward.elapsedSeconds, reverse.elapsedSeconds);
    assert.equal(forward.phaseSeconds, reverse.phaseSeconds);
    if (previous.phase === 'settling' && !checkedSpring) {
      const velocityAfterSpring = previous.velocityRoomsPerSecond
        + (-omega * omega * (previous.offsetRooms - plan.targetDelta)
          - 2 * plan.dampingRatio * omega * previous.velocityRoomsPerSecond) * h;
      close(forward.velocityRoomsPerSecond, velocityAfterSpring);
      close(forward.offsetRooms, previous.offsetRooms + velocityAfterSpring * h);
      checkedSpring = true;
    }
    overshoot = Math.max(overshoot, forward.offsetRooms - plan.targetDelta);
  }
  assert.ok(checkedSpring, 'must traverse the coast-to-spring boundary');
  assert.ok(overshoot > 0 && overshoot <= config.maxVisualOvershootRooms,
    'hard release overshoots within its visual bound');
  assert.equal(forward.phase, 'done');
  assert.equal(forward.offsetRooms, plan.targetDelta);
  assert.equal(forward.velocityRoomsPerSecond, 0);
  assert.ok(forward.elapsedSeconds < config.maxReleaseSeconds, 'spring finishes naturally');
}
console.log('PASS hard-release damping, mirrored settle trajectories, bounded overshoot and natural return');

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
