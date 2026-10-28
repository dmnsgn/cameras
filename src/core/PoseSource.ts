import { fromPerceptual } from "ressort";

import Emitter from "./Emitter.js";
import { assignOptions } from "./options.js";
import * as pose from "./pose.js";

import type { Pose, PoseAdapter } from "./pose.js";
import type { Second } from "./types.js";

interface PoseSourceEvent {
  type: string;
}

/**
 * SwiftUI's default spring, critically damped with a 0.5 s perceptual duration,
 * as a smooth time.
 *
 * @see https://developer.apple.com/documentation/swiftui/animation/spring(duration:bounce:blendduration:)
 */
const SPRING_SMOOTH_TIME: Second = 2 / fromPerceptual({ duration: 0.5 }).omega;

// Shared and frozen: emitted every frame without allocating.
const WAKE = Object.freeze({ type: "wake" });
const UPDATE = Object.freeze({ type: "update" });
const REST = Object.freeze({ type: "rest" });

interface PoseSourceEventMap {
  /** Motion starts after rest. */
  wake: PoseSourceEvent;
  /** Pose updated. */
  update: PoseSourceEvent;
  /** Motion settled. */
  rest: PoseSourceEvent;
}

/**
 * Anything producing a camera pose over time: controllers, rigs, sequences.
 *
 * Subclasses implement `step` and `writePose`, and call `set` after `super`
 * once their fields exist.
 */
abstract class PoseSource<
  EventMap extends PoseSourceEventMap = PoseSourceEventMap,
  Settings extends object = object,
> extends Emitter<EventMap> {
  /** Output, updated by `update`. */
  public readonly pose: Pose = pose.create();

  #awake = false;
  #dirty = true;

  /** Update settings without aliasing the given arrays and objects. */
  public set(options: Settings): this {
    assignOptions(this, options);
    this.invalidate();
    return this;
  }

  /**
   * Advance state by dt and update the pose.
   *
   * @returns Whether the pose changed and needs rendering.
   */
  public update(dt: Second): boolean {
    const moving = this.step(dt);
    const changed = moving || this.#dirty;
    this.#dirty = false;

    if (changed) {
      this.writePose(this.pose);
      if (!this.#awake) {
        this.#awake = true;
        this.emit("wake", WAKE as EventMap["wake"]);
      }
      this.emit("update", UPDATE as EventMap["update"]);
    }
    if (!moving && this.#awake) {
      this.#awake = false;
      this.emit("rest", REST as EventMap["rest"]);
    }

    return changed;
  }

  /**
   * Write the pose into an object, by default its `position`, `target`, `up`,
   * `orientation`, `zoom`, `fov` and `focusDistance` when present.
   *
   * @returns Object
   */
  public applyTo<T>(object: T, adapter?: PoseAdapter<T>): T {
    return pose.applyTo(this.pose, object, adapter);
  }

  /** Request a pose update on the next `update` even if nothing moves. */
  protected invalidate(): void {
    this.#dirty = true;
  }

  /** Advance state by dt. Returns false once settled. */
  protected abstract step(dt: Second): boolean;

  protected abstract writePose(out: Pose): void;
}

export { SPRING_SMOOTH_TIME };
export type { PoseSourceEvent, PoseSourceEventMap };
export default PoseSource;
