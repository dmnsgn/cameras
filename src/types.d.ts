import { mat4, vec3 } from "gl-matrix";

export enum CameraType {
  Camera,
  Perspective,
  Orthographic
}

export interface CameraOptions {
  near?: number;
  far?: number;
  up?: [number, number, number];

  projectionMatrix?: mat4;

  viewMatrix?: mat4;
  inverseViewMatrix?: mat4;

  position?: vec3;
  target?: vec3;

  view?: CameraView;
}

export interface PerspectiveCameraOptions extends CameraOptions {
  fov: number;
  aspect: number;
}

export interface OrthographicCameraOptions extends CameraOptions {
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom: 1;
}

export interface CameraView {
  totalSize: [number, number];
  size: [number, number];
  offset: [number, number];
}
