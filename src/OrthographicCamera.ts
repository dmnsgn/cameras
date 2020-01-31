import { mat4 } from "gl-matrix";

import Camera from "./Camera.js";
import { OrthographicCameraOptions } from "./types.d.js";

export default class OrthographicCamera extends Camera {
  public left: number = -1;
  public right: number = 1;
  public top: number = 1;
  public bottom: number = -1;

  public zoom: number = 1;

  constructor(options?: OrthographicCameraOptions) {
    super(options);

    Object.assign(this, options);

    this.updateProjectionMatrix();
  }

  public updateProjectionMatrix(): void {
    const dx = (this.right - this.left) / (2 / this.zoom);
    const dy = (this.top - this.bottom) / (2 / this.zoom);
    const cx = (this.right + this.left) / 2;
    const cy = (this.top + this.bottom) / 2;

    let left = cx - dx;
    let right = cx + dx;
    let top = cy + dy;
    let bottom = cy - dy;

    if (this.view) {
      const zoomW =
        1 / this.zoom / (this.view.size[0] / this.view.totalSize[0]);
      const zoomH =
        1 / this.zoom / (this.view.size[1] / this.view.totalSize[1]);
      const scaleW = (this.right - this.left) / this.view.size[0];
      const scaleH = (this.top - this.bottom) / this.view.size[1];

      left += scaleW * (this.view.offset[0] / zoomW);
      right = left + scaleW * (this.view.size[0] / zoomW);
      top -= scaleH * (this.view.offset[1] / zoomH);
      bottom = top - scaleH * (this.view.size[1] / zoomH);
    }

    mat4.ortho(
      this.projectionMatrix,
      left,
      right,
      bottom,
      top,
      this.near,
      this.far
    );
  }
}
