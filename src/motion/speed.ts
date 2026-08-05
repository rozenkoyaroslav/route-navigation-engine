export interface SpeedFilterOptions {
  /** EMA weight for each new sample, `0..1`. Higher reacts faster and is noisier. */
  smoothingAlpha?: number;
  /** Speed above which a stopped driver is considered moving, in m/s. */
  startMovingMps?: number;
  /** Speed below which a moving driver is considered stopped, in m/s. */
  stopMovingMps?: number;
  /** Accuracy worse than this makes low speed readings untrustworthy. */
  poorAccuracyMeters?: number;
  /** Speeds below this are zeroed when accuracy is poor. */
  noiseSpeedCeilingMps?: number;
}

const DEFAULTS: Required<SpeedFilterOptions> = {
  smoothingAlpha: 0.25,
  startMovingMps: 2.2,
  stopMovingMps: 0.9,
  poorAccuracyMeters: 20,
  noiseSpeedCeilingMps: 3,
};

export interface SpeedState {
  /** Smoothed ground speed in m/s — the value to display. */
  speedMps: number;
  /**
   * Noise-gated but unsmoothed speed.
   *
   * Anything differentiating speed — acceleration, harsh-braking detection —
   * must read this rather than `speedMps`. Running a derivative over an
   * already-smoothed signal smooths it a second time, and a real 8 m/s² stop
   * comes out of the two filters in series as a gentle 2 m/s² slowdown that
   * trips no threshold at all.
   */
  gatedSpeedMps: number;
  /** Debounced movement state. */
  isMoving: boolean;
}

/**
 * Smooths reported ground speed and decides whether the vehicle is moving.
 *
 * Two problems are solved here, and they are separate.
 *
 * **GPS jitter looks like creeping.** A phone sitting still with a poor fix
 * reports 1–2 m/s as the position wanders. Any speed under
 * `noiseSpeedCeilingMps` arriving with accuracy worse than
 * `poorAccuracyMeters` is treated as zero — a stationary car must read zero,
 * not "walking pace".
 *
 * **A single threshold flaps.** With one cutoff, a driver crawling at exactly
 * that speed toggles moving/stopped every sample, and anything keyed to it —
 * the map camera, waiting timers, trip state — toggles with it. Separate
 * start (2.2 m/s) and stop (0.9 m/s) thresholds give the state somewhere to
 * rest.
 */
export class SpeedFilter {
  private readonly options: Required<SpeedFilterOptions>;
  private smoothed = 0;
  private gated = 0;
  private moving = false;
  private seenSample = false;

  constructor(options: SpeedFilterOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  get state(): SpeedState {
    return { speedMps: this.smoothed, gatedSpeedMps: this.gated, isMoving: this.moving };
  }

  update(rawSpeedMps: number | null | undefined, accuracyMeters?: number | null): SpeedState {
    const raw = Number.isFinite(rawSpeedMps) ? Math.max(0, rawSpeedMps ?? 0) : 0;

    const poorAccuracy =
      Number.isFinite(accuracyMeters) && (accuracyMeters ?? 0) > this.options.poorAccuracyMeters;
    const filtered = poorAccuracy && raw < this.options.noiseSpeedCeilingMps ? 0 : raw;
    this.gated = filtered;

    // The first sample seeds the average outright: starting from zero would
    // otherwise ramp a driver already at speed up over several seconds.
    this.smoothed = this.seenSample
      ? this.smoothed * (1 - this.options.smoothingAlpha) + filtered * this.options.smoothingAlpha
      : filtered;
    this.seenSample = true;

    this.moving = this.moving
      ? this.smoothed > this.options.stopMovingMps
      : this.smoothed > this.options.startMovingMps;

    return this.state;
  }

  reset(): void {
    this.smoothed = 0;
    this.gated = 0;
    this.moving = false;
    this.seenSample = false;
  }
}
