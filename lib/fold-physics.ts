/**
 * Numerical contract for origami-like folding with momentum.
 *
 * Offsets are continuous rooms relative to a captured gesture origin; positive
 * means forward. Velocities use rooms/second and all times use seconds. The
 * controller owns pixels, pointer events, animation frames, and the integer
 * museum Position. Never pass a fractional offset to the room generator.
 *
 * Pure release planning and fixed-step simulation: no DOM, timers, or clock reads.
 * The caller supplies configuration; this module creates no runtime defaults.
 */

/** Raw normalized pointer sample, before visual drag resistance. */
export type FoldSample = {
  /** Finite monotonic event time in seconds, not milliseconds. */
  readonly timeSeconds: number;
  /** Signed raw displacement in rooms from the gesture origin. */
  readonly offsetRooms: number;
};

export type FoldInput =
  | {
      readonly kind: 'pointer';
      /** Signed visual displacement in rooms after drag resistance. */
      readonly offsetRooms: number;
      /** Signed release velocity in rooms/second, sampled from raw positions. */
      readonly velocityRoomsPerSecond: number;
    }
  | {
      readonly kind: 'step';
      /** One room backward (-1) or forward (+1); never enables spin. */
      readonly direction: -1 | 1;
    }
  | {
      readonly kind: 'cancel';
      /** Current visual displacement in rooms; settle to origin with no impulse. */
      readonly offsetRooms: number;
    };

/**
 * Immutable numerical tuning. Fields must be finite and satisfy the documented
 * constraints. This type creates no defaults.
 */
export type FoldConfig = {
  /** Positive recent-sample window in seconds. */
  readonly sampleWindowSeconds: number;
  /** Positive integer sample-buffer capacity; at least two for velocity. */
  readonly maxSamples: number;
  /** Positive symmetric speed limit in rooms/second. */
  readonly maxVelocityRoomsPerSecond: number;
  /** Positive exponential velocity-decay rate in inverse seconds. */
  readonly decayPerSecond: number;
  /** Maximum absolute integer destination delta per release. */
  readonly maxTravelRooms: 1 | 2 | 3;
  /** Positive release-speed threshold in rooms/second for multi-room travel. */
  readonly multiRoomVelocity: number;
  /** Positive displacement in rooms before visual resistance begins. */
  readonly dragLimitRooms: number;
  /** Positive additional resistant travel range in rooms. */
  readonly dragResistanceRooms: number;
  /** Positive speed threshold in rooms/second; spin requires exceeding it. */
  readonly spinVelocity: number;
  /** Full-strength spin speed in rooms/second; greater than spinVelocity. */
  readonly spinFullVelocity: number;
  /** Positive single-step impulse speed in rooms/second. */
  readonly stepVelocity: number;
  /** Positive speed in rooms/second at which coast hands off to the spring. */
  readonly coastExitVelocity: number;
  /** Positive maximum coast duration in seconds. */
  readonly coastMaxSeconds: number;
  /** Positive natural spring frequency in hertz (cycles/second). */
  readonly springFrequencyHz: number;
  /** Positive dimensionless normal damping ratio; 1 is critical damping. */
  readonly normalDampingRatio: number;
  /** Positive dimensionless hard-release damping ratio; below 1 allows overshoot. */
  readonly hardDampingRatio: number;
  /** Nonnegative visual travel beyond origin/release/target interval; below 0.5. */
  readonly maxVisualOvershootRooms: number;
  /** Positive allowed distance from target in rooms for natural completion. */
  readonly positionEpsilonRooms: number;
  /** Positive allowed speed in rooms/second; paired with position epsilon. */
  readonly velocityEpsilon: number;
  /** Positive total simulated seconds before exact safety finalization. */
  readonly maxReleaseSeconds: number;
};

/** Idle and dragging are controller states; only released motion is simulated. */
export type FoldPhase = 'coasting' | 'settling' | 'done';

/** Resolved once at release; its relative integer destination never changes. */
export type FoldReleasePlan = {
  /** Finite signed visual displacement in rooms at release. */
  readonly startOffsetRooms: number;
  /** Finite signed initial velocity in rooms/second, clamped by the resolver. */
  readonly initialVelocityRoomsPerSecond: number;
  /** Integer room delta from the captured origin, not an absolute world depth. */
  readonly targetDelta: -3 | -2 | -1 | 0 | 1 | 2 | 3;
  /** Dimensionless value in [0, 1]; zero for steps, cancellations, or no travel. */
  readonly spinStrength: number;
  /** Positive dimensionless damping ratio selected for this release. */
  readonly dampingRatio: number;
  readonly initialPhase: Exclude<FoldPhase, 'done'>;
};

/**
 * Constant-size simulation snapshot: no room descriptors or trajectory history.
 * A done state is absorbing, at the exact target with zero velocity.
 * Stepping consumes positive time steps no greater than 1/120 second.
 */
export type FoldState = {
  readonly plan: FoldReleasePlan;
  readonly phase: FoldPhase;
  /** Finite signed continuous displacement in rooms from the captured origin. */
  readonly offsetRooms: number;
  /** Finite signed instantaneous velocity in rooms/second. */
  readonly velocityRoomsPerSecond: number;
  /** Nonnegative simulated seconds since release. */
  readonly elapsedSeconds: number;
  /** Nonnegative simulated seconds in the current coast/settle phase. */
  readonly phaseSeconds: number;
};

/** Pure anchor coordinates; the controller generates exactly three room views. */
export type FoldWindow = {
  /** Integer rooms relative to origin, using symmetric half-away-from-zero rounding. */
  readonly anchorDelta: number;
  /** Continuous rooms minus anchorDelta, within [-0.5, 0.5]. */
  readonly localOffsetRooms: number;
};

function requirePositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

/**
 * Estimate release velocity from recent raw pointer samples with a least-squares
 * slope. A stationary sample is inferred at release time, so holding before
 * release cannot preserve stale flick energy. Invalid and out-of-order samples
 * are ignored; equal timestamps replace the prior value.
 */
export function estimateReleaseVelocity(
  samples: readonly FoldSample[],
  releaseTimeSeconds: number,
  config: FoldConfig,
): number {
  if (!Number.isFinite(releaseTimeSeconds)) {
    throw new RangeError('releaseTimeSeconds must be finite');
  }
  requirePositiveFinite('sampleWindowSeconds', config.sampleWindowSeconds);
  requirePositiveFinite('maxVelocityRoomsPerSecond', config.maxVelocityRoomsPerSecond);
  if (!Number.isInteger(config.maxSamples) || config.maxSamples < 2) {
    throw new RangeError('maxSamples must be an integer of at least 2');
  }

  const ordered: FoldSample[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.timeSeconds) || !Number.isFinite(sample.offsetRooms)) continue;
    if (sample.timeSeconds > releaseTimeSeconds) continue;
    const previous = ordered.at(-1);
    if (previous && sample.timeSeconds < previous.timeSeconds) continue;
    if (previous && sample.timeSeconds === previous.timeSeconds) {
      ordered[ordered.length - 1] = sample;
    } else {
      ordered.push(sample);
    }
  }

  const latest = ordered.at(-1);
  if (!latest) return 0;
  if (latest.timeSeconds < releaseTimeSeconds) {
    ordered.push({ timeSeconds: releaseTimeSeconds, offsetRooms: latest.offsetRooms });
  }

  const cutoff = releaseTimeSeconds - config.sampleWindowSeconds;
  const recent = ordered
    .filter((sample) => sample.timeSeconds >= cutoff)
    .slice(-config.maxSamples);
  if (recent.length < 2 || recent[0].timeSeconds === recent.at(-1)?.timeSeconds) return 0;

  const meanTime = recent.reduce((sum, sample) => sum + sample.timeSeconds, 0) / recent.length;
  const meanOffset = recent.reduce((sum, sample) => sum + sample.offsetRooms, 0) / recent.length;
  let covariance = 0;
  let timeVariance = 0;
  for (const sample of recent) {
    const centeredTime = sample.timeSeconds - meanTime;
    covariance += centeredTime * (sample.offsetRooms - meanOffset);
    timeVariance += centeredTime * centeredTime;
  }
  if (timeVariance === 0) return 0;

  const velocity = covariance / timeVariance;
  const limit = config.maxVelocityRoomsPerSecond;
  return Math.max(-limit, Math.min(limit, velocity));
}

/** Apply odd, asymptotic resistance after the direct one-room drag range. */
export function resistDrag(rawOffsetRooms: number, config: FoldConfig): number {
  if (!Number.isFinite(rawOffsetRooms)) {
    throw new RangeError('rawOffsetRooms must be finite');
  }
  requirePositiveFinite('dragLimitRooms', config.dragLimitRooms);
  requirePositiveFinite('dragResistanceRooms', config.dragResistanceRooms);

  const magnitude = Math.abs(rawOffsetRooms);
  if (magnitude <= config.dragLimitRooms) return rawOffsetRooms;
  const excess = magnitude - config.dragLimitRooms;
  const resisted = config.dragLimitRooms
    + config.dragResistanceRooms * (1 - Math.exp(-excess / config.dragResistanceRooms));
  return Math.sign(rawOffsetRooms) * resisted;
}

/** Return the asymptotic room offset of exponential velocity decay. */
export function projectCoast(
  offsetRooms: number,
  velocityRoomsPerSecond: number,
  decayPerSecond: number,
): number {
  if (!Number.isFinite(offsetRooms) || !Number.isFinite(velocityRoomsPerSecond)) {
    throw new RangeError('coast offset and velocity must be finite');
  }
  requirePositiveFinite('decayPerSecond', decayPerSecond);
  return offsetRooms + velocityRoomsPerSecond / decayPerSecond;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundHalfAwayFromZero(value: number): number {
  const magnitude = Math.abs(value);
  const whole = Math.floor(magnitude);
  // Compare the fraction directly so addition cannot round a value just below
  // a half-room boundary up to it. Exposed integer zero is always positive.
  const rounded = whole + (magnitude - whole >= 0.5 ? 1 : 0);
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}

function requireReleaseConfig(config: FoldConfig): void {
  requirePositiveFinite('maxVelocityRoomsPerSecond', config.maxVelocityRoomsPerSecond);
  requirePositiveFinite('decayPerSecond', config.decayPerSecond);
  requirePositiveFinite('multiRoomVelocity', config.multiRoomVelocity);
  requirePositiveFinite('spinVelocity', config.spinVelocity);
  requirePositiveFinite('spinFullVelocity', config.spinFullVelocity);
  requirePositiveFinite('stepVelocity', config.stepVelocity);
  requirePositiveFinite('coastExitVelocity', config.coastExitVelocity);
  requirePositiveFinite('normalDampingRatio', config.normalDampingRatio);
  requirePositiveFinite('hardDampingRatio', config.hardDampingRatio);
  if (!Number.isInteger(config.maxTravelRooms) || config.maxTravelRooms < 1 || config.maxTravelRooms > 3) {
    throw new RangeError('maxTravelRooms must be an integer from 1 through 3');
  }
  if (config.spinFullVelocity <= config.spinVelocity) {
    throw new RangeError('spinFullVelocity must be greater than spinVelocity');
  }
}

/** Resolve one immutable, sign-symmetric destination and release character. */
export function resolveRelease(input: FoldInput, config: FoldConfig): FoldReleasePlan {
  requireReleaseConfig(config);

  if (input.kind === 'step') {
    return {
      startOffsetRooms: 0,
      initialVelocityRoomsPerSecond: input.direction * config.stepVelocity,
      targetDelta: input.direction,
      spinStrength: 0,
      dampingRatio: config.normalDampingRatio,
      initialPhase: 'settling',
    };
  }

  if (!Number.isFinite(input.offsetRooms)) {
    throw new RangeError('offsetRooms must be finite');
  }
  if (input.kind === 'cancel') {
    return {
      startOffsetRooms: input.offsetRooms,
      initialVelocityRoomsPerSecond: 0,
      targetDelta: 0,
      spinStrength: 0,
      dampingRatio: config.normalDampingRatio,
      initialPhase: 'settling',
    };
  }
  if (!Number.isFinite(input.velocityRoomsPerSecond)) {
    throw new RangeError('velocityRoomsPerSecond must be finite');
  }

  const velocity = clamp(
    input.velocityRoomsPerSecond,
    -config.maxVelocityRoomsPerSecond,
    config.maxVelocityRoomsPerSecond,
  );
  const travelLimit = Math.abs(velocity) < config.multiRoomVelocity ? 1 : config.maxTravelRooms;
  const projected = projectCoast(input.offsetRooms, velocity, config.decayPerSecond);
  const targetDelta = clamp(roundHalfAwayFromZero(projected), -travelLimit, travelLimit) as
    FoldReleasePlan['targetDelta'];
  const speed = Math.abs(velocity);
  const spinStrength = targetDelta !== 0 && speed > config.spinVelocity
    ? clamp(
        (speed - config.spinVelocity) / (config.spinFullVelocity - config.spinVelocity),
        0,
        1,
      )
    : 0;
  const headsTowardTarget = velocity * (targetDelta - input.offsetRooms) > 0;

  return {
    startOffsetRooms: input.offsetRooms,
    initialVelocityRoomsPerSecond: velocity,
    targetDelta,
    spinStrength,
    dampingRatio: speed >= config.multiRoomVelocity
      ? config.hardDampingRatio
      : config.normalDampingRatio,
    initialPhase: speed > config.coastExitVelocity && headsTowardTarget
      ? 'coasting'
      : 'settling',
  };
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requireFoldPlan(plan: FoldReleasePlan): void {
  requireFinite('startOffsetRooms', plan.startOffsetRooms);
  requireFinite('initialVelocityRoomsPerSecond', plan.initialVelocityRoomsPerSecond);
  requirePositiveFinite('dampingRatio', plan.dampingRatio);
  if (!Number.isInteger(plan.targetDelta) || Math.abs(plan.targetDelta) > 3) {
    throw new RangeError('targetDelta must be an integer from -3 through 3');
  }
  if (!Number.isFinite(plan.spinStrength) || plan.spinStrength < 0 || plan.spinStrength > 1) {
    throw new RangeError('spinStrength must be between 0 and 1');
  }
  if (plan.initialPhase !== 'coasting' && plan.initialPhase !== 'settling') {
    throw new RangeError('initialPhase must be coasting or settling');
  }
}

/** Capture the resolved plan without retaining a caller-mutable plan object. */
export function startFold(plan: FoldReleasePlan): FoldState {
  requireFoldPlan(plan);
  const capturedPlan = Object.freeze({ ...plan, targetDelta: plan.targetDelta === 0 ? 0 : plan.targetDelta });
  return {
    plan: capturedPlan,
    phase: capturedPlan.initialPhase,
    offsetRooms: capturedPlan.startOffsetRooms,
    velocityRoomsPerSecond: capturedPlan.initialVelocityRoomsPerSecond,
    elapsedSeconds: 0,
    phaseSeconds: 0,
  };
}

/**
 * Advance at most 1/120 simulated second. The controller supplies fixed substeps,
 * carrying its frame-time remainder; no frame-rate-dependent decay is used here.
 * A phase change takes effect on the next substep, preserving coast momentum.
 */
export function stepFold(state: FoldState, dtSeconds: number, config: FoldConfig): FoldState {
  requirePositiveFinite('dtSeconds', dtSeconds);
  if (dtSeconds > 1 / 120) throw new RangeError('dtSeconds must not exceed 1/120 second');
  requireFoldPlan(state.plan);
  requireFinite('offsetRooms', state.offsetRooms);
  requireFinite('velocityRoomsPerSecond', state.velocityRoomsPerSecond);
  requireFinite('elapsedSeconds', state.elapsedSeconds);
  requireFinite('phaseSeconds', state.phaseSeconds);
  if (state.elapsedSeconds < 0 || state.phaseSeconds < 0 || state.phaseSeconds > state.elapsedSeconds) {
    throw new RangeError('phase times must satisfy 0 <= phaseSeconds <= elapsedSeconds');
  }
  if (state.phase !== 'coasting' && state.phase !== 'settling' && state.phase !== 'done') {
    throw new RangeError('invalid fold phase');
  }
  requirePositiveFinite('decayPerSecond', config.decayPerSecond);
  requirePositiveFinite('coastExitVelocity', config.coastExitVelocity);
  requirePositiveFinite('coastMaxSeconds', config.coastMaxSeconds);
  requirePositiveFinite('springFrequencyHz', config.springFrequencyHz);
  requirePositiveFinite('positionEpsilonRooms', config.positionEpsilonRooms);
  requirePositiveFinite('velocityEpsilon', config.velocityEpsilon);
  requirePositiveFinite('maxReleaseSeconds', config.maxReleaseSeconds);
  if (!Number.isFinite(config.maxVisualOvershootRooms)
      || config.maxVisualOvershootRooms < 0 || config.maxVisualOvershootRooms >= 0.5) {
    throw new RangeError('maxVisualOvershootRooms must be finite and in [0, 0.5)');
  }
  if (state.phase === 'done') {
    if (state.offsetRooms !== state.plan.targetDelta || state.velocityRoomsPerSecond !== 0) {
      throw new RangeError('done state must be exactly at its target with zero velocity');
    }
    return state;
  }

  const target = state.plan.targetDelta;
  const elapsedSeconds = state.elapsedSeconds + dtSeconds;
  let phaseSeconds = state.phaseSeconds + dtSeconds;
  let phase: FoldPhase = state.phase;
  let offset = state.offsetRooms;
  let velocity = state.velocityRoomsPerSecond;

  if (phase === 'coasting') {
    const decayedVelocity = velocity * Math.exp(-config.decayPerSecond * dtSeconds);
    offset += (velocity - decayedVelocity) / config.decayPerSecond;
    velocity = decayedVelocity;
    const reachedTarget = (state.offsetRooms <= target && offset >= target)
      || (state.offsetRooms >= target && offset <= target);
    if (reachedTarget || Math.abs(velocity) <= config.coastExitVelocity
        || phaseSeconds >= config.coastMaxSeconds) {
      phase = 'settling';
      phaseSeconds = 0;
    }
  } else {
    const omega = 2 * Math.PI * config.springFrequencyHz;
    const acceleration = -omega * omega * (offset - target)
      - 2 * state.plan.dampingRatio * omega * velocity;
    velocity += acceleration * dtSeconds;
    offset += velocity * dtSeconds; // Semi-implicit Euler: updated velocity.
  }

  // Reject arithmetic overflow before a clamp could disguise an invalid state.
  requireFinite('stepped offset', offset);
  requireFinite('stepped velocity', velocity);
  requireFinite('elapsedSeconds', elapsedSeconds);
  requireFinite('phaseSeconds', phaseSeconds);
  const lower = Math.min(0, state.plan.startOffsetRooms, target) - config.maxVisualOvershootRooms;
  const upper = Math.max(0, state.plan.startOffsetRooms, target) + config.maxVisualOvershootRooms;
  requireFinite('lower visual bound', lower);
  requireFinite('upper visual bound', upper);
  if (offset <= lower || offset >= upper) {
    if ((offset <= lower && velocity < 0) || (offset >= upper && velocity > 0)) velocity = 0;
    offset = clamp(offset, lower, upper);
    if (phase === 'coasting') phaseSeconds = 0;
    phase = 'settling';
  }

  if ((Math.abs(offset - target) <= config.positionEpsilonRooms
       && Math.abs(velocity) <= config.velocityEpsilon)
      || elapsedSeconds >= config.maxReleaseSeconds) {
    offset = target === 0 ? 0 : target;
    velocity = 0;
    phase = 'done';
    phaseSeconds = 0;
  }
  return {
    plan: state.plan,
    phase,
    offsetRooms: offset,
    velocityRoomsPerSecond: velocity,
    elapsedSeconds,
    phaseSeconds,
  };
}

/** Integer visual anchor only; the controller owns the bounded three-room window. */
export function getFoldWindow(offsetRooms: number): FoldWindow {
  requireFinite('offsetRooms', offsetRooms);
  const anchorDelta = roundHalfAwayFromZero(offsetRooms);
  return { anchorDelta, localOffsetRooms: offsetRooms - anchorDelta || 0 };
}
