import type { Vec2 } from "pex-math";
import type { Pixel, Radian, Second } from "../core/types.js";

/** `PointerEvent.buttons` flags. */
const MouseButton = {
  Primary: 1,
  Secondary: 2,
  Auxiliary: 4,
  Back: 8,
  Forward: 16,
  /** Pen eraser. */
  Eraser: 32,
} as const;
type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

type PointerType = "mouse" | "pen" | "touch";

type WheelDevice = "mouse" | "trackpad" | "unknown";

interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/** Normalized rectangle [x, y, width, height] in [0, 1] of the element. */
type InteractiveArea = [number, number, number, number];

interface Located {
  /** Element relative position in CSS pixels. */
  position: Vec2;
  /** Position in [-1, 1] over the interactive area, y up. */
  ndc: Vec2;
  /** Width over height of the interactive area. */
  aspect: number;
  modifiers: Modifiers;
  timeStamp: number;
}

/**
 * Drag gesture. `start` and `end` are balanced: a change of buttons or pointer
 * count ends the gesture and starts a new one.
 */
interface PointerGesture extends Located {
  type: "start" | "move" | "end";
  pointerType: PointerType;
  pointerCount: number;
  /** `MouseButton` flags. 0 for touch. */
  buttons: number;
  /** Centroid movement since the last event, in CSS pixels. */
  delta: Vec2;
  /** `delta` divided by the interactive area height. */
  deltaNormalized: Vec2;
  /** Spread ratio since the last event, 1 with fewer than two pointers. */
  scale: number;
  /**
   * Twist since the last event, counter-clockwise on screen. 0 with fewer than
   * two pointers.
   */
  rotation: Radian;
  /**
   * Smoothed centroid velocity in CSS pixels per second. 0 on `end` if the
   * pointer rested before release.
   */
  velocity: Vec2;
  /** `velocity` divided by the interactive area height, per second. */
  velocityNormalized: Vec2;
  /** Pointer lock active: deltas come from `movementX/Y`. */
  locked: boolean;
  originalEvent?: Event;
}

interface WheelGesture extends Located {
  type: "wheel";
  /** Delta in CSS pixels, whatever the `deltaMode`. */
  delta: Vec2;
  /** `delta` divided by the interactive area height. */
  deltaNormalized: Vec2;
  device: WheelDevice;
  originalEvent: WheelEvent;
}

/**
 * Trackpad pinch, from ctrlKey wheel events (Chrome, Firefox, Edge) or Safari
 * gesture events.
 */
interface PinchGesture extends Located {
  type: "pinch";
  /** Scale ratio since the last event. */
  scale: number;
  /** Rotation since the last event (Safari only). */
  rotation: Radian;
  originalEvent: Event;
}

interface PointerManagerEventMap {
  start: PointerGesture;
  move: PointerGesture;
  end: PointerGesture;
  wheel: WheelGesture;
  pinch: PinchGesture;
}

interface PointerManagerOptions {
  /** Listen to wheel and trackpad pinch. */
  wheel?: boolean;
  /** Suppress the context menu so the secondary button can drag. */
  preventContextMenu?: boolean;
  interactiveArea?: InteractiveArea;
  /** Half-life of the velocity smoothing. */
  velocitySmoothing?: Second;
  /** Release after resting this long yields zero velocity. */
  restThreshold?: Second;
  /**
   * Pixels per wheel line when `deltaMode` is lines. Defaults to a third of
   * Chrome's notch, so a Firefox notch (3 lines) scrolls as far.
   */
  lineHeight?: Pixel;
  /**
   * Inline styles set while enabled, previous values restored on disable.
   * Replaces the defaults: keep `touch-action: none` for touch gestures.
   */
  styles?: Record<string, string>;
  /**
   * Accept an event starting a gesture, wheel or context menu. Defaults to
   * events targeting the element itself, so descendants keep their input.
   */
  filter?: (event: Event) => boolean;
}

interface KeyboardEventDetail {
  type: "down" | "up";
  /** Physical key, layout independent (`KeyW` on AZERTY is the Z key). */
  code: string;
  key: string;
  repeat: boolean;
  modifiers: Modifiers;
  originalEvent?: KeyboardEvent;
}

interface KeyboardManagerEventMap {
  down: KeyboardEventDetail;
  up: KeyboardEventDetail;
}

interface KeyboardManagerOptions {
  /** Prevent default for these codes, e.g. arrows and space to stop scrolling. */
  preventDefault?: Iterable<string>;
  /**
   * Accept a keydown. Defaults to ignoring keys typed in form fields, buttons,
   * links and other focusable controls, unless the control is the target.
   */
  filter?: (event: KeyboardEvent) => boolean;
}

export { MouseButton };
export type {
  PointerType,
  WheelDevice,
  Modifiers,
  InteractiveArea,
  Located,
  PointerGesture,
  WheelGesture,
  PinchGesture,
  PointerManagerEventMap,
  PointerManagerOptions,
  KeyboardEventDetail,
  KeyboardManagerEventMap,
  KeyboardManagerOptions,
};
