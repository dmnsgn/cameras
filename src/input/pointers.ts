import { vec2 } from "pex-math";

import type { Vec2 } from "pex-math";
import type { Radian } from "../core/types.js";

/** Set `out` to the mean of points. */
function centroid(out: Vec2, points: readonly Vec2[]): Vec2 {
  out[0] = out[1] = 0;
  for (const [x, y] of points) {
    out[0] += x;
    out[1] += y;
  }
  if (points.length) {
    out[0] /= points.length;
    out[1] /= points.length;
  }
  return out;
}

/**
 * Mean distance of points to their centroid. With two points it is half the
 * distance between them.
 */
function spread(points: readonly Vec2[], center: Vec2): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (const point of points) sum += vec2.distance(point, center);
  return sum / points.length;
}

/** Screen angle from `a` to `b`, counter-clockwise on screen (y down). */
function angle(a: Vec2, b: Vec2): Radian {
  return Math.atan2(a[1] - b[1], b[0] - a[0]);
}

export { centroid, spread, angle };
