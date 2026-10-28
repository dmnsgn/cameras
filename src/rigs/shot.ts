import eerp from "eerp";
import { utils, vec3 } from "pex-math";

import {
  normalizeAngle,
  quatLookAt,
  safeDivide,
  sphericalCreate,
  sphericalFromPositionTarget,
  vec3FromSphericalTarget,
} from "../core/math.js";
import { DEFAULT_FOV } from "../camera/lens.js";
import {
  distanceForHalfHeight,
  halfHeightAtDistance,
} from "../camera/projection.js";

import type { Vec3 } from "pex-math";
import type { Pose } from "../core/pose.js";
import type { Radian } from "../core/types.js";

/**
 * A camera setup to cut or move to. In moves, lens values unset on one shot hold
 * the other's.
 */
interface Shot {
  position: Vec3;
  target: Vec3;
  up?: Vec3;
  fov?: Radian;
  zoom?: number;
  focusDistance?: number;
}

/**
 * Camera move between two shots. A cut is a move taking no time.
 *
 * - `linear`: straight lines for position and target
 * - `arc`: orbit around the moving target, interpolating distance and angles
 * - `zoom-pan`: pull back while travelling between distant shots, then push in
 * - `dolly-zoom`: like `arc`, but the distance follows the field of view so the
 *   framing at the target stays the same size (Vertigo effect when the fov
 *   changes)
 */
type CameraMove = "linear" | "arc" | "zoom-pan" | "dolly-zoom";

type Easing = (t: number) => number;

interface MoveOptions {
  move?: CameraMove;
  easing?: Easing;
  /**
   * Zoom-pan curvature: higher zooms out more. √2 is van Wijk and Nuij's
   * measured optimum.
   */
  rho?: number;
}

const DEFAULT_RHO = Math.SQRT2;

const TEMP_UP = vec3.create();
const TEMP_FROM = sphericalCreate();
const TEMP_TO = sphericalCreate();
const TEMP_SPHERICAL = sphericalCreate();

const optionalLerp = (
  a: number | undefined,
  b: number | undefined,
  t: number,
  lerp: (a: number, b: number, t: number) => number = utils.lerp,
) =>
  a === undefined && b === undefined ? undefined : lerp(a ?? b!, b ?? a!, t);

interface ZoomPan {
  /**
   * Path length in van Wijk and Nuij's units: proportional to the perceived
   * duration.
   */
  length: number;
  /** Travelled distance and visible half height at s in [0, length]. */
  at(s: number): [travel: number, halfHeight: number];
}

/**
 * Optimal pan and zoom path between two views of half heights `w0`, `w1` whose
 * centers are `distance` apart.
 *
 * @see van Wijk, J. J. & Nuij, W. A. A. (2003). Smooth and efficient zooming and panning. https://doi.org/10.1109/INFVIS.2003.1249004
 */
function zoomPan(
  w0: number,
  w1: number,
  distance: number,
  rho = DEFAULT_RHO,
): ZoomPan {
  if (distance < 1e-6 * Math.max(w0, w1)) {
    // Pure zoom: exponential in the half height.
    const k = w1 < w0 ? -1 : 1;
    const length = Math.abs(Math.log(w1 / w0)) / rho;
    return {
      length,
      at: (s) => [
        length > 0 ? (distance * s) / length : distance,
        w0 * Math.exp(k * rho * s),
      ],
    };
  }

  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;
  const b = (w: number, sign: number) =>
    (w1 * w1 - w0 * w0 + sign * rho4 * distance * distance) /
    (2 * w * rho2 * distance);
  // ln(-b + √(b² + 1)) without its cancellation for large b.
  const r = (b: number) => -Math.asinh(b);
  const r0 = r(b(w0, 1));
  const r1 = r(b(w1, -1));

  return {
    length: (r1 - r0) / rho,
    at: (s) => [
      (w0 / rho2) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0)),
      (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0),
    ],
  };
}

/**
 * Half height of a shot's view at its target.
 *
 * @param shot Shot to measure.
 * @param [fallback] Lens values used when the shot leaves them unset.
 */
function shotHalfHeight(
  shot: Shot,
  fallback: Pick<Shot, "fov" | "zoom"> = {},
): number {
  return (
    halfHeightAtDistance(
      shot.fov ?? fallback.fov ?? DEFAULT_FOV,
      vec3.distance(shot.position, shot.target),
    ) / (shot.zoom ?? fallback.zoom ?? 1)
  );
}

/**
 * Perceived length of a zoom-pan between shots, to pick durations: travel at
 * constant perceived speed with `duration = length / speed`.
 */
function moveLength(from: Shot, to: Shot, rho = DEFAULT_RHO) {
  return zoomPan(
    shotHalfHeight(from, to),
    shotHalfHeight(to, from),
    vec3.distance(from.target, to.target),
    rho,
  ).length;
}

/**
 * Pose between two shots at `t` in [0, 1]. Pure: the same inputs always give
 * the same pose.
 */
function interpolateShots(
  out: Pose,
  from: Shot,
  to: Shot,
  t: number,
  { move = "arc", easing = (x) => x, rho = DEFAULT_RHO }: MoveOptions = {},
): Pose {
  t = utils.clamp(t, 0, 1);

  const e = easing(t);
  vec3.lerp(vec3.set(TEMP_UP, from.up ?? utils.Y_UP), to.up ?? utils.Y_UP, e);
  if (vec3.lengthSq(TEMP_UP) < 1e-12) vec3.set(TEMP_UP, to.up ?? utils.Y_UP);
  vec3.normalize(TEMP_UP);

  out.fov = optionalLerp(from.fov, to.fov, e);
  out.zoom = optionalLerp(from.zoom, to.zoom, e, eerp);
  out.focusDistance = optionalLerp(
    from.focusDistance,
    to.focusDistance,
    e,
    eerp,
  );

  if (move === "linear") {
    vec3.lerp(vec3.set(out.position, from.position), to.position, e);
    vec3.lerp(vec3.set(out.target, from.target), to.target, e);
  } else {
    sphericalFromPositionTarget(TEMP_FROM, from.position, from.target, TEMP_UP);
    sphericalFromPositionTarget(TEMP_TO, to.position, to.target, TEMP_UP);
    TEMP_SPHERICAL[1] = utils.lerp(TEMP_FROM[1], TEMP_TO[1], e);
    TEMP_SPHERICAL[2] =
      TEMP_FROM[2] + normalizeAngle(TEMP_TO[2] - TEMP_FROM[2]) * e;

    if (move === "arc") {
      vec3.lerp(vec3.set(out.target, from.target), to.target, e);
      TEMP_SPHERICAL[0] = eerp(TEMP_FROM[0], TEMP_TO[0], e);
    } else {
      const fromHalfHeight = shotHalfHeight(from, to);
      const toHalfHeight = shotHalfHeight(to, from);
      let halfHeight: number;
      if (move === "dolly-zoom") {
        vec3.lerp(vec3.set(out.target, from.target), to.target, e);
        halfHeight = utils.lerp(fromHalfHeight, toHalfHeight, e);
      } else {
        const travel = vec3.distance(from.target, to.target);
        const curve = zoomPan(fromHalfHeight, toHalfHeight, travel, rho);
        let u: number;
        [u, halfHeight] = curve.at(e * curve.length);
        vec3.lerp(
          vec3.set(out.target, from.target),
          to.target,
          safeDivide(u, travel, e),
        );
      }
      TEMP_SPHERICAL[0] = distanceForHalfHeight(
        out.fov ?? DEFAULT_FOV,
        halfHeight * (out.zoom ?? 1),
      );
    }
    vec3FromSphericalTarget(out.position, TEMP_SPHERICAL, out.target, TEMP_UP);
  }

  vec3.set(out.up, TEMP_UP);
  quatLookAt(out.orientation, out.position, out.target, out.up);
  return out;
}

/** Write a shot into a pose. */
function writeShot(out: Pose, shot: Shot): Pose {
  vec3.set(out.position, shot.position);
  vec3.set(out.target, shot.target);
  vec3.set(out.up, shot.up ?? utils.Y_UP);
  out.fov = shot.fov;
  out.zoom = shot.zoom;
  out.focusDistance = shot.focusDistance;
  quatLookAt(out.orientation, out.position, out.target, out.up);
  return out;
}

export { zoomPan, shotHalfHeight, moveLength, interpolateShots, writeShot };
export type { Shot, CameraMove, Easing, MoveOptions };
