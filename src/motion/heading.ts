import {
  angularDistanceDeg,
  isValidHeading,
  normalizeDeg,
  shortestDeltaDeg,
  stepTowardDeg,
} from '../geo/angles.js';

export interface HeadingFilterOptions {
  /** Above this speed, GPS course is trusted over the compass, in m/s. */
  gpsTrustSpeedMps?: number;
  /** GPS course is ignored when the fix is worse than this. */
  gpsMaxAccuracyMeters?: number;
  /** Compass movements smaller than this are ignored while stationary. */
  compassDeadzoneDeg?: number;
  /** Hard ceiling on rotation speed, in degrees per second. */
  maxSlewDegPerSec?: number;
  /** EMA factor while stopped — low, because a parked car should look parked. */
  stationarySmoothing?: number;
  /** EMA factor while driving. */
  movingSmoothing?: number;
  /** EMA factor for large corrections, so real turns are not sluggish. */
  rapidTurnSmoothing?: number;
  /** Above this angular error the rapid-turn factor applies. */
  rapidTurnDeg?: number;
  /** Below this error the heading is treated as settled. */
  settleDeg?: number;
  /**
   * Frame duration assumed for the very first tick, in ms.
   *
   * The first tick has no previous timestamp to measure against, so there is no
   * elapsed time to derive a slew budget from. Assuming one frame keeps the cap
   * in force from the start; without it the first frame is unbounded and the
   * marker snaps to its target the instant the filter is created.
   */
  assumedFirstFrameMs?: number;
}

const DEFAULTS: Required<HeadingFilterOptions> = {
  gpsTrustSpeedMps: 3,
  gpsMaxAccuracyMeters: 25,
  compassDeadzoneDeg: 2.5,
  maxSlewDegPerSec: 540,
  stationarySmoothing: 0.14,
  movingSmoothing: 0.22,
  rapidTurnSmoothing: 0.34,
  rapidTurnDeg: 30,
  settleDeg: 0.3,
  assumedFirstFrameMs: 16,
};

/**
 * Fuses GPS course and magnetic compass into one heading, and animates toward
 * it smoothly.
 *
 * **Why fuse at all.** Neither source works alone. GPS course is derived from
 * successive positions, so it is accurate at speed and pure noise when
 * stationary — a parked car's reported course spins randomly. The magnetometer
 * works at a standstill but is dragged around by the car's own electronics, a
 * phone mount magnet, or a steel bridge overhead. So: compass below
 * `gpsTrustSpeedMps`, GPS course above it.
 *
 * **Why animate rather than assign.** Sensor updates are discrete and jumpy;
 * assigning each one directly makes the map marker snap between angles. The
 * filter holds a `current` heading and eases it toward the fused `target` with
 * an exponential factor chosen by context — gentle when parked, faster mid-turn
 * so a real corner does not lag behind the car.
 *
 * `maxSlewDegPerSec` then caps the result outright. Without it, a single bad
 * compass reading during a magnetic disturbance whips the marker across the
 * screen and back.
 *
 * Time is a parameter: {@link tick} takes `nowMs`, so behaviour is identical in
 * a test and on a device, and a dropped animation frame slows rotation rather
 * than skipping it.
 */
export class HeadingFilter {
  private readonly options: Required<HeadingFilterOptions>;
  private compassHeading: number | null = null;
  private gpsHeading: number | null = null;
  private target = 0;
  private current = 0;
  private lastTickMs: number | null = null;
  private movingFast = false;

  constructor(initialHeadingDeg = 0, options: HeadingFilterOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.target = normalizeDeg(initialHeadingDeg);
    this.current = this.target;
  }

  /** The animated heading to render, in degrees. */
  get heading(): number {
    return this.current;
  }

  /** The fused sensor heading the animation is easing toward. */
  get targetHeading(): number {
    return this.target;
  }

  /** Which sensor currently wins the fusion. */
  get activeSource(): 'gps' | 'compass' | 'none' {
    if (this.movingFast && isValidHeading(this.gpsHeading)) return 'gps';
    if (isValidHeading(this.compassHeading)) return 'compass';
    return isValidHeading(this.gpsHeading) ? 'gps' : 'none';
  }

  /** Feed a GPS course reading. A poor fix drops the course rather than using it. */
  updateFromGps(
    headingDeg: number | null | undefined,
    speedMps: number | null | undefined,
    accuracyMeters?: number | null,
  ): void {
    this.movingFast = (speedMps ?? 0) > this.options.gpsTrustSpeedMps;

    const accuracyOk =
      !Number.isFinite(accuracyMeters) ||
      (accuracyMeters ?? 0) <= this.options.gpsMaxAccuracyMeters;

    this.gpsHeading = accuracyOk && isValidHeading(headingDeg) ? normalizeDeg(headingDeg) : null;

    this.recomputeTarget();
  }

  /** Feed a compass reading. */
  updateFromCompass(headingDeg: number | null | undefined): void {
    if (!isValidHeading(headingDeg)) return;

    this.compassHeading = normalizeDeg(headingDeg);
    this.recomputeTarget();
  }

  /**
   * Advance the animation to `nowMs` and return the heading to render.
   *
   * Call once per frame. The elapsed time since the previous tick sets the slew
   * budget, so rotation speed stays constant regardless of frame rate.
   */
  tick(nowMs: number, isMoving = this.movingFast): number {
    const elapsedSec =
      this.lastTickMs === null
        ? this.options.assumedFirstFrameMs / 1000
        : Math.max(0, (nowMs - this.lastTickMs) / 1000);
    this.lastTickMs = nowMs;

    const error = angularDistanceDeg(this.current, this.target);
    if (error < this.options.settleDeg) {
      this.current = this.target;
      return this.current;
    }

    let smoothing: number;
    if (!isMoving) {
      smoothing = this.options.stationarySmoothing;
    } else if (error > this.options.rapidTurnDeg) {
      smoothing = this.options.rapidTurnSmoothing;
    } else {
      smoothing = this.options.movingSmoothing;
    }

    const easedStep = error * smoothing;
    const slewBudget = Math.max(1, this.options.maxSlewDegPerSec * elapsedSec);

    this.current = stepTowardDeg(this.current, this.target, Math.min(easedStep, slewBudget));
    return this.current;
  }

  reset(headingDeg = 0): void {
    this.target = normalizeDeg(headingDeg);
    this.current = this.target;
    this.compassHeading = null;
    this.gpsHeading = null;
    this.lastTickMs = null;
    this.movingFast = false;
  }

  private recomputeTarget(): void {
    const candidate = this.movingFast ? this.gpsHeading : (this.compassHeading ?? this.gpsHeading);

    if (!isValidHeading(candidate)) return;

    // Parked, the compass twitches a degree or two forever. Following that
    // rotates a stationary marker on screen for no reason.
    if (
      !this.movingFast &&
      Math.abs(shortestDeltaDeg(this.target, candidate)) < this.options.compassDeadzoneDeg
    ) {
      return;
    }

    this.target = candidate;
  }
}
