import { quat, utils, vec3 } from "pex-math";
import { smoothDamp } from "ressort";

import {
  TAU,
  normalizeAngle,
  quatFromUnitVectors,
  shortestAngle,
  sphericalCreate,
  sphericalFromVec3,
  NEG_Z_AXIS,
  X_AXIS,
  Y_AXIS,
} from "../core/math.js";

import TargetControls from "./TargetControls.js";
import { deltaOf, grabSign, twistOf } from "./gestures.js";

import type { Quat, Vec3 } from "pex-math";
import type { SpringState } from "ressort";
import type { Spherical } from "../core/math.js";
import type { Radian, Second } from "../core/types.js";
import type { TargetAction, TargetSettings } from "./TargetControls.js";
import type { Bindings, Gesture } from "./types.js";

/**
 * - `arc`: orbit around the target (azimuth and elevation)
 * - `truck-dolly`: translate on the ground plane, as maps do
 * - `twist`: rotate the azimuth with a two-finger or trackpad rotation, as maps
 *   do
 */
type OrbitAction =
    | "arc"
  | "arc-azimuth"
  | "arc-elevation"
  | "truck-dolly"
  | "twist"
  | TargetAction;

interface OrbitState {
  target: Vec3;
  spherical: Spherical;
  focalOffset: Vec3;
  zoom: number;
}

type OrbitLerpState =
  { target: Vec3; spherical: Spherical } | { target: Vec3; position: Vec3 };

type OrbitSettings = Omit<
  OrbitControlsOptions,
  "bindings" | "up" | "position" | "target"
>;

interface OrbitControlsOptions extends TargetSettings {
  up?: Vec3;
  position?: Vec3;
  target?: Vec3;
  bindings?: Bindings<OrbitAction>;

  azimuthSpeed?: number;
  elevationSpeed?: number;

  elevationBounds?: [Radian, Radian];
  azimuthBounds?: [Radian, Radian];
}

const DEFAULT_BINDINGS: Bindings<OrbitAction> = {
  "mouse:primary": "arc",
  "mouse:primary+shift": "truck-pedestal",
  "mouse:auxiliary": "dolly",
  "mouse:secondary": "truck-pedestal",
  "touch:1": "arc",
  "touch:2": ["dolly", "truck-pedestal"],
  "touch:3": "truck-pedestal",
  wheel: "dolly",
  pinch: "dolly",
};

const TEMP_QUAT = quat.create();
const TEMP_QUAT_2 = quat.create();
const TEMP_VEC3 = vec3.create();
const TEMP_VEC3_2 = vec3.create();
const TEMP_SPHERICAL = sphericalCreate();

const clampBounds = (value: number, bounds: [number, number]) =>
  utils.clamp(value, bounds[0], bounds[1]);

/**
 * Orbit, dolly, zoom, truck, pedestal and pan around a target, with damping,
 * limits and dolly to cursor.
 */
class OrbitControls extends TargetControls<
  OrbitAction,
  OrbitSettings,
  OrbitState
> {
  public static readonly DEFAULT_BINDINGS: Readonly<Bindings<OrbitAction>> =
    DEFAULT_BINDINGS;

  public azimuthSpeed = 1;
  public elevationSpeed = 1;

  public elevationBounds: [Radian, Radian] = [-Math.PI / 2, Math.PI / 2];
  public azimuthBounds: [Radian, Radian] = [-Infinity, Infinity];

  #up: Vec3 = [0, 1, 0];
  #upSpace: Quat = quat.create();
  #upSpaceInverse: Quat = quat.create();

  #elevation = 0;
  #elevationEnd = 0;
  #azimuth = 0;
  #azimuthEnd = 0;

  #elevationSpring: SpringState = { velocity: 0 };
  #azimuthSpring: SpringState = { velocity: 0 };

  constructor({
    bindings,
    up,
    position,
    target,
    ...options
  }: OrbitControlsOptions = {}) {
    super({ ...DEFAULT_BINDINGS, ...bindings });
    this.set(options);
    this.up = up ?? Y_AXIS;
    this.setLookAt(position ?? [0, 0, 1], target ?? [0, 0, 0], false);
    this.saveState();
  }

  /** Up axis of the orbit. Changing it keeps the camera in place. */
  public get up(): Vec3 {
    return [...this.#up];
  }
  public set up(value: Vec3) {
    const position = this.getPosition(TEMP_VEC3_2, true);
    vec3.normalize(vec3.set(this.#up, value));
    quatFromUnitVectors(this.#upSpace, this.#up, utils.Y_UP);
    quat.conjugate(quat.set(this.#upSpaceInverse, this.#upSpace));
    this.setPosition(position, false);
  }

  // Getters
  public getSpherical(out = sphericalCreate(), end = false): Spherical {
    out[0] = this.getDistance(end);
    out[1] = end ? this.#elevationEnd : this.#elevation;
    out[2] = end ? this.#azimuthEnd : this.#azimuth;
    return out;
  }

  // Arc
  /** Orbit around the target by relative angles. */
  public arc(azimuth: Radian, elevation: Radian, transition = true): this {
    return this.arcTo(
      this.#azimuthEnd + azimuth,
      this.#elevationEnd + elevation,
      transition,
    );
  }

  /**
   * Orbit around the target to absolute angles: azimuth around up from +Z,
   * elevation from the horizon.
   */
  public arcTo(azimuth: Radian, elevation: Radian, transition = true): this {
    this.#setAngles(azimuth, elevation);
    return this.commit(transition);
  }

  // Translations
  /** Translate along the up axis. */
  public pedestal(y: number, transition = true): this {
    this.moveTargetEnd(vec3.scale(vec3.set(TEMP_VEC3, this.#up), y));
    return this.commit(transition);
  }

  /** Translate forward on the ground plane, perpendicular to the up axis. */
  public forward(distance: number, transition = true): this {
    this.#forward(distance, true);
    return this.commit(transition);
  }

  // Placement
  /** Place the camera and target. The focal offset is kept. */
  public setLookAt(position: Vec3, target: Vec3, transition = true): this {
    this.lookAtEnd(position, target);
    return this.commit(transition);
  }

  /**
   * Interpolate between two states. Spherical states avoid the azimuth
   * ambiguity of positions.
   */
  public lerp(
    from: OrbitLerpState,
    to: OrbitLerpState,
    t: number,
    transition = true,
  ): this {
    const a = this.#toSpherical(sphericalCreate(), from);
    const b = this.#toSpherical(sphericalCreate(), to);
    // Azimuths from positions are in (-π, π]: take the short way. Explicit spherical states keep their turns.
    if ("position" in from || "position" in to) {
      b[2] = shortestAngle(b[2], a[2]);
    }
    this.lerpEnd(from.target, to.target, a[0], b[0], t);
    this.#setAngles(utils.lerp(a[2], b[2], t), utils.lerp(a[1], b[1], t));
    return this.commit(transition);
  }

  /**
   * Wrap the azimuth to [-π, π] so later transitions take the short way. Call
   * before setting distant angles.
   */
  public normalizeRotations(): this {
    this.#azimuthEnd = normalizeAngle(this.#azimuthEnd);
    this.#azimuth = shortestAngle(this.#azimuth, this.#azimuthEnd);
    return this;
  }

  // State
  /** Snapshot of the end state. */
  public getState(): OrbitState {
    return {
      target: [...this.targetEnd],
      spherical: this.getSpherical(sphericalCreate(), true),
      focalOffset: [...this.offsetEnd],
      zoom: this.zoomEnd,
    };
  }

  public setState(state: OrbitState, transition = true): this {
    const [distance, elevation, azimuth] = state.spherical;
    this.setEnd(state.target, distance, state.focalOffset, state.zoom);
    this.#setAngles(azimuth, elevation);
    return this.commit(transition);
  }

  // Controls
  protected override applyAction(action: OrbitAction, gesture: Gesture): void {
    const delta = deltaOf(gesture);
    const dx = delta[0];
    const dy = delta[1];
    const sign = grabSign(gesture);

    switch (action) {
      case "arc":
        this.#setAngles(
          this.#azimuthEnd - TAU * dx * sign * this.azimuthSpeed,
          this.#elevationEnd + TAU * dy * sign * this.elevationSpeed,
        );
        break;
      case "arc-azimuth":
        this.#setAngles(
          this.#azimuthEnd - TAU * dx * sign * this.azimuthSpeed,
          this.#elevationEnd,
        );
        break;
      case "arc-elevation":
        this.#setAngles(
          this.#azimuthEnd,
          this.#elevationEnd + TAU * dy * sign * this.elevationSpeed,
        );
        break;
      case "truck-dolly": {
        const height = this.dragHeight();
        this.translate(-dx * sign * height, 0);
        this.#forward(dy * sign * height);
        break;
      }
      case "twist":
        this.#setAngles(
          this.#azimuthEnd - twistOf(gesture) * this.azimuthSpeed,
          this.#elevationEnd,
        );
        break;
      default:
        return super.applyAction(action, gesture);
    }
    this.invalidate();
  }

  // Up space rotation, then azimuth around +Y, then elevation around -X: camera looks down -Z.
  protected orientation(out: Quat, end = false): Quat {
    const elevation = end ? this.#elevationEnd : this.#elevation;
    const azimuth = end ? this.#azimuthEnd : this.#azimuth;
    quat.fromAxisAngle(TEMP_QUAT_2, Y_AXIS, azimuth);
    quat.mult(TEMP_QUAT_2, quat.fromAxisAngle(out, X_AXIS, -elevation));
    return quat.mult(quat.set(out, this.#upSpaceInverse), TEMP_QUAT_2);
  }

  protected lookAtEnd(position: Vec3, target: Vec3): void {
    vec3.multQuat(
      vec3.sub(vec3.set(TEMP_VEC3, position), target),
      this.#upSpace,
    );
    const [distance, elevation, azimuth] = sphericalFromVec3(
      TEMP_SPHERICAL,
      TEMP_VEC3,
    );
    // On the target the angles are undefined, on the up axis the azimuth: keep them.
    if (distance > 0) {
      this.#setAngles(
        Math.cos(elevation) < utils.EPSILON ? this.#azimuthEnd : azimuth,
        elevation,
        true,
      );
    }
    this.setEnd(target, distance, this.offsetEnd, this.zoomEnd);
  }

  // Rotating around the camera rotates (position - target) by the same angles.
  protected turnEnd(pan: Radian, tilt: Radian): void {
    this.#setAngles(this.#azimuthEnd + pan, this.#elevationEnd - tilt);
  }

  protected stepRotation(dt: Second, smoothTime: Second): Radian {
    this.#elevation = smoothDamp(
      this.#elevation,
      this.#elevationEnd,
      this.#elevationSpring,
      smoothTime,
      dt,
    );
    this.#azimuth = smoothDamp(
      this.#azimuth,
      this.#azimuthEnd,
      this.#azimuthSpring,
      smoothTime,
      dt,
    );
    return Math.max(
      Math.abs(this.#elevation - this.#elevationEnd),
      Math.abs(this.#azimuth - this.#azimuthEnd),
    );
  }

  protected stopRotation(): void {
    this.#elevation = this.#elevationEnd;
    this.#azimuth = this.#azimuthEnd;
    this.#elevationSpring.velocity = 0;
    this.#azimuthSpring.velocity = 0;
  }

  // Internals
  #toSpherical(out: Spherical, state: OrbitLerpState): Spherical {
    if ("spherical" in state) {
      out[0] = state.spherical[0];
      out[1] = state.spherical[1];
      out[2] = state.spherical[2];
      return out;
    }
    vec3.multQuat(
      vec3.sub(vec3.set(TEMP_VEC3, state.position), state.target),
      this.#upSpace,
    );
    return sphericalFromVec3(out, TEMP_VEC3);
  }

  // Clamp to bounds and keep the elevation off the poles, where the azimuth is undefined, so rest is reachable.
  #setAngles(azimuth: Radian, elevation: Radian, nearestTurn = false): void {
    // Angles derived from positions are in (-π, π]: pick the turn closest to the current one to avoid spinning around.
    if (nearestTurn) azimuth = shortestAngle(azimuth, this.#azimuthEnd);
    this.#azimuthEnd = clampBounds(azimuth, this.azimuthBounds);
    this.#elevationEnd = utils.clamp(
      clampBounds(elevation, this.elevationBounds),
      utils.EPSILON - Math.PI / 2,
      Math.PI / 2 - utils.EPSILON,
    );
  }

  #forward(distance: number, end = false): void {
    const orientation = this.orientation(TEMP_QUAT, end);
    const forward = vec3.multQuat(vec3.set(TEMP_VEC3, NEG_Z_AXIS), orientation);
    vec3.addScaled(forward, this.#up, -vec3.dot(forward, this.#up));
    // Looking along the up axis: screen up is forward.
    if (vec3.lengthSq(forward) < utils.EPSILON) {
      vec3.multQuat(vec3.set(forward, Y_AXIS), orientation);
      vec3.addScaled(forward, this.#up, -vec3.dot(forward, this.#up));
    }
    this.moveTargetEnd(vec3.scale(vec3.normalize(forward), distance));
  }
}

export type {
  OrbitAction,
  OrbitState,
  OrbitLerpState,
  OrbitSettings,
  OrbitControlsOptions,
};
export default OrbitControls;
