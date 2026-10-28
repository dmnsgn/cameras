import OrbitControls from "./OrbitControls.js";
import { SCROLL_HALF_LIFE } from "./gestures.js";

import type { OrbitAction, OrbitControlsOptions } from "./OrbitControls.js";
import type { Bindings } from "./types.js";

const DEFAULT_BINDINGS: Bindings<OrbitAction> = {
  "mouse:primary": "truck-dolly",
  "mouse:primary+shift": "arc",
  "mouse:secondary": "arc",
  "mouse:auxiliary": "dolly",
  "touch:1": "truck-dolly",
  "touch:2": ["dolly", "truck-dolly", "twist"],
  "touch:3": "arc-polar",
  wheel: "dolly",
  pinch: ["dolly", "twist"],
};

/**
 * Orbit preset for maps and top-down scenes: drag moves on the ground, the
 * secondary button orbits, dolly targets the cursor and the camera stays above
 * the horizon.
 */
export default class MapControls extends OrbitControls {
  public static override readonly DEFAULT_BINDINGS: Readonly<
    Bindings<OrbitAction>
  > = DEFAULT_BINDINGS;

  constructor({ bindings, ...options }: OrbitControlsOptions = {}) {
    super({
      // Dragging moves the ground 1:1, as scrolling does.
      inertia: SCROLL_HALF_LIFE,
      dollyToCursor: true,
      polarBounds: [0, Math.PI / 2],
      ...options,
      bindings: { ...DEFAULT_BINDINGS, ...bindings },
    });
  }
}
