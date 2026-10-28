import { utils, vec3 } from "pex-math";

import { halfHeightAtDistance } from "./projection.js";
import { CameraType } from "./types.js";

import type { Vec3 } from "pex-math";
import type { Pose } from "../core/pose.js";
import type { Radian, Second } from "../core/types.js";
import type { Lens } from "./types.js";

/** Millimeters. */
type Millimeter = number;

/**
 * How the sensor gate maps to the viewport when their aspect ratios differ.
 *
 * - `vertical`: the sensor height spans the viewport height
 * - `horizontal`: the sensor width spans the viewport width
 * - `fill`: the viewport is inside the sensor, cropping it
 * - `overscan`: the whole sensor is visible
 *
 * @see https://docs.blender.org/manual/en/latest/render/cameras.html
 */
type SensorFit = "vertical" | "horizontal" | "fill" | "overscan";

/** Full frame 35mm. */
const FULL_FRAME: [Millimeter, Millimeter] = [36, 24];

/** Circle of confusion limit for full frame. */
const FULL_FRAME_COC: Millimeter = 0.03;

/** Vertical field of view when a lens doesn't set one. */
const DEFAULT_FOV: Radian = Math.PI / 4;

/** Field of view covering a sensor dimension. */
function fovFromFocalLength(
  focalLength: Millimeter,
  sensor: Millimeter,
): Radian {
  return 2 * Math.atan(sensor / (2 * focalLength));
}

/** Focal length for a field of view over a sensor dimension. */
function focalLengthFromFov(fov: Radian, sensor: Millimeter): Millimeter {
  return sensor / (2 * Math.tan(fov / 2));
}

// Both candidates are vertical extents, increasing with the visible height.
function fitSensor(
  vertical: number,
  fromHorizontal: number,
  fit: SensorFit,
): number {
  switch (fit) {
    case "vertical":
      return vertical;
    case "horizontal":
      return fromHorizontal;
    case "fill":
      return Math.min(vertical, fromHorizontal);
    case "overscan":
      return Math.max(vertical, fromHorizontal);
  }
}

/**
 * Sensor height spanning the viewport height for a viewport aspect ratio: the
 * sensor's own height, or the height its width covers.
 */
function fittedSensorHeight(
  [width, height]: [Millimeter, Millimeter],
  aspect: number,
  fit: SensorFit = "vertical",
): Millimeter {
  return fitSensor(height, width / aspect, fit);
}

/** Vertical field of view of a lens on a sensor for a viewport aspect ratio. */
function verticalFov(
  focalLength: Millimeter,
  sensorSize: [Millimeter, Millimeter],
  aspect: number,
  fit: SensorFit = "vertical",
): Radian {
  return fovFromFocalLength(
    focalLength,
    fittedSensorHeight(sensorSize, aspect, fit),
  );
}

/**
 * Half of the vertical extent of an orthographic camera for a viewport aspect
 * ratio. `scale` is the sensor width in scene units, or its height with the
 * vertical fit, as Blender's orthographic scale.
 *
 * @see https://docs.blender.org/manual/en/latest/render/cameras.html
 */
function orthographicSize(
  scale: number,
  sensorSize: [Millimeter, Millimeter],
  aspect: number,
  fit: SensorFit = "vertical",
): number {
  return fit === "vertical"
    ? scale / 2
    : (scale * fittedSensorHeight(sensorSize, aspect, fit)) /
        (2 * sensorSize[0]);
}

/**
 * Exposure value at ISO 100.
 *
 * @see Lagarde, S. & de Rousiers, C. (2014). Moving Frostbite to physically based rendering. SIGGRAPH course.
 */
function ev100(fStop: number, shutterSpeed: Second, iso: number): number {
  return Math.log2(((fStop * fStop) / shutterSpeed) * (100 / iso));
}

/**
 * Scale applied to scene luminance from an EV100, with the 1.2 saturation based
 * sensitivity factor.
 *
 * @see Lagarde, S. & de Rousiers, C. (2014). Moving Frostbite to physically based rendering. SIGGRAPH course.
 */
function exposureFromEV100(ev: number): number {
  return 1 / (1.2 * Math.pow(2, ev));
}

/**
 * Thin lens circle of confusion diameter on the sensor for a point at
 * `distance`, all distances in scene units of meters.
 *
 * @returns Millimeters.
 * @see https://pbr-book.org/4ed/Cameras_and_Film/Projective_Camera_Models
 */
function circleOfConfusion(
  distance: number,
  focusDistance: number,
  focalLength: Millimeter,
  fStop: number,
): Millimeter {
  const f = focalLength / 1000;
  if (focusDistance <= f || distance <= 0) return Infinity;
  const diameter =
    (Math.abs(distance - focusDistance) / distance) *
    ((f * f) / (fStop * (focusDistance - f)));
  return diameter * 1000;
}

/**
 * Focus distance beyond which everything to infinity is acceptably sharp.
 *
 * @returns Meters.
 */
function hyperfocalDistance(
  focalLength: Millimeter,
  fStop: number,
  coc: Millimeter = FULL_FRAME_COC,
): number {
  return ((focalLength * focalLength) / (fStop * coc) + focalLength) / 1000;
}

/**
 * Distance keeping a subject the same size on screen when the field of view
 * changes: the dolly zoom (Vertigo effect).
 */
function dollyZoomDistance(
  distance: number,
  fov: Radian,
  nextFov: Radian,
): number {
  return (distance * Math.tan(fov / 2)) / Math.tan(nextFov / 2);
}

const isOrthographic = (
  lens?: Lens,
): lens is Lens & { type: typeof CameraType.Orthographic } =>
  lens?.type === CameraType.Orthographic;

/** Half of the visible height at a distance, including zoom. */
function halfHeight(
  lens: Lens | undefined,
  distance: number,
  zoom: number,
): number {
  return (
    (isOrthographic(lens)
      ? (lens.size ?? 1)
      : halfHeightAtDistance(lens?.fov ?? DEFAULT_FOV, distance)) / zoom
  );
}

/**
 * Closest visible distance, scaling a screen angle into a length: the near
 * plane in perspective, the half height in orthographic, 1 without a lens.
 */
function nearDistance(lens: Lens | undefined): number {
  return (isOrthographic(lens) ? lens.size : lens?.near) ?? 1;
}

/**
 * Distance scaling a screen angle into a length: from a pose to the target it
 * tracks, the near distance without one.
 */
function viewDistance(lens: Lens | undefined, tracking?: Pose): number {
  return tracking
    ? Math.max(vec3.distance(tracking.position, tracking.target), utils.EPSILON)
    : nearDistance(lens);
}

/**
 * Vertical angle the view spans seen from `distance`, after zoom: the zoomed
 * field of view in perspective, the angle the orthographic height covers
 * otherwise.
 */
function effectiveFov(
  lens: Lens | undefined,
  distance: number,
  zoom: number,
): Radian {
  return 2 * Math.atan(halfHeight(lens, distance, zoom) / distance);
}

/**
 * Tangent of the vertical half field of view through a pose, after its zoom:
 * the pose's field of view, or the lens's.
 */
function tanHalfFov(lens: Lens | undefined, pose: Pose): number {
  return (
    Math.tan((pose.fov ?? lens?.fov ?? DEFAULT_FOV) / 2) / (pose.zoom ?? 1)
  );
}

/**
 * Visible half height fitting the width and height of a view space box:
 * containing it, or covering the view with it.
 */
function boxFitHalfHeight(
  lens: Lens | undefined,
  [width, height]: Vec3,
  cover = false,
): number {
  return (cover ? Math.min : Math.max)(
    height / 2,
    width / 2 / (lens?.aspect ?? 1),
  );
}

/** Perspective distance at which a sphere fits the view, at a zoom. */
function sphereFitDistance(
  lens: Lens | undefined,
  radius: number,
  zoom: number,
): number {
  const tanHalf = halfHeight(lens, 1, zoom);
  const halfFov = Math.min(
    Math.atan(tanHalf),
    Math.atan(tanHalf * (lens?.aspect ?? 1)),
  );
  return radius / Math.sin(halfFov);
}

/** Orthographic zoom at which a sphere fits the view. */
function sphereFitZoom(lens: Lens, radius: number): number {
  const size = lens.size ?? 1;
  return Math.min(size, size * lens.aspect) / radius;
}

export {
  FULL_FRAME,
  FULL_FRAME_COC,
  DEFAULT_FOV,
  isOrthographic,
  halfHeight,
  nearDistance,
  viewDistance,
  effectiveFov,
  tanHalfFov,
  boxFitHalfHeight,
  sphereFitDistance,
  sphereFitZoom,
  fovFromFocalLength,
  focalLengthFromFov,
  fittedSensorHeight,
  verticalFov,
  orthographicSize,
  ev100,
  exposureFromEV100,
  circleOfConfusion,
  hyperfocalDistance,
  dollyZoomDistance,
};
export type { Millimeter, SensorFit };
