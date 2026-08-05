import { normalizeDeg, toDegrees, toRadians } from './angles.js';
import type { LatLng } from '../types.js';

export const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Great-circle distance in meters.
 *
 * `asin(sqrt(h))` rather than `atan2`: for the sub-kilometre distances this
 * engine works with, the two agree, and the `asin` form is one operation
 * cheaper on a path that runs on every GPS sample against every route segment.
 * `Math.min(1, …)` guards the domain against floating-point overshoot when two
 * points are effectively identical.
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial bearing from `a` to `b`, in degrees clockwise from north.
 *
 * This is the *forward azimuth*: on a sphere it changes along the path, so it
 * is only the bearing at the starting point. Over a route segment that is
 * exactly what a turn calculation wants.
 */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return normalizeDeg(toDegrees(Math.atan2(y, x)));
}

/** Total length of a polyline in meters. */
export function pathLengthMeters(path: readonly LatLng[], fromIndex = 0): number {
  let total = 0;
  for (let i = Math.max(0, fromIndex); i < path.length - 1; i += 1) {
    total += distanceMeters(path[i]!, path[i + 1]!);
  }
  return total;
}
