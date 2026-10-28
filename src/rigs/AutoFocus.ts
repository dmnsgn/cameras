import { utils } from "pex-math";
import { damp } from "ressort";

import PoseModifier from "./PoseModifier.js";
import { halfLifeFromDampingTime } from "../core/math.js";
import { depthOf, subjectPosition } from "../core/pose.js";

import type { Pose, Subject } from "../core/pose.js";
import type { Second } from "../core/types.js";

interface AutoFocusSettings {
  /** Point or function to keep in focus. The pose target otherwise. */
  subject?: Subject | null;
  /** Moves the plane of focus away from the subject, negative closer. */
  offset?: number;
  /** Time for a focus pull to cover half the remaining distance. */
  halfLife?: Second;
  /** Focus change below which the pull rests, relative to the distance. */
  restThreshold?: number;
}

/**
 * Focus puller: keeps the plane of focus on a subject, with a damped pull.
 *
 * The focus distance is the subject's depth along the view axis, as depth of
 * field compares it with view depth: an off-center subject stays sharp.
 *
 * @see https://github.com/Unity-Technologies/com.unity.cinemachine/blob/main/com.unity.cinemachine/Runtime/PostProcessing/CinemachineAutoFocus.cs
 */
class AutoFocus extends PoseModifier<AutoFocusSettings> {
  public subject: Subject | null = null;
  public offset = 0;
  // Cinemachine AutoFocus damping default.
  public halfLife: Second = halfLifeFromDampingTime(0.2);
  public restThreshold = 1e-4;

  #focus: number | null = null;

  constructor(options: AutoFocusSettings = {}) {
    super();
    this.set(options);
  }

  /** Jump to the subject on the next update instead of pulling focus. */
  public reset(): this {
    this.#focus = null;
    return this;
  }

  protected modify(out: Pose, dt: Second): boolean {
    const point = this.subject ? subjectPosition(this.subject) : out.target;
    const goal = Math.max(depthOf(out, point) + this.offset, utils.EPSILON);
    const focus =
      this.#focus === null ? goal : damp(this.#focus, goal, this.halfLife, dt);
    const moving = Math.abs(focus - goal) >= this.restThreshold * goal;
    this.#focus = out.focusDistance = moving ? focus : goal;
    return moving;
  }
}

export type { AutoFocusSettings };
export default AutoFocus;
