import { quat, utils, vec3 } from "pex-math";

import type { Quat, Vec3 } from "pex-math";
import type { Radian, Second } from "./types.js";

const TAU = Math.PI * 2;

const X_AXIS: Vec3 = [1, 0, 0];
const Y_AXIS: Vec3 = [0, 1, 0];
const Z_AXIS: Vec3 = [0, 0, 1];
const NEG_Z_AXIS: Vec3 = [0, 0, -1];
const ZERO: Vec3 = [0, 0, 0];

const TEMP_VEC3: Vec3 = vec3.create();
const TEMP_QUAT: Quat = quat.create();

/** `numerator / denominator`, or `fallback` unless the denominator is positive. */
function safeDivide(
  numerator: number,
  denominator: number,
  fallback = 0,
): number {
  return denominator > 0 ? numerator / denominator : fallback;
}

/**
 * Half-life of an exponential decay left with `residual` after `time`, e.g.
 * Cinemachine damping times, which leave 1% (`kNegligibleResidual`).
 *
 * @see https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/api/Unity.Cinemachine.Damper.html
 */
function halfLifeFromDampingTime(time: Second, residual = 0.01): Second {
  return (time * Math.LN2) / -Math.log(residual);
}

/** Wrap an angle to (-π, π]. */
function normalizeAngle(angle: Radian): Radian {
  const wrapped = ((angle % TAU) + TAU) % TAU;
  return wrapped > Math.PI ? wrapped - TAU : wrapped;
}

/**
 * Shift `current` by whole turns so that interpolating towards `target` takes
 * the shortest path.
 *
 * @see https://docs.godotengine.org/en/stable/classes/class_%40globalscope.html#class-globalscope-method-angle-difference
 * @see https://docs.unity3d.com/ScriptReference/Mathf.DeltaAngle.html
 */
function shortestAngle(current: Radian, target: Radian): Radian {
  return current + TAU * Math.round((target - current) / TAU);
}

/**
 * Angle from `a` to `b` around a unit axis, measured between their projections
 * on the plane perpendicular to it. 0 when either projection vanishes.
 *
 * @see https://docs.unity3d.com/ScriptReference/Vector3.SignedAngle.html
 */
function signedAngle(a: Vec3, b: Vec3, axis: Vec3): Radian {
  // The triple product ignores components along the axis, the dot product
  // needs them removed.
  return Math.atan2(
    vec3.dot(vec3.cross(vec3.set(TEMP_VEC3, a), b), axis),
    vec3.dot(a, b) - vec3.dot(a, axis) * vec3.dot(b, axis),
  );
}

/**
 * Set a quaternion to the shortest rotation from one unit vector to another.
 *
 * @param out Updated in place.
 * @param from Normalized vector.
 * @param to Normalized vector.
 */
function quatFromUnitVectors(out: Quat, from: Vec3, to: Vec3): Quat {
  let w = vec3.dot(from, to) + 1;

  // Opposite vectors: rotate 180° around any axis orthogonal to `from`.
  if (w < utils.EPSILON) {
    w = 0;

    vec3.set(
      TEMP_VEC3,
      Math.abs(from[0]) > Math.abs(from[2])
        ? [-from[1], from[0], 0]
        : [0, -from[2], from[1]],
    );
  } else {
    vec3.cross(vec3.set(TEMP_VEC3, from), to);
  }

  out[0] = TEMP_VEC3[0];
  out[1] = TEMP_VEC3[1];
  out[2] = TEMP_VEC3[2];
  out[3] = w;

  return quat.normalize(out);
}

/**
 * Rotate a quaternion in its own frame: pan around Y, tilt around X, roll
 * around Z.
 *
 * @param out Updated in place.
 */
function quatPanTiltRoll(out: Quat, angles: Vec3): Quat {
  const pan = angles[0];
  const tilt = angles[1];
  const roll = angles[2];
  if (pan) quat.mult(out, quat.fromAxisAngle(TEMP_QUAT, Y_AXIS, pan));
  if (tilt) quat.mult(out, quat.fromAxisAngle(TEMP_QUAT, X_AXIS, tilt));
  if (roll) quat.mult(out, quat.fromAxisAngle(TEMP_QUAT, Z_AXIS, roll));
  return quat.normalize(out);
}

/**
 * Set a quaternion orienting -Z from `eye` towards `target`.
 *
 * @param out Updated in place.
 * @param eye Eye position.
 * @param target Point to look at.
 * @param [up=[0, 1, 0]]
 */
function quatLookAt(
  out: Quat,
  eye: Vec3,
  target: Vec3,
  up: Vec3 = utils.Y_UP,
): Quat {
  return vec3.distanceSq(eye, target) < utils.EPSILON * utils.EPSILON
    ? // Direction undefined: keep the current orientation.
      out
    : // pex-math orients +Z from `from` to `to`, hence the swap.
      quat.fromPointToPoint(out, target, eye, up);
}

/**
 * Spherical coordinates in Y-up space: elevation from the horizon towards +Y,
 * azimuth around +Y from +Z towards +X.
 *
 * @see https://en.wikipedia.org/wiki/Spherical_coordinate_system
 */
type Spherical = [radius: number, elevation: Radian, azimuth: Radian];

/** Create spherical coordinates at radius 1 on the horizon facing +Z. */
function sphericalCreate(): Spherical {
  return [1, 0, 0];
}

/**
 * Set spherical coordinates from a cartesian vector.
 *
 * The azimuth is in (-π, π]: use {@link shortestAngle} to keep continuity with a
 * previous value. The origin maps to [0, 0, 0].
 *
 * @param out Updated in place.
 * @param v Cartesian vector.
 */
function sphericalFromVec3(out: Spherical, v: Vec3): Spherical {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  // Not Math.hypot, which boxes its arguments.
  // eslint-disable-next-line unicorn/prefer-modern-math-apis
  out[0] = Math.sqrt(x * x + y * y + z * z);
  // atan2 stays accurate near the poles, where asin(y / r) loses digits.
  // eslint-disable-next-line unicorn/prefer-modern-math-apis
  out[1] = Math.atan2(y, Math.sqrt(x * x + z * z));
  out[2] = Math.atan2(x, z);
  return out;
}

/**
 * Set spherical coordinates of `position` around `target` for a given up
 * vector.
 *
 * The up space is the shortest arc from `up` to +Y: the azimuth reference is
 * discontinuous at `up` = -Y.
 *
 * @param out Updated in place.
 * @param position Cartesian position.
 * @param target Center of the sphere.
 * @param [up=[0, 1, 0]] Normalized up vector.
 */
function sphericalFromPositionTarget(
  out: Spherical,
  position: Vec3,
  target: Vec3,
  up: Vec3 = utils.Y_UP,
): Spherical {
  quatFromUnitVectors(TEMP_QUAT, up, utils.Y_UP);
  vec3.sub(vec3.set(TEMP_VEC3, position), target);
  vec3.multQuat(TEMP_VEC3, TEMP_QUAT);
  return sphericalFromVec3(out, TEMP_VEC3);
}

/** Set a cartesian vector from spherical coordinates. */
function vec3FromSpherical(out: Vec3, s: Spherical): Vec3 {
  const radius = s[0];
  const elevation = s[1];
  const azimuth = s[2];
  const horizontal = radius * Math.cos(elevation);
  out[0] = horizontal * Math.sin(azimuth);
  out[1] = radius * Math.sin(elevation);
  out[2] = horizontal * Math.cos(azimuth);
  return out;
}

/**
 * Set a position from spherical coordinates around `target` for a given up
 * vector.
 *
 * @param out Updated in place.
 * @param s Spherical coordinates.
 * @param target Center of the sphere.
 * @param [up=[0, 1, 0]] Normalized up vector.
 */
function vec3FromSphericalTarget(
  out: Vec3,
  s: Spherical,
  target: Vec3,
  up: Vec3 = utils.Y_UP,
): Vec3 {
  vec3FromSpherical(out, s);
  vec3.multQuat(
    out,
    quat.conjugate(quatFromUnitVectors(TEMP_QUAT, up, utils.Y_UP)),
  );
  return vec3.add(out, target);
}

/**
 * Scale `target` around `anchor` in place: the anchor keeps its screen position
 * when the view scales by `ratio`.
 */
function scaleAround(target: Vec3, anchor: Vec3, ratio: number): Vec3 {
  vec3.sub(target, anchor);
  return vec3.add(vec3.scale(target, ratio), anchor);
}

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
};
export type { Spherical };
