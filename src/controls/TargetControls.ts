import eerp from "eerp";
import { aabb } from "pex-geom";
import { quat, utils, vec3 } from "pex-math";
import { smoothDamp, smoothDampVec3 } from "ressort";

import { scaleAround, NEG_Z_AXIS, X_AXIS, Y_AXIS, ZERO } from "../core/math.js";

import Controls from "./Controls.js";
import {
  cursorPoint,
  deltaOf,
  grabSign,
  logScale,
  FAST_SCROLL_HALF_LIFE,
  POINTER_LAG,
} from "./gestures.js";
import { SPRING_SMOOTH_TIME } from "../core/PoseSource.js";
import {
  boxFitHalfHeight,
  effectiveFov,
  halfHeight,
  isOrthographic,
  sphereFitDistance,
  sphereFitZoom,
} from "../camera/lens.js";

import type { AABB, Ray } from "pex-geom";
import type { Quat, Vec2, Vec3 } from "pex-math";
import type { SpringState } from "ressort";
import type { Pose } from "../core/pose.js";
import type { Radian, Second } from "../core/types.js";
import type { Lens } from "../camera/types.js";
import type { ControlsSettings, Gesture } from "./types.js";

/**
 * - `dolly`: move towards the target, or zoom for orthographic lenses
 * - `zoom`: change magnification
 * - `truck-pedestal`: translate in the screen plane
 * - `pan-tilt`: rotate around the camera position
 * - `focal-offset`: shift the view without moving the target
 */
type TargetAction =
  "dolly" | "zoom" | "truck-pedestal" | "pan-tilt" | "focal-offset";

interface FitOptions {
  /** Fill the view instead of containing the shape. */
  cover?: boolean;
  /** World units around the box: top, right, bottom, left. */
  padding?: [number, number, number, number];
}

/**
 * Distance along a ray from the target towards the camera before hitting the
 * scene, null or undefined when nothing is hit within `distance`.
 */
type Collide = (ray: Ray, distance: number) => number | null | undefined;

interface TargetSettings extends ControlsSettings {
  lens?: Lens;

  smoothTime?: Second;
  draggingSmoothTime?: Second;
  maxSpeed?: number;
  /** Screen angle below which motion rests. */
  restThreshold?: Radian;

  dollySpeed?: number;
  zoomSpeed?: number;
  truckSpeed?: number;
  panTiltSpeed?: number;

  dollyToCursor?: boolean;
  infinityDolly?: boolean;

  distanceBounds?: [number, number];
  zoomBounds?: [number, number];
  boundary?: AABB | null;
  boundaryFriction?: number;
  collide?: Collide | null;
}

const TEMP_QUAT = quat.create();
const TEMP_QUAT_2 = quat.create();
const TEMP_VEC3 = vec3.create();
const TEMP_VEC3_2 = vec3.create();
const TEMP_VEC3_3 = vec3.create();
const TEMP_CORNERS: Vec3[] = Array.from({ length: 8 }, () => vec3.create());
const TEMP_VIEW_BOX: AABB = aabb.create();
const TEMP_RAY: Ray = [vec3.create(), vec3.create()];

const clampBounds = (value: number, [min, max]: [number, number]) =>
  utils.clamp(value, min, max);

/**
 * Base of target controllers, which orbit or spin the camera around a target:
 * target, distance, zoom, focal offset, boundary and collisions. Subclasses own
 * the orientation and call `set` after `super`, once their fields exist.
 */
abstract class TargetControls<
  Action extends string,
  Settings extends TargetSettings = TargetSettings,
  State = unknown,
> extends Controls<Action | TargetAction, Settings, State> {
  public override inertia: Second = FAST_SCROLL_HALF_LIFE;
  /** Transitions look settled after about twice this. */
  public smoothTime: Second = SPRING_SMOOTH_TIME;
  /** Lag behind the pointer while a gesture is active. */
  public draggingSmoothTime: Second = POINTER_LAG;
  /** Speed limit of distance, target and offset changes. */
  public maxSpeed = Infinity;
  public restThreshold = 1e-4;

  public dollySpeed = 1;
  public zoomSpeed = 1;
  public truckSpeed = 1;
  public panTiltSpeed = 1;

  /**
   * Dolly and zoom towards the point under the cursor.
   *
   * @see Mackinlay, J. D., Card, S. K. & Robertson, G. G. (1990). Rapid controlled movement through a virtual 3D workspace. https://doi.org/10.1145/97880.97898
   * @see Fitzmaurice, G., Matejka, J., Mordatch, I., Khan, A. & Kurtenbach, G. (2008). Safe 3D navigation. https://doi.org/10.1145/1342250.1342252
   */
  public dollyToCursor = false;
  /** Keep moving forward past the minimum distance, pushing the target. */
  public infinityDolly = false;

  public distanceBounds: [number, number] = [utils.EPSILON, Infinity];
  public zoomBounds: [number, number] = [0.01, Infinity];
  /** Bounds the target stays in, as [min, max]. */
  public boundary: AABB | null = null;
  /**
   * Fraction in [0, 1] of the motion along the boundary lost once in contact: 0
   * slides freely, 1 sticks.
   *
   * @see Fauerby, K. (2003). Improved collision detection and response. http://www.peroxide.dk/papers/collision/collision.pdf
   * @see Müller, M., Heidelberger, B., Hennix, M. & Ratcliff, J. (2007). Position based dynamics, §3.4. https://doi.org/10.1016/j.jvcir.2007.01.005
   */
  public boundaryFriction = 0;
  /** Keep the camera in front of geometry. */
  public collide: Collide | null = null;

  protected readonly target: Vec3 = [0, 0, 0];
  protected readonly targetEnd: Vec3 = [0, 0, 0];
  protected readonly offset: Vec3 = [0, 0, 0];
  protected readonly offsetEnd: Vec3 = [0, 0, 0];
  protected distance = 1;
  protected distanceEnd = 1;
  protected zoomValue = 1;
  protected zoomEnd = 1;

  #targetVelocity: Vec3 = [0, 0, 0];
  #offsetVelocity: Vec3 = [0, 0, 0];
  #distanceSpring: SpringState = { velocity: 0 };
  #zoomSpring: SpringState = { velocity: 0 };

  // Getters
  public getTarget(out: Vec3 = vec3.create(), end = false): Vec3 {
    return vec3.set(out, end ? this.targetEnd : this.target);
  }

  /** Camera position including the focal offset. */
  public getPosition(out: Vec3 = vec3.create(), end = false): Vec3 {
    const orientation = this.orientation(TEMP_QUAT, end);
    return end
      ? this.#position(
          out,
          this.targetEnd,
          orientation,
          this.offsetEnd,
          this.distanceEnd,
        )
      : this.#position(
          out,
          this.target,
          orientation,
          this.offset,
          this.distance,
        );
  }

  public getFocalOffset(out: Vec3 = vec3.create(), end = false): Vec3 {
    return vec3.set(out, end ? this.offsetEnd : this.offset);
  }

  public getDistance(end = false): number {
    return end ? this.distanceEnd : this.distance;
  }

  public getZoom(end = false): number {
    return end ? this.zoomEnd : this.zoomValue;
  }

  // Dolly and zoom
  /** Move towards (negative) or away from the target. */
  public dolly(distance: number, transition = true): this {
    return this.dollyTo(this.distanceEnd + distance, transition);
  }

  public dollyTo(distance: number, transition = true): this {
    this.distanceEnd = clampBounds(distance, this.distanceBounds);
    return this.commit(transition);
  }

  /** Change magnification by a relative amount. */
  public zoom(delta: number, transition = true): this {
    return this.zoomTo(this.zoomEnd + delta, transition);
  }

  /** Without a transition, only the zoom jumps: other motion carries on. */
  public zoomTo(zoom: number, transition = true): this {
    this.zoomEnd = clampBounds(zoom, this.zoomBounds);
    if (transition) return this.commit(transition);
    this.zoomValue = this.zoomEnd;
    this.#zoomSpring.velocity = 0;
    this.invalidate();
    return this;
  }

  // Translations
  /** Translate in the screen plane: x to the right, y up. */
  public truck(x: number, y = 0, transition = true): this {
    this.translate(x, y, true);
    return this.commit(transition);
  }

  /** Move the target, keeping the orientation and distance. */
  public moveTo(target: Vec3, transition = true): this {
    this.setTargetEnd(target);
    return this.commit(transition);
  }

  // Rotations around the camera
  /** Rotate around the camera position, counter-clockwise (to the left). */
  public pan(angle: Radian, transition = true): this {
    return this.panTilt(angle, 0, transition);
  }

  /** Rotate around the camera position, upwards. */
  public tilt(angle: Radian, transition = true): this {
    return this.panTilt(0, angle, transition);
  }

  public panTilt(pan: Radian, tilt: Radian, transition = true): this {
    this.#panTilt(pan, tilt);
    return this.commit(transition);
  }

  // Placement
  /** Move the camera, keeping the target. */
  public setPosition(position: Vec3, transition = true): this {
    this.lookAtEnd(position, this.targetEnd);
    return this.commit(transition);
  }

  /** Change the target, keeping the camera position. */
  public setTarget(target: Vec3, transition = true): this {
    this.lookAtEnd(this.getPosition(TEMP_VEC3_3, true), target);
    return this.commit(transition);
  }

  /**
   * Place the camera at a position, looking along an orientation. The distance,
   * focal offset and zoom are kept: the target follows.
   */
  public setPose(position: Vec3, orientation: Quat, transition = true): this {
    const target = vec3.multQuat(
      vec3.set(TEMP_VEC3_2, NEG_Z_AXIS),
      orientation,
    );
    vec3.add(vec3.scale(target, this.distanceEnd), position);
    const up = vec3.multQuat(vec3.set(TEMP_VEC3_3, Y_AXIS), orientation);
    this.lookAtEnd(position, target, up);
    this.#targetBehind(position);
    return this.commit(transition);
  }

  /** Keep the distance and look from the opposite side of a point. */
  public lookInDirectionOf(point: Vec3, transition = true): this {
    const direction = vec3.sub(vec3.set(TEMP_VEC3_2, this.targetEnd), point);
    if (vec3.lengthSq(direction) === 0) return this;
    vec3.normalize(direction);
    const position = vec3.addScaled(
      vec3.set(TEMP_VEC3_3, this.targetEnd),
      direction,
      this.distanceEnd,
    );
    return this.setPosition(position, transition);
  }

  /**
   * Shift the camera in its own space (x right, y up, z back) without changing
   * the target.
   */
  public setFocalOffset(offset: Vec3, transition = true): this {
    vec3.set(this.offsetEnd, offset);
    return this.commit(transition);
  }

  /**
   * Orbit around another point without moving the camera: the difference goes
   * into the focal offset.
   */
  public setOrbitPoint(point: Vec3): this {
    const position = this.getPosition(TEMP_VEC3_3, true);
    const orientation = this.orientation(TEMP_QUAT, true);
    const distance = vec3.distance(position, point);

    vec3.sub(vec3.set(this.offsetEnd, position), point);
    vec3.multQuat(this.offsetEnd, quat.invert(orientation));
    this.offsetEnd[2] -= distance;

    this.distanceEnd = distance;
    vec3.set(this.targetEnd, point);
    return this.stop();
  }

  /** Frame a box from the current orientation. */
  public fitToBox(
    box: AABB,
    { cover = false, padding = [0, 0, 0, 0] }: FitOptions = {},
    transition = true,
  ): this {
    const center = aabb.center(box, TEMP_VEC3_2);
    const orientation = this.orientation(TEMP_QUAT, true);
    const inverse = quat.invert(quat.set(TEMP_QUAT_2, orientation));

    for (const corner of aabb.getCorners(box, TEMP_CORNERS)) {
      vec3.multQuat(vec3.sub(corner, center), inverse);
    }
    const view = aabb.fromPoints(TEMP_VIEW_BOX, TEMP_CORNERS);
    const [min, max] = view;
    const [top, right, bottom, left] = padding;
    min[0] -= left;
    max[0] += right;
    min[1] -= bottom;
    max[1] += top;

    const size = aabb.size(view, TEMP_VEC3);
    const fit = boxFitHalfHeight(this.lens, size, cover);

    if (isOrthographic(this.lens)) {
      this.zoomEnd = clampBounds((this.lens.size ?? 1) / fit, this.zoomBounds);
    } else {
      // In front of the closest face.
      this.distanceEnd = clampBounds(
        fit / halfHeight(this.lens, 1, this.zoomEnd) + size[2] / 2,
        this.distanceBounds,
      );
    }

    // View space center of the padded box, in front of its closest face.
    aabb.center(view, TEMP_VEC3);
    vec3.add(vec3.multQuat(TEMP_VEC3, orientation), center);
    this.setTargetEnd(TEMP_VEC3);
    vec3.set(this.offsetEnd, ZERO);
    return this.commit(transition);
  }

  /** Frame a sphere from the current orientation. */
  public fitToSphere(center: Vec3, radius: number, transition = true): this {
    if (isOrthographic(this.lens)) {
      this.zoomEnd = clampBounds(
        sphereFitZoom(this.lens, radius),
        this.zoomBounds,
      );
    } else {
      this.distanceEnd = clampBounds(
        sphereFitDistance(this.lens, radius, this.zoomEnd),
        this.distanceBounds,
      );
    }
    this.setTargetEnd(center);
    vec3.set(this.offsetEnd, ZERO);
    return this.commit(transition);
  }

  /** Jump to the end of the current motion. */
  public override stop(): this {
    vec3.set(this.target, this.targetEnd);
    vec3.set(this.offset, this.offsetEnd);
    this.distance = this.distanceEnd;
    this.zoomValue = this.zoomEnd;
    vec3.set(this.#targetVelocity, ZERO);
    vec3.set(this.#offsetVelocity, ZERO);
    this.#distanceSpring.velocity = 0;
    this.#zoomSpring.velocity = 0;
    this.stopRotation();
    this.invalidate();
    return this;
  }

  // Controls
  protected applyAction(action: Action | TargetAction, gesture: Gesture): void {
    const [dx, dy] = deltaOf(gesture);
    const sign = grabSign(gesture);

    switch (action) {
      case "dolly":
        this.#dollyScale(
          Math.exp(logScale(gesture) * this.dollySpeed),
          gesture.ndc,
        );
        break;
      case "zoom":
        this.#zoomScale(
          Math.exp(-logScale(gesture) * this.zoomSpeed),
          gesture.ndc,
        );
        break;
      case "truck-pedestal": {
        const height = this.dragHeight();
        this.translate(-dx * sign * height, dy * sign * height);
        break;
      }
      case "pan-tilt": {
        const angle =
          sign *
          effectiveFov(this.lens, this.distance, this.zoomValue) *
          this.panTiltSpeed;
        this.#panTilt(dx * angle, dy * angle);
        break;
      }
      case "focal-offset": {
        const height = this.dragHeight();
        this.offsetEnd[0] -= dx * sign * height;
        this.offsetEnd[1] += dy * sign * height;
        break;
      }
    }
    this.invalidate();
  }

  protected step(dt: Second): boolean {
    const smoothTime = this.userControlling
      ? this.draggingSmoothTime
      : this.smoothTime;

    const angle = this.stepRotation(dt, smoothTime);
    this.distance = smoothDamp(
      this.distance,
      this.distanceEnd,
      this.#distanceSpring,
      smoothTime,
      dt,
      this.maxSpeed,
    );
    // Damped as the view scale: linear like the target, so the point under the
    // cursor stays put during the transition.
    this.zoomValue =
      1 /
      smoothDamp(
        1 / this.zoomValue,
        1 / this.zoomEnd,
        this.#zoomSpring,
        smoothTime,
        dt,
      );
    smoothDampVec3(
      this.target,
      this.targetEnd,
      this.#targetVelocity,
      smoothTime,
      dt,
      this.maxSpeed,
    );
    smoothDampVec3(
      this.offset,
      this.offsetEnd,
      this.#offsetVelocity,
      smoothTime,
      dt,
      this.maxSpeed,
    );

    // Zooming in narrows the angle a pixel covers. Orthographic views span
    // their size whatever the distance.
    const restAngle = this.restThreshold / this.zoomEnd;
    const length = isOrthographic(this.lens)
      ? this.restThreshold *
        halfHeight(this.lens, this.distanceEnd, this.zoomEnd)
      : restAngle * Math.max(this.distanceEnd, utils.EPSILON);
    const settled =
      angle < restAngle &&
      Math.abs(this.distance - this.distanceEnd) < length &&
      Math.abs(this.zoomValue - this.zoomEnd) <
        this.restThreshold * this.zoomEnd &&
      vec3.distance(this.target, this.targetEnd) < length &&
      vec3.distance(this.offset, this.offsetEnd) < length;

    if (!settled) return true;

    const exact =
      angle === 0 &&
      this.distance === this.distanceEnd &&
      this.zoomValue === this.zoomEnd &&
      vec3.equals(this.target, this.targetEnd) &&
      vec3.equals(this.offset, this.offsetEnd);
    if (!exact) this.stop();
    return false;
  }

  protected writePose(out: Pose): void {
    const orientation = this.orientation(out.orientation);
    let distance = this.distance;

    if (this.collide) {
      const [origin, direction] = TEMP_RAY;
      vec3.set(origin, this.target);
      this.#position(
        direction,
        this.target,
        orientation,
        this.offset,
        distance,
      );
      const length = vec3.distance(direction, origin);
      vec3.normalize(vec3.sub(direction, origin));
      const hit = this.collide(TEMP_RAY, length);
      if (hit != null) distance = Math.min(distance, hit);
    }

    this.#position(
      out.position,
      this.target,
      orientation,
      this.offset,
      distance,
    );
    vec3.set(out.target, this.target);
    // The camera up, not the world up: valid near the poles too.
    vec3.multQuat(vec3.set(out.up, Y_AXIS), orientation);
    out.zoom = this.zoomValue;
  }

  /** Current orientation, or the one at the end of the motion. */
  protected abstract orientation(out: Quat, end?: boolean): Quat;

  /**
   * Set the end orientation, distance and target from a position. Controllers
   * that can roll take `up`, defaulting to the current camera up.
   */
  protected abstract lookAtEnd(position: Vec3, target: Vec3, up?: Vec3): void;

  /** Turn the end orientation left and up, around the camera. */
  protected abstract turnEnd(pan: Radian, tilt: Radian): void;

  /** Advance rotation damping. Returns the remaining angle. */
  protected abstract stepRotation(dt: Second, smoothTime: Second): Radian;

  protected abstract stopRotation(): void;

  /** World height a drag over the viewport height trucks by. */
  protected dragHeight(): number {
    return 2 * this.#halfHeight() * this.truckSpeed;
  }

  /** Set the end state shared by all target controllers, within bounds. */
  protected setEnd(
    target: Vec3,
    distance: number,
    offset: Vec3,
    zoom: number,
  ): void {
    this.setTargetEnd(target);
    this.distanceEnd = clampBounds(distance, this.distanceBounds);
    vec3.set(this.offsetEnd, offset);
    this.zoomEnd = clampBounds(zoom, this.zoomBounds);
  }

  /** Interpolate the end target and distance between two states. */
  protected lerpEnd(
    fromTarget: Vec3,
    toTarget: Vec3,
    fromDistance: number,
    toDistance: number,
    t: number,
  ): void {
    this.setTargetEnd(vec3.lerp(vec3.set(TEMP_VEC3, fromTarget), toTarget, t));
    // Distance in log space, as the shots' arc path: constant perceived speed.
    // Clamped first: the log of a zero distance is undefined.
    this.distanceEnd = eerp(
      clampBounds(fromDistance, this.distanceBounds),
      clampBounds(toDistance, this.distanceBounds),
      t,
    );
  }

  protected setTargetEnd(target: Vec3): void {
    this.#clampToBoundary(vec3.set(this.targetEnd, target));
  }

  /**
   * Translate the end target in the screen plane: of the current view for
   * gestures, matching what is on screen, of the end view for methods.
   */
  protected translate(x: number, y: number, end = false): void {
    const orientation = this.orientation(TEMP_QUAT, end);
    vec3.scale(vec3.multQuat(vec3.set(TEMP_VEC3, X_AXIS), orientation), x);
    vec3.addScaled(
      TEMP_VEC3,
      vec3.multQuat(vec3.set(TEMP_VEC3_2, Y_AXIS), orientation),
      y,
    );
    this.moveTargetEnd(TEMP_VEC3);
  }

  // Collide and slide: the motion is free until it first touches a face, the
  // rest is damped by the friction, then projected onto the faces. A target
  // already past a face is in contact from the start.
  protected moveTargetEnd(offset: Vec3): void {
    const target = this.targetEnd;
    let contact = 1;
    if (this.boundary) {
      const [min, max] = this.boundary;
      for (let axis = 0; axis < 3; axis++) {
        const from = target[axis];
        const to = from + offset[axis];
        const face = utils.clamp(to, min[axis], max[axis]);
        if (face === to) continue;
        const inside = from >= min[axis] && from <= max[axis];
        contact = Math.min(contact, inside ? (face - from) / offset[axis] : 0);
      }
    }
    vec3.addScaled(
      target,
      offset,
      contact + (1 - contact) * (1 - this.boundaryFriction),
    );
    this.#clampToBoundary(target);
  }

  get #aspect(): number {
    return this.lens?.aspect ?? 1;
  }

  #halfHeight(): number {
    return halfHeight(this.lens, this.distance, this.zoomValue);
  }

  // target + orientation * (offset + [0, 0, distance])
  #position(
    out: Vec3,
    target: Vec3,
    orientation: Quat,
    offset: Vec3,
    distance: number,
  ): Vec3 {
    vec3.set(out, offset);
    out[2] += distance;
    return vec3.add(vec3.multQuat(out, orientation), target);
  }

  // Rotating around the camera keeps its position: the target follows.
  #panTilt(pan: Radian, tilt: Radian): void {
    const position = this.getPosition(TEMP_VEC3_3, true);
    this.turnEnd(pan, tilt);
    this.#targetBehind(position);
  }

  // Move the end target so that the end camera, focal offset included, sits at
  // a position.
  #targetBehind(position: Vec3): void {
    const back = this.#position(
      TEMP_VEC3,
      ZERO,
      this.orientation(TEMP_QUAT, true),
      this.offsetEnd,
      this.distanceEnd,
    );
    vec3.sub(vec3.set(this.targetEnd, position), back);
  }

  // Point of interest movement: scaling around the cursor point moves the eye
  // along the cursor ray by a fraction of the distance, keeping the point under
  // the cursor.
  #scaleAroundCursor(ndc: Vec2, ratio: number): void {
    if (!this.dollyToCursor || ratio === 1) return;
    const point = cursorPoint(
      TEMP_VEC3_3,
      this.target,
      this.orientation(TEMP_QUAT),
      this.offset,
      this.#halfHeight(),
      this.#aspect,
      ndc,
    );
    this.#clampToBoundary(scaleAround(this.targetEnd, point, ratio));
  }

  #dollyScale(scale: number, ndc: Vec2): void {
    if (isOrthographic(this.lens)) {
      this.#zoomScale(1 / scale, ndc);
      return;
    }
    const distance = this.distanceEnd;
    const unclamped = distance * scale;
    const next = clampBounds(unclamped, this.distanceBounds);
    this.#scaleAroundCursor(ndc, next / distance);
    this.distanceEnd = next;

    const overflow = this.distanceBounds[0] - unclamped;
    if (!this.infinityDolly || overflow <= 0) return;

    const orientation = this.orientation(TEMP_QUAT, true);
    this.moveTargetEnd(
      vec3.scale(
        vec3.multQuat(vec3.set(TEMP_VEC3, NEG_Z_AXIS), orientation),
        overflow,
      ),
    );
  }

  #zoomScale(scale: number, ndc: Vec2): void {
    const zoom = this.zoomEnd;
    this.zoomEnd = clampBounds(zoom * scale, this.zoomBounds);
    this.#scaleAroundCursor(ndc, zoom / this.zoomEnd);
  }

  #clampToBoundary(target: Vec3): void {
    if (!this.boundary) return;
    const [min, max] = this.boundary;
    for (let axis = 0; axis < 3; axis++) {
      target[axis] = utils.clamp(target[axis], min[axis], max[axis]);
    }
  }
}

export type { TargetAction, Collide, FitOptions, TargetSettings };
export default TargetControls;
