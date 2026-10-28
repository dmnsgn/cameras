import {
  FirstPersonControls,
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

const EYE_HEIGHT = 1.7;

function firstPerson({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 1.2 });
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

  const config = { walkOnGround: true };
  const controls = new FirstPersonControls({
    lens: camera,
    position: [0, EYE_HEIGHT, 8],
    target: [0, 0.5, 0],
    headBobAmplitude: 0.04,
    constrain: (position) => {
      if (config.walkOnGround) position[1] = EYE_HEIGHT;
    },
  }).attach(input, keyboard);

  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    position: () => controls.pose.position,
    panTilt: () => controls.getPanTilt(),
    zoom: () => controls.getZoom(),
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
    value: "WASD/arrows, E/Space up, Q/C down, Shift fast, Alt slow",
    disabled: true,
  });

  const settings = pane.addFolder({ title: "Controls" });
  settings.addBinding(controls, "enabled");
  settings.addBinding(config, "walkOnGround");
  bindSettings(settings, controls, [
    "inertia",
    "minFlingSpeed",
    "speed",
    "sprintMultiplier",
    "slowMultiplier",
    "moveSmoothTime",
    "lookSpeed",
    "lookSmoothTime",
    "zoomSpeed",
    "zoomSmoothTime",
    "aimZoom",
    "headBobAmplitude",
    "headBobFrequency",
  ]);

  addBindings(
    pane.addFolder({ title: "Bindings", expanded: false }),
    controls,
    Object.keys(FirstPersonControls.DEFAULT_BINDINGS),
    ["pan-tilt", "aim", "truck-dolly", "truck-pedestal", "pedestal", "dolly", "zoom"],
  );

  addActions(pane.addFolder({ title: "Actions", expanded: false }), [
    ["look at cube", (t) => controls.lookAt([0, 0.5, 0], t)],
    ["turn around", (t) => controls.panTilt(Math.PI, 0, t)],
    ["step forward 2", (t) => controls.move(0, 0, 2, t)],
    ["zoom 2x", (t) => controls.zoomTo(2, t)],
    ["zoom 1x", (t) => controls.zoomTo(1, t)],
    ["saveState", () => controls.saveState()],
    ["reset", (t) => controls.reset(t)],
  ]);

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
}

await start("first-person", firstPerson);
