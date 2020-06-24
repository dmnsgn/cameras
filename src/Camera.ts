import { mat4, vec3 } from "gl-matrix";

import { CameraType, CameraOptions, CameraView } from "./types.d.js";

export default class Camera {
  public readonly type: CameraType = CameraType.Camera;

  public near = 0.1;
  public far = 100;

  public up: vec3 = vec3.fromValues(0, 1, 0);
  public position: vec3 = vec3.fromValues(0, 0, 1);
  public target: vec3 = vec3.create();

  public projectionMatrix: mat4 = mat4.create();

  public viewMatrix: mat4 = mat4.create();
  public inverseViewMatrix: mat4 = mat4.create();

  public view?: CameraView;

  constructor(options?: CameraOptions) {
    Object.assign(this, options);
  }

  public update(): void {
    mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
    mat4.copy(this.inverseViewMatrix, this.viewMatrix);
    mat4.invert(this.inverseViewMatrix, this.inverseViewMatrix);
  }
}
