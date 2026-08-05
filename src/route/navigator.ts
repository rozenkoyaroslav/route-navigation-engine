import { pathLengthMeters } from '../geo/haversine.js';
import {
  AccelerationTracker,
  type AccelerationState,
  type DrivingEvent,
} from '../motion/acceleration.js';
import { SpeedFilter } from '../motion/speed.js';
import { estimateEta, type EtaResult } from './eta.js';
import { distanceToManeuver, findNextManeuver, instructionFor } from './maneuvers.js';
import { matchToRoute, OffRouteDetector } from './matcher.js';
import { remainingDistanceMeters, routeAhead, routeProgress } from './progress.js';
import type { LatLng, LocationSample, Maneuver, RouteMatch } from '../types.js';

export interface NavigatorOptions {
  /** Duration the routing provider predicted for the whole route, in seconds. */
  routeDurationSec?: number | null;
  /** Consecutive off-route updates before {@link NavigationState.shouldReroute}. */
  rerouteAfterOffRouteUpdates?: number;
}

export interface NavigationState {
  match: RouteMatch | null;
  /** The route from the driver's snapped position onward, for drawing. */
  ahead: LatLng[];
  distanceRemainingMeters: number;
  progress: number;
  eta: EtaResult;
  maneuver: Maneuver | null;
  instruction: string;
  distanceToManeuverMeters: number | null;
  isOffRoute: boolean;
  /** True once off-route has persisted long enough to justify a new route. */
  shouldReroute: boolean;
  speedMps: number;
  isMoving: boolean;
  acceleration: AccelerationState;
  /** A harsh-driving event completed on this update, if any. */
  drivingEvent: DrivingEvent | null;
}

const IDLE_STATE: Omit<NavigationState, 'speedMps' | 'isMoving' | 'acceleration'> = {
  match: null,
  ahead: [],
  distanceRemainingMeters: 0,
  progress: 0,
  eta: { seconds: 0, minutes: 0, source: 'fallback' },
  maneuver: null,
  instruction: 'Building route…',
  distanceToManeuverMeters: null,
  isOffRoute: false,
  shouldReroute: false,
  drivingEvent: null,
};

/**
 * Turns a stream of location samples into everything a navigation screen shows.
 *
 * The pieces below it are independent and individually testable; this is the
 * wiring, kept in one place so a screen has a single `update()` to call rather
 * than a dozen hooks that each re-derive the driver's position slightly
 * differently.
 *
 * Route matching is stateful on purpose: each match starts from the previous
 * segment (with a small look-back) instead of searching the whole route. On a
 * route that crosses itself, a global search will match the return leg to the
 * outbound one and throw progress backwards.
 */
export class RouteNavigator {
  private route: LatLng[] = [];
  private totalMeters = 0;
  private lastSegmentIndex = 0;
  private offRouteUpdates = 0;

  private readonly speedFilter = new SpeedFilter();
  private readonly offRoute = new OffRouteDetector();
  private readonly acceleration = new AccelerationTracker();
  private readonly options: Required<NavigatorOptions>;

  constructor(route: readonly LatLng[] = [], options: NavigatorOptions = {}) {
    this.options = {
      routeDurationSec: options.routeDurationSec ?? null,
      rerouteAfterOffRouteUpdates: options.rerouteAfterOffRouteUpdates ?? 2,
    };
    this.setRoute(route);
  }

  /** Replace the route — after a reroute, or when the trip's next leg begins. */
  setRoute(route: readonly LatLng[], routeDurationSec?: number | null): void {
    this.route = [...route];
    this.totalMeters = pathLengthMeters(this.route);
    this.lastSegmentIndex = 0;
    this.offRouteUpdates = 0;
    this.offRoute.reset();

    if (routeDurationSec !== undefined) this.options.routeDurationSec = routeDurationSec;
  }

  update(sample: LocationSample): NavigationState {
    const { speedMps, gatedSpeedMps, isMoving } = this.speedFilter.update(
      sample.speedMps,
      sample.accuracyMeters,
    );

    // Acceleration is derived from the gated-but-unsmoothed speed: the display
    // value has already been through an EMA, and differentiating that hides
    // exactly the sharp events this is meant to catch.
    const drivingEvent = this.acceleration.update({
      speedMps: gatedSpeedMps,
      headingDeg: sample.headingDeg,
      timestamp: sample.timestamp,
    });

    const motion = {
      speedMps,
      isMoving,
      acceleration: this.acceleration.state,
    };

    const location: LatLng = { latitude: sample.latitude, longitude: sample.longitude };
    const match = matchToRoute(location, this.route, {
      fromSegmentIndex: this.lastSegmentIndex,
      lookBackSegments: 2,
    });

    if (!match) return { ...IDLE_STATE, ...motion, drivingEvent };

    this.lastSegmentIndex = match.segmentIndex;

    const isOffRoute = this.offRoute.update(match.offsetMeters);
    this.offRouteUpdates = isOffRoute ? this.offRouteUpdates + 1 : 0;

    const distanceRemainingMeters = remainingDistanceMeters(this.route, match);
    const maneuver = findNextManeuver(this.route, match.segmentIndex);

    return {
      ...motion,
      match,
      ahead: routeAhead(this.route, match),
      distanceRemainingMeters,
      progress: routeProgress(this.route, match),
      eta: estimateEta({
        remainingMeters: distanceRemainingMeters,
        totalMeters: this.totalMeters,
        routeDurationSec: this.options.routeDurationSec,
        speedMps,
      }),
      maneuver,
      instruction: maneuver ? instructionFor(maneuver.kind) : 'Continue to destination',
      distanceToManeuverMeters: maneuver ? distanceToManeuver(this.route, match, maneuver) : null,
      isOffRoute,
      shouldReroute: this.offRouteUpdates >= this.options.rerouteAfterOffRouteUpdates,
      drivingEvent,
    };
  }

  reset(): void {
    this.speedFilter.reset();
    this.offRoute.reset();
    this.acceleration.reset();
    this.lastSegmentIndex = 0;
    this.offRouteUpdates = 0;
  }
}
