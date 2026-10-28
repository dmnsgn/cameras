import { damp } from "ressort";

import Emitter from "../core/Emitter.js";
import { normalizeAngle, safeDivide } from "../core/math.js";

import { angle, centroid, spread } from "./pointers.js";
import { getModifiers } from "./modifiers.js";
import {
  DEFAULT_LINE_HEIGHT,
  normalizeDelta,
  pinchScale,
  WheelStream,
} from "./wheel.js";

import type { Vec2 } from "pex-math";
import type { Second } from "../core/types.js";
import type { ModifierEvent } from "./modifiers.js";
import type {
  InteractiveArea,
  Located,
  PointerGesture,
  PointerManagerEventMap,
  PointerManagerOptions,
  PointerType,
} from "./types.js";

interface GestureEvent extends UIEvent {
  scale: number;
  rotation: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const DEFAULT_STYLES: Record<string, string> = {
  // Without it, touch drags pan the page and fire pointercancel.
  "touch-action": "none",
  "user-select": "none",
  "-webkit-user-select": "none",
  "-webkit-touch-callout": "none",
};

/**
 * Same mean sample age as the 100 ms `HORIZON` of Android's velocity tracker.
 *
 * @see https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/include/input/VelocityTracker.h
 */
const VELOCITY_HALF_LIFE: Second = (Math.LN2 * 0.1) / 2;
/**
 * Android `ASSUME_POINTER_STOPPED_TIME`.
 *
 * @see https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/libs/input/VelocityTracker.cpp
 */
const POINTER_STOPPED_TIME: Second = 0.04;

/**
 * Normalizes pointer, wheel and trackpad input of an element into gestures.
 *
 * Knows nothing about cameras: consumers map gestures to actions.
 */
export default class PointerManager extends Emitter<PointerManagerEventMap> {
  public readonly element: HTMLElement;

  public wheel = true;
  public preventContextMenu = true;
  public interactiveArea: InteractiveArea = [0, 0, 1, 1];
  /** Half-life of the velocity estimate. */
  public velocitySmoothing = VELOCITY_HALF_LIFE;
  /** Pause before release after which the pointer counts as stopped. */
  public restThreshold = POINTER_STOPPED_TIME;
  public lineHeight = DEFAULT_LINE_HEIGHT;
  public styles = DEFAULT_STYLES;
  public filter = (event: Event): boolean => event.target === this.element;

  #abortController: AbortController | null = null;
  #styles = new Map<string, string>();

  // Client positions of active pointers, in insertion order.
  #pointers = new Map<number, Vec2>();
  #pointerType: PointerType = "mouse";
  #buttons = 0;
  #active = false;
  #locked = false;

  // Element rect, read at gesture starts and kept until a resize or scroll.
  #rect: DOMRect | null = null;
  #resizeObserver: ResizeObserver | null = null;
  // Interactive area in client coordinates: left, top, width, height. Zero
  // sized when the element is hidden or interactiveArea collapsed.
  #area: [number, number, number, number] = [0, 0, 1, 1];

  #centroid: Vec2 = [0, 0];
  #spread = 0;
  #angle = 0;
  #velocity: Vec2 = [0, 0];
  #lastTime = 0;
  #lastMoveTime = 0;

  #wheelStream = new WheelStream();
  #safariGesture: { scale: number; rotation: number } | null = null;

  constructor(element: HTMLElement, options: PointerManagerOptions = {}) {
    super();
    this.element = element;
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
    this.interactiveArea = [...this.interactiveArea];
    this.styles = { ...this.styles };
  }

  /** Listening to input. */
  public get enabled(): boolean {
    return this.#abortController !== null;
  }

  /** Pointer lock is active on the element. */
  public get locked(): boolean {
    return this.#locked;
  }

  /** A drag gesture is in progress. */
  public get active(): boolean {
    return this.#active;
  }

  /** Start listening. */
  public enable(): this {
    if (this.#abortController) return this;

    this.#abortController = new AbortController();
    const { signal } = this.#abortController;
    const element = this.element;
    const document = element.ownerDocument;
    const view = document?.defaultView;

    for (const [property, value] of Object.entries(this.styles)) {
      this.#styles.set(property, element.style.getPropertyValue(property));
      element.style.setProperty(property, value);
    }

    const options = { signal };
    element.addEventListener("pointerdown", this.#onPointerDown, options);
    element.addEventListener("pointermove", this.#onPointerMove, options);
    element.addEventListener("pointerup", this.#onPointerUp, options);
    element.addEventListener("pointercancel", this.#onPointerUp, options);
    element.addEventListener(
      "lostpointercapture",
      this.#onLostPointerCapture,
      options,
    );
    element.addEventListener("contextmenu", this.#onContextMenu, options);

    if (this.wheel) {
      const active = { signal, passive: false };
      element.addEventListener("wheel", this.#onWheel, active);
      element.addEventListener("gesturestart", this.#onGestureStart, active);
      element.addEventListener("gesturechange", this.#onGestureChange, active);
      element.addEventListener("gestureend", this.#onGestureEnd, active);
    }

    document?.addEventListener(
      "pointerlockchange",
      this.#onPointerLockChange,
      options,
    );
    document?.addEventListener(
      "visibilitychange",
      this.#onVisibilityChange,
      options,
    );
    view?.addEventListener("blur", this.cancel, options);

    // Capture catches scrolls of any ancestor, which don't bubble.
    view?.addEventListener("scroll", this.#invalidateRect, {
      signal,
      capture: true,
      passive: true,
    });
    view?.addEventListener("resize", this.#invalidateRect, options);
    if (view?.ResizeObserver) {
      this.#resizeObserver = new view.ResizeObserver(this.#invalidateRect);
      this.#resizeObserver.observe(element);
    }

    // Catch up with a lock acquired while disabled.
    this.#onPointerLockChange(new Event("pointerlockchange"));

    return this;
  }

  /**
   * Stop listening, end the current gesture, exit pointer lock and restore
   * element styles.
   */
  public disable(): this {
    if (!this.#abortController) return this;

    this.cancel();
    // The lock change notification is async and would miss its listener.
    this.exitPointerLock();
    this.#locked = false;

    this.#abortController.abort();
    this.#abortController = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#rect = null;

    for (const [property, value] of this.#styles) {
      if (value) this.element.style.setProperty(property, value);
      else this.element.style.removeProperty(property);
    }
    this.#styles.clear();

    return this;
  }

  /** Disable and remove all listeners. */
  public dispose(): void {
    this.disable();
    this.removeAllListeners();
  }

  /** End the current gesture and forget active pointers. */
  public cancel = (): void => {
    for (const pointerId of this.#pointers.keys()) {
      this.#releaseCapture(pointerId);
    }
    this.#pointers.clear();
    // Not a release: no fling.
    this.#velocity[0] = this.#velocity[1] = 0;
    if (this.#active) this.#end();
    this.#safariGesture = null;
  };

  /**
   * Request pointer lock, with raw unaccelerated deltas where supported.
   *
   * @param [unadjustedMovement=true]
   * @see https://www.w3.org/TR/pointerlock-2/
   */
  public async requestPointerLock(unadjustedMovement = true): Promise<void> {
    try {
      await this.element.requestPointerLock({ unadjustedMovement });
    } catch (error) {
      // Platforms without raw input reject it, other browsers ignore the option.
      if ((error as Error).name !== "NotSupportedError") throw error;
      await this.element.requestPointerLock();
    }
  }

  public exitPointerLock(): void {
    if (this.#locked) this.element.ownerDocument.exitPointerLock();
  }

  // Area
  #invalidateRect = (): void => {
    this.#rect = null;
  };

  // Layout can change between gestures without notice: starts pass `fresh`.
  #updateArea(fresh = false): void {
    if (fresh) this.#rect = null;
    this.#rect ??= this.element.getBoundingClientRect();
    const { left, top, width, height } = this.#rect;
    const [x, y, w, h] = this.interactiveArea;
    this.#area[0] = left + x * width;
    this.#area[1] = top + y * height;
    this.#area[2] = w * width;
    this.#area[3] = h * height;
  }

  #isInArea(clientX: number, clientY: number): boolean {
    const [left, top, width, height] = this.#area;
    return (
      clientX >= left &&
      clientX <= left + width &&
      clientY >= top &&
      clientY <= top + height
    );
  }

  #locate(clientX: number, clientY: number, event?: ModifierEvent): Located {
    const [left, top, width, height] = this.#area;
    const x = clientX - left;
    const y = clientY - top;
    return {
      position: [x, y],
      ndc: [safeDivide(x, width) * 2 - 1, 1 - safeDivide(y, height) * 2],
      aspect: safeDivide(width, height, 1),
      modifiers: getModifiers(event),
      timeStamp: event?.timeStamp ?? this.#lastTime,
    };
  }

  // Area height relative, so speeds don't depend on the canvas size.
  #normalize([x, y]: Vec2): Vec2 {
    const height = this.#area[3];
    return [safeDivide(x, height), safeDivide(y, height)];
  }

  // Pointers
  #measure(): void {
    const points = [...this.#pointers.values()];
    centroid(this.#centroid, points);
    this.#spread = spread(points, this.#centroid);
    this.#angle = points.length >= 2 ? angle(points[0], points[1]) : 0;
  }

  #gesture(
    type: PointerGesture["type"],
    event: ModifierEvent | undefined,
    delta: Vec2 = [0, 0],
    scale = 1,
    rotation = 0,
  ): PointerGesture {
    this.#updateArea();
    const [left, top, width, height] = this.#area;
    // Locked gestures have no pointers and stay at the area center.
    const [x, y] = this.#locked
      ? [left + width / 2, top + height / 2]
      : this.#centroid;
    return {
      type,
      ...this.#locate(x, y, event),
      pointerType: this.#pointerType,
      pointerCount: this.#locked ? 0 : this.#pointers.size,
      buttons: this.#buttons,
      delta,
      deltaNormalized: this.#normalize(delta),
      scale,
      rotation,
      velocity: [...this.#velocity],
      velocityNormalized: this.#normalize(this.#velocity),
      locked: this.#locked,
      originalEvent: event,
    };
  }

  #start(event: ModifierEvent): void {
    this.#measure();
    this.#velocity[0] = this.#velocity[1] = 0;
    this.#lastTime = this.#lastMoveTime = event.timeStamp;
    this.#active = true;
    this.emit("start", this.#gesture("start", event));
  }

  #end(event?: ModifierEvent): void {
    const timestamp = event?.timeStamp ?? this.#lastTime;
    if ((timestamp - this.#lastMoveTime) / 1000 > this.restThreshold) {
      this.#velocity[0] = this.#velocity[1] = 0;
    }
    this.#active = false;
    this.emit("end", this.#gesture("end", event));
  }

  // End and start again so deltas never jump when the configuration changes.
  #restart(event: ModifierEvent): void {
    if (this.#active) this.#end(event);
    this.#start(event);
  }

  #move(event: PointerEvent, delta: Vec2, scale: number, rotation: number) {
    const dt = (event.timeStamp - this.#lastTime) / 1000;
    if (dt > 0) {
      for (let i = 0; i < 2; i++) {
        this.#velocity[i] = damp(
          this.#velocity[i],
          delta[i] / dt,
          this.velocitySmoothing,
          dt,
        );
      }
    }
    this.#lastTime = event.timeStamp;
    if (delta[0] || delta[1] || scale !== 1 || rotation) {
      this.#lastMoveTime = event.timeStamp;
    }
    this.emit("move", this.#gesture("move", event, delta, scale, rotation));
  }

  #releaseCapture(pointerId: number): void {
    try {
      this.element.releasePointerCapture?.(pointerId);
    } catch {
      // Pointer no longer active.
    }
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (this.#locked) {
      this.#onLockedButtons(event);
      return;
    }
    if (!this.filter(event)) return;

    const pointerType = event.pointerType as PointerType;

    if (this.#pointers.size === 0) {
      this.#updateArea(true);
      if (!this.#isInArea(event.clientX, event.clientY)) return;
      this.#pointerType = pointerType;
    } else if (pointerType !== this.#pointerType) {
      // Ignore mixed input, e.g. a mouse click during a touch gesture.
      return;
    }

    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic or already released pointer.
    }

    // A reused id replaces its stale entry.
    this.#pointers.delete(event.pointerId);
    this.#pointers.set(event.pointerId, [event.clientX, event.clientY]);
    this.#buttons = pointerType === "touch" ? 0 : event.buttons;
    this.#restart(event);
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#locked) {
      // A cancelled lock gesture resumes on the next movement.
      if (!this.#active || event.buttons !== this.#buttons) {
        this.#onLockedButtons(event);
      }
      this.#move(event, [event.movementX, event.movementY], 1, 0);
      return;
    }

    const pointer = this.#pointers.get(event.pointerId);
    if (!pointer) return;

    // Chorded buttons only fire pointermove.
    if (event.pointerType !== "touch" && event.buttons !== this.#buttons) {
      if (event.buttons === 0) {
        this.#onPointerUp(event);
        return;
      }
      pointer[0] = event.clientX;
      pointer[1] = event.clientY;
      this.#buttons = event.buttons;
      this.#restart(event);
      return;
    }

    const previousCentroid: Vec2 = [...this.#centroid];
    const previousSpread = this.#spread;
    const previousAngle = this.#angle;

    pointer[0] = event.clientX;
    pointer[1] = event.clientY;
    this.#measure();

    this.#move(
      event,
      [
        this.#centroid[0] - previousCentroid[0],
        this.#centroid[1] - previousCentroid[1],
      ],
      previousSpread > 0 && this.#spread > 0
        ? this.#spread / previousSpread
        : 1,
      this.#pointers.size >= 2
        ? normalizeAngle(this.#angle - previousAngle)
        : 0,
    );
  };

  #onPointerUp = (event: PointerEvent): void => {
    // The last button release fires pointerup, not a chorded pointermove.
    if (this.#locked) {
      if (event.type === "pointerup") this.#onLockedButtons(event);
      return;
    }
    if (!this.#pointers.delete(event.pointerId)) return;
    this.#releaseCapture(event.pointerId);

    if (this.#pointers.size) {
      this.#restart(event);
    } else {
      this.#buttons = 0;
      this.#end(event);
    }
  };

  // Also bubbles from descendants, e.g. a canvas losing its implicit touch
  // capture to setPointerCapture on the element.
  #onLostPointerCapture = (event: PointerEvent): void => {
    if (event.target === this.element) this.#onPointerUp(event);
  };

  #onLockedButtons(event: PointerEvent): void {
    this.#buttons = event.buttons;
    this.#restart(event);
  }

  #onPointerLockChange = (event: Event): void => {
    const locked =
      this.element.ownerDocument.pointerLockElement === this.element;
    if (locked === this.#locked) return;

    this.cancel();
    this.#locked = locked;

    if (!locked) {
      return;
    }

    this.#updateArea(true);
    this.#pointerType = "mouse";
    this.#buttons = 0;
    this.#start(event);
  };

  #onVisibilityChange = (): void => {
    if (this.element.ownerDocument.visibilityState === "hidden") this.cancel();
  };

  #onContextMenu = (event: Event): void => {
    if (this.preventContextMenu && this.filter(event)) event.preventDefault();
  };

  // Wheel
  #onWheel = (event: WheelEvent): void => {
    if (!this.filter(event)) return;
    this.#updateArea(this.#wheelStream.isNew(event));
    if (!this.#isInArea(event.clientX, event.clientY)) return;
    event.preventDefault();

    const located = this.#locate(event.clientX, event.clientY, event);
    const delta = normalizeDelta([0, 0], event, this.lineHeight, this.#area[3]);
    const device = this.#wheelStream.add(event);

    if (event.ctrlKey) {
      // Safari reports the same pinch through gesture events.
      if (this.#safariGesture) return;
      this.emit("pinch", {
        type: "pinch",
        ...located,
        scale: pinchScale(delta[1]),
        rotation: 0,
        originalEvent: event,
      });
      return;
    }

    this.emit("wheel", {
      type: "wheel",
      ...located,
      delta,
      deltaNormalized: this.#normalize(delta),
      device,
      originalEvent: event,
    });
  };

  // Safari also fires gesture events for touch pinches, already handled as pointers.
  #onGestureStart = (event: Event): void => {
    if (this.#pointers.size || !this.filter(event)) return;
    const { clientX, clientY } = event as GestureEvent;
    this.#updateArea(true);
    if (!this.#isInArea(clientX, clientY)) return;
    event.preventDefault();
    this.#safariGesture = { scale: 1, rotation: 0 };
  };

  #onGestureChange = (event: Event): void => {
    const previous = this.#safariGesture;
    if (!previous) return;
    event.preventDefault();

    const gesture = event as GestureEvent;
    this.#updateArea();
    this.emit("pinch", {
      type: "pinch",
      ...this.#locate(gesture.clientX, gesture.clientY, gesture),
      scale: gesture.scale / previous.scale,
      // Degrees, clockwise.
      rotation: (-(gesture.rotation - previous.rotation) * Math.PI) / 180,
      originalEvent: gesture,
    });
    previous.scale = gesture.scale;
    previous.rotation = gesture.rotation;
  };

  #onGestureEnd = (event: Event): void => {
    if (!this.#safariGesture) return;
    event.preventDefault();
    this.#safariGesture = null;
  };
}
