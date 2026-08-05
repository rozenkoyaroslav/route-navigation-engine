/**
 * Simulates a drive along a short route and prints what a navigation screen
 * would show, plus the camera commands the map would receive.
 *
 * The trace is physically consistent: positions are integrated from the speed
 * profile at 1 Hz, so displacement between samples always equals the reported
 * speed. In a trace where the two disagree, every derived value — ETA,
 * acceleration, progress — is measuring a vehicle that cannot exist.
 *
 * Run with `npm run example`.
 */
import {
  CameraPolicy,
  HeadingFilter,
  RouteNavigator,
  bearingDeg,
  decodePolyline,
  distanceMeters,
  encodePolyline,
  pathLengthMeters,
  toRadians,
  type LatLng,
} from '../src/index.js';

const METERS_PER_DEG_LAT = 111_320;

function move(from: LatLng, bearing: number, meters: number): LatLng {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRadians(from.latitude));
  const rad = toRadians(bearing);
  return {
    latitude: from.latitude + (meters * Math.cos(rad)) / METERS_PER_DEG_LAT,
    longitude: from.longitude + (meters * Math.sin(rad)) / metersPerDegLng,
  };
}

function walk(start: LatLng, legs: readonly [number, number][]): LatLng[] {
  const points = [start];
  let current = start;
  for (const [bearing, meters] of legs) {
    current = move(current, bearing, meters);
    points.push(current);
  }
  return points;
}

/** Position at `meters` along the route, interpolating inside a segment. */
function pointAlongRoute(route: readonly LatLng[], meters: number): LatLng {
  let remaining = Math.max(0, meters);

  for (let i = 0; i < route.length - 1; i += 1) {
    const segment = distanceMeters(route[i]!, route[i + 1]!);
    if (remaining <= segment) {
      return move(route[i]!, bearingDeg(route[i]!, route[i + 1]!), remaining);
    }
    remaining -= segment;
  }

  return route[route.length - 1]!;
}

const START: LatLng = { latitude: 50.45, longitude: 30.52 };

// North 200 m, right, then left — corners sampled as short segments, the way
// a routing provider actually emits them.
const route = walk(START, [
  [0, 200],
  [30, 12],
  [60, 12],
  [90, 130],
  [60, 12],
  [30, 12],
  [0, 130],
]);

const encoded = encodePolyline(route, 6);
const decoded = decodePolyline(encoded, 6);
const totalMeters = pathLengthMeters(decoded);

console.log(`\nROUTE  ${route.length} points, ${Math.round(totalMeters)} m`);
console.log(`       encoded (precision 6): ${encoded}\n`);

/**
 * Ground speed in m/s, one sample per second.
 *
 * Cruise, then an emergency stop at speed (traffic halts abruptly), then back
 * up to speed, easing off for each corner and accelerating out of it.
 */
const speedProfile = [
  8,
  14,
  18,
  20,
  20,
  20,
  20,
  20,
  12,
  4,
  0,
  0, // emergency stop, roughly -8 m/s^2
  4,
  10,
  16,
  20,
  20,
  20,
  14,
  8,
  6, // easing off for the right turn
  8,
  14,
  18,
  20,
  20,
  14,
  8,
  6, // easing off for the left turn
  8,
  14,
  18,
  20,
  20,
  20,
];

const navigator = new RouteNavigator(decoded, { routeDurationSec: 60 });
const heading = new HeadingFilter(0);
const camera = new CameraPolicy();

const columns = [5, 24, 10, 12, 7, 8, 9] as const;
const row = (cells: readonly string[]): string =>
  cells.map((cell, i) => cell.padEnd(columns[i] ?? 10)).join('');

console.log('DRIVE  (printed on a change of instruction, on an event, or every 5 s)\n');
console.log(row(['t', 'instruction', 'to turn', 'remaining', 'eta', 'speed', 'accel']));

let travelled = 0;
let previousInstruction = '';
let previousPoint = decoded[0]!;
let cameraCommands = 0;
let headingFrames = 0;

speedProfile.forEach((speedMps, second) => {
  const timestamp = second * 1000;

  // Integrate distance from speed: at 1 Hz, metres travelled == m/s reported.
  travelled += speedMps;
  const point = pointAlongRoute(decoded, travelled);

  // Course over ground, derived from successive positions exactly as a GPS
  // receiver derives it — and undefined while stopped, exactly as there too.
  const courseDeg = speedMps > 0 ? bearingDeg(previousPoint, point) : null;
  previousPoint = point;

  const state = navigator.update({
    latitude: point.latitude,
    longitude: point.longitude,
    speedMps,
    headingDeg: courseDeg,
    accuracyMeters: 6,
    timestamp,
  });

  heading.updateFromGps(courseDeg, state.speedMps, 6);

  // The map renders at 60 fps; the camera policy decides how much of that the
  // map SDK is actually asked to animate.
  for (let frame = 0; frame < 60; frame += 1) {
    const frameAt = timestamp + frame * 16;
    const rendered = heading.tick(frameAt, state.isMoving);
    headingFrames += 1;

    if (camera.handle({ type: 'location', at: frameAt, center: point, headingDeg: rendered })) {
      cameraCommands += 1;
    }
  }

  const instructionChanged = state.instruction !== previousInstruction;
  previousInstruction = state.instruction;

  if (instructionChanged || state.drivingEvent || second % 5 === 0) {
    console.log(
      row([
        `${second}s`,
        state.instruction,
        state.distanceToManeuverMeters === null
          ? '-'
          : `${Math.round(state.distanceToManeuverMeters)} m`,
        `${Math.round(state.distanceRemainingMeters)} m`,
        `${state.eta.minutes}m`,
        state.speedMps.toFixed(1),
        state.acceleration.longitudinalMps2.toFixed(2),
      ]),
    );
  }

  if (state.drivingEvent) {
    const event = state.drivingEvent;
    console.log(
      `      !! ${event.type} - peak ${event.peakMps2.toFixed(2)} m/s^2 ` +
        `detected at ${event.speedAtDetectionMps.toFixed(1)} m/s, ` +
        `lasting ${event.endedAt - event.startedAt} ms`,
    );
  }
});

console.log(`\n       drove ${Math.round(travelled)} m of ${Math.round(totalMeters)} m\n`);

console.log('CAMERA\n');
console.log(`  ${headingFrames} heading frames rendered at 60 fps`);
console.log(`  ${cameraCommands} camera commands issued - the rest absorbed by the throttle`);

// The driver pans the map to look ahead; following stops until they recenter.
const panAt = speedProfile.length * 1000;
camera.handle({ type: 'user_gesture', at: panAt });
const duringPan = camera.handle({
  type: 'location',
  at: panAt + 500,
  center: route[2]!,
  headingDeg: 90,
});
const recentred = camera.handle({
  type: 'recenter',
  at: panAt + 1000,
  center: route[2]!,
  headingDeg: 90,
});

console.log(
  `  after a pan, a location update returns ${duringPan === null ? 'null' : 'a command'}`,
);
console.log(
  `  recenter returns a command: pitch ${recentred!.pitch}, zoom ${recentred!.zoomLevel}\n`,
);

console.log('OFF ROUTE\n');

const strayed = move(pointAlongRoute(decoded, 100), 90, 120);
for (let i = 0; i < 4; i += 1) {
  const state = navigator.update({
    latitude: strayed.latitude,
    longitude: strayed.longitude,
    speedMps: 10,
    headingDeg: 90,
    accuracyMeters: 6,
    timestamp: 100_000 + i * 1000,
  });

  console.log(
    `  sample ${i + 1}: offset ${Math.round(state.match?.offsetMeters ?? 0)} m  ` +
      `offRoute=${String(state.isOffRoute)}  shouldReroute=${String(state.shouldReroute)}`,
  );
}

console.log('\n  Three samples to believe it, one more before spending a routing request.\n');
