import { describe, expect, it } from 'vitest';

import { distanceMeters } from '../src/geo/haversine.js';
import { matchToRoute, OffRouteDetector } from '../src/route/matcher.js';
import { move, ORIGIN, RIGHT_TURN_ROUTE, walk } from './helpers.js';

describe('matchToRoute', () => {
  it('returns null for a route that has no segments', () => {
    expect(matchToRoute(ORIGIN, [])).toBeNull();
    expect(matchToRoute(ORIGIN, [ORIGIN])).toBeNull();
  });

  it('snaps a position beside the route onto the nearest segment', () => {
    const beside = move(move(ORIGIN, 0, 50), 90, 12); // 50 m along, 12 m off
    const match = matchToRoute(beside, RIGHT_TURN_ROUTE);

    expect(match).not.toBeNull();
    expect(match!.segmentIndex).toBe(0);
    expect(match!.offsetMeters).toBeCloseTo(12, 0);
    expect(match!.segmentProgress).toBeCloseTo(0.5, 1);
  });

  it('reports a small offset for a position sitting on the route', () => {
    const match = matchToRoute(move(ORIGIN, 0, 150), RIGHT_TURN_ROUTE);

    expect(match!.segmentIndex).toBe(1);
    expect(match!.offsetMeters).toBeLessThan(1);
  });

  it('matches the return leg of a route that doubles back, not the outbound one', () => {
    // Out 300 m north, U-turn, back 300 m south along the same street.
    const there = walk(ORIGIN, [
      [0, 150],
      [0, 150],
      [180, 150],
      [180, 150],
    ]);
    const halfwayBack = move(ORIGIN, 0, 150);

    const naive = matchToRoute(halfwayBack, there);
    const constrained = matchToRoute(halfwayBack, there, {
      fromSegmentIndex: 2,
      lookBackSegments: 0,
    });

    // A global search picks the outbound leg and throws progress backwards.
    expect(naive!.segmentIndex).toBe(0);
    expect(constrained!.segmentIndex).toBe(2);
  });

  it('can look back a little so a genuine doubling back still matches', () => {
    const match = matchToRoute(move(ORIGIN, 0, 50), RIGHT_TURN_ROUTE, {
      fromSegmentIndex: 2,
      lookBackSegments: 2,
    });

    expect(match!.segmentIndex).toBe(0);
  });

  it('clamps a look-back window that runs past the start of the route', () => {
    const match = matchToRoute(ORIGIN, RIGHT_TURN_ROUTE, {
      fromSegmentIndex: 0,
      lookBackSegments: 10,
    });

    expect(match!.segmentIndex).toBe(0);
  });

  it('snaps to the corner vertex for a driver cutting inside the turn', () => {
    const corner = RIGHT_TURN_ROUTE[2]!;
    const inside = move(move(corner, 180, 15), 90, 15);
    const match = matchToRoute(inside, RIGHT_TURN_ROUTE);

    expect(distanceMeters(match!.snapped, corner)).toBeLessThan(20);
  });
});

describe('OffRouteDetector', () => {
  it('starts on route', () => {
    expect(new OffRouteDetector().isOffRoute).toBe(false);
  });

  it('ignores a single GPS excursion', () => {
    const detector = new OffRouteDetector();

    expect(detector.update(5)).toBe(false);
    expect(detector.update(80)).toBe(false); // one bad fix in a street canyon
    expect(detector.update(6)).toBe(false);
  });

  it('declares off-route once the excursion persists', () => {
    const detector = new OffRouteDetector();

    expect(detector.update(80)).toBe(false);
    expect(detector.update(90)).toBe(false);
    expect(detector.update(85)).toBe(true);
  });

  it('does not clear on the first sample back inside the threshold', () => {
    const detector = new OffRouteDetector();
    [80, 90, 85].forEach((d) => detector.update(d));

    expect(detector.update(10)).toBe(true);
    expect(detector.update(10)).toBe(false);
  });

  it('holds off-route in the hysteresis band between the two thresholds', () => {
    const detector = new OffRouteDetector();
    [80, 90, 85].forEach((d) => detector.update(d));

    // 35 m is under the 45 m entry threshold but over the 25 m exit threshold.
    expect(detector.update(35)).toBe(true);
    expect(detector.update(35)).toBe(true);
  });

  it('does not flap for a driver hovering at the boundary', () => {
    const detector = new OffRouteDetector();
    const transitions: boolean[] = [];
    let previous = false;

    for (const offset of [44, 46, 44, 46, 44, 46, 44, 46]) {
      const state = detector.update(offset);
      if (state !== previous) transitions.push(state);
      previous = state;
    }

    expect(transitions).toEqual([]);
  });

  it('resets its counters as well as its state', () => {
    const detector = new OffRouteDetector();
    detector.update(80);
    detector.update(90);
    detector.reset();

    expect(detector.isOffRoute).toBe(false);
    expect(detector.update(80)).toBe(false); // counting starts over
  });

  it('honours custom thresholds', () => {
    const detector = new OffRouteDetector({ enterThresholdMeters: 10, enterSamples: 1 });

    expect(detector.update(12)).toBe(true);
  });
});
