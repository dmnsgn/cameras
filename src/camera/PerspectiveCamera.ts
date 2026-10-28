import Camera from "./Camera.js";
import { DEFAULT_FOV, verticalFov } from "./lens.js";
import {
  frustum,
  halfHeightAtDistance,
  perspectiveBounds,
} from "./projection.js";
import { CameraType } from "./types.js";

import type { Radian } from "../core/types.js";
import type { Millimeter } from "./lens.js";
import type { FrustumBounds, PerspectiveCameraOptions } from "./types.js";

export default class PerspectiveCamera extends Camera<PerspectiveCameraOptions> {
  public override readonly type: CameraType = CameraType.Perspective;

  /** Vertical field of view. Derived from the lens when `focalLength` is set. */
  public fov: Radian = DEFAULT_FOV;

  /** Lens focal length. Leave undefined to drive `fov` directly. */
  public focalLength?: Millimeter;

  constructor(options: PerspectiveCameraOptions = {}) {
    super();
    this.set(options);
  }

  public override updateProjectionMatrix(): void {
    if (this.focalLength !== undefined) {
      this.fov = verticalFov(
        this.focalLength,
        this.sensorSize,
        this.aspect,
        this.sensorFit,
      );
    }
    super.updateProjectionMatrix();
  }

  public getHalfHeightAtDistance(distance: number): number {
    return halfHeightAtDistance(this.fov, distance) / this.zoom;
  }

  protected getFrustumBounds(out: FrustumBounds): FrustumBounds {
    return perspectiveBounds(out, this.fov, this.aspect, this.near, this.zoom);
  }

  protected project(bounds: FrustumBounds): void {
    frustum(this.projectionMatrix, bounds, this.near, this.far, this);
  }
}
