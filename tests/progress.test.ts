import { describe, expect, it } from 'vitest';

import { distanceMeters, pathLengthMeters } from '../src/geo/haversine.js';
import { matchToRoute } from '../src/route/matcher.js';
import {
  remainingDistanceMeters,
  routeAhead,
  routeProgress,
  traveledDistanceMeters,
} from '../src/route/progress.js';
import { move, ORIGIN, RIGHT_TURN_ROUTE } from './helpers.js';

const matchAt = (point: { latitude: number; longitude: number }) =>
  matchToRoute(point, RIGHT_TURN_ROUTE)!;

describe('remainingDistanceMeters', () => {
  it('counts the whole route at the start', () => {
    expect(remainingDistanceMeters(RIGHT_TURN_ROUTE, matchAt(ORIGIN))).toBeCloseTo(400, 0);
  });

  it('measures from the snapped position, not the segment start', () => {
    const halfway = move(ORIGIN, 0, 50);
    expect(remainingDistanceMeters(RIGHT_TURN_ROUTE, matchAt(halfway))).toBeCloseTo(350, 0);
  });

  it('decreases monotonically along the drive', () => {
    let previous = Number.POSITIVE_INFINITY;

    for (let along = 0; along <= 200; along += 10) {
      const remaining = remainingDistanceMeters(RIGHT_TURN_ROUTE, matchAt(move(ORIGIN, 0, along)));
      expect(remaining).toBeLessThanOrEqual(previous + 0.5);
      previous = remaining;
    }
  });

  it('does not tick upward when the driver crosses a vertex', () => {
    // The classic bug: measuring from the segment start makes remaining
    // distance jump back up at every corner.
    const beforeVertex = remainingDistanceMeters(RIGHT_TURN_ROUTE, matchAt(move(ORIGIN, 0, 199)));
    const afterVertex = remainingDistanceMeters(
      RIGHT_TURN_ROUTE,
      matchAt(move(RIGHT_TURN_ROUTE[2]!, 90, 1)),
    );

    expect(afterVertex).toBeLessThan(beforeVertex);
  });

  it('is zero on a route with no segments', () => {
    expect(remainingDistanceMeters([ORIGIN], matchAt(ORIGIN))).toBe(0);
  });
});

describe('traveledDistanceMeters', () => {
  it('complements the remaining distance', () => {
    const total = pathLengthMeters(RIGHT_TURN_ROUTE);

    for (const along of [0, 37, 100, 180]) {
      const match = matchAt(move(ORIGIN, 0, along));
      const sum =
        traveledDistanceMeters(RIGHT_TURN_ROUTE, match) +
        remainingDistanceMeters(RIGHT_TURN_ROUTE, match);

      expect(sum).toBeCloseTo(total, 0);
    }
  });
});

describe('routeProgress', () => {
  it('runs from 0 at the start to 1 at the destination', () => {
    expect(routeProgress(RIGHT_TURN_ROUTE, matchAt(ORIGIN))).toBeCloseTo(0, 2);

    const end = RIGHT_TURN_ROUTE[RIGHT_TURN_ROUTE.length - 1]!;
    expect(routeProgress(RIGHT_TURN_ROUTE, matchAt(end))).toBeCloseTo(1, 2);
  });

  it('is half way at the corner of a symmetric route', () => {
    expect(routeProgress(RIGHT_TURN_ROUTE, matchAt(RIGHT_TURN_ROUTE[2]!))).toBeCloseTo(0.5, 1);
  });

  it('stays within 0..1 for a degenerate route', () => {
    expect(routeProgress([ORIGIN], matchAt(ORIGIN))).toBe(0);
  });
});

describe('routeAhead', () => {
  it('starts exactly at the driver so the line stays attached to the marker', () => {
    const driver = move(ORIGIN, 0, 50);
    const ahead = routeAhead(RIGHT_TURN_ROUTE, matchAt(driver));

    expect(distanceMeters(ahead[0]!, driver)).toBeLessThan(1);
  });

  it('drops the part of the route already driven', () => {
    const ahead = routeAhead(RIGHT_TURN_ROUTE, matchAt(move(ORIGIN, 0, 150)));

    expect(pathLengthMeters(ahead)).toBeCloseTo(250, 0);
  });

  it('does not emit a zero-length spike when the driver sits on a vertex', () => {
    const ahead = routeAhead(RIGHT_TURN_ROUTE, matchAt(RIGHT_TURN_ROUTE[2]!));

    expect(distanceMeters(ahead[0]!, ahead[1]!)).toBeGreaterThan(1);
  });

  it('always returns a drawable line of at least two points', () => {
    const end = RIGHT_TURN_ROUTE[RIGHT_TURN_ROUTE.length - 1]!;

    expect(routeAhead(RIGHT_TURN_ROUTE, matchAt(end)).length).toBeGreaterThanOrEqual(2);
    expect(routeAhead([ORIGIN], matchAt(ORIGIN))).toHaveLength(1);
  });
});
