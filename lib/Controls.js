function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

import { vec3, quat, glMatrix } from "gl-matrix";
import clamp from "clamp";
import PointerManager from "./PointerManager.js";
import { ControlsActions, PointerManagerState } from "./types.d.js";
const {
  EPSILON
} = glMatrix;
const PI2 = Math.PI * 2;
const TEMP = vec3.create();
export default class Controls {
  static isNegligeable(number) {
    return Math.abs(number) < EPSILON;
  }

  constructor(options) {
    _defineProperty(this, "element", void 0);

    _defineProperty(this, "camera", void 0);

    _defineProperty(this, "config", {
      [PointerManagerState.MouseLeft]: ControlsActions.Rotate,
      [PointerManagerState.MouseMiddle]: ControlsActions.Dolly,
      [PointerManagerState.MouseRight]: ControlsActions.RotatePolar,
      [PointerManagerState.MouseWheel]: ControlsActions.Dolly,
      [PointerManagerState.TouchOne]: ControlsActions.Rotate,
      [PointerManagerState.TouchTwo]: ControlsActions.Dolly,
      [PointerManagerState.TouchThree]: ControlsActions.RotatePolar
    });

    _defineProperty(this, "position", vec3.fromValues(0, 0, 1));

    _defineProperty(this, "target", vec3.create());

    _defineProperty(this, "phi", Math.PI / 2);

    _defineProperty(this, "theta", 0);

    _defineProperty(this, "distance", void 0);

    _defineProperty(this, "damping", 0.9);

    _defineProperty(this, "dolly", true);

    _defineProperty(this, "dollySpeed", 1);

    _defineProperty(this, "dollyMaxDelta", Infinity);

    _defineProperty(this, "rotate", true);

    _defineProperty(this, "rotateSpeed", 1);

    _defineProperty(this, "rotateMaxThetaDelta", Infinity);

    _defineProperty(this, "rotateMaxPhiDelta", Infinity);

    _defineProperty(this, "distanceBounds", [EPSILON, Infinity]);

    _defineProperty(this, "phiBounds", [0, Math.PI]);

    _defineProperty(this, "thetaBounds", [-Infinity, Infinity]);

    _defineProperty(this, "pointerManager", void 0);

    _defineProperty(this, "sphericalTarget", vec3.create());

    _defineProperty(this, "targetTarget", vec3.create());

    _defineProperty(this, "upQuat", quat.create());

    _defineProperty(this, "upQuatInverse", quat.create());

    Object.assign(this, options); // Set by spherical angle and optional distance

    if (options.theta || options.phi) {
      this.updatePosition();
    } // Set by position and optional target
    else {
        if (!options.position) vec3.copy(this.position, options.camera.position);
        vec3.subtract(TEMP, this.position, this.target);
        this.distance = vec3.length(TEMP);
        this.theta = Math.atan2(this.position[0], this.position[2]);
        this.phi = Math.acos(clamp(this.position[1] / this.distance, -1, 1));
      } // Init private targets


    this.sphericalTarget[0] = this.theta;
    this.sphericalTarget[1] = this.phi;
    this.sphericalTarget[2] = this.distance;
    vec3.copy(this.targetTarget, this.target);
    this.update();
    this.onPointerUpdate = this.onPointerUpdate.bind(this);
    this.pointerManager = new PointerManager({
      element: this.element,
      config: {
        wheel: true,
        drag: true
      },
      onPointerUpdate: this.onPointerUpdate
    });
    this.pointerManager.enable();
  } // Actions


  handleDolly(event) {
    let delta = event.dy;

    switch (event.state) {
      case PointerManagerState.MouseLeft:
      case PointerManagerState.MouseRight:
      case PointerManagerState.MouseMiddle:
        {
          delta *= 20;
          break;
        }

      case PointerManagerState.TouchTwo:
        {
          delta /= 20;
          break;
        }

      default:
        break;
    }

    this.sphericalTarget[2] += clamp(delta * this.dollySpeed, -this.dollyMaxDelta, this.dollyMaxDelta);
  }

  handleRotateAzimuth(event) {
    this.sphericalTarget[0] -= clamp(PI2 * event.dx * this.rotateSpeed, -this.rotateMaxThetaDelta, this.rotateMaxThetaDelta);
  }

  handleRotatePolar(event) {
    this.sphericalTarget[1] -= clamp(PI2 * event.dy * this.rotateSpeed, -this.rotateMaxPhiDelta, this.rotateMaxPhiDelta);
  }

  handleRotate(event) {
    this.handleRotateAzimuth(event);
    this.handleRotatePolar(event);
  } // Pointer Event handlers


  onPointerUpdate(event) {
    this[`handle${this.config[event.state]}`](event);
  } // Update


  updatePosition() {
    this.distance = Math.max(EPSILON, this.distance);
    this.position[0] = this.distance * Math.sin(this.phi) * Math.sin(this.theta);
    this.position[1] = this.distance * Math.cos(this.phi);
    this.position[2] = this.distance * Math.sin(this.phi) * Math.cos(this.theta);
  }

  update() {
    const dampRatio = 1 - this.damping;
    const deltaTheta = this.sphericalTarget[0] - this.theta;
    const deltaPhi = this.sphericalTarget[1] - this.phi;
    const deltaDistance = this.sphericalTarget[2] - this.distance;
    const deltaTarget = vec3.create();
    vec3.sub(deltaTarget, this.targetTarget, this.target);

    if (!Controls.isNegligeable(deltaTheta) || !Controls.isNegligeable(deltaPhi) || !Controls.isNegligeable(deltaDistance) || !Controls.isNegligeable(deltaTarget[0]) || !Controls.isNegligeable(deltaTarget[1]) || !Controls.isNegligeable(deltaTarget[2])) {
      this.theta = this.theta + deltaTheta * dampRatio;
      this.phi = this.phi + deltaPhi * dampRatio;
      this.distance = this.distance + deltaDistance * dampRatio;
      vec3.add(this.target, this.target, vec3.scale(deltaTarget, deltaTarget, dampRatio));
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
    this.distance = clamp(this.distance, this.distanceBounds[0], this.distanceBounds[1]);
    quat.rotationTo(this.upQuat, this.camera.up, Controls.Y_UP);
    quat.invert(this.upQuatInverse, this.upQuat);
    this.updatePosition(); // TODO: copy directly into camera as an option

    vec3.transformQuat(this.position, this.position, this.upQuatInverse);
    vec3.add(this.position, this.target, this.position);
  }

}

_defineProperty(Controls, "Y_UP", vec3.fromValues(0, 1, 0));