import * as pose from "../core/pose.js";
import PoseSource from "../core/PoseSource.js";

import { interpolateShots } from "./shot.js";

import type { Pose } from "../core/pose.js";
import type { PoseSourceEventMap } from "../core/PoseSource.js";
import type { Second } from "../core/types.js";
import type { CameraMove, Easing, MoveOptions } from "./shot.js";

/** Anything updating a pose over time: controllers, rigs, sequences. */
interface Source {
  readonly pose: Pose;
  update(dt: Second): boolean;
}

interface SwitchOptions extends MoveOptions {
  /** Move time from the previous source, 0 to cut. */
  duration?: Second;
}

interface SwitcherSettings extends SwitchOptions {
  /** Live source at start, cut to. */
  source?: Source | null;
}

/**
 * Vision switcher: cuts or moves between live sources, while both keep
 * updating. Defaults apply to every switch unless overridden.
 *
 * It updates its sources: don't update them elsewhere.
 *
 * @see https://github.com/Unity-Technologies/com.unity.cinemachine/blob/main/com.unity.cinemachine/Runtime/Behaviours/CinemachineBrain.cs
 */
class Switcher extends PoseSource<PoseSourceEventMap, SwitchOptions> {
  public duration: Second = 0;
  public move?: CameraMove;
  public easing?: Easing;
  public rho?: number;

  #source: Source | null = null;
  // Outgoing source while blending, null once interrupted.
  #from: Source | null = null;
  // Pose blended from: the outgoing source's, or a frozen one.
  #fromPose: Pose | null = null;
  #frozen: Pose = pose.create();
  #options: MoveOptions = {};
  #elapsed = 0;
  #blendDuration = 0;

  constructor({ source = null, ...options }: SwitcherSettings = {}) {
    super();
    this.set(options);
    if (source) this.switchTo(source);
  }

  public get source(): Source | null {
    return this.#source;
  }

  public get blending(): boolean {
    return this.#elapsed < this.#blendDuration;
  }

  /**
   * Cut or move to a source. Interrupting a move starts the next one from where
   * the camera is.
   */
  public switchTo(
    source: Source,
    {
      duration = this.duration,
      move = this.move,
      easing = this.easing,
      rho = this.rho,
    }: SwitchOptions = {},
  ): this {
    if (this.blending) {
      this.#from = null;
      this.#fromPose = pose.set(this.#frozen, this.pose);
    } else {
      this.#from = this.#source;
      this.#fromPose = this.#source?.pose ?? null;
    }
    this.#source = source;
    this.#options = { move, easing, rho };
    this.#elapsed = 0;
    this.#blendDuration = this.#fromPose ? Math.max(duration, 0) : 0;
    this.invalidate();
    return this;
  }

  protected step(dt: Second): boolean {
    let moving = this.#source?.update(dt) ?? false;
    if (this.blending) {
      this.#from?.update(dt);
      this.#elapsed = Math.min(this.#elapsed + dt, this.#blendDuration);
      // Including the frame reaching the source.
      moving = true;
    }
    if (!this.blending) this.#from = this.#fromPose = null;
    return moving;
  }

  protected writePose(out: Pose): void {
    if (!this.#source) return;
    if (this.#fromPose && this.blending) {
      interpolateShots(
        out,
        this.#fromPose,
        this.#source.pose,
        this.#elapsed / this.#blendDuration,
        this.#options,
      );
    } else {
      pose.set(out, this.#source.pose);
    }
  }
}

export type { Source, SwitchOptions, SwitcherSettings };
export default Switcher;
