import { distanceMeters, pathLengthMeters } from '../geo/haversine.js';
import type { LatLng, RouteMatch } from '../types.js';

/**
 * Distance still to drive, measured from the snapped position — not from the
 * raw GPS point and not from the start of the current segment.
 *
 * Measuring from the segment start makes remaining distance tick *up* every
 * time the driver crosses a vertex, which is the most visible way to make a
 * navigation UI look broken.
 */
export function remainingDistanceMeters(route: readonly LatLng[], match: RouteMatch): number {
  if (route.length < 2) return 0;

  const toSegmentEnd = distanceMeters(match.snapped, route[match.segmentIndex + 1]!);
  return toSegmentEnd + pathLengthMeters(route, match.segmentIndex + 1);
}

/** Distance already driven along the route, in meters. */
export function traveledDistanceMeters(route: readonly LatLng[], match: RouteMatch): number {
  if (route.length < 2) return 0;

  const toSegmentStart = pathLengthMeters(route.slice(0, match.segmentIndex + 1));
  return toSegmentStart + distanceMeters(route[match.segmentIndex]!, match.snapped);
}

/** Route completion as a `0..1` fraction. */
export function routeProgress(route: readonly LatLng[], match: RouteMatch): number {
  const total = pathLengthMeters(route);
  if (total <= 0) return 0;

  return Math.min(1, Math.max(0, traveledDistanceMeters(route, match) / total));
}

/**
 * The part of the route still ahead, starting exactly at the driver.
 *
 * Drawing the full route leaves a tail trailing behind the car; drawing from
 * the next vertex makes the line start somewhere up ahead and detach from the
 * marker. Starting at the snapped point keeps the line attached to the car
 * through the whole drive.
 *
 * The near-duplicate check exists because when the driver is nearly on top of a
 * vertex, emitting both the snapped point and that vertex produces a
 * zero-length first segment, which renderers turn into a visible spike.
 */
export function routeAhead(
  route: readonly LatLng[],
  match: RouteMatch,
  mergeToleranceMeters = 4,
): LatLng[] {
  if (route.length < 2) return [...route];

  const tail = route.slice(match.segmentIndex + 1);
  if (tail.length === 0) return [match.snapped, route[route.length - 1]!];

  const skipFirst = distanceMeters(match.snapped, tail[0]!) < mergeToleranceMeters;
  const ahead = [match.snapped, ...(skipFirst ? tail.slice(1) : tail)];

  return ahead.length >= 2 ? ahead : [match.snapped, route[route.length - 1]!];
}
