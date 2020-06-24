function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

import { mat4, vec3 } from "gl-matrix";
import { CameraType } from "./types.d.js";
export default class Camera {
  constructor(options) {
    _defineProperty(this, "type", CameraType.Camera);

    _defineProperty(this, "near", 0.1);

    _defineProperty(this, "far", 100);

    _defineProperty(this, "up", vec3.fromValues(0, 1, 0));

    _defineProperty(this, "position", vec3.fromValues(0, 0, 1));

    _defineProperty(this, "target", vec3.create());

    _defineProperty(this, "projectionMatrix", mat4.create());

    _defineProperty(this, "viewMatrix", mat4.create());

    _defineProperty(this, "inverseViewMatrix", mat4.create());

    _defineProperty(this, "view", void 0);

    Object.assign(this, options);
  }

  update() {
    mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
    mat4.copy(this.inverseViewMatrix, this.viewMatrix);
    mat4.invert(this.inverseViewMatrix, this.inverseViewMatrix);
  }

}