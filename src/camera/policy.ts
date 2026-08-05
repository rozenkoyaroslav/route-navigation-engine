import type { LatLng } from '../types.js';

export type CameraMode = 'navigation' | 'overview';

/** A camera command, shaped for `Mapbox.Camera.setCamera` but map-agnostic. */
export interface CameraCommand {
  centerCoordinate: [number, number];
  /** Map rotation in degrees; `0` is north-up. */
  bearing: number;
  /** Tilt in degrees; `0` is straight down. */
  pitch: number;
  zoomLevel: number;
  animationDurationMs: number;
}

export interface CameraPolicyOptions {
  followPitch?: number;
  followZoom?: number;
  overviewPitch?: number;
  overviewZoom?: number;
  /** Minimum gap between emitted follow commands, in ms. */
  throttleMs?: number;
  followAnimationMs?: number;
  recenterAnimationMs?: number;
  /**
   * How long a user's gesture suspends automatic following, in ms.
   *
   * Non-zero on purpose: snapping the camera back the instant a driver lets go
   * of the map makes it impossible to look ahead at the route.
   */
  gestureHoldMs?: number;
}

const DEFAULTS: Required<CameraPolicyOptions> = {
  followPitch: 60,
  followZoom: 18.9,
  overviewPitch: 0,
  overviewZoom: 16.4,
  throttleMs: 100,
  followAnimationMs: 200,
  recenterAnimationMs: 500,
  gestureHoldMs: 4000,
};

export type CameraEvent =
  | { type: 'location'; at: number; center: LatLng; headingDeg: number }
  | { type: 'user_gesture'; at: number }
  | { type: 'recenter'; at: number; center: LatLng; headingDeg: number }
  | { type: 'set_mode'; at: number; mode: CameraMode; center?: LatLng; headingDeg?: number };

export interface CameraPolicyState {
  mode: CameraMode;
  /** False while a user gesture is still holding automatic following off. */
  following: boolean;
}

/**
 * Decides when the map camera should move, and where to.
 *
 * This is the part of a navigation screen that usually degenerates into a knot
 * of refs and effects inside a component — a follow flag, a "user touched the
 * map" timer, a throttle timestamp, a previous-mode ref, all mutated from
 * different callbacks. Modelled as a reducer instead, the whole thing is a pure
 * function of (state, event) and can be tested without a renderer.
 *
 * Three rules it enforces:
 *
 * - **Throttle.** Location updates arrive far faster than the camera can
 *   usefully animate; issuing a command per update fights the animation already
 *   in flight and produces visible stutter.
 * - **Gesture wins.** After a user pans, following is suspended for
 *   `gestureHoldMs` and every location update is ignored. Recentring is the
 *   driver's decision, not a timeout's.
 * - **Overview is deliberate.** Switching to overview flattens pitch and zooms
 *   out to show the route; it never auto-reverts, because a driver who asked
 *   for the overview is reading it.
 */
export class CameraPolicy {
  private readonly options: Required<CameraPolicyOptions>;
  private mode: CameraMode = 'navigation';
  private gestureUntil = 0;
  private lastCommandAt = Number.NEGATIVE_INFINITY;

  constructor(options: CameraPolicyOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  state(at: number): CameraPolicyState {
    return { mode: this.mode, following: this.isFollowing(at) };
  }

  /** Apply an event; returns a camera command when the map should move. */
  handle(event: CameraEvent): CameraCommand | null {
    switch (event.type) {
      case 'user_gesture':
        this.gestureUntil = event.at + this.options.gestureHoldMs;
        return null;

      case 'recenter':
        this.gestureUntil = 0;
        this.mode = 'navigation';
        this.lastCommandAt = event.at;
        return this.follow(event.center, event.headingDeg, this.options.recenterAnimationMs);

      case 'set_mode':
        return this.handleSetMode(event);

      case 'location':
        return this.handleLocation(event);
    }
  }

  reset(): void {
    this.mode = 'navigation';
    this.gestureUntil = 0;
    this.lastCommandAt = Number.NEGATIVE_INFINITY;
  }

  private handleSetMode(event: Extract<CameraEvent, { type: 'set_mode' }>): CameraCommand | null {
    if (event.mode === this.mode) return null;
    this.mode = event.mode;

    if (!event.center) return null;
    this.lastCommandAt = event.at;

    if (event.mode === 'overview') {
      return {
        centerCoordinate: [event.center.longitude, event.center.latitude],
        // North-up: an overview is for reading the route, and a rotated map is
        // harder to read against the mental image of a north-up map.
        bearing: 0,
        pitch: this.options.overviewPitch,
        zoomLevel: this.options.overviewZoom,
        animationDurationMs: this.options.recenterAnimationMs,
      };
    }

    this.gestureUntil = 0;
    return this.follow(event.center, event.headingDeg ?? 0, this.options.recenterAnimationMs);
  }

  private handleLocation(event: Extract<CameraEvent, { type: 'location' }>): CameraCommand | null {
    if (this.mode !== 'navigation') return null;
    if (!this.isFollowing(event.at)) return null;
    if (event.at - this.lastCommandAt < this.options.throttleMs) return null;

    this.lastCommandAt = event.at;
    return this.follow(event.center, event.headingDeg, this.options.followAnimationMs);
  }

  private isFollowing(at: number): boolean {
    return at >= this.gestureUntil;
  }

  private follow(center: LatLng, headingDeg: number, animationDurationMs: number): CameraCommand {
    return {
      centerCoordinate: [center.longitude, center.latitude],
      bearing: headingDeg,
      pitch: this.options.followPitch,
      zoomLevel: this.options.followZoom,
      animationDurationMs,
    };
  }
}
