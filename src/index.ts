export type { LatLng, LocationSample, Maneuver, ManeuverKind, RouteMatch } from './types.js';

export {
  angularDistanceDeg,
  isValidHeading,
  normalizeDeg,
  shortestDeltaDeg,
  stepTowardDeg,
  toDegrees,
  toRadians,
} from './geo/angles.js';
export {
  bearingDeg,
  distanceMeters,
  pathLengthMeters,
  EARTH_RADIUS_METERS,
} from './geo/haversine.js';
export { decodePolyline, encodePolyline } from './geo/polyline.js';
export { projectOnSegment, type SegmentProjection } from './geo/projection.js';

export {
  matchToRoute,
  OffRouteDetector,
  type MatchOptions,
  type OffRouteOptions,
} from './route/matcher.js';
export {
  remainingDistanceMeters,
  routeAhead,
  routeProgress,
  traveledDistanceMeters,
} from './route/progress.js';
export {
  classifyTurn,
  distanceToManeuver,
  findNextManeuver,
  instructionFor,
  turnAngleAtVertex,
  DEFAULT_MANEUVER_THRESHOLDS,
  type ManeuverThresholds,
} from './route/maneuvers.js';
export { estimateEta, type EtaInputs, type EtaOptions, type EtaResult } from './route/eta.js';
export { RouteNavigator, type NavigationState, type NavigatorOptions } from './route/navigator.js';

export { SpeedFilter, type SpeedFilterOptions, type SpeedState } from './motion/speed.js';
export { HeadingFilter, type HeadingFilterOptions } from './motion/heading.js';
export {
  AccelerationTracker,
  type AccelerationOptions,
  type AccelerationState,
  type DrivingEvent,
  type DrivingEventType,
} from './motion/acceleration.js';

export {
  CameraPolicy,
  type CameraCommand,
  type CameraEvent,
  type CameraMode,
  type CameraPolicyOptions,
  type CameraPolicyState,
} from './camera/policy.js';
