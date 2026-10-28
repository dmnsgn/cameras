export { default as Emitter } from "./Emitter.js";
export { default as PoseSource } from "./PoseSource.js";
export * as pose from "./pose.js";
export { default as Spline } from "./spline.js";
export {
  TAU,
  X_AXIS,
  Y_AXIS,
  Z_AXIS,
  NEG_Z_AXIS,
  ZERO,
  scaleAround,
  safeDivide,
  halfLifeFromDampingTime,
  normalizeAngle,
  shortestAngle,
  signedAngle,
  quatFromUnitVectors,
  quatLookAt,
  quatPanTiltRoll,
  sphericalCreate,
  sphericalFromVec3,
  sphericalFromPositionTarget,
  vec3FromSpherical,
  vec3FromSphericalTarget,
} from "./math.js";

export type * from "./types.js";
export type { Listener, ListenerOptions } from "./Emitter.js";
export type { PoseSourceEvent, PoseSourceEventMap } from "./PoseSource.js";
export type { Pose, PoseAdapter, Subject } from "./pose.js";
export type { Spherical } from "./math.js";
export type { SplineOptions } from "./spline.js";
