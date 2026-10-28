import { mat4, vec3 } from "pex-math";

import { quatLookAt } from "../core/math.js";
import { assignOptions } from "../core/options.js";
import { ev100, exposureFromEV100, FULL_FRAME } from "./lens.js";
import { CameraType } from "./types.js";
import { applyJitter, applyViewOffset } from "./projection.js";

import type { Mat4, Quat, Vec2, Vec3 } from "pex-math";
import type { Pixel, Second } from "../core/types.js";
import type { Millimeter, SensorFit } from "./lens.js";
import type { DepthOptions } from "./projection.js";
import type {
  CameraOptions,
  CameraView,
  DepthRange,
  FrustumBounds,
} from "./types.js";

const UNIT_SCALE: Vec3 = [1, 1, 1];
const TEMP_BOUNDS: FrustumBounds = [0, 0, 0, 0];

export default abstract class Camera<
  Options extends CameraOptions = CameraOptions,
> implements DepthOptions {
  public readonly type: CameraType = CameraType.Camera;

  public near = 0.1;
  public far = 100;
  public aspect = 1;
  /** Magnification: values above 1 zoom in. */
  public zoom = 1;
  public depthRange: DepthRange = "zero-to-one";
  public reversedZ = false;

  public position: Vec3 = [0, 0, 1];
  public target: Vec3 = [0, 0, 0];
  public up: Vec3 = [0, 1, 0];
  public orientation: Quat = [0, 0, 0, 1];

  public view?: CameraView;
  public jitter?: Vec2;

  public sensorSize: [Millimeter, Millimeter] = [...FULL_FRAME];
  public sensorFit: SensorFit = "vertical";

  /** Aperture as f-number. Sunny 16 by default. */
  public fStop = 16;
  /** Distance to the plane in focus. */
  public focusDistance = 10;
  public shutterSpeed: Second = 1 / 125;
  public iso = 100;
  /** Stops added to the metered exposure, positive brightens. */
  public exposureCompensation = 0;

  public projectionMatrix: Mat4 = mat4.create();
  public viewMatrix: Mat4 = mat4.create();
  public inverseViewMatrix: Mat4 = mat4.create();

  /**
   * Update properties without aliasing the given arrays, then update the
   * matrices.
   *
   * Orientation is derived from position, target and up unless provided.
   */
  public set(options: Options = {} as Options): this {
    assignOptions(this, options);

    if (
      !options.orientation &&
      (options.position || options.target || options.up)
    ) {
      this.lookAt();
    }

    this.updateProjectionMatrix();
    this.update();

    return this;
  }

  /** Exposure value at ISO 100 from aperture, shutter speed and ISO. */
  public get ev100(): number {
    return ev100(this.fStop, this.shutterSpeed, this.iso);
  }

  /** Scale for scene luminance, including the compensation. */
  public get exposure(): number {
    return exposureFromEV100(this.ev100 - this.exposureCompensation);
  }

  /**
   * Orient the camera towards a target.
   *
   * @param [target=this.target]
   * @param [up=this.up]
   */
  public lookAt(target: Vec3 = this.target, up: Vec3 = this.up): this {
    if (target !== this.target) vec3.set(this.target, target);
    if (up !== this.up) vec3.set(this.up, up);
    quatLookAt(this.orientation, this.position, this.target, this.up);
    return this;
  }

  /** Update the view matrices from position and orientation. */
  public update(): void {
    mat4.fromTranslationRotationScale(
      this.inverseViewMatrix,
      this.position,
      this.orientation,
      UNIT_SCALE,
    );
    mat4.invert(mat4.set(this.viewMatrix, this.inverseViewMatrix));
  }

  /** Update the projection matrix from frustum, depth, view offset and jitter. */
  public updateProjectionMatrix(): void {
    const bounds = this.getFrustumBounds(TEMP_BOUNDS);
    if (this.view) applyViewOffset(bounds, this.view);
    this.project(bounds);
    if (this.jitter) applyJitter(this.projectionMatrix, this.jitter);
  }

  /**
   * World units covered by one pixel at a distance from the camera.
   *
   * @param viewportHeight Viewport height in pixels.
   * @param [distance=distance to target]
   */
  public unitsPerPixel(
    viewportHeight: Pixel,
    distance = vec3.distance(this.position, this.target),
  ): number {
    return (2 * this.getHalfHeightAtDistance(distance)) / viewportHeight;
  }

  /** Half height of the visible area at a distance from the camera. */
  public abstract getHalfHeightAtDistance(distance: number): number;

  protected abstract getFrustumBounds(out: FrustumBounds): FrustumBounds;

  protected abstract project(bounds: FrustumBounds): void;
}
