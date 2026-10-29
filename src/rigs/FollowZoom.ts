import { utils } from "pex-math";
import { damp } from "ressort";

import PoseModifier from "./PoseModifier.js";
import { halfLifeFromDampingTime } from "../core/math.js";
import { depthOf, subjectPosition } from "../core/pose.js";

import type { Vec2 } from "pex-math";
import type { Pose, Subject } from "../core/pose.js";
import type { Radian, Second } from "../core/types.js";

interface FollowZoomSettings {
  /** Point or function to keep the same size. The pose target otherwise. */
  subject?: Subject | null;
  /**
   * Half of the visible height to keep at the subject, like an orthographic
   * size.
   */
  size?: number;
  /** Field of view limits. */
  fovRange?: Vec2;
  /** Time to cover half of a size change, e.g. as the subject moves. */
  halfLife?: Second;
  /** Field of view change below which the zoom rests. */
  restThreshold?: Radian;
}

const DEGREE = Math.PI / 180;

/**
 * Zoom operator: changes the field of view to keep a subject the same size on
 * screen as its distance changes. Perspective only. Place it before a
 * `Composer`, which frames with the zoomed field of view.
 *
 * @see https://github.com/Unity-Technologies/com.unity.cinemachine/blob/main/com.unity.cinemachine/Runtime/Behaviours/CinemachineFollowZoom.cs
 */
class FollowZoom extends PoseModifier<FollowZoomSettings> {
  public subject: Subject | null = null;
  // Cinemachine FollowZoom defaults: 2 units wide, 3° to 60°, 1 s damping.
  public size = 1;
  public fovRange: Vec2 = [3 * DEGREE, 60 * DEGREE];
  public halfLife: Second = halfLifeFromDampingTime(1);
  public restThreshold = 1e-4;

  #fov: Radian | null = null;

  constructor(options: FollowZoomSettings = {}) {
    super();
    this.set(options);
  }

  /** Jump to the goal field of view on the next update. */
  public reset(): this {
    this.#fov = null;
    return this;
  }

  protected modify(out: Pose, dt: Second): boolean {
    const point = this.subject ? subjectPosition(this.subject) : out.target;
    const depth = Math.max(depthOf(out, point), utils.EPSILON);
    // Tangent of the half field of view per unit of visible half height.
    const scale = (out.zoom ?? 1) / depth;
    const min = this.fovRange[0];
    const max = this.fovRange[1];
    const goal = utils.clamp(2 * Math.atan(this.size * scale), min, max);

    let fov = goal;
    if (this.#fov !== null) {
      // Damping the size the previous field of view shows at the new depth
      // lags behind a moving subject, as an operator reacting to it.
      const size = damp(
        Math.tan(this.#fov / 2) / scale,
        Math.tan(goal / 2) / scale,
        this.halfLife,
        dt,
      );
      fov = utils.clamp(2 * Math.atan(size * scale), min, max);
    }
    const moving = Math.abs(fov - goal) >= this.restThreshold;
    this.#fov = out.fov = moving ? fov : goal;
    return moving;
  }
}

export type { FollowZoomSettings };
export default FollowZoom;
