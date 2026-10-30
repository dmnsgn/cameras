import {
  PerspectiveCamera,
  OrthographicCamera,
  OrbitControls,
  PointerManager,
  projection,
} from "cameras";

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

const POSITION = [0, 5, 5];
const ACTIONS = [
  "arc",
  "arc-azimuth",
  "arc-elevation",
  "dolly",
  "zoom",
  "truck-pedestal",
  "truck-dolly",
  "pan-tilt",
  "twist",
  "focal-offset",
];
const BINDING_KEYS = [
  "mouse:primary",
  "mouse:primary+shift",
  "mouse:secondary",
  "mouse:auxiliary",
  "touch:1",
  "touch:2",
  "touch:3",
  "wheel",
  "wheel:trackpad",
  "pinch",
];

function orbit({ ctx, scene, pane }) {
  const createView = (camera, area) => {
    const input = new PointerManager(ctx.canvas, {
      interactiveArea: area,
    }).enable();
    const controls = new OrbitControls({
      lens: camera,
      position: POSITION,
      distanceBounds: [0.1, 80],
      dollyToCursor: true,
    }).attach(input);
    return { camera, area, input, controls };
  };

  const perspective = createView(
    new PerspectiveCamera({ near: 0.1, far: 200 }),
    [0, 0, 0.5, 1],
  );
  const orthographic = createView(
    new OrthographicCamera({
      near: -100,
      far: 200,
      // Match the perspective framing at the target distance
      size: projection.halfHeightAtDistance(
        perspective.camera.fov,
        Math.hypot(...POSITION),
      ),
    }),
    [0.5, 0, 0.5, 1],
  );
  const views = [perspective, orthographic];

  const config = { split: true };
  const { layout } = run({
    ctx,
    scene,
    pane,
    views,
    onFrame: () => monitors.forEach((update) => update()),
  });
  pane.addBinding(config, "split").on("change", ({ value }) => {
    perspective.area[2] = value ? 0.5 : 1;
    orthographic.hidden = !value;
    orthographic.input[value ? "enable" : "disable"]();
    layout();
  });

  const monitors = [
    [perspective, "Perspective"],
    [orthographic, "Orthographic"],
  ].map(([{ camera, controls }, title]) => {
    const folder = pane.addFolder({ title, expanded: title === "Perspective" });
    const [settings, actions, lens] = folder.addTab({
      pages: [{ title: "Controls" }, { title: "Actions" }, { title: "Lens" }],
    }).pages;

    settings.addBinding(controls, "enabled");
    bindSettings(settings, controls, [
      "inertia",
      "minFlingSpeed",
      "dollyToCursor",
      "infinityDolly",
      "smoothTime",
      "draggingSmoothTime",
      "restThreshold",
      "azimuthSpeed",
      "elevationSpeed",
      "dollySpeed",
      "zoomSpeed",
      "truckSpeed",
      "panTiltSpeed",
    ]);

    addTargetBounds(
      settings.addFolder({ title: "Bounds", expanded: false }),
      controls,
      {
        minElevation: [
          controls.elevationBounds[0],
          { min: -Math.PI / 2, max: Math.PI / 2 },
        ],
        maxElevation: [
          controls.elevationBounds[1],
          { min: -Math.PI / 2, max: Math.PI / 2 },
        ],
        limitAzimuth: [false],
        azimuth: [Math.PI / 2, { min: 0, max: Math.PI }],
      },
      (limits) => ({
        elevationBounds: [limits.minElevation, limits.maxElevation],
        azimuthBounds: limits.limitAzimuth
          ? [-limits.azimuth, limits.azimuth]
          : [-Infinity, Infinity],
      }),
    );

    addBindings(
      settings.addFolder({ title: "Bindings", expanded: false }),
      controls,
      BINDING_KEYS,
      ACTIONS,
    );

    addActions(actions, [
      ["arc 45° azimuth", (t) => controls.arc(Math.PI / 4, 0, t)],
      ["arcTo front", (t) => controls.arcTo(0, 0, t)],
      ["arcTo top", (t) => controls.arcTo(0, Math.PI / 2, t)],
      ["dolly in", (t) => controls.dolly(-1, t)],
      ["dolly out", (t) => controls.dolly(1, t)],
      ["zoom in", (t) => controls.zoom(0.25, t)],
      ["zoom out", (t) => controls.zoom(-0.25, t)],
      ["truck right", (t) => controls.truck(1, 0, t)],
      ["pedestal up", (t) => controls.pedestal(1, t)],
      ["forward", (t) => controls.forward(1, t)],
      ["pan left 15°", (t) => controls.pan(Math.PI / 12, t)],
      ["tilt up 15°", (t) => controls.tilt(Math.PI / 12, t)],
      ["setLookAt initial", (t) => controls.setLookAt(POSITION, [0, 0, 0], t)],
      [
        "lookInDirectionOf (1, 0, -1)",
        (t) => controls.lookInDirectionOf([1, 0, -1], t),
      ],
      [
        "setFocalOffset (1, 0, 0)",
        (t) => controls.setFocalOffset([1, 0, 0], t),
      ],
      ["clear focal offset", (t) => controls.setFocalOffset([0, 0, 0], t)],
      [
        "setOrbitPoint cube corner",
        () => controls.setOrbitPoint([0.5, 0.5, 0.5]),
      ],
      ["fitToBox cube", (t) => controls.fitToBox(scene.cubeBox, {}, t)],
      [
        "fitToBox cube cover",
        (t) => controls.fitToBox(scene.cubeBox, { cover: true }, t),
      ],
      [
        "fitToSphere cube",
        (t) => controls.fitToSphere([0, 0, 0], Math.sqrt(0.75), t),
      ],
      ["normalizeRotations", () => controls.normalizeRotations()],
      ["saveState", () => controls.saveState()],
      ["reset", (t) => controls.reset(t)],
      ["stop", () => controls.stop()],
    ]);

    const lerp = { t: 0 };
    const from = {
      target: [0, 0, 0],
      spherical: [6, Math.PI / 6, -Math.PI / 2],
    };
    const to = {
      target: [2, 0, 0],
      spherical: [3, Math.PI / 22, Math.PI / 2],
    };
    actions
      .addBinding(lerp, "t", { label: "lerp", min: 0, max: 1 })
      .on("change", ({ value }) => controls.lerp(from, to, value, false));

    addLens(lens, camera);

    return addMonitor(folder.addFolder({ title: "State" }), controls, {
      position: () => controls.pose.position,
      target: () => controls.pose.target,
      spherical: () => controls.getSpherical(),
      zoom: () => controls.getZoom(),
    });
  });
}

await start("orbit", orbit);
