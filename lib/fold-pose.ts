import type { FoldState } from './fold-physics';

/** Render-only crease in degrees; displacement is continuous rooms past this room. */
export function getFoldCrease(displacementRooms: number): number {
  if (!Number.isFinite(displacementRooms)) throw new RangeError('Fold displacement must be finite');
  // Clamp before trigonometry: distant/invisible rooms stay exactly in their idle pose.
  const distance = Math.min(1, Math.abs(displacementRooms));
  if (distance === 0 || distance === 1) return 0;
  // Odd, bounded C1 lobe: zero value/slope at center and both support edges.
  const wave = Math.sin(Math.PI * distance);
  return Math.sign(displacementRooms) * Math.min(32, 32 * wave * wave);
}

/** Signed release flourish from the already-resolved plan; no new clock or target. */
export function getFoldSpin(state: FoldState): number {
  const { plan, offsetRooms, phase } = state;
  const travel = plan.targetDelta - plan.startOffsetRooms;
  if (phase === 'done' || plan.spinStrength === 0 || plan.targetDelta === 0 || travel === 0) return 0;
  const progress = (offsetRooms - plan.startOffsetRooms) / travel;
  // Endpoint branches keep release/landing/overshoot exactly spin-free.
  if (progress <= 0 || progress >= 1) return 0;
  const wave = Math.sin(Math.PI * progress);
  return Math.sign(plan.initialVelocityRoomsPerSecond) * Math.min(90, 90 * plan.spinStrength * wave * wave);
}

/** Only rooms within one room of the moving fold carry the flourish. */
export function getFoldSpinWeight(displacementRooms: number): number {
  if (!Number.isFinite(displacementRooms)) throw new RangeError('Fold displacement must be finite');
  const distance = Math.min(1, Math.abs(displacementRooms));
  if (distance === 1) return 0;
  const wave = Math.cos(Math.PI * distance / 2);
  return wave * wave;
}
