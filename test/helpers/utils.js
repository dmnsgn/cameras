import assert from "node:assert/strict";

import { KeyboardManager } from "../../lib/input/index.js";
import { createEvent } from "./fake-element.js";

export const close = (actual, expected, epsilon = 1e-6, label = "") =>
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${label} expected ${expected}, got ${actual}`,
  );

export const closeVec = (actual, expected, epsilon = 1e-6) =>
  expected.forEach((value, i) => close(actual[i], value, epsilon, `[${i}]`));

export const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/**
 * Update until rest.
 * @returns Frames until rest, Infinity if it never rests.
 */
export const settle = (source, dt = 1 / 60, frames = 5000) => {
  for (let i = 0; i < frames; i++) if (!source.update(dt)) return i;
  return Infinity;
};

// Whole frames only, so different rates cover the same duration.
export const run = (source, seconds, hz = 60) => {
  for (let i = 0; i < Math.round(seconds * hz); i++) source.update(1 / hz);
};

/**
 * Pointer gesture with defaults, for driving `applyAction` directly.
 */
export const gesture = (props) => ({
  type: "move",
  pointerType: "mouse",
  pointerCount: 1,
  buttons: 1,
  delta: [0, 0],
  deltaNormalized: [0, 0],
  scale: 1,
  rotation: 0,
  velocity: [0, 0],
  velocityNormalized: [0, 0],
  locked: false,
  position: [0, 0],
  ndc: [0, 0],
  aspect: 1,
  modifiers: { shift: false, ctrl: false, alt: false, meta: false },
  timeStamp: 0,
  ...props,
});

export const wheelGesture = (props) =>
  gesture({ type: "wheel", device: "mouse", ...props });

export const pinchGesture = (props) =>
  gesture({ type: "pinch", scale: 1, rotation: 0, ...props });

// Camera axes from an orientation quaternion.
export const forward = ([x, y, z, w]) => [
  -2 * (x * z + w * y),
  -2 * (y * z - w * x),
  -(1 - 2 * (x * x + y * y)),
];
export const upOf = ([x, y, z, w]) => [
  2 * (x * y - w * z),
  1 - 2 * (x * x + z * z),
  2 * (y * z + w * x),
];
export const rightOf = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z),
  2 * (x * y + w * z),
  2 * (x * z - w * y),
];

/**
 * NDC of a world point through a camera.
 */
export const project = (camera, [x, y, z]) => {
  const view = camera.viewMatrix;
  const v = [0, 1, 2, 3].map(
    (i) => view[i] * x + view[i + 4] * y + view[i + 8] * z + view[i + 12],
  );
  const p = camera.projectionMatrix;
  const clip = [0, 1, 2, 3].map(
    (i) => p[i] * v[0] + p[i + 4] * v[1] + p[i + 8] * v[2] + p[i + 12] * v[3],
  );
  return [clip[0] / clip[3], clip[1] / clip[3]];
};

export const applyTo = (controls, camera) => {
  controls.applyTo(camera);
  camera.updateProjectionMatrix();
  camera.update();
  return camera;
};

/**
 * Attach a keyboard to controls and press or release codes on it.
 */
export const keyboardFor = (controls) => {
  const target = new EventTarget();
  const keyboard = new KeyboardManager(target).enable();
  controls.attach(null, keyboard);
  const dispatch = (type, codes) => {
    for (const code of codes) {
      target.dispatchEvent(
        createEvent(type, { code, key: code, repeat: false }),
      );
    }
  };
  return {
    keyboard,
    target,
    press: (...codes) => dispatch("keydown", codes),
    release: (...codes) => dispatch("keyup", codes),
  };
};

/**
 * Record gestures emitted by a PointerManager.
 */
export const record = (manager) => {
  const events = [];
  for (const type of ["start", "move", "end", "wheel", "pinch"]) {
    manager.on(type, (event) => events.push(event));
  }
  return events;
};

export const types = (events) => events.map(({ type }) => type).join(",");

/**
 * Record emitted event types.
 */
export const listen = (emitter, eventTypes) => {
  const events = [];
  for (const type of eventTypes) emitter.on(type, () => events.push(type));
  return events;
};
