import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  Camera,
  CameraType,
  PerspectiveCamera,
  OrthographicCamera,
  lens,
  projection,
} from "../lib/camera/index.js";
import { close, closeVec, forward, upOf } from "./helpers/utils.js";

// Project a view space point and return NDC.
const project = (m, [x, y, z]) => {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [0, 1, 2].map(
    (i) => (m[i] * x + m[i + 4] * y + m[i + 8] * z + m[i + 12]) / w,
  );
};

const projectDepth = (m, z) => project(m, [0, 0, z])[2];

describe("projection depth", () => {
  const near = 0.5;
  const far = 50;
  const bounds = [-1, 1, -1, 1];
  const cases = [
    ["zero-to-one", false, 0, 1],
    ["zero-to-one", true, 1, 0],
    ["negative-one-to-one", false, -1, 1],
    ["negative-one-to-one", true, 1, -1],
  ];

  for (const [depthRange, reversedZ, atNear, atFar] of cases) {
    const depth = { depthRange, reversedZ };
    const label = `${depthRange}${reversedZ ? " reversed" : ""}`;

    test(`frustum ${label}`, () => {
      const m = projection.frustum(new Array(16), bounds, near, far, depth);
      close(project(m, [0, 0, -near])[2], atNear);
      close(project(m, [0, 0, -far])[2], atFar);
    });

    test(`frustum infinite far ${label}`, () => {
      const m = projection.frustum(
        new Array(16),
        bounds,
        near,
        Infinity,
        depth,
      );
      close(project(m, [0, 0, -near])[2], atNear);
      close(project(m, [0, 0, -1e9])[2], atFar, 1e-6);
    });

    test(`orthographic ${label}`, () => {
      const m = projection.orthographic(
        new Array(16),
        bounds,
        near,
        far,
        depth,
      );
      close(project(m, [0, 0, -near])[2], atNear);
      close(project(m, [0, 0, -far])[2], atFar);
    });
  }
});

describe("PerspectiveCamera", () => {
  test("defaults to WebGPU zero-to-one depth", () => {
    const camera = new PerspectiveCamera({ near: 1, far: 10 });
    close(project(camera.projectionMatrix, [0, 0, -1])[2], 0);
    close(project(camera.projectionMatrix, [0, 0, -10])[2], 1);
  });

  test("fov maps the frustum edge to NDC 1", () => {
    const camera = new PerspectiveCamera({ fov: Math.PI / 2, aspect: 2 });
    close(project(camera.projectionMatrix, [0, 5, -5])[1], 1);
    close(project(camera.projectionMatrix, [10, 0, -5])[0], 1);
  });

  test("view offset selects a sub-frustum", () => {
    const camera = new PerspectiveCamera({
      fov: Math.PI / 2,
      view: { totalSize: [200, 100], size: [100, 100], offset: [100, 0] },
      aspect: 2,
    });
    // Right half of the full view: x = 0 maps to the left edge.
    close(project(camera.projectionMatrix, [0, 0, -5])[0], -1);
  });

  test("jitter shifts NDC by a constant offset", () => {
    const camera = new PerspectiveCamera({ jitter: [0.01, -0.02] });
    const [x, y] = project(camera.projectionMatrix, [0, 0, -3]);
    close(x, 0.01);
    close(y, -0.02);
  });

  test("update builds the view matrix from position and orientation", () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 5] });
    close(camera.viewMatrix[14], -5);
    close(camera.inverseViewMatrix[14], 5);
  });

  test("looks at the target when position changes", () => {
    const camera = new PerspectiveCamera({ position: [3, 3, 3] });
    // Target projects to the view space -Z axis.
    const [x, y, z] = [0, 1, 2].map((i) => camera.viewMatrix[i + 12]);
    close(Math.hypot(x, y), 0);
    close(z, -Math.hypot(3, 3, 3));
  });

  test("stays valid when looking straight down the up axis", () => {
    const camera = new PerspectiveCamera({ position: [0, 5, 0] });
    assert.ok(camera.viewMatrix.every(Number.isFinite));
    close(camera.viewMatrix[14], -5);
  });

  test("does not alias option arrays", () => {
    const position = [0, 0, 5];
    const camera = new PerspectiveCamera({ position });
    position[2] = 10;
    assert.equal(camera.position[2], 5);
  });

  test("copies typed arrays into plain arrays", () => {
    const camera = new PerspectiveCamera({
      position: new Float32Array([0, 0, 5]),
    });
    assert.ok(Array.isArray(camera.position));
    assert.equal(camera.position[2], 5);
  });

  test("unitsPerPixel at the target distance", () => {
    const camera = new PerspectiveCamera({
      fov: Math.PI / 2,
      position: [0, 0, 5],
    });
    close(camera.unitsPerPixel(100), 0.1);
  });
});

describe("OrthographicCamera", () => {
  test("zoom > 1 narrows the frustum", () => {
    const camera = new OrthographicCamera({ zoom: 2 });
    close(camera.projectionMatrix[0], 2);
    close(project(camera.projectionMatrix, [0.5, 0, -1])[0], 1);
  });

  test("size and aspect define the frustum", () => {
    const camera = new OrthographicCamera({ size: 5, aspect: 2 });
    assert.deepEqual(
      [camera.left, camera.right, camera.bottom, camera.top],
      [-10, 10, -5, 5],
    );
    close(project(camera.projectionMatrix, [10, 5, -1])[0], 1);
    close(project(camera.projectionMatrix, [10, 5, -1])[1], 1);
  });

  test("halfHeightAtDistance preserves perspective framing", () => {
    const perspective = new PerspectiveCamera({
      fov: 0.8,
      position: [0, 0, 7],
    });
    const orthographic = new OrthographicCamera({
      size: projection.halfHeightAtDistance(perspective.fov, 7),
    });
    close(perspective.unitsPerPixel(1080), orthographic.unitsPerPixel(1080));
    close(projection.distanceForHalfHeight(0.8, orthographic.size), 7);
  });

  test("view offset honours zoom", () => {
    const camera = new OrthographicCamera({
      zoom: 2,
      view: { totalSize: [100, 100], size: [50, 100], offset: [50, 0] },
    });
    // Right half of a [-0.5, 0.5] frustum.
    close(project(camera.projectionMatrix, [0, 0, -1])[0], -1);
    close(project(camera.projectionMatrix, [0.5, 0, -1])[0], 1);
  });
});

describe("Camera", () => {
  test("types", () => {
    assert.equal(new PerspectiveCamera().type, CameraType.Perspective);
    assert.equal(new OrthographicCamera().type, CameraType.Orthographic);
    assert.ok(new PerspectiveCamera() instanceof Camera);
  });

  test("set without options keeps the defaults and returns the camera", () => {
    const camera = new PerspectiveCamera();
    const before = [...camera.projectionMatrix];
    assert.equal(camera.set(), camera);
    assert.deepEqual(camera.projectionMatrix, before);
  });

  test("set ignores undefined values", () => {
    const camera = new PerspectiveCamera({ near: 2 });
    camera.set({ near: undefined, position: undefined });
    assert.equal(camera.near, 2);
    assert.deepEqual(camera.position, [0, 0, 1]);
  });

  test("lens only changes keep the orientation", () => {
    const camera = new PerspectiveCamera({ orientation: [0, 1, 0, 0] });
    camera.set({ fov: 1, near: 0.5 });
    assert.deepEqual(camera.orientation, [0, 1, 0, 0]);
  });

  test("an explicit orientation wins over position and target", () => {
    const orientation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const camera = new PerspectiveCamera({
      position: [0, 0, 5],
      target: [0, 0, 0],
      orientation,
    });
    assert.deepEqual(camera.orientation, orientation);
    assert.notEqual(camera.orientation, orientation);
  });

  test("target and up changes look again", () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 5] });
    camera.set({ target: [5, 0, 5] });
    closeVec(forward(camera.orientation), [1, 0, 0]);
    camera.set({ up: [0, 0, 1], position: [0, 5, 0], target: [0, 0, 0] });
    closeVec(forward(camera.orientation), [0, -1, 0]);
    assert.ok(upOf(camera.orientation)[2] > 0.99);
  });

  test("lookAt copies an explicit target and up", () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 5] });
    const target = [5, 0, 5];
    const up = [0, 0, 1];
    camera.lookAt(target, up);
    assert.notEqual(camera.target, target);
    assert.deepEqual(camera.target, target);
    assert.deepEqual(camera.up, up);
    closeVec(forward(camera.orientation), [1, 0, 0]);
    // Defaults reuse the current target and up.
    camera.position[2] = 10;
    camera.lookAt();
    closeVec(
      forward(camera.orientation),
      [1, 0, -1].map((v) => v / Math.SQRT2),
    );
  });

  test("objects are cloned, not aliased", () => {
    const view = { totalSize: [2, 2], size: [1, 1], offset: [0, 0] };
    const jitter = [0.1, 0];
    const camera = new PerspectiveCamera({ view, jitter });
    view.offset[0] = 1;
    jitter[0] = 0.5;
    assert.equal(camera.view.offset[0], 0);
    assert.equal(camera.jitter[0], 0.1);
  });

  test("update keeps the view matrix the inverse of the camera transform", () => {
    const camera = new PerspectiveCamera({
      position: [1, 2, 3],
      target: [-2, 0, 1],
    });
    camera.position[0] = 4;
    camera.update();
    const m = camera.viewMatrix;
    const n = camera.inverseViewMatrix;
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += m[k * 4 + row] * n[column * 4 + k];
        close(sum, row === column ? 1 : 0, 1e-9);
      }
    }
    close(n[12], 4);
  });

  test("unitsPerPixel at an explicit distance and with zoom", () => {
    const camera = new PerspectiveCamera({ fov: Math.PI / 2, zoom: 2 });
    close(camera.unitsPerPixel(100, 10), 0.1);
    close(camera.getHalfHeightAtDistance(4), 2);
  });
});

describe("PerspectiveCamera lens", () => {
  test("focal length overrides fov, for every sensor fit and aspect", () => {
    for (const aspect of [0.5, 1.5, 2.4]) {
      for (const sensorFit of ["vertical", "horizontal", "fill", "overscan"]) {
        const camera = new PerspectiveCamera({
          fov: 0.1,
          focalLength: 50,
          aspect,
          sensorFit,
        });
        close(camera.fov, lens.verticalFov(50, [36, 24], aspect, sensorFit));
      }
    }
  });

  test("fov is free again without a focal length", () => {
    const camera = new PerspectiveCamera({ focalLength: 50 });
    camera.focalLength = undefined;
    camera.set({ fov: 1 });
    assert.equal(camera.fov, 1);
  });

  test("sensor size drives the fov", () => {
    const camera = new PerspectiveCamera({
      focalLength: 50,
      sensorSize: [24, 12],
    });
    close(camera.fov, lens.fovFromFocalLength(50, 12));
  });

  test("exposure follows aperture, shutter, ISO and compensation", () => {
    for (const camera of [new PerspectiveCamera(), new OrthographicCamera()]) {
      const base = camera.exposure;
      // One stop: double the shutter time, the ISO, or +1 compensation.
      camera.shutterSpeed *= 2;
      close(camera.exposure, base * 2);
      camera.shutterSpeed /= 2;
      camera.iso = 200;
      close(camera.exposure, base * 2);
      camera.iso = 100;
      camera.exposureCompensation = 1;
      close(camera.exposure, base * 2);
      camera.exposureCompensation = 0;
      camera.fStop = 16 * Math.SQRT2;
      close(camera.exposure, base / 2);
    }
  });

  test("reversed Z and infinite far from the camera options", () => {
    const camera = new PerspectiveCamera({
      near: 1,
      far: Infinity,
      reversedZ: true,
    });
    close(projectDepth(camera.projectionMatrix, -1), 1);
    close(projectDepth(camera.projectionMatrix, -1e9), 0);

    camera.set({
      depthRange: "negative-one-to-one",
      reversedZ: false,
      far: 10,
    });
    close(projectDepth(camera.projectionMatrix, -1), -1);
    close(projectDepth(camera.projectionMatrix, -10), 1);
  });
});

describe("OrthographicCamera lens", () => {
  test("ortho scale overrides size, for every sensor fit and aspect", () => {
    for (const aspect of [0.5, 1.5, 2.4]) {
      for (const sensorFit of ["vertical", "horizontal", "fill", "overscan"]) {
        const camera = new OrthographicCamera({
          size: 0.1,
          orthoScale: 6,
          aspect,
          sensorFit,
        });
        close(
          camera.size,
          lens.orthographicSize(6, [36, 24], aspect, sensorFit),
        );
      }
    }
  });

  test("size is free again without an ortho scale", () => {
    const camera = new OrthographicCamera({ orthoScale: 6 });
    camera.orthoScale = undefined;
    camera.set({ size: 2 });
    assert.equal(camera.size, 2);
  });

  test("sensor aspect drives fill and overscan", () => {
    const camera = new OrthographicCamera({
      orthoScale: 4,
      sensorSize: [24, 24],
      sensorFit: "overscan",
      aspect: 2,
    });
    close(camera.size, 2);
  });
});

describe("OrthographicCamera edge cases", () => {
  test("frustum bounds at zoom 1, projection at any zoom", () => {
    const camera = new OrthographicCamera({ size: 2, aspect: 1.5, zoom: 4 });
    assert.deepEqual(
      [camera.left, camera.right, camera.bottom, camera.top],
      [-3, 3, -2, 2],
    );
    close(project(camera.projectionMatrix, [0.75, 0.5, -1])[0], 1);
    close(project(camera.projectionMatrix, [0.75, 0.5, -1])[1], 1);
  });

  test("visible height doesn't depend on distance", () => {
    const camera = new OrthographicCamera({ size: 3, zoom: 2 });
    close(camera.getHalfHeightAtDistance(1), 1.5);
    close(camera.unitsPerPixel(300, 1), camera.unitsPerPixel(300, 1000));
    close(camera.unitsPerPixel(300), 0.01);
  });

  test("explicit bounds override size and aspect", () => {
    const camera = new OrthographicCamera({
      size: 5,
      aspect: 2,
      bounds: [0, 200, 100, 0],
    });
    assert.deepEqual(
      [camera.left, camera.right, camera.bottom, camera.top],
      [0, 200, 100, 0],
    );
    // Pixel coordinates, y down: top-left to NDC (-1, 1).
    closeVec(project(camera.projectionMatrix, [0, 0, -1]).slice(0, 2), [-1, 1]);
    closeVec(
      project(camera.projectionMatrix, [200, 100, -1]).slice(0, 2),
      [1, -1],
    );
    close(camera.getHalfHeightAtDistance(), 50);
  });

  test("explicit bounds zoom around their center, with a view offset", () => {
    const camera = new OrthographicCamera({ bounds: [0, 4, 0, 2], zoom: 2 });
    // [1, 3] x [0.5, 1.5]
    close(project(camera.projectionMatrix, [1, 0.5, -1])[0], -1);
    close(project(camera.projectionMatrix, [3, 1.5, -1])[1], 1);

    camera.set({
      view: { totalSize: [100, 100], size: [50, 100], offset: [50, 0] },
    });
    close(project(camera.projectionMatrix, [2, 1, -1])[0], -1);
    close(project(camera.projectionMatrix, [3, 1, -1])[0], 1);
  });

  test("size is used again without bounds", () => {
    const camera = new OrthographicCamera({ bounds: [0, 4, 0, 2] });
    camera.bounds = undefined;
    camera.set({ size: 2, aspect: 1 });
    assert.deepEqual([camera.left, camera.top], [-2, 2]);
  });

  test("reversed Z and jitter", () => {
    const camera = new OrthographicCamera({
      near: 1,
      far: 11,
      reversedZ: true,
      jitter: [0.02, 0.04],
    });
    const [x, y, z] = project(camera.projectionMatrix, [0, 0, -1]);
    close(x, 0.02);
    close(y, 0.04);
    close(z, 1);
    close(project(camera.projectionMatrix, [0, 0, -11])[2], 0);
  });
});

describe("projection helpers", () => {
  test("view offset selects rows top down", () => {
    const bounds = projection.applyViewOffset([-2, 2, -1, 1], {
      totalSize: [4, 2],
      size: [2, 1],
      offset: [1, 1],
    });
    assert.deepEqual(bounds, [-1, 1, -1, 0]);
  });

  test("a full view offset is the identity", () => {
    const bounds = [-2, 2, -1, 1];
    projection.applyViewOffset(bounds, {
      totalSize: [10, 5],
      size: [10, 5],
      offset: [0, 0],
    });
    assert.deepEqual(bounds, [-2, 2, -1, 1]);
  });

  test("jitter adds w scaled offsets, perspective and orthographic", () => {
    const perspective = projection.frustum(
      new Array(16),
      [-1, 1, -1, 1],
      1,
      10,
      { depthRange: "zero-to-one", reversedZ: false },
    );
    projection.applyJitter(perspective, [0.1, -0.1]);
    const [x, y] = project(perspective, [0, 0, -4]);
    close(x, 0.1);
    close(y, -0.1);
  });

  test("bounds helpers match the camera classes", () => {
    const top = Math.tan(0.5) / 2;
    closeVec(
      projection.perspectiveBounds([0, 0, 0, 0], 1, 1.5, 1, 2),
      [-1.5 * top, 1.5 * top, -top, top],
    );
    assert.deepEqual(
      projection.orthographicBounds([0, 0, 0, 0], 2, 1.5, 4),
      [-0.75, 0.75, -0.5, 0.5],
    );
    assert.deepEqual(
      projection.zoomBounds([0, 0, 0, 0], [0, 4, 2, 0], 2),
      [1, 3, 1.5, 0.5],
    );
  });

  test("half height and distance are inverses", () => {
    for (const fov of [0.1, 1, 2.5]) {
      close(
        projection.distanceForHalfHeight(
          fov,
          projection.halfHeightAtDistance(fov, 7),
        ),
        7,
      );
    }
    assert.equal(projection.halfHeightAtDistance(1, 0), 0);
  });
});

describe("lens edge cases", () => {
  test("constants", () => {
    assert.deepEqual(lens.FULL_FRAME, [36, 24]);
    assert.equal(lens.FULL_FRAME_COC, 0.03);
  });

  test("fitted sensor height drives the vertical fov", () => {
    for (const aspect of [0.5, 1.5, 2.4]) {
      for (const fit of ["vertical", "horizontal", "fill", "overscan"]) {
        close(
          lens.verticalFov(50, [36, 24], aspect, fit),
          lens.fovFromFocalLength(
            50,
            lens.fittedSensorHeight([36, 24], aspect, fit),
          ),
        );
      }
    }
    assert.equal(lens.fittedSensorHeight([36, 24], 2), 24);
    assert.equal(lens.fittedSensorHeight([36, 24], 2, "horizontal"), 18);
  });

  test("vertical fit is the default", () => {
    assert.equal(
      lens.verticalFov(35, [36, 24], 2),
      lens.verticalFov(35, [36, 24], 2, "vertical"),
    );
  });

  test("fill crops and overscan shows the whole sensor on both sides of its aspect", () => {
    for (const aspect of [1, 3]) {
      const vertical = lens.fovFromFocalLength(50, 24);
      const horizontal = lens.verticalFov(50, [36, 24], aspect, "horizontal");
      close(
        lens.verticalFov(50, [36, 24], aspect, "fill"),
        Math.min(vertical, horizontal),
      );
      close(
        lens.verticalFov(50, [36, 24], aspect, "overscan"),
        Math.max(vertical, horizontal),
      );
    }
    // Matching aspects: every fit agrees.
    for (const fit of ["vertical", "horizontal", "fill", "overscan"]) {
      close(
        lens.verticalFov(50, [36, 24], 1.5, fit),
        lens.fovFromFocalLength(50, 24),
      );
    }
  });

  test("orthographic size: vertical fit is the default and matches the scale", () => {
    assert.equal(
      lens.orthographicSize(4, [36, 24], 2),
      lens.orthographicSize(4, [36, 24], 2, "vertical"),
    );
    close(lens.orthographicSize(4, [36, 24], 2), 2);
    close(lens.orthographicSize(4, [36, 24], 2, "horizontal"), 1);
  });

  test("orthographic fill crops and overscan shows the whole sensor on both sides of its aspect", () => {
    for (const aspect of [1, 3]) {
      const vertical = (6 * 24) / 36 / 2;
      const horizontal = lens.orthographicSize(
        6,
        [36, 24],
        aspect,
        "horizontal",
      );
      close(
        lens.orthographicSize(6, [36, 24], aspect, "fill"),
        Math.min(vertical, horizontal),
      );
      close(
        lens.orthographicSize(6, [36, 24], aspect, "overscan"),
        Math.max(vertical, horizontal),
      );
    }
    // Matching aspects: horizontal, fill and overscan agree.
    for (const fit of ["horizontal", "fill", "overscan"]) {
      close(lens.orthographicSize(6, [36, 24], 1.5, fit), 2);
    }
  });

  test("circle of confusion is infinite inside the focal length or behind the lens", () => {
    assert.equal(lens.circleOfConfusion(5, 0.05, 50, 2.8), Infinity);
    assert.equal(lens.circleOfConfusion(5, 0.01, 50, 2.8), Infinity);
    assert.equal(lens.circleOfConfusion(0, 5, 50, 2.8), Infinity);
    assert.equal(lens.circleOfConfusion(-1, 5, 50, 2.8), Infinity);
    // Sharp at infinity when focused at the hyperfocal distance.
    const hyperfocal = lens.hyperfocalDistance(50, 8);
    close(
      lens.circleOfConfusion(1e12, hyperfocal, 50, 8),
      lens.FULL_FRAME_COC,
      1e-4,
    );
    close(
      lens.hyperfocalDistance(50, 8, 0.015),
      (50 * 50) / (8 * 0.015) / 1000 + 0.05,
    );
  });

  test("dolly zoom distance is identity for the same fov", () => {
    close(lens.dollyZoomDistance(7, 1, 1), 7);
  });
});
