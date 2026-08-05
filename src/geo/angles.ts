/**
 * Compass angles live on a circle, so every operation on them has to handle the
 * 359° → 0° seam. Doing it in one place is the difference between a marker that
 * rotates the short way round a corner and one that spins 359° backwards.
 */

/** Fold any angle into `[0, 360)`. */
export function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Shortest signed rotation from `from` to `to`, in `(-180, 180]`.
 *
 * Positive is clockwise (to the right). `shortestDeltaDeg(350, 10)` is `+20`,
 * not `-340`.
 */
export function shortestDeltaDeg(from: number, to: number): number {
  const delta = normalizeDeg(to) - normalizeDeg(from);
  if (delta > 180) return delta - 360;
  if (delta <= -180) return delta + 360;
  return delta;
}

/** Absolute angular separation, `0..180`. */
export function angularDistanceDeg(a: number, b: number): number {
  return Math.abs(shortestDeltaDeg(a, b));
}

/**
 * Step from `current` toward `target` by at most `maxStepDeg`, the short way.
 *
 * Used to rate-limit heading animation: a compass can jump 90° between two
 * samples, and following that jump literally makes the map snap. Capping the
 * per-frame step turns it into a rotation the eye can track.
 */
export function stepTowardDeg(current: number, target: number, maxStepDeg: number): number {
  const delta = shortestDeltaDeg(current, target);
  if (Math.abs(delta) <= maxStepDeg) return normalizeDeg(target);
  return normalizeDeg(current + Math.sign(delta) * maxStepDeg);
}

/** A heading is usable only if it is a finite, non-negative number. */
export function isValidHeading(deg: number | null | undefined): deg is number {
  return deg !== null && deg !== undefined && Number.isFinite(deg) && deg >= 0;
}

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;
