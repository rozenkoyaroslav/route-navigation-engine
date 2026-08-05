import { describe, expect, it } from 'vitest';

import { estimateEta } from '../src/route/eta.js';

describe('estimateEta', () => {
  it('is zero once there is nothing left to drive', () => {
    expect(estimateEta({ remainingMeters: 0, totalMeters: 1000 }).seconds).toBe(0);
  });

  it('scales the provider duration by the distance still to go', () => {
    const eta = estimateEta({
      remainingMeters: 500,
      totalMeters: 1000,
      routeDurationSec: 600,
    });

    expect(eta.source).toBe('route-duration');
    expect(eta.seconds).toBe(300);
  });

  it('blends live speed with the provider estimate', () => {
    const eta = estimateEta({
      remainingMeters: 1000,
      totalMeters: 2000,
      routeDurationSec: 400, // implies 200 s for the remaining half
      speedMps: 20, // implies 50 s
    });

    expect(eta.source).toBe('blended');
    expect(eta.seconds).toBeLessThan(200);
    expect(eta.seconds).toBeGreaterThan(50);
  });

  it('lets a jam the provider did not predict push the ETA up', () => {
    const inputs = { remainingMeters: 3000, totalMeters: 6000, routeDurationSec: 600 };

    const flowing = estimateEta({ ...inputs, speedMps: 15 });
    const crawling = estimateEta({ ...inputs, speedMps: 2 });

    expect(crawling.seconds).toBeGreaterThan(flowing.seconds);
  });

  it('ignores live speed while the driver is stopped', () => {
    // Otherwise a car at a red light has an ETA approaching infinity.
    const stopped = estimateEta({
      remainingMeters: 1000,
      totalMeters: 2000,
      routeDurationSec: 400,
      speedMps: 0,
    });

    expect(stopped.source).toBe('route-duration');
    expect(stopped.seconds).toBe(200);
  });

  it('falls back to live speed when the provider gave no duration', () => {
    const eta = estimateEta({ remainingMeters: 1000, totalMeters: 1000, speedMps: 10 });

    expect(eta.source).toBe('live-speed');
    expect(eta.seconds).toBe(100);
  });

  it('falls back to an assumed city speed when nothing is known', () => {
    const eta = estimateEta({ remainingMeters: 1000, totalMeters: 1000 });

    expect(eta.source).toBe('fallback');
    expect(eta.seconds).toBeCloseTo(120, -1);
  });

  it('ignores a nonsensical provider duration', () => {
    for (const routeDurationSec of [0, -10, Number.NaN, null, undefined]) {
      const eta = estimateEta({
        remainingMeters: 1000,
        totalMeters: 1000,
        routeDurationSec,
      });
      expect(eta.source).toBe('fallback');
    }
  });

  it('never shows zero minutes while the destination is still ahead', () => {
    const eta = estimateEta({ remainingMeters: 20, totalMeters: 5000, speedMps: 15 });

    expect(eta.seconds).toBeLessThan(30);
    expect(eta.minutes).toBe(1);
  });

  it('can be told to trust live speed completely', () => {
    const eta = estimateEta(
      { remainingMeters: 1000, totalMeters: 2000, routeDurationSec: 400, speedMps: 20 },
      { liveSpeedWeight: 1 },
    );

    expect(eta.seconds).toBe(50);
  });
});
