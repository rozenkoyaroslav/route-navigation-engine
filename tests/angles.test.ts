import { describe, expect, it } from 'vitest';

import {
  angularDistanceDeg,
  isValidHeading,
  normalizeDeg,
  shortestDeltaDeg,
  stepTowardDeg,
} from '../src/geo/angles.js';

describe('normalizeDeg', () => {
  it('folds any angle into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(-370)).toBe(350);
    expect(normalizeDeg(720.5)).toBeCloseTo(0.5, 10);
  });
});

describe('shortestDeltaDeg', () => {
  it('takes the short way across the 0/360 seam', () => {
    expect(shortestDeltaDeg(350, 10)).toBe(20);
    expect(shortestDeltaDeg(10, 350)).toBe(-20);
  });

  it('is positive clockwise and negative counter-clockwise', () => {
    expect(shortestDeltaDeg(0, 90)).toBe(90);
    expect(shortestDeltaDeg(90, 0)).toBe(-90);
  });

  it('resolves the exact opposite consistently', () => {
    expect(shortestDeltaDeg(0, 180)).toBe(180);
    expect(shortestDeltaDeg(180, 0)).toBe(180);
  });

  it('never exceeds a half turn', () => {
    for (let from = 0; from < 360; from += 7) {
      for (let to = 0; to < 360; to += 11) {
        expect(Math.abs(shortestDeltaDeg(from, to))).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('angularDistanceDeg', () => {
  it('is symmetric and unsigned', () => {
    expect(angularDistanceDeg(350, 10)).toBe(20);
    expect(angularDistanceDeg(10, 350)).toBe(20);
  });
});

describe('stepTowardDeg', () => {
  it('snaps to the target when it is within reach', () => {
    expect(stepTowardDeg(0, 5, 10)).toBe(5);
  });

  it('moves by at most the allowed step', () => {
    expect(stepTowardDeg(0, 90, 10)).toBe(10);
    expect(stepTowardDeg(90, 0, 10)).toBe(80);
  });

  it('steps the short way across the seam instead of unwinding 340 degrees', () => {
    expect(stepTowardDeg(350, 10, 5)).toBe(355);
    expect(stepTowardDeg(10, 350, 5)).toBe(5);
  });

  it('converges without oscillating', () => {
    let heading = 0;
    for (let i = 0; i < 100; i += 1) heading = stepTowardDeg(heading, 270, 7);

    expect(heading).toBe(270);
  });
});

describe('isValidHeading', () => {
  it('rejects everything that is not a usable compass reading', () => {
    expect(isValidHeading(0)).toBe(true);
    expect(isValidHeading(359.9)).toBe(true);
    expect(isValidHeading(-1)).toBe(false); // providers use -1 for "unknown"
    expect(isValidHeading(null)).toBe(false);
    expect(isValidHeading(undefined)).toBe(false);
    expect(isValidHeading(Number.NaN)).toBe(false);
    expect(isValidHeading(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
