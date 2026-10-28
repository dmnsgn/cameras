import {
  FlyControls,
  KeyboardManager,
  PerspectiveCamera,
  PointerManager,
} from "cameras";

import {
  addActions,
  addBindings,
  addLens,
  addMonitor,
  bindSettings,
  run,
  start,
} from "./common.js";

// Local +Y rotated by the orientation.
const cameraUp = ([x, y, z, w]) => [
  2 * (x * y - w * z),
  1 - 2 * (x * x + z * z),
  2 * (y * z + w * x),
];

function fly({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 1.1 });
  const input = new PointerManager(ctx.canvas).enable();
  const keyboard = new KeyboardManager(window, {
    preventDefault: [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "AltLeft",
      "AltRight",
    ],
  }).enable();

  const controls = new FlyControls({
    lens: camera,
    position: [0, 6, 14],
    target: [0, 0, 0],
    speed: 5,
  }).attach(input, keyboard);

  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    position: () => controls.pose.position,
    orientation: () => controls.getOrientation(),
    up: () => cameraUp(controls.pose.orientation),
  });
  run({
    ctx,
    scene,
    pane,
    views: [{ camera, controls, input, area: [0, 0, 1, 1] }],
    onFrame: update,
  });

  pane
    .addButton({ title: "Lock pointer (Esc to exit)" })
    .on("click", () => input.requestPointerLock());
  pane.addBlade({
    view: "text",
    label: "keys",
    parse: (v) => v,
    value: "WASD/arrows, Space up, C down, Q/E roll, Z auto-level, Shift fast, Alt slow",
    disabled: true,
  });

  const settings = pane.addFolder({ title: "Controls" });
  settings.addBinding(controls, "enabled");
  bindSettings(settings, controls, [
    "inertia",
    "minFlingSpeed",
    "speed",
    "sprintMultiplier",
    "slowMultiplier",
    "moveSmoothTime",
    "lookSpeed",
    "rollSpeed",
    "autoLevel",
    "dropTime",
    "lookSmoothTime",
    "zoomSpeed",
    "zoomSmoothTime",
    "aimZoom",
  ]);

  addBindings(
    pane.addFolder({ title: "Bindings", expanded: false }),
    controls,
    Object.keys(FlyControls.DEFAULT_BINDINGS),
    ["pan-tilt", "roll", "aim", "truck-dolly", "truck-pedestal", "dolly", "zoom"],
  );

  addActions(pane.addFolder({ title: "Actions", expanded: false }), [
    ["look at cube", (t) => controls.lookAt([0, 0.5, 0], t)],
    ["level horizon", (t) => controls.level(t)],
    ["roll 45°", (t) => controls.rotate(0, 0, Math.PI / 4, t)],
    ["loop: tilt 90°", (t) => controls.rotate(0, Math.PI / 2, 0, t)],
    ["saveState", () => controls.saveState()],
    ["reset", (t) => controls.reset(t)],
  ]);

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
}

await start("fly", fly);
