import { mat4 } from "gl-matrix";

import Camera from "./Camera.js";

import { PerspectiveCameraOptions, Radian, CameraType } from "./types.d.js";

export default class PerspectiveCamera extends Camera {
  public readonly type: CameraType = CameraType.Perspective;

  public fov: Radian = Math.PI / 4;
  public aspect?: number = 1;

  constructor(options?: PerspectiveCameraOptions) {
    super(options);

    Object.assign(this, options);

    this.updateProjectionMatrix();
  }

  public updateProjectionMatrix(): void {
    if (this.view) {
      const aspectRatio = this.view.totalSize[0] / this.view.totalSize[1];

      const top = Math.tan(this.fov * 0.5) * this.near;
      const bottom = -top;
      const left = aspectRatio * bottom;
      const right = aspectRatio * top;
      const width = Math.abs(right - left);
      const height = Math.abs(top - bottom);
      const widthNormalized = width / this.view.totalSize[0];
      const heightNormalized = height / this.view.totalSize[1];

      const l = left + this.view.offset[0] * widthNormalized;
      const r =
        left + (this.view.offset[0] + this.view.size[0]) * widthNormalized;
      const b =
        top - (this.view.offset[1] + this.view.size[1]) * heightNormalized;
      const t = top - this.view.offset[1] * heightNormalized;

      mat4.frustum(this.projectionMatrix, l, r, b, t, this.near, this.far);
    } else {
      mat4.perspective(
        this.projectionMatrix,
        this.fov,
        this.aspect,
        this.near,
        this.far
      );
    }
  }
}
