import { quat, utils, vec2, vec3 } from "pex-math";
import { halfLifeDecay } from "ressort";

import PoseModifier from "./PoseModifier.js";
import { tanHalfFov } from "../camera/lens.js";
import {
  NEG_Z_AXIS,
  X_AXIS,
  Y_AXIS,
  halfLifeFromDampingTime,
  signedAngle,
} from "../core/math.js";
import { depthOf, subjectPosition } from "../core/pose.js";

import type { Vec2, Vec3 } from "pex-math";
import type { Pose, Subject } from "../core/pose.js";
import type { Radian, Second } from "../core/types.js";
import type { Lens } from "../camera/types.js";

/**
 * How the operator reframes:
 *
 * - `pan-tilt`: rotate the camera in place, on a tripod head
 * - `truck-pedestal`: move the camera across the image plane, keeping its
 *   orientation, on a dolly or crane
 */
type Reframe = "pan-tilt" | "truck-pedestal";

interface ComposerSettings {
  subject?: Subject | null;
  lens?: Lens;
  reframe?: Reframe;
  /**
   * Desired subject screen position in NDC, e.g. [-1/3, 1/3] for a rule of
   * thirds.
   */
  screenPosition?: Vec2;
  /**
   * Half extents in NDC around the screen position where the subject moves
   * freely.
   */
  deadZone?: Vec2;
  /** Half extents in NDC the subject never leaves. */
  softZone?: Vec2;
  /** Time to correct half of the error outside the dead zone. */
  halfLife?: Second;
  /** Screen angle below which motion rests. */
  restThreshold?: Radian;
}

/**
 * Cinemachine Rotation Composer damping default of 0.5 s.
 *
 * @see https://github.com/Unity-Technologies/com.unity.cinemachine/blob/main/com.unity.cinemachine/Runtime/Components/CinemachineRotationComposer.cs
 */
const DAMPING_HALF_LIFE: Second = halfLifeFromDampingTime(0.5);

const TEMP_VEC3 = vec3.create();
const TEMP_UP = vec3.create();
const TEMP_RIGHT = vec3.create();
const TEMP_FROM = vec3.create();
const TEMP_TO = vec3.create();
const TEMP_QUAT = quat.create();
const TEMP_INPUT = quat.create();
const TEMP_INPUT_POSITION = vec3.create();
const TEMP_NDC: Vec2 = [0, 0];
const TEMP_GOAL: Vec2 = [0, 0];
const TEMP_STEP: Vec2 = [0, 0];
const TEMP_TAN: Vec2 = [0, 0];

const angleOf = (ndc: number, tanHalf: number): Radian =>
  Math.atan(ndc * tanHalf);

// View space direction through a point in NDC.
const directionOf = (out: Vec3, ndc: Vec2, tan: Vec2): Vec3 => {
  out[0] = ndc[0] * tan[0];
  out[1] = ndc[1] * tan[1];
  out[2] = -1;
  return out;
};

/**
 * Frame a subject as a camera operator would, by panning and tilting or by
 * trucking and pedestaling: free inside a dead zone, damped towards the
 * composition outside, never past the soft zone.
 *
 * @see https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineRotationComposer.html
 * @see https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachinePositionComposer.html
 * @see Haigh-Hutchinson, M. (2009). Real-Time Cameras. Morgan Kaufmann.
 */
class Composer extends PoseModifier<ComposerSettings> {
  public subject: Subject | null = null;
  public lens?: Lens;
  public reframe: Reframe = "pan-tilt";
  public screenPosition: Vec2 = [0, 0];
  // Cinemachine default sizes, enabled here: full screen fractions equal NDC
  // half extents.
  public deadZone: Vec2 = [0.2, 0.2];
  public softZone: Vec2 = [0.8, 0.8];
  public halfLife: Second = DAMPING_HALF_LIFE;
  public restThreshold = 1e-4;

  // Accumulated correction relative to the input: pan and tilt angles, or
  // truck and pedestal distances.
  #correction: Vec2 = [0, 0];
  #lastReframe: Reframe = this.reframe;

  constructor(options: ComposerSettings = {}) {
    super();
    this.set(options);
  }

  /** Forget the accumulated correction. */
  public reset(): this {
    this.#correction[0] = this.#correction[1] = 0;
    return this;
  }

  /**
   * Subject position in NDC through a pose, using its fov and zoom, null when
   * behind the camera.
   */
  public project(pose: Pose, out: Vec2 = [0, 0]): Vec2 | null {
    const subject = this.#subject();
    return subject && this.#project(pose, subject, out);
  }

  protected modify(out: Pose, dt: Second): boolean {
    // A correction in one mode means nothing in the other.
    if (this.reframe !== this.#lastReframe) {
      this.#lastReframe = this.reframe;
      this.reset();
    }
    const correction = this.#correction;
    const distance = vec3.distance(out.position, out.target);
    quat.set(TEMP_INPUT, out.orientation);
    vec3.set(TEMP_INPUT_POSITION, out.position);
    this.#apply(out, correction);

    const subject = this.#subject();
    const ndc = subject && this.#project(out, subject, TEMP_NDC);
    const restAngle = this.restThreshold / (out.zoom ?? 1);
    let moving: boolean;
    if (subject && ndc) {
      const tan = this.#tanHalf(out);
      // Testing the remaining correction, not this frame's share of it, keeps
      // the rest independent of the frame rate.
      moving =
        Math.abs(
          angleOf(this.#goal(ndc[0], 0, 1), tan[0]) - angleOf(ndc[0], tan[0]),
        ) >= restAngle ||
        Math.abs(
          angleOf(this.#goal(ndc[1], 1, 1), tan[1]) - angleOf(ndc[1], tan[1]),
        ) >= restAngle;
      const k = moving ? 1 - halfLifeDecay(this.halfLife, dt) : 1;
      TEMP_GOAL[0] = this.#goal(ndc[0], 0, k);
      TEMP_GOAL[1] = this.#goal(ndc[1], 1, k);
      if (this.#lastReframe === "pan-tilt") {
        this.#panTilt(out, TEMP_GOAL, ndc, tan);
      } else {
        this.#truckPedestal(out, TEMP_GOAL, ndc, tan, depthOf(out, subject));
      }
    } else {
      // Nothing to frame: ease back to the input pose.
      vec2.scale(correction, halfLifeDecay(this.halfLife, dt));
      const rest =
        this.#lastReframe === "pan-tilt" ? restAngle : restAngle * distance;
      moving =
        Math.max(Math.abs(correction[0]), Math.abs(correction[1])) >= rest;
      if (!moving) this.reset();
      quat.set(out.orientation, TEMP_INPUT);
      vec3.set(out.position, TEMP_INPUT_POSITION);
      this.#apply(out, correction);
    }

    // Keep the target on the view axis: consumers aiming at it keep the
    // composition.
    vec3.multQuat(vec3.set(out.target, NEG_Z_AXIS), out.orientation);
    vec3.scale(
      out.target,
      subject ? vec3.distance(out.position, subject) : distance,
    );
    vec3.add(out.target, out.position);

    return moving;
  }

  // Goal NDC on one axis: damped towards the dead zone edge, at least enough
  // to stay in the soft zone.
  #goal(ndc: number, axis: 0 | 1, k: number): number {
    const center = this.screenPosition[axis];
    const error = ndc - center;
    const outside =
      Math.sign(error) * Math.max(Math.abs(error) - this.deadZone[axis], 0);
    const soft = utils.clamp(
      ndc,
      center - this.softZone[axis],
      center + this.softZone[axis],
    );
    const goal = ndc - outside * k;
    return error > 0 ? Math.min(goal, soft) : Math.max(goal, soft);
  }

  // Rotate so the subject seen at `ndc` moves to `goal`. Pan is measured around
  // the world up, as it is applied: a screen angle would vanish looking down.
  // Straight down, panning only spins the image (gimbal lock), so corrections
  // slow down there.
  // See Cinemachine's GetCameraRotationToTarget:
  // https://github.com/Unity-Technologies/com.unity.cinemachine/blob/main/com.unity.cinemachine/Runtime/Core/UnityVectorExtensions.cs
  #panTilt(out: Pose, goal: Vec2, ndc: Vec2, tan: Vec2): void {
    const up = vec3.multQuat(
      vec3.normalize(vec3.set(TEMP_UP, out.up)),
      quat.invert(quat.set(TEMP_QUAT, out.orientation)),
    );
    const from = directionOf(TEMP_FROM, goal, tan);
    const to = directionOf(TEMP_TO, ndc, tan);
    const pan = signedAngle(from, to, up);
    quat.fromAxisAngle(TEMP_QUAT, up, pan);
    vec3.multQuat(from, TEMP_QUAT);
    const right = vec3.multQuat(vec3.set(TEMP_RIGHT, X_AXIS), TEMP_QUAT);
    TEMP_STEP[0] = pan;
    TEMP_STEP[1] = signedAngle(from, to, right);
    vec2.add(this.#correction, TEMP_STEP);
    this.#apply(out, TEMP_STEP);
  }

  // Move so the subject seen at `ndc` moves to `goal`: exact, as image plane
  // offsets at the subject's depth scale with it.
  #truckPedestal(
    out: Pose,
    goal: Vec2,
    ndc: Vec2,
    tan: Vec2,
    depth: number,
  ): void {
    TEMP_STEP[0] = (ndc[0] - goal[0]) * tan[0] * depth;
    TEMP_STEP[1] = (ndc[1] - goal[1]) * tan[1] * depth;
    vec2.add(this.#correction, TEMP_STEP);
    this.#apply(out, TEMP_STEP);
  }

  #apply(out: Pose, step: Vec2): void {
    const a = step[0];
    const b = step[1];
    if (this.#lastReframe === "pan-tilt") {
      this.#rotate(out, a, b);
    } else {
      const { orientation, position } = out;
      vec3.addScaled(
        position,
        vec3.multQuat(vec3.set(TEMP_VEC3, X_AXIS), orientation),
        a,
      );
      vec3.addScaled(
        position,
        vec3.multQuat(vec3.set(TEMP_VEC3, Y_AXIS), orientation),
        b,
      );
    }
  }

  #subject(): Vec3 | null {
    return this.subject && subjectPosition(this.subject);
  }

  #project(pose: Pose, subject: Vec3, out: Vec2): Vec2 | null {
    vec3.sub(vec3.set(TEMP_VEC3, subject), pose.position);
    vec3.multQuat(
      TEMP_VEC3,
      quat.invert(quat.set(TEMP_QUAT, pose.orientation)),
    );
    if (TEMP_VEC3[2] >= 0) return null;
    const tanHalf = this.#tanHalf(pose);
    out[0] = TEMP_VEC3[0] / -TEMP_VEC3[2] / tanHalf[0];
    out[1] = TEMP_VEC3[1] / -TEMP_VEC3[2] / tanHalf[1];
    return out;
  }

  // Half extents of the view in tangent space.
  #tanHalf(pose: Pose): Vec2 {
    const tanY = tanHalfFov(this.lens, pose);
    TEMP_TAN[0] = tanY * (this.lens?.aspect ?? 1);
    TEMP_TAN[1] = tanY;
    return TEMP_TAN;
  }

  // Pan around the world up, tilt around the camera's right axis.
  #rotate(out: Pose, pan: Radian, tilt: Radian): void {
    if (pan) {
      quat.fromAxisAngle(
        TEMP_QUAT,
        vec3.normalize(vec3.set(TEMP_VEC3, out.up)),
        pan,
      );
      quat.set(out.orientation, quat.mult(TEMP_QUAT, out.orientation));
    }
    if (tilt) {
      quat.mult(out.orientation, quat.fromAxisAngle(TEMP_QUAT, X_AXIS, tilt));
    }
    quat.normalize(out.orientation);
  }
}

export type { ComposerSettings, Reframe };
export default Composer;
