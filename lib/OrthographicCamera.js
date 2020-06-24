function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

import { mat4 } from "gl-matrix";
import Camera from "./Camera.js";
import { CameraType } from "./types.d.js";
export default class OrthographicCamera extends Camera {
  constructor(options) {
    super(options);

    _defineProperty(this, "type", CameraType.Orthographic);

    _defineProperty(this, "left", -1);

    _defineProperty(this, "right", 1);

    _defineProperty(this, "top", 1);

    _defineProperty(this, "bottom", -1);

    _defineProperty(this, "zoom", 1);

    Object.assign(this, options);
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    const dx = (this.right - this.left) / (2 / this.zoom);
    const dy = (this.top - this.bottom) / (2 / this.zoom);
    const cx = (this.right + this.left) / 2;
    const cy = (this.top + this.bottom) / 2;
    let left = cx - dx;
    let right = cx + dx;
    let top = cy + dy;
    let bottom = cy - dy;

    if (this.view) {
      const zoomW = 1 / this.zoom / (this.view.size[0] / this.view.totalSize[0]);
      const zoomH = 1 / this.zoom / (this.view.size[1] / this.view.totalSize[1]);
      const scaleW = (this.right - this.left) / this.view.size[0];
      const scaleH = (this.top - this.bottom) / this.view.size[1];
      left += scaleW * (this.view.offset[0] / zoomW);
      right = left + scaleW * (this.view.size[0] / zoomW);
      top -= scaleH * (this.view.offset[1] / zoomH);
      bottom = top - scaleH * (this.view.size[1] / zoomH);
    }

    mat4.ortho(this.projectionMatrix, left, right, bottom, top, this.near, this.far);
  }

}