import { describe, expect, it } from 'vitest';

import { CameraPolicy } from '../src/camera/policy.js';
import { ORIGIN } from './helpers.js';

const location = (at: number, headingDeg = 90) =>
  ({ type: 'location', at, center: ORIGIN, headingDeg }) as const;

describe('CameraPolicy', () => {
  it('follows the driver in navigation mode', () => {
    const policy = new CameraPolicy();
    const command = policy.handle(location(0));

    expect(command).not.toBeNull();
    expect(command!.centerCoordinate).toEqual([ORIGIN.longitude, ORIGIN.latitude]);
    expect(command!.bearing).toBe(90);
    expect(command!.pitch).toBe(60);
  });

  it('throttles the flood of location updates', () => {
    const policy = new CameraPolicy({ throttleMs: 100 });

    expect(policy.handle(location(1000))).not.toBeNull();
    expect(policy.handle(location(1030))).toBeNull();
    expect(policy.handle(location(1060))).toBeNull();
    expect(policy.handle(location(1100))).not.toBeNull();
  });

  it('stops following after the driver pans the map', () => {
    const policy = new CameraPolicy({ gestureHoldMs: 4000 });
    policy.handle(location(0));

    expect(policy.handle({ type: 'user_gesture', at: 1000 })).toBeNull();
    expect(policy.handle(location(2000))).toBeNull();
    expect(policy.state(2000).following).toBe(false);
  });

  it('resumes following once the gesture hold expires', () => {
    const policy = new CameraPolicy({ gestureHoldMs: 4000 });
    policy.handle({ type: 'user_gesture', at: 1000 });

    expect(policy.handle(location(4999))).toBeNull();
    expect(policy.handle(location(5000))).not.toBeNull();
  });

  it('lets an explicit recenter override the gesture hold immediately', () => {
    const policy = new CameraPolicy({ gestureHoldMs: 60_000 });
    policy.handle({ type: 'user_gesture', at: 1000 });

    const command = policy.handle({
      type: 'recenter',
      at: 2000,
      center: ORIGIN,
      headingDeg: 45,
    });

    expect(command).not.toBeNull();
    expect(command!.bearing).toBe(45);
    expect(policy.state(2000).following).toBe(true);
  });

  it('flattens and zooms out for the overview, north-up', () => {
    const policy = new CameraPolicy();
    const command = policy.handle({
      type: 'set_mode',
      at: 0,
      mode: 'overview',
      center: ORIGIN,
      headingDeg: 123,
    });

    expect(command!.pitch).toBe(0);
    expect(command!.bearing).toBe(0);
    expect(command!.zoomLevel).toBeLessThan(18);
  });

  it('never auto-reverts out of the overview', () => {
    const policy = new CameraPolicy();
    policy.handle({ type: 'set_mode', at: 0, mode: 'overview', center: ORIGIN });

    for (let at = 1000; at <= 60_000; at += 1000) {
      expect(policy.handle(location(at))).toBeNull();
    }
    expect(policy.state(60_000).mode).toBe('overview');
  });

  it('returns to following when navigation mode is restored', () => {
    const policy = new CameraPolicy();
    policy.handle({ type: 'set_mode', at: 0, mode: 'overview', center: ORIGIN });

    const command = policy.handle({
      type: 'set_mode',
      at: 1000,
      mode: 'navigation',
      center: ORIGIN,
      headingDeg: 30,
    });

    expect(command!.pitch).toBe(60);
    expect(command!.bearing).toBe(30);
    expect(policy.handle(location(2000))).not.toBeNull();
  });

  it('ignores a mode change to the mode already in effect', () => {
    const policy = new CameraPolicy();

    expect(
      policy.handle({ type: 'set_mode', at: 0, mode: 'navigation', center: ORIGIN }),
    ).toBeNull();
  });

  it('changes mode without moving the camera when given no centre', () => {
    const policy = new CameraPolicy();

    expect(policy.handle({ type: 'set_mode', at: 0, mode: 'overview' })).toBeNull();
    expect(policy.state(0).mode).toBe('overview');
  });

  it('starts in navigation mode and returns there on reset', () => {
    const policy = new CameraPolicy();
    policy.handle({ type: 'set_mode', at: 0, mode: 'overview', center: ORIGIN });
    policy.handle({ type: 'user_gesture', at: 100 });
    policy.reset();

    expect(policy.state(200)).toEqual({ mode: 'navigation', following: true });
    expect(policy.handle(location(200))).not.toBeNull();
  });
});
