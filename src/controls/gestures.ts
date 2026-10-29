import { vec3 } from "pex-math";

import { X_AXIS, Y_AXIS, ZERO } from "../core/math.js";

import type { Quat, Vec2, Vec3 } from "pex-math";
import type { Radian, Second } from "../core/types.js";
import type KeyboardManager from "../input/KeyboardManager.js";
import type { Gesture } from "./types.js";

/**
 * Dolly log-scale per CSS pixel, for wheels and drags alike: d3-zoom doubles
 * the scale every 500 px of `deltaY`.
 *
 * @see https://github.com/d3/d3-zoom/blob/main/src/zoom.js
 */
const PIXEL_DOLLY = 0.002 * Math.LN2;
/** Half-life of a decay scaling by `rate`, `hz` times per second. */
const decayHalfLife = (rate: number, hz: number): Second =>
  Math.LN2 / (-hz * Math.log(rate));
/**
 * IOS scroll views, for gestures moving content 1:1 with the pointer.
 * `UIScrollView.DecelerationRate` scales the velocity every millisecond.
 */
const SCROLL_HALF_LIFE = decayHalfLife(0.998, 1000);
/**
 * IOS web views, for gestures amplifying the pointer motion: an arc turns a
 * viewport height into a full turn, about 7 times more on-screen motion.
 */
const FAST_SCROLL_HALF_LIFE = decayHalfLife(0.99, 1000);

/**
 * Lag behind the pointer while a gesture is active.
 *
 * @see MacKenzie, I. S. & Ware, C. (1993). Lag as a determinant of human performance in interactive systems. https://doi.org/10.1145/169059.169431
 */
const POINTER_LAG: Second = 0.05;

/**
 * Quake `cl_yawspeed` default of 140°/s: keyboard turn rate.
 *
 * @see https://github.com/id-Software/Quake/blob/master/WinQuake/cl_input.c
 */
const KEY_TURN_SPEED = (140 * Math.PI) / 180;
/**
 * Average preferred walking speed in m/s.
 *
 * @see https://en.wikipedia.org/wiki/Preferred_walking_speed
 */
const WALK_SPEED = 1.4;
/**
 * Lower end of preferred walking speeds in m/s.
 *
 * @see https://en.wikipedia.org/wiki/Preferred_walking_speed
 */
const SLOW_WALK_SPEED = 1.1;
/**
 * Blender `walk_speed_factor` default: multiplies the speed when fast.
 *
 * @see https://docs.blender.org/api/current/bpy.types.WalkNavigation.html
 */
const SPEED_FACTOR = 5;
/**
 * Preferred walking cadence of 120 steps per minute, one head bob per step.
 *
 * @see MacDougall, H. G. & Moore, S. T. (2005). Marching to the beat of the same drummer: the spontaneous tempo of human locomotion. J Appl Physiol 99(3). https://doi.org/10.1152/japplphysiol.00138.2005
 */
const STEP_FREQUENCY = 2;

const ZERO_2: Vec2 = [0, 0];

/** Log of the distance ratio a gesture asks for: positive moves away. */
function logScale(gesture: Gesture): number {
  if (gesture.type === "pinch") return -Math.log(gesture.scale);
  if (gesture.type === "wheel") return gesture.delta[1] * PIXEL_DOLLY;
  return gesture.pointerCount >= 2
    ? -Math.log(gesture.scale)
    : gesture.delta[1] * PIXEL_DOLLY;
}

/**
 * Direction factor of positional deltas: dragging grabs the content, scrolling
 * and pointer lock move the view.
 */
function grabSign(gesture: Gesture): 1 | -1 {
  return gesture.type === "wheel" ||
    (gesture.type !== "pinch" && gesture.locked)
    ? -1
    : 1;
}

/** Normalized delta of a gesture, zero for pinches. Read only. */
function deltaOf(gesture: Gesture): Vec2 {
  return gesture.type === "pinch" ? ZERO_2 : gesture.deltaNormalized;
}

/**
 * Content rotation a gesture asks for, counter-clockwise on screen: the twist
 * of two fingers or a trackpad, else a half turn per viewport height of
 * horizontal motion. Fingers panning together don't twist.
 */
function twistOf(gesture: Gesture): Radian {
  return gesture.type === "pinch" ||
    (gesture.type !== "wheel" && gesture.pointerCount >= 2)
    ? gesture.rotation
    : -deltaOf(gesture)[0] * grabSign(gesture) * Math.PI;
}

const TEMP_RIGHT = vec3.create();
const TEMP_UP = vec3.create();

/**
 * Point under the cursor on the plane through the target facing the camera.
 *
 * @param out Point on the plane.
 * @param target Point the plane goes through.
 * @param orientation Camera orientation.
 * @param offset Focal offset in camera space.
 * @param halfHeight Half height of the view at the target.
 * @param aspect Viewport aspect ratio.
 * @param ndc Cursor position in NDC.
 */
function cursorPoint(
  out: Vec3,
  target: Vec3,
  orientation: Quat,
  offset: Vec3,
  halfHeight: number,
  aspect: number,
  ndc: Vec2,
): Vec3 {
  vec3.multQuat(vec3.set(TEMP_RIGHT, X_AXIS), orientation);
  vec3.multQuat(vec3.set(TEMP_UP, Y_AXIS), orientation);
  vec3.set(out, target);
  vec3.addScaled(out, TEMP_RIGHT, offset[0] + ndc[0] * halfHeight * aspect);
  return vec3.addScaled(out, TEMP_UP, offset[1] + ndc[1] * halfHeight);
}

/**
 * Key codes per movement direction. Several codes per direction support QWERTY
 * arrows and alternatives.
 */
interface MovementKeys {
  forward: string[];
  backward: string[];
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  sprint: string[];
  slow: string[];
}

const DEFAULT_MOVEMENT_KEYS: MovementKeys = {
  forward: ["KeyW", "ArrowUp"],
  backward: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyE", "Space"],
  down: ["KeyQ", "KeyC"],
  sprint: ["ShiftLeft", "ShiftRight"],
  slow: ["AltLeft", "AltRight"],
};

/** Local movement direction from pressed keys: x right, y up, z forward. */
function movementAxes(
  out: Vec3,
  keyboard: KeyboardManager | null,
  keys: MovementKeys,
): Vec3 {
  if (!keyboard) return vec3.set(out, ZERO);
  out[0] = keyboard.axis(keys.left, keys.right);
  out[1] = keyboard.axis(keys.down, keys.up);
  out[2] = keyboard.axis(keys.backward, keys.forward);
  return out;
}

export {
  PIXEL_DOLLY,
  decayHalfLife,
  SCROLL_HALF_LIFE,
  FAST_SCROLL_HALF_LIFE,
  POINTER_LAG,
  KEY_TURN_SPEED,
  WALK_SPEED,
  SLOW_WALK_SPEED,
  SPEED_FACTOR,
  STEP_FREQUENCY,
  logScale,
  grabSign,
  deltaOf,
  twistOf,
  cursorPoint,
  DEFAULT_MOVEMENT_KEYS,
  movementAxes,
};
export type { MovementKeys };
