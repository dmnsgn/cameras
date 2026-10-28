import { CraneRig, PerspectiveCamera } from "cameras";

import { addLens, addMonitor, bindSettings, run, start } from "./common.js";

const SUBJECT = [0, 0.5, 0];

function crane({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 0.9 });
  const rig = new CraneRig({
    pivot: [4, 0, 4],
    height: 1.5,
    armLength: 6,
    swing: -0.6,
    boom: 0.3,
    target: SUBJECT,
    lens: camera,
  });

  const config = { lookAtCube: true };
  const update = addMonitor(pane.addFolder({ title: "State" }), rig, {
    position: () => rig.pose.position,
    target: () => rig.pose.target,
  });
  run({
    ctx,
    scene,
    pane,
    views: [{ camera, controls: rig, area: [0, 0, 1, 1] }],
    onFrame: update,
  });

  const craneFolder = pane.addFolder({ title: "Crane" });
  const CRANE = {
    swing: rig.get("swing"),
    boom: rig.get("boom"),
    armLength: rig.get("armLength"),
    height: rig.get("height"),
  };
  craneFolder
    .addBinding(CRANE, "swing", { min: -Math.PI, max: Math.PI })
    .on("change", ({ value }) => rig.swingTo(value));
  craneFolder
    .addBinding(CRANE, "boom", { min: -0.5, max: 1.3 })
    .on("change", ({ value }) => rig.boomTo(value));
  craneFolder
    .addBinding(CRANE, "armLength", { min: 0, max: 12 })
    .on("change", ({ value }) => rig.extendTo(value));
  craneFolder
    .addBinding(CRANE, "height", { min: 0, max: 6 })
    .on("change", ({ value }) => rig.pedestalTo(value));
  bindSettings(craneFolder, rig, ["smoothTime"]);
  craneFolder
    .addBinding(config, "lookAtCube")
    .on("change", ({ value }) => rig.set({ target: value ? SUBJECT : null }));

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
}

await start("crane", crane);
