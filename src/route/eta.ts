export interface EtaInputs {
  remainingMeters: number;
  totalMeters: number;
  /** Duration the routing provider predicted for the whole route, in seconds. */
  routeDurationSec?: number | null;
  /** Current smoothed ground speed in m/s. */
  speedMps?: number | null;
}

export interface EtaOptions {
  /** Speed assumed when nothing better is known, in m/s (~30 km/h). */
  fallbackSpeedMps?: number;
  /** Below this the driver counts as stopped and their speed is not used. */
  minUsableSpeedMps?: number;
  /**
   * How much to trust live speed over the provider's estimate, `0..1`.
   * `0` follows the provider exactly; `1` extrapolates current speed to the end.
   */
  liveSpeedWeight?: number;
}

const DEFAULTS: Required<EtaOptions> = {
  fallbackSpeedMps: 8.33,
  minUsableSpeedMps: 1.5,
  liveSpeedWeight: 0.3,
};

export interface EtaResult {
  seconds: number;
  minutes: number;
  source: 'route-duration' | 'blended' | 'live-speed' | 'fallback';
}

/**
 * Estimate remaining travel time.
 *
 * The provider's duration already encodes traffic, speed limits and turn costs
 * for the whole route, so remaining time is scaled from it by remaining
 * distance. But it was computed once, before the drive started — a driver stuck
 * in a jam it did not predict keeps seeing an ETA that never moves.
 *
 * So the two signals are blended rather than chosen between. The provider
 * estimate carries the route's structure; live speed carries what is happening
 * now. Extrapolating live speed alone is worse than either: a car waiting at a
 * light is not about to take infinite time to arrive, and one briefly doing
 * 90 km/h on a bypass will not hold that through the city streets ahead.
 *
 * Below `minUsableSpeedMps` the live term is dropped entirely for that reason.
 */
export function estimateEta(inputs: EtaInputs, options: EtaOptions = {}): EtaResult {
  const { fallbackSpeedMps, minUsableSpeedMps, liveSpeedWeight } = { ...DEFAULTS, ...options };
  const { remainingMeters, totalMeters, routeDurationSec, speedMps } = inputs;

  if (remainingMeters <= 0) return { seconds: 0, minutes: 0, source: 'route-duration' };

  const hasRouteDuration =
    routeDurationSec !== null &&
    routeDurationSec !== undefined &&
    Number.isFinite(routeDurationSec) &&
    routeDurationSec > 0 &&
    totalMeters > 0;

  const hasLiveSpeed =
    speedMps !== null &&
    speedMps !== undefined &&
    Number.isFinite(speedMps) &&
    speedMps >= minUsableSpeedMps;

  const routeSeconds = hasRouteDuration ? (remainingMeters / totalMeters) * routeDurationSec : null;
  const liveSeconds = hasLiveSpeed ? remainingMeters / speedMps : null;

  if (routeSeconds !== null && liveSeconds !== null) {
    const seconds = routeSeconds * (1 - liveSpeedWeight) + liveSeconds * liveSpeedWeight;
    return finalize(seconds, 'blended');
  }

  if (routeSeconds !== null) return finalize(routeSeconds, 'route-duration');
  if (liveSeconds !== null) return finalize(liveSeconds, 'live-speed');

  return finalize(remainingMeters / fallbackSpeedMps, 'fallback');
}

function finalize(seconds: number, source: EtaResult['source']): EtaResult {
  const rounded = Math.max(0, Math.round(seconds));
  return {
    seconds: rounded,
    // Never show "0 min" while the driver is still moving toward a destination.
    minutes: Math.max(1, Math.round(rounded / 60)),
    source,
  };
}
