import { describe, expect, it } from 'vitest';

import { bearingDeg, distanceMeters, pathLengthMeters } from '../src/geo/haversine.js';
import { decodePolyline, encodePolyline } from '../src/geo/polyline.js';
import { projectOnSegment } from '../src/geo/projection.js';
import { move, ORIGIN, RIGHT_TURN_ROUTE, walk } from './helpers.js';

describe('distanceMeters', () => {
  it('is zero for a point against itself', () => {
    expect(distanceMeters(ORIGIN, ORIGIN)).toBe(0);
  });

  it('matches a known distance along a meridian', () => {
    const north = { latitude: ORIGIN.latitude + 1, longitude: ORIGIN.longitude };
    expect(distanceMeters(ORIGIN, north)).toBeCloseTo(111_195, -2);
  });

  it('agrees with the test helper that walks a fixed distance', () => {
    expect(distanceMeters(ORIGIN, move(ORIGIN, 0, 100))).toBeCloseTo(100, 0);
    expect(distanceMeters(ORIGIN, move(ORIGIN, 90, 100))).toBeCloseTo(100, 0);
    expect(distanceMeters(ORIGIN, move(ORIGIN, 217, 250))).toBeCloseTo(250, 0);
  });

  it('is symmetric', () => {
    const other = move(ORIGIN, 42, 900);
    expect(distanceMeters(ORIGIN, other)).toBeCloseTo(distanceMeters(other, ORIGIN), 9);
  });
});

describe('bearingDeg', () => {
  it('reports the cardinal directions', () => {
    expect(bearingDeg(ORIGIN, move(ORIGIN, 0, 100))).toBeCloseTo(0, 1);
    expect(bearingDeg(ORIGIN, move(ORIGIN, 90, 100))).toBeCloseTo(90, 1);
    expect(bearingDeg(ORIGIN, move(ORIGIN, 180, 100))).toBeCloseTo(180, 1);
    expect(bearingDeg(ORIGIN, move(ORIGIN, 270, 100))).toBeCloseTo(270, 1);
  });

  it('always returns a normalized angle', () => {
    for (let heading = 0; heading < 360; heading += 13) {
      const bearing = bearingDeg(ORIGIN, move(ORIGIN, heading, 300));
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
      expect(bearing).toBeCloseTo(heading, 0);
    }
  });
});

describe('pathLengthMeters', () => {
  it('sums the whole path', () => {
    expect(pathLengthMeters(RIGHT_TURN_ROUTE)).toBeCloseTo(400, 0);
  });

  it('can start partway along', () => {
    expect(pathLengthMeters(RIGHT_TURN_ROUTE, 2)).toBeCloseTo(200, 0);
  });

  it('is zero for a degenerate path', () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([ORIGIN])).toBe(0);
  });
});

describe('polyline codec', () => {
  it('decodes the reference string from the format specification', () => {
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');

    expect(points).toHaveLength(3);
    expect(points[0]!.latitude).toBeCloseTo(38.5, 5);
    expect(points[0]!.longitude).toBeCloseTo(-120.2, 5);
    expect(points[2]!.latitude).toBeCloseTo(43.252, 5);
    expect(points[2]!.longitude).toBeCloseTo(-126.453, 5);
  });

  it('round-trips a route within the encoded precision', () => {
    const decoded = decodePolyline(encodePolyline(RIGHT_TURN_ROUTE));

    expect(decoded).toHaveLength(RIGHT_TURN_ROUTE.length);
    decoded.forEach((point, index) => {
      expect(distanceMeters(point, RIGHT_TURN_ROUTE[index]!)).toBeLessThan(1.5);
    });
  });

  it('round-trips more precisely at precision 6', () => {
    const encoded = encodePolyline(RIGHT_TURN_ROUTE, 6);
    const decoded = decodePolyline(encoded, 6);

    decoded.forEach((point, index) => {
      expect(distanceMeters(point, RIGHT_TURN_ROUTE[index]!)).toBeLessThan(0.2);
    });
  });

  it('decodes a precision-6 string wrongly when told it is precision 5', () => {
    // The failure this argument exists to prevent: same string, coordinates off
    // by a factor of ten, and no error anywhere.
    const encoded = encodePolyline(RIGHT_TURN_ROUTE, 6);
    const misread = decodePolyline(encoded, 5);

    expect(misread[0]!.latitude).toBeCloseTo(RIGHT_TURN_ROUTE[0]!.latitude * 10, 3);
  });

  it('returns an empty path for empty or non-string input', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null as unknown as string)).toEqual([]);
    expect(encodePolyline([])).toBe('');
  });
});

describe('projectOnSegment', () => {
  const a = ORIGIN;
  const b = move(ORIGIN, 90, 100); // 100 m east

  it('projects a point beside the segment onto its interior', () => {
    const offset = move(move(ORIGIN, 90, 50), 0, 20); // 50 m along, 20 m north
    const projection = projectOnSegment(offset, a, b);

    expect(projection.t).toBeCloseTo(0.5, 2);
    expect(distanceMeters(projection.point, move(ORIGIN, 90, 50))).toBeLessThan(1);
  });

  it('clamps to the start when the point lies behind the segment', () => {
    const behind = move(ORIGIN, 270, 50);
    const projection = projectOnSegment(behind, a, b);

    expect(projection.t).toBe(0);
    expect(distanceMeters(projection.point, a)).toBeLessThan(1);
  });

  it('clamps to the end when the point lies past the segment', () => {
    // Without the clamp, a driver who overshot a turn still projects onto the
    // road they already left.
    const past = move(b, 90, 80);
    const projection = projectOnSegment(past, a, b);

    expect(projection.t).toBe(1);
    expect(distanceMeters(projection.point, b)).toBeLessThan(1);
  });

  it('survives a degenerate segment with duplicated endpoints', () => {
    const projection = projectOnSegment(move(ORIGIN, 45, 30), a, a);

    expect(projection.t).toBe(0);
    expect(distanceMeters(projection.point, a)).toBeLessThan(0.001);
  });

  it('stays accurate over a long segment', () => {
    const far = move(ORIGIN, 90, 5000);
    const beside = move(move(ORIGIN, 90, 2500), 0, 40);
    const projection = projectOnSegment(beside, ORIGIN, far);

    expect(distanceMeters(beside, projection.point)).toBeCloseTo(40, 0);
  });

  it('agrees with a hand-built right-angle route', () => {
    const route = walk(ORIGIN, [[0, 100]]);
    const projection = projectOnSegment(move(ORIGIN, 0, 30), route[0]!, route[1]!);

    expect(projection.t).toBeCloseTo(0.3, 2);
  });
});
