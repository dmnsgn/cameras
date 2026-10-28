import { mat4 } from "pex-math";

import type { Mat4, Vec2 } from "pex-math";
import type { Radian } from "../core/types.js";
import type { CameraView, DepthRange, FrustumBounds } from "./types.js";

interface DepthOptions {
  depthRange: DepthRange;
  reversedZ: boolean;
}

// Swap near and far in clip space: z' = w - z for zero-to-one, z' = -z otherwise.
function reverseDepth(out: Mat4, depthRange: DepthRange): Mat4 {
  const zeroToOne = depthRange === "zero-to-one";
  for (let column = 0; column < 4; column++) {
    const i = column * 4;
    out[i + 2] = (zeroToOne ? out[i + 3] : 0) - out[i + 2];
  }
  return out;
}

/**
 * Set an off-axis perspective projection. `far` can be `Infinity`.
 *
 * @param out Updated in place.
 * @param bounds Frustum bounds on the near plane.
 * @param near Near plane distance.
 * @param far Far plane distance.
 * @param options Depth convention.
 * @see https://developer.nvidia.com/content/depth-precision-visualized
 */
function frustum(
  out: Mat4,
  bounds: FrustumBounds,
  near: number,
  far: number,
  options: DepthOptions,
): Mat4 {
  const [left, right, bottom, top] = bounds;
  const { depthRange, reversedZ } = options;
  const zeroToOne = depthRange === "zero-to-one";
  const infinite = far === Infinity;

  (zeroToOne ? mat4.frustumZO : mat4.frustum)(
    out,
    left,
    right,
    bottom,
    top,
    near,
    infinite ? near * 2 : far,
  );

  // Limit of the depth terms as far tends to infinity.
  if (infinite) {
    out[10] = -1;
    out[14] = (zeroToOne ? -1 : -2) * near;
  }

  return reversedZ ? reverseDepth(out, depthRange) : out;
}

/** Set an orthographic projection. `far` must be finite. */
function orthographic(
  out: Mat4,
  [left, right, bottom, top]: FrustumBounds,
  near: number,
  far: number,
  { depthRange, reversedZ }: DepthOptions,
): Mat4 {
  (depthRange === "zero-to-one" ? mat4.orthoZO : mat4.ortho)(
    out,
    left,
    right,
    bottom,
    top,
    near,
    far,
  );

  return reversedZ ? reverseDepth(out, depthRange) : out;
}

function centeredBounds(
  out: FrustumBounds,
  halfHeight: number,
  aspect: number,
): FrustumBounds {
  const halfWidth = halfHeight * aspect;
  out[0] = -halfWidth;
  out[1] = halfWidth;
  out[2] = -halfHeight;
  out[3] = halfHeight;
  return out;
}

/**
 * Frustum bounds on the near plane of a perspective projection.
 *
 * @param out Updated in place.
 * @param fov Vertical field of view.
 * @param aspect Width over height.
 * @param near Near plane distance.
 * @param [zoom=1] Magnification: values above 1 zoom in.
 * @returns Bounds
 */
function perspectiveBounds(
  out: FrustumBounds,
  fov: Radian,
  aspect: number,
  near: number,
  zoom = 1,
): FrustumBounds {
  return centeredBounds(out, halfHeightAtDistance(fov, near) / zoom, aspect);
}

/**
 * Frustum bounds of an orthographic projection centered on the view axis.
 *
 * @param out Updated in place.
 * @param size Half of the vertical extent at zoom 1.
 * @param aspect Width over height.
 * @param [zoom=1] Magnification: values above 1 zoom in.
 * @returns Bounds
 */
function orthographicBounds(
  out: FrustumBounds,
  size: number,
  aspect: number,
  zoom = 1,
): FrustumBounds {
  return centeredBounds(out, size / zoom, aspect);
}

/**
 * Scale frustum bounds around their center.
 *
 * @param out Updated in place.
 * @param bounds Bounds at zoom 1.
 * @param zoom Magnification: values above 1 zoom in.
 * @returns Bounds
 */
function zoomBounds(
  out: FrustumBounds,
  bounds: FrustumBounds,
  zoom: number,
): FrustumBounds {
  const [left, right, bottom, top] = bounds;
  const x = (left + right) / 2;
  const y = (bottom + top) / 2;
  out[0] = x + (left - x) / zoom;
  out[1] = x + (right - x) / zoom;
  out[2] = y + (bottom - y) / zoom;
  out[3] = y + (top - y) / zoom;
  return out;
}

/**
 * Restrict frustum bounds to a sub-rectangle of the full view.
 *
 * @param bounds Updated in place.
 * @returns Bounds
 */
function applyViewOffset(
  bounds: FrustumBounds,
  { totalSize, size, offset }: CameraView,
): FrustumBounds {
  const width = bounds[1] - bounds[0];
  const height = bounds[3] - bounds[2];

  bounds[0] += (width * offset[0]) / totalSize[0];
  bounds[1] = bounds[0] + (width * size[0]) / totalSize[0];
  bounds[3] -= (height * offset[1]) / totalSize[1];
  bounds[2] = bounds[3] - (height * size[1]) / totalSize[1];

  return bounds;
}

/**
 * Translate a projection in clip space, e.g. sub-pixel jitter for temporal
 * anti-aliasing.
 *
 * @param out Updated in place.
 * @param offset Offset in NDC units (2 / viewport size per pixel).
 */
function applyJitter(out: Mat4, offset: Vec2): Mat4 {
  const [x, y] = offset;
  for (let column = 0; column < 4; column++) {
    const w = out[column * 4 + 3];
    out[column * 4] += x * w;
    out[column * 4 + 1] += y * w;
  }
  return out;
}

/**
 * Half height of a perspective frustum at a distance. Equal to the orthographic
 * `size` that preserves framing at that distance.
 *
 * @param fov Vertical field of view.
 */
function halfHeightAtDistance(fov: Radian, distance: number): number {
  return distance * Math.tan(fov / 2);
}

/**
 * Distance at which a perspective frustum has a given half height: the inverse
 * of `halfHeightAtDistance`.
 *
 * @param fov Vertical field of view.
 */
function distanceForHalfHeight(fov: Radian, halfHeight: number): number {
  return halfHeight / Math.tan(fov / 2);
}

export {
  frustum,
  orthographic,
  perspectiveBounds,
  orthographicBounds,
  zoomBounds,
  applyViewOffset,
  applyJitter,
  halfHeightAtDistance,
  distanceForHalfHeight,
};
export type { DepthOptions };
