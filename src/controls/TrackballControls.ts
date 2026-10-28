import { quat, vec3 } from "pex-math";
import { smoothDampQuat } from "ressort";

import { quatLookAt, X_AXIS, Y_AXIS, Z_AXIS, ZERO } from "../core/math.js";

import TargetControls from "./TargetControls.js";
import { deltaOf, grabSign, twistOf } from "./gestures.js";

import type { Quat, Vec2, Vec3 } from "pex-math";
import type { Radian, Second } from "../core/types.js";
import type { TargetAction, TargetSettings } from "./TargetControls.js";
import type { Bindings, Gesture } from "./types.js";

/**
 * - `shoemake`: rotations depend only on the start and end points of a drag, and
 *   rotate by twice the arc on the sphere. A `rotateSpeed` other than 1 breaks
 *   this path independence.
 * - `bell`: a hyperbolic sheet outside the sphere removes the discontinuity at
 *   its edge, at the cost of path independence. Rotates by the chord between
 *   points: by the arc on the sphere, half as far as `shoemake`, and in
 *   proportion to the drag on the sheet.
 *
 * @see Shoemake, K. (1992). ARCBALL: a user interface for specifying three-dimensional orientation using a mouse. https://graphicsinterface.org/wp-content/uploads/gi1992-18.pdf
 * @see Bell, G. (1994). trackball.c. Silicon Graphics. https://github.com/fltk/fltk/blob/master/test/trackball.c
 * @see Henriksen, K., Sporring, J. & Hornbæk, K. (2004). Virtual trackballs revisited. https://doi.org/10.1109/TVCG.2004.1260772
 */
type TrackballMode = "shoemake" | "bell";

/**
 * - `rotate`: turn the virtual trackball
 * - `roll`: rotate around the view axis
 */
type TrackballAction = "rotate" | "roll" | TargetAction;

interface TrackballSettings extends TargetSettings {
  mode?: TrackballMode;
  /** Sphere radius in half viewport heights. Must be positive. */
  radius?: number;
  rotateSpeed?: number;
  rollSpeed?: number;
}

interface TrackballControlsOptions extends TrackballSettings {
  position?: Vec3;
  target?: Vec3;
  /** Initial camera up, free afterwards. */
  up?: Vec3;
  bindings?: Bindings<TrackballAction>;
}

type TrackballLerpState =
  | { target: Vec3; distance: number; orientation: Quat }
  | { target: Vec3; position: Vec3 };

interface TrackballState {
  target: Vec3;
  distance: number;
  orientation: Quat;
  focalOffset: Vec3;
  zoom: number;
}

const DEFAULT_BINDINGS: Bindings<TrackballAction> = {
  "mouse:primary": "rotate",
  "mouse:primary+shift": "truck-pedestal",
  "mouse:secondary": "truck-pedestal",
  "mouse:auxiliary": "dolly",
  "touch:1": "rotate",
  "touch:2": ["dolly", "truck-pedestal", "roll"],
  "touch:3": "truck-pedestal",
  wheel: "dolly",
  pinch: ["dolly", "roll"],
};

const TEMP_QUAT = quat.create();
const TEMP_QUAT_2 = quat.create();
const TEMP_FROM = vec3.create();
const TEMP_TO = vec3.create();
const TEMP_VEC3 = vec3.create();

/** Inspect an object from any angle: no fixed up axis, no gimbal lock. */
class TrackballControls extends TargetControls<
  TrackballAction,
  TrackballSettings,
  TrackballState
> {
  public static readonly DEFAULT_BINDINGS: Readonly<Bindings<TrackballAction>> =
    DEFAULT_BINDINGS;

  public mode: TrackballMode = "shoemake";
  /** Sphere radius in half viewport heights. Must be positive. */
  public radius = 1;
  public rotateSpeed = 1;
  public rollSpeed = 1;

  #orientation: Quat = quat.create();
  #orientationEnd: Quat = quat.create();
  #angularVelocity: Vec3 = [0, 0, 0];

  constructor({
    bindings,
    position,
    target,
    up,
    ...options
  }: TrackballControlsOptions = {}) {
    super({ ...DEFAULT_BINDINGS, ...bindings });
    this.set(options);
    this.setLookAt(position ?? [0, 0, 1], target ?? [0, 0, 0], up, false);
    this.saveState();
  }

  public getOrientation(out: Quat = quat.create(), end = false): Quat {
    return this.orientation(out, end);
  }

  /** Place the camera. `up` defaults to the current camera up. */
  public setLookAt(
    position: Vec3,
    target: Vec3,
    up?: Vec3,
    transition = true,
  ): this {
    this.#lookAt(position, target, up);
    return this.commit(transition);
  }

  /**
   * Turn the ball, and the scene with it, around an axis in camera space: the
   * camera orbits the opposite way.
   */
  public rotate(axis: Vec3, angle: Radian, transition = true): this {
    this.#rotateLocal(vec3.normalize(vec3.set(TEMP_VEC3, axis)), -angle);
    return this.commit(transition);
  }

  /** Roll the camera counter-clockwise: the image turns clockwise. */
  public roll(angle: Radian, transition = true): this {
    this.#rotateLocal(Z_AXIS, angle);
    return this.commit(transition);
  }

  public getState(): TrackballState {
    return {
      target: [...this.targetEnd],
      distance: this.distanceEnd,
      orientation: [...this.#orientationEnd],
      focalOffset: [...this.offsetEnd],
      zoom: this.zoomEnd,
    };
  }

  public setState(state: TrackballState, transition = true): this {
    this.setEnd(state.target, state.distance, state.focalOffset, state.zoom);
    this.#readOrientation(this.#orientationEnd, state.orientation);
    return this.commit(transition);
  }

  /**
   * Interpolate between two states along the shortest rotation. Position states
   * look at their target with the current camera up.
   */
  public lerp(
    from: TrackballLerpState,
    to: TrackballLerpState,
    t: number,
    transition = true,
  ): this {
    const up = vec3.multQuat(vec3.set(TEMP_VEC3, Y_AXIS), this.#orientationEnd);
    const fromDistance = this.#unpack(TEMP_QUAT, from, up);
    const toDistance = this.#unpack(TEMP_QUAT_2, to, up);
    quat.normalize(quat.slerp(TEMP_QUAT, TEMP_QUAT_2, t));
    quat.set(this.#orientationEnd, TEMP_QUAT);
    this.lerpEnd(from.target, to.target, fromDistance, toDistance, t);
    return this.commit(transition);
  }

  /**
   * Point on the trackball under screen coordinates in half viewport heights, y
   * up.
   */
  public projectOnBall(out: Vec3, [x, y]: Vec2): Vec3 {
    x /= this.radius;
    y /= this.radius;
    const lengthSq = x * x + y * y;
    out[0] = x;
    out[1] = y;
    if (this.mode === "bell") {
      // Bell's hyperbolic sheet joins the sphere at r² = 1/2. Its points stay
      // off the sphere: normalizing them, as Henriksen et al. (2004) eq. 33-34
      // do, fades the rotation far outside.
      out[2] =
        lengthSq > 0.5 ? 0.5 / Math.sqrt(lengthSq) : Math.sqrt(1 - lengthSq);
      return out;
    }
    // Points outside the sphere move to its rim.
    out[2] = Math.sqrt(Math.max(0, 1 - lengthSq));
    return vec3.normalize(out);
  }

  protected override applyAction(
    action: TrackballAction,
    gesture: Gesture,
  ): void {
    if (action === "rotate") {
      const [dx, dy] = deltaOf(gesture);
      const sign = grabSign(gesture);
      // Ball coordinates: half area heights, y up, the units of the deltas.
      const x = gesture.ndc[0] * gesture.aspect;
      const y = gesture.ndc[1];
      this.projectOnBall(TEMP_FROM, [x - 2 * dx * sign, y + 2 * dy * sign]);
      this.projectOnBall(TEMP_TO, [x, y]);
      this.#rotateBall(TEMP_FROM, TEMP_TO);
    } else if (action === "roll") {
      // The image follows the fingers: the camera rolls the opposite way.
      this.#rotateLocal(Z_AXIS, -twistOf(gesture) * this.rollSpeed);
    } else {
      return super.applyAction(action, gesture);
    }
    this.invalidate();
  }

  protected orientation(out: Quat, end = false): Quat {
    return quat.set(out, end ? this.#orientationEnd : this.#orientation);
  }

  protected lookAtEnd(position: Vec3, target: Vec3, up?: Vec3): void {
    this.#lookAt(position, target, up);
  }

  protected turnEnd(pan: Radian, tilt: Radian): void {
    this.#rotateLocal(Y_AXIS, pan);
    this.#rotateLocal(X_AXIS, tilt);
  }

  protected stepRotation(dt: Second, smoothTime: Second): Radian {
    return smoothDampQuat(
      this.#orientation,
      this.#orientationEnd,
      this.#angularVelocity,
      smoothTime,
      dt,
    );
  }

  protected stopRotation(): void {
    quat.set(this.#orientation, this.#orientationEnd);
    vec3.set(this.#angularVelocity, ZERO);
  }

  #lookAt(position: Vec3, target: Vec3, up?: Vec3): void {
    const cameraUp =
      up ?? vec3.multQuat(vec3.set(TEMP_VEC3, Y_AXIS), this.#orientationEnd);
    quatLookAt(this.#orientationEnd, position, target, cameraUp);
    this.setEnd(
      target,
      vec3.distance(position, target),
      this.offsetEnd,
      this.zoomEnd,
    );
  }

  // A zero quaternion has no rotation to normalize: keep the current one.
  #readOrientation(out: Quat, orientation: Quat): Quat {
    return quat.dot(orientation, orientation) > 0
      ? quat.normalize(quat.set(out, orientation))
      : quat.set(out, this.#orientationEnd);
  }

  // Orientation and distance of a lerp state.
  #unpack(out: Quat, state: TrackballLerpState, up: Vec3): number {
    if ("orientation" in state) {
      this.#readOrientation(out, state.orientation);
      return state.distance;
    }
    quatLookAt(
      quat.set(out, this.#orientationEnd),
      state.position,
      state.target,
      up,
    );
    return vec3.distance(state.position, state.target);
  }

  // Composed in camera space. `axis` must be normalized.
  #rotateLocal(axis: Vec3, angle: Radian): void {
    quat.fromAxisAngle(TEMP_QUAT, axis, angle);
    quat.normalize(quat.mult(this.#orientationEnd, TEMP_QUAT));
  }

  // Rotating the ball rotates the scene: the camera turns the opposite way in its own frame.
  #rotateBall(from: Vec3, to: Vec3): void {
    vec3.cross(vec3.set(TEMP_VEC3, from), to);
    // Opposite rim points: a full turn.
    const sin = vec3.length(TEMP_VEC3);
    if (sin === 0) return;

    // Shoemake's [from × to, from · to] has the arc as half angle: it rotates
    // by twice the arc. atan2 stays accurate near identity and half turns,
    // where acos can't. Bell's half angle comes from the chord.
    const halfAngle =
      this.mode === "shoemake"
        ? Math.atan2(sin, vec3.dot(from, to))
        : Math.asin(Math.min(vec3.distance(from, to) / 2, 1));
    this.#rotateLocal(
      vec3.scale(TEMP_VEC3, 1 / sin),
      -2 * halfAngle * this.rotateSpeed,
    );
  }
}

export type {
  TrackballMode,
  TrackballLerpState,
  TrackballAction,
  TrackballSettings,
  TrackballControlsOptions,
  TrackballState,
};
export default TrackballControls;
