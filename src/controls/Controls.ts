import { vec2 } from "pex-math";
import { halfLifeDecay } from "ressort";

import PoseSource from "../core/PoseSource.js";

import { resolve } from "./bindings.js";
import {
  CONTROL,
  CONTROL_END,
  CONTROL_START,
  TRANSITION_START,
} from "./events.js";

import type { Quat, Vec2, Vec3 } from "pex-math";
import type { Second } from "../core/types.js";
import type KeyboardManager from "../input/KeyboardManager.js";
import type PointerManager from "../input/PointerManager.js";
import type { PointerGesture } from "../input/types.js";
import type { Lens } from "../camera/types.js";
import type { Bindings, ControlsEventMap, Gesture } from "./types.js";

// Remaining coast, in viewport heights, small enough to apply at once without
// a visible jump: under a pixel at 4K and 50° even when an orbit turns a
// viewport height into a full turn.
const FLING_REST = 5e-5;

/**
 * Android `MINIMUM_FLING_VELOCITY`, in dips per second.
 *
 * @see https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/view/ViewConfiguration.java
 */
const MIN_FLING_SPEED = 50;

interface Fling<Action extends string> {
  actions: readonly Action[];
  velocity: Vec2;
  velocityNormalized: Vec2;
}

/**
 * Base controller: maps input gestures to actions and produces a pose.
 *
 * Subclasses implement `applyAction` and `step`. Input is optional: every
 * action is also a method.
 */
export default abstract class Controls<
  Action extends string,
  Settings extends object = object,
  State = unknown,
> extends PoseSource<ControlsEventMap, Settings> {
  public bindings: Bindings<Action>;
  public lens?: Lens;
  /**
   * Half-life of the coasting velocity after a drag is released. 0 disables
   * fling.
   */
  public inertia: Second = 0;
  /** Release speed in CSS pixels per second below which a drag doesn't fling. */
  public minFlingSpeed = MIN_FLING_SPEED;

  #enabled = true;
  #saved?: State;
  #fling: Fling<Action> | null = null;
  #flingGesture: PointerGesture | null = null;
  #gestureActions: readonly Action[] | null = null;
  #input: PointerManager | null = null;
  #keyboard: KeyboardManager | null = null;
  #abortController: AbortController | null = null;

  constructor(bindings: Bindings<Action>) {
    super();
    this.bindings = { ...bindings };
  }

  /** Ignore input when false. Programmatic methods still apply. */
  public get enabled(): boolean {
    return this.#enabled;
  }
  public set enabled(value: boolean) {
    this.#enabled = value;
    if (!value) this.#endGesture();
  }

  /** A user gesture, or the fling following it, is in progress. */
  public get userControlling(): boolean {
    return this.#gestureActions !== null || this.#fling !== null;
  }

  public get input(): PointerManager | null {
    return this.#input;
  }

  public get keyboard(): KeyboardManager | null {
    return this.#keyboard;
  }

  /** Listen to input managers. The managers stay owned by the caller. */
  public attach(
    input: PointerManager | null,
    keyboard: KeyboardManager | null = null,
  ): this {
    this.detach();
    this.#abortController = new AbortController();
    const options = { signal: this.#abortController.signal };

    if (input) {
      this.#input = input;
      input.on("start", this.#onStart, options);
      input.on("move", this.#onGesture, options);
      input.on("end", this.#onEnd, options);
      input.on("wheel", this.#onGesture, options);
      input.on("pinch", this.#onGesture, options);
    }

    // Polled by controllers that need continuous key state.
    this.#keyboard = keyboard;

    return this;
  }

  /** Stop listening to input. */
  public detach(): this {
    this.#endGesture();
    this.#abortController?.abort();
    this.#abortController = null;
    this.#input = this.#keyboard = null;
    return this;
  }

  /** Snapshot of the end state. */
  public abstract getState(): State;

  public abstract setState(state: State, transition?: boolean): this;

  /** Place the camera at a position, looking along an orientation. */
  public abstract setPose(
    position: Vec3,
    orientation: Quat,
    transition?: boolean,
  ): this;

  /** Jump to the end of the current motion. */
  public abstract stop(): this;

  /** Remember the end state for `reset`. */
  public saveState(): this {
    this.#saved = this.getState();
    return this;
  }

  /** Go back to the state remembered by `saveState`, by default the initial one. */
  public reset(transition = true): this {
    return this.#saved === undefined
      ? this
      : this.setState(this.#saved, transition);
  }

  /** Coast with the released drag velocity, then advance and update the pose. */
  public override update(dt: Second): boolean {
    this.#stepFling(dt);
    return super.update(dt);
  }

  /** Detach and remove all listeners. */
  public dispose(): void {
    this.detach();
    this.removeAllListeners();
  }

  protected abstract applyAction(action: Action, gesture: Gesture): void;

  /** A press bound to the action starts. */
  protected startAction?(action: Action, gesture: Gesture): void;

  /** The press ends, before any fling. */
  protected endAction?(action: Action): void;

  /** Animate towards a programmatic change, or jump to it. */
  protected commit(transition: boolean): this {
    if (transition) this.emit("transitionstart", TRANSITION_START);
    else this.stop();
    this.invalidate();
    return this;
  }

  #onStart = (gesture: Gesture): void => {
    this.#endGesture();
    if (!this.#enabled) return;
    const actions = resolve(this.bindings, gesture);
    if (!actions.length) return;
    this.#gestureActions = actions;
    for (const action of actions) this.startAction?.(action, gesture);
    this.emit("controlstart", CONTROL_START);
  };

  #onGesture = (gesture: Gesture): void => {
    if (!this.#enabled) return;
    const actions =
      gesture.type === "move"
        ? this.#gestureActions
        : resolve(this.bindings, gesture);
    if (!actions?.length) return;
    for (const action of actions) this.applyAction(action, gesture);
    this.emit("control", CONTROL);
  };

  // The final release of a fast drag keeps coasting; `controlend` waits for the coast to finish.
  #onEnd = (gesture: Gesture): void => {
    const actions = this.#gestureActions;
    if (!actions) return;
    this.#gestureActions = null;
    for (const action of actions) this.endAction?.(action);

    if (
      gesture.type === "end" &&
      gesture.pointerCount === 0 &&
      !gesture.locked &&
      this.inertia > 0 &&
      vec2.length(gesture.velocity) > this.minFlingSpeed
    ) {
      this.#fling = {
        actions,
        velocity: [...gesture.velocity],
        velocityNormalized: [...gesture.velocityNormalized],
      };
      this.#flingGesture = {
        ...gesture,
        type: "move",
        delta: [0, 0],
        deltaNormalized: [0, 0],
        scale: 1,
        rotation: 0,
      };
      return;
    }
    this.emit("controlend", CONTROL_END);
  };

  #endGesture = (): void => {
    if (!this.#gestureActions && !this.#fling) return;
    for (const action of this.#gestureActions ?? []) this.endAction?.(action);
    this.#gestureActions = this.#fling = null;
    this.emit("controlend", CONTROL_END);
  };

  // Exponential decay integrated exactly over dt: the coast distance is frame rate independent.
  #stepFling(dt: Second): void {
    const fling = this.#fling;
    if (!fling || dt <= 0) return;
    if (!(this.inertia > 0)) {
      this.#endGesture();
      return;
    }

    const rate = Math.LN2 / this.inertia;
    const decay = halfLifeDecay(this.inertia, dt);
    // An infinite half-life coasts at constant speed, forever.
    const travel = rate > 0 ? (1 - decay) / rate : dt;
    const { velocity, velocityNormalized } = fling;

    const ending =
      (vec2.length(velocityNormalized) * decay) / rate < FLING_REST;
    // The last step covers the remaining tail, so the total is v / rate whatever the frame rate.
    this.#coast(fling, ending ? 1 / rate : travel);
    if (ending) {
      this.#endGesture();
      return;
    }
    for (const v of [velocity, velocityNormalized]) {
      v[0] *= decay;
      v[1] *= decay;
    }
  }

  #coast(fling: Fling<Action>, travel: Second): void {
    const gesture = this.#flingGesture!;
    for (let i = 0; i < 2; i++) {
      gesture.delta[i] = fling.velocity[i] * travel;
      gesture.deltaNormalized[i] = fling.velocityNormalized[i] * travel;
    }
    for (const action of fling.actions) this.applyAction(action, gesture);
    this.emit("control", CONTROL);
  }
}
