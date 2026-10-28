import Camera from "./Camera.js";
import { orthographicSize } from "./lens.js";
import { orthographic, orthographicBounds, zoomBounds } from "./projection.js";
import { CameraType } from "./types.js";

import type { FrustumBounds, OrthographicCameraOptions } from "./types.js";

const TEMP_BOUNDS: FrustumBounds = [0, 0, 0, 0];

export default class OrthographicCamera extends Camera<OrthographicCameraOptions> {
  public override readonly type: CameraType = CameraType.Orthographic;

  /**
   * Half of the vertical extent at zoom 1. Use `halfHeightAtDistance` to match
   * a perspective framing. Derived from the sensor when `orthoScale` is set.
   */
  public size = 1;

  /**
   * Sensor width in scene units, or its height with the vertical fit, as
   * Blender's orthographic scale. Leave undefined to drive `size` directly.
   */
  public orthoScale?: number;

  /**
   * Explicit frustum at zoom 1, as is: off-center or flipped, e.g. `[0, width,
   * height, 0]` for pixel coordinates with y down. Overrides `size`,
   * `orthoScale` and `aspect`. Flipping an axis reverses triangle winding.
   */
  public bounds?: FrustumBounds;

  constructor(options: OrthographicCameraOptions = {}) {
    super();
    this.set(options);
  }

  public override updateProjectionMatrix(): void {
    if (this.orthoScale !== undefined) {
      this.size = orthographicSize(
        this.orthoScale,
        this.sensorSize,
        this.aspect,
        this.sensorFit,
      );
    }
    super.updateProjectionMatrix();
  }

  /** Frustum left at zoom 1. */
  public get left(): number {
    return this.#unzoomedBounds()[0];
  }
  /** Frustum right at zoom 1. */
  public get right(): number {
    return this.#unzoomedBounds()[1];
  }
  /** Frustum bottom at zoom 1. */
  public get bottom(): number {
    return this.#unzoomedBounds()[2];
  }
  /** Frustum top at zoom 1. */
  public get top(): number {
    return this.#unzoomedBounds()[3];
  }

  public getHalfHeightAtDistance(): number {
    const bounds = this.#unzoomedBounds();
    return Math.abs(bounds[3] - bounds[2]) / 2 / this.zoom;
  }

  protected getFrustumBounds(out: FrustumBounds): FrustumBounds {
    return this.bounds
      ? zoomBounds(out, this.bounds, this.zoom)
      : orthographicBounds(out, this.size, this.aspect, this.zoom);
  }

  protected project(bounds: FrustumBounds): void {
    orthographic(this.projectionMatrix, bounds, this.near, this.far, this);
  }

  #unzoomedBounds(): FrustumBounds {
    return (
      this.bounds ?? orthographicBounds(TEMP_BOUNDS, this.size, this.aspect)
    );
  }
}
