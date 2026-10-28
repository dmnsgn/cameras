import { aabb } from "pex-geom";
import { quat, utils, vec3 } from "pex-math";
import { damp } from "ressort";

import PoseModifier from "./PoseModifier.js";
import {
  boxFitHalfHeight,
  isOrthographic,
  tanHalfFov,
} from "../camera/lens.js";
import { NEG_Z_AXIS, halfLifeFromDampingTime } from "../core/math.js";
import { subjectPosition } from "../core/pose.js";

import type { AABB } from "pex-geom";
import type { Vec2, Vec3 } from "pex-math";
import type { Lens } from "../camera/types.js";
import type { Pose, Subject } from "../core/pose.js";
import type { Radian, Second } from "../core/types.js";

/**
 * How to reach the framing size:
 *
 * - `zoom`: change the field of view, or the orthographic zoom
 * - `dolly`: move along the view axis
 * - `dolly-then-zoom`: move within the dolly range, then zoom for the rest
 */
type SizeAdjustment = "zoom" | "dolly" | "dolly-then-zoom";

/** Screen dimensions the group fills: one, or whichever fills first. */
type FramingMode = "horizontal" | "vertical" | "both";

interface GroupFramingSettings {
  subjects?: Subject[];
  /** Radius around each subject, kept in frame. */
  radius?: number;
  lens?: Lens;
  /** Screen fraction the group fills. */
  framingSize?: number;
  framingMode?: FramingMode;
  sizeAdjustment?: SizeAdjustment;
  /** Dolly limits from the input position, negative closer. */
  dollyRange?: Vec2;
  /** Field of view limits when zooming in perspective. */
  fovRange?: Vec2;
  /** Time to cover half of a framing change. */
  halfLife?: Second;
  /** Screen angle below which motion rests. */
  restThreshold?: Radian;
}

const DEGREE = Math.PI / 180;

const TEMP_VEC3 = vec3.create();
const TEMP_SIZE = vec3.create();
const TEMP_QUAT = quat.create();
const TEMP_BOX: AABB = aabb.create();

/**
 * Keep several subjects in frame by dollying and zooming, from their bounds
 * seen along the view axis. Compose the group with a following `Composer` whose
 * subject is the group `center`.
 *
 * @see https://github.com/Unity-Technologies/com.unity.cinemachine/blob/main/com.unity.cinemachine/Runtime/Behaviours/CinemachineGroupFraming.cs
 */
class GroupFraming extends PoseModifier<GroupFramingSettings> {
  public subjects: Subject[] = [];
  public radius = 1;
  public lens?: Lens;
  // Cinemachine GroupFraming defaults.
  public framingSize = 0.8;
  public framingMode: FramingMode = "both";
  public sizeAdjustment: SizeAdjustment = "dolly-then-zoom";
  public dollyRange: Vec2 = [-100, 100];
  public fovRange: Vec2 = [1 * DEGREE, 100 * DEGREE];
  public halfLife: Second = halfLifeFromDampingTime(2);
  public restThreshold = 1e-4;

  /** Center of the group's bounds, seen from the last pose. */
  public readonly center: Vec3 = vec3.create();

  #dolly: number | null = null;
  // Field of view in perspective, zoom in orthographic.
  #lens: number | null = null;

  constructor(options: GroupFramingSettings = {}) {
    super();
    this.set(options);
  }

  /** Jump to the framing on the next update. */
  public reset(): this {
    this.#dolly = this.#lens = null;
    return this;
  }

  protected modify(out: Pose, dt: Second): boolean {
    if (!this.subjects.length) return false;

    // Bounds in view space, spheres around each subject included.
    const inverse = quat.invert(quat.set(TEMP_QUAT, out.orientation));
    aabb.empty(TEMP_BOX);
    for (const subject of this.subjects) {
      vec3.sub(vec3.set(TEMP_VEC3, subjectPosition(subject)), out.position);
      aabb.includePoint(TEMP_BOX, vec3.multQuat(TEMP_VEC3, inverse));
    }
    const [min, max] = TEMP_BOX;
    for (let i = 0; i < 3; i++) {
      min[i] -= this.radius;
      max[i] += this.radius;
    }
    const size = aabb.size(TEMP_BOX, TEMP_SIZE);
    const viewCenter = aabb.center(TEMP_BOX, TEMP_VEC3);
    vec3.multQuat(vec3.set(this.center, viewCenter), out.orientation);
    vec3.add(this.center, out.position);
    const depth = -viewCenter[2];

    if (this.framingMode === "horizontal") size[1] = 0;
    else if (this.framingMode === "vertical") size[0] = 0;
    const fit = boxFitHalfHeight(this.lens, size) / this.framingSize;

    return isOrthographic(this.lens)
      ? this.#zoom(out, this.lens.size ?? 1, depth, fit, dt)
      : this.#dollyZoom(out, size, depth, fit, dt);
  }

  // Dollying doesn't change an orthographic size: zoom only.
  #zoom(
    out: Pose,
    lensSize: number,
    depth: number,
    fit: number,
    dt: Second,
  ): boolean {
    const goal = lensSize / fit;
    this.#dolly = 0;
    this.#lens = this.#damp(this.#lens, goal, dt);
    const moving = Math.abs(this.#lens - goal) >= this.restThreshold * goal;
    if (!moving) this.#lens = goal;
    out.zoom = this.#lens;
    this.#dollyBack(out, depth, this.#dolly);
    return moving;
  }

  // Distance to the group center framing it, in front of its closest face.
  #dollyZoom(
    out: Pose,
    size: Vec3,
    depth: number,
    fit: number,
    dt: Second,
  ): boolean {
    const zoom = out.zoom ?? 1;
    const tanHalf = tanHalfFov(this.lens, out);
    const [near, far] = this.dollyRange;
    const dollyGoal =
      this.sizeAdjustment === "zoom"
        ? 0
        : utils.clamp(fit / tanHalf + size[2] / 2 - depth, near, far);
    this.#dolly = this.#damp(this.#dolly, dollyGoal, dt);
    const moving =
      Math.abs(this.#dolly - dollyGoal) >=
      this.restThreshold * Math.max(depth, utils.EPSILON);
    if (!moving) this.#dolly = dollyGoal;
    this.#dollyBack(out, depth, this.#dolly);
    if (this.sizeAdjustment === "dolly") return moving;

    // Zoom for what the dolly can't reach, at the goal distance: the input
    // field of view when it can.
    const front = Math.max(depth + dollyGoal - size[2] / 2, utils.EPSILON);
    const [minFov, maxFov] = this.fovRange;
    const goal = utils.clamp(
      2 * Math.atan((fit * zoom) / front),
      minFov,
      maxFov,
    );
    this.#lens = this.#damp(this.#lens, goal, dt);
    const zooming = Math.abs(this.#lens - goal) >= this.restThreshold;
    if (!zooming) this.#lens = goal;
    out.fov = this.#lens;
    return moving || zooming;
  }

  // Along the view axis, keeping the target on it at the group.
  #dollyBack(out: Pose, depth: number, dolly: number): void {
    vec3.multQuat(vec3.set(TEMP_VEC3, NEG_Z_AXIS), out.orientation);
    vec3.addScaled(out.position, TEMP_VEC3, -dolly);
    vec3.addScaled(
      vec3.set(out.target, out.position),
      TEMP_VEC3,
      Math.max(depth + dolly, utils.EPSILON),
    );
  }

  #damp(current: number | null, goal: number, dt: Second): number {
    return current === null ? goal : damp(current, goal, this.halfLife, dt);
  }
}

export type { FramingMode, GroupFramingSettings, SizeAdjustment };
export default GroupFraming;
