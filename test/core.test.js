import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  pose,
  Emitter,
  PoseSource,
  Spline,
  TAU,
  safeDivide,
  normalizeAngle,
  shortestAngle,
  signedAngle,
  quatFromUnitVectors,
  quatLookAt,
  quatPanTiltRoll,
  sphericalCreate,
  sphericalFromVec3,
  sphericalFromPositionTarget,
  vec3FromSpherical,
  vec3FromSphericalTarget,
} from "../lib/core/index.js";
import { close, closeVec, forward, upOf } from "./helpers/utils.js";

// Rotate a vector by a quaternion.
const rotate = ([x, y, z, w], [vx, vy, vz]) => {
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
};

describe("spherical", () => {
  test("cartesian round trip", () => {
    for (const v of [
      [1, 2, 3],
      [-4, 0.5, -2],
      [0, -3, 1],
    ]) {
      const s = sphericalFromVec3(sphericalCreate(), v);
      closeVec(vec3FromSpherical([0, 0, 0], s), v);
    }
  });

  test("elevation keeps full precision near the poles and the horizon", () => {
    for (const [elevation, epsilon] of [
      [Math.PI / 2 - 1e-9, 1e-15],
      [1e-9 - Math.PI / 2, 1e-15],
      [1e-9, 1e-24],
      [-1e-9, 1e-24],
    ]) {
      const s = sphericalFromVec3(sphericalCreate(), [
        Math.cos(elevation),
        Math.sin(elevation),
        0,
      ]);
      close(s[1], elevation, epsilon);
    }
  });

  test("position round trip with a non +Y up", () => {
    const target = [1, 2, 3];
    for (const up of [
      [0, 0, 1],
      [1, 0, 0],
      [0, -1, 0],
      [Math.SQRT1_2, Math.SQRT1_2, 0],
    ]) {
      const position = [4, -1, 6];
      const s = sphericalFromPositionTarget(
        sphericalCreate(),
        position,
        target,
        up,
      );
      closeVec(vec3FromSphericalTarget([0, 0, 0], s, target, up), position);
    }
  });

  test("elevation is measured towards the up vector", () => {
    const s = sphericalFromPositionTarget(
      sphericalCreate(),
      [0, 0, 5],
      [0, 0, 0],
      [0, 0, 1],
    );
    close(s[0], 5);
    close(s[1], Math.PI / 2);
  });

  test("normalizeAngle wraps to (-π, π]", () => {
    close(normalizeAngle(3 * Math.PI), Math.PI);
    close(normalizeAngle(-Math.PI / 2 - 4 * Math.PI), -Math.PI / 2);
    close(normalizeAngle(Math.PI + 0.1), -Math.PI + 0.1);
  });

  test("shortestAngle keeps interpolation under half a turn", () => {
    const shifted = shortestAngle(6, 0.1);
    assert.ok(Math.abs(shifted - 0.1) <= Math.PI);
    close(normalizeAngle(shifted), normalizeAngle(6));
  });

  test("quatPanTiltRoll rotates in the local frame", () => {
    const q = quatPanTiltRoll([0, 0, 0, 1], [Math.PI / 2, 0, 0]);
    // Panning left by 90° looks along -X.
    closeVec(forward(q), [-1, 0, 0]);
    assert.deepEqual(quatPanTiltRoll([0, 0, 0, 1], [0, 0, 0]), [0, 0, 0, 1]);
    const rolled = quatPanTiltRoll([0, 0, 0, 1], [0, 0.1, 0.2]);
    close(Math.hypot(...rolled), 1);
  });

  test("signedAngle measures around an axis, ignoring components along it", () => {
    close(signedAngle([0, 0, -1], [1, 5, 0], [0, 1, 0]), -Math.PI / 2);
    close(signedAngle([0, 0, -1], [0, 0, 1], [1, 0, 0]), Math.PI);
    assert.equal(signedAngle([0, 1, 0], [1, 0, 0], [0, 1, 0]), 0);
  });
});

describe("quatFromUnitVectors", () => {
  test("handles opposite vectors", () => {
    const q = quatFromUnitVectors([0, 0, 0, 1], [0, 1, 0], [0, -1, 0]);
    assert.ok(q.every(Number.isFinite));
    close(Math.hypot(...q), 1);
    close(q[3], 0);
  });
});

describe("pose", () => {
  test("applyTo copies into existing arrays", () => {
    const camera = { position: [0, 0, 0], target: [0, 0, 0], fov: 1 };
    const p = { ...pose.create(), fov: 0.5 };
    pose.applyTo(p, camera);
    closeVec(camera.position, [0, 0, 1]);
    assert.notEqual(camera.position, p.position);
    assert.equal(camera.fov, 0.5);
    assert.equal("zoom" in camera, false);
  });
});

describe("Emitter", async () => {
  const { Emitter } = await import("../lib/core/index.js");
  class Source extends Emitter {
    fire(value) {
      this.emit("change", value);
    }
  }

  test("on, once, returned off and AbortSignal", () => {
    const source = new Source();
    const values = [];
    const controller = new AbortController();
    const off = source.on("change", (value) => values.push(`on:${value}`));
    source.on("change", (value) => values.push(`once:${value}`), {
      once: true,
    });
    source.on("change", (value) => values.push(`signal:${value}`), {
      signal: controller.signal,
    });

    source.fire(1);
    controller.abort();
    source.fire(2);
    off();
    source.fire(3);

    assert.deepEqual(values, ["on:1", "once:1", "signal:1", "on:2"]);
  });
});

describe("spherical edge cases", () => {
  test("create is on the horizon facing +Z", () => {
    closeVec(vec3FromSpherical([0, 0, 0], sphericalCreate()), [0, 0, 1]);
  });

  test("the origin has zero radius and angles", () => {
    assert.deepEqual(sphericalFromVec3([1, 1, 1], [0, 0, 0]), [0, 0, 0]);
  });

  test("tiny vectors keep their direction", () => {
    const s = sphericalFromVec3(sphericalCreate(), [1e-7, 0, 1e-7]);
    close(s[0], Math.SQRT2 * 1e-7, 1e-20);
    close(s[2], Math.PI / 4);
  });

  test("poles and axes", () => {
    const up = sphericalFromVec3(sphericalCreate(), [0, 3, 0]);
    close(up[1], Math.PI / 2);
    const down = sphericalFromVec3(sphericalCreate(), [0, -3, 0]);
    close(down[1], -Math.PI / 2);
    const x = sphericalFromVec3(sphericalCreate(), [2, 0, 0]);
    close(x[2], Math.PI / 2);
  });

  test("default up matches +Y", () => {
    const position = [1, 2, 3];
    const target = [-1, 0, 2];
    const s = sphericalFromPositionTarget([1, 0, 0], position, target);
    closeVec(vec3FromSphericalTarget([0, 0, 0], s, target), position);
    assert.deepEqual(
      s,
      sphericalFromPositionTarget([1, 0, 0], position, target, [0, 1, 0]),
    );
  });

  test("normalizeAngle keeps (-π, π] boundaries and multiples of a turn", () => {
    close(normalizeAngle(Math.PI), Math.PI);
    close(normalizeAngle(-Math.PI), Math.PI);
    close(normalizeAngle(0), 0);
    close(normalizeAngle(TAU * 5), 0);
    close(normalizeAngle(-TAU * 5 - 0.5), -0.5);
  });

  test("shortestAngle crosses ±π the short way, both directions", () => {
    close(shortestAngle(-3, 3), -3 + TAU);
    close(shortestAngle(3, -3), 3 - TAU);
    close(shortestAngle(1, 1.5), 1);
    close(shortestAngle(TAU * 3 + 0.1, 0), 0.1);
  });
});

describe("math", () => {
  test("constants", () => {
    close(TAU, 2 * Math.PI, 1e-15);
  });

  test("safeDivide falls back unless the denominator is positive", () => {
    assert.equal(safeDivide(3, 2), 1.5);
    assert.equal(safeDivide(3, 0), 0);
    assert.equal(safeDivide(3, -2), 0);
    assert.equal(safeDivide(3, NaN, 1), 1);
  });

  test("quatFromUnitVectors rotates from onto to", () => {
    const cases = [
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 1],
        [0, 0, 1],
      ],
      [
        [Math.SQRT1_2, Math.SQRT1_2, 0],
        [0, 0, -1],
      ],
      // Opposite, both orthogonal axis branches.
      [
        [1, 0, 0],
        [-1, 0, 0],
      ],
      [
        [0, 0, 1],
        [0, 0, -1],
      ],
    ];
    for (const [from, to] of cases) {
      const q = quatFromUnitVectors([0, 0, 0, 1], from, to);
      close(Math.hypot(...q), 1);
      closeVec(rotate(q, from), to);
    }
    assert.deepEqual(
      quatFromUnitVectors([1, 2, 3, 4], [0, 1, 0], [0, 1, 0]),
      [0, 0, 0, 1],
    );
  });
  test("quatLookAt orients -Z towards the target", () => {
    const q = quatLookAt([0, 0, 0, 1], [5, 0, 0], [0, 0, 0]);
    // Rotate -Z by q.
    const [x, y, z, w] = q;
    const forward = [
      -(2 * (x * z + w * y)),
      -(2 * (y * z - w * x)),
      -(1 - 2 * (x * x + y * y)),
    ];
    closeVec(forward, [-1, 0, 0]);
  });

  test("quatLookAt on the target keeps the orientation", () => {
    const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    quatLookAt(q, [1, 1, 1], [1, 1, 1]);
    assert.deepEqual(q, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  });

  test("quatLookAt along the up axis falls back to an orthogonal up", () => {
    for (const [position, target, up] of [
      [[0, 5, 0], [0, 0, 0], undefined],
      [
        [0, -5, 0],
        [0, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 5],
        [0, 0, 0],
        [0, 0, 1],
      ],
      [
        [0, 0, -5],
        [0, 0, 0],
        [0, 0, -1],
      ],
    ]) {
      const q = quatLookAt([0, 0, 0, 1], position, target, up);
      assert.ok(q.every(Number.isFinite));
      close(Math.hypot(...q), 1);
      const direction = target.map((v, i) => (v - position[i]) / 5);
      closeVec(forward(q), direction);
    }
  });

  test("quatLookAt keeps the camera up on the up side", () => {
    const q = quatLookAt([0, 0, 0, 1], [3, 1, 4], [0, 0, 0], [0, 0, 1]);
    assert.ok(upOf(q)[2] > 0);
  });
});

describe("pose edge cases", () => {
  test("create and set copy every field without aliasing", () => {
    const source = {
      position: [1, 2, 3],
      target: [4, 5, 6],
      up: [0, 0, 1],
      orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      fov: 0.5,
      zoom: 2,
      focusDistance: 3,
    };
    const out = pose.set(pose.create(), source);
    assert.deepEqual(out, source);
    assert.notEqual(out.position, source.position);
    assert.notEqual(out.orientation, source.orientation);

    // Optional lens values are cleared too.
    pose.set(out, pose.create());
    assert.equal(out.fov, undefined);
    assert.equal(out.zoom, undefined);
    assert.equal(out.focusDistance, undefined);
  });

  test("default adapter only writes what both sides define", () => {
    const full = {
      position: [0, 0, 0],
      target: [0, 0, 0],
      up: [0, 0, 0],
      orientation: [0, 0, 0, 0],
      fov: 1,
      zoom: 1,
      focusDistance: 1,
    };
    const p = {
      ...pose.create(),
      fov: 0.3,
      zoom: 4,
      focusDistance: 9,
    };
    pose.applyTo(p, full);
    assert.deepEqual(full, p);

    const empty = {};
    pose.applyTo(p, empty);
    assert.deepEqual(empty, {});

    // Undefined pose values leave the object alone.
    const camera = { fov: 1, zoom: 2, focusDistance: 3 };
    pose.defaultAdapter(pose.create(), camera);
    assert.deepEqual(camera, { fov: 1, zoom: 2, focusDistance: 3 });
  });

  test("applyTo returns the object and uses a custom adapter", () => {
    const object = {};
    const result = pose.applyTo(pose.create(), object, (p, o) => {
      o.z = p.position[2];
    });
    assert.equal(result, object);
    assert.equal(object.z, 1);
  });
});

describe("Emitter edge cases", () => {
  class Source extends Emitter {
    fire(type = "change", value) {
      this.emit(type, value);
    }
  }

  test("an aborted signal never registers", () => {
    const source = new Source();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const off = source.on("change", () => calls++, {
      signal: controller.signal,
    });
    off();
    source.fire();
    assert.equal(calls, 0);
  });

  test("adding a listener twice keeps one", () => {
    const source = new Source();
    let calls = 0;
    const listener = () => calls++;
    source.on("change", listener);
    source.on("change", listener);
    source.fire();
    assert.equal(calls, 1);
  });

  test("each registration has its own off", () => {
    const source = new Source();
    let calls = 0;
    const listener = () => calls++;
    const off = source.on("change", listener);
    source.on("change", listener, { once: true });
    off();
    source.fire();
    source.fire();
    assert.equal(calls, 1);
  });

  test("once listeners removing themselves don't skip others", () => {
    const source = new Source();
    const calls = [];
    source.on("change", () => calls.push(1), { once: true });
    source.on("change", () => calls.push(2), { once: true });
    source.on("change", () => calls.push(3));
    source.fire();
    source.fire();
    assert.deepEqual(calls, [1, 2, 3, 3]);
  });

  test("aborting after firing a once listener is harmless", () => {
    const source = new Source();
    const controller = new AbortController();
    let calls = 0;
    source.on("change", () => calls++, {
      once: true,
      signal: controller.signal,
    });
    source.fire();
    controller.abort();
    source.fire();
    assert.equal(calls, 1);
  });

  test("passes the event through", () => {
    const source = new Source();
    let received;
    source.on("change", (event) => (received = event));
    const event = { type: "change" };
    source.fire("change", event);
    assert.equal(received, event);
  });
});

describe("PoseSource", () => {
  class Mover extends PoseSource {
    value = 0;
    end = 0;
    lens = null;
    callback = null;
    nested = { list: [1, 2] };
    list = [1, 2];
    constructor(options) {
      super();
      if (options) this.set(options);
    }
    step() {
      if (this.value === this.end) return false;
      this.value += Math.sign(this.end - this.value);
      return true;
    }
    writePose(out) {
      out.position[0] = this.value;
    }
  }

  test("set clones data but keeps lenses and functions by reference", () => {
    const lens = { type: "Perspective", aspect: 1, fov: 1 };
    const callback = () => {};
    const nested = { list: [3, 4] };
    const source = new Mover({ lens, callback, nested, end: undefined });
    assert.equal(source.lens, lens);
    assert.equal(source.callback, callback);
    assert.deepEqual(source.nested, nested);
    assert.notEqual(source.nested, nested);
    assert.notEqual(source.nested.list, nested.list);
    // Undefined keeps the default, null is a value.
    assert.equal(source.end, 0);
    const typed = new Float32Array([1, 2]);
    source.set({ nested: { list: typed } });
    assert.ok(source.nested.list instanceof Float32Array);
    assert.notEqual(source.nested.list, typed);
    assert.deepEqual([...source.nested.list], [1, 2]);
    // Functions nested in settings are kept, not cloned.
    const easing = (t) => t;
    source.set({ nested: { easing } });
    assert.equal(source.nested.easing, easing);
    // Class instances are kept by reference.
    const instance = new Map();
    source.set({ callback: instance });
    assert.equal(source.callback, instance);
    source.set({ callback: null });
    assert.equal(source.callback, null);
  });

  test("set writes into existing arrays", () => {
    const source = new Mover();
    const { list } = source;
    const value = [[3], 4, 5];
    source.set({ list: value });
    assert.equal(source.list, list);
    assert.deepEqual(list, [[3], 4, 5]);
    assert.notEqual(list[0], value[0]);
    source.set({ list: new Float32Array([6]) });
    assert.deepEqual(list, [6]);
  });

  test("wake, update and rest around motion", () => {
    const source = new Mover();
    const events = [];
    for (const type of ["wake", "update", "rest"]) {
      source.on(type, (event) => events.push(event.type));
    }
    // First update writes the initial pose.
    assert.equal(source.update(1 / 60), true);
    assert.deepEqual(events, ["wake", "update", "rest"]);
    assert.equal(source.update(1 / 60), false);
    assert.equal(events.length, 3);

    events.length = 0;
    source.set({ end: 2 });
    assert.equal(source.update(1 / 60), true);
    assert.equal(source.update(1 / 60), true);
    assert.equal(source.update(1 / 60), false);
    assert.deepEqual(events, ["wake", "update", "update", "rest"]);
    assert.equal(source.pose.position[0], 2);
  });

  test("applyTo writes the pose through an adapter", () => {
    const source = new Mover({ end: 1 });
    source.update(1);
    const camera = { position: [0, 0, 0] };
    assert.equal(source.applyTo(camera), camera);
    assert.deepEqual(camera.position, [1, 0, 1]);
    const custom = source.applyTo({}, (p, o) => (o.x = p.position[0]));
    assert.equal(custom.x, 1);
  });
});

describe("Spline edge cases", () => {
  test("needs two points", () => {
    assert.throws(() => new Spline([]), RangeError);
    assert.throws(() => new Spline([0, 0, 0, 1, 0]), RangeError);
  });

  test("copies its points, ignoring a trailing partial one", () => {
    const points = new Float32Array([0, 0, 0, 1, 0, 0, 9]);
    const spline = new Spline(points);
    points[3] = 5;
    assert.deepEqual([...spline.points], [0, 0, 0, 1, 0, 0]);
  });

  test("two points make a straight segment for every alpha", () => {
    for (const alpha of [0, 0.5, 1]) {
      const spline = new Spline(
        [
          [0, 0, 0],
          [4, 0, 0],
        ].flat(),
        { alpha },
      );
      assert.equal(spline.segmentCount, 1);
      close(spline.length, 4, 1e-9);
      closeVec(spline.pointAt([0, 0, 0], 0.25), [1, 0, 0]);
      closeVec(spline.tangentAt([0, 0, 0], 0.5), [1, 0, 0]);
    }
  });

  test("open splines clamp, closed ones wrap", () => {
    const points = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ];
    const open = new Spline(points.flat());
    assert.equal(open.segmentCount, 3);
    assert.equal(open.parameterAt(-1), 0);
    assert.equal(open.parameterAt(2), 1);
    closeVec(open.pointAt([0, 0, 0], -1), points[0]);
    closeVec(open.pointAt([0, 0, 0], 2), points[3]);
    closeVec(open.pointAtParameter([0, 0, 0], 1), points[3]);
    closeVec(open.pointAtParameter([0, 0, 0], -1), points[0]);

    const closed = new Spline(points.flat(), { closed: true });
    assert.equal(closed.segmentCount, 4);
    close(closed.parameterAt(1.25), closed.parameterAt(0.25));
    close(closed.parameterAt(-0.75), closed.parameterAt(0.25));
    closeVec(closed.pointAt([0, 0, 0], 3), points[0]);
    closeVec(closed.pointAtParameter([0, 0, 0], -0.25), points[3]);
  });

  test("tangents at the ends and across the closed seam", () => {
    const points = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ];
    const open = new Spline(points.flat());
    closeVec(open.tangentAt([0, 0, 0], 0), [1, 0, 0], 1e-3);
    closeVec(open.tangentAt([0, 0, 0], 1), [-1, 0, 0], 1e-3);

    const closed = new Spline(points.flat(), { closed: true });
    const before = closed.tangentAt([0, 0, 0], -1e-6);
    const at = closed.tangentAt([0, 0, 0], 0);
    closeVec(before, at, 1e-3);
    close(Math.hypot(...at), 1);
  });

  test("duplicate points stay finite", () => {
    const spline = new Spline(
      [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ].flat(),
    );
    close(spline.length, 1, 1e-6);
    for (let u = 0; u <= 1; u += 0.125) {
      assert.ok(spline.pointAt([0, 0, 0], u).every(Number.isFinite));
    }
  });

  test("a single repeated point has no length", () => {
    const spline = new Spline(
      [
        [1, 2, 3],
        [1, 2, 3],
      ].flat(),
    );
    close(spline.length, 0, 1e-12);
    closeVec(spline.pointAt([0, 0, 0], 0.5), [1, 2, 3], 1e-12);
  });

  test("arc length is exact on a straight multi segment line", () => {
    const spline = new Spline(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
        [6, 0, 0],
      ].flat(),
      { samplesPerSegment: 8 },
    );
    close(spline.length, 6, 1e-9);
    closeVec(spline.pointAt([0, 0, 0], 0.5), [3, 0, 0], 1e-2);
  });
});
