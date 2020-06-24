import { vec3, quat, glMatrix } from "gl-matrix";
import clamp from "clamp";

import PointerManager from "./PointerManager.js";
import PerspectiveCamera from "./PerspectiveCamera.js";
import OrthographicCamera from "./OrthographicCamera.js";

import {
  ControlsOptions,
  ControlsActions,
  Radian,
  ControlsConfig,
  PointerManagerState,
  PointerManagerEvent,
} from "./types.d.js";

const { EPSILON } = glMatrix;
const PI2 = Math.PI * 2;

const TEMP = vec3.create();

export default class Controls {
  private static isNegligeable(number: number): boolean {
    return Math.abs(number) < EPSILON;
  }

  private static Y_UP = vec3.fromValues(0, 1, 0);

  public element: HTMLElement;
  public camera: PerspectiveCamera | OrthographicCamera;
  public config: ControlsConfig = {
    [PointerManagerState.MouseLeft]: ControlsActions.Rotate,
    [PointerManagerState.MouseMiddle]: ControlsActions.Dolly,
    [PointerManagerState.MouseRight]: ControlsActions.RotatePolar,
    [PointerManagerState.MouseWheel]: ControlsActions.Dolly,
    [PointerManagerState.TouchOne]: ControlsActions.Rotate,
    [PointerManagerState.TouchTwo]: ControlsActions.Dolly,
    [PointerManagerState.TouchThree]: ControlsActions.RotatePolar,
  };

  public position: vec3 = vec3.fromValues(0, 0, 1);
  public target: vec3 = vec3.create();
  public phi: Radian = Math.PI / 2;
  public theta: Radian = 0;
  public distance: number;

  public damping = 0.9;

  public dolly = true;
  public dollySpeed = 1;
  public dollyMaxDelta = Infinity;

  public rotate = true;
  public rotateSpeed = 1;
  public rotateMaxThetaDelta = Infinity;
  public rotateMaxPhiDelta = Infinity;

  public distanceBounds: number[] = [EPSILON, Infinity];
  public phiBounds: Radian[] = [0, Math.PI];
  public thetaBounds: Radian[] = [-Infinity, Infinity];

  private pointerManager: PointerManager;
  private sphericalTarget: vec3 = vec3.create();
  private targetTarget: vec3 = vec3.create();
  private upQuat: quat = quat.create();
  private upQuatInverse: quat = quat.create();

  constructor(options?: ControlsOptions) {
    Object.assign(this, options);

    // Set by spherical angle and optional distance
    if (options.theta || options.phi) {
      this.updatePosition();
    }
    // Set by position and optional target
    else {
      if (!options.position) vec3.copy(this.position, options.camera.position);
      vec3.subtract(TEMP, this.position, this.target);
      this.distance = vec3.length(TEMP);
      this.theta = Math.atan2(this.position[0], this.position[2]);
      this.phi = Math.acos(clamp(this.position[1] / this.distance, -1, 1));
    }

    // Init private targets
    this.sphericalTarget[0] = this.theta;
    this.sphericalTarget[1] = this.phi;
    this.sphericalTarget[2] = this.distance;
    vec3.copy(this.targetTarget, this.target);

    this.update();

    this.onPointerUpdate = this.onPointerUpdate.bind(this);

    this.pointerManager = new PointerManager({
      element: this.element,
      config: { wheel: true, drag: true },
      onPointerUpdate: this.onPointerUpdate,
    });
    this.pointerManager.enable();
  }

  // Actions
  private handleDolly(event: PointerManagerEvent): void {
    let delta = event.dy;
    switch (event.state) {
      case PointerManagerState.MouseLeft:
      case PointerManagerState.MouseRight:
      case PointerManagerState.MouseMiddle: {
        delta *= 20;
        break;
      }

      case PointerManagerState.TouchTwo: {
        delta /= 20;
        break;
      }

      default:
        break;
    }

    this.sphericalTarget[2] += clamp(
      delta * this.dollySpeed,
      -this.dollyMaxDelta,
      this.dollyMaxDelta
    );
  }

  private handleRotateAzimuth(event: PointerManagerEvent): void {
    this.sphericalTarget[0] -= clamp(
      PI2 * event.dx * this.rotateSpeed,
      -this.rotateMaxThetaDelta,
      this.rotateMaxThetaDelta
    );
  }

  private handleRotatePolar(event: PointerManagerEvent): void {
    this.sphericalTarget[1] -= clamp(
      PI2 * event.dy * this.rotateSpeed,
      -this.rotateMaxPhiDelta,
      this.rotateMaxPhiDelta
    );
  }

  private handleRotate(event: PointerManagerEvent): void {
    this.handleRotateAzimuth(event);
    this.handleRotatePolar(event);
  }

  // Pointer Event handlers
  private onPointerUpdate(event: PointerManagerEvent): void {
    this[
      `handle${this.config[event.state]}` as
        | "handleDolly"
        | "handleRotateAzimuth"
        | "handleRotatePolar"
        | "handleRotate"
    ](event);
  }

  // Update
  private updatePosition(): void {
    this.distance = Math.max(EPSILON, this.distance);

    this.position[0] =
      this.distance * Math.sin(this.phi) * Math.sin(this.theta);
    this.position[1] = this.distance * Math.cos(this.phi);
    this.position[2] =
      this.distance * Math.sin(this.phi) * Math.cos(this.theta);
  }

  public update(): void {
    const dampRatio = 1 - this.damping;
    const deltaTheta = this.sphericalTarget[0] - this.theta;
    const deltaPhi = this.sphericalTarget[1] - this.phi;
    const deltaDistance = this.sphericalTarget[2] - this.distance;
    const deltaTarget = vec3.create();
    vec3.sub(deltaTarget, this.targetTarget, this.target);

    if (
      !Controls.isNegligeable(deltaTheta) ||
      !Controls.isNegligeable(deltaPhi) ||
      !Controls.isNegligeable(deltaDistance) ||
      !Controls.isNegligeable(deltaTarget[0]) ||
      !Controls.isNegligeable(deltaTarget[1]) ||
      !Controls.isNegligeable(deltaTarget[2])
    ) {
      this.theta = this.theta + deltaTheta * dampRatio;
      this.phi = this.phi + deltaPhi * dampRatio;
      this.distance = this.distance + deltaDistance * dampRatio;

      vec3.add(
        this.target,
        this.target,
        vec3.scale(deltaTarget, deltaTarget, dampRatio)
      );
    } else {
      this.theta = this.sphericalTarget[0];
      this.phi = this.sphericalTarget[1];
      this.distance = this.sphericalTarget[2];

      vec3.copy(this.targetTarget, this.target);
      vec3.copy(this.target, deltaTarget);
    }

    vec3.subtract(this.position, this.position, this.target);
    vec3.transformQuat(this.position, this.position, this.upQuat);

    this.phi = clamp(this.phi, EPSILON, Math.PI - EPSILON);
    this.distance = clamp(
      this.distance,
      this.distanceBounds[0],
      this.distanceBounds[1]
    );

    quat.rotationTo(this.upQuat, this.camera.up, Controls.Y_UP);
    quat.invert(this.upQuatInverse, this.upQuat);

    this.updatePosition();

    // TODO: copy directly into camera as an option
    vec3.transformQuat(this.position, this.position, this.upQuatInverse);
    vec3.add(this.position, this.target, this.position);
  }
}
