import { describe, expect, it } from 'vitest';

import { RouteNavigator } from '../src/route/navigator.js';
import { move, ORIGIN, RIGHT_TURN_ROUTE } from './helpers.js';
import type { LatLng, LocationSample } from '../src/types.js';

const sampleAt = (
  point: LatLng,
  timestamp: number,
  overrides: Partial<LocationSample> = {},
): LocationSample => ({
  latitude: point.latitude,
  longitude: point.longitude,
  speedMps: 10,
  headingDeg: 0,
  accuracyMeters: 5,
  timestamp,
  ...overrides,
});

/** Drive north along the first leg of the fixture route. */
function driveNorth(navigator: RouteNavigator, metres: readonly number[]) {
  return metres.map((along, index) =>
    navigator.update(sampleAt(move(ORIGIN, 0, along), index * 1000)),
  );
}

describe('RouteNavigator', () => {
  it('reports an idle state before a route is set', () => {
    const navigator = new RouteNavigator();
    const state = navigator.update(sampleAt(ORIGIN, 0));

    expect(state.match).toBeNull();
    expect(state.instruction).toBe('Building route…');
    expect(state.ahead).toEqual([]);
  });

  it('produces everything a navigation screen needs from one update', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE, { routeDurationSec: 60 });
    const state = navigator.update(sampleAt(ORIGIN, 0));

    expect(state.match).not.toBeNull();
    expect(state.instruction).toBe('Turn right');
    expect(state.distanceToManeuverMeters).toBeCloseTo(200, 0);
    expect(state.distanceRemainingMeters).toBeCloseTo(400, 0);
    expect(state.progress).toBeCloseTo(0, 2);
    expect(state.eta.seconds).toBeGreaterThan(0);
    expect(state.ahead.length).toBeGreaterThanOrEqual(2);
  });

  it('counts down the distance to the turn as the driver approaches', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    const distances = driveNorth(navigator, [0, 50, 100, 150]).map(
      (s) => s.distanceToManeuverMeters,
    );

    expect(distances).toEqual([...distances].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(distances[3]).toBeCloseTo(50, 0);
  });

  it('switches to the destination prompt once the last turn is behind', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    driveNorth(navigator, [0, 100, 190]);

    const state = navigator.update(
      sampleAt(move(RIGHT_TURN_ROUTE[2]!, 90, 50), 4000, { headingDeg: 90 }),
    );

    expect(state.instruction).toBe('Continue to destination');
    expect(state.maneuver).toBeNull();
    expect(state.distanceToManeuverMeters).toBeNull();
  });

  it('advances progress monotonically along the drive', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    const progress = driveNorth(navigator, [0, 40, 80, 120, 160, 199]).map((s) => s.progress);

    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    }
  });

  it('stays on route through normal GPS wobble', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    const states = [0, 50, 100, 150].map((along, i) =>
      navigator.update(sampleAt(move(move(ORIGIN, 0, along), 90, 8), i * 1000)),
    );

    expect(states.every((s) => !s.isOffRoute)).toBe(true);
  });

  it('goes off route and asks for a reroute only after it persists', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    navigator.update(sampleAt(ORIGIN, 0));

    const wayOff = (i: number) =>
      navigator.update(sampleAt(move(move(ORIGIN, 0, 50), 90, 120), i * 1000));
    const states = [1, 2, 3, 4].map(wayOff);

    expect(states.map((s) => s.isOffRoute)).toEqual([false, false, true, true]);
    // Off-route alone is not enough to spend a routing request on.
    expect(states.map((s) => s.shouldReroute)).toEqual([false, false, false, true]);
  });

  it('clears the reroute request once back on the route', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    for (let i = 0; i < 6; i += 1) {
      navigator.update(sampleAt(move(move(ORIGIN, 0, 50), 90, 120), i * 1000));
    }

    // Returning takes two samples inside the exit threshold, same as leaving
    // takes three outside the entry one.
    const firstBack = navigator.update(sampleAt(move(ORIGIN, 0, 60), 7000));
    const secondBack = navigator.update(sampleAt(move(ORIGIN, 0, 70), 8000));

    expect(firstBack.isOffRoute).toBe(true);
    expect(secondBack.isOffRoute).toBe(false);
    expect(secondBack.shouldReroute).toBe(false);
  });

  it('starts clean when a new route replaces the old one', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    for (let i = 0; i < 6; i += 1) {
      navigator.update(sampleAt(move(move(ORIGIN, 0, 50), 90, 120), i * 1000));
    }
    expect(navigator.update(sampleAt(ORIGIN, 7000)).isOffRoute).toBe(true);

    navigator.setRoute(RIGHT_TURN_ROUTE, 120);
    const state = navigator.update(sampleAt(ORIGIN, 8000));

    expect(state.isOffRoute).toBe(false);
    expect(state.shouldReroute).toBe(false);
    expect(state.progress).toBeCloseTo(0, 2);
  });

  it('carries speed and movement state through', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    navigator.update(sampleAt(ORIGIN, 0, { speedMps: 12 }));

    const state = navigator.update(sampleAt(move(ORIGIN, 0, 12), 1000, { speedMps: 12 }));

    expect(state.speedMps).toBeCloseTo(12, 1);
    expect(state.isMoving).toBe(true);
  });

  it('surfaces a harsh braking event from the location stream', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    const speeds = [30, 22, 14, 6, 0, 0, 0, 0];

    const events = speeds
      .map((speedMps, i) =>
        navigator.update(sampleAt(move(ORIGIN, 0, i * 10), i * 1000, { speedMps })),
      )
      .map((state) => state.drivingEvent)
      .filter((event) => event !== null);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('harsh_braking');
  });

  it('keeps the drawn route attached to the driver', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    const state = navigator.update(sampleAt(move(ORIGIN, 0, 75), 0));

    expect(state.ahead[0]!.latitude).toBeCloseTo(state.match!.snapped.latitude, 6);
  });

  it('resets its filters without discarding the route', () => {
    const navigator = new RouteNavigator(RIGHT_TURN_ROUTE);
    driveNorth(navigator, [0, 50, 100]);
    navigator.reset();

    const state = navigator.update(sampleAt(ORIGIN, 9000, { speedMps: 25 }));

    expect(state.match).not.toBeNull();
    // Speed is re-seeded rather than averaged against the previous trip, and no
    // acceleration is invented across the reset.
    expect(state.speedMps).toBe(25);
    expect(state.acceleration.longitudinalMps2).toBe(0);
    expect(state.progress).toBeCloseTo(0, 2);
  });
});
