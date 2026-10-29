import { quat, vec3 } from "pex-math";
import {
  advance,
  createTransition,
  fromPhysical,
  smoothDampQuat,
  transition,
} from "ressort";

import {
  normalizeAngle,
  quatLookAt,
  NEG_Z_AXIS,
  X_AXIS,
  Y_AXIS,
  Z_AXIS,
  ZERO,
} from "../core/math.js";

import SteeringControls from "./SteeringControls.js";
import {
  deltaOf,
  grabSign,
  twistOf,
  DEFAULT_MOVEMENT_KEYS,
  KEY_TURN_SPEED,
  POINTER_LAG,
} from "./gestures.js";
import { effectiveFov } from "../camera/lens.js";

import type { Quat, Vec3 } from "pex-math";
import type { Radian, Second } from "../core/types.js";
import type {
  SteeringAction,
  SteeringControlsOptions,
  SteeringSettings,
} from "./SteeringControls.js";
import type { MovementKeys } from "./gestures.js";
import type { Bindings, Gesture } from "./types.js";

type FlyAction = SteeringAction | "pan-tilt" | "roll";

interface RollKeys {
  rollLeft: string[];
  rollRight: string[];
}

interface FlySettings extends SteeringSettings {
  lookSpeed?: number;
  /** Scales the key roll rate and the roll per normalized drag. */
  rollSpeed?: number;
  /** Lag behind the pointer, 0 for raw input. */
  lookSmoothTime?: Second;
  rollKeys?: RollKeys;
  /** Gravity rolls the horizon back upright while not rolling. */
  autoLevel?: boolean;
  /** Steadicam drop time: a rig released horizontal swings level in this time. */
  dropTime?: Second;
  /** Toggle `autoLevel`. */
  levelKeys?: string[];
}

interface FlyControlsOptions
  extends FlySettings, SteeringControlsOptions<FlyAction> {}

interface FlyState {
  position: Vec3;
  orientation: Quat;
  zoom: number;
}

const DEFAULT_BINDINGS: Bindings<FlyAction> = {
  locked: "pan-tilt",
  "mouse:primary": "pan-tilt",
  "mouse:secondary": "pan-tilt",
  "mouse:auxiliary": "truck-pedestal",
  "touch:1": "pan-tilt",
  "touch:2": ["dolly", "truck-pedestal", "roll"],
  wheel: "dolly",
  pinch: ["dolly", "roll"],
};

// Q and E roll, as in 6DoF games, so up and down move off them.
const DEFAULT_KEYS: MovementKeys = {
  ...DEFAULT_MOVEMENT_KEYS,
  up: ["Space"],
  down: ["KeyC"],
};

// Looking along the up axis, the horizon is undefined.
const LEVEL_EPSILON = 1e-3;

/**
 * Complete elliptic integral K(1/√2): an undamped pendulum released at 90°
 * swings to the bottom in K(sin 45°) / ω.
 *
 * @see https://en.wikipedia.org/wiki/Pendulum_(mechanics)#Arbitrary-amplitude_period
 */
const DROP_FROM_HORIZONTAL = 1.8540746773013719;

/**
 * Lower end of the 1.5 to 3 s Steadicam operators pick.
 *
 * @see https://www.dvinfo.net/forum/archive/index.php/t-30014.html
 */
const DROP_TIME: Second = 1.5;

const TEMP_QUAT = quat.create();
const TEMP_UP = vec3.create();
const TEMP_LEVEL = quat.create();
const TEMP_SPRING = { velocity: 0 };
const TEMP_STEP = createTransition();

/**
 * Six degrees of freedom: pan, tilt and roll around the camera's own axes, move
 * along them.
 */
class FlyControls extends SteeringControls<FlyAction, FlySettings, FlyState> {
  public static readonly DEFAULT_BINDINGS: Readonly<Bindings<FlyAction>> =
    DEFAULT_BINDINGS;

  public lookSpeed = 1;
  public rollSpeed = 1;
  public lookSmoothTime: Second = POINTER_LAG;
  public rollKeys: RollKeys = { rollLeft: ["KeyQ"], rollRight: ["KeyE"] };
  public autoLevel = true;
  public dropTime: Second = DROP_TIME;
  public levelKeys: string[] = ["KeyZ"];

  #orientation: Quat = quat.create();
  #orientationEnd: Quat = quat.create();
  #angularVelocity: Vec3 = [0, 0, 0];
  #levelKeyDown = false;
  #rollVelocity = 0;

  constructor({
    bindings,
    up,
    position,
    target,
    ...options
  }: FlyControlsOptions = {}) {
    super({ ...DEFAULT_BINDINGS, ...bindings }, DEFAULT_KEYS);
    this.set(options);
    this.up = up ?? Y_AXIS;
    this.setPosition(position ?? [0, 0, 0], false);
    // Level in the up space, as FirstPerson starts.
    if (target) this.lookAt(target, false);
    else this.setOrientation(this.upSpaceInverse, false);
    this.saveState();
  }

  public getOrientation(out: Quat = quat.create(), end = false): Quat {
    return quat.set(out, end ? this.#orientationEnd : this.#orientation);
  }

  public setOrientation(orientation: Quat, transition = true): this {
    this.setOrientationEnd(orientation);
    return this.commit(transition);
  }

  /**
   * Rotate around the camera's own up (pan, counter-clockwise), right (tilt,
   * upwards) and back (roll, counter-clockwise) axes.
   */
  public rotate(
    pan: Radian,
    tilt: Radian,
    roll: Radian,
    transition = true,
  ): this {
    this.#rotate(pan, tilt, roll);
    return this.commit(transition);
  }

  /** Look at a point, keeping the current roll as much as possible. */
  public lookAt(target: Vec3, transition = true): this {
    vec3.multQuat(vec3.set(TEMP_UP, Y_AXIS), this.#orientationEnd);
    quatLookAt(this.#orientationEnd, this.positionEnd, target, TEMP_UP);
    return this.commit(transition);
  }

  /** Bring the camera's up back to the world up, keeping the view direction. */
  public level(transition = true): this {
    this.#levelOrientation(this.#orientationEnd);
    return this.commit(transition);
  }

  public getState(): FlyState {
    return {
      position: this.getPosition(vec3.create(), true),
      orientation: this.getOrientation(quat.create(), true),
      zoom: this.zoomEnd,
    };
  }

  public setState(state: FlyState, transition = true): this {
    this.setEnd(state.position, state.zoom);
    return this.setOrientation(state.orientation, transition);
  }

  protected override applyAction(action: FlyAction, gesture: Gesture): void {
    if (action !== "pan-tilt" && action !== "roll") {
      return super.applyAction(action, gesture);
    }

    if (action === "pan-tilt") {
      const delta = deltaOf(gesture);
      const dx = delta[0];
      const dy = delta[1];
      const angle =
        grabSign(gesture) *
        effectiveFov(this.lens, 1, this.zoomValue) *
        this.lookSpeed;
      this.#rotate(dx * angle, dy * angle, 0);
    } else {
      // The horizon follows the fingers: the camera rolls the opposite way.
      this.#rotate(0, 0, -twistOf(gesture) * this.rollSpeed);
    }
    this.invalidate();
  }

  protected setOrientationEnd(orientation: Quat): void {
    quat.normalize(quat.set(this.#orientationEnd, orientation));
  }

  protected orientation(out: Quat): Quat {
    return quat.set(out, this.#orientation);
  }

  protected stepRotation(dt: Second): boolean {
    const keyboard = this.enabled ? this.keyboard : null;
    const roll = keyboard
      ? keyboard.axis(this.rollKeys.rollRight, this.rollKeys.rollLeft)
      : 0;
    if (roll) this.#rotate(0, 0, roll * this.rollSpeed * KEY_TURN_SPEED * dt);

    const levelKeyDown = keyboard?.isPressed(this.levelKeys) ?? false;
    if (levelKeyDown && !this.#levelKeyDown) this.autoLevel = !this.autoLevel;
    this.#levelKeyDown = levelKeyDown;
    // A held roll is the operator's hand on the rig.
    if (roll || !this.autoLevel) this.#rollVelocity = 0;
    const levelling = this.autoLevel && !roll && this.#stepLevel(dt);

    const remaining = smoothDampQuat(
      this.#orientation,
      this.#orientationEnd,
      this.#angularVelocity,
      this.lookSmoothTime,
      dt,
    );
    if (roll !== 0 || levelling || remaining > this.restAngle) return true;
    if (remaining > 0) {
      this.stopRotation();
      this.invalidate();
    }
    return false;
  }

  protected stopRotation(): void {
    quat.set(this.#orientation, this.#orientationEnd);
    vec3.set(this.#angularVelocity, ZERO);
    this.#rollVelocity = 0;
  }

  // A critically damped pendulum: gravity's torque grows with the sine of the
  // roll, so the horizon eases in, and upside down barely rights itself.
  #stepLevel(dt: Second): boolean {
    const level = quat.set(TEMP_LEVEL, this.#orientationEnd);
    if (!this.#levelOrientation(level)) {
      this.#rollVelocity = 0;
      return false;
    }
    const offset = quat.mult(quat.conjugate(level), this.#orientationEnd);
    const roll = normalizeAngle(2 * Math.atan2(offset[2], offset[3]));
    if (Math.abs(roll) <= this.restAngle) {
      this.#rollVelocity = 0;
      return false;
    }

    // Linear around the current roll, exact over dt.
    const omega = DROP_FROM_HORIZONTAL / this.dropTime;
    const spring = fromPhysical({
      stiffness: (omega * omega * Math.sin(roll)) / roll,
      damping: 2 * omega,
    });
    TEMP_SPRING.velocity = this.#rollVelocity;
    const next = advance(
      roll,
      0,
      TEMP_SPRING,
      transition(TEMP_STEP, spring, dt),
    );
    this.#rollVelocity = TEMP_SPRING.velocity;
    this.#rotate(0, 0, next - roll);
    return true;
  }

  #levelOrientation(out: Quat): boolean {
    vec3.multQuat(vec3.set(TEMP_UP, NEG_Z_AXIS), this.#orientationEnd);
    if (Math.abs(vec3.dot(TEMP_UP, this.upVector)) > 1 - LEVEL_EPSILON) {
      return false;
    }
    vec3.add(TEMP_UP, this.positionEnd);
    quatLookAt(out, this.positionEnd, TEMP_UP, this.upVector);
    return true;
  }

  // Post-multiplication rotates around local axes.
  #rotate(pan: Radian, tilt: Radian, roll: Radian): void {
    const end = this.#orientationEnd;
    if (pan) quat.mult(end, quat.fromAxisAngle(TEMP_QUAT, Y_AXIS, pan));
    if (tilt) quat.mult(end, quat.fromAxisAngle(TEMP_QUAT, X_AXIS, tilt));
    if (roll) quat.mult(end, quat.fromAxisAngle(TEMP_QUAT, Z_AXIS, roll));
    quat.normalize(end);
  }
}

export type { FlyAction, RollKeys, FlySettings, FlyControlsOptions, FlyState };
export default FlyControls;
