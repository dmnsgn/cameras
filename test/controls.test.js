import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  Controls,
  MapControls,
  OrbitControls,
  bindings,
  gestures,
} from "../lib/controls/index.js";
import { PerspectiveCamera, OrthographicCamera } from "../lib/camera/index.js";
import { Emitter, TAU, normalizeAngle } from "../lib/core/index.js";
import { PointerManager } from "../lib/input/index.js";
import FakeElement, { createEvent } from "./helpers/fake-element.js";
import {
  close,
  closeVec,
  settle,
  gesture,
  pinchGesture,
  wheelGesture,
  project,
  applyTo,
  listen,
  forward,
  upOf,
} from "./helpers/utils.js";

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };
const ALL_MODIFIERS = { shift: true, ctrl: true, alt: true, meta: true };

// Input stand-in: controllers only subscribe to gesture events.
class FakeInput extends Emitter {
  fire(type, props) {
    this.emit(type, gesture({ type, ...props }));
  }
}

// Minimal controller recording the actions it receives.
class Probe extends Controls {
  applied = [];
  state = 0;
  stops = 0;
  constructor(map = { "mouse:primary": "a", wheel: ["a", "b"], pinch: "b" }) {
    super(map);
  }
  getState() {
    return this.state;
  }
  setState(state, transition) {
    this.state = state;
    return this.commit(transition);
  }
  stop() {
    this.stops++;
    return this;
  }
  applyAction(action, { type, deltaNormalized }) {
    this.applied.push([action, type, ...deltaNormalized]);
  }
  step() {
    return false;
  }
  writePose() {}
}

// Pose after jumping to the end state.
const poseOf = (controls) => {
  controls.stop().update(0);
  return controls.pose;
};

describe("bindings", () => {
  const map = {
    "mouse:primary": "arc",
    "mouse:primary+shift": "truck-pedestal",
    "mouse:secondary": null,
    "touch:2": ["dolly", "truck-pedestal"],
    wheel: "dolly",
    "wheel:trackpad": "truck-pedestal",
  };

  test("most specific key wins and modifiers fall back", () => {
    assert.deepEqual(bindings.resolve(map, gesture({})), ["arc"]);
    const shift = { shift: true, ctrl: false, alt: false, meta: false };
    const alt = { shift: false, ctrl: false, alt: true, meta: false };
    assert.deepEqual(bindings.resolve(map, gesture({ modifiers: shift })), [
      "truck-pedestal",
    ]);
    assert.deepEqual(bindings.resolve(map, gesture({ modifiers: alt })), [
      "arc",
    ]);
  });

  test("null disables, arrays combine, devices specialize", () => {
    assert.deepEqual(bindings.resolve(map, gesture({ buttons: 2 })), []);
    assert.deepEqual(
      bindings.resolve(
        map,
        gesture({ pointerType: "touch", pointerCount: 2, buttons: 0 }),
      ),
      ["dolly", "truck-pedestal"],
    );
    assert.deepEqual(
      bindings.resolve(map, {
        ...gesture({}),
        type: "wheel",
        device: "trackpad",
      }),
      ["truck-pedestal"],
    );
    assert.deepEqual(
      bindings.resolve(map, { ...gesture({}), type: "wheel", device: "mouse" }),
      ["dolly"],
    );
  });

  test("chords and pen fall back to mouse keys", () => {
    assert.deepEqual(bindings.gestureKeys(gesture({ buttons: 3 })), [
      "mouse:primary+secondary",
    ]);
    assert.deepEqual(bindings.resolve(map, gesture({ pointerType: "pen" })), [
      "arc",
    ]);
  });
});

describe("OrbitControls", () => {
  test("setLookAt places the camera and looks at the target", () => {
    for (const up of [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ]) {
      const controls = new OrbitControls({
        up,
        position: [3, 4, 5],
        target: [1, -1, 2],
      });
      controls.update(1 / 60);
      closeVec(controls.pose.position, [3, 4, 5]);
      const camera = applyTo(controls, new PerspectiveCamera());
      closeVec(project(camera, [1, -1, 2]), [0, 0]);
    }
  });

  test("rests at the pole instead of chasing it forever", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    settle(controls);
    controls.arcTo(0, 0);
    assert.ok(settle(controls) < 300);
  });

  test("zooming in tightens the rest tolerance", () => {
    const frames = (zoom) => {
      const controls = new OrbitControls({ position: [0, 0, 5] });
      settle(controls.zoomTo(zoom, false));
      return settle(controls.arc(0.5, 0));
    };
    assert.ok(frames(10) > frames(1));
  });

  test("motion is frame rate independent", () => {
    const run = (hz) => {
      const controls = new OrbitControls({ position: [0, 0, 5] });
      controls.update(0);
      controls.arcTo(1, 1);
      controls.dollyTo(10);
      // 0.5s is a whole number of frames at both rates.
      for (let i = 0; i < hz / 2; i++) controls.update(1 / hz);
      return controls.pose.position;
    };
    closeVec(run(30), run(144), 1e-9);
  });

  test("emits wake, update and rest", () => {
    const controls = new OrbitControls();
    const events = [];
    for (const type of ["wake", "update", "rest", "transitionstart"]) {
      controls.on(type, () => events.push(type));
    }
    settle(controls);
    events.length = 0;
    controls.dolly(1);
    settle(controls);
    assert.equal(events[0], "transitionstart");
    assert.equal(events[1], "wake");
    assert.equal(events.at(-1), "rest");
    assert.equal(controls.update(1 / 60), false);
  });

  test("azimuth bounds hold after setLookAt", () => {
    const controls = new OrbitControls({
      azimuthBounds: [-Math.PI / 4, Math.PI / 4],
    });
    controls.setLookAt([-1, 0, 5], [0, 0, 0]);
    const [, , azimuth] = controls.getSpherical([], true);
    assert.ok(azimuth >= -Math.PI / 4 && azimuth <= Math.PI / 4);
  });

  test("setLookAt picks the nearest turn", () => {
    const controls = new OrbitControls();
    controls.arc(4 * Math.PI, 0, false);
    controls.setLookAt([1, 0, 0], [0, 0, 0]);
    close(controls.getSpherical([], true)[2], 4 * Math.PI + Math.PI / 2);
  });

  test("dolly to cursor keeps the point under the cursor", () => {
    for (const Camera of [PerspectiveCamera, OrthographicCamera]) {
      const camera = new Camera({ aspect: 1.5 });
      const controls = new OrbitControls({
        lens: camera,
        position: [2, 3, 6],
        dollyToCursor: true,
      });
      settle(controls);
      applyTo(controls, camera);

      const ndc = [0.4, -0.3];
      // World point under the cursor on the target plane.
      controls.update(0);
      const before = project(camera, [0, 0, 0]);
      controls.applyAction(
        "dolly",
        gesture({
          type: "wheel",
          delta: [0, -0.25 / gestures.PIXEL_DOLLY],
          ndc,
        }),
      );
      settle(controls);
      applyTo(controls, camera);
      const after = project(camera, [0, 0, 0]);

      // Points on the target plane scale around the cursor by the dolly ratio.
      const ratio = (before[0] - ndc[0]) / (after[0] - ndc[0]);
      close(
        (before[1] - ndc[1]) / (after[1] - ndc[1]),
        ratio,
        1e-6,
        Camera.name,
      );
      assert.ok(ratio < 1, `${Camera.name} zoomed in`);
    }
  });

  test("truck follows the cursor 1:1 on the target plane", () => {
    for (const Camera of [PerspectiveCamera, OrthographicCamera]) {
      const camera = new Camera({ aspect: 2 });
      const controls = new OrbitControls({ lens: camera, position: [0, 2, 8] });
      settle(controls);
      applyTo(controls, camera);
      const before = project(camera, [0, 0, 0]);

      controls.applyAction(
        "truck-pedestal",
        gesture({ deltaNormalized: [0.1, -0.05] }),
      );
      settle(controls);
      applyTo(controls, camera);
      const after = project(camera, [0, 0, 0]);

      // Deltas are normalized by height: NDC spans 2 over the height, 2 over the width.
      close(after[0] - before[0], (2 * 0.1) / 2, 1e-6, Camera.name);
      close(after[1] - before[1], -2 * -0.05, 1e-6, Camera.name);
    }
  });

  test("orthographic dolly zooms instead of moving", () => {
    const camera = new OrthographicCamera();
    const controls = new OrbitControls({ lens: camera, position: [0, 0, 5] });
    controls.applyAction(
      "dolly",
      gesture({ type: "wheel", delta: [0, -0.1 / gestures.PIXEL_DOLLY] }),
    );
    assert.ok(controls.getZoom(true) > 1);
    close(controls.getSpherical([], true)[0], 5);
  });

  test("pan and tilt keep the camera in place", () => {
    const controls = new OrbitControls({
      position: [1, 2, 6],
      target: [0, 1, 0],
    });
    controls.panTilt(0.3, 0.2, false);
    closeVec(controls.getPosition([], true), [1, 2, 6]);
    assert.ok(controls.getTarget([], true)[1] > 1, "tilted up");
  });

  test("setOrbitPoint keeps the view", () => {
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls({ lens: camera, position: [1, 2, 6] });
    settle(controls);
    applyTo(controls, camera);
    const view = [...camera.viewMatrix];

    controls.setOrbitPoint([2, 0, -1]);
    controls.update(1 / 60);
    applyTo(controls, camera);
    closeVec(camera.viewMatrix, view);
    closeVec(controls.getTarget([], true), [2, 0, -1]);
  });

  test("fitToSphere frames the sphere", () => {
    const camera = new PerspectiveCamera({ fov: Math.PI / 3, aspect: 2 });
    const controls = new OrbitControls({ lens: camera });
    controls.fitToSphere([1, 1, 1], 2, false);
    close(controls.getSpherical([], true)[0], 2 / Math.sin(Math.PI / 6));
    closeVec(controls.getTarget([], true), [1, 1, 1]);
  });

  test("fitToBox frames the box", () => {
    const camera = new PerspectiveCamera({ fov: Math.PI / 2, aspect: 1 });
    const controls = new OrbitControls({ lens: camera, position: [0, 0, 1] });
    controls.fitToBox(
      [
        [-1, -1, -1],
        [1, 1, 1],
      ],
      {},
      false,
    );
    // Half height 1 at tan(π/4) = 1, plus half the depth.
    close(controls.getSpherical([], true)[0], 2);
  });

  test("boundary without friction slides along the box", () => {
    const controls = new OrbitControls({
      boundary: [
        [-1, -1, -1],
        [1, 1, 1],
      ],
    });
    controls.moveTo([0.5, 0, 0], false);
    controls.truck(2, 1, false);
    const target = controls.getTarget([], true);
    close(target[0], 1);
    close(target[1], 1);
  });

  test("lerp interpolates spherical states", () => {
    const controls = new OrbitControls();
    controls.lerp(
      { target: [0, 0, 0], spherical: [2, Math.PI / 2, 0] },
      { target: [2, 0, 0], spherical: [4, Math.PI / 2, Math.PI] },
      0.5,
      false,
    );
    closeVec(controls.getTarget([], true), [1, 0, 0]);
    // Distance in log space: the geometric mean halfway.
    closeVec(controls.getSpherical([], true), [
      Math.sqrt(8),
      Math.PI / 2,
      Math.PI / 2,
    ]);
  });

  test("reset restores the saved state", () => {
    const controls = new OrbitControls({ position: [0, 0, 4] });
    controls.saveState();
    controls.arc(1, 0.3, false).dolly(3, false);
    controls.reset(false);
    closeVec(controls.getPosition([], true), [0, 0, 4]);
  });

  test("pointer gestures drive actions and control events", () => {
    const element = new FakeElement();
    const input = new PointerManager(element).enable();
    const controls = new OrbitControls({
      position: [0, 0, 5],
      inertia: 0,
    }).attach(input);
    const events = [];
    for (const type of ["controlstart", "control", "controlend"]) {
      controls.on(type, () => events.push(type));
    }
    const mouse = { pointerId: 1, pointerType: "mouse", buttons: 1 };
    element.dispatchEvent(
      createEvent("pointerdown", { ...mouse, clientX: 400, clientY: 300 }),
    );
    element.dispatchEvent(
      createEvent("pointermove", { ...mouse, clientX: 460, clientY: 300 }),
    );
    element.dispatchEvent(
      createEvent("pointerup", {
        ...mouse,
        buttons: 0,
        clientX: 460,
        clientY: 300,
      }),
    );

    assert.deepEqual(events, ["controlstart", "control", "controlend"]);
    // Dragging right orbits to the left: negative azimuth.
    close(controls.getSpherical([], true)[2], (-2 * Math.PI * 60) / 600);

    controls.dispose();
    element.dispatchEvent(
      createEvent("pointerdown", { ...mouse, clientX: 400, clientY: 300 }),
    );
    assert.equal(events.length, 3);
  });

  describe("fling", () => {
    // Drag right at a steady 600 px/s for 100 ms, then release.
    const flick = ({ hz = 60, rest = 0, inertia = 0.3 } = {}) => {
      const element = new FakeElement({ width: 800, height: 600 });
      const input = new PointerManager(element).enable();
      const controls = new OrbitControls({
        position: [0, 0, 5],
        inertia,
        smoothTime: 0.1,
        draggingSmoothTime: 0.1,
      }).attach(input);
      const events = [];
      for (const type of ["controlstart", "controlend"]) {
        controls.on(type, () => events.push(type));
      }
      const release = {};
      input.on(
        "end",
        ({ velocityNormalized }) => (release.velocity = velocityNormalized),
      );
      const mouse = {
        pointerId: 1,
        pointerType: "mouse",
        buttons: 1,
        clientY: 300,
      };
      element.dispatchEvent(
        createEvent("pointerdown", { ...mouse, clientX: 300 }, 1000),
      );
      for (let i = 1; i <= 10; i++) {
        element.dispatchEvent(
          createEvent(
            "pointermove",
            { ...mouse, clientX: 300 + i * 6 },
            1000 + i * 10,
          ),
        );
      }
      element.dispatchEvent(
        createEvent(
          "pointerup",
          { ...mouse, buttons: 0, clientX: 360 },
          1100 + rest,
        ),
      );
      return { element, controls, events, release };
    };
    const azimuthAfterDrag = (-2 * Math.PI * 60) / 600;

    test("coasts by v · half-life / ln 2 at any frame rate", () => {
      const run = (hz) => {
        const { controls } = flick();
        assert.ok(controls.userControlling, "coasting");
        settle(controls, 1 / hz, 5000);
        return controls.getSpherical([], true)[2];
      };
      const at30 = run(30);
      const at144 = run(144);
      close(at30, at144, 1e-9);
      assert.ok(at30 < azimuthAfterDrag, "kept turning");
    });

    test("total coast matches the released velocity", () => {
      const { controls, release } = flick({ inertia: 0.3 });
      settle(controls);
      const coast = controls.getSpherical([], true)[2] - azimuthAfterDrag;
      close(coast, (-2 * Math.PI * release.velocity[0] * 0.3) / Math.LN2, 1e-9);
    });

    test("controlend waits for the coast, a new press interrupts it", () => {
      const { element, controls, events } = flick();
      assert.deepEqual(events, ["controlstart"]);
      controls.update(1 / 60);
      element.dispatchEvent(
        createEvent("pointerdown", {
          pointerId: 2,
          pointerType: "mouse",
          buttons: 1,
          clientX: 300,
          clientY: 300,
        }),
      );
      assert.deepEqual(events, ["controlstart", "controlend", "controlstart"]);
      const azimuth = controls.getSpherical([], true)[2];
      controls.update(1 / 60);
      close(controls.getSpherical([], true)[2], azimuth);
    });

    test("resting before release or zero inertia doesn't fling", () => {
      const rested = flick({ rest: 300 });
      assert.deepEqual(rested.events, ["controlstart", "controlend"]);
      const disabled = flick({ inertia: 0 });
      assert.deepEqual(disabled.events, ["controlstart", "controlend"]);
      close(disabled.controls.getSpherical([], true)[2], azimuthAfterDrag);
    });
  });
});

describe("bindings edge cases", () => {
  const keys = (props) => bindings.gestureKeys(gesture(props));

  test("pinch, locked, touch and wheel keys", () => {
    assert.deepEqual(keys({ type: "pinch" }), ["pinch"]);
    // Ctrl+wheel pinches carry the ctrl modifier.
    assert.deepEqual(
      keys({ type: "pinch", modifiers: { ...NO_MODIFIERS, ctrl: true } }),
      ["pinch+ctrl", "pinch"],
    );
    assert.deepEqual(keys({ locked: true, pointerType: "mouse" }), ["locked"]);
    assert.deepEqual(keys({ pointerType: "touch", pointerCount: 3 }), [
      "touch:3",
    ]);
    assert.deepEqual(keys({ type: "wheel", device: "unknown" }), [
      "wheel:unknown",
      "wheel",
    ]);
  });

  test("every button, pen eraser and buttonless hover", () => {
    assert.deepEqual(keys({ buttons: 4 | 8 | 16 }), [
      "mouse:auxiliary+back+forward",
    ]);
    assert.deepEqual(keys({ pointerType: "pen", buttons: 32 }), [
      "pen:eraser",
      "mouse:eraser",
    ]);
    assert.deepEqual(keys({ buttons: 0 }), ["mouse:"]);
  });

  test("modifiers append in a fixed order, specific keys first", () => {
    assert.deepEqual(keys({ modifiers: ALL_MODIFIERS }), [
      "mouse:primary+shift+ctrl+alt+meta",
      "mouse:primary",
    ]);
    assert.deepEqual(
      keys({ pointerType: "pen", modifiers: { ...NO_MODIFIERS, alt: true } }),
      ["pen:primary+alt", "mouse:primary+alt", "pen:primary", "mouse:primary"],
    );
  });

  test("unbound gestures resolve to nothing, strings to one action", () => {
    assert.deepEqual(bindings.resolve({}, gesture({})), []);
    assert.deepEqual(bindings.resolve({ pinch: "zoom" }, gesture({})), []);
    assert.deepEqual(
      bindings.resolve({ pinch: "zoom" }, gesture({ type: "pinch" })),
      ["zoom"],
    );
    // Inherited keys are not bindings.
    const inherited = Object.create({ "mouse:primary": "arc" });
    assert.deepEqual(bindings.resolve(inherited, gesture({})), []);
  });

  test("a specific null disables without falling back", () => {
    const map = { "mouse:primary+shift": null, "mouse:primary": "arc" };
    assert.deepEqual(
      bindings.resolve(
        map,
        gesture({ modifiers: { ...NO_MODIFIERS, shift: true } }),
      ),
      [],
    );
  });
});

describe("Controls", () => {
  test("copies bindings", () => {
    const map = { "mouse:primary": "a" };
    const controls = new Probe(map);
    map["mouse:primary"] = "b";
    assert.equal(controls.bindings["mouse:primary"], "a");
  });

  test("reset without a saved state does nothing", () => {
    const controls = new Probe();
    const events = listen(controls, ["transitionstart"]);
    controls.state = 3;
    assert.equal(controls.reset(), controls);
    assert.equal(controls.state, 3);
    assert.deepEqual(events, []);
  });

  test("reset transitions or jumps to the saved state", () => {
    const controls = new Probe();
    const events = listen(controls, ["transitionstart"]);
    controls.state = 1;
    controls.saveState();
    controls.state = 2;
    controls.reset();
    assert.equal(controls.state, 1);
    assert.deepEqual(events, ["transitionstart"]);
    controls.state = 2;
    controls.reset(false);
    assert.equal(controls.state, 1);
    assert.equal(controls.stops, 1);
    assert.equal(events.length, 1);
  });

  test("wheel and pinch resolve per event, drags per gesture", () => {
    const input = new FakeInput();
    const controls = new Probe().attach(input);
    const events = listen(controls, ["controlstart", "control", "controlend"]);
    assert.equal(controls.input, input);

    input.fire("wheel", { deltaNormalized: [0, 1] });
    input.fire("pinch");
    assert.deepEqual(controls.applied, [
      ["a", "wheel", 0, 1],
      ["b", "wheel", 0, 1],
      ["b", "pinch", 0, 0],
    ]);
    assert.deepEqual(events, ["control", "control"]);
    assert.equal(controls.userControlling, false);

    controls.applied.length = events.length = 0;
    // Moves without a start are not ours.
    input.fire("move", { deltaNormalized: [1, 0] });
    input.fire("end");
    assert.deepEqual(controls.applied, []);
    assert.deepEqual(events, []);

    input.fire("start");
    assert.equal(controls.userControlling, true);
    input.fire("move", { deltaNormalized: [1, 0] });
    input.fire("end");
    assert.deepEqual(controls.applied, [["a", "move", 1, 0]]);
    assert.deepEqual(events, ["controlstart", "control", "controlend"]);
  });

  test("unbound and disabled gestures are ignored", () => {
    const input = new FakeInput();
    const controls = new Probe({ "mouse:secondary": null }).attach(input);
    const events = listen(controls, ["controlstart", "control"]);
    input.fire("start", { buttons: 2 });
    input.fire("move");
    input.fire("wheel");
    assert.deepEqual(events, []);
    assert.equal(controls.userControlling, false);
  });

  test("disabling mid gesture ends it, enabling doesn't resume it", () => {
    const input = new FakeInput();
    const controls = new Probe().attach(input);
    const events = listen(controls, ["controlstart", "control", "controlend"]);
    input.fire("start");
    controls.enabled = false;
    assert.equal(controls.enabled, false);
    input.fire("move");
    input.fire("wheel");
    input.fire("start");
    controls.enabled = true;
    input.fire("move");
    input.fire("end");
    assert.deepEqual(events, ["controlstart", "controlend"]);
    assert.deepEqual(controls.applied, []);

    // Disabling while idle emits nothing.
    controls.enabled = false;
    controls.enabled = true;
    assert.equal(events.length, 2);
    // Programmatic changes still apply.
    controls.enabled = false;
    controls.setState(5, false);
    assert.equal(controls.state, 5);
  });

  test("attach replaces the previous input, detach forgets both", () => {
    const first = new FakeInput();
    const second = new FakeInput();
    const keyboard = {};
    const controls = new Probe().attach(first);
    controls.attach(second, keyboard);
    assert.equal(controls.input, second);
    assert.equal(controls.keyboard, keyboard);
    first.fire("wheel");
    assert.equal(controls.applied.length, 0);
    second.fire("wheel");
    assert.equal(controls.applied.length, 2);

    controls.attach(null, keyboard);
    assert.equal(controls.input, null);
    assert.equal(controls.keyboard, keyboard);
    second.fire("wheel");
    assert.equal(controls.applied.length, 2);

    controls.detach();
    assert.equal(controls.keyboard, null);
    controls.attach(null);
    assert.equal(controls.keyboard, null);
  });

  test("detach and dispose end the gesture, dispose removes listeners", () => {
    const input = new FakeInput();
    const controls = new Probe().attach(input);
    const events = listen(controls, ["controlend"]);
    input.fire("start");
    controls.detach();
    assert.deepEqual(events, ["controlend"]);

    controls.attach(input);
    input.fire("start");
    controls.dispose();
    // The gesture ends before the listeners go.
    assert.deepEqual(events, ["controlend", "controlend"]);
    input.fire("wheel");
    assert.equal(controls.applied.length, 0);
  });

  describe("fling", () => {
    const release = (props) => ({
      pointerCount: 0,
      velocity: [600, 0],
      velocityNormalized: [1, 0],
      ...props,
    });
    const flung = (props, inertia = 0.2) => {
      const input = new FakeInput();
      const controls = new Probe().attach(input);
      controls.inertia = inertia;
      const events = listen(controls, ["controlend", "control"]);
      input.fire("start");
      input.fire("end", release(props));
      return { controls, events, input };
    };

    test("coasts with the released velocity, starting from rest deltas", () => {
      const { controls, events } = flung();
      assert.equal(controls.userControlling, true);
      assert.deepEqual(events, []);
      controls.update(0);
      controls.update(-1);
      assert.deepEqual(controls.applied, []);
      controls.update(1 / 60);
      const [[action, type, dx, dy]] = controls.applied;
      assert.deepEqual([action, type, dy], ["a", "move", 0]);
      const rate = Math.LN2 / 0.2;
      close(dx, (1 - Math.exp(-rate / 60)) / rate, 1e-12);
      assert.deepEqual(events, ["control"]);
    });

    test("ends when the inertia is switched off mid coast", () => {
      const { controls, events } = flung();
      controls.update(1 / 60);
      controls.inertia = 0;
      controls.update(1 / 60);
      assert.equal(controls.applied.length, 1);
      assert.deepEqual(events, ["control", "controlend"]);
      assert.equal(controls.userControlling, false);
    });

    test("an infinite inertia coasts at constant speed", () => {
      const { controls, events } = flung({}, Infinity);
      for (let i = 0; i < 3; i++) controls.update(1 / 60);
      for (const [, , dx] of controls.applied) close(dx, 1 / 60, 1e-12);
      assert.ok(!events.includes("controlend"));
    });

    test("ends without a visible jump", () => {
      const { controls } = flung();
      for (let i = 0; i < 1200; i++) controls.update(1 / 60);
      // The last step adds the remaining tail to a regular step.
      const [last, previous] = controls.applied.slice(-2).reverse();
      assert.ok(last[2] - previous[2] < 5e-5, `jump ${last[2] - previous[2]}`);
    });

    test("ends after the tail, controlend once", () => {
      const { controls, events } = flung();
      for (let i = 0; i < 600; i++) controls.update(1 / 60);
      assert.equal(events.filter((e) => e === "controlend").length, 1);
      assert.equal(controls.userControlling, false);
      const travel = controls.applied.reduce((sum, [, , dx]) => sum + dx, 0);
      close(travel, 0.2 / Math.LN2, 1e-12);
    });

    for (const [label, props, inertia] of [
      ["pointer lock", { locked: true }, 0.2],
      ["fingers still down", { pointerCount: 1 }, 0.2],
      ["slow release", { velocity: [30, 30] }, 0.2],
      ["no inertia", {}, 0],
      ["negative inertia", {}, -1],
    ]) {
      test(`no fling with ${label}`, () => {
        const { controls, events } = flung(props, inertia);
        assert.deepEqual(events, ["controlend"]);
        assert.equal(controls.userControlling, false);
        controls.update(1 / 60);
        assert.deepEqual(controls.applied, []);
      });
    }

    test("an end without a gesture doesn't fling", () => {
      const input = new FakeInput();
      const controls = new Probe().attach(input);
      controls.inertia = 0.2;
      input.fire("end", release());
      assert.equal(controls.userControlling, false);
    });

    test("disabling stops the coast", () => {
      const { controls, events } = flung();
      controls.enabled = false;
      assert.deepEqual(events, ["controlend"]);
      controls.update(1 / 60);
      assert.deepEqual(controls.applied, []);
    });
  });
});

describe("OrbitControls edge cases", () => {
  test("a zoom jump leaves other motion running", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.arc(1, 0).moveTo([1, 0, 0]);
    controls.update(1 / 60);
    controls.zoomTo(2, false);
    assert.equal(controls.getZoom(), 2);
    assert.notDeepEqual(controls.getTarget(), [1, 0, 0]);
    assert.ok(controls.update(1 / 60));
  });

  test("current and end getters", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.moveTo([1, 0, 0]).setFocalOffset([1, 2, 0]).zoomTo(2);
    assert.deepEqual(controls.getTarget(), [0, 0, 0]);
    assert.deepEqual(controls.getTarget([], true), [1, 0, 0]);
    assert.deepEqual(controls.getFocalOffset(), [0, 0, 0]);
    assert.deepEqual(controls.getFocalOffset(undefined, true), [1, 2, 0]);
    assert.equal(controls.getZoom(), 1);
    assert.equal(controls.getZoom(true), 2);
    closeVec(controls.getPosition(), [0, 0, 5]);
    closeVec(controls.getPosition(undefined, true), [2, 2, 5]);
  });

  test("zoom and dolly are clamped by their bounds", () => {
    const controls = new OrbitControls({
      position: [0, 0, 5],
      zoomBounds: [0.5, 4],
      distanceBounds: [2, 10],
    });
    controls.zoomTo(10, false);
    assert.equal(controls.getZoom(), 4);
    controls.zoom(-10, false);
    assert.equal(controls.getZoom(), 0.5);
    assert.equal(poseOf(controls).zoom, 0.5);
    controls.dolly(100, false);
    assert.equal(controls.getSpherical()[0], 10);
    controls.dollyTo(0, false);
    assert.equal(controls.getSpherical()[0], 2);
  });

  test("pedestal moves along the up axis", () => {
    const controls = new OrbitControls({ up: [0, 0, 1], position: [5, 0, 0] });
    controls.pedestal(2, false);
    closeVec(controls.getTarget(), [0, 0, 2]);
    closeVec(controls.getPosition(), [5, 0, 2]);
  });

  test("forward stays on the ground, even looking straight down", () => {
    for (const position of [
      [0, 5, 5],
      [0, 5, 0],
    ]) {
      const controls = new OrbitControls({ position });
      controls.forward(3, false);
      closeVec(controls.getTarget(), [0, 0, -3]);
    }
  });

  test("pan and tilt rotate around the camera", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.pan(Math.PI / 2, false);
    closeVec(controls.getPosition(), [0, 0, 5]);
    closeVec(controls.getTarget(), [-5, 0, 5]);
    closeVec(forward(poseOf(controls).orientation), [-1, 0, 0]);

    controls.tilt(0.3, false);
    closeVec(controls.getPosition(), [0, 0, 5]);
    close(forward(poseOf(controls).orientation)[1], Math.sin(0.3));
  });

  test("setTarget keeps the camera in place", () => {
    const controls = new OrbitControls({ position: [1, 2, 3] });
    controls.setTarget([3, 0, -1], false);
    closeVec(controls.getPosition(), [1, 2, 3]);
    closeVec(controls.getTarget(), [3, 0, -1]);
  });

  test("lookInDirectionOf looks from the opposite side, at the same distance", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.lookInDirectionOf([10, 0, 0], false);
    closeVec(controls.getPosition(), [-5, 0, 0]);

    // A point on the target has no direction.
    const events = listen(controls, ["transitionstart"]);
    const before = controls.getState();
    controls.lookInDirectionOf([0, 0, 0]);
    assert.deepEqual(controls.getState(), before);
    assert.deepEqual(events, []);
  });

  test("setLookAt on the target keeps the angles", () => {
    const controls = new OrbitControls({ position: [3, 4, 0] });
    const [, polar, azimuth] = controls.getSpherical();
    controls.setLookAt([1, 1, 1], [1, 1, 1], false);
    const s = controls.getSpherical();
    assert.deepEqual([s[1], s[2]], [polar, azimuth]);
    assert.ok(s[0] > 0);
    assert.ok(poseOf(controls).orientation.every(Number.isFinite));
  });

  test("normalizeRotations unwinds turns without spinning back", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.arc(5 * TAU + 0.5, 0, false);
    controls.normalizeRotations();
    close(controls.getSpherical([], true)[2], 0.5);
    close(controls.getSpherical()[2], 0.5);

    // Mid transition the current angle moves to the turn nearest the end.
    controls.arc(3 * TAU, 0);
    controls.update(1 / 60);
    controls.normalizeRotations();
    const [, , current] = controls.getSpherical();
    const [, , end] = controls.getSpherical([], true);
    assert.ok(Math.abs(end) <= Math.PI);
    assert.ok(Math.abs(current - end) <= Math.PI);
    settle(controls);
    close(controls.getSpherical()[2], end);
  });

  test("fits a box with an orthographic lens: contain, cover and padding", () => {
    const lens = new OrthographicCamera({ size: 1, aspect: 1 });
    const box = [
      [-2, -1, -1],
      [2, 1, 1],
    ];
    const controls = new OrbitControls({ lens, position: [0, 0, 5] });
    controls.fitToBox(box, {}, false);
    close(controls.getZoom(), 0.5);
    closeVec(controls.getTarget(), [0, 0, 0]);
    controls.fitToBox(box, { cover: true }, false);
    close(controls.getZoom(), 1);
    controls.fitToBox(box, { cover: true, padding: [1, 0, 1, 0] }, false);
    close(controls.getZoom(), 0.5);
    controls.zoomBounds = [0.8, 2];
    controls.fitToBox(box, {}, false);
    close(controls.getZoom(), 0.8);
  });

  test("asymmetric padding shifts the target", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.fitToBox(
      [
        [-1, -1, -1],
        [1, 1, 1],
      ],
      { padding: [2, 0, 0, 0] },
      false,
    );
    closeVec(controls.getTarget(), [0, 1, 0]);
    // Off the camera axis, the focal offset is reset.
    controls.setFocalOffset([1, 0, 0], false);
    controls.fitToBox(
      [
        [-1, -1, -1],
        [1, 1, 1],
      ],
      {},
      false,
    );
    assert.deepEqual(controls.getFocalOffset(), [0, 0, 0]);
  });

  test("fits a sphere with either lens", () => {
    const orthographic = new OrbitControls({
      lens: new OrthographicCamera({ size: 1, aspect: 2 }),
    });
    orthographic.fitToSphere([1, 0, 0], 0.5, false);
    close(orthographic.getZoom(), 2);
    closeVec(orthographic.getTarget(), [1, 0, 0]);

    const lens = new PerspectiveCamera({ fov: Math.PI / 2, aspect: 0.5 });
    const perspective = new OrbitControls({ lens });
    perspective.fitToSphere([0, 0, 0], 1, false);
    // The narrow horizontal fov limits: tan(half) = 0.5.
    close(perspective.getSpherical()[0], 1 / Math.sin(Math.atan(0.5)));
  });

  test("single axis arcs and twist", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    const [, polar, azimuth] = controls.getSpherical();
    controls.applyAction(
      "arc-azimuth",
      gesture({ deltaNormalized: [0.1, 0.1] }),
    );
    assert.equal(controls.getSpherical([], true)[1], polar);
    close(controls.getSpherical([], true)[2], azimuth - TAU * 0.1);

    controls.applyAction("arc-polar", gesture({ deltaNormalized: [0.1, 0.1] }));
    close(controls.getSpherical([], true)[1], polar - TAU * 0.1);
    close(controls.getSpherical([], true)[2], azimuth - TAU * 0.1);

    controls.stop();
    const [, , before] = controls.getSpherical();
    controls.applyAction("twist", pinchGesture({ rotation: 0.2 }));
    close(controls.getSpherical([], true)[2], before - 0.2);
    controls.applyAction("twist", wheelGesture({ deltaNormalized: [0, 1] }));
    close(controls.getSpherical([], true)[2], before - 0.2);
  });

  test("zoom gestures magnify a perspective lens without moving", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.applyAction("zoom", pinchGesture({ scale: 2 }));
    close(controls.getZoom(true), 2);
    close(controls.getSpherical([], true)[0], 5);
    controls.applyAction(
      "zoom",
      wheelGesture({ delta: [0, 1 / gestures.PIXEL_DOLLY] }),
    );
    close(controls.getZoom(true), 2 * Math.exp(-1));
  });

  test("dolly from a pinch, a wheel, a drag and two fingers", () => {
    const cases = [
      [pinchGesture({ scale: 2 }), 2.5],
      [wheelGesture({ delta: [0, 1 / gestures.PIXEL_DOLLY] }), 5 * Math.E],
      [gesture({ delta: [0, 1 / gestures.PIXEL_DOLLY] }), 5 * Math.E],
      [gesture({ pointerType: "touch", pointerCount: 2, scale: 0.5 }), 10],
    ];
    for (const [input, distance] of cases) {
      const controls = new OrbitControls({ position: [0, 0, 5] });
      controls.applyAction("dolly", input);
      close(controls.getSpherical([], true)[0], distance);
    }
  });

  test("truck-dolly and focal offset follow the screen", () => {
    const controls = new OrbitControls({
      position: [0, 5, 5],
      lens: new PerspectiveCamera({ fov: Math.PI / 2 }),
    });
    controls.applyAction(
      "truck-dolly",
      gesture({ deltaNormalized: [0.1, 0.1] }),
    );
    const target = controls.getTarget([], true);
    assert.ok(target[0] < 0, "grabbed to the left");
    assert.ok(target[2] < 0, "moved forward on the ground");
    close(target[1], 0);

    controls.applyAction(
      "focal-offset",
      gesture({ deltaNormalized: [0.1, -0.1] }),
    );
    const offset = controls.getFocalOffset([], true);
    assert.ok(offset[0] < 0 && offset[1] < 0);
    assert.equal(offset[2], 0);
  });

  test("pan-tilt gestures keep the camera in place", () => {
    const controls = new OrbitControls({ position: [1, 2, 5] });
    const position = controls.getPosition();
    controls.applyAction("pan-tilt", gesture({ deltaNormalized: [0.2, 0.1] }));
    closeVec(controls.getPosition([], true), position);
    controls.applyAction(
      "pan-tilt",
      wheelGesture({ deltaNormalized: [0.2, 0] }),
    );
    closeVec(controls.getPosition([], true), position);
  });

  test("collide shortens the posed distance only", () => {
    const calls = [];
    const controls = new OrbitControls({
      position: [0, 0, 5],
      collide: ([origin, direction], distance) => {
        calls.push([[...origin], [...direction], distance]);
        return 2;
      },
    });
    controls.update(0);
    closeVec(controls.pose.position, [0, 0, 2]);
    assert.equal(controls.getSpherical()[0], 5);
    const [origin, direction, distance] = calls.at(-1);
    closeVec(origin, [0, 0, 0]);
    closeVec(direction, [0, 0, 1]);
    close(distance, 5);

    for (const hit of [null, undefined, 10]) {
      controls.collide = () => hit;
      closeVec(poseOf(controls).position, [0, 0, 5]);
    }
  });

  test("infinity dolly pushes the target past the minimum distance", () => {
    const run = (infinityDolly) => {
      const controls = new OrbitControls({
        position: [0, 0, 2],
        distanceBounds: [1, 100],
        infinityDolly,
      });
      controls.applyAction(
        "dolly",
        wheelGesture({ delta: [0, -2 / gestures.PIXEL_DOLLY] }),
      );
      return controls;
    };
    const pushed = run(true);
    close(pushed.getSpherical([], true)[0], 1);
    closeVec(pushed.getTarget([], true), [0, 0, -(1 - 2 * Math.exp(-2))]);
    closeVec(run(false).getTarget([], true), [0, 0, 0]);
  });

  describe("boundary", () => {
    const boxed = (boundaryFriction = 0, target = [0, 0, 0]) => {
      const controls = new OrbitControls({
        position: [target[0], target[1], 5],
        target,
        boundary: [
          [-1, -1, -1],
          [1, 1, 1],
        ],
        boundaryFriction,
      });
      return controls;
    };

    test("clamps placements and state", () => {
      const controls = boxed();
      controls.moveTo([5, -5, 0], false);
      closeVec(controls.getTarget(), [1, -1, 0]);
      controls.setState({ ...controls.getState(), target: [0, 3, 0] }, false);
      closeVec(controls.getTarget(), [0, 1, 0]);
      controls.lerp(
        { target: [0, 0, 0], position: [0, 0, 5] },
        { target: [4, 0, 0], position: [4, 0, 5] },
        1,
        false,
      );
      closeVec(controls.getTarget(), [1, 0, 0]);
    });

    test("moves freely inside, not at all straight out", () => {
      const controls = boxed();
      controls.truck(0.5, 0, false);
      closeVec(controls.getTarget(), [0.5, 0, 0]);
      controls.truck(0, 0, false);
      closeVec(controls.getTarget(), [0.5, 0, 0]);
      controls.truck(2, 0, false);
      closeVec(controls.getTarget(), [1, 0, 0]);
      controls.truck(1, 0, false);
      closeVec(controls.getTarget(), [1, 0, 0]);
    });

    test("friction slows the slide along the boundary", () => {
      const slide = (friction) => {
        const controls = boxed(friction, [0.5, 0, 0]);
        controls.truck(1, 1, false);
        return controls.getTarget();
      };
      closeVec(slide(0), [1, 1, 0]);
      const sticky = slide(1);
      close(sticky[0], 1);
      assert.ok(sticky[1] > 0 && sticky[1] < 1, `slid ${sticky[1]}`);
      const half = slide(0.5);
      assert.ok(half[1] > sticky[1] && half[1] < 1);
      // Half the offset reaches the face, the other half slides damped.
      closeVec(half, [1, 0.75, 0]);
      closeVec(sticky, [1, 0.5, 0]);
    });

    test("friction stays bounded in corners and past a face", () => {
      const inBox = (target) =>
        assert.ok(
          target.every((v) => Math.abs(v) <= 1),
          `escaped to ${target}`,
        );
      const cornered = boxed(0.9, [0.9, 0.95, 0]);
      for (let i = 0; i < 20; i++) {
        cornered.truck(0.3, 0.1, false);
        inBox(cornered.getTarget());
      }

      const outside = new OrbitControls({
        position: [3, 0, 5],
        target: [3, 0, 0],
      });
      outside.set({
        boundary: [
          [-1, -1, -1],
          [1, 1, 1],
        ],
        boundaryFriction: 0.9,
      });
      outside.truck(-0.01, 0.2, false);
      inBox(outside.getTarget());
      close(outside.getTarget()[1], 0.02);
    });
  });

  test("changing up keeps the camera in place", () => {
    const controls = new OrbitControls({ position: [1, 2, 3] });
    controls.up = [0, 0, 2];
    assert.deepEqual(controls.up, [0, 0, 1]);
    closeVec(controls.getPosition(), [1, 2, 3]);
    // The pose up is the camera up: no roll, on the world up side.
    const { up, orientation } = poseOf(controls);
    closeVec(up, upOf(orientation));
    const [x, y] = forward(orientation);
    close(x * up[1] - y * up[0], 0);
    assert.ok(up[2] > 0);
    // The getter returns a copy.
    controls.up[2] = 5;
    assert.deepEqual(controls.up, [0, 0, 1]);
  });

  test("maxSpeed limits distance and target speed", () => {
    const controls = new OrbitControls({ position: [0, 0, 5], maxSpeed: 1 });
    controls.dollyTo(50).moveTo([30, 0, 0]);
    controls.update(1 / 60);
    assert.ok(controls.getSpherical()[0] - 5 <= 1 / 60 + 1e-9);
    assert.ok(controls.getTarget()[0] <= 1 / 60 + 1e-9);
  });

  test("lerp between position states", () => {
    const controls = new OrbitControls();
    controls.lerp(
      { target: [0, 0, 0], position: [0, 0, 5] },
      { target: [0, 0, 0], position: [5, 0, 0] },
      0.5,
      false,
    );
    const [radius, polar, azimuth] = controls.getSpherical();
    close(radius, 5);
    close(polar, Math.PI / 2);
    close(azimuth, Math.PI / 4);
  });

  test("lerp between position states takes the short way across ±π", () => {
    const controls = new OrbitControls();
    const behind = (azimuth) => [
      5 * Math.sin(azimuth),
      0,
      5 * Math.cos(azimuth),
    ];
    controls.lerp(
      { target: [0, 0, 0], position: behind(Math.PI - 0.1) },
      { target: [0, 0, 0], position: behind(-Math.PI + 0.1) },
      0.5,
      false,
    );
    close(Math.abs(normalizeAngle(controls.getSpherical()[2])), Math.PI);
  });

  test("setLookAt on the up axis keeps the azimuth", () => {
    const controls = new OrbitControls({ position: [5, 0, 0] });
    controls.setLookAt([0, 5, 0], [0, 0, 0], false);
    const [, polar, azimuth] = controls.getSpherical();
    assert.ok(polar > 0);
    close(azimuth, Math.PI / 2);
  });

  test("polar angle stays off the poles with open bounds", () => {
    const controls = new OrbitControls({ polarBounds: [-1, 4] });
    controls.arcTo(0, -1, false);
    assert.ok(controls.getSpherical()[1] > 0);
    controls.arcTo(0, 4, false);
    assert.ok(controls.getSpherical()[1] < Math.PI);
  });

  test("setState clamps to the bounds", () => {
    const controls = new OrbitControls({
      distanceBounds: [1, 10],
      zoomBounds: [1, 2],
      polarBounds: [0.5, 1],
    });
    controls.setState(
      {
        target: [0, 0, 0],
        spherical: [20, 2, 0],
        focalOffset: [0, 0, 0],
        zoom: 5,
      },
      false,
    );
    assert.deepEqual(controls.getSpherical().slice(0, 2), [10, 1]);
    assert.equal(controls.getZoom(), 2);
  });

  test("rests within the threshold and snaps to the end", () => {
    const controls = new OrbitControls({ position: [0, 0, 5] });
    controls.arc(1, 0.2).dolly(2).zoomTo(3).moveTo([1, 1, 1]);
    controls.setFocalOffset([0.5, 0, 0]);
    const frames = settle(controls);
    assert.ok(frames < 1000);
    assert.deepEqual(controls.getState().spherical, controls.getSpherical());
    assert.deepEqual(controls.getTarget(), [1, 1, 1]);
    assert.equal(controls.getZoom(), 3);
  });
});

describe("MapControls", () => {
  test("defaults", () => {
    const controls = new MapControls();
    assert.equal(controls.dollyToCursor, true);
    assert.equal(controls.polarBounds[1], Math.PI / 2);
    assert.equal(controls.bindings["mouse:primary"], "truck-dolly");
    assert.equal(MapControls.DEFAULT_BINDINGS["mouse:secondary"], "arc");
    assert.notEqual(
      MapControls.DEFAULT_BINDINGS,
      OrbitControls.DEFAULT_BINDINGS,
    );
  });

  test("options and bindings override the preset", () => {
    const controls = new MapControls({
      dollyToCursor: false,
      bindings: { "mouse:primary": "arc" },
    });
    assert.equal(controls.dollyToCursor, false);
    assert.equal(controls.bindings["mouse:primary"], "arc");
    assert.equal(controls.bindings["mouse:secondary"], "arc");
    assert.deepEqual(controls.bindings["touch:2"], [
      "dolly",
      "truck-dolly",
      "twist",
    ]);
  });
});

describe("lens permutations", () => {
  // Plain lens objects, e.g. from an adapter, may omit optional values.
  const bareOrthographic = { type: "Orthographic", aspect: 1 };

  test("orthographic lenses without size default to 1", () => {
    const box = new OrbitControls({ lens: bareOrthographic });
    box.fitToBox(
      [
        [-2, -2, -2],
        [2, 2, 2],
      ],
      {},
      false,
    );
    close(box.getZoom(), 0.5);
    assert.ok(settle(box) < Infinity);
    const sphere = new OrbitControls({ lens: bareOrthographic });
    sphere.fitToSphere([0, 0, 0], 2, false);
    close(sphere.getZoom(), 0.5);
  });

  test("controllers without a lens use a 45° perspective", () => {
    const controls = new OrbitControls();
    controls.fitToSphere([0, 0, 0], 1, false);
    close(controls.getSpherical()[0], 1 / Math.sin(Math.PI / 8));
  });
});
