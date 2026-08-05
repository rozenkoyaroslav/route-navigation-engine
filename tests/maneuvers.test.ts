import { describe, expect, it } from 'vitest';

import { matchToRoute } from '../src/route/matcher.js';
import {
  classifyTurn,
  distanceToManeuver,
  findNextManeuver,
  instructionFor,
  turnAngleAtVertex,
} from '../src/route/maneuvers.js';
import { move, ORIGIN, RIGHT_TURN_ROUTE, ROUNDED_CORNER_ROUTE, walk } from './helpers.js';

describe('classifyTurn', () => {
  it('treats small bends as straight road, not as turns', () => {
    expect(classifyTurn(0)).toBe('straight');
    expect(classifyTurn(14)).toBe('straight');
    expect(classifyTurn(-14)).toBe('straight');
  });

  it('classifies by magnitude and side', () => {
    expect(classifyTurn(20)).toBe('slight_right');
    expect(classifyTurn(-20)).toBe('slight_left');
    expect(classifyTurn(90)).toBe('right');
    expect(classifyTurn(-90)).toBe('left');
    expect(classifyTurn(130)).toBe('sharp_right');
    expect(classifyTurn(-130)).toBe('sharp_left');
  });

  it('separates a U-turn from a sharp turn', () => {
    expect(classifyTurn(175)).toBe('uturn');
    expect(classifyTurn(-175)).toBe('uturn');
  });

  it('honours custom thresholds', () => {
    const sensitive = { straightDeg: 5, slightDeg: 20, turnDeg: 90, uturnDeg: 160 };
    expect(classifyTurn(10, sensitive)).toBe('slight_right');
  });
});

describe('turnAngleAtVertex', () => {
  it('is zero at the endpoints, which have no turn', () => {
    expect(turnAngleAtVertex(RIGHT_TURN_ROUTE, 0)).toBe(0);
    expect(turnAngleAtVertex(RIGHT_TURN_ROUTE, RIGHT_TURN_ROUTE.length - 1)).toBe(0);
  });

  it('is zero mid-way along a straight stretch', () => {
    expect(turnAngleAtVertex(RIGHT_TURN_ROUTE, 1)).toBeCloseTo(0, 1);
  });

  it('measures a square corner', () => {
    expect(turnAngleAtVertex(RIGHT_TURN_ROUTE, 2)).toBeCloseTo(90, 0);
  });

  it('recovers the real angle of a corner sampled as several short steps', () => {
    // Adjacent segments alone see only 30 degrees of a 90 degree corner.
    const adjacentOnly = turnAngleAtVertex(ROUNDED_CORNER_ROUTE, 1, 0);
    const windowed = turnAngleAtVertex(ROUNDED_CORNER_ROUTE, 1);

    expect(adjacentOnly).toBeCloseTo(30, 0);
    expect(windowed).toBeCloseTo(90, 0);
    expect(classifyTurn(adjacentOnly)).toBe('slight_right');
    expect(classifyTurn(windowed)).toBe('right');
  });

  it('does not merge two separate turns into one', () => {
    // Two 90 degree turns 200 m apart must stay two turns.
    const route = walk(ORIGIN, [
      [0, 100],
      [90, 200],
      [180, 100],
    ]);

    expect(turnAngleAtVertex(route, 1)).toBeCloseTo(90, 0);
    expect(turnAngleAtVertex(route, 2)).toBeCloseTo(90, 0);
  });
});

describe('findNextManeuver', () => {
  it('finds the corner ahead and reports where it is', () => {
    const maneuver = findNextManeuver(RIGHT_TURN_ROUTE, 0);

    expect(maneuver).not.toBeNull();
    expect(maneuver!.kind).toBe('right');
    expect(maneuver!.vertexIndex).toBe(2);
    expect(maneuver!.turnAngleDeg).toBeCloseTo(90, 0);
  });

  it('returns null once the corner is behind the driver', () => {
    expect(findNextManeuver(RIGHT_TURN_ROUTE, 2)).toBeNull();
  });

  it('returns null on a straight route', () => {
    expect(
      findNextManeuver(
        walk(ORIGIN, [
          [45, 100],
          [45, 100],
        ]),
        0,
      ),
    ).toBeNull();
  });

  it('reports the nearer of two upcoming turns', () => {
    const route = walk(ORIGIN, [
      [0, 100],
      [90, 150],
      [0, 150],
    ]);
    const maneuver = findNextManeuver(route, 0);

    expect(maneuver!.vertexIndex).toBe(1);
    expect(maneuver!.kind).toBe('right');
  });

  it('handles a route too short to contain a turn', () => {
    expect(findNextManeuver([ORIGIN, move(ORIGIN, 0, 10)], 0)).toBeNull();
  });
});

describe('distanceToManeuver', () => {
  it('measures from the driver, shrinking as they approach the turn', () => {
    const maneuver = findNextManeuver(RIGHT_TURN_ROUTE, 0)!;

    const far = distanceToManeuver(
      RIGHT_TURN_ROUTE,
      matchToRoute(ORIGIN, RIGHT_TURN_ROUTE)!,
      maneuver,
    );
    const near = distanceToManeuver(
      RIGHT_TURN_ROUTE,
      matchToRoute(move(ORIGIN, 0, 150), RIGHT_TURN_ROUTE)!,
      maneuver,
    );

    expect(far).toBeCloseTo(200, 0);
    expect(near).toBeCloseTo(50, 0);
  });

  it('is zero once the driver is past the turn', () => {
    const maneuver = { kind: 'right' as const, vertexIndex: 1, turnAngleDeg: 90 };
    const match = matchToRoute(move(RIGHT_TURN_ROUTE[2]!, 90, 50), RIGHT_TURN_ROUTE)!;

    expect(distanceToManeuver(RIGHT_TURN_ROUTE, match, maneuver)).toBe(0);
  });
});

describe('instructionFor', () => {
  it('gives a phrase for every maneuver kind', () => {
    expect(instructionFor('left')).toBe('Turn left');
    expect(instructionFor('sharp_right')).toBe('Take a sharp right');
    expect(instructionFor('uturn')).toBe('Make a U-turn');
    expect(instructionFor('straight')).toBe('Continue straight');
  });

  it('leaves distance and formatting to the caller', () => {
    // No "in 200 m" baked in: word order differs per language.
    expect(instructionFor('right')).not.toMatch(/\d/);
  });
});
