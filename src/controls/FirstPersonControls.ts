import { quat, utils, vec3 } from "pex-math";
import { smoothDamp } from "ressort";

import { shortestAngle, NEG_Z_AXIS, X_AXIS, Y_AXIS } from "../core/math.js";

import SteeringControls from "./SteeringControls.js";
import { deltaOf, POINTER_LAG, STEP_FREQUENCY } from "./gestures.js";

import type { Quat, Vec3 } from "pex-math";
import type { SpringState } from "ressort";
import type { Radian, Second } from "../core/types.js";
import type {
  SteeringAction,
  SteeringControlsOptions,
  SteeringSettings,
} from "./SteeringControls.js";
import type { Bindings, Gesture } from "./types.js";

type FirstPersonAction = SteeringAction | "pan-tilt";

interface FirstPersonSettings extends SteeringSettings {
  lookSpeed?: number;
  /** Lag behind the pointer, 0 for raw input. */
  lookSmoothTime?: Second;
  /** Up and down limits of the tilt. */
  tiltBounds?: [Radian, Radian];
  /** Vertical head bob in units, 0 to disable. */
  headBobAmplitude?: number;
  /** Head bob cycles per second at walking speed. */
  headBobFrequency?: number;
}

interface FirstPersonControlsOptions
  extends FirstPersonSettings, SteeringControlsOptions<FirstPersonAction> {}

interface FirstPersonState {
  position: Vec3;
  pan: Radian;
  tilt: Radian;
  zoom: number;
}

const DEFAULT_BINDINGS: Bindings<FirstPersonAction> = {
  locked: "pan-tilt",
  "mouse:primary": "pan-tilt",
  "mouse:secondary": ["pan-tilt", "aim"],
  "touch:1": "pan-tilt",
  "touch:2": ["truck-dolly", "zoom"],
  wheel: "dolly",
  pinch: "zoom",
};

const TEMP_QUAT = quat.create();
const TEMP_QUAT_2 = quat.create();
const TEMP_DIRECTION = vec3.create();

/**
 * Walk and look around: pan around the fixed up axis, tilt within limits, move
 * on the ground plane.
 *
 * Use with `PointerManager.requestPointerLock` for mouse look.
 */
class FirstPersonControls extends SteeringControls<
  FirstPersonAction,
  FirstPersonSettings,
  FirstPersonState
> {
  public static readonly DEFAULT_BINDINGS: Readonly<
    Bindings<FirstPersonAction>
  > = DEFAULT_BINDINGS;

  public lookSpeed = 1;
  public lookSmoothTime: Second = POINTER_LAG;
  public tiltBounds: [Radian, Radian] = [-Math.PI / 2, Math.PI / 2];
  public headBobAmplitude = 0;
  public headBobFrequency = STEP_FREQUENCY;

  // Pan counter-clockwise around up from -Z, tilt up from the horizon.
  #pan = 0;
  #panEnd = 0;
  #tilt = 0;
  #tiltEnd = 0;
  #panSpring: SpringState = { velocity: 0 };
  #tiltSpring: SpringState = { velocity: 0 };
  #bobPhase = 0;
  #bobWeight = 0;
  #previousPosition: Vec3 = [0, 0, 0];

  constructor({
    bindings,
    up,
    position,
    target,
    ...options
  }: FirstPersonControlsOptions = {}) {
    super({ ...DEFAULT_BINDINGS, ...bindings });
    this.set(options);
    this.up = up ?? Y_AXIS;
    this.setPosition(position ?? [0, 0, 0], false);
    if (target) this.lookAt(target, false);
    this.saveState();
  }

  public getPanTilt(end = false): [Radian, Radian] {
    return end ? [this.#panEnd, this.#tiltEnd] : [this.#pan, this.#tilt];
  }

  /** Rotate by relative angles: pan counter-clockwise (left), tilt up. */
  public panTilt(pan: Radian, tilt: Radian, transition = true): this {
    return this.panTiltTo(this.#panEnd + pan, this.#tiltEnd + tilt, transition);
  }

  public panTiltTo(pan: Radian, tilt: Radian, transition = true): this {
    this.#panEnd = pan;
    this.#tiltEnd = utils.clamp(tilt, this.tiltBounds[0], this.tiltBounds[1]);
    return this.commit(transition);
  }

  public lookAt(target: Vec3, transition = true): this {
    vec3.sub(vec3.set(TEMP_DIRECTION, target), this.positionEnd);
    if (vec3.lengthSq(TEMP_DIRECTION) < utils.EPSILON * utils.EPSILON)
      return this;
    this.#lookAlong(TEMP_DIRECTION);
    return this.commit(transition);
  }

  public getState(): FirstPersonState {
    return {
      position: this.getPosition(vec3.create(), true),
      pan: this.#panEnd,
      tilt: this.#tiltEnd,
      zoom: this.zoomEnd,
    };
  }

  public setState(state: FirstPersonState, transition = true): this {
    this.setEnd(state.position, state.zoom);
    return this.panTiltTo(state.pan, state.tilt, transition);
  }

  protected override applyAction(
    action: FirstPersonAction,
    gesture: Gesture,
  ): void {
    if (action !== "pan-tilt") return super.applyAction(action, gesture);

    const delta = deltaOf(gesture);
    const dx = delta[0];
    const dy = delta[1];
    const angle = this.lookAngle(this.lookSpeed);
    this.#panEnd += dx * angle;
    this.#tiltEnd = utils.clamp(
      this.#tiltEnd + dy * angle,
      this.tiltBounds[0],
      this.tiltBounds[1],
    );
    this.invalidate();
  }

  // Pan and tilt only: the roll is dropped.
  protected setOrientationEnd(orientation: Quat): void {
    this.#lookAlong(
      vec3.multQuat(vec3.set(TEMP_DIRECTION, NEG_Z_AXIS), orientation),
    );
  }

  protected orientation(out: Quat): Quat {
    quat.fromAxisAngle(TEMP_QUAT, Y_AXIS, this.#pan);
    quat.mult(TEMP_QUAT, quat.fromAxisAngle(out, X_AXIS, this.#tilt));
    return quat.mult(quat.set(out, this.upSpaceInverse), TEMP_QUAT);
  }

  // Walking ignores the tilt: forward stays on the ground plane.
  protected override moveBasis(right: Vec3, up: Vec3, forward: Vec3): void {
    quat.fromAxisAngle(TEMP_QUAT, Y_AXIS, this.#pan);
    const orientation = quat.mult(
      quat.set(TEMP_QUAT_2, this.upSpaceInverse),
      TEMP_QUAT,
    );
    vec3.multQuat(vec3.set(forward, NEG_Z_AXIS), orientation);
    vec3.multQuat(vec3.set(right, X_AXIS), orientation);
    vec3.set(up, this.upVector);
  }

  protected stepRotation(dt: Second): boolean {
    this.#pan = smoothDamp(
      this.#pan,
      this.#panEnd,
      this.#panSpring,
      this.lookSmoothTime,
      dt,
    );
    this.#tilt = smoothDamp(
      this.#tilt,
      this.#tiltEnd,
      this.#tiltSpring,
      this.lookSmoothTime,
      dt,
    );
    const bobbing = this.#stepHeadBob(dt);
    if (
      bobbing ||
      Math.abs(this.#pan - this.#panEnd) > this.restAngle ||
      Math.abs(this.#tilt - this.#tiltEnd) > this.restAngle
    ) {
      return true;
    }
    if (this.#pan !== this.#panEnd || this.#tilt !== this.#tiltEnd) {
      this.stopRotation();
      this.invalidate();
    }
    return false;
  }

  protected stopRotation(): void {
    this.#pan = this.#panEnd;
    this.#tilt = this.#tiltEnd;
    this.#panSpring.velocity = this.#tiltSpring.velocity = 0;
    // Teleports are not steps.
    vec3.set(this.#previousPosition, this.position);
  }

  protected override applyPoseOffset(position: Vec3): void {
    if (this.#bobWeight > 0) {
      vec3.addScaled(
        position,
        this.upVector,
        this.headBobAmplitude * this.#bobWeight * Math.sin(this.#bobPhase),
      );
    }
  }

  // Phase advances with the ground speed so the bob matches the steps, and fades out when stopping.
  #stepHeadBob(dt: Second): boolean {
    if (!this.headBobAmplitude || dt <= 0) {
      this.#bobWeight = 0;
      vec3.set(this.#previousPosition, this.position);
      return false;
    }
    vec3.sub(this.#previousPosition, this.position);
    vec3.addScaled(
      this.#previousPosition,
      this.upVector,
      -vec3.dot(this.#previousPosition, this.upVector),
    );
    const groundSpeed = vec3.length(this.#previousPosition) / dt;
    vec3.set(this.#previousPosition, this.position);

    const weight = this.speed > 0 ? Math.min(groundSpeed / this.speed, 1) : 0;
    this.#bobPhase += 2 * Math.PI * this.headBobFrequency * weight * dt;
    this.#bobWeight += (weight - this.#bobWeight) * Math.min(1, dt * 10);
    if (this.#bobWeight < 1e-3 && weight === 0) {
      this.#bobWeight = 0;
      this.#bobPhase = 0;
      return false;
    }
    return true;
  }

  #lookAlong(direction: Vec3): void {
    vec3.normalize(vec3.multQuat(direction, this.upSpace));
    // Straight up or down, the pan is undefined: keep it.
    const pan =
      Math.hypot(direction[0], direction[2]) < utils.EPSILON
        ? this.#panEnd
        : Math.atan2(-direction[0], -direction[2]);
    this.#panEnd = shortestAngle(pan, this.#panEnd);
    this.#tiltEnd = utils.clamp(
      Math.asin(utils.clamp(direction[1], -1, 1)),
      ...this.tiltBounds,
    );
  }
}

export type {
  FirstPersonAction,
  FirstPersonSettings,
  FirstPersonControlsOptions,
  FirstPersonState,
};
export default FirstPersonControls;
