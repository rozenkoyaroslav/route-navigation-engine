import type { LatLng } from '@engine';

interface MapProps {
  route: LatLng[];
  ahead: LatLng[];
  driver: LatLng;
  snapped: LatLng | null;
  maneuverVertex: number | null;
  isOffRoute: boolean;
}

const W = 520;
const H = 420;
const PAD = 34;

/**
 * Deliberately not a map library: the point of the demo is the engine's output,
 * and an SVG keeps the page dependency-free and instant to load.
 */
export function Map({ route, ahead, driver, snapped, maneuverVertex, isOffRoute }: MapProps) {
  const bounds = getBounds([...route, driver]);
  const p = (point: LatLng) => project(point, bounds);

  const routeD = route.map(p).map(toCmd).join(' ');
  const aheadD = ahead.map(p).map(toCmd).join(' ');
  const driverXY = p(driver);
  const snappedXY = snapped ? p(snapped) : null;
  const maneuverXY =
    maneuverVertex !== null && route[maneuverVertex] ? p(route[maneuverVertex]) : null;

  return (
    <svg
      className="map"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Simulated route with the driver's position"
    >
      <path className="route-behind" d={routeD} />
      {ahead.length > 1 ? <path className="route-ahead" d={aheadD} /> : null}

      {route.map((vertex, i) => {
        const xy = p(vertex);
        return <circle key={i} className="vertex" cx={xy.x} cy={xy.y} r={2.5} />;
      })}

      {maneuverXY ? (
        <circle className="maneuver-marker" cx={maneuverXY.x} cy={maneuverXY.y} r={9} />
      ) : null}

      {snappedXY && isOffRoute ? (
        <>
          <line
            className="snap-link"
            x1={driverXY.x}
            y1={driverXY.y}
            x2={snappedXY.x}
            y2={snappedXY.y}
          />
          <circle className="snap-dot" cx={snappedXY.x} cy={snappedXY.y} r={4} />
        </>
      ) : null}

      <circle
        className={isOffRoute ? 'driver driver-off' : 'driver'}
        cx={driverXY.x}
        cy={driverXY.y}
        r={7}
      />
    </svg>
  );
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function getBounds(points: LatLng[]): Bounds {
  const lats = points.map((pt) => pt.latitude);
  const lngs = points.map((pt) => pt.longitude);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

function project(point: LatLng, b: Bounds): { x: number; y: number } {
  const spanLat = b.maxLat - b.minLat || 1e-6;
  const spanLng = b.maxLng - b.minLng || 1e-6;

  return {
    x: PAD + ((point.longitude - b.minLng) / spanLng) * (W - PAD * 2),
    // SVG y grows downward; latitude grows north.
    y: H - PAD - ((point.latitude - b.minLat) / spanLat) * (H - PAD * 2),
  };
}

const toCmd = (xy: { x: number; y: number }, i: number): string =>
  `${i === 0 ? 'M' : 'L'}${xy.x.toFixed(1)},${xy.y.toFixed(1)}`;
