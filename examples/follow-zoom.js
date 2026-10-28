import {
  AutoFocus,
  Composer,
  FollowZoom,
  OrbitControls,
  PerspectiveCamera,
  PointerManager,
} from "cameras";

import { addMonitor, bindSettings, run, start } from "./common.js";

function followZoom({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fStop: 2 });
  const input = new PointerManager(ctx.canvas).enable();
  const controls = new OrbitControls({
    lens: camera,
    position: [0, 3, 14],
    target: [0, 0.5, 0],
  }).attach(input);

  // Subject walking towards and away from the camera.
  const subject = [0, 0.5, 0];
  let time = 0;
  const config = { walk: true, walkSpeed: 0.3 };
  const drawSubject = scene.createMarker(0.6);

  // Zoom before composing: the composer frames with the zoomed field of view.
  const zoom = new FollowZoom({ subject: () => subject });
  const composer = new Composer({ lens: camera, subject: () => subject });
  const focus = new AutoFocus({ subject: () => subject });

  const update = addMonitor(pane.addFolder({ title: "State" }), controls, {
    fov: () => camera.fov,
    focusDistance: () => camera.focusDistance,
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
        modifiers: [zoom, composer, focus],
        area: [0, 0, 1, 1],
        draw: (camera, viewport) => drawSubject(camera, viewport, subject),
      },
    ],
    onFrame: (dt) => {
      if (config.walk) {
        time += dt * config.walkSpeed;
        subject[2] = Math.sin(time) * 10 - 4;
      }
      update();
    },
  });

  const subjectFolder = pane.addFolder({ title: "Subject" });
  subjectFolder.addBinding(config, "walk");
  subjectFolder.addBinding(config, "walkSpeed", { min: 0, max: 2 });

  const zoomFolder = pane.addFolder({ title: "Follow zoom" });
  zoomFolder.addBinding(zoom, "enabled");
  zoomFolder.addBinding(zoom, "size", { min: 0.2, max: 5 });
  zoomFolder.addBinding(zoom, "halfLife", { min: 0.01, max: 2 });

  const focusFolder = pane.addFolder({ title: "Auto focus" });
  focusFolder.addBinding(focus, "enabled");
  focusFolder.addBinding(focus, "offset", { min: -5, max: 5 });
  focusFolder.addBinding(focus, "halfLife", { min: 0.01, max: 2 });

  bindSettings(pane.addFolder({ title: "Orbit", expanded: false }), controls, [
    "smoothTime",
    "azimuthSpeed",
    "polarSpeed",
    "dollySpeed",
  ]);
}

await start("follow zoom", followZoom);
