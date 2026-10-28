import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  OrthographicCamera,
  PerspectiveCamera,
  lens,
} from "../lib/camera/index.js";
import { Spline, pose as poseUtils, quatLookAt } from "../lib/core/index.js";
import {
  AutoFocus,
  Composer,
  CraneRig,
  FollowZoom,
  GroupFraming,
  Switcher,
  RailRig,
  Sequence,
  Shake,
  PoseModifier,
  interpolateShots,
  shotHalfHeight,
  moveLength,
  writeShot,
  zoomPan,
} from "../lib/rigs/index.js";
import {
  close,
  closeVec,
  distance,
  forward,
  listen,
  settle,
} from "./helpers/utils.js";

describe("lens", () => {
  test("50mm on full frame", () => {
    close(lens.fovFromFocalLength(50, 24), 2 * Math.atan(12 / 50));
    close(lens.focalLengthFromFov(lens.fovFromFocalLength(50, 24), 24), 50);
  });

  test("sensor fit picks the right dimension", () => {
    const vertical = lens.verticalFov(50, [36, 24], 16 / 9, "vertical");
    const horizontal = lens.verticalFov(50, [36, 24], 16 / 9, "horizontal");
    close(vertical, lens.fovFromFocalLength(50, 24));
    // Wider viewport than the 3:2 sensor: the horizontal fit shows less vertically.
    assert.ok(horizontal < vertical);
    close(lens.verticalFov(50, [36, 24], 16 / 9, "fill"), horizontal);
    close(lens.verticalFov(50, [36, 24], 16 / 9, "overscan"), vertical);
  });

  test("exposure: sunny 16", () => {
    close(lens.ev100(16, 1 / 100, 100), Math.log2(25600));
    close(lens.exposureFromEV100(0), 1 / 1.2);
  });

  test("depth of field", () => {
    close(lens.circleOfConfusion(5, 5, 50, 2.8), 0);
    assert.ok(
      lens.circleOfConfusion(2, 5, 50, 2.8) >
        lens.circleOfConfusion(2, 5, 50, 8),
    );
    close(lens.hyperfocalDistance(50, 8), 10.4666666, 1e-6);
  });

  test("dolly zoom keeps the subject size", () => {
    const d = lens.dollyZoomDistance(10, 0.8, 0.4);
    close(d * Math.tan(0.4 / 2), 10 * Math.tan(0.8 / 2));
  });

  test("camera derives fov from the focal length", () => {
    const camera = new PerspectiveCamera({
      focalLength: 35,
      aspect: 1.5,
      sensorFit: "vertical",
    });
    close(camera.fov, lens.fovFromFocalLength(35, 24));
    close(camera.ev100, lens.ev100(16, 1 / 125, 100));
    camera.exposureCompensation = 1;
    close(camera.exposure, lens.exposureFromEV100(camera.ev100 - 1));
  });
});

describe("Spline", () => {
  const points = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 3],
    [-2, 1, 3],
  ];

  test("passes through its points", () => {
    const spline = new Spline(points.flat());
    points.forEach((point, i) =>
      closeVec(
        spline.pointAtParameter([], i / (points.length - 1)),
        point,
        1e-9,
      ),
    );
  });

  test("arc length parameterization is uniform", () => {
    const spline = new Spline(points.flat(), { samplesPerSegment: 256 });
    const steps = 50;
    const step = spline.length / steps;
    for (let i = 0; i < steps; i++) {
      const a = spline.pointAt([], i / steps);
      const b = spline.pointAt([], (i + 1) / steps);
      // Chords are slightly shorter than arcs on curved parts.
      assert.ok(Math.abs(distance(a, b) - step) < step * 0.02, `step ${i}`);
    }
  });

  test("closed splines wrap", () => {
    const spline = new Spline(points.flat(), { closed: true });
    closeVec(spline.pointAt([], 1.25), spline.pointAt([], 0.25));
    closeVec(spline.pointAt([], 0), spline.pointAt([], 1), 1e-9);
  });
});

describe("shots", () => {
  const a = {
    position: [0, 2, 10],
    target: [0, 0, 0],
    fov: 0.8,
    focusDistance: 10,
  };
  const b = {
    position: [60, 5, 40],
    target: [50, 0, 50],
    fov: 0.4,
    focusDistance: 2,
  };

  test("every move starts and ends on the shots", () => {
    for (const move of ["linear", "arc", "zoom-pan"]) {
      const start = interpolateShots(poseUtils.create(), a, b, 0, { move });
      const end = interpolateShots(poseUtils.create(), a, b, 1, { move });
      closeVec(start.position, a.position, 1e-6);
      closeVec(end.position, b.position, 1e-6);
      closeVec(end.target, b.target, 1e-6);
      close(end.fov, b.fov);
      close(end.focusDistance, b.focusDistance);
    }
  });

  test("rack focus interpolates perceptually", () => {
    const middle = interpolateShots(poseUtils.create(), a, b, 0.5, {
      move: "linear",
    });
    close(middle.focusDistance, Math.sqrt(10 * 2));
  });

  test("zoom-pan pulls back between distant shots", () => {
    const near = { position: [0, 0, 2], target: [0, 0, 0] };
    const far = { position: [100, 0, 2], target: [100, 0, 0] };
    const middle = interpolateShots(poseUtils.create(), near, far, 0.5, {
      move: "zoom-pan",
    });
    assert.ok(distance(middle.position, middle.target) > 10);
    close(middle.target[0], 50, 1e-6);

    const curve = zoomPan(1, 1, 100);
    const [u, w] = curve.at(curve.length);
    close(u, 100, 1e-6);
    close(w, 1, 1e-6);
  });

  test("dolly zoom keeps the framing at the target", () => {
    const from = { position: [0, 0, 10], target: [0, 0, 0], fov: 1 };
    const to = {
      position: [0, 0, lens.dollyZoomDistance(10, 1, 0.3)],
      target: [0, 0, 0],
      fov: 0.3,
    };
    for (const t of [0, 0.3, 0.7, 1]) {
      const pose = interpolateShots(poseUtils.create(), from, to, t, {
        move: "dolly-zoom",
      });
      close(
        distance(pose.position, pose.target) * Math.tan(pose.fov / 2),
        10 * Math.tan(0.5),
      );
    }
  });

  test("arc keeps the distance between equal shots", () => {
    const from = { position: [5, 0, 0], target: [0, 0, 0] };
    const to = { position: [0, 0, -5], target: [0, 0, 0] };
    for (const t of [0.25, 0.5, 0.75]) {
      const pose = interpolateShots(poseUtils.create(), from, to, t, {
        move: "arc",
      });
      close(distance(pose.position, [0, 0, 0]), 5);
    }
  });
});

describe("Sequence", () => {
  const shots = [
    { shot: { position: [0, 0, 5], target: [0, 0, 0] }, hold: 1 },
    {
      shot: { position: [5, 0, 0], target: [0, 0, 0] },
      duration: 2,
      hold: 1,
      move: "arc",
    },
    {
      shot: { position: [0, 5, 1], target: [0, 0, 0] },
      duration: 1,
      move: "linear",
    },
  ];

  test("seek is deterministic and plays to the end", () => {
    const sequence = new Sequence({ shots });
    close(sequence.duration, 5);

    sequence.seek(2);
    sequence.update(0);
    const at2 = [...sequence.pose.position];
    sequence.seek(4.5);
    sequence.update(0);
    sequence.seek(2);
    sequence.update(0);
    closeVec(sequence.pose.position, at2);

    const events = [];
    sequence.on("shotchange", ({ index }) => events.push(index));
    sequence.on("end", () => events.push("end"));
    sequence.seek(0).play();
    settle(sequence, 1 / 30);
    closeVec(sequence.pose.position, [0, 5, 1], 1e-6);
    assert.deepEqual(events, [0, 1, 2, "end"]);
  });

  test("loops", () => {
    const sequence = new Sequence({ shots, loop: true });
    sequence.seek(6);
    close(sequence.time, 1);
  });
});

describe("RailRig", () => {
  const points = [
    [0, 1, 0],
    [5, 1, 0],
    [5, 2, 5],
  ];

  test("travels from start to end and looks at the subject", () => {
    const rail = new RailRig({
      points: points.flat(),
      subject: [0, 0, 0],
      speed: 4,
    });
    rail.update(0);
    closeVec(rail.pose.position, points[0]);

    let ended = false;
    rail.on("end", () => (ended = true));
    rail.play();
    settle(rail);
    assert.ok(ended);
    closeVec(rail.pose.position, points[2], 1e-6);
    closeVec(rail.pose.target, [0, 0, 0]);
  });

  test("looks ahead along the rail", () => {
    const rail = new RailRig({ points: points.flat(), lookAhead: 0.5 });
    rail.update(0);
    close(distance(rail.pose.position, rail.pose.target), 0.5, 1e-2);
    assert.ok(rail.pose.target[0] > 0);
  });
});

describe("CraneRig", () => {
  test("the arm keeps its length while swinging and booming", () => {
    const crane = new CraneRig({ pivot: [1, 0, 1], height: 2, armLength: 4 });
    crane.swingTo(1).boomTo(0.6);
    settle(crane);
    const column = [1, 2, 1];
    close(distance(crane.pose.position, column), 4);
    close(crane.pose.position[1], 2 + 4 * Math.sin(0.6));
  });
});

describe("Composer", () => {
  const camera = new PerspectiveCamera({ fov: 1, aspect: 1.5 });
  const input = poseUtils.create();
  quatLookAt(input.orientation, [0, 0, 10], [0, 0, 0]);
  input.position = [0, 0, 10];

  test("settles with the subject inside the dead zone", () => {
    const composer = new Composer({
      lens: camera,
      subject: [3, 2, 0],
      halfLife: 0.1,
    });
    for (let i = 0; i < 300; i++) composer.update(input, 1 / 60);
    const [x, y] = composer.project(composer.pose);
    assert.ok(Math.abs(x) <= composer.deadZone[0] + 1e-6, `x ${x}`);
    assert.ok(Math.abs(y) <= composer.deadZone[1] + 1e-6, `y ${y}`);
  });

  test("keeps the subject inside the soft zone from the first frame", () => {
    const composer = new Composer({
      lens: camera,
      subject: [6, 0, 0],
      softZone: [0.3, 0.3],
      halfLife: 10,
    });
    composer.update(input, 1 / 60);
    const [x] = composer.project(composer.pose);
    assert.ok(Math.abs(x) <= 0.3 + 1e-6, `x ${x}`);
  });

  test("leaves the input pose untouched", () => {
    const composer = new Composer({ lens: camera, subject: [6, 0, 0] });
    const before = [...input.orientation];
    composer.update(input, 1 / 60);
    closeVec(input.orientation, before);
  });
});

describe("Shake", () => {
  const input = poseUtils.create();

  test("decays back to the input pose", () => {
    const shake = new Shake({ decay: 2 }).addTrauma(1);
    assert.equal(shake.update(input, 1 / 60), true);
    assert.ok(Math.abs(shake.pose.orientation[3]) < 1);
    for (let i = 0; i < 60; i++) shake.update(input, 1 / 60);
    assert.equal(shake.trauma, 0);
    assert.equal(shake.update(input, 1 / 60), false);
    closeVec(shake.pose.orientation, input.orientation);
  });

  test("same seed, same shake", () => {
    const run = () => {
      const shake = new Shake({ seed: 3 }).addTrauma(0.8);
      for (let i = 0; i < 10; i++) shake.update(input, 1 / 60);
      return [...shake.pose.orientation];
    };
    assert.deepEqual(run(), run());
  });
});

describe("shots edge cases", () => {
  const a = { position: [0, 2, 10], target: [0, 0, 0] };
  const b = { position: [8, 1, 3], target: [2, 0, 1], up: [0, 0, 1] };
  const moves = ["linear", "arc", "zoom-pan", "dolly-zoom"];
  const at = (from, to, t, options) =>
    interpolateShots(poseUtils.create(), from, to, t, options);

  test("every move, with and without lens values, starts and ends on the shots", () => {
    const lensed = (shot, fov, zoom) => ({ ...shot, fov, zoom });
    for (const [from, to] of [
      [a, b],
      [lensed(a, 0.9, 1), lensed(b, 0.4, 2)],
    ]) {
      for (const move of moves) {
        const start = at(from, to, 0, { move });
        const end = at(from, to, 1, { move });
        closeVec(start.position, from.position, 1e-6);
        closeVec(start.target, from.target, 1e-6);
        closeVec(end.position, to.position, 1e-6);
        closeVec(end.target, to.target, 1e-6);
        closeVec(end.up, to.up ?? [0, 1, 0], 1e-6);
        assert.equal(end.fov, to.fov);
        if (to.zoom === undefined) assert.equal(end.zoom, undefined);
        else close(end.zoom, to.zoom);
        closeVec(
          forward(end.orientation),
          [...to.target.map((v, i) => v - to.position[i])].map(
            (v, _, d) => v / Math.hypot(...d),
          ),
          1e-6,
        );
      }
    }
  });

  test("t is clamped", () => {
    for (const move of moves) {
      assert.deepEqual(at(a, b, -1, { move }), at(a, b, 0, { move }));
      assert.deepEqual(at(a, b, 2, { move }), at(a, b, 1, { move }));
    }
  });

  test("the default move is an arc and easing reshapes time", () => {
    assert.deepEqual(at(a, b, 0.3), at(a, b, 0.3, { move: "arc" }));
    const eased = at(a, b, 0.5, { move: "linear", easing: (t) => t * t });
    closeVec(eased.position, at(a, b, 0.25, { move: "linear" }).position);
  });

  test("opposite ups stay defined halfway", () => {
    const down = { ...a, up: [0, -1, 0] };
    for (const move of ["linear", "arc"]) {
      for (const [from, to, up] of [
        [a, down, [0, -1, 0]],
        // The default up on the arriving side.
        [down, a, [0, 1, 0]],
      ]) {
        const pose = at(from, to, 0.5, { move });
        assert.ok(pose.orientation.every(Number.isFinite));
        closeVec(pose.up, up);
      }
    }
  });

  test("ups are interpolated and normalized", () => {
    const pose = at(a, { ...a, up: [1, 0, 0] }, 0.5, { move: "linear" });
    closeVec(pose.up, [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  test("one sided lens values are kept, zoom is interpolated in log space", () => {
    const pose = at({ ...a, fov: 0.5 }, { ...b, zoom: 4 }, 0.5);
    assert.equal(pose.fov, 0.5);
    assert.equal(pose.zoom, 4);
    const zoomed = at({ ...a, zoom: 1 }, { ...b, zoom: 4 }, 0.5);
    close(zoomed.zoom, 2);
    const from = at({ ...a, zoom: 3, focusDistance: 2 }, b, 0.5);
    assert.equal(from.zoom, 3);
    assert.equal(from.focusDistance, 2);
    assert.equal(from.fov, undefined);
  });

  test("dolly zoom works without lens values", () => {
    const pose = at(a, { ...a, position: [0, 4, 20] }, 0.5, {
      move: "dolly-zoom",
    });
    close(
      shotHalfHeight({ position: pose.position, target: pose.target }),
      (shotHalfHeight(a) + shotHalfHeight({ ...a, position: [0, 4, 20] })) / 2,
    );
  });

  test("zoom-pan between shots on the same target is a pure zoom", () => {
    const wide = { position: [0, 0, 40], target: [1, 0, 0] };
    const close_ = { position: [0, 0, 4], target: [1, 0, 0] };
    for (const t of [0.25, 0.5, 0.75]) {
      const pose = at(wide, close_, t, { move: "zoom-pan" });
      closeVec(pose.target, [1, 0, 0]);
    }
    // Halfway in log space.
    const middle = at(wide, close_, 0.5, { move: "zoom-pan" });
    close(
      shotHalfHeight({ position: middle.position, target: middle.target }),
      Math.sqrt(shotHalfHeight(wide) * shotHalfHeight(close_)),
    );
  });

  test("a negligible pan still ends on the target", () => {
    const from = { position: [0, 0, 10], target: [0, 0, 0] };
    const to = { position: [1e-8, 0, 2], target: [1e-8, 0, 0] };
    const end = at(from, to, 1, { move: "zoom-pan" });
    closeVec(end.target, to.target, 1e-15);
    const middle = at(from, to, 0.5, { move: "zoom-pan" });
    assert.ok(middle.target[0] > 0 && middle.target[0] < 1e-8);
  });

  test("zoomPan pure zoom in, out and none", () => {
    const zoomIn = zoomPan(4, 1, 0);
    close(zoomIn.length, Math.log(4) / Math.SQRT2);
    closeVec(zoomIn.at(0), [0, 4]);
    closeVec(zoomIn.at(zoomIn.length), [0, 1]);
    const zoomOut = zoomPan(1, 4, 0, 2);
    close(zoomOut.length, Math.log(4) / 2);
    closeVec(zoomOut.at(zoomOut.length), [0, 4]);
    const none = zoomPan(2, 2, 0);
    assert.equal(none.length, 0);
    assert.deepEqual(none.at(0), [0, 2]);
  });

  test("zoomPan: higher rho zooms out more", () => {
    const peak = (rho) => {
      const curve = zoomPan(1, 1, 10, rho);
      return curve.at(curve.length / 2)[1];
    };
    assert.ok(peak(2) > peak(1));
    const curve = zoomPan(1, 2, 10);
    closeVec(curve.at(curve.length), [10, 2], 1e-9);
  });

  test("transition length", () => {
    assert.equal(moveLength(a, a), 0);
    close(moveLength(a, b), moveLength(b, a), 1e-9);
    assert.ok(moveLength(a, b, 2) !== moveLength(a, b));
    const far = { position: [100, 2, 10], target: [100, 0, 0] };
    assert.ok(moveLength(a, far) > moveLength(a, b));
  });

  test("half height includes fov and zoom", () => {
    close(
      shotHalfHeight({ position: [0, 0, 2], target: [0, 0, 0] }),
      2 * Math.tan(Math.PI / 8),
    );
    close(
      shotHalfHeight({
        position: [0, 0, 2],
        target: [0, 0, 0],
        fov: Math.PI / 2,
        zoom: 2,
      }),
      1,
    );
  });

  test("writeShot copies the shot and clears missing lens values", () => {
    const out = { ...poseUtils.create(), fov: 1, zoom: 2, focusDistance: 3 };
    writeShot(out, a);
    assert.deepEqual(out.position, a.position);
    assert.notEqual(out.position, a.position);
    assert.deepEqual(out.up, [0, 1, 0]);
    assert.equal(out.fov, undefined);
    assert.equal(out.zoom, undefined);
    assert.equal(out.focusDistance, undefined);
    writeShot(out, { ...b, fov: 0.5, focusDistance: 4 });
    assert.equal(out.fov, 0.5);
    assert.equal(out.focusDistance, 4);
  });
});

describe("Sequence edge cases", () => {
  const A = { position: [0, 0, 5], target: [0, 0, 0] };
  const B = { position: [5, 0, 0], target: [0, 0, 0] };
  const C = { position: [0, 5, 1], target: [0, 0, 0] };

  test("no shots", () => {
    const sequence = new Sequence();
    assert.equal(sequence.duration, 0);
    assert.equal(sequence.evaluate(poseUtils.create(), 0), -1);
    const events = listen(sequence, ["end"]);
    sequence.play();
    sequence.update(1 / 60);
    assert.deepEqual(events, ["end"]);
    assert.equal(sequence.playing, false);
  });

  test("evaluate any time without moving the playhead", () => {
    const sequence = new Sequence({
      shots: [
        { shot: A, hold: 1 },
        { shot: B, duration: 2, hold: 1 },
      ],
    });
    const out = poseUtils.create();
    for (const [time, index, position] of [
      [-5, 0, A.position],
      [0, 0, A.position],
      [1, 0, A.position],
      [3, 1, B.position],
      [4, 1, B.position],
      [100, 1, B.position],
      [NaN, 0, A.position],
    ]) {
      assert.equal(sequence.evaluate(out, time), index, `time ${time}`);
      closeVec(out.position, position, 1e-9);
    }
    assert.equal(sequence.evaluate(out, 2), 1);
    assert.equal(sequence.time, 0);
  });

  test("zero duration transitions cut, the first duration is ignored", () => {
    const sequence = new Sequence({
      shots: [
        { shot: A, duration: 10, hold: 1 },
        { shot: B, duration: 0, hold: 1 },
        { shot: C },
      ],
    });
    assert.equal(sequence.duration, 2);
    const out = poseUtils.create();
    assert.equal(sequence.evaluate(out, 1), 0);
    assert.equal(sequence.evaluate(out, 1 + 1e-9), 1);
    closeVec(out.position, B.position);
    assert.equal(sequence.evaluate(out, 2), 2);
    closeVec(out.position, C.position);
  });

  test("moves use each shot's move and easing", () => {
    const sequence = new Sequence({
      shots: [
        { shot: A },
        { shot: B, duration: 1, move: "linear", easing: (t) => t * t },
      ],
    });
    const out = poseUtils.create();
    sequence.evaluate(out, 0.5);
    closeVec(
      out.position,
      interpolateShots(poseUtils.create(), A, B, 0.25, { move: "linear" })
        .position,
    );
  });

  test("pause, resume and playing", () => {
    const sequence = new Sequence({
      shots: [{ shot: A }, { shot: B, duration: 1 }],
    });
    sequence.play().update(0.25);
    assert.equal(sequence.playing, true);
    sequence.pause();
    assert.equal(sequence.playing, false);
    assert.equal(sequence.update(1), false);
    close(sequence.time, 0.25);
    sequence.play().update(0.25);
    close(sequence.time, 0.5);
  });

  test("speed scales time and zero speed rests", () => {
    const sequence = new Sequence({
      shots: [{ shot: A }, { shot: B, duration: 4 }],
      speed: 2,
    });
    sequence.play().update(1);
    close(sequence.time, 2);
    sequence.speed = 0;
    assert.equal(sequence.update(1), false);
    close(sequence.time, 2);
    assert.equal(sequence.playing, true);
  });

  test("an empty loop rests, a loop never ends", () => {
    const empty = new Sequence({ shots: [{ shot: A }], loop: true }).play();
    empty.update(0);
    assert.equal(empty.update(1 / 60), false);

    const loop = new Sequence({
      shots: [{ shot: A }, { shot: B, duration: 1 }],
      loop: true,
    });
    const events = listen(loop, ["end"]);
    loop.play();
    for (let i = 0; i < 200; i++) loop.update(1 / 60);
    assert.deepEqual(events, []);
    assert.ok(loop.time >= 0 && loop.time < 1);
  });

  test("reverse play ends at 0, reverse loop wraps", () => {
    const shots = [{ shot: A }, { shot: B, duration: 1 }];
    const reverse = new Sequence({ shots, speed: -1 }).seek(1);
    const events = listen(reverse, ["end"]);
    reverse.play();
    settle(reverse);
    assert.deepEqual(events, ["end"]);
    assert.equal(reverse.time, 0);

    const loop = new Sequence({ shots, speed: -1, loop: true }).seek(0.25);
    loop.play().update(0.5);
    close(loop.time, 0.75);
    loop.seek(-3.25);
    close(loop.time, 0.75);
  });

  test("seek clamps without loop", () => {
    const sequence = new Sequence({
      shots: [{ shot: A }, { shot: B, duration: 2 }],
    });
    assert.equal(sequence.seek(-1).time, 0);
    assert.equal(sequence.seek(5).time, 2);
  });

  test("shotchange fires once per change, -1 when shots go away", () => {
    const sequence = new Sequence({
      shots: [{ shot: A }, { shot: B, duration: 1 }],
    });
    const indices = [];
    sequence.on("shotchange", ({ index }) => indices.push(index));
    sequence.update(0);
    sequence.seek(0.5).update(0);
    sequence.seek(0.75).update(0);
    sequence.set({ shots: [] });
    sequence.update(0);
    assert.deepEqual(indices, [0, 1, -1]);
  });
});

describe("RailRig edge cases", () => {
  const square = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 4],
    [0, 0, 4],
  ];

  test("replacing the spline keeps the progress valid", () => {
    const rail = new RailRig({ points: square.flat(), closed: true });
    rail.speed = rail.spline.length * 2.5;
    rail.play().update(1);
    rail.pause();
    settle(rail);
    close(rail.progress, 2.5, 1e-4);
    rail.spline = new Spline(square.flat());
    close(rail.progress, 0.5, 1e-4);
    rail.update(0);
    closeVec(rail.pose.position, rail.spline.pointAt([], rail.progress));
  });

  test("reverse play ends at the start", () => {
    const rail = new RailRig({ points: square.flat(), progress: 1, speed: -8 });
    const events = listen(rail, ["end"]);
    rail.play();
    assert.equal(rail.playing, true);
    settle(rail);
    assert.deepEqual(events, ["end"]);
    assert.equal(rail.playing, false);
    assert.equal(rail.progress, 0);
  });

  test("pause holds the goal, zero speed rests while playing", () => {
    const rail = new RailRig({ points: square.flat(), speed: 4 });
    rail.play().update(0.5);
    rail.pause();
    settle(rail);
    const progress = rail.progress;
    assert.ok(progress > 0 && progress < 1);

    rail.speed = 0;
    rail.play();
    assert.ok(settle(rail) < 5);
    assert.equal(rail.progress, progress);
    assert.equal(rail.playing, true);
  });

  test("seek with and without transition", () => {
    const rail = new RailRig({ points: square.flat() });
    rail.seek(0.5, false);
    assert.equal(rail.progress, 0.5);
    rail.seek(2);
    assert.equal(rail.progress, 0.5);
    settle(rail);
    assert.equal(rail.progress, 1);
    rail.seek(-1, false);
    assert.equal(rail.progress, 0);
  });

  test("looks along the last tangent past the end of an open rail", () => {
    const rail = new RailRig({
      points: square.flat(),
      progress: 1,
      lookAhead: 2,
    });
    rail.update(0);
    closeVec(rail.pose.position, square[3]);
    const [x, y, z] = forward(rail.pose.orientation);
    close(y, 0);
    assert.ok(x < -0.9 && Math.abs(z) < 0.5, `forward ${[x, y, z]}`);
    close(distance(rail.pose.target, rail.pose.position), 2);
  });

  test("closed rails look ahead across the seam", () => {
    const rail = new RailRig({
      points: square.flat(),
      closed: true,
      progress: 0.999,
      lookAhead: 1,
    });
    rail.update(0);
    const ahead = new Spline(square.flat(), { closed: true }).pointAt(
      [0, 0, 0],
      0.999 + 1 / rail.spline.length,
    );
    closeVec(rail.pose.target, ahead);
  });

  test("subjects can be functions, re-evaluated every update", () => {
    let calls = 0;
    const rail = new RailRig({
      points: square.flat(),
      subject: () => {
        calls++;
        return [calls, 10, 0];
      },
    });
    rail.update(0);
    rail.seek(0.5).update(1 / 60);
    assert.equal(calls, 2);
    assert.deepEqual(rail.pose.target, [2, 10, 0]);
  });

  test("a rail on a single point stays finite, open ones end", () => {
    for (const [closed, point] of [
      [false, [1, 2, 3]],
      [true, [1, 2, 3]],
      // Exactly zero length.
      [false, [0, 0, 0]],
    ]) {
      const rail = new RailRig({
        points: [point, [...point]].flat(),
        closed,
        speed: 5,
      });
      const events = listen(rail, ["end"]);
      rail.play();
      for (let i = 0; i < 120; i++) rail.update(1 / 60);
      assert.deepEqual(events, closed ? [] : ["end"]);
      closeVec(rail.pose.position, point, 1e-9);
      assert.ok(rail.pose.orientation.every(Number.isFinite));
    }
  });

  test("custom up", () => {
    const rail = new RailRig({
      points: [
        [0, 0, 0],
        [0, 4, 0],
      ].flat(),
      up: [0, 0, 1],
      lookAhead: 1,
    });
    rail.update(0);
    closeVec(forward(rail.pose.orientation), [0, 1, 0]);
    assert.deepEqual(rail.pose.up, [0, 0, 1]);
  });
});

describe("CraneRig edge cases", () => {
  test("defaults: a 3 unit arm on a 1 unit column, level", () => {
    const crane = new CraneRig();
    crane.update(0);
    closeVec(crane.pose.position, [0, 1, 3]);
    closeVec(forward(crane.pose.orientation), [0, 0, 1]);
  });

  test("channels: current, end, transitions and jumps", () => {
    const crane = new CraneRig();
    crane.extendTo(5).pedestalTo(2).swingTo(1).boomTo(0.5);
    assert.equal(crane.get("armLength"), 3);
    assert.equal(crane.get("armLength", true), 5);
    assert.ok(settle(crane) < 2000);
    for (const [channel, value] of [
      ["armLength", 5],
      ["height", 2],
      ["swing", 1],
      ["boom", 0.5],
    ]) {
      assert.equal(crane.get(channel), value);
    }
    crane.extendTo(-2, false).pedestalTo(-1, false);
    assert.equal(crane.get("armLength"), 0);
    assert.equal(crane.get("height"), -1);
    assert.equal(crane.update(1 / 60), true, "pending pose");
    assert.equal(crane.update(1 / 60), false);
    closeVec(crane.pose.position, [0, -1, 0]);
  });

  test("looks at a target when given one", () => {
    const crane = new CraneRig({ target: [0, 0, 0], height: 2, armLength: 2 });
    crane.update(0);
    const direction = [0, -2, -2].map((v) => v / Math.hypot(2, 2));
    closeVec(forward(crane.pose.orientation), direction);
    closeVec(crane.pose.target, [0, 0, 0]);
  });

  test("any up length, any up direction", () => {
    const unit = new CraneRig({ height: 2, boom: 0.3, swing: 0.4 });
    const long = new CraneRig({
      up: [0, 5, 0],
      height: 2,
      boom: 0.3,
      swing: 0.4,
    });
    unit.update(0);
    long.update(0);
    closeVec(long.pose.position, unit.pose.position);

    const z = new CraneRig({ up: [0, 0, 1], pivot: [1, 1, 1], height: 2 });
    z.update(0);
    close(z.pose.position[2], 3);
    closeVec(z.pose.up, [0, 0, 1]);
    close(forward(z.pose.orientation)[2], 0);
  });
});

// Poses with explicit optional keys, for deep equality.
const full = (pose) => poseUtils.set(poseUtils.create(), pose);

describe("Composer edge cases", () => {
  const lensed = new PerspectiveCamera({ fov: 1, aspect: 2 });
  const input = () => {
    const pose = poseUtils.create();
    pose.position = [0, 0, 10];
    return pose;
  };

  test("no subject: no projection and the input passes through", () => {
    const composer = new Composer({ lens: lensed });
    const pose = input();
    assert.equal(composer.project(pose), null);
    assert.equal(composer.update(pose, 1 / 60), false);
    assert.deepEqual(composer.pose, full(pose));
  });

  test("subjects behind the camera are not framed", () => {
    const composer = new Composer({ lens: lensed, subject: [0, 0, 20] });
    const pose = input();
    assert.equal(composer.project(pose), null);
    assert.equal(composer.update(pose, 1 / 60), false);
    assert.deepEqual(composer.pose.orientation, pose.orientation);
  });

  test("projects with the lens, or a 45° default", () => {
    const pose = input();
    const withLens = new Composer({ lens: lensed, subject: [1, 1, 0] });
    const [x, y] = withLens.project(pose);
    close(y, 0.1 / Math.tan(0.5));
    close(x, 0.1 / (2 * Math.tan(0.5)));
    const bare = new Composer({ subject: [1, 1, 0] });
    closeVec(
      bare.project(pose),
      [0.1, 0.1].map((v) => v / Math.tan(Math.PI / 8)),
    );
    const out = [0, 0];
    assert.equal(bare.project(pose, out), out);
  });

  test("function subjects", () => {
    let subject = [0, 0, 0];
    const composer = new Composer({ lens: lensed, subject: () => subject });
    closeVec(composer.project(input()), [0, 0]);
    subject = [2, 0, 0];
    assert.ok(composer.project(input())[0] > 0);
  });

  test("reset forgets the correction", () => {
    const composer = new Composer({
      lens: lensed,
      subject: [4, 0, 0],
      deadZone: [0, 0],
    });
    const pose = input();
    settle({ update: (dt) => composer.update(pose, dt) });
    assert.ok(Math.abs(composer.project(composer.pose)[0]) < 1e-3);
    composer.reset();
    composer.update(pose, 0);
    close(composer.project(composer.pose)[0], composer.project(pose)[0]);
  });

  test("disabled composers pass the pose through", () => {
    const composer = new Composer({ lens: lensed, subject: [4, 0, 0] });
    composer.enabled = false;
    const pose = input();
    assert.equal(composer.update(pose, 1 / 60), false);
    assert.deepEqual(composer.pose, full(pose));
    assert.notEqual(composer.pose.position, pose.position);
  });

  test("rest threshold is a setting", () => {
    const pose = input();
    const loose = new Composer({
      lens: lensed,
      subject: [4, 0, 0],
      restThreshold: 1,
    });
    assert.equal(loose.update(pose, 1 / 60), false);
    const strict = new Composer({ lens: lensed, subject: [4, 0, 0] });
    assert.equal(strict.update(pose, 1 / 60), true);
  });

  test("rests after the same time at any frame rate", () => {
    const pose = input();
    const restTime = (hz) => {
      const composer = new Composer({ lens: lensed, subject: [4, 0, 0] });
      return settle({ update: (dt) => composer.update(pose, dt) }, 1 / hz) / hz;
    };
    assert.ok(Math.abs(restTime(60) - restTime(240)) < 1 / 60);
  });

  test("applyTo writes the composed pose", () => {
    const composer = new Composer({ lens: lensed, subject: [4, 0, 0] });
    composer.update(input(), 1 / 60);
    const camera = { orientation: [0, 0, 0, 1], target: [0, 0, 0] };
    composer.applyTo(camera);
    assert.deepEqual(camera.orientation, composer.pose.orientation);
    assert.deepEqual(camera.target, composer.pose.target);
  });

  test("tilts to frame a subject above", () => {
    const composer = new Composer({
      lens: lensed,
      subject: [0, 4, 0],
      deadZone: [0, 0],
    });
    const pose = input();
    settle({ update: (dt) => composer.update(pose, dt) });
    closeVec(composer.project(composer.pose), [0, 0], 1e-3);
    assert.ok(forward(composer.pose.orientation)[1] > 0.3);
  });

  test("an off-center composition with an orthographic-free lens aspect", () => {
    const composer = new Composer({
      lens: new OrthographicCamera({ aspect: 1 }),
      subject: [0, 0, 0],
      screenPosition: [-1 / 3, 1 / 3],
      deadZone: [0, 0],
    });
    const pose = input();
    settle({ update: (dt) => composer.update(pose, dt) });
    closeVec(composer.project(composer.pose), [-1 / 3, 1 / 3], 1e-3);
  });
});

describe("Shake edge cases", () => {
  const still = () => poseUtils.create();

  test("trauma is clamped to [0, 1] and shapes the amount", () => {
    const shake = new Shake({ exponent: 3 });
    assert.equal(shake.addTrauma(2).trauma, 1);
    assert.equal(shake.addTrauma(-5).trauma, 0);
    shake.addTrauma(0.5);
    close(shake.amount, 0.125);
  });

  test("no trauma, no shake", () => {
    const shake = new Shake();
    assert.equal(shake.update(still(), 1 / 60), false);
    assert.deepEqual(shake.pose, full(still()));
  });

  test("translation only with zero angles", () => {
    const shake = new Shake({
      trauma: 1,
      maxAngles: [0, 0, 0],
      maxOffset: [1, 1, 1],
    });
    assert.equal(shake.update(still(), 0.13), true);
    assert.deepEqual(shake.pose.orientation, [0, 0, 0, 1]);
    assert.ok(distance(shake.pose.position, [0, 0, 1]) > 0);
    assert.ok(distance(shake.pose.position, [0, 0, 1]) <= Math.sqrt(3));
  });

  test("decay brings the trauma to zero at its rate", () => {
    const shake = new Shake({ trauma: 1, decay: 2 });
    for (let i = 0; i < 15; i++) shake.update(still(), 1 / 60);
    close(shake.trauma, 0.5, 1e-9);
    for (let i = 0; i < 60; i++) shake.update(still(), 1 / 60);
    assert.equal(shake.trauma, 0);
    assert.equal(shake.update(still(), 1 / 60), false);
    assert.deepEqual(shake.pose, full(still()));
  });

  test("disabled shakes don't advance", () => {
    const shake = new Shake({ trauma: 1 });
    shake.enabled = false;
    assert.equal(shake.update(still(), 1), false);
    assert.equal(shake.trauma, 1);
    assert.deepEqual(shake.pose, full(still()));
  });

  test("seeds and frequency change the motion, rotation stays unit", () => {
    const sample = (settings) => {
      const shake = new Shake({ trauma: 1, decay: 0, ...settings });
      shake.update(still(), 0.37);
      return shake.pose.orientation;
    };
    assert.notDeepEqual(sample({ seed: 1 }), sample({ seed: 2 }));
    assert.notDeepEqual(sample({ frequency: 3 }), sample({ frequency: 7 }));
    close(Math.hypot(...sample({ seed: 3 })), 1);
  });
});

describe("PoseModifier", () => {
  class Offset extends PoseModifier {
    amount = 1;
    constructor(options) {
      super();
      if (options) this.set(options);
    }
    modify(out) {
      out.position[0] += this.amount;
      return true;
    }
  }

  test("copies the input before modifying it", () => {
    const modifier = new Offset({ amount: 2 });
    const input = poseUtils.create();
    assert.equal(modifier.update(input, 1 / 60), true);
    assert.deepEqual(input.position, [0, 0, 1]);
    assert.deepEqual(modifier.pose.position, [2, 0, 1]);
    // Every update starts from the input again.
    modifier.update(input, 1 / 60);
    assert.deepEqual(modifier.pose.position, [2, 0, 1]);
  });

  test("set ignores undefined and returns the modifier", () => {
    const modifier = new Offset();
    assert.equal(modifier.set({ amount: undefined }), modifier);
    assert.equal(modifier.amount, 1);
  });

  test("applyTo through an adapter", () => {
    const modifier = new Offset();
    modifier.update(poseUtils.create(), 0);
    const result = modifier.applyTo({}, (pose, object) => {
      object.x = pose.position[0];
    });
    assert.deepEqual(result, { x: 1 });
  });
});

// A pose at `position` looking at the origin.
const lookingAtOrigin = (position) => {
  const pose = poseUtils.create();
  pose.position = position;
  quatLookAt(pose.orientation, pose.position, pose.target, pose.up);
  return pose;
};

describe("AutoFocus", () => {
  test("focuses on the target depth, off-center subjects included", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const focus = new AutoFocus();
    assert.equal(focus.update(pose, 1 / 60), false);
    close(focus.pose.focusDistance, 10);
    focus.set({ subject: () => [3, 2, 0] }).reset();
    focus.update(pose, 1 / 60);
    close(focus.pose.focusDistance, 10);
  });

  test("pulls focus with damping, then rests on the subject", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const focus = new AutoFocus({ subject: [0, 0, 0] });
    focus.update(pose, 1 / 60);
    focus.subject = [0, 0, 5];
    assert.equal(focus.update(pose, 1 / 60), true);
    const pulled = focus.pose.focusDistance;
    assert.ok(pulled < 10 && pulled > 5, `focus ${pulled}`);
    settle({ update: (dt) => focus.update(pose, dt) });
    assert.equal(focus.pose.focusDistance, 5);
  });

  test("offsets the plane of focus, never behind the camera", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const focus = new AutoFocus({ offset: 2 });
    focus.update(pose, 0);
    close(focus.pose.focusDistance, 12);
    focus.set({ subject: [0, 0, 20] }).reset();
    focus.update(pose, 0);
    assert.ok(focus.pose.focusDistance > 0);
  });
});

describe("FollowZoom", () => {
  const fovFor = (size, depth, zoom = 1) =>
    2 * Math.atan((size * zoom) / depth);

  test("keeps the size at the target depth, with the pose zoom", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const zoom = new FollowZoom({ size: 1.5 });
    assert.equal(zoom.update(pose, 1 / 60), false);
    close(zoom.pose.fov, fovFor(1.5, 10));
    pose.zoom = 2;
    zoom.reset().update(pose, 1 / 60);
    close(zoom.pose.fov, fovFor(1.5, 10, 2));
  });

  test("clamps to the field of view range", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const zoom = new FollowZoom({ size: 100, fovRange: [0.1, 1] });
    zoom.update(pose, 1 / 60);
    assert.equal(zoom.pose.fov, 1);
    zoom
      .set({ size: 1e-6 })
      .reset()
      .update(pose, 1 / 60);
    assert.equal(zoom.pose.fov, 0.1);
  });

  test("lags behind a subject moving away, then catches up", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const subject = [0, 0, 0];
    const zoom = new FollowZoom({ subject: () => subject });
    zoom.update(pose, 1 / 60);
    subject[2] = -10;
    assert.equal(zoom.update(pose, 1 / 60), true);
    const fov = zoom.pose.fov;
    assert.ok(fov < fovFor(1, 10) && fov > fovFor(1, 20), `fov ${fov}`);
    settle({ update: (dt) => zoom.update(pose, dt) });
    close(zoom.pose.fov, fovFor(1, 20));
  });
});

describe("Switcher", () => {
  const source = (position) => {
    const s = { pose: lookingAtOrigin(position), updates: 0, moving: false };
    s.update = () => (s.updates++, s.moving);
    return s;
  };

  test("cuts by default, without a source writes nothing", () => {
    const switcher = new Switcher();
    assert.equal(switcher.source, null);
    switcher.update(1 / 60);
    assert.deepEqual(switcher.pose, poseUtils.create());
    const a = source([0, 0, 10]);
    switcher.switchTo(a).update(1 / 60);
    assert.equal(switcher.blending, false);
    assert.deepEqual(switcher.pose, poseUtils.set(poseUtils.create(), a.pose));
  });

  test("moves between live sources, updating both until it arrives", () => {
    const a = source([0, 0, 10]);
    const b = source([10, 0, 0]);
    const switcher = new Switcher({ source: a, duration: 1, move: "linear" });
    switcher.update(1 / 60);
    switcher.switchTo(b);
    assert.equal(switcher.update(0.5), true);
    assert.equal(switcher.blending, true);
    closeVec(
      switcher.pose.position,
      interpolateShots(poseUtils.create(), a.pose, b.pose, 0.5, {
        move: "linear",
      }).position,
    );
    assert.deepEqual([a.updates, b.updates], [2, 1]);
    assert.equal(switcher.update(0.5), true);
    assert.equal(switcher.blending, false);
    closeVec(switcher.pose.position, b.pose.position);
    switcher.update(0.5);
    assert.deepEqual([a.updates, b.updates], [3, 3]);
    assert.equal(switcher.update(0.5), false);
  });

  test("interrupting a move continues from where the camera is", () => {
    const [a, b, c] = [
      [0, 0, 10],
      [10, 0, 0],
      [0, 10, 1],
    ].map(source);
    const switcher = new Switcher({ source: a, duration: 1 });
    switcher.update(0);
    switcher.switchTo(b).update(0.5);
    const halfway = [...switcher.pose.position];
    switcher.switchTo(c, { duration: 2, move: "linear" });
    switcher.update(0);
    closeVec(switcher.pose.position, halfway);
    switcher.update(1);
    closeVec(
      switcher.pose.position,
      halfway.map((v, i) => (v + c.pose.position[i]) / 2),
    );
    const updates = b.updates;
    switcher.update(0.1);
    assert.equal(b.updates, updates);
  });
});

describe("Composer truck-pedestal", () => {
  const lensed = new PerspectiveCamera({ fov: 1, aspect: 2 });

  test("moves without turning, exactly with no damping", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const composer = new Composer({
      lens: lensed,
      subject: [3, 1, 0],
      reframe: "truck-pedestal",
      screenPosition: [-1 / 3, 1 / 3],
      deadZone: [0, 0],
      halfLife: 0,
    });
    composer.update(pose, 1 / 60);
    closeVec(composer.project(composer.pose), [-1 / 3, 1 / 3], 1e-9);
    assert.deepEqual(composer.pose.orientation, pose.orientation);
    close(composer.pose.position[2], 10);
    assert.equal(composer.update(pose, 1 / 60), false);
  });

  test("eases back to the input without a subject, and resets on mode change", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const composer = new Composer({
      lens: lensed,
      subject: [3, 0, 0],
      reframe: "truck-pedestal",
      deadZone: [0, 0],
    });
    settle({ update: (dt) => composer.update(pose, dt) });
    assert.ok(distance(composer.pose.position, pose.position) > 1);
    composer.subject = null;
    settle({ update: (dt) => composer.update(pose, dt) });
    closeVec(composer.pose.position, pose.position, 1e-3);

    composer.subject = [3, 0, 0];
    settle({ update: (dt) => composer.update(pose, dt) });
    composer.reframe = "pan-tilt";
    composer.update(pose, 0);
    closeVec(composer.pose.position, pose.position);
  });
});

describe("GroupFraming", () => {
  const perspective = new PerspectiveCamera({ fov: 1, aspect: 1 });
  const subjects = [
    [-3, 0, 0],
    [3, 0, 0],
  ];
  // Group of width 7, height 1 and depth 1 with the default radius 0.5.
  const fit = 3.5 / 0.8;
  const framing = (options) =>
    new GroupFraming({ lens: perspective, subjects, radius: 0.5, ...options });

  test("dollies to fill the framing size, keeping the orientation", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const group = framing({ sizeAdjustment: "dolly" });
    assert.equal(group.update(pose, 1 / 60), false);
    closeVec(group.center, [0, 0, 0]);
    close(group.pose.position[2], fit / Math.tan(0.5) + 0.5);
    assert.deepEqual(group.pose.orientation, pose.orientation);
    closeVec(group.pose.target, [0, 0, 0]);
    assert.equal(group.pose.fov, undefined);
  });

  test("zooms in place, or for what the dolly range can't reach", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const zoom = framing({ sizeAdjustment: "zoom" });
    zoom.update(pose, 1 / 60);
    closeVec(zoom.pose.position, pose.position);
    close(zoom.pose.fov, 2 * Math.atan(fit / 9.5));

    const both = framing({ dollyRange: [-1, 1] });
    both.update(pose, 1 / 60);
    // The group needs a closer camera than the range allows.
    close(both.pose.position[2], 9);
    close(both.pose.fov, 2 * Math.atan(fit / 8.5));

    const free = framing();
    free.update(pose, 1 / 60);
    close(free.pose.fov, 1);
  });

  test("frames one dimension, orthographic lenses zoom", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const vertical = framing({
      framingMode: "vertical",
      sizeAdjustment: "zoom",
    });
    vertical.update(pose, 1 / 60);
    close(vertical.pose.fov, 2 * Math.atan(0.5 / 0.8 / 9.5));
    const horizontal = framing({ framingMode: "horizontal" });
    horizontal.update(pose, 1 / 60);
    close(horizontal.pose.position[2], fit / Math.tan(0.5) + 0.5);

    const orthographic = framing({
      lens: new OrthographicCamera({ size: 2, aspect: 1 }),
    });
    orthographic.update(pose, 1 / 60);
    close(orthographic.pose.zoom, 2 / fit);
    closeVec(orthographic.pose.position, pose.position);
    const unsized = framing({ lens: { type: "Orthographic", aspect: 1 } });
    unsized.update(pose, 1 / 60);
    close(unsized.pose.zoom, 1 / fit);
  });

  test("follows moving subjects with damping, nothing to frame passes through", () => {
    const pose = lookingAtOrigin([0, 0, 10]);
    const moving = [
      [-3, 0, 0],
      [3, 0, 0],
    ];
    const group = framing({ subjects: [() => moving[0], () => moving[1]] });
    group.update(pose, 1 / 60);
    const before = group.pose.position[2];
    moving[1][0] = 9;
    assert.equal(group.update(pose, 1 / 60), true);
    const after = group.pose.position[2];
    assert.ok(after > before, `${after} > ${before}`);
    settle({ update: (dt) => group.update(pose, dt) });
    closeVec(group.center, [3, 0, 0]);
    group.reset().update(pose, 0);

    const empty = new GroupFraming();
    assert.equal(empty.update(pose, 1 / 60), false);
    assert.deepEqual(empty.pose, poseUtils.set(poseUtils.create(), pose));
  });
});
