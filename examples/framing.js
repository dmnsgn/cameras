import {
  Composer,
  GroupFraming,
  OrbitControls,
  PerspectiveCamera,
  PointerManager,
} from "cameras";

import {
  addMonitor,
  addVectorBinding,
  bindSettings,
  run,
  start,
} from "./common.js";

// Screen overlay for the composer zones and the rule of thirds lines, in NDC.
const createOverlay = () => {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 1,
  });
  const box = (border) => {
    const element = document.createElement("div");
    Object.assign(element.style, {
      position: "absolute",
      border,
      boxSizing: "border-box",
    });
    root.append(element);
    return (center, half) => {
      Object.assign(element.style, {
        left: `${((center[0] - half[0] + 1) / 2) * 100}%`,
        top: `${((1 - (center[1] + half[1])) / 2) * 100}%`,
        width: `${half[0] * 100}%`,
        height: `${half[1] * 100}%`,
      });
    };
  };
  for (const third of [-1 / 3, 1 / 3]) {
    const line = "1px solid rgba(242, 242, 242, 0.3)";
    box(line)([third, 0], [0, 1]);
    box(line)([0, third], [1, 0]);
  }
  document.body.append(root);
  return {
    soft: box("1px dashed #ff9800"),
    dead: box("1px solid #4caf50"),
    subject: box("2px solid #f2f2f2"),
    root,
  };
};

const COLORS = [
  [0.95, 0.2, 0.2, 1],
  [0.2, 0.6, 1, 1],
  [0.3, 0.8, 0.3, 1],
];

function framing({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fov: 0.8 });
  const input = new PointerManager(ctx.canvas).enable();
  const controls = new OrbitControls({
    lens: camera,
    position: [0, 4, 12],
    target: [0, 0.5, 0],
  }).attach(input);

  // Subjects walking out of phase figure eights.
  const subjects = COLORS.map(() => [0, 0.5, 0]);
  let time = 0;
  const config = { walk: true, walkSpeed: 0.4, count: 1 };
  const active = () => subjects.slice(0, config.count);
  const markers = COLORS.map((color) => scene.createMarker(0.6, color));

  // Sizes the group, then the composer places its center.
  const group = new GroupFraming({ lens: camera });
  group.enabled = false;
  const setGroup = () =>
    group.set({ subjects: active().map((subject) => () => subject) });
  setGroup();
  const composer = new Composer({
    lens: camera,
    subject: () => (group.enabled ? group.center : subjects[0]),
    screenPosition: [-1 / 3, 1 / 3],
  });
  const overlay = createOverlay();

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
        modifiers: [group, composer],
        area: [0, 0, 1, 1],
        draw: (camera, viewport) =>
          active().forEach((subject, i) =>
            markers[i](camera, viewport, subject),
          ),
      },
    ],
    onFrame: (dt) => {
      if (config.walk) {
        time += dt * config.walkSpeed;
        subjects.forEach((subject, i) => {
          const phase = time + (i * Math.PI * 2) / subjects.length;
          subject[0] = Math.sin(phase * 2) * 6;
          subject[2] = Math.sin(phase) * 8;
        });
      }
      overlay.root.style.display = composer.enabled ? "" : "none";
      overlay.soft(composer.screenPosition, composer.softZone);
      overlay.dead(composer.screenPosition, composer.deadZone);
      const ndc = composer.project(composer.pose);
      if (ndc) overlay.subject(ndc, [0.01, 0.01 * camera.aspect]);
      update();
    },
  });

  const subjectFolder = pane.addFolder({ title: "Subjects" });
  subjectFolder.addBinding(config, "walk");
  subjectFolder.addBinding(config, "walkSpeed", { min: 0, max: 2 });
  subjectFolder
    .addBinding(config, "count", { min: 1, max: subjects.length, step: 1 })
    .on("change", setGroup);

  const composerFolder = pane.addFolder({ title: "Composer" });
  composerFolder
    .addBinding(composer, "enabled")
    .on("change", () => composer.reset());
  composerFolder.addBinding(composer, "reframe", {
    options: { "pan-tilt": "pan-tilt", "truck-pedestal": "truck-pedestal" },
  });
  addVectorBinding(composerFolder, composer, "screenPosition", {
    x: { min: -1, max: 1 },
    y: { min: -1, max: 1, inverted: true },
  });
  addVectorBinding(composerFolder, composer, "deadZone", {
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
  });
  addVectorBinding(composerFolder, composer, "softZone", {
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
  });
  composerFolder.addBinding(composer, "halfLife", { min: 0.01, max: 2 });
  composerFolder.addButton({ title: "rule of thirds" }).on("click", () => {
    composer.screenPosition = [-1 / 3, 1 / 3];
    pane.refresh();
  });
  composerFolder.addButton({ title: "center" }).on("click", () => {
    composer.screenPosition = [0, 0];
    pane.refresh();
  });

  const groupFolder = pane.addFolder({ title: "Group framing" });
  groupFolder.addBinding(group, "enabled").on("change", () => group.reset());
  groupFolder.addBinding(group, "framingSize", { min: 0.1, max: 1.5 });
  groupFolder.addBinding(group, "framingMode", {
    options: { horizontal: "horizontal", vertical: "vertical", both: "both" },
  });
  groupFolder.addBinding(group, "sizeAdjustment", {
    options: {
      zoom: "zoom",
      dolly: "dolly",
      "dolly-then-zoom": "dolly-then-zoom",
    },
  });
  groupFolder.addBinding(group, "radius", { min: 0, max: 3 });
  groupFolder.addBinding(group, "halfLife", { min: 0.01, max: 2 });

  bindSettings(pane.addFolder({ title: "Orbit", expanded: false }), controls, [
    "smoothTime",
    "azimuthSpeed",
    "elevationSpeed",
    "dollySpeed",
  ]);
}

// No scattered cubes: only the subjects.
await start("framing", framing, { count: 0 });
