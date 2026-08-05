import { toRadians } from '../src/geo/angles.js';
import type { LatLng } from '../src/types.js';

export const ORIGIN: LatLng = { latitude: 50.45, longitude: 30.52 };

const METERS_PER_DEG_LAT = 111_320;

/**
 * Walk `meters` from `from` along `bearingDeg`.
 *
 * Building routes by walking makes the geometry of a test obvious ("north
 * 100 m, then right") instead of a wall of decimal coordinates.
 */
export function move(from: LatLng, bearingDeg: number, meters: number): LatLng {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRadians(from.latitude));
  const rad = toRadians(bearingDeg);

  return {
    latitude: from.latitude + (meters * Math.cos(rad)) / METERS_PER_DEG_LAT,
    longitude: from.longitude + (meters * Math.sin(rad)) / metersPerDegLng,
  };
}

/** Build a route by following a sequence of `[bearing, meters]` legs. */
export function walk(start: LatLng, legs: readonly [number, number][]): LatLng[] {
  const points = [start];
  let current = start;

  for (const [bearing, meters] of legs) {
    current = move(current, bearing, meters);
    points.push(current);
  }

  return points;
}

/** North 200 m, then a square right turn and 200 m east. */
export const RIGHT_TURN_ROUTE = walk(ORIGIN, [
  [0, 100],
  [0, 100],
  [90, 100],
  [90, 100],
]);

/** The same corner, but sampled as three short 30° steps, as providers emit it. */
export const ROUNDED_CORNER_ROUTE = walk(ORIGIN, [
  [0, 100],
  [30, 10],
  [60, 10],
  [90, 10],
  [90, 100],
]);
