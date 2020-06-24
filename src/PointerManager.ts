import { vec2 } from "gl-matrix";
import normalizeWheel from "normalize-wheel";

import {
  PointerManagerOptions,
  PointerManagerState,
  PointerManagerEvent,
  PointerManagerConfig,
} from "./types.d.js";

const HAS_TOUCH_EVENTS = "TouchEvent" in window;
const EVENT_LISTENER_OPTIONS = {
  passive: false,
};
const VEC2_IDENTITY = vec2.create();
const tempElement = vec2.create();
const tempPointer = vec2.create();

export default class PointerManager {
  private static isTouchEvent(event: Event): boolean {
    return HAS_TOUCH_EVENTS && event instanceof TouchEvent;
  }

  private static BUTTONS = [
    PointerManagerState.MouseLeft,
    PointerManagerState.MouseMiddle,
    PointerManagerState.MouseRight,
  ];

  private static TOUCHES = [
    PointerManagerState.Idle,
    PointerManagerState.TouchOne,
    PointerManagerState.TouchTwo,
    PointerManagerState.TouchThree,
  ];

  public element: HTMLElement;
  public config: PointerManagerConfig;

  public onPointerUpdate: (event: PointerManagerEvent) => unknown;

  private state: PointerManagerState;
  private initialTouchDistance = 0;
  private initialPosition: vec2 = vec2.create();
  private lastPosition: vec2 = vec2.create();
  private movePosition: vec2 = vec2.create();
  private clientSize: vec2 = vec2.create();
  private isElementRoot: boolean;

  constructor(options: PointerManagerOptions) {
    Object.assign(this, options);

    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.handleDragging = this.handleDragging.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
  }

  public enable(): void {
    this.isElementRoot = this.element === document.body;

    if (this.config.wheel) {
      this.element.addEventListener(
        normalizeWheel.getEventType(),
        this.onMouseWheel
      );
    }

    if (this.config.drag) {
      this.element.addEventListener("mousedown", this.onMouseDown);
      this.element.addEventListener("touchstart", this.onTouchStart);
    }
  }

  public disable(): void {
    if (this.config.wheel) {
      this.element.removeEventListener("wheel", this.onMouseWheel);
    }

    if (this.config.drag) {
      this.element.removeEventListener("mousedown", this.onMouseDown);
      this.element.removeEventListener("touchstart", this.onTouchStart);
    }
  }

  // Compute position helpers
  private setClientSize(out: vec2): void {
    const element = this.isElementRoot
      ? document.documentElement
      : this.element;
    out[0] = element.clientWidth;
    out[1] = element.clientHeight;
  }

  private setTouchBaryCenter(out: vec2, event: TouchEvent): void {
    for (let i = 0; i < event.touches.length; i++) {
      out[0] += event.touches[i].clientX;
      out[1] += event.touches[i].clientY;
    }

    out[0] /= event.touches.length;
    out[1] /= event.touches.length;
  }

  private getPointerPosition(event: Event): vec2 {
    if (PointerManager.isTouchEvent(event)) {
      vec2.zero(tempPointer);
      this.setTouchBaryCenter(tempPointer, event as TouchEvent);
    } else {
      tempPointer[0] = (event as MouseEvent).clientX;
      tempPointer[1] = (event as MouseEvent).clientY;
    }
    return tempPointer;
  }

  private getElementPosition(): vec2 {
    return this.isElementRoot
      ? VEC2_IDENTITY
      : (() => {
          const { left, top } = this.element.getBoundingClientRect();
          tempElement[0] = left;
          tempElement[1] = top;
          return tempElement;
        })();
  }

  private setRelativePosition(out: vec2, event: Event): void {
    vec2.subtract(
      out,
      this.getPointerPosition(event),
      this.getElementPosition()
    );
  }

  // Dragging
  private initDragging(event: Event): void {
    this.setRelativePosition(this.initialPosition, event);
    this.setClientSize(this.clientSize);

    if (
      PointerManager.isTouchEvent(event) &&
      (event as TouchEvent).touches.length >= 2
    ) {
      const { clientX, clientY } = (event as TouchEvent).touches[1];

      // Get finger distance
      this.initialTouchDistance = vec2.distance(
        [clientX, clientY],
        this.initialPosition
      );

      // Set position to center
      vec2.set(
        this.lastPosition,
        ((event as TouchEvent).touches[0].clientX + clientX) * 0.5,
        ((event as TouchEvent).touches[0].clientY + clientY) * 0.5
      );
    } else {
      vec2.copy(this.lastPosition, this.initialPosition);
    }

    document.addEventListener("mousemove", this.handleDragging);
    document.addEventListener(
      "touchmove",
      this.handleDragging,
      EVENT_LISTENER_OPTIONS
    );
    document.addEventListener("mouseup", this.onPointerUp);
    document.addEventListener("touchend", this.onPointerUp);
  }

  private handleDragging(event: Event): void {
    event.preventDefault();

    this.setRelativePosition(this.movePosition, event);

    let dx = 0;
    let dy = 0;
    if (
      PointerManager.isTouchEvent(event) &&
      (event as TouchEvent).touches.length >= 2
    ) {
      dy =
        this.initialTouchDistance -
        vec2.distance(
          [
            (event as TouchEvent).touches[1].clientX,
            (event as TouchEvent).touches[1].clientY,
          ],
          this.movePosition
        );
    } else {
      dx = (this.movePosition[0] - this.lastPosition[0]) / this.clientSize[1];
      dy = (this.movePosition[1] - this.lastPosition[1]) / this.clientSize[1];
    }
    vec2.copy(this.lastPosition, this.movePosition);

    this.onPointerUpdate({
      state: this.state,
      dx,
      dy,
      originalEvent: event,
    });
  }

  // Event handlers
  private onMouseWheel(event: Event): void {
    this.state = PointerManagerState.MouseWheel;

    this.onPointerUpdate({
      state: this.state,
      // Try normalising with drag offset
      dx: normalizeWheel(event).pixelX / 100,
      dy: normalizeWheel(event).pixelY / 100,
    });
  }

  private onMouseDown(event: MouseEvent): void {
    const prevState = this.state;

    this.state = PointerManager.BUTTONS[event.button];

    if (prevState !== this.state) this.initDragging(event);
  }

  private onTouchStart(event: TouchEvent): void {
    event.preventDefault();

    const prevState = this.state;

    this.state = PointerManager.TOUCHES[event.touches.length];

    if (prevState !== this.state) this.initDragging(event);
  }

  private onPointerUp(): void {
    this.state = PointerManagerState.Idle;

    document.removeEventListener("mousemove", this.handleDragging);
    document.removeEventListener(
      "touchmove",
      this.handleDragging,
      EVENT_LISTENER_OPTIONS as AddEventListenerOptions
    );
    document.removeEventListener("mouseup", this.onPointerUp);
    document.removeEventListener("touchend", this.onPointerUp);
  }
}
