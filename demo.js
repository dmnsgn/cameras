import {
  PerspectiveCamera,
  OrthographicCamera,
  Controls,
} from "./lib/index.js";

import createRegl from "regl";
import Geometries from "primitive-geometry";
import { vec3 } from "gl-matrix";

// Camera
const regl = createRegl();

const clone = (obj) => JSON.parse(JSON.stringify(obj));
const commonOptions = {
  position: [3, 3, 3],
  // target: [0, -0.5, 0],
};
const perspectiveCamera = new PerspectiveCamera(clone(commonOptions));
const orthographicCamera = new OrthographicCamera(clone(commonOptions));
const perspectiveCameraControls = new Controls({
  element: regl._gl.canvas,
  camera: perspectiveCamera,
});
const orthographicCameraControls = new Controls({
  position: [1, 1, 1],
  element: regl._gl.canvas,
  camera: orthographicCamera,
});

const onResize = () => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewWidth = viewportWidth * 0.5;
  const viewSize = 5;

  const aspect = viewportWidth / viewportHeight;
  const size = [viewportWidth, viewportHeight];
  const totalSize = [viewportWidth, viewportHeight];

  Object.assign(perspectiveCamera, {
    aspect,
    view: {
      offset: [viewWidth * 0.5, 0],
      size,
      totalSize,
    },
  });
  perspectiveCamera.updateProjectionMatrix();

  Object.assign(orthographicCamera, {
    left: (-0.5 * viewSize * aspect) / 2,
    right: (0.5 * viewSize * aspect) / 2,
    top: (0.5 * viewSize) / 2,
    bottom: (-0.5 * viewSize) / 2,
    view: {
      offset: [-viewWidth * 0.5, 0],
      size,
      totalSize,
    },
  });

  orthographicCamera.updateProjectionMatrix();
};
onResize();

// Render
const cube = Geometries.cube();

const drawGeometry = regl({
  vert: /* glsl */ `
  precision mediump float;

  uniform mat4 projection, view;
  attribute vec3 position, normal;
  varying vec3 vNormal;

  void main () {
    vNormal = normal;
    gl_Position = projection * view * vec4(position, 1.0);
  }`,
  frag: /* glsl */ `
    precision mediump float;

    varying vec3 vNormal;

    void main () {
      gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1.0);
    }`,
  uniforms: {
    projection: regl.prop("projection"),
    view: regl.prop("view"),
  },
  attributes: {
    position: cube.positions,
    normal: cube.normals,
  },
  elements: cube.cells,
});

regl.frame(() => {
  regl.clear({
    color: [0, 0, 0, 1],
  });

  perspectiveCameraControls.update();
  perspectiveCamera.position = perspectiveCameraControls.position;
  perspectiveCamera.target = perspectiveCameraControls.target;
  perspectiveCamera.update();

  orthographicCameraControls.update();
  orthographicCamera.position = orthographicCameraControls.position;
  orthographicCamera.target = orthographicCameraControls.target;
  orthographicCamera.zoom = vec3.length(orthographicCameraControls.position);
  orthographicCamera.updateProjectionMatrix();
  orthographicCamera.update();

  drawGeometry({
    projection: perspectiveCamera.projectionMatrix,
    view: perspectiveCamera.viewMatrix,
  });

  drawGeometry({
    projection: orthographicCamera.projectionMatrix,
    view: orthographicCamera.viewMatrix,
  });
});

window.addEventListener("resize", onResize);
