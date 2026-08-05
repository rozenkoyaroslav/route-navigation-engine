import { describe, expect, it } from 'vitest';

import { AccelerationTracker, type DrivingEvent } from '../src/motion/acceleration.js';
import { HeadingFilter } from '../src/motion/heading.js';
import { SpeedFilter } from '../src/motion/speed.js';

describe('SpeedFilter', () => {
  it('seeds from the first sample instead of ramping up from zero', () => {
    const filter = new SpeedFilter();

    expect(filter.update(20, 5).speedMps).toBe(20);
  });

  it('smooths a noisy stream', () => {
    const filter = new SpeedFilter();
    filter.update(10, 5);

    const { speedMps } = filter.update(20, 5);

    expect(speedMps).toBeGreaterThan(10);
    expect(speedMps).toBeLessThan(20);
  });

  it('zeroes GPS creep from a stationary phone with a poor fix', () => {
    const filter = new SpeedFilter();

    // 1.5 m/s reported with 50 m accuracy is the position wandering, not motion.
    expect(filter.update(1.5, 50).speedMps).toBe(0);
  });

  it('keeps a low speed that arrives with a good fix', () => {
    expect(new SpeedFilter().update(1.5, 5).speedMps).toBe(1.5);
  });

  it('trusts a high speed even when accuracy is poor', () => {
    expect(new SpeedFilter().update(25, 60).speedMps).toBe(25);
  });

  it('needs a clear start before reporting movement', () => {
    const filter = new SpeedFilter();

    expect(filter.update(1.5, 5).isMoving).toBe(false);
    expect(filter.update(10, 5).isMoving).toBe(true);
  });

  it('does not flap for a driver crawling between the two thresholds', () => {
    const filter = new SpeedFilter();
    for (let i = 0; i < 10; i += 1) filter.update(10, 5);
    expect(filter.state.isMoving).toBe(true);

    // 1.5 m/s is below the 2.2 start threshold but above the 0.9 stop one.
    for (let i = 0; i < 10; i += 1) {
      expect(filter.update(1.5, 5).isMoving).toBe(true);
    }
  });

  it('stops once the speed falls below the stop threshold', () => {
    const filter = new SpeedFilter();
    for (let i = 0; i < 10; i += 1) filter.update(10, 5);
    for (let i = 0; i < 20; i += 1) filter.update(0, 5);

    expect(filter.state.isMoving).toBe(false);
  });

  it('treats a missing speed as zero rather than NaN', () => {
    const filter = new SpeedFilter();

    expect(filter.update(null).speedMps).toBe(0);
    expect(filter.update(undefined).speedMps).toBe(0);
  });

  it('resets to a clean state', () => {
    const filter = new SpeedFilter();
    for (let i = 0; i < 5; i += 1) filter.update(20, 5);
    filter.reset();

    expect(filter.state).toEqual({ speedMps: 0, gatedSpeedMps: 0, isMoving: false });
  });
});

describe('HeadingFilter', () => {
  it('starts at the heading it was given', () => {
    expect(new HeadingFilter(90).heading).toBe(90);
  });

  it('prefers the compass while stationary, where GPS course is noise', () => {
    const filter = new HeadingFilter();
    filter.updateFromGps(200, 0.2, 5); // parked: course is meaningless
    filter.updateFromCompass(90);

    expect(filter.activeSource).toBe('compass');
    expect(filter.targetHeading).toBe(90);
  });

  it('prefers GPS course once moving, where the compass drifts', () => {
    const filter = new HeadingFilter();
    filter.updateFromCompass(0);
    filter.updateFromGps(90, 12, 5);

    expect(filter.activeSource).toBe('gps');
    expect(filter.targetHeading).toBe(90);
  });

  it('discards GPS course from a poor fix', () => {
    const filter = new HeadingFilter();
    filter.updateFromGps(270, 12, 100);

    expect(filter.targetHeading).toBe(0);
    expect(filter.activeSource).toBe('none');
  });

  it('ignores compass twitch while parked', () => {
    const filter = new HeadingFilter(100);
    filter.updateFromCompass(101.5); // inside the 2.5 degree deadzone

    expect(filter.targetHeading).toBe(100);
  });

  it('follows a real compass movement while parked', () => {
    const filter = new HeadingFilter(100);
    filter.updateFromCompass(140);

    expect(filter.targetHeading).toBe(140);
  });

  it('eases toward the target rather than snapping to it', () => {
    const filter = new HeadingFilter(0);
    filter.updateFromGps(90, 12, 5);

    const afterOneFrame = filter.tick(1000);

    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(90);
  });

  it('converges on the target and then stops moving', () => {
    const filter = new HeadingFilter(0);
    filter.updateFromGps(90, 12, 5);

    let now = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      now += 16;
      filter.tick(now);
    }

    expect(filter.heading).toBeCloseTo(90, 5);
  });

  it('rotates the short way across the 0/360 seam', () => {
    const filter = new HeadingFilter(350);
    filter.updateFromGps(10, 12, 5);

    const headings: number[] = [];
    let now = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      now += 16;
      headings.push(filter.tick(now));
    }

    // Going the short way stays in [350, 360) then [0, 10]; the long way would
    // sweep down through 180.
    expect(headings.every((h) => h >= 349 || h <= 11)).toBe(true);
    expect(filter.heading).toBeCloseTo(10, 5);
  });

  it('caps rotation speed so one bad reading cannot whip the marker around', () => {
    const filter = new HeadingFilter(0, { maxSlewDegPerSec: 60, rapidTurnSmoothing: 1 });
    filter.updateFromGps(180, 12, 5);

    const first = filter.tick(0);
    const after100ms = filter.tick(100);

    // 60 deg/s for 0.1 s is 6 degrees, whatever the smoothing factor asks for.
    expect(after100ms - first).toBeLessThanOrEqual(6.001);
    // And the very first frame is capped too, rather than snapping to 180.
    expect(first).toBeLessThanOrEqual(1.001);
  });

  it('keeps rotation speed steady when frames are dropped', () => {
    const steady = new HeadingFilter(0, { maxSlewDegPerSec: 60, rapidTurnSmoothing: 1 });
    steady.updateFromGps(180, 12, 5);
    steady.tick(0);
    steady.tick(50);
    const afterTwoFrames = steady.tick(100);

    const dropped = new HeadingFilter(0, { maxSlewDegPerSec: 60, rapidTurnSmoothing: 1 });
    dropped.updateFromGps(180, 12, 5);
    dropped.tick(0);
    const afterOneLongFrame = dropped.tick(100);

    expect(afterOneLongFrame).toBeCloseTo(afterTwoFrames, 5);
  });

  it('turns gently while parked and briskly mid-turn', () => {
    const parked = new HeadingFilter(0);
    parked.updateFromCompass(90);
    parked.tick(0);
    const parkedStep = parked.tick(200, false);

    const driving = new HeadingFilter(0);
    driving.updateFromGps(90, 12, 5);
    driving.tick(0);
    const drivingStep = driving.tick(200, true);

    expect(drivingStep).toBeGreaterThan(parkedStep);
  });

  it('resets to a known heading', () => {
    const filter = new HeadingFilter(0);
    filter.updateFromGps(90, 12, 5);
    filter.reset(180);

    expect(filter.heading).toBe(180);
    expect(filter.targetHeading).toBe(180);
    expect(filter.activeSource).toBe('none');
  });
});

describe('AccelerationTracker', () => {
  const feed = (
    tracker: AccelerationTracker,
    samples: readonly { speedMps: number; headingDeg?: number; timestamp: number }[],
  ): DrivingEvent[] => {
    const events: DrivingEvent[] = [];
    for (const sample of samples) {
      const event = tracker.update(sample);
      if (event) events.push(event);
    }
    return events;
  };

  it('reports nothing from the first sample, which has nothing to difference', () => {
    const tracker = new AccelerationTracker();

    expect(tracker.update({ speedMps: 10, timestamp: 0 })).toBeNull();
    expect(tracker.state.longitudinalMps2).toBe(0);
  });

  it('reads near zero acceleration at a steady speed', () => {
    const tracker = new AccelerationTracker();
    feed(
      tracker,
      Array.from({ length: 10 }, (_, i) => ({ speedMps: 15, timestamp: i * 1000 })),
    );

    expect(Math.abs(tracker.state.longitudinalMps2)).toBeLessThan(0.01);
  });

  it('reads positive acceleration when speeding up and negative when braking', () => {
    const accelerating = new AccelerationTracker();
    feed(accelerating, [
      { speedMps: 0, timestamp: 0 },
      { speedMps: 4, timestamp: 1000 },
      { speedMps: 8, timestamp: 2000 },
    ]);
    expect(accelerating.state.longitudinalMps2).toBeGreaterThan(0);

    const braking = new AccelerationTracker();
    feed(braking, [
      { speedMps: 20, timestamp: 0 },
      { speedMps: 16, timestamp: 1000 },
      { speedMps: 12, timestamp: 2000 },
    ]);
    expect(braking.state.longitudinalMps2).toBeLessThan(0);
  });

  it('reports a harsh braking event once the deceleration ends', () => {
    const tracker = new AccelerationTracker();
    const events = feed(tracker, [
      { speedMps: 30, timestamp: 0 },
      { speedMps: 22, timestamp: 1000 },
      { speedMps: 14, timestamp: 2000 },
      { speedMps: 6, timestamp: 3000 },
      { speedMps: 0, timestamp: 4000 },
      { speedMps: 0, timestamp: 5000 },
      { speedMps: 0, timestamp: 6000 },
      { speedMps: 0, timestamp: 7000 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('harsh_braking');
    expect(events[0]!.peakMps2).toBeLessThan(-3.5);
    expect(events[0]!.endedAt).toBeGreaterThan(events[0]!.startedAt);
  });

  it('ignores a one-sample spike that never lasts', () => {
    const tracker = new AccelerationTracker({ minEventDurationMs: 1500 });
    const events = feed(tracker, [
      { speedMps: 20, timestamp: 0 },
      { speedMps: 0, timestamp: 1000 }, // a lost fix, not a real stop
      { speedMps: 20, timestamp: 2000 },
      { speedMps: 20, timestamp: 3000 },
    ]);

    expect(events).toEqual([]);
  });

  it('does not difference across a gap in the location stream', () => {
    const tracker = new AccelerationTracker();
    tracker.update({ speedMps: 0, timestamp: 0 });
    // App backgrounded for a minute; the next fix is 25 m/s.
    tracker.update({ speedMps: 25, timestamp: 60_000 });

    expect(tracker.state.longitudinalMps2).toBe(0);
  });

  it('derives lateral acceleration from speed and yaw rate', () => {
    const tracker = new AccelerationTracker();
    feed(tracker, [
      { speedMps: 15, headingDeg: 0, timestamp: 0 },
      { speedMps: 15, headingDeg: 30, timestamp: 1000 },
      { speedMps: 15, headingDeg: 60, timestamp: 2000 },
      { speedMps: 15, headingDeg: 90, timestamp: 3000 },
    ]);

    expect(tracker.state.yawRateDegPerSec).toBeGreaterThan(0);
    expect(tracker.state.lateralMps2).toBeGreaterThan(3);
  });

  it('reports the same steering as harsher at higher speed', () => {
    const turn = (speedMps: number): number => {
      const tracker = new AccelerationTracker();
      feed(tracker, [
        { speedMps, headingDeg: 0, timestamp: 0 },
        { speedMps, headingDeg: 20, timestamp: 1000 },
        { speedMps, headingDeg: 40, timestamp: 2000 },
      ]);
      return tracker.state.lateralMps2;
    };

    expect(turn(20)).toBeGreaterThan(turn(6));
  });

  it('does not treat a stationary compass swing as cornering', () => {
    const tracker = new AccelerationTracker();
    feed(tracker, [
      { speedMps: 0, headingDeg: 0, timestamp: 0 },
      { speedMps: 0.2, headingDeg: 90, timestamp: 1000 },
      { speedMps: 0.1, headingDeg: 180, timestamp: 2000 },
    ]);

    expect(tracker.state.lateralMps2).toBe(0);
  });

  it('rejects a physically impossible lateral figure as a sampling artefact', () => {
    // A square junction sampled at 1 Hz: 90 degrees of heading change in one
    // sample. a = v * omega makes that ~31 m/s^2, well past what tyres hold.
    const tracker = new AccelerationTracker();
    const events = feed(tracker, [
      { speedMps: 20, headingDeg: 0, timestamp: 0 },
      { speedMps: 20, headingDeg: 90, timestamp: 1000 },
      { speedMps: 20, headingDeg: 90, timestamp: 2000 },
      { speedMps: 20, headingDeg: 90, timestamp: 3000 },
      { speedMps: 20, headingDeg: 90, timestamp: 4000 },
    ]);

    expect(events).toEqual([]);
    expect(tracker.state.lateralMps2).toBe(0);
  });

  it('still flags a hard corner that stays within the grip limit', () => {
    const tracker = new AccelerationTracker();
    const events = feed(tracker, [
      { speedMps: 16, headingDeg: 0, timestamp: 0 },
      { speedMps: 16, headingDeg: 22, timestamp: 1000 },
      { speedMps: 16, headingDeg: 44, timestamp: 2000 },
      { speedMps: 16, headingDeg: 66, timestamp: 3000 },
      { speedMps: 16, headingDeg: 66, timestamp: 4000 },
      { speedMps: 16, headingDeg: 66, timestamp: 5000 },
      { speedMps: 16, headingDeg: 66, timestamp: 6000 },
    ]);

    expect(events.map((e) => e.type)).toContain('harsh_cornering');
    expect(tracker.state.lateralMps2).toBeLessThan(12);
  });

  it('reports the speed at the moment of detection, while the car is still moving', () => {
    const tracker = new AccelerationTracker();
    const events = feed(tracker, [
      { speedMps: 30, timestamp: 0 },
      { speedMps: 22, timestamp: 1000 },
      { speedMps: 14, timestamp: 2000 },
      { speedMps: 6, timestamp: 3000 },
      { speedMps: 0, timestamp: 4000 },
      { speedMps: 0, timestamp: 5000 },
      { speedMps: 0, timestamp: 6000 },
      { speedMps: 0, timestamp: 7000 },
    ]);

    // Detection lands partway down the deceleration, not at its start and not
    // after the car has stopped.
    expect(events[0]!.speedAtDetectionMps).toBeGreaterThan(0);
    expect(events[0]!.speedAtDetectionMps).toBeLessThan(30);
  });

  it('flags harsh cornering', () => {
    const tracker = new AccelerationTracker();
    const events = feed(tracker, [
      { speedMps: 18, headingDeg: 0, timestamp: 0 },
      { speedMps: 18, headingDeg: 25, timestamp: 1000 },
      { speedMps: 18, headingDeg: 50, timestamp: 2000 },
      { speedMps: 18, headingDeg: 75, timestamp: 3000 },
      { speedMps: 18, headingDeg: 75, timestamp: 4000 },
      { speedMps: 18, headingDeg: 75, timestamp: 5000 },
      { speedMps: 18, headingDeg: 75, timestamp: 6000 },
    ]);

    expect(events.map((e) => e.type)).toContain('harsh_cornering');
  });

  it('does not report one long manoeuvre as many events', () => {
    const tracker = new AccelerationTracker();
    const brake = [30, 22, 14, 6, 0].map((speedMps, i) => ({ speedMps, timestamp: i * 1000 }));
    const coast = Array.from({ length: 4 }, (_, i) => ({
      speedMps: 0,
      timestamp: 5000 + i * 1000,
    }));

    // Brake hard, coast, brake hard again inside the cooldown window.
    const events = feed(tracker, [...brake, ...coast]);

    expect(events).toHaveLength(1);
  });

  it('resets every derived value', () => {
    const tracker = new AccelerationTracker();
    feed(tracker, [
      { speedMps: 20, headingDeg: 0, timestamp: 0 },
      { speedMps: 5, headingDeg: 40, timestamp: 1000 },
    ]);
    tracker.reset();

    expect(tracker.state).toEqual({
      longitudinalMps2: 0,
      lateralMps2: 0,
      yawRateDegPerSec: 0,
    });
  });
});
