import {
  CraneRig,
  OrbitControls,
  PerspectiveCamera,
  PointerManager,
  RailRig,
  Switcher,
} from "cameras";

import { addLens, addMonitor, run, start } from "./common.js";

const MOVES = ["linear", "arc", "zoom-pan", "dolly-zoom"];
const SUBJECT = [0, 0.5, 0];

function switcher({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 0.9 });
  const input = new PointerManager(ctx.canvas).enable();

  // Live sources: they keep moving whether on air or not.
  const sources = {
    orbit: new OrbitControls({
      lens: camera,
      position: [0, 4, 12],
      target: SUBJECT,
    }).attach(input),
    // prettier-ignore
    rail: new RailRig({
      points: [
        -12, 2, 10,
        12, 3, 6,
        0, 2, -14,
      ],
      closed: true,
      speed: 3,
      subject: SUBJECT,
      lens: camera,
    }).play(),
    crane: new CraneRig({
      pivot: [6, 0, 6],
      height: 1.5,
      armLength: 6,
      boom: 0.6,
      target: SUBJECT,
      lens: camera,
    }),
  };
  const output = new Switcher({
    source: sources.orbit,
    duration: 2,
    move: "arc",
  });

  const config = { source: "orbit" };
  const update = addMonitor(pane.addFolder({ title: "State" }), output, {
    position: () => output.pose.position,
    blending: () => (output.blending ? 1 : 0),
  });
  run({
    ctx,
    scene,
    pane,
    views: [{ camera, controls: output, input, area: [0, 0, 1, 1] }],
    onFrame: (dt) => {
      // Keep the crane swinging off air too.
      sources.crane.swingTo(sources.crane.get("swing") + dt * 0.4, false);
      update();
    },
  });

  const switcherFolder = pane.addFolder({ title: "Switcher" });
  switcherFolder
    .addBinding(config, "source", {
      options: Object.fromEntries(
        Object.keys(sources).map((name) => [name, name]),
      ),
    })
    .on("change", ({ value }) => output.switchTo(sources[value]));
  switcherFolder.addBinding(output, "duration", { min: 0, max: 5 });
  switcherFolder.addBinding(output, "move", {
    options: Object.fromEntries(MOVES.map((move) => [move, move])),
  });

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
}

await start("switcher", switcher);
