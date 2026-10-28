import { eases } from "pex-math";

import { PerspectiveCamera, Sequence, lens } from "cameras";

import { addLens, addMonitor, run, start } from "./common.js";

const MOVES = ["linear", "arc", "zoom-pan", "dolly-zoom"];

function shots({ ctx, scene, pane }) {
  const camera = new PerspectiveCamera({ near: 0.05, far: 500, fStop: 2 });

  const wide = {
    position: [0, 8, 22],
    target: [0, 0, 0],
    fov: 0.9,
    focusDistance: 23,
  };
  const close = {
    position: [1.2, 0.6, 2.4],
    target: [0, 0, 0],
    fov: 0.6,
    focusDistance: 2.8,
  };
  const vertigo = {
    position: [1.2, 0.6, 2.4].map(
      (v) => (v * lens.dollyZoomDistance(2.8, 0.6, 1.4)) / 2.8,
    ),
    target: [0, 0, 0],
    fov: 1.4,
    focusDistance: 1.2,
  };
  const distant = {
    position: [18, 3, -14],
    target: [15, 0.5, -20],
    fov: 0.7,
    focusDistance: 7,
  };
  const overhead = {
    position: [15, 25, -19.9],
    target: [15, 0, -20],
    fov: 0.9,
    focusDistance: 25,
  };

  const config = { move: "arc", easing: "sineInOut", rho: Math.SQRT2, time: 0 };
  const sequence = new Sequence({
    shots: [
      { shot: wide, hold: 1 },
      { shot: close, duration: 3, hold: 1, move: "arc" },
      { shot: vertigo, duration: 3, hold: 1, move: "dolly-zoom" },
      { shot: distant, duration: 5, hold: 1, move: "zoom-pan" },
      // No duration: a hard cut.
      { shot: overhead, hold: 2 },
      { shot: wide, duration: 5, hold: 1, move: "zoom-pan" },
    ],
    loop: true,
  });
  const applyEasing = () => {
    for (const entry of sequence.shots) {
      entry.easing = eases[config.easing];
      entry.rho = config.rho;
    }
    sequence.seek(sequence.time);
  };
  applyEasing();

  const update = addMonitor(pane.addFolder({ title: "State" }), sequence, {
    fov: () => camera.fov,
    focusDistance: () => camera.focusDistance,
    coc1m: () =>
      lens.circleOfConfusion(1, camera.focusDistance, 50, camera.fStop),
    ev100: () => camera.ev100,
  });
  const state = { shot: 0 };
  sequence.on("shotchange", ({ index }) => (state.shot = index));
  pane.addBinding(state, "shot", { readonly: true });

  run({
    ctx,
    scene,
    pane,
    views: [{ camera, controls: sequence, area: [0, 0, 1, 1] }],
    onFrame: () => {
      config.time = sequence.time;
      update();
    },
  });

  const playback = pane.addFolder({ title: "Playback" });
  playback
    .addButton({ title: "play / pause" })
    .on("click", () => (sequence.playing ? sequence.pause() : sequence.play()));
  playback.addBinding(sequence, "loop");
  playback.addBinding(sequence, "speed", { min: -2, max: 2 });
  playback
    .addBinding(config, "time", { min: 0, max: sequence.duration })
    .on("change", ({ value }) => {
      // Scrubbing drives the sequence like an external timeline.
      if (!sequence.playing) sequence.seek(value);
    });

  const moves = pane.addFolder({ title: "Moves" });
  moves
    .addBinding(config, "move", {
      options: Object.fromEntries(MOVES.map((move) => [move, move])),
    })
    .on("change", ({ value }) => {
      for (const entry of sequence.shots.slice(1)) entry.move = value;
      sequence.seek(sequence.time);
    });
  moves
    .addBinding(config, "easing", {
      options: Object.fromEntries(
        Object.keys(eases).map((name) => [name, name]),
      ),
    })
    .on("change", applyEasing);
  moves
    .addBinding(config, "rho", { min: 0.5, max: 3 })
    .on("change", applyEasing);

  addLens(pane.addFolder({ title: "Lens", expanded: false }), camera);
  sequence.play();
}

await start("shots", shots);
