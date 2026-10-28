import type { PoseSourceEventMap } from "../core/PoseSource.js";
import type {
  PinchGesture,
  PointerGesture,
  WheelGesture,
} from "../input/types.js";

type Gesture = PointerGesture | WheelGesture | PinchGesture;

/**
 * Gesture keys to actions, most specific key wins:
 *
 * - `"mouse:primary"`, `"mouse:secondary"`, `"mouse:auxiliary"`, `"mouse:back"`,
 *   `"mouse:forward"`, chords as `"mouse:primary+secondary"`
 * - `"pen:primary"`, falling back to `"mouse:*"`
 * - `"touch:1"`, `"touch:2"`, `"touch:3"`
 * - `"locked"` for pointer lock movement
 * - `"wheel"`, `"wheel:mouse"`, `"wheel:trackpad"`
 * - `"pinch"` for trackpad pinch
 *
 * Append modifiers in this order: `+shift`, `+ctrl`, `+alt`, `+meta`. `null`
 * disables a key.
 */
type Bindings<Action extends string> = Record<
  string,
  Action | readonly Action[] | null
>;

interface ControlsEvent {
  type: keyof ControlsEventMap;
}

interface ControlsEventMap extends PoseSourceEventMap {
  /** User gesture started. */
  controlstart: ControlsEvent;
  /** User input applied. */
  control: ControlsEvent;
  /** User gesture ended. */
  controlend: ControlsEvent;
  /** Programmatic change animated towards. */
  transitionstart: ControlsEvent;
}

/** Settings shared by all controllers. */
interface ControlsSettings {
  /**
   * Half-life of the coasting velocity after a drag is released. 0 disables
   * fling.
   */
  inertia?: number;
  /**
   * Release speed in viewport heights per second below which a drag doesn't
   * fling.
   */
  minFlingSpeed?: number;
}

export type {
  Gesture,
  Bindings,
  ControlsEvent,
  ControlsEventMap,
  ControlsSettings,
};
