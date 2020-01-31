import { PerspectiveCamera, OrthographicCamera } from "./lib/index.js";

import createRegl from "regl";
import Geometries from "primitive-geometry";
import * as dat from "dat.gui";

// Camera
const commonOptions = {
  position: [3, 3, 3]
};
const perspectiveCamera = new PerspectiveCamera(commonOptions);
const orthographicCamera = new OrthographicCamera(commonOptions);

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
      totalSize
    }
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
      totalSize
    }
  });

  orthographicCamera.updateProjectionMatrix();
};
onResize();

// Render
const regl = createRegl();
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
      gl_FragColor = vec4(abs(vNormal), 1.0);
    }`,
  uniforms: {
    projection: regl.prop("projection"),
    view: regl.prop("view")
  },
  attributes: {
    position: cube.positions,
    normal: cube.normals
  },
  elements: cube.cells
});

regl.frame(() => {
  regl.clear({
    color: [0, 0, 0, 1]
  });
  perspectiveCamera.update();
  orthographicCamera.update();

  drawGeometry({
    projection: perspectiveCamera.projectionMatrix,
    view: perspectiveCamera.viewMatrix
  });

  drawGeometry({
    projection: orthographicCamera.projectionMatrix,
    view: orthographicCamera.viewMatrix
  });
});

window.addEventListener("resize", onResize);

// GUI
const gui = new dat.GUI();
gui.add(perspectiveCamera, "fov", 0, Math.PI).onChange(() => {
  perspectiveCamera.updateProjectionMatrix();
});
gui.add(orthographicCamera, "zoom", 0, 10).onChange(() => {
  orthographicCamera.updateProjectionMatrix();
});
