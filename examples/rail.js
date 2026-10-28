import {
  OrbitControls,
  PerspectiveCamera,
  PointerManager,
  RailRig,
} from "cameras";

import { addLens, addMonitor, bindSettings, run, start } from "./common.js";

// prettier-ignore
const POINTS = [
  -12, 2, 10,
  0, 1.5, 12,
  12, 3, 6,
  14, 6, -8,
  0, 2, -14,
  -14, 1.2, -6,
];
const SUBJECT = [0, 0.5, 0];
const RAIL_SAMPLES = 400;

function rail({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 0.9 });
  const rig = new RailRig({
    points: POINTS,
    closed: true,
    speed: 4,
    lookAhead: 3,
    lens: camera,
  });

  // Overview of the track and the camera riding it.
  const overviewCamera = new PerspectiveCamera({ near: 0.1, far: 500 });
  const overviewArea = [0.5, 0, 0.5, 1];
  const input = new PointerManager(ctx.canvas, {
    interactiveArea: overviewArea,
  }).enable();
  const overview = new OrbitControls({
    lens: overviewCamera,
    position: [0, 30, 30],
  }).attach(input);

  const railPositions = new Float32Array(RAIL_SAMPLES * 3);
  const point = [0, 0, 0];
  for (let i = 0; i < RAIL_SAMPLES; i++) {
    railPositions.set(rig.spline.pointAt(point, i / (RAIL_SAMPLES - 1)), i * 3);
  }
  const drawRail = scene.createLine(railPositions);
  const drawCamera = scene.createMarker(0.6);

  const config = { lookAtCube: false, progress: 0 };
  const update = addMonitor(pane.addFolder({ title: "State" }), rig, {
    position: () => rig.pose.position,
    target: () => rig.pose.target,
  });
  run({
    ctx,
    scene,
    pane,
    views: [
      { camera, controls: rig, area: [0, 0, 0.5, 1] },
      {
        camera: overviewCamera,
        controls: overview,
        input,
        area: overviewArea,
        draw: (camera, viewport) => {
          drawRail(camera, viewport);
          drawCamera(camera, viewport, rig.pose.position);
        },
      },
    ],
    onFrame: () => {
      // Paused, the slider holds the sought progress: syncing it would emit a
      // change on refresh and seek back to the current one.
      if (rig.playing) {
        config.progress = rig.progress - Math.floor(rig.progress);
      }
      update();
    },
  });

  const railFolder = pane.addFolder({ title: "Rail" });
  railFolder
    .addButton({ title: "play / pause" })
    .on("click", () => (rig.playing ? rig.pause() : rig.play()));
  bindSettings(railFolder, rig, ["speed", "smoothTime"]);
  railFolder.addBinding(rig, "lookAhead", { min: 0.1, max: 10 });
  railFolder
    .addBinding(config, "lookAtCube")
    .on("change", ({ value }) => (rig.subject = value ? SUBJECT : null));
  railFolder
    .addBinding(config, "progress", { min: 0, max: 1 })
    .on("change", ({ value, last }) => {
      if (last !== false && !rig.playing) rig.seek(value);
    });

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
  rig.play();
}

await start("rail", rail);
