import { useEffect, useMemo, useRef, useState } from 'react';
import { RouteNavigator, bearingDeg, type LocationSample, type NavigationState } from '@engine';
import { ROUTE, ROUTE_DURATION_SEC, offsetPerpendicular, pointAtFraction } from './route';
import { Map } from './Map';

/** Simulated GPS cadence, matching what a phone typically delivers. */
const TICK_MS = 1000;

export function App() {
  const [fraction, setFraction] = useState(0.08);
  const [lateralMeters, setLateralMeters] = useState(0);
  const [speedKph, setSpeedKph] = useState(42);
  const [accuracyMeters, setAccuracyMeters] = useState(8);
  const [playing, setPlaying] = useState(false);
  const [state, setState] = useState<NavigationState | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  // One navigator for the whole session: route matching is stateful by design,
  // so recreating it per render would defeat the look-back it relies on.
  const navigator = useMemo(
    () => new RouteNavigator(ROUTE, { routeDurationSec: ROUTE_DURATION_SEC }),
    [],
  );

  const clock = useRef(Date.now());

  const driver = useMemo(() => {
    const { point, bearingSourceIndex } = pointAtFraction(ROUTE, fraction);
    const from = ROUTE[bearingSourceIndex];
    const to = ROUTE[bearingSourceIndex + 1] ?? from;
    return {
      point: offsetPerpendicular(point, from, to, lateralMeters),
      headingDeg: bearingDeg(from, to),
    };
  }, [fraction, lateralMeters]);

  useEffect(() => {
    clock.current += TICK_MS;

    const sample: LocationSample = {
      latitude: driver.point.latitude,
      longitude: driver.point.longitude,
      speedMps: speedKph / 3.6,
      headingDeg: driver.headingDeg,
      accuracyMeters,
      timestamp: clock.current,
    };

    const next = navigator.update(sample);
    setState(next);

    if (next.drivingEvent) {
      const e = next.drivingEvent;
      setEvents((prev) => [`${e.type} · ${e.peakMps2.toFixed(2)} m/s²`, ...prev].slice(0, 5));
    }
  }, [driver, speedKph, accuracyMeters, navigator]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFraction((f) => (f >= 1 ? 0 : Math.min(1, f + 0.012)));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <div className="page">
      <header className="head">
        <h1>route-navigation-engine</h1>
        <p>
          A simulated GPS stream feeding the real <code>RouteNavigator</code>. Drag the driver
          sideways to leave the route and watch off-route detection, then rerouting, kick in.
        </p>
        <a className="repo-link" href="https://github.com/rozenkoyaroslav/route-navigation-engine">
          Source on GitHub →
        </a>
      </header>

      <main className="layout">
        <section className="stage">
          <Map
            route={ROUTE}
            ahead={state?.ahead ?? []}
            driver={driver.point}
            snapped={state?.match?.snapped ?? null}
            maneuverVertex={state?.maneuver?.vertexIndex ?? null}
            isOffRoute={state?.isOffRoute ?? false}
          />

          <div className="controls">
            <button className="play" onClick={() => setPlaying((p) => !p)} type="button">
              {playing ? '❚❚ Pause' : '▶ Drive'}
            </button>

            <Range
              label="Position along route"
              value={fraction}
              min={0}
              max={1}
              step={0.005}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={setFraction}
            />
            <Range
              label="Lateral offset"
              value={lateralMeters}
              min={-120}
              max={120}
              step={1}
              format={(v) => `${v.toFixed(0)} m`}
              onChange={setLateralMeters}
            />
            <Range
              label="Speed"
              value={speedKph}
              min={0}
              max={120}
              step={1}
              format={(v) => `${v.toFixed(0)} km/h`}
              onChange={setSpeedKph}
            />
            <Range
              label="GPS accuracy"
              value={accuracyMeters}
              min={3}
              max={80}
              step={1}
              format={(v) => `±${v.toFixed(0)} m`}
              onChange={setAccuracyMeters}
            />
          </div>
        </section>

        <section className="hud">
          <div className={state?.isOffRoute ? 'banner banner-warn' : 'banner'}>
            <p className="instruction">{state?.instruction ?? '…'}</p>
            {state?.distanceToManeuverMeters !== null &&
            state?.distanceToManeuverMeters !== undefined ? (
              <p className="in-meters">in {formatMeters(state.distanceToManeuverMeters)}</p>
            ) : null}
          </div>

          <dl className="stats">
            <Stat label="Remaining" value={formatMeters(state?.distanceRemainingMeters ?? 0)} />
            <Stat label="ETA" value={`${state?.eta.minutes ?? 0} min`} note={state?.eta.source} />
            <Stat label="Progress" value={`${((state?.progress ?? 0) * 100).toFixed(0)}%`} />
            <Stat
              label="Speed"
              value={`${((state?.speedMps ?? 0) * 3.6).toFixed(0)} km/h`}
              note={state?.isMoving ? 'moving' : 'stationary'}
            />
            <Stat
              label="Off route by"
              value={formatMeters(state?.match?.offsetMeters ?? 0)}
              warn={state?.isOffRoute}
            />
            <Stat
              label="Reroute"
              value={state?.shouldReroute ? 'needed' : 'no'}
              warn={state?.shouldReroute}
            />
          </dl>

          <div className="events">
            <h2>Driving events</h2>
            {events.length === 0 ? (
              <p className="empty">None yet — swing the speed slider hard to trigger one.</p>
            ) : (
              <ul>
                {events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function formatMeters(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

interface RangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function Range({ label, value, min, max, step, format, onChange }: RangeProps) {
  const id = `r-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="range">
      <div className="range-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className={warn ? 'stat stat-warn' : 'stat'}>
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className="note">{note}</span> : null}
      </dd>
    </div>
  );
}
