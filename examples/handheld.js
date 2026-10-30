import {
  HANDHELD_LAYERS,
  Handheld,
  OrbitControls,
  PerspectiveCamera,
  PointerManager,
} from "cameras";

import { addLens, addMonitor, bindSettings, run, start } from "./common.js";

function handheld({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 0.8 });
  const input = new PointerManager(ctx.canvas).enable();
  const controls = new OrbitControls({
    lens: camera,
    position: [0, 4, 12],
    target: [0, 0.5, 0],
  }).attach(input);
  const modifier = new Handheld({ lens: camera, seed: 1 });

  const config = { preset: "mild" };
  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    distance: () => controls.getSpherical()[0],
  });
  run({
    ctx,
    scene,
    pane,
    views: [
      {
        camera,
        controls,
        input,
        modifiers: [modifier],
        area: [0, 0, 1, 1],
      },
    ],
    onFrame: update,
  });

  const handheldFolder = pane.addFolder({ title: "Handheld" });
  handheldFolder
    .addBinding(config, "preset", {
      options: Object.fromEntries(
        Object.keys(HANDHELD_LAYERS).map((name) => [name, name]),
      ),
    })
    .on("change", ({ value }) =>
      modifier.set({ layers: HANDHELD_LAYERS[value] }),
    );
  handheldFolder.addBinding(modifier, "amplitude", { min: 0, max: 3 });
  handheldFolder.addBinding(modifier, "frequency", { min: 0, max: 4 });
  handheldFolder.addBinding(modifier, "seed", { min: 0, max: 10, step: 1 });

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
  bindSettings(pane.addFolder({ title: "Orbit", expanded: false }), controls, [
    "smoothTime",
    "azimuthSpeed",
    "elevationSpeed",
    "dollySpeed",
  ]);
}

await start("handheld", handheld);
