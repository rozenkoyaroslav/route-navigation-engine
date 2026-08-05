import { toRadians } from './angles.js';
import type { LatLng } from '../types.js';

/** Meters per degree of latitude — very nearly constant everywhere. */
const METERS_PER_DEG_LAT = 111_320;

export interface SegmentProjection {
  point: LatLng;
  /** Position along the segment, clamped to `0..1`. */
  t: number;
}

/**
 * Project a point onto the segment `[a, b]`.
 *
 * Route segments are tens to hundreds of meters long, so the sphere is
 * flattened to a local plane first: latitude scales by a constant, longitude by
 * `cos(lat)`. Within a segment the error is millimetres, and it turns a
 * trigonometric cross-track calculation into two multiplications and a dot
 * product — worth it on a function that runs once per segment per GPS sample.
 *
 * `t` is clamped, so a driver past the end of a segment projects onto its
 * endpoint rather than onto the infinite line through it. Without the clamp,
 * a car that has overshot a turn appears to still be on the road it left.
 */
export function projectOnSegment(point: LatLng, a: LatLng, b: LatLng): SegmentProjection {
  const midLat = (a.latitude + b.latitude) / 2;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRadians(midLat));

  const ax = a.longitude * metersPerDegLng;
  const ay = a.latitude * METERS_PER_DEG_LAT;
  const bx = b.longitude * metersPerDegLng;
  const by = b.latitude * METERS_PER_DEG_LAT;
  const px = point.longitude * metersPerDegLng;
  const py = point.latitude * METERS_PER_DEG_LAT;

  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;

  // A degenerate segment (duplicated vertex) has no direction to project onto.
  const rawT = lengthSquared > 1e-9 ? ((px - ax) * abx + (py - ay) * aby) / lengthSquared : 0;
  const t = Math.min(1, Math.max(0, rawT));

  return {
    t,
    point: {
      longitude: (ax + t * abx) / metersPerDegLng,
      latitude: (ay + t * aby) / METERS_PER_DEG_LAT,
    },
  };
}
