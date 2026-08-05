export interface LatLng {
  latitude: number;
  longitude: number;
}

/** A position sample as it arrives from the platform's location provider. */
export interface LocationSample {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in meters. Larger means less trustworthy. */
  accuracyMeters?: number | null;
  /** Ground speed in m/s, if the provider reports one. */
  speedMps?: number | null;
  /** Course over ground in degrees, `0` = north. Meaningless when stationary. */
  headingDeg?: number | null;
  /** Sample timestamp in epoch milliseconds. */
  timestamp: number;
}

export type ManeuverKind =
  | 'straight'
  | 'slight_left'
  | 'left'
  | 'sharp_left'
  | 'slight_right'
  | 'right'
  | 'sharp_right'
  | 'uturn';

export interface Maneuver {
  kind: ManeuverKind;
  /** Index of the route vertex where the turn happens. */
  vertexIndex: number;
  /** Signed bearing change in degrees; positive is clockwise (right). */
  turnAngleDeg: number;
}

export interface RouteMatch {
  /** Index of the polyline segment `[i, i + 1]` the driver is closest to. */
  segmentIndex: number;
  /** The driver's position projected onto that segment. */
  snapped: LatLng;
  /** Perpendicular distance from the raw position to the route, in meters. */
  offsetMeters: number;
  /** How far along the matched segment the projection fell, `0..1`. */
  segmentProgress: number;
}
