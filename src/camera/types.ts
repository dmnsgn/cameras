import type { Quat, Vec2, Vec3 } from "pex-math";
import type { Pixel, Radian, Second } from "../core/types.js";
import type { Millimeter, SensorFit } from "./lens.js";

const CameraType = {
  Camera: "Camera",
  Perspective: "Perspective",
  Orthographic: "Orthographic",
} as const;
type CameraType = (typeof CameraType)[keyof typeof CameraType];

/**
 * Clip space depth convention: WebGPU, Vulkan, Metal and D3D use "zero-to-one",
 * WebGL and OpenGL use "negative-one-to-one".
 */
type DepthRange = "zero-to-one" | "negative-one-to-one";

/** Left, right, bottom, top. */
type FrustumBounds = [number, number, number, number];

/**
 * How the camera projects the scene, without zoom: projection type, field of
 * view and clipping planes, as in Blender's Lens panel and Cinemachine's
 * `LensSettings`. Camera classes satisfy it.
 *
 * @see https://docs.blender.org/manual/en/latest/render/cameras.html
 * @see https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/lens.html
 */
interface Lens {
  readonly type: CameraType;
  aspect: number;
  /** Vertical field of view, perspective only. */
  fov?: Radian;
  /** Half of the vertical extent, orthographic only. */
  size?: number;
  near?: number;
  far?: number;
}

/** Sub-rectangle of a larger view, for tiled or multi-screen rendering. */
interface CameraView {
  totalSize: [Pixel, Pixel];
  size: [Pixel, Pixel];
  offset: [Pixel, Pixel];
}

interface CameraOptions {
  near?: number;
  far?: number;
  aspect?: number;
  zoom?: number;
  depthRange?: DepthRange;
  reversedZ?: boolean;

  position?: Vec3;
  target?: Vec3;
  up?: Vec3;
  orientation?: Quat;

  view?: CameraView;
  jitter?: Vec2;

  sensorSize?: [Millimeter, Millimeter];
  sensorFit?: SensorFit;
  fStop?: number;
  focusDistance?: number;
  shutterSpeed?: Second;
  iso?: number;
  exposureCompensation?: number;
}

interface PerspectiveCameraOptions extends CameraOptions {
  fov?: Radian;
  focalLength?: Millimeter;
}

interface OrthographicCameraOptions extends CameraOptions {
  size?: number;
  orthoScale?: number;
  bounds?: FrustumBounds;
}

export { CameraType };
export type {
  Lens,
  DepthRange,
  FrustumBounds,
  CameraView,
  CameraOptions,
  PerspectiveCameraOptions,
  OrthographicCameraOptions,
};
