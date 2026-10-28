import { PerspectiveCamera, PointerManager, TrackballControls } from "cameras";

import {
  addActions,
  addBindings,
  addTargetBounds,
  addLens,
  addMonitor,
  bindSettings,
  run,
  start,
} from "./common.js";

const POSITION = [0, 0, 4];

function trackball({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 200 });
  const input = new PointerManager(ctx.canvas).enable();
  const controls = new TrackballControls({
    lens: camera,
    position: POSITION,
    distanceBounds: [0.5, 50],
    dollyToCursor: true,
  }).attach(input);

  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    position: () => controls.pose.position,
    target: () => controls.pose.target,
    up: () => controls.pose.up,
    orientation: () => controls.getOrientation(),
    distance: () => controls.getDistance(),
    zoom: () => controls.getZoom(),
  });
  run({
    ctx,
    scene,
    pane,
    views: [{ camera, controls, input, area: [0, 0, 1, 1] }],
    onFrame: update,
  });

  const settings = pane.addFolder({ title: "Controls" });
  settings.addBinding(controls, "enabled");
  settings.addBinding(controls, "mode", {
    options: {
      "Shoemake (path independent)": "shoemake",
      "Bell (smooth edge)": "bell",
    },
  });
  bindSettings(settings, controls, [
    "inertia",
    "minFlingSpeed",
    "radius",
    "rotateSpeed",
    "rollSpeed",
    "dollySpeed",
    "zoomSpeed",
    "truckSpeed",
    "panTiltSpeed",
    "smoothTime",
    "draggingSmoothTime",
    "restThreshold",
    "dollyToCursor",
    "infinityDolly",
  ]);
  addTargetBounds(
    settings.addFolder({ title: "Bounds", expanded: false }),
    controls,
  );

  addBindings(
    pane.addFolder({ title: "Bindings", expanded: false }),
    controls,
    Object.keys(TrackballControls.DEFAULT_BINDINGS),
    [
      "rotate",
      "roll",
      "dolly",
      "zoom",
      "truck-pedestal",
      "pan-tilt",
      "focal-offset",
    ],
  );

  const actions = pane.addFolder({ title: "Actions", expanded: false });
  addActions(actions, [
    [
      "rotate 90° around screen up",
      (t) => controls.rotate([0, 1, 0], Math.PI / 2, t),
    ],
    ["roll 45°", (t) => controls.roll(Math.PI / 4, t)],
    ["dolly in", (t) => controls.dolly(-1, t)],
    ["dolly out", (t) => controls.dolly(1, t)],
    ["zoom in", (t) => controls.zoom(0.25, t)],
    ["zoom out", (t) => controls.zoom(-0.25, t)],
    ["truck right", (t) => controls.truck(1, 0, t)],
    ["pan left 15°", (t) => controls.pan(Math.PI / 12, t)],
    ["tilt up 15°", (t) => controls.tilt(Math.PI / 12, t)],
    [
      "front view",
      (t) => controls.setLookAt(POSITION, [0, 0, 0], [0, 1, 0], t),
    ],
    ["setPosition (4, 0, 0)", (t) => controls.setPosition([4, 0, 0], t)],
    [
      "lookInDirectionOf (1, 0, -1)",
      (t) => controls.lookInDirectionOf([1, 0, -1], t),
    ],
    ["setFocalOffset (1, 0, 0)", (t) => controls.setFocalOffset([1, 0, 0], t)],
    ["clear focal offset", (t) => controls.setFocalOffset([0, 0, 0], t)],
    [
      "setOrbitPoint cube corner",
      () => controls.setOrbitPoint([0.5, 0.5, 0.5]),
    ],
    ["fitToBox cube", (t) => controls.fitToBox(scene.cubeBox, {}, t)],
    [
      "fitToSphere cube",
      (t) => controls.fitToSphere([0, 0, 0], Math.sqrt(0.75), t),
    ],
    ["saveState", () => controls.saveState()],
    ["reset", (t) => controls.reset(t)],
    ["stop", () => controls.stop()],
  ]);

  const lerp = { t: 0 };
  const from = { target: [0, 0, 0], distance: 6, orientation: [0, 0, 0, 1] };
  const to = {
    target: [1, 0, 0],
    distance: 3,
    // Half a turn around a diagonal axis: rolls and flips the view.
    orientation: [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
  };
  actions
    .addBinding(lerp, "t", { label: "lerp", min: 0, max: 1 })
    .on("change", ({ value }) => controls.lerp(from, to, value, false));

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
}

await start("trackball", trackball);
