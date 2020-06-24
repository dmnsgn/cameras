function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

import { vec2 } from "gl-matrix";
import normalizeWheel from "normalize-wheel";
import { PointerManagerState } from "./types.d.js";
const HAS_TOUCH_EVENTS = ("TouchEvent" in window);
const EVENT_LISTENER_OPTIONS = {
  passive: false
};
const VEC2_IDENTITY = vec2.create();
const tempElement = vec2.create();
const tempPointer = vec2.create();
export default class PointerManager {
  static isTouchEvent(event) {
    return HAS_TOUCH_EVENTS && event instanceof TouchEvent;
  }

  constructor(options) {
    _defineProperty(this, "element", void 0);

    _defineProperty(this, "config", void 0);

    _defineProperty(this, "onPointerUpdate", void 0);

    _defineProperty(this, "state", void 0);

    _defineProperty(this, "initialTouchDistance", 0);

    _defineProperty(this, "initialPosition", vec2.create());

    _defineProperty(this, "lastPosition", vec2.create());

    _defineProperty(this, "movePosition", vec2.create());

    _defineProperty(this, "clientSize", vec2.create());

    _defineProperty(this, "isElementRoot", void 0);

    Object.assign(this, options);
    this.onMouseWheel = this.onMouseWheel.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.handleDragging = this.handleDragging.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
  }

  enable() {
    this.isElementRoot = this.element === document.body;

    if (this.config.wheel) {
      this.element.addEventListener(normalizeWheel.getEventType(), this.onMouseWheel);
    }

    if (this.config.drag) {
      this.element.addEventListener("mousedown", this.onMouseDown);
      this.element.addEventListener("touchstart", this.onTouchStart);
    }
  }

  disable() {
    if (this.config.wheel) {
      this.element.removeEventListener("wheel", this.onMouseWheel);
    }

    if (this.config.drag) {
      this.element.removeEventListener("mousedown", this.onMouseDown);
      this.element.removeEventListener("touchstart", this.onTouchStart);
    }
  } // Compute position helpers


  setClientSize(out) {
    const element = this.isElementRoot ? document.documentElement : this.element;
    out[0] = element.clientWidth;
    out[1] = element.clientHeight;
  }

  setTouchBaryCenter(out, event) {
    for (let i = 0; i < event.touches.length; i++) {
      out[0] += event.touches[i].clientX;
      out[1] += event.touches[i].clientY;
    }

    out[0] /= event.touches.length;
    out[1] /= event.touches.length;
  }

  getPointerPosition(event) {
    if (PointerManager.isTouchEvent(event)) {
      vec2.zero(tempPointer);
      this.setTouchBaryCenter(tempPointer, event);
    } else {
      tempPointer[0] = event.clientX;
      tempPointer[1] = event.clientY;
    }

    return tempPointer;
  }

  getElementPosition() {
    return this.isElementRoot ? VEC2_IDENTITY : (() => {
      const {
        left,
        top
      } = this.element.getBoundingClientRect();
      tempElement[0] = left;
      tempElement[1] = top;
      return tempElement;
    })();
  }

  setRelativePosition(out, event) {
    vec2.subtract(out, this.getPointerPosition(event), this.getElementPosition());
  } // Dragging


  initDragging(event) {
    this.setRelativePosition(this.initialPosition, event);
    this.setClientSize(this.clientSize);

    if (PointerManager.isTouchEvent(event) && event.touches.length >= 2) {
      const {
        clientX,
        clientY
      } = event.touches[1]; // Get finger distance

      this.initialTouchDistance = vec2.distance([clientX, clientY], this.initialPosition); // Set position to center

      vec2.set(this.lastPosition, (event.touches[0].clientX + clientX) * 0.5, (event.touches[0].clientY + clientY) * 0.5);
    } else {
      vec2.copy(this.lastPosition, this.initialPosition);
    }

    document.addEventListener("mousemove", this.handleDragging);
    document.addEventListener("touchmove", this.handleDragging, EVENT_LISTENER_OPTIONS);
    document.addEventListener("mouseup", this.onPointerUp);
    document.addEventListener("touchend", this.onPointerUp);
  }

  handleDragging(event) {
    event.preventDefault();
    this.setRelativePosition(this.movePosition, event);
    let dx = 0;
    let dy = 0;

    if (PointerManager.isTouchEvent(event) && event.touches.length >= 2) {
      dy = this.initialTouchDistance - vec2.distance([event.touches[1].clientX, event.touches[1].clientY], this.movePosition);
    } else {
      dx = (this.movePosition[0] - this.lastPosition[0]) / this.clientSize[1];
      dy = (this.movePosition[1] - this.lastPosition[1]) / this.clientSize[1];
    }

    vec2.copy(this.lastPosition, this.movePosition);
    this.onPointerUpdate({
      state: this.state,
      dx,
      dy,
      originalEvent: event
    });
  } // Event handlers


  onMouseWheel(event) {
    this.state = PointerManagerState.MouseWheel;
    this.onPointerUpdate({
      state: this.state,
      // Try normalising with drag offset
      dx: normalizeWheel(event).pixelX / 100,
      dy: normalizeWheel(event).pixelY / 100
    });
  }

  onMouseDown(event) {
    const prevState = this.state;
    this.state = PointerManager.BUTTONS[event.button];
    if (prevState !== this.state) this.initDragging(event);
  }

  onTouchStart(event) {
    event.preventDefault();
    const prevState = this.state;
    this.state = PointerManager.TOUCHES[event.touches.length];
    if (prevState !== this.state) this.initDragging(event);
  }

  onPointerUp() {
    this.state = PointerManagerState.Idle;
    document.removeEventListener("mousemove", this.handleDragging);
    document.removeEventListener("touchmove", this.handleDragging, EVENT_LISTENER_OPTIONS);
    document.removeEventListener("mouseup", this.onPointerUp);
    document.removeEventListener("touchend", this.onPointerUp);
  }

}

_defineProperty(PointerManager, "BUTTONS", [PointerManagerState.MouseLeft, PointerManagerState.MouseMiddle, PointerManagerState.MouseRight]);

_defineProperty(PointerManager, "TOUCHES", [PointerManagerState.Idle, PointerManagerState.TouchOne, PointerManagerState.TouchTwo, PointerManagerState.TouchThree]);