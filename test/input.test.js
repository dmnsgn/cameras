import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  PointerManager,
  KeyboardManager,
  MouseButton,
  pointers,
  modifiers,
  wheel,
} from "../lib/input/index.js";
import FakeElement, { createEvent } from "./helpers/fake-element.js";
import { record, types, close as closeTo } from "./helpers/utils.js";

const pointer = (type, pointerId, clientX, clientY, props = {}, timeStamp) =>
  createEvent(
    type,
    {
      pointerId,
      pointerType: "touch",
      clientX,
      clientY,
      buttons: 0,
      ...props,
    },
    timeStamp,
  );

const close = (actual, expected, epsilon = 1e-9) =>
  closeTo(actual, expected, epsilon);

const mouse = (type, clientX, clientY, props = {}, timeStamp) =>
  pointer(
    type,
    1,
    clientX,
    clientY,
    { pointerType: "mouse", buttons: 1, ...props },
    timeStamp,
  );

const wheelEvent = (props = {}, timeStamp) =>
  createEvent(
    "wheel",
    {
      clientX: 500,
      clientY: 250,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ...props,
    },
    timeStamp,
  );

const safari = (type, scale = 1, rotation = 0) =>
  createEvent(type, { scale, rotation, clientX: 500, clientY: 250 });

// Element 800×400 at (100, 50), the default for PointerManager tests.
const setup = (
  options,
  rect = { left: 100, top: 50, width: 800, height: 400 },
) => {
  const element = new FakeElement(rect);
  const manager = new PointerManager(element, options).enable();
  return { element, manager, events: record(manager) };
};

describe("PointerManager", () => {
  let element;
  let manager;
  let events;

  beforeEach(() => {
    element = new FakeElement({ left: 100, top: 50, width: 800, height: 400 });
    manager = new PointerManager(element).enable();
    events = record(manager);
  });

  test("mouse drag emits start, move, end with element relative deltas", () => {
    const mouse = { pointerType: "mouse", buttons: MouseButton.Primary };
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250, mouse));
    element.dispatchEvent(pointer("pointermove", 1, 540, 230, mouse));
    element.dispatchEvent(
      pointer("pointerup", 1, 540, 230, { pointerType: "mouse" }),
    );

    assert.equal(types(events), "start,move,end");
    const [start, move] = events;
    assert.deepEqual(start.position, [400, 200]);
    assert.deepEqual(start.ndc, [0, 0]);
    assert.deepEqual(move.delta, [40, -20]);
    assert.deepEqual(move.deltaNormalized, [0.1, -0.05]);
    assert.equal(move.buttons, MouseButton.Primary);
    assert.ok(element.capturedPointers.size === 0);
  });

  test("pinch scale is a per-event ratio, not cumulative", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 450, 250));
    element.dispatchEvent(pointer("pointerdown", 2, 550, 250));
    events.length = 0;

    // Spread grows by 10% per event, symmetrically.
    let half = 50;
    for (let i = 0; i < 4; i++) {
      half *= 1.1;
      element.dispatchEvent(pointer("pointermove", 1, 500 - half, 250));
      element.dispatchEvent(pointer("pointermove", 2, 500 + half, 250));
    }

    const moves = events.filter(({ type }) => type === "move");
    const total = moves.reduce((product, { scale }) => product * scale, 1);
    close(total, 1.1 ** 4, 1e-9);
    // Pairs of single-finger moves: the product of each pair is 1.1.
    for (let i = 0; i < moves.length; i += 2) {
      close(moves[i].scale * moves[i + 1].scale, 1.1, 1e-9);
    }
  });

  test("two finger twist reports counter-clockwise rotation", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 400, 250));
    element.dispatchEvent(pointer("pointerdown", 2, 600, 250));
    events.length = 0;
    // Finger 2 moves up on screen: counter-clockwise.
    element.dispatchEvent(pointer("pointermove", 2, 600, 150));
    assert.ok(events[0].rotation > 0);
    close(events[0].rotation, Math.atan2(100, 200));
  });

  test("lifting one of two fingers restarts without a delta jump", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 400, 250));
    element.dispatchEvent(pointer("pointerdown", 2, 600, 250));
    events.length = 0;

    element.dispatchEvent(pointer("pointerup", 2, 600, 250));
    element.dispatchEvent(pointer("pointermove", 1, 410, 250));

    assert.equal(types(events), "end,start,move");
    assert.equal(events[1].pointerCount, 1);
    assert.deepEqual(events[2].delta, [10, 0]);
  });

  test("start and end stay balanced through finger transitions", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 400, 250));
    element.dispatchEvent(pointer("pointerdown", 2, 500, 250));
    element.dispatchEvent(pointer("pointerdown", 3, 600, 250));
    element.dispatchEvent(pointer("pointerup", 1, 400, 250));
    element.dispatchEvent(pointer("pointerup", 3, 600, 250));
    element.dispatchEvent(pointer("pointerup", 2, 500, 250));

    const starts = events.filter(({ type }) => type === "start").length;
    const ends = events.filter(({ type }) => type === "end").length;
    assert.equal(starts, ends);
    assert.equal(manager.active, false);
  });

  test("chorded mouse buttons restart with the new buttons", () => {
    const mouse = { pointerType: "mouse" };
    element.dispatchEvent(
      pointer("pointerdown", 1, 500, 250, { ...mouse, buttons: 1 }),
    );
    element.dispatchEvent(
      pointer("pointermove", 1, 500, 250, { ...mouse, buttons: 3 }),
    );
    element.dispatchEvent(
      pointer("pointermove", 1, 500, 250, { ...mouse, buttons: 2 }),
    );
    element.dispatchEvent(
      pointer("pointermove", 1, 500, 250, { ...mouse, buttons: 0 }),
    );

    assert.equal(types(events), "start,end,start,end,start,end");
    assert.deepEqual(
      events.filter(({ type }) => type === "start").map((e) => e.buttons),
      [1, 3, 2],
    );
  });

  test("back and forward buttons are reported", () => {
    element.dispatchEvent(
      pointer("pointerdown", 1, 500, 250, {
        pointerType: "mouse",
        buttons: MouseButton.Back,
      }),
    );
    assert.equal(events[0].buttons, MouseButton.Back);
  });

  test("pointercancel ends the gesture", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    element.dispatchEvent(pointer("pointercancel", 1, 500, 250));
    assert.equal(types(events), "start,end");
    assert.equal(manager.active, false);
  });

  test("lostpointercapture after pointerup is ignored", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    element.dispatchEvent(pointer("pointerup", 1, 500, 250));
    element.dispatchEvent(pointer("lostpointercapture", 1, 500, 250));
    assert.equal(types(events), "start,end");
  });

  test("lostpointercapture bubbling from a descendant is ignored", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    // A canvas child losing its implicit touch capture to the element.
    const lost = pointer("lostpointercapture", 1, 500, 250);
    Object.defineProperty(lost, "target", { value: new EventTarget() });
    element.dispatchEvent(lost);
    assert.equal(manager.active, true);

    element.dispatchEvent(pointer("lostpointercapture", 1, 500, 250));
    assert.equal(types(events), "start,end");
  });

  test("mixed pointer types are ignored during a gesture", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    element.dispatchEvent(
      pointer("pointerdown", 2, 500, 250, { pointerType: "mouse", buttons: 1 }),
    );
    assert.equal(types(events), "start");
  });

  test("velocity is zero when the pointer rests before release", () => {
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250, {}, 1000));
    element.dispatchEvent(pointer("pointermove", 1, 520, 250, {}, 1016));
    element.dispatchEvent(pointer("pointermove", 1, 540, 250, {}, 1032));
    element.dispatchEvent(pointer("pointerup", 1, 540, 250, {}, 1048));
    assert.ok(events.at(-1).velocity[0] > 0);

    events.length = 0;
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250, {}, 2000));
    element.dispatchEvent(pointer("pointermove", 1, 520, 250, {}, 2016));
    element.dispatchEvent(pointer("pointerup", 1, 520, 250, {}, 2500));
    assert.deepEqual(events.at(-1).velocity, [0, 0]);
  });

  test("interactive area filters and remaps", () => {
    manager.interactiveArea = [0.5, 0, 0.5, 1];
    element.dispatchEvent(pointer("pointerdown", 1, 200, 250));
    assert.equal(events.length, 0);

    element.dispatchEvent(pointer("pointerdown", 2, 700, 250));
    assert.deepEqual(events[0].ndc, [0, 0]);
  });

  test("ctrlKey wheel is a pinch and prevents page zoom", () => {
    const event = createEvent("wheel", {
      clientX: 500,
      clientY: 250,
      deltaX: 0,
      deltaY: 10,
      deltaMode: 0,
      ctrlKey: true,
    });
    element.dispatchEvent(event);
    assert.equal(types(events), "pinch");
    assert.ok(events[0].scale < 1);
    assert.ok(event.defaultPrevented);
  });

  test("wheel normalizes line mode and classifies the device", () => {
    element.dispatchEvent(
      createEvent("wheel", {
        clientX: 500,
        clientY: 250,
        deltaX: 0,
        deltaY: 3,
        deltaMode: 1,
      }),
    );
    close(events[0].delta[1], 100);
    assert.equal(events[0].device, "mouse");
  });

  test("Safari gesture events become pinches, but not during touches", () => {
    const gesture = (type, scale, rotation) =>
      createEvent(type, { scale, rotation, clientX: 500, clientY: 250 });

    element.dispatchEvent(gesture("gesturestart", 1, 0));
    element.dispatchEvent(gesture("gesturechange", 1.2, 10));
    element.dispatchEvent(gesture("gesturechange", 1.44, 10));
    element.dispatchEvent(gesture("gestureend", 1.44, 10));
    const pinches = events.filter(({ type }) => type === "pinch");
    close(pinches[0].scale, 1.2);
    close(pinches[1].scale, 1.2);
    close(pinches[0].rotation, (-10 * Math.PI) / 180);

    events.length = 0;
    element.dispatchEvent(pointer("pointerdown", 1, 450, 250));
    element.dispatchEvent(pointer("pointerdown", 2, 550, 250));
    element.dispatchEvent(gesture("gesturestart", 1, 0));
    element.dispatchEvent(gesture("gesturechange", 2, 0));
    assert.equal(events.filter(({ type }) => type === "pinch").length, 0);
  });

  test("pointer lock reports movement deltas without buttons", async () => {
    await manager.requestPointerLock();
    element.dispatchEvent(
      pointer("pointermove", 1, 0, 0, {
        pointerType: "mouse",
        movementX: 5,
        movementY: -3,
      }),
    );
    manager.exitPointerLock();

    assert.equal(types(events), "start,move,end");
    assert.equal(events[1].locked, true);
    assert.deepEqual(events[1].delta, [5, -3]);
  });

  test("disable mid-drag ends the gesture and removes every listener", () => {
    element.style.setProperty("touch-action", "pan-y");
    const disabled = new PointerManager(element);
    disabled.enable();
    const disabledEvents = record(disabled);

    element.dispatchEvent(pointer("pointerdown", 9, 500, 250));
    manager.dispose();
    disabled.disable();

    assert.equal(types(disabledEvents), "start,end");
    assert.equal(element.listenerCount, 0);
    // Restores the style found when enabled.
    assert.equal(element.style.getPropertyValue("touch-action"), "pan-y");
    element.dispatchEvent(pointer("pointermove", 9, 600, 250));
    assert.equal(types(disabledEvents), "start,end");
  });
});

describe("wheel", () => {
  test("classifyDevice is conservative", () => {
    const event = (deltaY, props = {}) => ({
      deltaX: 0,
      deltaY,
      deltaMode: 0,
      shiftKey: false,
      ...props,
    });
    assert.equal(wheel.classifyDevice(event(3, { deltaMode: 1 })), "mouse");
    assert.equal(wheel.classifyDevice(event(4, { deltaX: 2 })), "trackpad");
    assert.equal(
      wheel.classifyDevice(event(0, { deltaX: 100, shiftKey: true })),
      "unknown",
    );
    assert.equal(wheel.classifyDevice(event(100), 100), "mouse");
    assert.equal(wheel.classifyDevice(event(100)), "unknown");
  });

  test("pinchScale is symmetric and clamped", () => {
    close(wheel.pinchScale(10) * wheel.pinchScale(-10), 1);
    close(wheel.pinchScale(1000), wheel.pinchScale(wheel.MAX_PINCH_DELTA));
  });
});

// Keyboard event as dispatched from origin, e.g. a focused control.
const from = (event, origin) =>
  Object.defineProperty(event, "composedPath", { value: () => [origin] });

// Element matching simple `tag`, `[attribute]` and `tag[attribute]` selectors.
const control = (tag, attributes = [], props = {}) => ({
  ...props,
  matches: (selectors) =>
    selectors.split(", ").some((selector) => {
      const [, name, attribute] = selector.match(/^(\w*)(?:\[(\w+)\])?$/);
      return (
        (!name || name === tag) &&
        (!attribute || attributes.includes(attribute))
      );
    }),
});

describe("KeyboardManager", () => {
  const key = (type, code, props = {}) =>
    createEvent(type, { code, key: code, repeat: false, ...props });

  test("tracks pressed codes and axes", () => {
    const target = new EventTarget();
    const keyboard = new KeyboardManager(target).enable();
    target.dispatchEvent(key("keydown", "KeyW"));
    assert.equal(keyboard.axis("KeyS", ["KeyW", "ArrowUp"]), 1);
    target.dispatchEvent(key("keydown", "KeyS"));
    assert.equal(keyboard.axis("KeyS", "KeyW"), 0);
    target.dispatchEvent(key("keyup", "KeyW"));
    assert.equal(keyboard.axis("KeyS", "KeyW"), -1);
  });

  test("window blur releases every key", () => {
    const target = new EventTarget();
    target.window = target;
    const keyboard = new KeyboardManager(target).enable();
    const ups = [];
    keyboard.on("up", ({ code }) => ups.push(code));

    target.dispatchEvent(key("keydown", "KeyA"));
    target.dispatchEvent(key("keydown", "KeyD"));
    target.dispatchEvent(new Event("blur"));
    assert.deepEqual(ups, ["KeyA", "KeyD"]);
    assert.equal(keyboard.pressed.size, 0);
  });

  test("ignores typing in form fields", () => {
    const target = new EventTarget();
    const keyboard = new KeyboardManager(target).enable();
    target.dispatchEvent(from(key("keydown", "KeyW"), control("input")));
    assert.equal(keyboard.pressed.size, 0);
  });

  test("prevents default only for configured codes", () => {
    const target = new EventTarget();
    new KeyboardManager(target, { preventDefault: ["Space"] }).enable();
    const space = key("keydown", "Space");
    const enter = key("keydown", "Enter");
    target.dispatchEvent(space);
    target.dispatchEvent(enter);
    assert.equal(space.defaultPrevented, true);
    assert.equal(enter.defaultPrevented, false);
  });
});

describe("PointerManager lifecycle", () => {
  test("enabled getter, idempotent enable and disable", () => {
    const element = new FakeElement();
    const manager = new PointerManager(element);
    assert.equal(manager.enabled, false);
    assert.equal(manager.disable(), manager);
    manager.enable();
    const count = element.listenerCount;
    assert.equal(manager.enable(), manager);
    assert.equal(element.listenerCount, count);
    assert.equal(manager.enabled, true);
    manager.disable();
    assert.equal(manager.enabled, false);
    assert.equal(element.listenerCount, 0);
    manager.dispose();
  });

  test("styles without a previous value are removed", () => {
    const element = new FakeElement();
    const manager = new PointerManager(element).enable();
    assert.equal(element.style.getPropertyValue("touch-action"), "none");
    assert.equal(element.style.getPropertyValue("user-select"), "none");
    manager.disable();
    assert.equal(element.style.getPropertyValue("touch-action"), "");
    assert.equal(element.style.getPropertyValue("user-select"), "");
  });

  test("styles option replaces the defaults", () => {
    const element = new FakeElement();
    element.style.setProperty("cursor", "pointer");
    const manager = new PointerManager(element, {
      styles: { "touch-action": "none", cursor: "grab" },
    }).enable();
    assert.equal(element.style.getPropertyValue("cursor"), "grab");
    assert.equal(element.style.getPropertyValue("user-select"), "");
    manager.disable();
    assert.equal(element.style.getPropertyValue("cursor"), "pointer");
    assert.equal(element.style.getPropertyValue("touch-action"), "");

    new PointerManager(element, { styles: {} }).enable();
    assert.equal(element.style.getPropertyValue("touch-action"), "");
  });

  test("events from descendants are left to them by default", () => {
    const { element, events } = setup();
    const fromChild = (event) =>
      Object.defineProperty(event, "target", { value: new EventTarget() });
    const contextmenu = fromChild(createEvent("contextmenu"));
    const wheel = fromChild(wheelEvent({ deltaY: 10 }));
    const gesturestart = fromChild(safari("gesturestart"));
    element.dispatchEvent(fromChild(mouse("pointerdown", 500, 250)));
    element.dispatchEvent(contextmenu);
    element.dispatchEvent(wheel);
    element.dispatchEvent(gesturestart);
    element.dispatchEvent(safari("gesturechange", 2));
    assert.deepEqual(events, []);
    assert.equal(contextmenu.defaultPrevented, false);
    assert.equal(wheel.defaultPrevented, false);
    assert.equal(gesturestart.defaultPrevented, false);
  });

  test("filter option accepts descendants", () => {
    const { element, events } = setup({ filter: () => true });
    const down = mouse("pointerdown", 500, 250);
    Object.defineProperty(down, "target", { value: new EventTarget() });
    element.dispatchEvent(down);
    assert.equal(types(events), "start");
  });

  test("options: undefined keeps defaults, the area is copied", () => {
    const interactiveArea = [0, 0, 0.5, 1];
    const manager = new PointerManager(new FakeElement(), {
      wheel: undefined,
      interactiveArea,
      lineHeight: 20,
    });
    assert.equal(manager.wheel, true);
    assert.equal(manager.lineHeight, 20);
    assert.deepEqual(manager.interactiveArea, interactiveArea);
    assert.notEqual(manager.interactiveArea, interactiveArea);
  });

  test("line height option scales line mode wheels", () => {
    const { element, events } = setup({ lineHeight: 20 });
    element.dispatchEvent(wheelEvent({ deltaY: 3, deltaMode: 1 }));
    close(events[0].delta[1], 60);
  });

  test("without wheel, no wheel or gesture listeners", () => {
    const { element, events } = setup({ wheel: false });
    const event = wheelEvent({ deltaY: 10 });
    element.dispatchEvent(event);
    element.dispatchEvent(safari("gesturestart"));
    element.dispatchEvent(safari("gesturechange", 2));
    assert.deepEqual(events, []);
    assert.equal(event.defaultPrevented, false);
  });

  test("context menu is suppressed only when asked", () => {
    for (const preventContextMenu of [true, false]) {
      const { element } = setup({ preventContextMenu });
      const event = createEvent("contextmenu");
      element.dispatchEvent(event);
      assert.equal(event.defaultPrevented, preventContextMenu);
    }
  });

  test("a hidden page cancels without fling, a visible one doesn't", () => {
    const { element, manager, events } = setup();
    element.dispatchEvent(mouse("pointerdown", 400, 250, {}, 1000));
    element.dispatchEvent(mouse("pointermove", 450, 250, {}, 1010));
    element.dispatchEvent(new Event("visibilitychange"));
    assert.equal(manager.active, true);
    element.visibilityState = "hidden";
    element.dispatchEvent(new Event("visibilitychange"));
    assert.equal(manager.active, false);
    assert.equal(types(events), "start,move,end");
    assert.deepEqual(events[2].velocity, [0, 0]);
    // The pointer is forgotten.
    element.dispatchEvent(mouse("pointermove", 500, 250, {}, 1020));
    assert.equal(events.length, 3);
  });

  test("window blur cancels", () => {
    const element = new FakeElement();
    element.defaultView = new EventTarget();
    const manager = new PointerManager(element).enable();
    const events = record(manager);
    element.dispatchEvent(mouse("pointerdown", 400, 250));
    element.defaultView.dispatchEvent(new Event("blur"));
    assert.equal(types(events), "start,end");
    manager.disable();
    assert.equal(element.listenerCount, 0);
  });

  test("cancel while idle emits nothing", () => {
    const { manager, events } = setup();
    manager.cancel();
    assert.deepEqual(events, []);
  });

  test("dispose removes gesture listeners", () => {
    const { element, manager, events } = setup();
    manager.dispose();
    manager.enable();
    element.dispatchEvent(mouse("pointerdown", 400, 250));
    assert.deepEqual(events, []);
  });
});

describe("PointerManager pointers", () => {
  test("press outside the interactive area is ignored, edges are inside", () => {
    const { element, events } = setup({ interactiveArea: [0.5, 0, 0.5, 1] });
    element.dispatchEvent(mouse("pointerdown", 400, 250));
    assert.deepEqual(events, []);
    element.dispatchEvent(mouse("pointerdown", 500, 50));
    assert.equal(types(events), "start");
    assert.deepEqual(events[0].ndc, [-1, 1]);
    assert.deepEqual(events[0].position, [0, 0]);
  });

  test("NDC is y up over the area", () => {
    const { element, events } = setup();
    element.dispatchEvent(mouse("pointerdown", 500, 250));
    assert.deepEqual(events[0].ndc, [0, 0]);
    element.dispatchEvent(mouse("pointermove", 900, 450));
    assert.deepEqual(events[1].ndc, [1, -1]);
    assert.deepEqual(events[1].position, [800, 400]);
    assert.deepEqual(events[1].delta, [400, 200]);
    assert.deepEqual(events[1].deltaNormalized, [1, 0.5]);
    assert.equal(events[1].aspect, 2);
  });

  test("moves and releases of unknown pointers are ignored", () => {
    const { element, events } = setup();
    element.dispatchEvent(mouse("pointermove", 500, 250));
    element.dispatchEvent(mouse("pointerup", 500, 250, { buttons: 0 }));
    assert.deepEqual(events, []);
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    element.dispatchEvent(pointer("pointermove", 2, 600, 250));
    assert.equal(types(events), "start");
  });

  test("a reused pointer id replaces its stale entry", () => {
    const { element, events } = setup();
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    element.dispatchEvent(pointer("pointerdown", 1, 600, 250));
    assert.equal(types(events), "start,end,start");
    assert.equal(events[2].pointerCount, 1);
    assert.deepEqual(events[2].position, [500, 200]);
  });

  test("pen pointers report their buttons", () => {
    const { element, events } = setup();
    element.dispatchEvent(
      pointer("pointerdown", 3, 500, 250, {
        pointerType: "pen",
        buttons: MouseButton.Eraser,
      }),
    );
    assert.equal(events[0].pointerType, "pen");
    assert.equal(events[0].buttons, MouseButton.Eraser);
    // A mouse press during a pen gesture is ignored.
    element.dispatchEvent(mouse("pointerdown", 500, 250));
    assert.equal(events.length, 1);
  });

  test("touch gestures have no buttons and count up to any fingers", () => {
    const { element, events } = setup();
    for (let id = 1; id <= 4; id++) {
      element.dispatchEvent(
        pointer("pointerdown", id, 400 + id * 10, 250, { buttons: 1 }),
      );
    }
    const starts = events.filter(({ type }) => type === "start");
    assert.deepEqual(
      starts.map(({ pointerCount }) => pointerCount),
      [1, 2, 3, 4],
    );
    assert.ok(starts.every(({ buttons }) => buttons === 0));
    // Lifting every finger: balanced, ending with zero pointers.
    for (let id = 1; id <= 4; id++) {
      element.dispatchEvent(pointer("pointerup", id, 400 + id * 10, 250));
    }
    const count = (type) => events.filter((event) => event.type === type);
    const ends = count("end");
    assert.equal(count("start").length, ends.length);
    assert.equal(ends.at(-1).pointerCount, 0);
  });

  test("releasing the last chorded button through pointermove ends", () => {
    const { element, events } = setup();
    element.dispatchEvent(mouse("pointerdown", 500, 250, { buttons: 3 }));
    element.dispatchEvent(mouse("pointermove", 510, 250, { buttons: 0 }));
    assert.equal(types(events), "start,end");
    assert.equal(events[1].buttons, 0);
  });

  test("capture failures don't break gestures", () => {
    const { element, events } = setup();
    element.setPointerCapture = () => {
      throw new Error("InvalidPointerId");
    };
    element.releasePointerCapture = () => {
      throw new Error("InvalidPointerId");
    };
    element.dispatchEvent(mouse("pointerdown", 500, 250));
    element.dispatchEvent(mouse("pointermove", 510, 250));
    element.dispatchEvent(mouse("pointerup", 510, 250, { buttons: 0 }));
    assert.equal(types(events), "start,move,end");
  });

  test("elements without capture still work", () => {
    const { element, manager, events } = setup();
    element.setPointerCapture = undefined;
    element.releasePointerCapture = undefined;
    element.dispatchEvent(mouse("pointerdown", 500, 250));
    manager.cancel();
    assert.equal(types(events), "start,end");
  });

  test("captures pointers and releases them", () => {
    const { element, manager } = setup();
    element.dispatchEvent(pointer("pointerdown", 1, 500, 250));
    element.dispatchEvent(pointer("pointerdown", 2, 600, 250));
    assert.deepEqual([...element.capturedPointers], [1, 2]);
    element.dispatchEvent(pointer("pointerup", 1, 500, 250));
    assert.deepEqual([...element.capturedPointers], [2]);
    manager.cancel();
    assert.deepEqual([...element.capturedPointers], []);
  });

  test("velocity is smoothed, normalized, and kept on a moving release", () => {
    const { element, events } = setup();
    element.dispatchEvent(mouse("pointerdown", 500, 250, {}, 1000));
    for (let i = 1; i <= 20; i++) {
      element.dispatchEvent(
        mouse("pointermove", 500 + i * 4, 250, {}, 1000 + i * 10),
      );
    }
    element.dispatchEvent(mouse("pointerup", 580, 250, { buttons: 0 }, 1210));
    const end = events.at(-1);
    // Half-life damping over 20 steps of 10 ms.
    close(end.velocity[0], 400 * (1 - 2 ** (-0.2 / (Math.LN2 * 0.05))), 1e-9);
    close(end.velocity[1], 0);
    close(end.velocityNormalized[0], end.velocity[0] / 400);
  });

  test("events with the same timestamp keep the velocity finite", () => {
    const { element, events } = setup();
    element.dispatchEvent(mouse("pointerdown", 500, 250, {}, 1000));
    element.dispatchEvent(mouse("pointermove", 510, 250, {}, 1000));
    element.dispatchEvent(mouse("pointermove", 520, 250, {}, 1000));
    assert.ok(events.every(({ velocity }) => velocity.every(Number.isFinite)));
    assert.deepEqual(events[2].delta, [10, 0]);
  });

  test("modifiers and timestamps are reported", () => {
    const { element, events } = setup();
    element.dispatchEvent(
      mouse("pointerdown", 500, 250, { shiftKey: true, metaKey: true }, 1234),
    );
    assert.deepEqual(events[0].modifiers, {
      shift: true,
      ctrl: false,
      alt: false,
      meta: true,
    });
    assert.equal(events[0].timeStamp, 1234);
    assert.ok(events[0].originalEvent instanceof Event);
  });

  test("a move without a change keeps the rest timer running", () => {
    const { element, events } = setup({ restThreshold: 0.05 });
    element.dispatchEvent(mouse("pointerdown", 500, 250, {}, 1000));
    element.dispatchEvent(mouse("pointermove", 540, 250, {}, 1010));
    // Same position: not a movement.
    element.dispatchEvent(mouse("pointermove", 540, 250, {}, 1100));
    element.dispatchEvent(mouse("pointerup", 540, 250, { buttons: 0 }, 1100));
    assert.deepEqual(events.at(-1).velocity, [0, 0]);
  });
});

describe("PointerManager pointer lock", () => {
  const lockedSetup = async () => {
    const context = setup();
    await context.manager.requestPointerLock();
    context.events.length = 0;
    return context;
  };
  const moved = (props = {}) =>
    mouse("pointermove", 0, 0, {
      buttons: 0,
      movementX: 1,
      movementY: 2,
      ...props,
    });

  test("getter, starts centered with no buttons", async () => {
    const { manager, events, element } = setup();
    assert.equal(manager.locked, false);
    await manager.requestPointerLock();
    assert.equal(manager.locked, true);
    assert.equal(types(events), "start");
    assert.deepEqual(events[0].ndc, [0, 0]);
    assert.equal(events[0].pointerCount, 0);
    assert.equal(events[0].buttons, 0);
    // Repeated lock changes to the same state are ignored.
    element.dispatchEvent(new Event("pointerlockchange"));
    assert.equal(events.length, 1);
  });

  test("buttons restart the locked gesture", async () => {
    const { element, events } = await lockedSetup();
    element.dispatchEvent(mouse("pointerdown", 0, 0, { buttons: 1 }));
    element.dispatchEvent(moved({ buttons: 3 }));
    element.dispatchEvent(mouse("pointerup", 0, 0, { buttons: 0 }));
    assert.equal(types(events), "end,start,end,start,move,end,start");
    assert.deepEqual(
      events.filter(({ type }) => type === "start").map((e) => e.buttons),
      [1, 3, 0],
    );
    assert.ok(events.every(({ locked }) => locked));
  });

  test("cancel and capture events don't end the lock", async () => {
    const { element, events } = await lockedSetup();
    element.dispatchEvent(mouse("pointercancel", 0, 0));
    element.dispatchEvent(mouse("lostpointercapture", 0, 0));
    assert.deepEqual(events, []);
  });

  test("movement after cancel starts a new gesture", async () => {
    const { element, manager, events } = await lockedSetup();
    manager.cancel();
    element.dispatchEvent(moved());
    element.dispatchEvent(moved());
    assert.equal(types(events), "end,start,move,move");
  });

  test("locking cancels a drag, unlocking ends the locked gesture", async () => {
    const { element, manager, events } = setup();
    element.dispatchEvent(mouse("pointerdown", 500, 250));
    await manager.requestPointerLock();
    assert.equal(types(events), "start,end,start");
    manager.exitPointerLock();
    assert.equal(types(events), "start,end,start,end");
    assert.equal(manager.locked, false);
  });

  test("exitPointerLock without a lock does nothing", () => {
    const { element, manager } = setup();
    let exits = 0;
    element.exitPointerLock = () => exits++;
    manager.exitPointerLock();
    assert.equal(exits, 0);
  });

  test("unadjusted movement falls back where unsupported", async () => {
    const { element, manager } = setup();
    const requests = [];
    const original = element.requestPointerLock.bind(element);
    element.requestPointerLock = (options) => {
      requests.push(options);
      return options?.unadjustedMovement
        ? Promise.reject(new DOMException("unsupported", "NotSupportedError"))
        : original();
    };
    await manager.requestPointerLock();
    assert.deepEqual(requests, [{ unadjustedMovement: true }, undefined]);
    assert.equal(manager.locked, true);
  });

  test("lock failures reject", async () => {
    const { element, manager } = setup();
    element.requestPointerLock = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
    await assert.rejects(manager.requestPointerLock(false), /denied/);
    await assert.rejects(manager.requestPointerLock(), /denied/);
    assert.equal(manager.locked, false);
  });

  test("only unsupported raw input falls back", async () => {
    const { element, manager } = setup();
    const requests = [];
    element.requestPointerLock = (options) => {
      requests.push(options);
      return Promise.reject(new DOMException("too soon", "SecurityError"));
    };
    await assert.rejects(manager.requestPointerLock(), /too soon/);
    assert.deepEqual(requests, [{ unadjustedMovement: true }]);
  });

  test("disabling exits the lock without waiting for its notification", async () => {
    const { element, manager, events } = setup();
    await manager.requestPointerLock();
    // Browsers notify asynchronously, after the listeners are removed.
    let exits = 0;
    element.exitPointerLock = () => {
      exits++;
      element.pointerLockElement = null;
    };
    manager.disable();
    assert.equal(exits, 1);
    assert.equal(manager.locked, false);
    assert.equal(types(events), "start,end");

    // Back to plain pointers: a press outside the area is ignored.
    manager.enable();
    element.dispatchEvent(mouse("pointerdown", 0, 0));
    assert.equal(types(events), "start,end");
  });

  test("enabling catches up with a lock acquired while disabled", async () => {
    const element = new FakeElement({
      left: 100,
      top: 50,
      width: 800,
      height: 400,
    });
    const manager = new PointerManager(element);
    const events = record(manager);
    await manager.requestPointerLock();
    assert.equal(manager.locked, false);

    manager.enable();
    assert.equal(manager.locked, true);
    assert.equal(types(events), "start");
    assert.deepEqual(events[0].ndc, [0, 0]);
  });
});

describe("PointerManager wheel and trackpad", () => {
  test("wheels outside the area are left to the page", () => {
    const { element, events } = setup({ interactiveArea: [0, 0, 0.25, 1] });
    const event = wheelEvent({ deltaY: 10 });
    element.dispatchEvent(event);
    assert.deepEqual(events, []);
    assert.equal(event.defaultPrevented, false);
  });

  test("page mode wheels scroll by the area height", () => {
    const { element, events } = setup();
    element.dispatchEvent(
      wheelEvent({ deltaY: 1, deltaX: -0.5, deltaMode: 2 }),
    );
    assert.deepEqual(events[0].delta, [-200, 400]);
    assert.deepEqual(events[0].deltaNormalized, [-0.5, 1]);
  });

  test("the device guess holds for the whole stream", () => {
    const { element, events } = setup();
    const at = (time, props) => element.dispatchEvent(wheelEvent(props, time));
    at(1000, { deltaY: 100 });
    at(1050, { deltaY: 100 });
    at(1100, { deltaY: 3.5 });
    // A pause starts a new stream.
    const pause = 1101 + wheel.STREAM_GAP;
    at(pause, { deltaY: 4, deltaX: 1 });
    at(pause + 50, { deltaY: 100 });
    at(pause + 100, { deltaY: 100 });
    assert.deepEqual(
      events.map(({ device }) => device),
      ["unknown", "mouse", "mouse", "trackpad", "trackpad", "trackpad"],
    );
  });

  test("an unknown stream takes the first conclusive guess", () => {
    const { element, events } = setup();
    const at = (time, props) => element.dispatchEvent(wheelEvent(props, time));
    at(1000, { deltaY: 10 });
    at(1050, { deltaY: 12 });
    at(1100, { deltaY: 5, deltaX: 2 });
    at(1150, { deltaY: 5 });
    assert.deepEqual(
      events.map(({ device }) => device),
      ["unknown", "unknown", "trackpad", "trackpad"],
    );
  });

  test("ctrl wheel pinches in every delta mode and direction", () => {
    const { element, events } = setup();
    element.dispatchEvent(wheelEvent({ ctrlKey: true, deltaY: -10 }));
    element.dispatchEvent(
      wheelEvent({ ctrlKey: true, deltaY: 1, deltaMode: 1 }),
    );
    assert.equal(types(events), "pinch,pinch");
    assert.ok(events[0].scale > 1);
    close(events[1].scale, wheel.pinchScale(100 / 3));
    assert.equal(events[0].rotation, 0);
    assert.equal(events[0].modifiers.ctrl, true);
    assert.deepEqual(events[0].ndc, [0, 0]);
  });

  test("ctrl wheels are dropped while Safari reports the pinch", () => {
    const { element, events } = setup();
    element.dispatchEvent(safari("gesturestart"));
    const event = wheelEvent({ ctrlKey: true, deltaY: 10 });
    element.dispatchEvent(event);
    assert.deepEqual(events, []);
    assert.equal(event.defaultPrevented, true);
    element.dispatchEvent(safari("gestureend"));
    element.dispatchEvent(wheelEvent({ ctrlKey: true, deltaY: 10 }));
    assert.equal(types(events), "pinch");
  });

  test("gesture events without a start are ignored", () => {
    const { element, events } = setup();
    const change = safari("gesturechange", 2);
    const end = safari("gestureend", 2);
    element.dispatchEvent(change);
    element.dispatchEvent(end);
    assert.deepEqual(events, []);
    assert.equal(change.defaultPrevented, false);
    assert.equal(end.defaultPrevented, false);
  });

  test("Safari gestures outside the area are left to the page", () => {
    const { element, events } = setup({ interactiveArea: [0.5, 0, 0.5, 1] });
    const start = createEvent("gesturestart", {
      scale: 1,
      rotation: 0,
      clientX: 200,
      clientY: 250,
    });
    element.dispatchEvent(start);
    element.dispatchEvent(safari("gesturechange", 2));
    assert.deepEqual(events, []);
    assert.equal(start.defaultPrevented, false);
  });

  test("cancel forgets the Safari gesture", () => {
    const { element, manager, events } = setup();
    element.dispatchEvent(safari("gesturestart"));
    manager.cancel();
    element.dispatchEvent(safari("gesturechange", 2));
    assert.deepEqual(events, []);
  });

  test("Safari rotation is counter-clockwise radians", () => {
    const { element, events } = setup();
    element.dispatchEvent(safari("gesturestart"));
    element.dispatchEvent(safari("gesturechange", 1, -90));
    close(events[0].rotation, Math.PI / 2);
    close(events[0].scale, 1);
  });
});

describe("PointerManager layout", () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  // Element whose window reports scrolls, resizes and element resizes.
  const observed = () => {
    const element = new FakeElement(rect);
    const observers = [];
    element.defaultView = Object.assign(new EventTarget(), {
      ResizeObserver: class {
        constructor(callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe(target) {
          this.target = target;
        }
        disconnect() {
          this.disconnected = true;
        }
      },
    });
    const read = element.getBoundingClientRect.bind(element);
    const counter = { reads: 0 };
    element.getBoundingClientRect = () => {
      counter.reads++;
      return read();
    };
    const manager = new PointerManager(element).enable();
    return { element, manager, events: record(manager), observers, counter };
  };

  test("the area follows scrolls and resizes during a gesture", () => {
    const { element, manager, events, observers, counter } = observed();
    const [observer] = observers;
    assert.equal(observer.target, element);

    element.dispatchEvent(mouse("pointerdown", 500, 250));
    element.dispatchEvent(mouse("pointermove", 500, 250));
    assert.equal(counter.reads, 1);
    assert.deepEqual(events[1].position, [400, 200]);

    element.rect.top = 0;
    element.defaultView.dispatchEvent(new Event("scroll"));
    element.dispatchEvent(mouse("pointermove", 500, 250));
    assert.deepEqual(events.at(-1).position, [400, 250]);

    element.rect.height = 200;
    observer.callback([]);
    element.dispatchEvent(mouse("pointermove", 520, 250));
    assert.deepEqual(events.at(-1).deltaNormalized, [0.1, 0]);

    element.rect.left = 0;
    element.defaultView.dispatchEvent(new Event("resize"));
    element.dispatchEvent(mouse("pointermove", 520, 250));
    assert.deepEqual(events.at(-1).position, [520, 250]);
    assert.equal(counter.reads, 4);

    manager.disable();
    assert.equal(observer.disconnected, true);
  });

  test("a wheel stream reads the layout once", () => {
    const { element, events, counter } = observed();
    for (const time of [1000, 1050, 1100]) {
      element.dispatchEvent(wheelEvent({ deltaY: 10 }, time));
    }
    assert.equal(counter.reads, 1);
    element.dispatchEvent(wheelEvent({ deltaY: 10 }, 1101 + wheel.STREAM_GAP));
    assert.equal(counter.reads, 2);
    assert.equal(types(events), "wheel,wheel,wheel,wheel");
  });

  test("a zero sized area reports finite values", async () => {
    const { element, manager, events } = setup(undefined, {
      left: 100,
      top: 50,
      width: 0,
      height: 0,
    });
    element.dispatchEvent(mouse("pointerdown", 100, 50, {}, 1000));
    element.dispatchEvent(mouse("pointermove", 100, 50, {}, 1016));
    element.dispatchEvent(wheelEvent({ clientX: 100, clientY: 50 }));
    await manager.requestPointerLock();
    element.dispatchEvent(
      mouse("pointermove", 0, 0, { buttons: 0, movementX: 5 }, 1032),
    );
    assert.ok(events.length > 4);
    for (const event of events) {
      for (const key of ["ndc", "deltaNormalized", "velocityNormalized"]) {
        assert.ok((event[key] ?? []).every(Number.isFinite), key);
      }
      assert.equal(event.aspect, 1);
    }
  });
});

describe("pointers helpers", () => {
  test("centroid", () => {
    assert.deepEqual(pointers.centroid([9, 9], []), [0, 0]);
    assert.deepEqual(pointers.centroid([0, 0], [[2, 4]]), [2, 4]);
    assert.deepEqual(
      pointers.centroid(
        [0, 0],
        [
          [0, 0],
          [2, 0],
          [4, 6],
        ],
      ),
      [2, 2],
    );
  });

  test("spread is zero below two points", () => {
    assert.equal(pointers.spread([], [0, 0]), 0);
    assert.equal(pointers.spread([[5, 5]], [5, 5]), 0);
    assert.equal(
      pointers.spread(
        [
          [0, 0],
          [4, 0],
        ],
        [2, 0],
      ),
      2,
    );
  });

  test("angle is counter-clockwise on a y down screen", () => {
    close(pointers.angle([0, 0], [1, 0]), 0);
    close(pointers.angle([0, 0], [0, -1]), Math.PI / 2);
    close(pointers.angle([0, 0], [-1, 0]), Math.PI);
  });
});

describe("wheel helpers", () => {
  test("normalizeDelta in every mode", () => {
    const event = (deltaMode) => ({ deltaX: 2, deltaY: -3, deltaMode });
    assert.deepEqual(wheel.normalizeDelta([0, 0], event(0), 10, 500), [2, -3]);
    assert.deepEqual(
      wheel.normalizeDelta([0, 0], event(1), 10, 500),
      [20, -30],
    );
    assert.deepEqual(
      wheel.normalizeDelta([0, 0], event(2), 10, 500),
      [1000, -1500],
    );
    close(wheel.DEFAULT_LINE_HEIGHT * 3, 100);
  });

  test("deltaMode is read before the deltas", () => {
    // Firefox reports line deltas only once deltaMode has been read.
    const firefox = () => {
      let lines = false;
      return {
        get deltaMode() {
          lines = true;
          return 1;
        },
        deltaX: 0,
        get deltaY() {
          return lines ? 3 : 57;
        },
        shiftKey: false,
      };
    };
    assert.deepEqual(
      wheel.normalizeDelta([0, 0], firefox(), wheel.DEFAULT_LINE_HEIGHT, 500),
      [0, 100],
    );
    assert.equal(wheel.classifyDevice(firefox()), "mouse");
  });

  test("a wheel stream keeps its first conclusive guess", () => {
    const stream = new wheel.WheelStream();
    const event = (timeStamp, props = {}) => ({
      deltaX: 0,
      deltaY: 4,
      deltaMode: 0,
      shiftKey: false,
      ctrlKey: false,
      timeStamp,
      ...props,
    });
    assert.equal(stream.isNew(event(0)), true);
    assert.equal(stream.add(event(0)), "unknown");
    assert.equal(stream.add(event(10, { deltaX: 2 })), "trackpad");
    // Pinches extend the stream without changing the guess.
    assert.equal(
      stream.add(event(20, { deltaMode: 1, ctrlKey: true })),
      "trackpad",
    );
    assert.equal(stream.isNew(event(20 + wheel.STREAM_GAP)), false);
    assert.equal(stream.add(event(30, { deltaMode: 1 })), "trackpad");
    assert.equal(stream.isNew(event(31 + wheel.STREAM_GAP)), true);
    assert.equal(
      stream.add(event(31 + wheel.STREAM_GAP, { deltaMode: 1 })),
      "mouse",
    );
  });

  test("modifier helpers share one order", () => {
    assert.deepEqual(modifiers.MODIFIER_NAMES, [
      "shift",
      "ctrl",
      "alt",
      "meta",
    ]);
    assert.deepEqual(
      Object.keys(modifiers.getModifiers()),
      modifiers.MODIFIER_NAMES,
    );
  });

  test("pinchScale clamps both directions", () => {
    assert.equal(wheel.pinchScale(0), 1);
    assert.equal(
      wheel.pinchScale(1000),
      wheel.pinchScale(wheel.MAX_PINCH_DELTA),
    );
    assert.equal(
      wheel.pinchScale(-1000),
      wheel.pinchScale(-wheel.MAX_PINCH_DELTA),
    );
    close(wheel.pinchScale(1), Math.exp(-wheel.PINCH_SENSITIVITY));
  });

  test("classifyDevice: small repeats and shifted wheels are unknown", () => {
    const event = (props) => ({
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      shiftKey: false,
      ...props,
    });
    assert.equal(wheel.classifyDevice(event({ deltaY: 10 }), 10), "unknown");
    assert.equal(wheel.classifyDevice(event({ deltaY: -120 }), -120), "mouse");
    assert.equal(wheel.classifyDevice(event({ deltaY: 120 }), 100), "unknown");
    assert.equal(
      wheel.classifyDevice(event({ deltaX: 120, shiftKey: true }), 0),
      "unknown",
    );
    assert.equal(wheel.classifyDevice(event({ deltaMode: 2 })), "mouse");
  });
});

describe("KeyboardManager edge cases", () => {
  const key = (type, code, props = {}) =>
    createEvent(type, { code, key: code, repeat: false, ...props });
  const setupKeys = (options) => {
    const target = new EventTarget();
    const keyboard = new KeyboardManager(target, options).enable();
    const events = [];
    keyboard.on("down", (event) => events.push(event));
    keyboard.on("up", (event) => events.push(event));
    return { target, keyboard, events };
  };

  test("enabled getter and idempotent enable and disable", () => {
    const target = new EventTarget();
    const keyboard = new KeyboardManager(target);
    assert.equal(keyboard.enabled, false);
    assert.equal(keyboard.disable(), keyboard);
    keyboard.enable().enable();
    assert.equal(keyboard.enabled, true);
    target.dispatchEvent(key("keydown", "KeyW"));
    assert.deepEqual([...keyboard.pressed.keys()], ["KeyW"]);
    keyboard.disable();
    assert.equal(keyboard.enabled, false);
  });

  test("disable releases pressed keys, then ignores input", () => {
    const { target, keyboard, events } = setupKeys();
    target.dispatchEvent(key("keydown", "KeyW"));
    target.dispatchEvent(key("keydown", "KeyA"));
    keyboard.disable();
    assert.deepEqual(
      events.map(({ type, code }) => `${type}:${code}`),
      ["down:KeyW", "down:KeyA", "up:KeyW", "up:KeyA"],
    );
    target.dispatchEvent(key("keydown", "KeyS"));
    assert.equal(keyboard.pressed.size, 0);
  });

  test("dispose removes listeners", () => {
    const { target, keyboard, events } = setupKeys();
    keyboard.dispose();
    keyboard.enable();
    target.dispatchEvent(key("keydown", "KeyW"));
    assert.equal(keyboard.pressed.size, 1);
    assert.deepEqual(events, []);
  });

  test("isPressed takes one code or several", () => {
    const { target, keyboard } = setupKeys();
    target.dispatchEvent(key("keydown", "KeyW"));
    assert.equal(keyboard.isPressed("KeyW"), true);
    assert.equal(keyboard.isPressed("KeyS"), false);
    assert.equal(keyboard.isPressed(["KeyS", "KeyW"]), true);
    assert.equal(keyboard.isPressed([]), false);
    assert.equal(keyboard.axis([], []), 0);
  });

  test("details carry key, repeat and modifiers", () => {
    const { target, events } = setupKeys();
    target.dispatchEvent(
      key("keydown", "KeyZ", { key: "w", repeat: true, altKey: true }),
    );
    assert.deepEqual(
      { ...events[0], originalEvent: undefined },
      {
        type: "down",
        code: "KeyZ",
        key: "w",
        repeat: true,
        modifiers: { shift: false, ctrl: false, alt: true, meta: false },
        originalEvent: undefined,
      },
    );
    assert.ok(events[0].originalEvent instanceof Event);
  });

  test("releaseAll details keep the key, without event", () => {
    const { target, keyboard, events } = setupKeys();
    target.dispatchEvent(key("keydown", "KeyZ", { key: "w", shiftKey: true }));
    keyboard.releaseAll();
    const up = events.at(-1);
    assert.equal(up.key, "w");
    assert.equal(up.originalEvent, undefined);
    assert.deepEqual(up.modifiers, {
      shift: false,
      ctrl: false,
      alt: false,
      meta: false,
    });
  });

  test("keyup of a key that isn't pressed emits nothing", () => {
    const { target, events } = setupKeys();
    target.dispatchEvent(key("keyup", "KeyW"));
    assert.deepEqual(events, []);
  });

  test("prevents default on keyup too", () => {
    const { target } = setupKeys({ preventDefault: new Set(["ArrowUp"]) });
    const down = key("keydown", "ArrowUp");
    const up = key("keyup", "ArrowUp");
    target.dispatchEvent(down);
    target.dispatchEvent(up);
    assert.equal(down.defaultPrevented, true);
    assert.equal(up.defaultPrevented, true);
  });

  test("every editable or focusable control is ignored", () => {
    for (const origin of [
      control("textarea"),
      control("select"),
      control("button"),
      control("a", ["href"]),
      control("summary"),
      control("div", ["tabindex"]),
      control("div", [], { isContentEditable: true }),
    ]) {
      const { target, keyboard } = setupKeys({ preventDefault: ["Space"] });
      const event = from(key("keydown", "Space"), origin);
      target.dispatchEvent(event);
      assert.equal(keyboard.pressed.size, 0);
      assert.equal(event.defaultPrevented, false);
    }
    for (const origin of [control("canvas"), control("a"), {}]) {
      const { target, keyboard } = setupKeys();
      target.dispatchEvent(from(key("keydown", "KeyW"), origin));
      assert.equal(keyboard.pressed.size, 1);
    }
  });

  test("a focusable target keeps its keys", () => {
    const target = Object.assign(
      new EventTarget(),
      control("canvas", ["tabindex"]),
    );
    const keyboard = new KeyboardManager(target).enable();
    target.dispatchEvent(from(key("keydown", "KeyW"), target));
    assert.equal(keyboard.pressed.size, 1);
  });

  test("filter option replaces the default", () => {
    const { target, keyboard } = setupKeys({
      filter: (event) => event.code !== "KeyQ",
    });
    target.dispatchEvent(from(key("keydown", "KeyW"), control("input")));
    target.dispatchEvent(key("keydown", "KeyQ"));
    assert.deepEqual([...keyboard.pressed.keys()], ["KeyW"]);
  });

  test("blur on the window releases keys of a document target", () => {
    const view = new EventTarget();
    const target = Object.assign(new EventTarget(), { defaultView: view });
    const keyboard = new KeyboardManager(target).enable();
    target.dispatchEvent(key("keydown", "KeyW"));
    target.dispatchEvent(new Event("blur"));
    assert.equal(keyboard.pressed.size, 1);
    view.dispatchEvent(new Event("blur"));
    assert.equal(keyboard.pressed.size, 0);
  });

  test("focus leaving an element target releases its keys", () => {
    const view = new EventTarget();
    const inside = {};
    const target = Object.assign(new EventTarget(), {
      ownerDocument: { defaultView: view },
      contains: (node) => node === inside,
    });
    const keyboard = new KeyboardManager(target).enable();
    const focusout = (relatedTarget) =>
      Object.assign(new Event("focusout"), { relatedTarget });

    target.dispatchEvent(key("keydown", "KeyW"));
    target.dispatchEvent(focusout(inside));
    assert.equal(keyboard.pressed.size, 1);
    target.dispatchEvent(focusout(null));
    assert.equal(keyboard.pressed.size, 0);

    target.dispatchEvent(key("keydown", "KeyW"));
    view.dispatchEvent(new Event("blur"));
    assert.equal(keyboard.pressed.size, 0);

    keyboard.disable();
    target.dispatchEvent(key("keydown", "KeyW"));
    target.dispatchEvent(focusout(null));
    view.dispatchEvent(new Event("blur"));
    assert.equal(keyboard.pressed.size, 0);
  });

  test("ctrl and meta shortcuts are left to the browser", () => {
    const { target, keyboard, events } = setupKeys({
      preventDefault: ["KeyS"],
    });
    const save = key("keydown", "KeyS", { metaKey: true });
    target.dispatchEvent(save);
    target.dispatchEvent(key("keydown", "KeyD", { ctrlKey: true }));
    assert.equal(keyboard.pressed.size, 0);
    assert.equal(save.defaultPrevented, false);
    assert.deepEqual(events, []);

    // The modifiers themselves are tracked.
    target.dispatchEvent(key("keydown", "ControlLeft", { ctrlKey: true }));
    target.dispatchEvent(
      key("keydown", "MetaLeft", { ctrlKey: true, metaKey: true }),
    );
    assert.deepEqual([...keyboard.pressed.keys()], ["ControlLeft", "MetaLeft"]);
  });

  test("browser shortcuts with modifiers aren't prevented", () => {
    const { target, keyboard } = setupKeys({
      preventDefault: ["ArrowLeft", "Space"],
    });
    const back = key("keydown", "ArrowLeft", { altKey: true });
    const scrollUp = key("keydown", "Space", { shiftKey: true });
    target.dispatchEvent(back);
    target.dispatchEvent(scrollUp);
    assert.equal(back.defaultPrevented, false);
    assert.equal(scrollUp.defaultPrevented, true);
    assert.equal(keyboard.isPressed("ArrowLeft"), true);
  });

  test("Meta release only releases keys whose keyup macOS may drop", () => {
    const { target, keyboard, events } = setupKeys();
    target.dispatchEvent(key("keydown", "ShiftLeft", { shiftKey: true }));
    target.dispatchEvent(key("keydown", "KeyW", { shiftKey: true }));
    target.dispatchEvent(
      key("keydown", "MetaRight", {
        key: "Meta",
        shiftKey: true,
        metaKey: true,
      }),
    );
    const meta = key("keyup", "MetaRight", { key: "Meta", shiftKey: true });
    target.dispatchEvent(meta);
    assert.deepEqual([...keyboard.pressed.keys()], ["ShiftLeft"]);
    const ups = events.filter(({ type }) => type === "up");
    assert.deepEqual(
      ups.map(({ code, key, originalEvent }) => [code, key, originalEvent]),
      [
        ["MetaRight", "Meta", meta],
        ["KeyW", "KeyW", undefined],
      ],
    );
  });

  test("a lost modifier keyup is caught up by the flags", () => {
    const { target, keyboard, events } = setupKeys();
    // Windows sends a single keyup when both Shift keys are released.
    target.dispatchEvent(key("keydown", "ShiftLeft", { shiftKey: true }));
    target.dispatchEvent(key("keydown", "ShiftRight", { shiftKey: true }));
    target.dispatchEvent(key("keyup", "ShiftRight"));
    assert.equal(keyboard.pressed.size, 0);
    assert.deepEqual(
      events.filter(({ type }) => type === "up").map(({ code }) => code),
      ["ShiftRight", "ShiftLeft"],
    );

    // A keydown without the flag also catches up.
    target.dispatchEvent(key("keydown", "AltLeft", { altKey: true }));
    target.dispatchEvent(key("keydown", "KeyW"));
    assert.deepEqual([...keyboard.pressed.keys()], ["KeyW"]);
  });

  test("Caps Lock isn't tracked", () => {
    const { target, keyboard, events } = setupKeys();
    target.dispatchEvent(key("keydown", "CapsLock"));
    target.dispatchEvent(key("keyup", "CapsLock"));
    assert.equal(keyboard.pressed.size, 0);
    assert.deepEqual(events, []);
  });

  test("keyup of an ignored key isn't prevented", () => {
    const { target } = setupKeys({ preventDefault: ["Space"] });
    const down = from(key("keydown", "Space"), control("button"));
    const up = from(key("keyup", "Space"), control("button"));
    target.dispatchEvent(down);
    target.dispatchEvent(up);
    assert.equal(down.defaultPrevented, false);
    assert.equal(up.defaultPrevented, false);
  });

  test("a key held while typing is still released", () => {
    const { target, keyboard } = setupKeys();
    target.dispatchEvent(key("keydown", "KeyW"));
    target.dispatchEvent(from(key("keyup", "KeyW"), control("input")));
    assert.equal(keyboard.pressed.size, 0);
  });
});
