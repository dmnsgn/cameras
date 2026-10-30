import { quat, utils, vec3 } from "pex-math";
import {
  advanceVec3,
  createTransition,
  fromSmoothTime,
  smoothDamp,
  transition,
} from "ressort";

import {
  quatFromUnitVectors,
  NEG_Z_AXIS,
  X_AXIS,
  Y_AXIS,
  ZERO,
} from "../core/math.js";

import Controls from "./Controls.js";
import { CONTROL, CONTROL_END, CONTROL_START } from "./events.js";
import {
  deltaOf,
  grabSign,
  logScale,
  movementAxes,
  DEFAULT_MOVEMENT_KEYS,
  SLOW_WALK_SPEED,
  SPEED_FACTOR,
  VIEW_SIGN,
  WALK_SPEED,
} from "./gestures.js";
import { SPRING_SMOOTH_TIME } from "../core/PoseSource.js";
import { effectiveFov, nearDistance } from "../camera/lens.js";

import type { Quat, Vec3 } from "pex-math";
import type { SpringState } from "ressort";
import type { Pose } from "../core/pose.js";
import type { Radian, Second } from "../core/types.js";
import type { MovementKeys } from "./gestures.js";
import type { Lens } from "../camera/types.js";
import type { Bindings, ControlsSettings, Gesture } from "./types.js";

type SteeringAction =
  "truck-dolly" | "truck-pedestal" | "pedestal" | "dolly" | "zoom" | "aim";

interface SteeringSettings extends ControlsSettings {
  lens?: Lens;
  /** Units per second. */
  speed?: number;
  sprintMultiplier?: number;
  slowMultiplier?: number;
  /**
   * Approximate time to reach the target position: acceleration and
   * deceleration feel.
   */
  moveSmoothTime?: Second;
  zoomSpeed?: number;
  zoomSmoothTime?: Second;
  zoomBounds?: [number, number];
  /** Zoom factor while an `aim` press is held. */
  aimZoom?: number;
  /** Screen angle below which motion rests. */
  restThreshold?: Radian;
  keys?: Partial<MovementKeys>;
  /** Adjust the target position in place, e.g. ground height or collisions. */
  constrain?: ((position: Vec3) => void) | null;
}

interface SteeringControlsOptions<
  Action extends string,
> extends SteeringSettings {
  up?: Vec3;
  position?: Vec3;
  /** Point to look at. */
  target?: Vec3;
  bindings?: Bindings<Action>;
}

/**
 * A 2× teleconverter, one of the two most common, doubles the focal length.
 *
 * @see https://en.wikipedia.org/wiki/Teleconverter
 */
const AIM_ZOOM = 2;

// Units moved per normalized drag, relative to speed.
const DRAG_MOVE = 2;

const TEMP_AXES = vec3.create();
const TEMP_RIGHT = vec3.create();
const TEMP_UP = vec3.create();
const TEMP_FORWARD = vec3.create();
const TEMP_MOVE = vec3.create();
const TEMP_QUAT = quat.create();
const TEMP_STEP = createTransition();

/**
 * Base of steering controllers, which continuously direct the camera's own
 * motion: position, keyboard movement and zoom. Subclasses own the orientation
 * and call `set` after `super`, once their fields exist.
 *
 * @see Bowman, D. A., Kruijff, E., LaViola, J. J. & Poupyrev, I. (2004). 3D User Interfaces: Theory and Practice, ch. 6 Travel. https://people.cs.vt.edu/~bowman/3dui.org/Chapter_6.html
 */
abstract class SteeringControls<
  Action extends string,
  Settings extends SteeringSettings = SteeringSettings,
  State = unknown,
> extends Controls<Action | SteeringAction, Settings, State> {
  public speed = WALK_SPEED;
  public sprintMultiplier = SPEED_FACTOR;
  public slowMultiplier = SLOW_WALK_SPEED / WALK_SPEED;
  public moveSmoothTime: Second = SPRING_SMOOTH_TIME;
  public zoomSpeed = 1;
  public zoomSmoothTime: Second = SPRING_SMOOTH_TIME;
  public zoomBounds: [number, number] = [0.1, 20];
  public aimZoom = AIM_ZOOM;
  public restThreshold = 1e-4;
  public constrain: ((position: Vec3) => void) | null = null;

  protected readonly upVector: Vec3 = [0, 1, 0];
  protected readonly upSpace: Quat = quat.create();
  protected readonly upSpaceInverse: Quat = quat.create();
  protected readonly position: Vec3 = [0, 0, 0];
  protected readonly positionEnd: Vec3 = [0, 0, 0];
  protected zoomValue = 1;
  protected zoomEnd = 1;

  readonly #defaultKeys: MovementKeys;
  #keys: MovementKeys;
  #positionVelocity: Vec3 = [0, 0, 0];
  #goalVelocity: Vec3 = [0, 0, 0];
  #zoomSpring: SpringState = { velocity: 0 };
  #keyboardMoving = false;
  #zoomBeforeAim = 1;

  constructor(
    bindings: Bindings<Action | SteeringAction>,
    defaultKeys: MovementKeys = DEFAULT_MOVEMENT_KEYS,
  ) {
    super(bindings);
    this.#defaultKeys = defaultKeys;
    this.#keys = structuredClone(defaultKeys);
  }

  public get keys(): MovementKeys {
    return this.#keys;
  }
  public set keys(keys: Partial<MovementKeys>) {
    this.#keys = { ...structuredClone(this.#defaultKeys), ...keys };
  }

  /** Fixed up axis of the world. */
  public get up(): Vec3 {
    return [...this.upVector];
  }
  public set up(value: Vec3) {
    vec3.normalize(vec3.set(this.upVector, value));
    quatFromUnitVectors(this.upSpace, this.upVector, utils.Y_UP);
    quat.conjugate(quat.set(this.upSpaceInverse, this.upSpace));
    this.invalidate();
  }

  public getPosition(out: Vec3 = vec3.create(), end = false): Vec3 {
    return vec3.set(out, end ? this.positionEnd : this.position);
  }

  /** Teleport, or travel with a transition. */
  public setPosition(position: Vec3, transition = true): this {
    this.setEnd(position, this.zoomEnd);
    return this.commit(transition);
  }

  /**
   * Place the camera at a position, looking along an orientation, as closely as
   * the controller represents it. The zoom is kept.
   */
  public setPose(position: Vec3, orientation: Quat, transition = true): this {
    this.setEnd(position, this.zoomEnd);
    this.setOrientationEnd(orientation);
    return this.commit(transition);
  }

  /**
   * Move in the camera frame: x right, y up, z forward. Walking controllers
   * keep z on the ground.
   */
  public move(x: number, y: number, z: number, transition = true): this {
    this.#move(x, y, z);
    return this.commit(transition);
  }

  public getZoom(end = false): number {
    return end ? this.zoomEnd : this.zoomValue;
  }

  /** Without a transition, only the zoom jumps: other motion carries on. */
  public zoomTo(zoom: number, transition = true): this {
    this.zoomEnd = utils.clamp(zoom, this.zoomBounds[0], this.zoomBounds[1]);
    if (transition) return this.commit(transition);
    this.zoomValue = this.zoomEnd;
    this.#zoomSpring.velocity = 0;
    this.invalidate();
    return this;
  }

  /** Jump to the end of the current motion. */
  public override stop(): this {
    vec3.set(this.position, this.positionEnd);
    vec3.set(this.#positionVelocity, ZERO);
    this.zoomValue = this.zoomEnd;
    this.#zoomSpring.velocity = 0;
    this.stopRotation();
    this.invalidate();
    return this;
  }

  protected applyAction(
    action: Action | SteeringAction,
    gesture: Gesture,
  ): void {
    const delta = deltaOf(gesture);
    const dx = delta[0];
    const dy = delta[1];
    const sign = grabSign(gesture);
    const amount = this.speed * DRAG_MOVE * sign;

    switch (action) {
      case "truck-dolly":
        this.#move(-dx * amount, 0, dy * amount);
        break;
      case "truck-pedestal":
        this.#move(-dx * amount, dy * amount, 0);
        break;
      case "pedestal":
        vec3.addScaled(this.positionEnd, this.upVector, dy * amount);
        this.constrain?.(this.positionEnd);
        break;
      case "dolly":
        this.#move(0, 0, -logScale(gesture) * this.speed * DRAG_MOVE);
        break;
      case "zoom":
        this.zoomEnd = utils.clamp(
          this.zoomEnd * Math.exp(-logScale(gesture) * this.zoomSpeed),
          this.zoomBounds[0],
          this.zoomBounds[1],
        );
        break;
    }
    this.invalidate();
  }

  protected override startAction(action: Action | SteeringAction): void {
    if (action !== "aim") return;
    this.#zoomBeforeAim = this.zoomEnd;
    this.zoomTo(this.zoomEnd * this.aimZoom);
  }

  protected override endAction(action: Action | SteeringAction): void {
    if (action === "aim") this.zoomTo(this.#zoomBeforeAim);
  }

  protected step(dt: Second): boolean {
    const keyboardMoving = this.#keyboardVelocity(this.#goalVelocity);
    const rotating = this.stepRotation(dt);

    this.zoomValue = smoothDamp(
      this.zoomValue,
      this.zoomEnd,
      this.#zoomSpring,
      this.zoomSmoothTime,
      dt,
    );
    advanceVec3(
      this.position,
      this.positionEnd,
      this.#positionVelocity,
      transition(TEMP_STEP, fromSmoothTime(this.moveSmoothTime), dt),
      this.#goalVelocity,
    );
    if (keyboardMoving) {
      vec3.addScaled(this.positionEnd, this.#goalVelocity, dt);
      this.constrain?.(this.positionEnd);
    }

    const settled =
      !keyboardMoving &&
      !rotating &&
      vec3.distance(this.position, this.positionEnd) <
        this.restAngle * nearDistance(this.lens) &&
      Math.abs(this.zoomValue - this.zoomEnd) <
        this.restThreshold * this.zoomEnd;

    if (!settled) return true;
    if (
      !vec3.equals(this.position, this.positionEnd) ||
      this.zoomValue !== this.zoomEnd
    ) {
      this.stop();
    }
    return false;
  }

  protected writePose(out: Pose): void {
    this.orientation(out.orientation);
    vec3.set(out.position, this.position);
    this.applyPoseOffset?.(out.position);
    vec3.multQuat(vec3.set(out.target, NEG_Z_AXIS), out.orientation);
    vec3.add(out.target, out.position);
    // The camera up, not the world up: it carries roll and never parallels the
    // forward direction, so a target and up rebuild the view at any angle.
    vec3.multQuat(vec3.set(out.up, Y_AXIS), out.orientation);
    out.zoom = this.zoomValue;
  }

  /** Right, up and forward unit vectors for movement. */
  protected moveBasis(right: Vec3, up: Vec3, forward: Vec3): void {
    const orientation = this.orientation(TEMP_QUAT);
    vec3.multQuat(vec3.set(right, X_AXIS), orientation);
    vec3.multQuat(vec3.set(up, Y_AXIS), orientation);
    vec3.multQuat(vec3.set(forward, NEG_Z_AXIS), orientation);
  }

  /** Set the end position and zoom within the constraints. */
  protected setEnd(position: Vec3, zoom: number): void {
    vec3.set(this.positionEnd, position);
    this.constrain?.(this.positionEnd);
    this.zoomEnd = utils.clamp(zoom, this.zoomBounds[0], this.zoomBounds[1]);
  }

  /** Pose-only position offset, e.g. head bob. */
  protected applyPoseOffset?(position: Vec3): void;

  // Zooming in narrows the angle a pixel covers.
  protected get restAngle(): Radian {
    return this.restThreshold / this.zoomEnd;
  }

  // Travelling through the scene, the view turns with the pointer as in games and editor fly cameras, whatever the input: target controls grab the content instead.
  protected lookAngle(speed: number): Radian {
    return VIEW_SIGN * effectiveFov(this.lens, 1, this.zoomValue) * speed;
  }

  /** Current orientation. */
  protected abstract orientation(out: Quat): Quat;

  protected abstract setOrientationEnd(orientation: Quat): void;

  /** Advance rotation damping. Returns false once settled. */
  protected abstract stepRotation(dt: Second): boolean;

  protected abstract stopRotation(): void;

  #move(x: number, y: number, z: number): void {
    this.moveBasis(TEMP_RIGHT, TEMP_UP, TEMP_FORWARD);
    vec3.scale(vec3.set(TEMP_MOVE, TEMP_RIGHT), x);
    vec3.addScaled(TEMP_MOVE, TEMP_UP, y);
    vec3.addScaled(TEMP_MOVE, TEMP_FORWARD, z);
    vec3.add(this.positionEnd, TEMP_MOVE);
    this.constrain?.(this.positionEnd);
  }

  // World velocity requested by the keys.
  #keyboardVelocity(out: Vec3): boolean {
    const axes = movementAxes(
      TEMP_AXES,
      this.enabled ? this.keyboard : null,
      this.#keys,
    );
    const moving = axes[0] !== 0 || axes[1] !== 0 || axes[2] !== 0;

    if (moving !== this.#keyboardMoving) {
      this.#keyboardMoving = moving;
      if (moving) this.emit("controlstart", CONTROL_START);
      else this.emit("controlend", CONTROL_END);
    }
    if (!moving) {
      vec3.set(out, ZERO);
      return false;
    }

    // Diagonals are not faster.
    const length = vec3.length(axes);
    const sprint = this.keyboard?.isPressed(this.#keys.sprint)
      ? this.sprintMultiplier
      : 1;
    const slow = this.keyboard?.isPressed(this.#keys.slow)
      ? this.slowMultiplier
      : 1;
    const speed =
      (this.speed * sprint * slow) / Math.max(length, utils.EPSILON);

    this.moveBasis(TEMP_RIGHT, TEMP_UP, TEMP_FORWARD);
    vec3.scale(vec3.set(out, TEMP_RIGHT), axes[0] * speed);
    vec3.addScaled(out, TEMP_UP, axes[1] * speed);
    vec3.addScaled(out, TEMP_FORWARD, axes[2] * speed);
    this.emit("control", CONTROL);
    return true;
  }
}

export type { SteeringAction, SteeringSettings, SteeringControlsOptions };
export default SteeringControls;
