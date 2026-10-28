import {
  OrbitControls,
  PerspectiveCamera,
  PointerManager,
  Shake,
} from "cameras";

import {
  addMonitor,
  addVectorBinding,
  bindSettings,
  run,
  start,
} from "./common.js";

function shake({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 0.8 });
  const input = new PointerManager(ctx.canvas).enable();
  const controls = new OrbitControls({
    lens: camera,
    position: [0, 4, 12],
    target: [0, 0.5, 0],
  }).attach(input);
  const modifier = new Shake({ seed: 1 });

  const config = { trauma: 0.6 };
  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    trauma: () => modifier.trauma,
    amount: () => modifier.amount,
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

  const shakeFolder = pane.addFolder({ title: "Shake" });
  shakeFolder.addBinding(config, "trauma", { min: 0, max: 1 });
  shakeFolder
    .addButton({ title: "hit" })
    .on("click", () => modifier.addTrauma(config.trauma));
  shakeFolder.addBinding(modifier, "decay", { min: 0, max: 5 });
  shakeFolder.addBinding(modifier, "exponent", { min: 1, max: 4 });
  shakeFolder.addBinding(modifier, "frequency", { min: 1, max: 40 });
  addVectorBinding(shakeFolder, modifier, "maxAngles", {
    x: { min: 0, max: 0.3 },
    y: { min: 0, max: 0.3 },
    z: { min: 0, max: 0.3 },
  });
  addVectorBinding(shakeFolder, modifier, "maxOffset", {
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
    z: { min: 0, max: 1 },
  });

  bindSettings(pane.addFolder({ title: "Orbit", expanded: false }), controls, [
    "smoothTime",
    "azimuthSpeed",
    "polarSpeed",
    "dollySpeed",
  ]);
}

await start("shake", shake);
