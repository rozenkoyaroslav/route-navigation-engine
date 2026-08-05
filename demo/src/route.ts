import type { LatLng } from '@engine';

/**
 * A hand-drawn route with a mix of turn severities, so the maneuver classifier
 * has something to classify: a slight bend, two square turns and one sharp one.
 * Coordinates are around a fictional city centre; only their relative geometry
 * matters.
 */
export const ROUTE: LatLng[] = [
  { latitude: 50.4501, longitude: 30.5234 },
  { latitude: 50.4534, longitude: 30.5241 },
  { latitude: 50.4561, longitude: 30.5262 },
  { latitude: 50.4566, longitude: 30.5338 },
  { latitude: 50.4529, longitude: 30.5372 },
  { latitude: 50.4498, longitude: 30.5369 },
  { latitude: 50.4471, longitude: 30.5418 },
  { latitude: 50.4489, longitude: 30.5487 },
  { latitude: 50.4536, longitude: 30.5509 },
];

/** What the routing provider predicted for the whole route. */
export const ROUTE_DURATION_SEC = 11 * 60;

/**
 * Interpolate a point a given fraction along the polyline, so the simulated
 * driver can be placed anywhere on the route by a single 0..1 control.
 */
export function pointAtFraction(
  route: LatLng[],
  fraction: number,
): { point: LatLng; bearingSourceIndex: number } {
  const lengths: number[] = [];
  let total = 0;

  for (let i = 0; i < route.length - 1; i += 1) {
    const d = planarDistance(route[i], route[i + 1]);
    lengths.push(d);
    total += d;
  }

  const target = Math.max(0, Math.min(1, fraction)) * total;
  let walked = 0;

  for (let i = 0; i < lengths.length; i += 1) {
    if (walked + lengths[i] >= target) {
      const t = lengths[i] === 0 ? 0 : (target - walked) / lengths[i];
      return {
        point: {
          latitude:
            route[i].latitude + (route[i + 1].latitude - route[i].latitude) * t,
          longitude:
            route[i].longitude +
            (route[i + 1].longitude - route[i].longitude) * t,
        },
        bearingSourceIndex: i,
      };
    }
    walked += lengths[i];
  }

  return {
    point: route[route.length - 1],
    bearingSourceIndex: Math.max(0, route.length - 2),
  };
}

/** Push a point perpendicular to its segment — used to simulate going off-route. */
export function offsetPerpendicular(
  point: LatLng,
  from: LatLng,
  to: LatLng,
  meters: number,
): LatLng {
  if (meters === 0) return point;

  const dLat = to.latitude - from.latitude;
  const dLng = (to.longitude - from.longitude) * lngScale(point.latitude);
  const len = Math.hypot(dLat, dLng) || 1;

  // Perpendicular unit vector, then converted back to degrees.
  const perpLat = -dLng / len;
  const perpLng = dLat / len;
  const degPerMeter = 1 / 111_320;

  return {
    latitude: point.latitude + perpLat * meters * degPerMeter,
    longitude:
      point.longitude +
      (perpLng * meters * degPerMeter) / lngScale(point.latitude),
  };
}

const lngScale = (latitude: number): number =>
  Math.cos((latitude * Math.PI) / 180) || 1;

const planarDistance = (a: LatLng, b: LatLng): number =>
  Math.hypot(
    b.latitude - a.latitude,
    (b.longitude - a.longitude) * lngScale(a.latitude),
  );
