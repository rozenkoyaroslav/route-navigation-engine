import { shortestDeltaDeg } from '../geo/angles.js';
import { bearingDeg, distanceMeters, pathLengthMeters } from '../geo/haversine.js';
import type { LatLng, Maneuver, ManeuverKind, RouteMatch } from '../types.js';

export interface ManeuverThresholds {
  /** Below this the road is considered straight. */
  straightDeg: number;
  slightDeg: number;
  turnDeg: number;
  /** At or above this the turn is a U-turn rather than a sharp turn. */
  uturnDeg: number;
}

export const DEFAULT_MANEUVER_THRESHOLDS: ManeuverThresholds = {
  straightDeg: 15,
  slightDeg: 35,
  turnDeg: 110,
  uturnDeg: 160,
};

/**
 * Classify a bearing change into a turn instruction.
 *
 * The 15° floor is what separates a turn from a curve. Roads bend constantly
 * and route geometry is sampled at vertices, so a threshold much below this
 * announces a turn for every bend in a motorway.
 */
export function classifyTurn(
  turnAngleDeg: number,
  thresholds: ManeuverThresholds = DEFAULT_MANEUVER_THRESHOLDS,
): ManeuverKind {
  const magnitude = Math.abs(turnAngleDeg);
  const right = turnAngleDeg > 0;

  if (magnitude >= thresholds.uturnDeg) return 'uturn';
  if (magnitude < thresholds.straightDeg) return 'straight';
  if (magnitude < thresholds.slightDeg) return right ? 'slight_right' : 'slight_left';
  if (magnitude < thresholds.turnDeg) return right ? 'right' : 'left';
  return right ? 'sharp_right' : 'sharp_left';
}

/**
 * Total bearing change at vertex `index`, accumulated over the vertices around
 * it rather than read from the two adjacent segments alone.
 *
 * Routing providers emit corners as several short segments — a 90° junction
 * often arrives as three 30° steps. Comparing only the two segments touching
 * the vertex sees 30° and calls a hard left "keep slightly left". Summing the
 * bearing change across the corner's vertices recovers the real angle.
 *
 * Only vertices within `windowMeters` are folded in, so a genuine turn is not
 * merged with the next one further down the road.
 */
export function turnAngleAtVertex(
  route: readonly LatLng[],
  index: number,
  windowMeters = 30,
): number {
  if (index <= 0 || index >= route.length - 1) return 0;

  let total = shortestDeltaDeg(
    bearingDeg(route[index - 1]!, route[index]!),
    bearingDeg(route[index]!, route[index + 1]!),
  );

  // Absorb the rest of a corner that was sampled as several short segments.
  let accumulated = distanceMeters(route[index]!, route[index + 1]!);
  for (let i = index + 1; i < route.length - 1 && accumulated <= windowMeters; i += 1) {
    total += shortestDeltaDeg(
      bearingDeg(route[i - 1]!, route[i]!),
      bearingDeg(route[i]!, route[i + 1]!),
    );
    accumulated += distanceMeters(route[i]!, route[i + 1]!);
  }

  return total;
}

/**
 * The next real turn at or after `fromSegmentIndex`, or `null` when the rest of
 * the route is straight.
 */
export function findNextManeuver(
  route: readonly LatLng[],
  fromSegmentIndex: number,
  thresholds: ManeuverThresholds = DEFAULT_MANEUVER_THRESHOLDS,
): Maneuver | null {
  for (let vertex = Math.max(1, fromSegmentIndex + 1); vertex < route.length - 1; vertex += 1) {
    const turnAngleDeg = turnAngleAtVertex(route, vertex);
    const kind = classifyTurn(turnAngleDeg, thresholds);

    if (kind !== 'straight') return { kind, vertexIndex: vertex, turnAngleDeg };
  }

  return null;
}

/** Driving distance from the driver's snapped position to a maneuver. */
export function distanceToManeuver(
  route: readonly LatLng[],
  match: RouteMatch,
  maneuver: Maneuver,
): number {
  if (maneuver.vertexIndex <= match.segmentIndex) return 0;

  const toSegmentEnd = distanceMeters(match.snapped, route[match.segmentIndex + 1]!);
  const between = pathLengthMeters(route.slice(match.segmentIndex + 1, maneuver.vertexIndex + 1));

  return toSegmentEnd + between;
}

const INSTRUCTIONS: Record<ManeuverKind, string> = {
  straight: 'Continue straight',
  slight_left: 'Keep slightly left',
  left: 'Turn left',
  sharp_left: 'Take a sharp left',
  slight_right: 'Keep slightly right',
  right: 'Turn right',
  sharp_right: 'Take a sharp right',
  uturn: 'Make a U-turn',
};

/**
 * English instruction text for a maneuver.
 *
 * Returns the plain phrase and leaves distance, formatting, and translation to
 * the caller — the phrasing of "in 200 m, turn left" differs per language in
 * ways string concatenation here cannot survive.
 */
export function instructionFor(kind: ManeuverKind): string {
  return INSTRUCTIONS[kind];
}
