import { quat, vec3 } from "pex-math";

import { NEG_Z_AXIS } from "./math.js";

import type { Quat, Vec3 } from "pex-math";
import type { Radian } from "./types.js";

/**
 * Camera placement produced by controllers and rigs, consumed by any camera
 * through an adapter.
 */
interface Pose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  orientation: Quat;
  fov?: Radian;
  zoom?: number;
  /** Distance to the plane in focus, for depth of field. */
  focusDistance?: number;
}

/** Point to look at, or a function returning it on each update. */
type Subject = Vec3 | (() => Vec3);

/** Write a pose into an object. */
type PoseAdapter<T> = (pose: Pose, object: T) => void;

/** Create a pose at +Z looking at the origin. */
function create(): Pose {
  return {
    position: [0, 0, 1],
    target: [0, 0, 0],
    up: [0, 1, 0],
    orientation: [0, 0, 0, 1],
  };
}

/** Current position of a subject. */
function subjectPosition(subject: Subject): Vec3 {
  return typeof subject === "function" ? subject() : subject;
}

const TEMP_FORWARD = vec3.create();
const TEMP_OFFSET = vec3.create();

/** Depth of a point along a pose's view axis, negative behind it. */
function depthOf(pose: Pose, point: Vec3): number {
  vec3.multQuat(vec3.set(TEMP_FORWARD, NEG_Z_AXIS), pose.orientation);
  return vec3.dot(
    vec3.sub(vec3.set(TEMP_OFFSET, point), pose.position),
    TEMP_FORWARD,
  );
}

/** Copy a pose into another. */
function set(out: Pose, pose: Pose): Pose {
  vec3.set(out.position, pose.position);
  vec3.set(out.target, pose.target);
  vec3.set(out.up, pose.up);
  quat.set(out.orientation, pose.orientation);
  out.fov = pose.fov;
  out.zoom = pose.zoom;
  out.focusDistance = pose.focusDistance;
  return out;
}

/**
 * Default adapter: copies vectors into existing arrays and lens values when
 * both sides define them.
 */
function defaultAdapter(pose: Pose, object: Partial<Pose>): void {
  if (object.position) vec3.set(object.position, pose.position);
  if (object.target) vec3.set(object.target, pose.target);
  if (object.up) vec3.set(object.up, pose.up);
  if (object.orientation) quat.set(object.orientation, pose.orientation);
  if (pose.fov !== undefined && "fov" in object) object.fov = pose.fov;
  if (pose.zoom !== undefined && "zoom" in object) object.zoom = pose.zoom;
  if (pose.focusDistance !== undefined && "focusDistance" in object) {
    object.focusDistance = pose.focusDistance;
  }
}

/**
 * Apply a pose to an object through an adapter.
 *
 * @param pose Source pose.
 * @param object Updated by the adapter.
 * @param [adapter=defaultAdapter]
 * @returns Object
 */
function applyTo<T>(
  pose: Pose,
  object: T,
  adapter: PoseAdapter<T> = defaultAdapter as PoseAdapter<T>,
): T {
  adapter(pose, object);
  return object;
}

export { create, set, subjectPosition, depthOf, defaultAdapter, applyTo };
export type { Pose, PoseAdapter, Subject };
