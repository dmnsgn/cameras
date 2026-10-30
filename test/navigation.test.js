import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { quat, vec3 } from "pex-math";

import {
  FirstPersonControls,
  FlyControls,
  MapControls,
  OrbitControls,
  TrackballControls,
} from "../lib/controls/index.js";
import {
  close,
  closeVec,
  settle,
  run,
  gesture,
  pinchGesture,
  wheelGesture,
  forward,
  upOf,
  rightOf,
  keyboardFor,
  listen,
} from "./helpers/utils.js";
import { OrthographicCamera, PerspectiveCamera } from "../lib/camera/index.js";
import { gestures } from "../lib/controls/index.js";
import { PointerManager } from "../lib/input/index.js";
import FakeElement, { createEvent } from "./helpers/fake-element.js";

const locked = (props) =>
  gesture({ locked: true, pointerCount: 0, buttons: 0, ...props });

describe("FirstPersonControls", () => {
  test("walks on the ground while looking down", () => {
    const controls = new FirstPersonControls({
      position: [0, 1.7, 0],
      target: [0, 0, -2],
    });
    const { press, release } = keyboardFor(controls);
    press("KeyW");
    run(controls, 1);
    release("KeyW");
    settle(controls);

    const position = controls.getPosition();
    close(position[1], 1.7);
    close(position[2], -controls.speed, 1e-6);
    assert.ok(forward(controls.pose.orientation)[1] < 0, "looking down");
  });

  test("diagonals are not faster, sprint is", () => {
    const controls = new FirstPersonControls();
    const { press, release } = keyboardFor(controls);
    press("KeyW", "KeyD");
    run(controls, 1);
    release("KeyW", "KeyD");
    close(Math.hypot(...controls.getPosition([], true)), controls.speed);

    press("KeyW", "ShiftLeft");
    run(controls, 1);
    release("KeyW", "ShiftLeft");
    settle(controls);
    assert.ok(
      Math.hypot(...controls.getPosition()) >
        controls.speed * controls.sprintMultiplier,
    );
  });

  test("aim zooms while the secondary button is held", () => {
    const element = new FakeElement();
    const input = new PointerManager(element).enable();
    const controls = new FirstPersonControls().attach(input);
    const mouse = { pointerId: 1, pointerType: "mouse", buttons: 2 };
    const press = () =>
      element.dispatchEvent(
        createEvent("pointerdown", { ...mouse, clientX: 400, clientY: 300 }),
      );
    press();
    assert.equal(controls.getZoom(true), controls.aimZoom);
    element.dispatchEvent(
      createEvent("pointerup", { ...mouse, buttons: 0, clientX: 400 }),
    );
    assert.equal(controls.getZoom(true), 1);

    // Disabling mid-press releases the aim.
    press();
    controls.enabled = false;
    assert.equal(controls.getZoom(true), 1);
  });

  test("slow divides the speed", () => {
    const controls = new FirstPersonControls();
    const { press } = keyboardFor(controls);
    press("KeyW", "AltLeft");
    run(controls, 1);
    close(
      Math.hypot(...controls.getPosition([], true)),
      controls.speed * controls.slowMultiplier,
    );
  });

  test("walking is frame rate independent", () => {
    const walk = (hz) => {
      const controls = new FirstPersonControls();
      const { press } = keyboardFor(controls);
      press("KeyW");
      run(controls, 0.5, hz);
      return controls.getPosition();
    };
    closeVec(walk(30), walk(120), 1e-9);
  });

  test("keys emit control events", () => {
    const controls = new FirstPersonControls();
    const events = [];
    for (const type of ["controlstart", "controlend"]) {
      controls.on(type, () => events.push(type));
    }
    const { press, release } = keyboardFor(controls);
    press("KeyA");
    controls.update(1 / 60);
    release("KeyA");
    controls.update(1 / 60);
    assert.deepEqual(events, ["controlstart", "controlend"]);
  });

  test("pan-tilt looks in the pointer direction, locked or dragging", () => {
    const locked = new FirstPersonControls();
    locked.applyAction(
      "pan-tilt",
      gesture({ locked: true, pointerCount: 0, deltaNormalized: [0.1, 0] }),
    );
    assert.ok(locked.getPanTilt(true)[0] < 0, "turns right");

    const dragged = new FirstPersonControls();
    dragged.applyAction("pan-tilt", gesture({ deltaNormalized: [0.1, 0] }));
    assert.ok(dragged.getPanTilt(true)[0] < 0, "turns right");
  });

  test("the pose up stays perpendicular to the view, even looking straight up", () => {
    const controls = new FirstPersonControls();
    controls.panTilt(0.3, Math.PI / 2, false);
    controls.update(0);
    const { position, target, up, orientation } = controls.pose;
    const view = [0, 1, 2].map((i) => target[i] - position[i]);
    closeVec(view, [0, 1, 0]);
    close(view[0] * up[0] + view[1] * up[1] + view[2] * up[2], 0);
    closeVec(up, upOf(orientation));
  });

  test("tilt is clamped and lookAt aims at the target", () => {
    const controls = new FirstPersonControls();
    controls.panTilt(0, 10, false);
    assert.equal(controls.getPanTilt(true)[1], Math.PI / 2);

    controls.lookAt([3, 0, 0], false);
    controls.update(1 / 60);
    closeVec(forward(controls.pose.orientation), [1, 0, 0]);
  });

  test("constrain keeps the position valid", () => {
    const controls = new FirstPersonControls({
      position: [0, 2, 0],
      constrain: (position) => {
        position[1] = Math.max(position[1], 1.7);
      },
    });
    controls.move(0, -5, 0, false);
    close(controls.getPosition()[1], 1.7);
  });
});

describe("FlyControls", () => {
  test("moves along the view direction", () => {
    const controls = new FlyControls({ target: [0, -1, -1] });
    const { press } = keyboardFor(controls);
    press("KeyW");
    run(controls, 1);
    const position = controls.getPosition([], true);
    close(position[1], -controls.speed * Math.SQRT1_2, 1e-6);
    close(position[2], -controls.speed * Math.SQRT1_2, 1e-6);
  });

  test("rolls around the view axis and levels back", () => {
    const controls = new FlyControls({ target: [0, 0, -1], autoLevel: false });
    controls.rotate(0, 0, Math.PI / 4, false);
    controls.update(1 / 60);
    close(upOf(controls.pose.orientation)[1], Math.SQRT1_2);
    closeVec(forward(controls.pose.orientation), [0, 0, -1]);
    // The pose up carries the roll for target and up consumers.
    closeVec(controls.pose.up, upOf(controls.pose.orientation));

    controls.level(false);
    controls.update(1 / 60);
    closeVec(upOf(controls.pose.orientation), [0, 1, 0]);
  });

  test("rotation damping settles", () => {
    const controls = new FlyControls({ autoLevel: false });
    controls.rotate(1, 0.5, 0.2);
    assert.ok(settle(controls) < 600);
    closeVec(
      controls.getOrientation(),
      controls.getOrientation([], true),
      1e-9,
    );
  });
});

describe("TrackballControls", () => {
  // Drag along ball coordinates (half viewport heights, aspect 1).
  const drag = (controls, points) => {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      controls.applyAction(
        "rotate",
        gesture({
          ndc: [x1, y1],
          deltaNormalized: [(x1 - x0) / 2, -(y1 - y0) / 2],
        }),
      );
    }
  };

  test("Shoemake's arcball is path independent", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    const start = controls.getOrientation([], true);
    const loop = Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return [0.6 * Math.cos(a), 0.4 * Math.sin(a)];
    });
    drag(controls, loop);
    const end = controls.getOrientation([], true);
    const dot = Math.abs(start.reduce((sum, v, i) => sum + v * end[i], 0));
    close(dot, 1, 1e-9);
  });

  test("dragging right turns the scene right", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    drag(controls, [
      [0, 0],
      [0.2, 0],
    ]);
    settle(controls);
    assert.ok(controls.getPosition()[0] < 0);
    close(Math.hypot(...controls.getPosition()), 5);
  });

  test("rotates over the poles without gimbal lock", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    for (let i = 0; i < 20; i++) {
      drag(controls, [
        [0, -0.2],
        [0, 0.2],
      ]);
    }
    settle(controls);
    const orientation = controls.getOrientation();
    assert.ok(orientation.every(Number.isFinite));
    close(Math.hypot(...controls.getPosition()), 5);
    // Target stays at the screen center.
    closeVec(
      controls.getPosition().map((v) => -v / 5),
      forward(orientation),
    );
  });

  test("bell mode stays continuous outside the sphere", () => {
    const controls = new TrackballControls({ mode: "bell" });
    const inside = controls.projectOnBall([0, 0, 0], [0.7071, 0]);
    const outside = controls.projectOnBall([0, 0, 0], [0.7072, 0]);
    closeVec(inside, outside, 1e-3);
  });
});

describe("MapControls", () => {
  test("dragging moves the target on the ground", () => {
    const controls = new MapControls({ position: [0, 10, 10] });
    controls.applyAction(
      "truck-dolly",
      gesture({ deltaNormalized: [0.1, 0.2] }),
    );
    settle(controls);
    const target = controls.getTarget();
    close(target[1], 0);
    assert.ok(target[2] < 0, "moved forward");
  });

  test("twist rotates the bearing and the camera stays above the horizon", () => {
    const controls = new MapControls({ position: [0, 10, 10] });
    controls.applyAction("twist", gesture({ pointerCount: 2, rotation: 0.3 }));
    close(controls.getSpherical([], true)[2], -0.3);

    controls.arcTo(0, -Math.PI / 2);
    assert.ok(controls.getSpherical([], true)[1] >= 0);
  });
});

describe("SteeringControls", () => {
  for (const Controls of [FirstPersonControls, FlyControls]) {
    describe(Controls.name, () => {
      test("a zoom jump leaves other motion running", () => {
        const controls = new Controls();
        controls.setPosition([1, 0, 0]);
        controls.update(1 / 60);
        controls.zoomTo(2, false);
        assert.equal(controls.getZoom(), 2);
        assert.notDeepEqual(controls.getPosition(), [1, 0, 0]);
        assert.ok(controls.update(1 / 60));
      });

      test("keys merge with the defaults", () => {
        const controls = new Controls({ keys: { forward: ["KeyI"] } });
        assert.deepEqual(controls.keys.forward, ["KeyI"]);
        assert.deepEqual(
          controls.keys.backward,
          gestures.DEFAULT_MOVEMENT_KEYS.backward,
        );
        const { press } = keyboardFor(controls);
        press("KeyW");
        run(controls, 0.5);
        assert.deepEqual(controls.getPosition([], true), [0, 0, 0]);
        press("KeyI");
        run(controls, 0.5);
        assert.ok(controls.getPosition([], true)[2] < -0.5);
        // Defaults are not shared between instances.
        controls.keys.left.push("KeyJ");
        assert.ok(!new Controls().keys.left.includes("KeyJ"));
      });

      test("up is normalized and copied", () => {
        const controls = new Controls({ up: [0, 0, 3] });
        assert.deepEqual(controls.up, [0, 0, 1]);
        controls.up[2] = 2;
        assert.deepEqual(controls.up, [0, 0, 1]);
        controls.update(0);
        // The pose carries the camera up: level for walking, free for flying.
        closeVec(controls.pose.up, upOf(controls.pose.orientation));
        if (Controls === FirstPersonControls) {
          closeVec(controls.pose.up, [0, 0, 1]);
        }
      });

      test("zoom is clamped by gestures, methods and state", () => {
        const controls = new Controls({ zoomBounds: [0.5, 4] });
        controls.zoomTo(10, false);
        assert.equal(controls.getZoom(), 4);
        controls.applyAction("zoom", pinchGesture({ scale: 0.01 }));
        assert.equal(controls.getZoom(true), 0.5);
        controls.applyAction(
          "zoom",
          wheelGesture({ delta: [0, -1 / gestures.PIXEL_DOLLY] }),
        );
        close(controls.getZoom(true), 0.5 * Math.E);
        controls.setState({ ...controls.getState(), zoom: 100 }, false);
        assert.equal(controls.getZoom(), 4);
        assert.equal(controls.update(1), true);
        assert.equal(controls.pose.zoom, 4);
      });

      test("constrain applies to every position change", () => {
        const floor = (position) => {
          position[1] = Math.max(position[1], 1);
        };
        const controls = new Controls({
          position: [0, 5, 0],
          constrain: floor,
        });
        controls.setPosition([0, -3, 0], false);
        assert.equal(controls.getPosition()[1], 1);
        controls.setPosition([0, 5, 0], false);
        controls.applyAction(
          "pedestal",
          gesture({ deltaNormalized: [0, -10] }),
        );
        assert.equal(controls.getPosition([], true)[1], 1);
        controls.setState({ ...controls.getState(), position: [2, -9, 0] });
        assert.deepEqual(controls.getPosition([], true), [2, 1, 0]);
        const { press } = keyboardFor(controls);
        press("KeyQ");
        run(controls, 1);
        assert.equal(controls.getPosition([], true)[1], 1);
      });

      test("truck, pedestal and dolly gestures", () => {
        const controls = new Controls({ speed: 1 });
        controls.applyAction(
          "truck-pedestal",
          gesture({ deltaNormalized: [0.5, 0.5] }),
        );
        closeVec(controls.getPosition([], true), [-1, 1, 0]);
        controls.applyAction(
          "pedestal",
          gesture({ deltaNormalized: [9, 0.5] }),
        );
        closeVec(controls.getPosition([], true), [-1, 2, 0]);
        controls.applyAction(
          "dolly",
          wheelGesture({ delta: [0, 0.5 / gestures.PIXEL_DOLLY] }),
        );
        closeVec(controls.getPosition([], true), [-1, 2, 1]);
        controls.applyAction("dolly", pinchGesture({ scale: Math.E }));
        closeVec(controls.getPosition([], true), [-1, 2, -1]);
      });

      test("transitions settle exactly on the end", () => {
        const controls = new Controls();
        controls.setPosition([1, 2, 3]).zoomTo(2);
        assert.ok(settle(controls) < 1000);
        assert.deepEqual(controls.getPosition(), [1, 2, 3]);
        assert.equal(controls.getZoom(), 2);
        assert.equal(controls.update(1 / 60), false);
      });

      test("stop jumps to the end", () => {
        const controls = new Controls();
        controls.setPosition([4, 0, 0]).zoomTo(3);
        controls.stop();
        assert.deepEqual(controls.getPosition(), [4, 0, 0]);
        assert.equal(controls.getZoom(), 3);
      });

      test("keys are ignored while disabled or detached", () => {
        const controls = new Controls();
        const { press } = keyboardFor(controls);
        press("KeyW");
        controls.enabled = false;
        run(controls, 0.5);
        assert.deepEqual(controls.getPosition(), [0, 0, 0]);
        controls.enabled = true;
        controls.detach();
        run(controls, 0.5);
        assert.deepEqual(controls.getPosition(), [0, 0, 0]);
      });

      test("rests while no key is pressed", () => {
        const controls = new Controls();
        const events = listen(controls, ["controlstart", "controlend", "rest"]);
        const { press, release } = keyboardFor(controls);
        settle(controls);
        press("KeyD");
        run(controls, 0.25);
        release("KeyD");
        assert.ok(settle(controls) < 1000);
        assert.deepEqual(events, [
          "rest",
          "controlstart",
          "controlend",
          "rest",
        ]);
      });
    });
  }
});

describe("FirstPersonControls edge cases", () => {
  test("current and end angles", () => {
    const controls = new FirstPersonControls();
    controls.panTilt(1, 0.5);
    assert.deepEqual(controls.getPanTilt(), [0, 0]);
    assert.deepEqual(controls.getPanTilt(true), [1, 0.5]);
    controls.panTilt(0.5, 0.25);
    assert.deepEqual(controls.getPanTilt(true), [1.5, 0.75]);
  });

  test("lookAt its own position does nothing", () => {
    const controls = new FirstPersonControls({ position: [1, 2, 3] });
    controls.panTiltTo(0.4, 0.2, false);
    const events = listen(controls, ["transitionstart"]);
    controls.lookAt([1, 2, 3]);
    assert.deepEqual(controls.getPanTilt(true), [0.4, 0.2]);
    assert.deepEqual(events, []);
  });

  test("lookAt straight up or down keeps the pan", () => {
    for (const [target, sign] of [
      [[0, 5, 0], 1],
      [[0, -5, 0], -1],
    ]) {
      const controls = new FirstPersonControls();
      controls.panTiltTo(0.7, 0, false);
      controls.lookAt(target, false);
      const [pan, tilt] = controls.getPanTilt(true);
      assert.equal(pan, 0.7);
      close(tilt, sign * controls.tiltBounds[1]);
    }
  });

  test("lookAt takes the nearest turn", () => {
    const controls = new FirstPersonControls();
    controls.panTiltTo(4 * Math.PI + 0.1, 0, false);
    controls.lookAt([0, 0, -1], false);
    close(controls.getPanTilt(true)[0], 4 * Math.PI);
  });

  test("lookAt with a custom up", () => {
    const controls = new FirstPersonControls({
      up: [0, 0, 1],
      target: [0, 4, 0],
    });
    controls.update(0);
    closeVec(forward(controls.pose.orientation), [0, 1, 0]);
    closeVec(upOf(controls.pose.orientation), [0, 0, 1]);
  });

  test("state round trip", () => {
    const controls = new FirstPersonControls({ position: [1, 1, 1] });
    controls.panTiltTo(0.3, -0.2, false).zoomTo(2, false);
    const state = controls.getState();
    assert.deepEqual(state, {
      position: [1, 1, 1],
      pan: 0.3,
      tilt: -0.2,
      zoom: 2,
    });
    controls.reset(false);
    assert.deepEqual(controls.getPanTilt(), [0, 0]);
    controls.setState(state, false);
    assert.deepEqual(controls.getState(), state);
    // State tilt obeys the bounds.
    controls.setState({ ...state, tilt: 5 }, false);
    assert.equal(controls.getPanTilt()[1], controls.tiltBounds[1]);
  });

  test("raw look without smoothing", () => {
    const controls = new FirstPersonControls({ lookSmoothTime: 0 });
    controls.panTilt(0.5, 0.1);
    controls.update(1 / 60);
    const [pan, tilt] = controls.getPanTilt();
    close(pan, 0.5, 1e-9);
    close(tilt, 0.1, 1e-9);
  });

  test("look rotation snaps to the end at rest", () => {
    const controls = new FirstPersonControls();
    controls.panTilt(0.5, 0.2);
    assert.ok(settle(controls) < 1000);
    assert.deepEqual(controls.getPanTilt(), controls.getPanTilt(true));
  });

  test("position rests relative to the lens near plane or size", () => {
    const frames = (lens) => {
      const controls = new FirstPersonControls({ lens });
      settle(controls);
      return settle(controls.move(0, 0, 1));
    };
    const fallback = frames();
    assert.ok(frames(new PerspectiveCamera({ near: 0.01 })) > fallback);
    assert.ok(frames(new OrthographicCamera({ size: 100 })) < fallback);
    assert.equal(frames({ type: "perspective", aspect: 1 }), fallback);
  });

  test("look speed scales with the zoomed field of view", () => {
    const lens = new PerspectiveCamera({ fov: 1 });
    const turn = (zoom) => {
      const controls = new FirstPersonControls({ lens });
      controls.zoomTo(zoom, false);
      controls.applyAction("pan-tilt", gesture({ deltaNormalized: [0.1, 0] }));
      return controls.getPanTilt(true)[0];
    };
    close(turn(1), -0.1);
    close(turn(2), -0.2 * Math.atan(Math.tan(0.5) / 2));
    // Pinches don't turn.
    const controls = new FirstPersonControls();
    controls.applyAction("pan-tilt", pinchGesture({ scale: 2 }));
    assert.deepEqual(controls.getPanTilt(true), [0, 0]);
  });

  test("head bob follows walking and fades out", () => {
    const controls = new FirstPersonControls({
      position: [0, 1.7, 0],
      headBobAmplitude: 0.1,
    });
    const { press, release } = keyboardFor(controls);
    press("KeyW");
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < 120; i++) {
      controls.update(1 / 60);
      lowest = Math.min(lowest, controls.pose.position[1]);
      highest = Math.max(highest, controls.pose.position[1]);
    }
    assert.ok(highest - lowest > 0.1, `bob ${highest - lowest}`);
    assert.ok(highest <= 1.8 + 1e-9 && lowest >= 1.6 - 1e-9);
    // The position itself never bobs.
    close(controls.getPosition()[1], 1.7, 1e-12);

    release("KeyW");
    assert.ok(settle(controls) < 1000);
    close(controls.pose.position[1], 1.7, 1e-12);
  });

  test("head bob with a zero speed stays finite", () => {
    const controls = new FirstPersonControls({ speed: 0, headBobAmplitude: 1 });
    controls.setPosition([5, 0, 0]);
    for (let i = 0; i < 30; i++) controls.update(1 / 60);
    assert.ok(controls.pose.position.every(Number.isFinite));
    close(controls.pose.position[1], 0, 1e-12);
  });

  test("head bob skips empty frames", () => {
    const controls = new FirstPersonControls({ headBobAmplitude: 0.1 });
    controls.setPosition([0, 0, -1]);
    controls.update(0);
    assert.ok(controls.pose.position.every(Number.isFinite));
  });
});

describe("FlyControls edge cases", () => {
  test("pan-tilt looks in the pointer direction, locked or dragging", () => {
    for (const input of [
      gesture({ deltaNormalized: [0.1, 0.1] }),
      locked({ deltaNormalized: [0.1, 0.1] }),
    ]) {
      const controls = new FlyControls();
      controls.applyAction("pan-tilt", input);
      controls.stop().update(0);
      const look = forward(controls.pose.orientation);
      assert.ok(look[0] > 0 && look[1] < 0, "right and down");
    }
  });

  test("pan-tilt keeps the horizon level while levelling, rolls in 6DoF", () => {
    const rollOf = (autoLevel) => {
      const controls = new FlyControls({
        position: [0, 3, 5],
        target: [0, 0, 0],
        autoLevel,
      });
      controls.applyAction("pan-tilt", gesture({ deltaNormalized: [-0.3, 0] }));
      controls.stop().update(0);
      return vec3.multQuat([1, 0, 0], controls.pose.orientation)[1];
    };
    close(rollOf(true), 0);
    assert.ok(rollOf(false) < 0, "the top leans right looking down");
  });

    test("roll from drags, twists and wheels", () => {
    const roll = (input) => {
      const controls = new FlyControls();
      controls.applyAction("roll", input);
      controls.stop().update(0);
      closeVec(forward(controls.pose.orientation), [0, 0, -1]);
      return Math.atan2(
        -upOf(controls.pose.orientation)[0],
        upOf(controls.pose.orientation)[1],
      );
    };
    close(roll(gesture({ deltaNormalized: [0.1, 0] })), -0.1 * Math.PI);
    close(roll(pinchGesture({ rotation: 0.3 })), -0.3);
    close(roll(wheelGesture({ deltaNormalized: [0.1, 0] })), -0.1 * Math.PI);
    close(roll(gesture({ deltaNormalized: [0, 0.5] })), 0);
  });

  test("roll keys turn at rollSpeed, both cancel out", () => {
    const controls = new FlyControls({
      rollSpeed: 0.5,
      lookSmoothTime: 0,
      autoLevel: false,
    });
    const { press, release } = keyboardFor(controls);
    press("KeyQ");
    run(controls, 0.5);
    const up = upOf(controls.getOrientation([], true));
    close(Math.atan2(-up[0], up[1]), 0.25 * gestures.KEY_TURN_SPEED, 1e-9);
    press("KeyE");
    const before = controls.getOrientation([], true);
    run(controls, 0.5);
    closeVec(controls.getOrientation([], true), before, 1e-12);
    release("KeyQ", "KeyE");
    assert.ok(settle(controls) < 1000);

    controls.enabled = false;
    press("KeyQ");
    run(controls, 0.5);
    closeVec(controls.getOrientation([], true), before, 1e-12);
  });

  test("starts level in its up space", () => {
    const controls = new FlyControls({ up: [0, 0, 1] });
    controls.update(0);
    closeVec(forward(controls.pose.orientation), [0, 1, 0]);
    closeVec(controls.pose.up, [0, 0, 1]);
  });

  test("orientation getters and setters", () => {
    const controls = new FlyControls();
    controls.setOrientation([0, 2, 0, 0]);
    closeVec(controls.getOrientation(), [0, 0, 0, 1]);
    assert.deepEqual(controls.getOrientation([], true), [0, 1, 0, 0]);
    settle(controls);
    closeVec(controls.getOrientation(), [0, 1, 0, 0], 1e-9);
  });

  test("lookAt keeps the roll, level removes it", () => {
    const controls = new FlyControls();
    controls.rotate(0, 0, 0.5, false);
    // Roll around the old view axis only carries over to nearby directions.
    controls.lookAt([1, 0, -5], false);
    controls.update(0);
    const direction = [1, 0, -5].map((v) => v / Math.hypot(1, 5));
    closeVec(forward(controls.pose.orientation), direction);
    assert.ok(upOf(controls.pose.orientation)[0] < -0.3, "still rolled");

    controls.level(false);
    controls.update(0);
    closeVec(forward(controls.pose.orientation), direction);
    // Level: the right axis is horizontal.
    close(rightOf(controls.pose.orientation)[1], 0);
  });

  test("Q and E roll instead of moving, Space and C move", () => {
    const controls = new FlyControls({ lookSmoothTime: 0 });
    const { press, release } = keyboardFor(controls);
    press("KeyE");
    run(controls, 0.5);
    closeVec(controls.getPosition([], true), [0, 0, 0]);
    release("KeyE");
    press("Space");
    run(controls, 0.5);
    assert.ok(controls.getPosition([], true)[1] > 0, "up");
  });

  test("auto level rolls upright and rests, Z toggles it", () => {
    const controls = new FlyControls({ lookSmoothTime: 0 });
    const { press, release } = keyboardFor(controls);
    controls.rotate(0.4, 0.3, 0.5, false);
    assert.ok(settle(controls) < 1500);
    close(rightOf(controls.getOrientation([], true))[1], 0, 1e-3);

    // Held roll keys win over levelling.
    press("KeyQ");
    run(controls, 0.5);
    release("KeyQ");
    press("KeyZ");
    run(controls, 0.1);
    release("KeyZ");
    assert.equal(controls.autoLevel, false);
    const rolled = rightOf(controls.getOrientation([], true))[1];
    assert.ok(Math.abs(rolled) > 0.1);
    settle(controls);
    close(rightOf(controls.getOrientation([], true))[1], rolled);

    press("KeyZ");
    run(controls, 0.1);
    assert.equal(controls.autoLevel, true);
  });

  test("auto level skips looking along up", () => {
    const controls = new FlyControls({ target: [0, 5, 0] });
    const before = controls.getOrientation([], true);
    run(controls, 0.5);
    closeVec(controls.getOrientation([], true), before);
  });

  test("level while looking along up stays finite", () => {
    const controls = new FlyControls({ target: [0, 5, 0] });
    controls.level(false);
    controls.update(0);
    assert.ok(controls.pose.orientation.every(Number.isFinite));
    closeVec(forward(controls.pose.orientation), [0, 1, 0]);
  });

  test("state round trip", () => {
    const controls = new FlyControls({ position: [1, 2, 3] });
    controls.rotate(0.3, 0.2, 0.1, false).zoomTo(1.5, false);
    const state = controls.getState();
    controls.reset(false);
    assert.deepEqual(
      controls.getPosition(),
      [0, 0, 0].map((_, i) => i + 1),
    );
    closeVec(controls.getOrientation(), [0, 0, 0, 1]);
    controls.setState(state, false);
    assert.deepEqual(controls.getState(), state);
  });

  test("rotations are around the camera's own axes", () => {
    const controls = new FlyControls();
    controls.rotate(Math.PI / 2, 0, 0, false);
    controls.rotate(0, Math.PI / 2, 0, false);
    controls.update(0);
    // Turned left, then tilted up around the new right axis.
    closeVec(forward(controls.pose.orientation), [0, 1, 0]);
    closeVec(rightOf(controls.pose.orientation), [0, 0, -1]);
  });
});

describe("TrackballControls edge cases", () => {
  test("current and end getters", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.moveTo([1, 0, 0]).dollyTo(3).zoomTo(2);
    assert.deepEqual(controls.getTarget(), [0, 0, 0]);
    assert.deepEqual(controls.getTarget([], true), [1, 0, 0]);
    assert.equal(controls.getDistance(), 5);
    assert.equal(controls.getDistance(true), 3);
    assert.equal(controls.getZoom(), 1);
    assert.equal(controls.getZoom(true), 2);
    closeVec(controls.getPosition(), [0, 0, 5]);
    closeVec(controls.getPosition([], true), [1, 0, 3]);
  });

  test("rotate around a camera axis keeps the distance", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.rotate([0, 1, 0], Math.PI / 2, false);
    closeVec(controls.getPosition(), [-5, 0, 0]);
    controls.update(0);
    closeVec(forward(controls.pose.orientation), [1, 0, 0]);
  });

  test("roll turns the view counter-clockwise without moving", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.roll(Math.PI / 2, false);
    closeVec(controls.getPosition(), [0, 0, 5]);
    controls.update(0);
    closeVec(upOf(controls.pose.orientation), [-1, 0, 0]);
    closeVec(controls.pose.up, [-1, 0, 0]);
  });

  test("setLookAt keeps the current camera up unless given one", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.roll(Math.PI / 2, false);
    controls.setLookAt([0, 0, 6], [0, 0, 0], undefined, false);
    controls.update(0);
    closeVec(upOf(controls.pose.orientation), [-1, 0, 0]);
    controls.setLookAt([0, 0, 6], [0, 0, 0], [0, 1, 0], false);
    controls.update(0);
    closeVec(upOf(controls.pose.orientation), [0, 1, 0]);
  });

  test("bounds clamp methods, gestures and state", () => {
    const controls = new TrackballControls({
      position: [0, 0, 5],
      distanceBounds: [2, 8],
      zoomBounds: [0.5, 2],
    });
    controls.dollyTo(100, false);
    assert.equal(controls.getDistance(), 8);
    controls.zoomTo(0, false);
    assert.equal(controls.getZoom(), 0.5);
    controls.applyAction("dolly", pinchGesture({ scale: 100 }));
    assert.equal(controls.getDistance(true), 2);
    controls.applyAction("zoom", pinchGesture({ scale: 100 }));
    assert.equal(controls.getZoom(true), 2);
    controls.setState({ ...controls.getState(), distance: 0, zoom: 9 }, false);
    assert.equal(controls.getDistance(), 2);
    assert.equal(controls.getZoom(), 2);
  });

  test("truck in the screen plane", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.roll(Math.PI / 2, false);
    controls.truck(1, 2, false);
    // Rolled: screen right is world +Y, screen up is world -X.
    closeVec(controls.getTarget(), [-2, 1, 0]);
    controls.applyAction(
      "truck-pedestal",
      gesture({ deltaNormalized: [0, 0.1] }),
    );
    assert.ok(controls.getTarget([], true)[0] < -2);
  });

  test("fits a sphere with either lens", () => {
    const perspective = new TrackballControls({
      lens: new PerspectiveCamera({ fov: Math.PI / 2, aspect: 2 }),
    });
    perspective.fitToSphere([1, 1, 1], 1, false);
    close(perspective.getDistance(), Math.SQRT2);
    closeVec(perspective.getTarget(), [1, 1, 1]);

    const orthographic = new TrackballControls({
      lens: new OrthographicCamera({ size: 2, aspect: 0.5 }),
    });
    orthographic.fitToSphere([0, 0, 0], 0.5, false);
    close(orthographic.getZoom(), 2);
  });

  test("dolly zooms orthographic lenses", () => {
    const controls = new TrackballControls({
      lens: new OrthographicCamera(),
      position: [0, 0, 5],
    });
    controls.applyAction(
      "dolly",
      wheelGesture({ delta: [0, -1 / gestures.PIXEL_DOLLY] }),
    );
    close(controls.getZoom(true), Math.E);
    assert.equal(controls.getDistance(true), 5);
  });

  test("dolly to cursor moves the target towards the cursor", () => {
    for (const lens of [new PerspectiveCamera(), new OrthographicCamera()]) {
      const controls = new TrackballControls({
        lens,
        position: [0, 0, 5],
        dollyToCursor: true,
      });
      controls.applyAction(
        "dolly",
        wheelGesture({ ndc: [1, -1], delta: [0, -0.5 / gestures.PIXEL_DOLLY] }),
      );
      const [x, y] = controls.getTarget([], true);
      assert.ok(x > 0 && y < 0, `${lens.type} target ${x}, ${y}`);
      close(x, -y);
    }
  });

  test("roll gestures from drags, twists and wheels", () => {
    const rollOf = (input) => {
      const controls = new TrackballControls({ position: [0, 0, 5] });
      controls.applyAction("roll", input);
      controls.stop().update(0);
      const up = upOf(controls.pose.orientation);
      return Math.atan2(-up[0], up[1]);
    };
    close(rollOf(pinchGesture({ rotation: 0.3 })), -0.3);
    close(rollOf(gesture({ deltaNormalized: [0.1, 0] })), 0.1 * Math.PI);
    close(rollOf(wheelGesture({ deltaNormalized: [0.1, 0] })), -0.1 * Math.PI);
  });

  test("dragging between opposite rim points stays finite", () => {
    for (const mode of ["shoemake", "bell"]) {
      const controls = new TrackballControls({ mode, position: [0, 0, 5] });
      controls.applyAction(
        "rotate",
        gesture({ ndc: [2, 0], deltaNormalized: [2, 0] }),
      );
      assert.ok(controls.getOrientation([], true).every(Number.isFinite));
      close(Math.hypot(...controls.getOrientation([], true)), 1);
    }
  });

  test("tiny drags rotate accurately", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.applyAction(
      "rotate",
      gesture({ ndc: [0.2, 0.1], deltaNormalized: [1e-12, 0] }),
    );
    const orientation = controls.getOrientation([], true);
    assert.ok(orientation.every(Number.isFinite));
    // Turning the scene right turns the camera left, around its up axis.
    assert.ok(orientation[1] < 0 && orientation[1] > -1e-11);
  });

  test("ball projection: inside, rim and outside", () => {
    const controls = new TrackballControls({ radius: 2 });
    closeVec(controls.projectOnBall([0, 0, 0], [0, 0]), [0, 0, 1]);
    closeVec(controls.projectOnBall([0, 0, 0], [2, 0]), [1, 0, 0]);
    closeVec(controls.projectOnBall([0, 0, 0], [0, -4]), [0, -1, 0]);
    controls.mode = "bell";
    // Bell keeps sheet points unnormalized: z = (1 / 2) / r.
    closeVec(controls.projectOnBall([0, 0, 0], [0, -4]), [0, -2, 0.25]);
  });

  test("settles exactly and resets", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.rotate([1, 0, 0], 0.5).dollyTo(3).zoomTo(2).moveTo([1, 0, 0]);
    assert.ok(settle(controls) < 1000);
    assert.deepEqual(
      controls.getOrientation(),
      controls.getOrientation([], true),
    );
    assert.equal(controls.getDistance(), 3);
    controls.reset(false);
    closeVec(controls.getPosition(), [0, 0, 5]);
  });
});

describe("TrackballControls input", () => {
  test("drags damp with the dragging smooth time", () => {
    const element = new FakeElement();
    const input = new PointerManager(element).enable();
    const lens = new PerspectiveCamera({ aspect: 4 / 3 });
    const run = (draggingSmoothTime) => {
      const controls = new TrackballControls({
        lens,
        position: [0, 0, 5],
        draggingSmoothTime,
        inertia: 0,
      }).attach(input);
      const mouse = { pointerId: 1, pointerType: "mouse", buttons: 1 };
      element.dispatchEvent(
        createEvent("pointerdown", { ...mouse, clientX: 400, clientY: 300 }),
      );
      element.dispatchEvent(
        createEvent("pointermove", { ...mouse, clientX: 460, clientY: 300 }),
      );
      controls.update(1 / 60);
      const angle = 2 * Math.acos(Math.abs(controls.getOrientation()[3]));
      element.dispatchEvent(
        createEvent("pointerup", { ...mouse, buttons: 0, clientX: 460 }),
      );
      controls.dispose();
      return angle;
    };
    assert.ok(run(0.01) > run(1));
  });

  test("dolly to cursor without a lens", () => {
    const controls = new TrackballControls({
      position: [0, 0, 5],
      dollyToCursor: true,
    });
    controls.applyAction(
      "dolly",
      wheelGesture({ ndc: [1, 0], delta: [0, -0.5 / gestures.PIXEL_DOLLY] }),
    );
    const [x, y] = controls.getTarget([], true);
    assert.ok(x > 0);
    close(y, 0);
  });
});

describe("TrackballControls target features", () => {
  test("pan and tilt rotate around the camera", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.pan(Math.PI / 2, false);
    closeVec(controls.getPosition(), [0, 0, 5]);
    closeVec(controls.getTarget(), [-5, 0, 5]);
    controls.tilt(Math.PI / 2, false);
    closeVec(controls.getPosition(), [0, 0, 5]);
    closeVec(controls.getTarget(), [0, 5, 5]);
    controls.applyAction("pan-tilt", gesture({ deltaNormalized: [0.1, 0] }));
    closeVec(controls.getPosition([], true), [0, 0, 5]);
  });

  test("placement keeps the camera up", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.roll(Math.PI / 2, false);
    controls.setPosition([0, 5, 0], false);
    controls.update(0);
    closeVec(forward(controls.pose.orientation), [0, -1, 0]);
    closeVec(controls.pose.up, [-1, 0, 0]);
    controls.setTarget([0, 5, -5], false);
    closeVec(controls.getPosition(), [0, 5, 0]);
    close(controls.getDistance(), 5);
  });

  test("focal offset, boundary and collisions", () => {
    const controls = new TrackballControls({
      position: [0, 0, 5],
      boundary: [
        [-1, -1, -1],
        [1, 1, 1],
      ],
      collide: () => 2,
    });
    controls.truck(5, 0, false);
    closeVec(controls.getTarget(), [1, 0, 0]);
    controls.setFocalOffset([1, 0, 0], false).update(0);
    closeVec(controls.pose.position, [2, 0, 2]);
  });
});

describe("TrackballControls bell chord", () => {
  // Rotation of a radial drag step, in half viewport heights.
  const radialTurn = (mode, distance, step = 0.01) => {
    const controls = new TrackballControls({ mode, position: [0, 0, 5] });
    controls.applyAction(
      "rotate",
      gesture({ ndc: [distance, 0], deltaNormalized: [step / 2, 0] }),
    );
    return 2 * Math.acos(Math.min(1, controls.getOrientation([], true)[3]));
  };

  test("rotates by the arc on the sphere", () => {
    close(radialTurn("bell", 0.3), radialTurn("shoemake", 0.3) / 2, 1e-5);
  });

  test("keeps turning with the drag on the sheet", () => {
    // Bell's sheet flattens: the chord tends to the drag length.
    close(radialTurn("bell", 3), 0.01, 1e-4);
    close(radialTurn("bell", 1.5), 0.01, 5e-4);
  });

  test("clamps chords longer than the diameter", () => {
    const controls = new TrackballControls({
      mode: "bell",
      position: [0, 0, 5],
    });
    controls.applyAction(
      "rotate",
      gesture({ ndc: [0, 0], deltaNormalized: [5, 0] }),
    );
    assert.ok(controls.getOrientation([], true).every(Number.isFinite));
  });
});

describe("TrackballControls lerp", () => {
  const aroundY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];

  test("slerps the orientation and eerps the distance", () => {
    const controls = new TrackballControls();
    const from = { target: [0, 0, 0], distance: 4, orientation: aroundY(0) };
    const to = { target: [2, 0, 0], distance: 16, orientation: aroundY(1) };
    controls.lerp(from, to, 0.5, false);
    closeVec(controls.getOrientation(), aroundY(0.5));
    close(controls.getDistance(), 8);
    closeVec(controls.getTarget(), [1, 0, 0]);
    controls.lerp(from, to, 1, false);
    closeVec(controls.getOrientation(), aroundY(1));
    close(controls.getDistance(), 16);
  });

  test("position states look at their target with the camera up", () => {
    const controls = new TrackballControls();
    controls.lerp(
      { target: [0, 0, 0], position: [0, 0, 5] },
      { target: [0, 0, 0], position: [5, 0, 0] },
      0.5,
      false,
    );
    closeVec(controls.getPosition(), [5 * Math.SQRT1_2, 0, 5 * Math.SQRT1_2]);
    controls.update(0);
    closeVec(controls.pose.up, [0, 1, 0]);
  });

  test("takes the short way and keeps the orientation of degenerate states", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.lerp(
      { target: [0, 0, 0], distance: 5, orientation: aroundY(Math.PI - 0.1) },
      { target: [0, 0, 0], distance: 5, orientation: aroundY(-Math.PI + 0.1) },
      0.5,
      false,
    );
    closeVec(controls.getPosition(), [0, 0, -5]);

    const before = controls.getOrientation();
    controls.lerp(
      { target: [0, 0, 0], distance: 5, orientation: [0, 0, 0, 0] },
      { target: [0, 0, 0], position: [0, 0, 0] },
      0.5,
      false,
    );
    closeVec(controls.getOrientation(), before);
    assert.ok(controls.getDistance() > 0);
  });
});

describe("setPose", () => {
  const position = [1, 2, 3];
  // A quarter turn left, tilted down: what every controller can represent.
  const orientation = quat.mult(
    quat.fromAxisAngle(quat.create(), [0, 1, 0], Math.PI / 2),
    quat.fromAxisAngle(quat.create(), [1, 0, 0], -0.3),
  );
  const rolled = quat.mult(
    quat.set(quat.create(), orientation),
    quat.fromAxisAngle(quat.create(), [0, 0, 1], 0.4),
  );
  const poseAfter = (controls) => {
    controls.update(0);
    return controls.pose;
  };

  for (const Controls of [
    OrbitControls,
    MapControls,
    TrackballControls,
    FirstPersonControls,
    FlyControls,
  ]) {
    describe(Controls.name, () => {
      test("lands at the position, looking along the orientation", () => {
        const controls = new Controls({ position: [0, 0, 5] });
        settle(controls.setPose(position, orientation));
        const pose = poseAfter(controls);
        closeVec(pose.position, position);
        closeVec(forward(pose.orientation), forward(orientation));
      });

      test("keeps the zoom", () => {
        const controls = new Controls({ position: [0, 0, 5] });
        controls.zoomTo(2, false).setPose(position, orientation, false);
        assert.equal(controls.getZoom(), 2);
      });
    });
  }

  for (const Controls of [OrbitControls, TrackballControls]) {
    describe(Controls.name, () => {
      test("keeps the distance and focal offset: the target follows", () => {
        const controls = new Controls({ position: [0, 0, 5] });
        controls.setFocalOffset([1, 2, 0], false);
        controls.setPose(position, rolled, false);
        close(controls.getDistance(), 5);
        closeVec(controls.getFocalOffset(), [1, 2, 0]);
        closeVec(poseAfter(controls).position, position);
      });
    });
  }

  test("trackball and fly keep the roll", () => {
    for (const Controls of [TrackballControls, FlyControls]) {
      const controls = new Controls({ position: [0, 0, 5] });
      controls.setPose(position, rolled, false);
      closeVec(upOf(poseAfter(controls).orientation), upOf(rolled));
    }
  });

  test("orbit and first person drop it", () => {
    for (const Controls of [OrbitControls, FirstPersonControls]) {
      const controls = new Controls({ position: [0, 0, 5] });
      controls.setPose(position, rolled, false);
      closeVec(upOf(poseAfter(controls).orientation), upOf(orientation));
    }
  });
});
