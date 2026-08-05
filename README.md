# route-navigation-engine

[![CI](https://github.com/rozenkoyaroslav/route-navigation-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/rozenkoyaroslav/route-navigation-engine/actions/workflows/ci.yml)
[![Pages](https://github.com/rozenkoyaroslav/route-navigation-engine/actions/workflows/pages.yml/badge.svg)](https://github.com/rozenkoyaroslav/route-navigation-engine/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**▶ [Interactive playground](https://rozenkoyaroslav.github.io/route-navigation-engine/)** — the library running live in the browser, compiled straight from `src/`.

Turn-by-turn navigation core for a driver app — route matching, maneuver
detection, sensor fusion, acceleration telemetry and map camera policy —
extracted from a production React Native / Mapbox app and rebuilt as a
standalone, dependency-free TypeScript package.

```bash
npm install
npm test          # 149 tests
npm run lint
npm run example   # simulated drive, printed
```

**No dependencies, no React, no Mapbox, no clock.** Every input is passed in:
positions, timestamps, sensor readings. That is what makes a mid-drive bug
reproducible from a recorded trace instead of only on a phone, in traffic.

The map SDK is not imported anywhere. `CameraPolicy` emits plain objects shaped
for `Mapbox.Camera.setCamera`, and the twenty lines that pass them to a real map
stay in the app.

---

## What it does

```ts
import { RouteNavigator, decodePolyline } from 'route-navigation-engine';

const navigator = new RouteNavigator(decodePolyline(route.geometry, 6), {
  routeDurationSec: route.duration,
});

// One call per location update.
const state = navigator.update({
  latitude: 50.4501,
  longitude: 30.5234,
  speedMps: 12.4,
  headingDeg: 87,
  accuracyMeters: 6,
  timestamp: Date.now(),
});
```

```
state.instruction              'Turn right'
state.distanceToManeuverMeters 180
state.distanceRemainingMeters  1_640
state.eta                      { seconds: 214, minutes: 4, source: 'blended' }
state.progress                 0.37
state.ahead                    [ …route from the driver onward, for drawing ]
state.isOffRoute               false
state.shouldReroute            false
state.speedMps                 12.1
state.acceleration             { longitudinalMps2: -0.4, lateralMps2: 1.2, … }
state.drivingEvent             null
```

---

## Route matching

Everything downstream — progress, remaining distance, off-route, the drawn line
— derives from one snapped position, rather than each recomputing its own idea
of where the driver is.

**Projection is done on a local plane, not on the sphere.** Route segments are
tens of meters long; flattening (latitude × constant, longitude × cos lat) turns
a cross-track calculation into a dot product, with millimetre error at that
scale. It runs once per segment per GPS sample, so it matters.

**`t` is clamped to `0..1`.** Without the clamp, a driver who has overshot a turn
projects onto the infinite line through the segment and still appears to be on
the road they left.

**Matching is stateful.** Each match starts from the previous segment with a
small look-back, instead of searching the whole route. On a route that crosses
itself — a loop, a return leg down the same street — a global nearest-segment
search matches the return leg to the outbound one and throws progress backwards.
There is a test for exactly that.

**Remaining distance is measured from the snapped point.** Measuring from the
segment start makes remaining distance tick _up_ every time the driver crosses a
vertex, which is the most visible way to make a navigation UI look broken.

### Off-route detection is debounced

A single sample past the threshold means nothing — GPS in a street canyon
routinely throws one reading 60 m sideways and snaps back. Rerouting on that
costs a routing request and replaces a correct route with one computed from a
phantom position.

```
enter: 45 m, sustained over 3 samples
exit:  25 m, sustained over 2 samples
```

Hysteresis stops the state flapping for a driver hovering at the boundary;
consecutive-sample counting requires the excursion to persist before it is
believed. `shouldReroute` then waits for off-route to hold for two more updates,
so believing the driver left the route and spending a request on it are separate
decisions.

---

## Maneuver detection

A turn is a bearing change between consecutive route segments — but a corner is
rarely one segment.

Routing providers emit a 90° junction as three 30° steps. Comparing only the two
segments touching a vertex sees 30° and announces "keep slightly right" at a
hard left turn. So the bearing change is accumulated across the vertices of the
corner, bounded by a 30 m window so a real turn is not merged with the next one:

```ts
turnAngleAtVertex(route, i, 0); // 30  -> 'slight_right'   (adjacent segments)
turnAngleAtVertex(route, i); // 90  -> 'right'          (windowed)
```

Classification runs on the accumulated angle: under 15° is road curvature, not a
turn; then slight / turn / sharp, with U-turns split out above 160°.

`instructionFor()` returns the bare phrase and leaves distance and formatting to
the caller — "in 200 m, turn left" reorders in ways string concatenation here
cannot survive.

---

## Sensor fusion

Neither heading source works alone:

|               | GPS course                                      | Magnetometer                                               |
| ------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Derived from  | successive positions                            | Earth's magnetic field                                     |
| Accurate when | moving                                          | always, in principle                                       |
| Fails when    | stationary — the reported course spins randomly | near the car's electronics, a mount magnet, a steel bridge |

So `HeadingFilter` takes the compass below 3 m/s and GPS course above it, and
drops GPS course entirely when the fix is worse than 25 m.

Fusing is only half of it. Sensor updates are discrete and jumpy; assigning each
one straight to the marker makes it snap between angles. The filter holds a
current heading and eases it toward the fused target, with the easing factor
chosen by context — gentle when parked, faster mid-turn so a real corner does
not lag behind the car — and then caps the result at 540°/s outright, so one bad
compass reading during a magnetic disturbance cannot whip the marker across the
screen and back.

```ts
heading.updateFromGps(sample.headingDeg, sample.speedMps, sample.accuracyMeters);
heading.updateFromCompass(compass.trueHeading);

// Once per frame. Time is a parameter, not a clock read.
const rendered = heading.tick(performance.now());
```

Because `tick` takes the time, a dropped animation frame slows the rotation
rather than skipping it, and the whole filter is testable without faking timers.
Angles are handled through one set of helpers, so 350° → 10° rotates 20°
clockwise rather than 340° the other way — everywhere, not just where someone
remembered.

---

## Acceleration and harsh-driving events

**Derived from the location stream, not from the accelerometer.** A phone's
accelerometer measures the _phone_: gravity plus every bump, on axes pointing
wherever the device happens to lie in a cupholder. Recovering vehicle motion
from that needs device orientation and a gravity estimate, and it breaks the
moment someone picks the phone up. Differencing reported ground speed is coarser
in time but measures the vehicle, and does not care how the phone is held.

**Lateral acceleration comes from the turn.** A vehicle at speed `v` turning at
yaw rate `ω` experiences `a = v · ω` sideways. That is why the same steering
input is nothing at walking pace and violent on a slip road — and why cornering
is only evaluated above 4 m/s, since heading is meaningless at a standstill and
a parked compass twitch would otherwise register as a hard corner.

Events require the excursion to persist (300 ms) and impose a per-type cooldown
(3 s), so a GPS artefact is not an event and one long braking manoeuvre is not
reported as a dozen.

```
⚠ harsh_braking — peak -4.71 m/s² at 22.0 m/s
```

**One subtlety worth the note.** The pipeline smooths speed for display, and
acceleration is a derivative of speed. Feeding the smoothed value into the
derivative smooths it twice, and a real 8 m/s² emergency stop emerges from the
two filters in series as a gentle 2 m/s² slowdown that trips no threshold at
all. So `SpeedFilter` exposes both: `speedMps` for display, `gatedSpeedMps` —
noise-gated but unsmoothed — for anything differentiating it.

---

## Camera policy

The part of a navigation screen that usually degenerates into a knot of refs and
effects: a follow flag, a "user touched the map" timer, a throttle timestamp, a
previous-mode ref, all mutated from different callbacks. Modelled as a reducer,
it is a pure function of (state, event) and testable without a renderer.

```ts
const command = camera.handle({ type: 'location', at, center, headingDeg });
if (command) cameraRef.current?.setCamera(command);
```

- **Throttled.** Location updates arrive far faster than the camera can animate;
  a command per update fights the animation already in flight.
- **Gesture wins.** After a pan, following is suspended for 4 s and location
  updates are ignored. Recentring is the driver's decision, not a timeout's.
- **Overview is deliberate.** It flattens pitch, zooms out, and goes north-up —
  and never auto-reverts, because a driver who asked for the overview is reading
  it.

---

## Polyline codec

Implemented rather than depended on — it is forty lines, and the alternative is
a package with its own opinions about coordinate order.

`precision` is an explicit argument because it is a silent failure otherwise:
Google and Mapbox Directions v4 use 5, Mapbox v5 and OSRM use 6, and decoding a
6 as a 5 yields coordinates off by a factor of ten with no error anywhere. There
is a test that demonstrates the wrong answer.

---

## Layout

```
src/
  geo/
    angles.ts        normalize, shortest delta, rate-limited step — the 359°/0° seam
    haversine.ts     distance, forward azimuth, path length
    projection.ts    point → segment, on a local plane
    polyline.ts      encoded polyline codec, precision 5 and 6
  route/
    matcher.ts       snap to route; debounced off-route detection
    progress.ts      remaining, traveled, progress, route-ahead for drawing
    maneuvers.ts     windowed turn angle, classification, distance to turn
    eta.ts           provider duration blended with live speed
    navigator.ts     the facade: one update() per location sample
  motion/
    speed.ts         noise gate, EMA, moving/stopped hysteresis
    heading.ts       GPS/compass fusion, eased animation, slew limit
    acceleration.ts  longitudinal + lateral, harsh-event detection
  camera/
    policy.ts        follow / overview reducer emitting camera commands
tests/               149 tests, 99% statement / 95% branch coverage
examples/drive.ts    npm run example
```

## Notes

Extracted and rewritten from a production ride-hailing driver app
(React Native · Expo · `@rnmapbox/maps` · Redux). The UI, permissions,
background location and routing-API layers are not part of this package — what
is here is the navigation logic, decoupled from the framework it originally ran
inside and given the test suite that decoupling makes possible.

Thresholds in the defaults are starting points tuned for city driving, not
constants from any particular deployment.

MIT licensed.

---

## Playground

A simulated GPS stream drives the real `RouteNavigator`. Push the driver sideways
and watch off-route detection engage — with the hysteresis that stops a single
bad fix from triggering a reroute — then `shouldReroute` follow.

```bash
npm install
npm install --prefix demo
npm run dev --prefix demo
```

The playground aliases `@engine` to `src/` rather than to a built `dist/`, so the
page always reflects the code in this repository. It is deployed to GitHub Pages
on every push to `main`.
