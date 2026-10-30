import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  FirstPersonControls,
  FlyControls,
  OrbitControls,
  TrackballControls,
} from "../lib/controls/index.js";
import { Emitter, pose as poseUtils, quatLookAt } from "../lib/core/index.js";
import { PointerManager } from "../lib/input/index.js";
import {
  Composer,
  HANDHELD_FOV,
  HANDHELD_LAYERS,
  Handheld,
  RailRig,
  Sequence,
  interpolateShots,
  zoomPan,
} from "../lib/rigs/index.js";
import { OrthographicCamera, PerspectiveCamera } from "../lib/camera/index.js";
import FakeElement, { createEvent } from "./helpers/fake-element.js";
import {
  close,
  closeVec,
  distance,
  forward,
  settle,
  gesture,
} from "./helpers/utils.js";

describe("code review regressions", () => {
  test("a sequence playing forward doesn't end on a zero dt frame", () => {
    const sequence = new Sequence({
      shots: [
        { shot: { position: [0, 0, 5], target: [0, 0, 0] }, hold: 1 },
        { shot: { position: [5, 0, 0], target: [0, 0, 0] }, duration: 1 },
      ],
    });
    let ended = false;
    sequence.on("end", () => (ended = true));
    sequence.play().update(0);
    assert.equal(sequence.playing, true);
    assert.equal(ended, false);

    // Reverse playback ends at 0.
    sequence.seek(0.5);
    sequence.speed = -1;
    settle(sequence, 1 / 30);
    assert.equal(ended, true);
    assert.equal(sequence.time, 0);
  });

  test("seeking a closed rail goes to the nearest lap", () => {
    const rail = new RailRig({
      points: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 4],
        [0, 0, 4],
      ].flat(),
      closed: true,
    });
    // Play almost three laps.
    rail.speed = rail.spline.length * 2.9;
    rail.play().update(1);
    rail.pause();
    settle(rail);
    close(rail.progress, 2.9, 1e-4);

    rail.seek(0.1);
    settle(rail);
    close(rail.progress, 3.1);
  });

  test("rail playback is frame rate independent", () => {
    const play = (hz) => {
      const rail = new RailRig({
        points: [
          [0, 0, 0],
          [4, 0, 0],
          [4, 0, 4],
          [0, 0, 4],
        ].flat(),
        closed: true,
        speed: 3,
      }).play();
      for (let i = 0; i < hz; i++) rail.update(1 / hz);
      return rail.progress;
    };
    close(play(30), play(144), 1e-9);
  });

  test("cancelling a fast drag doesn't fling", () => {
    const element = new FakeElement();
    const input = new PointerManager(element).enable();
    const controls = new OrbitControls({ position: [0, 0, 5] }).attach(input);
    const ends = [];
    input.on("end", ({ velocity }) => ends.push(velocity));
    let controlEnded = false;
    controls.on("controlend", () => (controlEnded = true));

    const mouse = {
      pointerId: 1,
      pointerType: "mouse",
      buttons: 1,
      clientY: 300,
    };
    element.dispatchEvent(
      createEvent("pointerdown", { ...mouse, clientX: 300 }, 1000),
    );
    for (let i = 1; i <= 5; i++) {
      element.dispatchEvent(
        createEvent(
          "pointermove",
          { ...mouse, clientX: 300 + i * 10 },
          1000 + i * 10,
        ),
      );
    }
    input.cancel();

    assert.deepEqual(ends.at(-1), [0, 0]);
    assert.equal(controlEnded, true);
    assert.equal(controls.userControlling, false);
  });

  test("steering gestures don't emit transitionstart", () => {
    for (const Controls of [FirstPersonControls, FlyControls]) {
      const controls = new Controls();
      let transitions = 0;
      controls.on("transitionstart", () => transitions++);
      controls.applyAction(
        "truck-dolly",
        gesture({ deltaNormalized: [0.1, 0.1] }),
      );
      controls.applyAction(
        "dolly",
        gesture({ type: "wheel", deltaNormalized: [0, 0.1], device: "mouse" }),
      );
      assert.equal(transitions, 0, Controls.name);
      controls.move(0, 0, 1);
      assert.equal(transitions, 1, Controls.name);
    }
  });

  test("the returned function removes once listeners", () => {
    class Source extends Emitter {
      fire() {
        this.emit("event", {});
      }
    }
    const source = new Source();
    let calls = 0;
    const listener = () => calls++;
    const off = source.on("event", listener, { once: true });
    off();
    source.fire();
    assert.equal(calls, 0);
  });

  test("trackball rotate normalizes the axis", () => {
    const [unit, scaled] = [
      [0, 1, 0],
      [0, 3, 0],
    ].map((axis) => {
      const controls = new TrackballControls({ position: [0, 0, 5] });
      controls.rotate(axis, Math.PI / 2, false).update(0);
      return controls.pose.orientation;
    });
    closeVec(scaled, unit);
  });

  test("composer pans around a normalized up", () => {
    const [unit, scaled] = [
      [0, 1, 0],
      [0, 3, 0],
    ].map((up) => {
      const composer = new Composer({
        lens: new PerspectiveCamera({ fov: 1, aspect: 1 }),
        subject: [6, 0, 0],
      });
      const input = poseUtils.create();
      input.position = [0, 0, 10];
      input.up = up;
      composer.update(input, 1 / 60);
      return composer.pose.orientation;
    });
    assert.notDeepEqual(unit, [0, 0, 0, 1]);
    closeVec(scaled, unit);
  });

  test("composer projects with the pose's zoom and fov", () => {
    const composer = new Composer({
      lens: new PerspectiveCamera({ fov: 1, aspect: 1 }),
      subject: [1, 0, 0],
    });
    const input = poseUtils.create();
    input.position = [0, 0, 10];
    const base = composer.project(input)[0];
    close(composer.project({ ...input, zoom: 2 })[0], base * 2);
    close(
      composer.project({ ...input, fov: 0.5 })[0],
      (base * Math.tan(0.5)) / Math.tan(0.25),
    );
  });

  test("head bob doesn't start from a teleport", () => {
    const controls = new FirstPersonControls({
      position: [0, 1.7, 5],
      headBobAmplitude: 0.1,
    });
    for (let i = 0; i < 10; i++) controls.update(1 / 60);
    close(controls.pose.position[1], 1.7, 1e-12);

    controls.setPosition([20, 1.7, -20], false);
    for (let i = 0; i < 10; i++) controls.update(1 / 60);
    close(controls.pose.position[1], 1.7, 1e-12);
  });

  test("every controller saves and resets through the base class", () => {
    const controls = new FlyControls({ position: [1, 2, 3] });
    controls.saveState();
    controls.move(5, 0, 0, false).rotate(1, 0, 0, false);
    controls.reset(false);
    assert.deepEqual(controls.getPosition(), [1, 2, 3]);
  });
});

describe("edge case regressions", () => {
  // Deterministic pseudo random angles.
  const angles = (seed) => {
    let state = seed;
    return () => {
      state = (state * 16807) % 2147483647;
      return (state / 2147483647 - 0.5) * 4;
    };
  };

  test("quaternion damping rests for any rotation", () => {
    const random = angles(7);
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = [random(), random(), random()];
      const trackball = new TrackballControls({ position: [0, 0, 5] });
      trackball.rotate(
        [x, y, z].map((v) => v / Math.hypot(x, y, z)),
        x,
      );
      assert.ok(settle(trackball) < 1000, `trackball ${i}`);
      const fly = new FlyControls({ autoLevel: false });
      fly.rotate(x, y, z);
      assert.ok(settle(fly) < 1000, `fly ${i}`);
    }
  });
});

describe("trackball review regressions", () => {
  const twoFingerPan = () =>
    gesture({
      pointerType: "touch",
      pointerCount: 2,
      buttons: 0,
      deltaNormalized: [0.1, 0],
    });

  test("two fingers panning together don't roll", () => {
    for (const Controls of [TrackballControls, FlyControls]) {
      const controls = new Controls({ autoLevel: false });
      const before = controls.getOrientation([], true);
      controls.applyAction("roll", twoFingerPan());
      closeVec(controls.getOrientation([], true), before);
      controls.applyAction("roll", { ...twoFingerPan(), rotation: 0.2 });
      assert.notDeepEqual(controls.getOrientation([], true), before);
    }
  });

  test("orthographic motion rests relative to the view size", () => {
    for (const Controls of [TrackballControls, OrbitControls]) {
      const controls = new Controls({
        position: [0, 0, 100],
        lens: new OrthographicCamera({ size: 0.01 }),
      });
      controls.update(1 / 60);
      controls.truck(0.005, 0);
      assert.equal(controls.update(1 / 60), true, Controls.name);
      assert.ok(controls.pose.target[0] < 0.005, Controls.name);
    }
  });

  test("methods translate in the end frame", () => {
    const trackball = new TrackballControls({ position: [0, 0, 5] });
    trackball.rotate([0, 1, 0], Math.PI / 2).truck(1, 0, false);
    closeVec(trackball.getTarget(), [0, 0, 1]);

    const orbit = new OrbitControls({ position: [0, 0, 5] });
    orbit.arcTo(-Math.PI / 2, 0).truck(1, 0, false);
    closeVec(orbit.getTarget(), [0, 0, 1]);
    orbit.arcTo(0, 0).forward(1, false);
    closeVec(orbit.getTarget(), [0, 0, 0]);
  });

  test("a zero quaternion state keeps the orientation", () => {
    const controls = new TrackballControls({ position: [0, 0, 5] });
    controls.roll(0.5, false);
    const orientation = controls.getOrientation([], true);
    controls.setState(
      { ...controls.getState(), orientation: [0, 0, 0, 0], distance: 3 },
      false,
    );
    closeVec(controls.getOrientation(), orientation);
    close(controls.getDistance(), 3);
  });

  test("trackball drags chain with the input area aspect, whatever the lens", () => {
    const [width, height] = [1600, 900];
    // Closed square loop in CSS pixels, 10 px steps.
    const path = [[800, 450]];
    for (const [dx, dy] of [
      [10, 0],
      [0, -10],
      [-10, 0],
      [0, 10],
    ]) {
      for (let i = 0; i < 20; i++) {
        const [x, y] = path.at(-1);
        path.push([x + dx, y + dy]);
      }
    }
    for (const lens of [undefined, new PerspectiveCamera({ aspect: 1 })]) {
      const controls = new TrackballControls({ position: [0, 0, 5], lens });
      for (let i = 1; i < path.length; i++) {
        const [[px, py], [x, y]] = [path[i - 1], path[i]];
        controls.applyAction(
          "rotate",
          gesture({
            ndc: [(2 * x) / width - 1, 1 - (2 * y) / height],
            aspect: width / height,
            deltaNormalized: [(x - px) / height, (y - py) / height],
          }),
        );
      }
      close(Math.abs(controls.getOrientation([], true)[3]), 1, 1e-12);
    }
  });
});

describe("rigs review regressions", () => {
  const twoShots = (loop) =>
    new Sequence({
      loop,
      shots: [
        { shot: { position: [0, 0, 5], target: [0, 0, 0] }, hold: 1 },
        {
          shot: { position: [5, 0, 0], target: [0, 0, 0] },
          duration: 1,
          hold: 1,
        },
      ],
    });

  test("a sequence seeked every frame wakes and rests once", () => {
    const sequence = twoShots(false);
    const events = [];
    for (const type of ["wake", "rest"]) {
      sequence.on(type, () => events.push(type));
    }
    for (const time of [0.5, 1.5, 2.5]) sequence.seek(time).update(0);
    assert.deepEqual(events, ["wake"]);
    assert.equal(sequence.update(0), false);
    assert.deepEqual(events, ["wake", "rest"]);
  });

  test("evaluate wraps looping time like seek", () => {
    const sequence = twoShots(true);
    const evaluated = poseUtils.create();
    const index = sequence.evaluate(evaluated, 3.5);
    sequence.seek(3.5).update(0);
    assert.equal(sequence.time, 0.5);
    assert.equal(index, 0);
    assert.deepEqual(evaluated, sequence.pose);
  });

  const lens = new PerspectiveCamera({ fov: 0.8, aspect: 1.5 });

  test("zoom-pan stays finite for very different shot sizes", () => {
    const curve = zoomPan(1, 1000, 1.1e-3);
    assert.ok(Number.isFinite(curve.length));
    for (const s of [0, curve.length / 2, curve.length]) {
      assert.ok(curve.at(s).every(Number.isFinite));
    }
    close(curve.at(curve.length)[1], 1000, 1e-6);
  });

  test("a lens value set on one shot holds on the other", () => {
    const from = { position: [0, 0, 5], target: [0, 0, 0] };
    const to = { position: [5, 0, 0], target: [0, 0, 0], fov: 1.4 };
    for (const move of ["linear", "arc", "zoom-pan", "dolly-zoom"]) {
      const start = interpolateShots(poseUtils.create(), from, to, 0, { move });
      closeVec(start.position, from.position);
      assert.equal(start.fov, 1.4);
      const end = interpolateShots(poseUtils.create(), from, to, 1, { move });
      closeVec(end.position, to.position);
    }
  });

  test("a closed rail starts at the given progress", () => {
    const rail = new RailRig({
      points: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 4],
      ].flat(),
      closed: true,
      progress: 0.7,
    });
    assert.equal(rail.progress, 0.7);
  });

  test("the look-ahead target doesn't jump past an open rail end", () => {
    const rail = new RailRig({
      points: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 4],
      ].flat(),
      lookAhead: 2,
    });
    const { length } = rail.spline;
    const threshold = 1 - rail.lookAhead / length;
    rail.seek(threshold - 1e-6, false).update(0);
    const before = [...rail.pose.target];
    rail.seek(threshold + 1e-6, false).update(0);
    closeVec(rail.pose.target, before, 1e-4);
  });

  test("composer corrections keep their half life looking down", () => {
    const framesToHalve = (elevation) => {
      const pose = poseUtils.create();
      pose.position = [0, 10 * Math.sin(elevation), 10 * Math.cos(elevation)];
      quatLookAt(pose.orientation, pose.position, pose.target, pose.up);
      const composer = new Composer({
        lens,
        subject: [2.5, 0, 0],
        deadZone: [0, 0],
        softZone: [1, 1],
        halfLife: 0.1,
      });
      composer.update(pose, 0);
      const error = Math.abs(composer.project(composer.pose)[0]);
      let frames = 0;
      while (Math.abs(composer.project(composer.pose)[0]) > error / 2) {
        composer.update(pose, 1 / 60);
        frames++;
      }
      return frames;
    };
    const level = framesToHalve(0.3);
    // Steeper views approach the gimbal lock of a pan and tilt head.
    assert.ok(Math.abs(framesToHalve(Math.PI / 2 - 0.3) - level) <= 1);
  });

  test("composer eases back to the input once the subject is gone", () => {
    const pose = poseUtils.create();
    pose.position = [0, 0, 10];
    const composer = new Composer({ lens, subject: [4, 0, 0] });
    settle({ update: (dt) => composer.update(pose, dt) });
    composer.subject = null;
    assert.equal(composer.update(pose, 1 / 60), true);
    settle({ update: (dt) => composer.update(pose, dt) });
    closeVec(composer.pose.orientation, pose.orientation, 1e-4);
  });

  test("composer keeps the target on the view axis, at the subject", () => {
    const pose = poseUtils.create();
    pose.position = [0, 0, 10];
    const subject = [4, 1, 0];
    const composer = new Composer({
      lens,
      subject,
      screenPosition: [-1 / 3, 1 / 3],
    });
    settle({ update: (dt) => composer.update(pose, dt) });
    const { position, target, orientation } = composer.pose;
    close(distance(position, target), distance(position, subject));
    const direction = target.map(
      (v, i) => (v - position[i]) / distance(position, target),
    );
    closeVec(direction, forward(orientation));
  });
});

describe("Handheld", () => {
  const right = ([x, y, z, w]) => [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
  ];

  test("drifts smoothly within the layers' peaks, without roll", () => {
    const handheld = new Handheld({ seed: 3, referenceFov: null });
    const pose = poseUtils.create();
    const peak = HANDHELD_LAYERS.mild.reduce(
      (sum, { amplitude }) => sum + Math.hypot(...amplitude),
      0,
    );
    let previous = [...pose.orientation];
    let moved = 0;
    for (let i = 0; i < 600; i++) {
      assert.equal(handheld.update(pose, 1 / 60), true);
      const { orientation } = handheld.pose;
      const angle = 2 * Math.acos(Math.min(1, Math.abs(orientation[3])));
      assert.ok(angle <= peak + 1e-9, `angle ${angle}`);
      close(right(orientation)[1], 0, 1e-9);
      const step = distance(orientation, previous);
      assert.ok(step < 0.01, `step ${step}`);
      moved = Math.max(moved, angle);
      previous = [...orientation];
    }
    assert.ok(moved > 0.01);
  });

  test("scales with the field of view, keeping its size on screen", () => {
    const angleAt = (fov, referenceFov) => {
      const handheld = new Handheld({ seed: 2, referenceFov });
      const pose = poseUtils.create();
      pose.fov = fov;
      handheld.update(pose, 0.7);
      const [, , , w] = handheld.pose.orientation;
      return 2 * Math.acos(Math.min(1, Math.abs(w)));
    };
    const reference = angleAt(HANDHELD_FOV, HANDHELD_FOV);
    assert.ok(reference > 0);
    close(angleAt(HANDHELD_FOV, null), reference, 1e-12);
    close(
      angleAt(0.2, HANDHELD_FOV),
      reference * (Math.tan(0.1) / Math.tan(HANDHELD_FOV / 2)),
      1e-6,
    );
  });

  test("zero amplitude is a tripod", () => {
    const handheld = new Handheld({ amplitude: 0 });
    const pose = poseUtils.create();
    assert.equal(handheld.update(pose, 1 / 60), false);
    assert.deepEqual(handheld.pose.orientation, pose.orientation);
  });

  test("presets are copied, never written into", () => {
    const mild = structuredClone(HANDHELD_LAYERS.mild);
    const handheld = new Handheld();
    handheld.set({ layers: HANDHELD_LAYERS.strong });
    handheld.layers[0].amplitude[0] = 1;
    assert.deepEqual(HANDHELD_LAYERS.mild, mild);
    assert.notEqual(HANDHELD_LAYERS.strong[0].amplitude[0], 1);
  });
});
