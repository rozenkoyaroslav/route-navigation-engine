import { distanceMeters } from '../geo/haversine.js';
import { projectOnSegment } from '../geo/projection.js';
import type { LatLng, RouteMatch } from '../types.js';

export interface MatchOptions {
  /**
   * Only consider segments from here onward.
   *
   * Routes cross themselves — a loop, a return leg on the same street — and a
   * global nearest-segment search will happily match a driver on the return leg
   * to the outbound one, teleporting progress backwards. Passing the previous
   * match constrains the search to the future.
   */
  fromSegmentIndex?: number;
  /**
   * How far back from `fromSegmentIndex` to still look, in segments. A small
   * window lets the match recover when the driver genuinely doubles back.
   */
  lookBackSegments?: number;
}

/**
 * Snap a raw position onto the route.
 *
 * Returns the closest segment, the perpendicular offset, and the projected
 * point — everything downstream (progress, off-route, remaining distance) is
 * derived from this one result rather than recomputing its own idea of "where
 * the driver is".
 */
export function matchToRoute(
  location: LatLng,
  route: readonly LatLng[],
  options: MatchOptions = {},
): RouteMatch | null {
  if (route.length < 2) return null;

  const { fromSegmentIndex = 0, lookBackSegments = 0 } = options;
  const start = Math.max(0, Math.min(fromSegmentIndex - lookBackSegments, route.length - 2));

  let best: RouteMatch | null = null;

  for (let i = start; i < route.length - 1; i += 1) {
    const projection = projectOnSegment(location, route[i]!, route[i + 1]!);
    const offset = distanceMeters(location, projection.point);

    if (!best || offset < best.offsetMeters) {
      best = {
        segmentIndex: i,
        snapped: projection.point,
        offsetMeters: offset,
        segmentProgress: projection.t,
      };
    }
  }

  return best;
}

export interface OffRouteOptions {
  /** Offset beyond which a sample counts as off-route. */
  enterThresholdMeters?: number;
  /** Offset below which a sample counts as back on route. */
  exitThresholdMeters?: number;
  /** Consecutive off-route samples required before declaring off-route. */
  enterSamples?: number;
  /** Consecutive on-route samples required before clearing it. */
  exitSamples?: number;
}

const OFF_ROUTE_DEFAULTS: Required<OffRouteOptions> = {
  enterThresholdMeters: 45,
  exitThresholdMeters: 25,
  enterSamples: 3,
  exitSamples: 2,
};

/**
 * Debounced off-route detection.
 *
 * A single sample over the threshold means nothing: GPS in a street canyon
 * routinely throws one reading 60 m sideways before snapping back. Triggering a
 * reroute on that costs a routing request and, worse, replaces a correct route
 * with one computed from a phantom position.
 *
 * Two mechanisms guard against it. **Hysteresis** — leaving requires 45 m,
 * returning requires 25 m — stops the state flapping for a driver hovering at
 * the boundary. **Consecutive-sample counting** requires the excursion to
 * persist before it is believed.
 */
export class OffRouteDetector {
  private readonly options: Required<OffRouteOptions>;
  private offRoute = false;
  private consecutiveOff = 0;
  private consecutiveOn = 0;

  constructor(options: OffRouteOptions = {}) {
    this.options = { ...OFF_ROUTE_DEFAULTS, ...options };
  }

  get isOffRoute(): boolean {
    return this.offRoute;
  }

  /** Feed one matched offset; returns the debounced off-route state. */
  update(offsetMeters: number): boolean {
    if (this.offRoute) {
      if (offsetMeters <= this.options.exitThresholdMeters) {
        this.consecutiveOn += 1;
        if (this.consecutiveOn >= this.options.exitSamples) {
          this.offRoute = false;
          this.consecutiveOff = 0;
        }
      } else {
        this.consecutiveOn = 0;
      }
      return this.offRoute;
    }

    if (offsetMeters > this.options.enterThresholdMeters) {
      this.consecutiveOff += 1;
      if (this.consecutiveOff >= this.options.enterSamples) {
        this.offRoute = true;
        this.consecutiveOn = 0;
      }
    } else {
      this.consecutiveOff = 0;
    }

    return this.offRoute;
  }

  reset(): void {
    this.offRoute = false;
    this.consecutiveOff = 0;
    this.consecutiveOn = 0;
  }
}
