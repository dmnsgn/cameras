import * as gpu from "pex-gpu";
import { Pane } from "tweakpane";

import { PerspectiveCamera, lens } from "cameras";

import createScene from "./scene.js";

const RANGES = {
  smoothTime: { min: 0, max: 2 },
  draggingSmoothTime: { min: 0, max: 2 },
  moveSmoothTime: { min: 0, max: 2 },
  lookSmoothTime: { min: 0, max: 1 },
  dropTime: { min: 0.2, max: 5 },
  aimZoom: { min: 1, max: 8 },
  zoomSmoothTime: { min: 0, max: 2 },
  restThreshold: { min: 1e-5, max: 0.1 },
  inertia: { min: 0, max: 1 },
  minFlingSpeed: { min: 0, max: 500 },
  boundaryFriction: { min: 0, max: 1 },
  speed: { min: 0.1, max: 20 },
  sprintMultiplier: { min: 1, max: 10 },
  slowMultiplier: { min: 0.01, max: 1 },
  headBobAmplitude: { min: 0, max: 0.2 },
  headBobFrequency: { min: 0, max: 5 },
  radius: { min: 0.2, max: 2 },
  fov: { min: 0.1, max: Math.PI - 0.1 },
  size: { min: 0.1, max: 20 },
  focalLength: { min: 8, max: 300 },
  orthoScale: { min: 0.2, max: 40 },
  far: { min: 1, max: 1000 },
};
const SPEED = { min: -3, max: 3 };

/**
 * Bind settings, picking a range by name. Speeds can be negative to invert.
 */
export function bindSettings(folder, object, keys) {
  for (const key of keys) {
    const range = RANGES[key] ?? (/Speed$/.test(key) ? SPEED : undefined);
    folder.addBinding(object, key, range);
  }
}

const AXES = ["x", "y", "z", "w"];

/**
 * Bind a vector array: Tweakpane points are `{ x, y, z }` objects. Reads
 * `object[key]` on every access, so the array can be replaced.
 */
export function addVectorBinding(folder, object, key, options) {
  const point = {};
  object[key].forEach((_, i) =>
    Object.defineProperty(point, AXES[i], {
      enumerable: true,
      get: () => object[key][i],
      set: (value) => {
        object[key][i] = value;
      },
    }),
  );
  return folder.addBinding({ [key]: point }, key, options);
}

/**
 * Buttons calling `fn(transition)`, with a shared transition toggle.
 */
export function addActions(folder, actions) {
  const state = { transition: true };
  folder.addBinding(state, "transition");
  for (const [title, fn] of actions) {
    folder.addButton({ title }).on("click", () => fn(state.transition));
  }
}

/**
 * Edit binding keys: "default" removes the key so less specific keys apply, "none" disables it.
 */
export function addBindings(folder, controls, keys, actions) {
  const options = Object.fromEntries(
    ["default", "none", ...actions].map((value) => [value, value]),
  );
  const proxy = Object.fromEntries(
    keys.map((key) => {
      const value = controls.bindings[key];
      const label = Array.isArray(value) ? value.join(" + ") : value;
      return [key, key in controls.bindings ? (label ?? "none") : "default"];
    }),
  );
  for (const key of keys) {
    // Combined actions aren't single options: keep them as read-only labels.
    if (!(proxy[key] in options)) {
      folder.addBinding(proxy, key, { readonly: true });
      continue;
    }
    folder.addBinding(proxy, key, { options }).on("change", ({ value }) => {
      if (value === "default") delete controls.bindings[key];
      else controls.bindings[key] = value === "none" ? null : value;
    });
  }
}

/**
 * Distance, zoom and boundary limits of target controllers. `extra` maps more
 * limits to their initial value and binding options, which `toSettings` turns
 * into settings.
 */
export function addTargetBounds(
  folder,
  controls,
  extra = {},
  toSettings = () => ({}),
) {
  const limits = {
    minDistance: controls.distanceBounds[0],
    maxDistance: controls.distanceBounds[1],
    ...Object.fromEntries(
      Object.entries(extra).map(([key, [value]]) => [key, value]),
    ),
    minZoom: controls.zoomBounds[0],
    maxZoom: 20,
    boundary: false,
    boundaryFriction: 0,
  };
  const apply = () =>
    controls.set({
      distanceBounds: [limits.minDistance, limits.maxDistance],
      zoomBounds: [limits.minZoom, limits.maxZoom],
      boundary: limits.boundary
        ? [
            [-5, -1, -5],
            [5, 5, 5],
          ]
        : null,
      boundaryFriction: limits.boundaryFriction,
      ...toSettings(limits),
    });
  apply();

  const options = {
    minDistance: { min: 0.01, max: 20 },
    maxDistance: { min: 1, max: 200 },
    ...Object.fromEntries(
      Object.entries(extra).map(([key, [, range]]) => [key, range]),
    ),
    minZoom: { min: 0.01, max: 1 },
    maxZoom: { min: 1, max: 50 },
    boundary: { label: "boundary [-5, 5]" },
    boundaryFriction: { min: 0, max: 1 },
  };
  for (const key of Object.keys(limits)) {
    folder.addBinding(limits, key, options[key]);
  }
  folder.on("change", apply);
}

/**
 * Lens bindings mirroring the camera's projection properties.
 */
export function addLens(folder, camera) {
  const perspective = camera instanceof PerspectiveCamera;
  const update = () => {
    camera.updateProjectionMatrix();
    folder.refresh();
  };

  const direct = perspective ? "fov" : "size";
  folder.addBinding(camera, direct, RANGES[direct]).on("change", update);

  // The sensor derived value starts at the current framing so toggling doesn't jump.
  const key = perspective ? "focalLength" : "orthoScale";
  const sensor = {
    enabled: camera[key] !== undefined,
    [key]:
      camera[key] ??
      (perspective
        ? lens.focalLengthFromFov(camera.fov, camera.sensorSize[1])
        : 2 * camera.size),
  };
  const applySensor = () => {
    camera[key] = sensor.enabled ? sensor[key] : undefined;
    update();
  };
  folder
    .addBinding(sensor, "enabled", { label: `use ${key}` })
    .on("change", applySensor);
  folder.addBinding(sensor, key, RANGES[key]).on("change", applySensor);
  folder
    .addBinding(camera, "sensorFit", {
      options: Object.fromEntries(
        ["vertical", "horizontal", "fill", "overscan"].map((v) => [v, v]),
      ),
    })
    .on("change", update);

  folder
    .addBinding(camera, "near", { min: perspective ? 0.01 : -100, max: 10 })
    .on("change", update);
  folder.addBinding(camera, "far", RANGES.far).on("change", update);
}

/**
 * Read-only values refreshed every frame, plus the last controls event.
 */
export function addMonitor(folder, controls, getters) {
  const state = { event: "–" };
  for (const type of [
    "controlstart",
    "controlend",
    "transitionstart",
    "wake",
    "rest",
  ]) {
    controls.on(type, () => (state.event = type));
  }
  const format = (value) =>
    typeof value === "number"
      ? value.toFixed(3)
      : [...value].map((x) => x.toFixed(2)).join(", ");
  for (const key of Object.keys(getters)) state[key] = "";
  for (const key of Object.keys(state)) {
    folder.addBinding(state, key, { readonly: true });
  }
  return () => {
    for (const [key, get] of Object.entries(getters))
      state[key] = format(get());
  };
}

/**
 * Create the GPU context, scene and pane, then run an example with them.
 */
export async function start(title, example, sceneOptions) {
  const ctx = await gpu.createContext({ pixelRatio: devicePixelRatio });
  Object.assign(ctx.canvas.style, { position: "absolute", inset: 0 });
  example({
    ctx,
    scene: createScene(ctx, sceneOptions),
    pane: new Pane({ title }),
  });
}

/**
 * Resize and render views. Each view has a camera, a pose source as `controls`, optional `modifiers`, an optional extra `draw` and a normalized area [x, y, width, height].
 */
export function run({ ctx, scene, pane, views, onFrame }) {
  const config = { reversedZ: false };

  const layout = () => {
    for (const view of views) {
      const [x, y, w, h] = view.area;
      view.viewport = [
        x * ctx.width,
        y * ctx.height,
        w * ctx.width,
        h * ctx.height,
      ];
      view.camera.set({ aspect: view.viewport[2] / view.viewport[3] });
      if (view.input) view.input.interactiveArea = [...view.area];
    }
  };
  const onResize = () => {
    gpu.resize(ctx, innerWidth, innerHeight, devicePixelRatio);
    layout();
  };
  addEventListener("resize", onResize);
  onResize();

  pane.addBinding(config, "reversedZ").on("change", ({ value }) => {
    for (const { camera } of views) camera.set({ reversedZ: value });
    scene.depthCompare(value);
  });

  gpu.frame(ctx, ({ deltaTime }) => {
    gpu.submit(
      ctx,
      {
        pass: {
          clearValue: [0.13, 0.13, 0.13, 1],
          depthClearValue: config.reversedZ ? 0 : 1,
        },
      },
      () => {
        for (const view of views) {
          if (view.hidden) continue;
          const { camera, controls, modifiers = [] } = view;
          let changed = controls.update(deltaTime);
          let output = controls;
          for (const modifier of modifiers) {
            modifier.update(output.pose, deltaTime);
            output = modifier;
          }
          // Modifiers may animate on their own: always apply when present.
          if (changed || modifiers.length) {
            output.applyTo(camera);
            camera.updateProjectionMatrix();
            camera.update();
          }
          scene.draw(camera, view.viewport);
          view.draw?.(camera, view.viewport);
        }
      },
    );
    onFrame?.(deltaTime);
    pane.refresh();
  });

  return { layout };
}
