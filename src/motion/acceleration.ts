import { shortestDeltaDeg, toRadians } from '../geo/angles.js';

export type DrivingEventType = 'harsh_acceleration' | 'harsh_braking' | 'harsh_cornering';

export interface DrivingEvent {
  type: DrivingEventType;
  /** Peak magnitude that triggered the event, in m/s². */
  peakMps2: number;
  startedAt: number;
  endedAt: number;
  /**
   * Ground speed at the moment the threshold was crossed, in m/s.
   *
   * Not "the speed the manoeuvre began at": the smoothed signal crosses the
   * threshold partway through, so a stop from 20 m/s is detected at 4 and an
   * acceleration to 20 is detected near 20. Reported as the plain fact rather
   * than dressed up as an entry speed it cannot know.
   */
  speedAtDetectionMps: number;
}

export interface AccelerationState {
  /** Along the direction of travel. Positive accelerates, negative brakes. */
  longitudinalMps2: number;
  /** Sideways, from cornering. Always reported as a magnitude. */
  lateralMps2: number;
  /** Rate of heading change in degrees per second. */
  yawRateDegPerSec: number;
}

export interface AccelerationOptions {
  /** EMA weight applied to derived acceleration, `0..1`. */
  smoothingAlpha?: number;
  harshAccelerationMps2?: number;
  /** Positive magnitude; braking is compared against its negation. */
  harshBrakingMps2?: number;
  harshCorneringMps2?: number;
  /** An event must persist this long before it is reported, in ms. */
  minEventDurationMs?: number;
  /** Quiet period after an event before the same type can fire again, in ms. */
  cooldownMs?: number;
  /** Samples farther apart than this restart the derivation, in ms. */
  maxSampleGapMs?: number;
  /** Cornering is not evaluated below this speed, in m/s. */
  minCorneringSpeedMps?: number;
  /**
   * Lateral acceleration above which the yaw estimate is rejected as an
   * artefact rather than believed, in m/s².
   *
   * Tyres on dry asphalt give out around 1 g. A computed value far above that
   * does not describe a violent manoeuvre — it describes a corner the sampling
   * rate could not resolve: at 1 Hz a square junction arrives as a 90° heading
   * change in one sample, which `a = v · ω` turns into an impossible 30 m/s².
   * Believing it would report a hard corner every time a route turns.
   */
  maxPlausibleLateralMps2?: number;
}

const DEFAULTS: Required<AccelerationOptions> = {
  smoothingAlpha: 0.3,
  harshAccelerationMps2: 3,
  harshBrakingMps2: 3.5,
  harshCorneringMps2: 3.5,
  minEventDurationMs: 300,
  cooldownMs: 3000,
  maxSampleGapMs: 5000,
  minCorneringSpeedMps: 4,
  maxPlausibleLateralMps2: 12,
};

interface PendingEvent {
  type: DrivingEventType;
  startedAt: number;
  peakMps2: number;
  speedAtDetectionMps: number;
}

/**
 * Derives acceleration from the location stream and flags harsh driving.
 *
 * **Why derive instead of reading the accelerometer.** A phone's accelerometer
 * measures the *phone*, not the car: it reads gravity plus every bump, and its
 * axes point wherever the device happens to lie in a cupholder. Separating
 * vehicle motion from that needs the device's orientation and a gravity
 * estimate, and it still breaks the moment the phone is picked up. Differencing
 * the GPS speed the platform already reports is coarser in time but measures
 * the vehicle, and is unaffected by how the phone is held.
 *
 * **Lateral acceleration comes from the turn, not from a sensor.** A vehicle
 * turning at yaw rate ω while travelling at v experiences `a = v · ω` sideways
 * (ω in radians per second). That is why the same steering input is gentle at
 * walking pace and violent at motorway speed, and it is why cornering is only
 * evaluated above `minCorneringSpeedMps` — heading is meaningless at a
 * standstill, so a stationary compass twitch would otherwise register as a
 * hard corner.
 *
 * **Why events need duration and cooldown.** A single sample over the threshold
 * is usually a GPS artefact. Requiring the excursion to persist for
 * `minEventDurationMs` filters those out, and the cooldown stops one long
 * braking manoeuvre from being reported as a dozen separate ones.
 */
export class AccelerationTracker {
  private readonly options: Required<AccelerationOptions>;
  private lastSpeedMps: number | null = null;
  private lastHeadingDeg: number | null = null;
  private lastTimestamp: number | null = null;
  private longitudinal = 0;
  private lateral = 0;
  private yawRate = 0;
  private pending: PendingEvent | null = null;
  private readonly lastEventAt = new Map<DrivingEventType, number>();

  constructor(options: AccelerationOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  get state(): AccelerationState {
    return {
      longitudinalMps2: this.longitudinal,
      lateralMps2: this.lateral,
      yawRateDegPerSec: this.yawRate,
    };
  }

  /**
   * Feed one sample. Returns a completed event on the tick it finishes,
   * otherwise `null`.
   */
  update(sample: {
    speedMps: number;
    headingDeg?: number | null;
    timestamp: number;
  }): DrivingEvent | null {
    const { speedMps, headingDeg, timestamp } = sample;

    const elapsedMs = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;

    // A gap means the app was backgrounded or the fix was lost. Differencing
    // across it would invent an enormous acceleration out of a stale speed.
    if (elapsedMs <= 0 || elapsedMs > this.options.maxSampleGapMs) {
      this.seed(speedMps, headingDeg, timestamp);
      return null;
    }

    const elapsedSec = elapsedMs / 1000;

    const rawLongitudinal = (speedMps - (this.lastSpeedMps ?? speedMps)) / elapsedSec;
    this.longitudinal = this.smooth(this.longitudinal, rawLongitudinal);

    if (
      this.lastHeadingDeg !== null &&
      headingDeg !== null &&
      headingDeg !== undefined &&
      Number.isFinite(headingDeg)
    ) {
      const rawYawRate = shortestDeltaDeg(this.lastHeadingDeg, headingDeg) / elapsedSec;
      const corneringSpeed = Math.max(speedMps, this.lastSpeedMps ?? 0);
      const rawLateral = Math.abs(corneringSpeed * toRadians(rawYawRate));

      if (rawLateral > this.options.maxPlausibleLateralMps2) {
        // Rejected at intake, before the average sees it. Screening the
        // smoothed value instead is too late: the EMA drags an impossible
        // 31 m/s² spike down to a believable 9 and it raises an event.
        this.yawRate = 0;
        this.lateral = 0;
      } else {
        this.yawRate = this.smooth(this.yawRate, rawYawRate);
        this.lateral =
          corneringSpeed >= this.options.minCorneringSpeedMps
            ? Math.abs(corneringSpeed * toRadians(this.yawRate))
            : 0;
      }
    } else {
      this.yawRate = 0;
      this.lateral = 0;
    }

    this.lastSpeedMps = speedMps;
    this.lastHeadingDeg = headingDeg ?? this.lastHeadingDeg;
    this.lastTimestamp = timestamp;

    return this.trackEvent(timestamp, speedMps);
  }

  reset(): void {
    this.lastSpeedMps = null;
    this.lastHeadingDeg = null;
    this.lastTimestamp = null;
    this.longitudinal = 0;
    this.lateral = 0;
    this.yawRate = 0;
    this.pending = null;
    this.lastEventAt.clear();
  }

  private seed(speedMps: number, headingDeg: number | null | undefined, timestamp: number): void {
    this.lastSpeedMps = speedMps;
    this.lastHeadingDeg = headingDeg ?? null;
    this.lastTimestamp = timestamp;
    this.longitudinal = 0;
    this.lateral = 0;
    this.yawRate = 0;
    this.pending = null;
  }

  private smooth(previous: number, next: number): number {
    return previous * (1 - this.options.smoothingAlpha) + next * this.options.smoothingAlpha;
  }

  private classify(): { type: DrivingEventType; magnitude: number } | null {
    if (this.longitudinal >= this.options.harshAccelerationMps2) {
      return { type: 'harsh_acceleration', magnitude: this.longitudinal };
    }
    if (this.longitudinal <= -this.options.harshBrakingMps2) {
      return { type: 'harsh_braking', magnitude: this.longitudinal };
    }
    if (this.lateral >= this.options.harshCorneringMps2) {
      return { type: 'harsh_cornering', magnitude: this.lateral };
    }
    return null;
  }

  private trackEvent(timestamp: number, speedMps: number): DrivingEvent | null {
    const breach = this.classify();

    if (breach) {
      if (this.pending && this.pending.type === breach.type) {
        if (Math.abs(breach.magnitude) > Math.abs(this.pending.peakMps2)) {
          this.pending.peakMps2 = breach.magnitude;
        }
      } else {
        this.pending = {
          type: breach.type,
          startedAt: timestamp,
          peakMps2: breach.magnitude,
          speedAtDetectionMps: speedMps,
        };
      }
      return null;
    }

    // The excursion just ended: report it if it lasted long enough and the same
    // event type is not still in cooldown.
    const pending = this.pending;
    this.pending = null;
    if (!pending) return null;

    const durationMs = timestamp - pending.startedAt;
    if (durationMs < this.options.minEventDurationMs) return null;

    const previousAt = this.lastEventAt.get(pending.type);
    if (previousAt !== undefined && timestamp - previousAt < this.options.cooldownMs) return null;

    this.lastEventAt.set(pending.type, timestamp);

    return {
      type: pending.type,
      peakMps2: pending.peakMps2,
      startedAt: pending.startedAt,
      endedAt: timestamp,
      speedAtDetectionMps: pending.speedAtDetectionMps,
    };
  }
}
