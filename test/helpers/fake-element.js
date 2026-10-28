// Minimal DOM element stand-in for driving the input layer from node:test.
class FakeStyle {
  #values = new Map();

  getPropertyValue(property) {
    return this.#values.get(property) ?? "";
  }

  setProperty(property, value) {
    this.#values.set(property, value);
  }

  removeProperty(property) {
    this.#values.delete(property);
  }
}

export default class FakeElement extends EventTarget {
  constructor({ left = 0, top = 0, width = 800, height = 600 } = {}) {
    super();
    this.rect = { left, top, width, height, x: left, y: top };
    this.style = new FakeStyle();
    this.capturedPointers = new Set();

    // Doubles as its own document.
    this.pointerLockElement = null;
    this.visibilityState = "visible";
  }

  get clientWidth() {
    return this.rect.width;
  }

  get clientHeight() {
    return this.rect.height;
  }

  get ownerDocument() {
    return this;
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  requestPointerLock() {
    this.pointerLockElement = this;
    this.dispatchEvent(new Event("pointerlockchange"));
    return Promise.resolve();
  }

  exitPointerLock() {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event("pointerlockchange"));
  }

  // Tracks live listeners so tests can assert leak-free teardown. Node's
  // EventTarget calls removeEventListener on abort, browsers don't: removal is idempotent.
  #listeners = new Set();

  get listenerCount() {
    return this.#listeners.size;
  }

  #key(type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    return [...this.#listeners].find(
      (entry) =>
        entry.type === type &&
        entry.listener === listener &&
        entry.capture === capture,
    );
  }

  addEventListener(type, listener, options) {
    if (!this.#key(type, listener, options)) {
      const entry = {
        type,
        listener,
        capture: typeof options === "boolean" ? options : !!options?.capture,
      };
      this.#listeners.add(entry);
      options?.signal?.addEventListener(
        "abort",
        () => this.#listeners.delete(entry),
        { once: true },
      );
    }
    super.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    this.#listeners.delete(this.#key(type, listener, options));
    super.removeEventListener(type, listener, options);
  }
}

let time = 0;

/**
 * Create a DOM-like event with a controllable timeStamp (ms).
 */
export function createEvent(type, props = {}, timeStamp = (time += 16)) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return Object.assign(event, {
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...props,
  });
}
