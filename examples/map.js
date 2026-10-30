import { MapControls, PerspectiveCamera, PointerManager } from "cameras";

import {
  addActions,
  addBindings,
  addLens,
  addMonitor,
  bindSettings,
  run,
  start,
} from "./common.js";

const ACTIONS = [
  "arc",
  "arc-elevation",
  "dolly",
  "zoom",
  "truck-pedestal",
  "truck-dolly",
  "twist",
];

function map({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.1, far: 500 });
  const input = new PointerManager(ctx.canvas).enable();
  const controls = new MapControls({
    lens: camera,
    position: [0, 20, 15],
    distanceBounds: [1, 150],
    boundary: [
      [-25, 0, -25],
      [25, 0, 25],
    ],
  }).attach(input);

  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    target: () => controls.pose.target,
    spherical: () => controls.getSpherical(),
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
  bindSettings(settings, controls, [
    "inertia",
    "minFlingSpeed",
    "dollyToCursor",
    "smoothTime",
    "draggingSmoothTime",
    "azimuthSpeed",
    "elevationSpeed",
    "dollySpeed",
    "truckSpeed",
    "boundaryFriction",
  ]);
  const limits = { minElevation: controls.elevationBounds[0] };
  settings
    .addBinding(limits, "minElevation", { min: 0, max: Math.PI / 2 })
    .on("change", ({ value }) =>
      controls.set({ elevationBounds: [value, Math.PI / 2] }),
    );

  addBindings(
    pane.addFolder({ title: "Bindings", expanded: false }),
    controls,
    Object.keys(MapControls.DEFAULT_BINDINGS),
    ACTIONS,
  );

  addActions(pane.addFolder({ title: "Actions", expanded: false }), [
    [
      "north up",
      (t) => controls.arcTo(0, controls.getSpherical([], true)[1], t),
    ],
    [
      "top down",
      (t) => controls.arcTo(controls.getSpherical([], true)[2], Math.PI / 2, t),
    ],
    ["fly to (10, 0, -10)", (t) => controls.moveTo([10, 0, -10], t)],
    [
      "fit field",
      (t) =>
        controls.fitToBox(
          [
            [-24, 0, -24],
            [24, 2, 24],
          ],
          {},
          t,
        ),
    ],
    ["reset", (t) => controls.reset(t)],
  ]);

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
}

await start("map", map);
