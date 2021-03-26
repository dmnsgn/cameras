import { mat4, vec3 } from "gl-matrix";
import PerspectiveCamera from "./PerspectiveCamera.js";
import OrthographicCamera from "./OrthographicCamera.js";

// General
export type Radian = number;
export type Degree = number;
export type Pixel = number;

// Camera
export enum CameraType {
  Camera,
  Perspective,
  Orthographic,
}

export interface CameraOptions {
  near?: number;
  far?: number;
  up?: vec3;

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

// Controls
export type ControlsConfig = {
  [key in PointerManagerState]?: ControlsActions;
};

export interface ControlsOptions {
  element: HTMLElement;
  camera: PerspectiveCamera | OrthographicCamera;
  config: ControlsConfig;

  position: vec3;
  target: vec3;
  distance: number;

  damping: number;

  dolly: boolean;
  dollySpeed: number;
  dollyMaxDelta: number;

  rotate: boolean;
  rotateSpeed: number;
  rotateMaxThetaDelta: number;
  rotateMaxPhiDelta: number;

  phiBounds: Radian[];
  thetaBounds: Radian[];
  distanceBounds: number[];

  phi: Radian;
  theta: Radian;
}

export enum ControlsActions {
  Rotate = "Rotate",
  RotatePolar = "RotatePolar",
  RotateAzimuth = "RotateAzimuth",
  Dolly = "Dolly",
  Zoom = "Zoom",
}

// PointerManager
export interface PointerManagerConfig {
  wheel: boolean;
  drag: boolean;
}

export enum PointerManagerState {
  Idle = "Idle",
  MouseWheel = "MouseWheel",
  MouseLeft = "MouseLeft",
  MouseMiddle = "MouseMiddle",
  MouseRight = "MouseRight",
  TouchOne = "TouchOne",
  TouchTwo = "TouchTwo",
  TouchThree = "TouchThree",
}

export interface PointerManagerEvent {
  state: PointerManagerState;
  originalEvent?: Event;
  dx?: Pixel;
  dy?: Pixel;
}

export interface PointerManagerOptions {
  element: HTMLElement;
  config: PointerManagerConfig;
  onPointerUpdate?: (event: PointerManagerEvent) => unknown;
}
