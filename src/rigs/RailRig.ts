import { vec3 } from "pex-math";
import { advance, createTransition, fromSmoothTime, transition } from "ressort";

import { quatLookAt, safeDivide } from "../core/math.js";
import PoseSource, { SPRING_SMOOTH_TIME } from "../core/PoseSource.js";
import Spline from "../core/spline.js";
import { subjectPosition } from "../core/pose.js";
import { viewDistance } from "../camera/lens.js";

import type { TypedArray, Vec3 } from "pex-math";
import type { SpringState } from "ressort";
import type { Lens } from "../camera/types.js";
import type { Pose, Subject } from "../core/pose.js";
import type { PoseSourceEventMap } from "../core/PoseSource.js";
import type { SplineOptions } from "../core/spline.js";
import type { Radian, Second } from "../core/types.js";

const END = Object.freeze({ type: "end" as const });

interface RailEventMap extends PoseSourceEventMap {
  end: { type: "end" };
}

interface RailSettings {
  /** Units per second along the rail while playing, negative to reverse. */
  speed?: number;
  /** Approximate time to reach a sought progress. */
  smoothTime?: Second;
  /** Point or function to look at. Looks along the rail otherwise. */
  subject?: Subject | null;
  /** Units ahead on the rail to look at when there is no subject. */
  lookAhead?: number;
  up?: Vec3;
  lens?: Lens;
  /**
   * Screen angle below which motion rests. Camera zoom applied outside the pose
   * isn't accounted for.
   */
  restThreshold?: Radian;
}

interface RailRigOptions extends RailSettings, SplineOptions {
  /** Flat x, y, z of each point. */
  points: number[] | TypedArray;
  progress?: number;
}

const TEMP_TANGENT = vec3.create();
const TEMP_STEP = createTransition();

/**
 * Dolly track: the camera travels along a spline by arc length, looking at a
 * subject or ahead along the rail.
 */
class RailRig extends PoseSource<RailEventMap, RailSettings> {
  public speed = 1;
  public smoothTime: Second = SPRING_SMOOTH_TIME;
  public subject: Subject | null = null;
  public lookAhead = 1;
  public up: Vec3 = [0, 1, 0];
  public lens?: Lens;
  public restThreshold = 1e-4;

  #spline: Spline;
  #progress = 0;
  #progressEnd = 0;
  #progressSpring: SpringState = { velocity: 0 };
  #playing = false;

  constructor({
    points,
    alpha,
    closed,
    samplesPerSegment,
    progress = 0,
    ...options
  }: RailRigOptions) {
    super();
    this.#spline = new Spline(points, { alpha, closed, samplesPerSegment });
    this.set(options);
    // Not `seek`: closed rails would move it to the lap nearest 0.
    this.#progress = this.#progressEnd = this.#clamp(progress);
  }

  public get spline(): Spline {
    return this.#spline;
  }
  public set spline(spline: Spline) {
    // Unwind closed rail laps before an open rail clamps them.
    if (this.#spline.closed) {
      const laps = Math.floor(this.#progress);
      this.#progress -= laps;
      this.#progressEnd -= laps;
    }
    this.#spline = spline;
    this.#progress = this.#clamp(this.#progress);
    this.#progressEnd = this.#clamp(this.#progressEnd);
    this.invalidate();
  }

  /** Fraction of the rail length travelled, unbounded on closed rails. */
  public get progress(): number {
    return this.#progress;
  }

  public get playing(): boolean {
    return this.#playing;
  }

  public play(): this {
    this.#playing = true;
    this.invalidate();
    return this;
  }

  public pause(): this {
    this.#playing = false;
    return this;
  }

  /**
   * Move to a fraction of the rail length. Closed rails go to the nearest lap
   * instead of unwinding past ones.
   */
  public seek(progress: number, transition = true): this {
    if (this.#spline.closed) {
      progress += Math.round(this.#progress - progress);
    }
    this.#progressEnd = this.#clamp(progress);
    if (!transition) {
      this.#progress = this.#progressEnd;
      this.#progressSpring.velocity = 0;
    }
    this.invalidate();
    return this;
  }

  protected step(dt: Second): boolean {
    let goalVelocity = 0;
    if (this.#playing) {
      const { length } = this.#spline;
      goalVelocity = safeDivide(this.speed, length);
      const next = this.#progressEnd + goalVelocity * dt;
      if (!(length > 0) || this.#clamp(next) !== next) {
        // Open rail end, or nowhere to travel: the goal stops there.
        goalVelocity = 0;
        this.#progressEnd = this.#clamp(next);
        this.#playing = false;
        this.emit("end", END);
      }
    }

    // Exact while the goal travels at constant speed: playback is frame rate independent.
    this.#progress = advance(
      this.#progress,
      this.#progressEnd,
      this.#progressSpring,
      transition(TEMP_STEP, fromSmoothTime(this.smoothTime), dt),
      goalVelocity,
    );
    this.#progressEnd += goalVelocity * dt;
    // Playing at speed 0 rests too. The last pose already targets the subject.
    if (
      goalVelocity === 0 &&
      Math.abs(this.#progress - this.#progressEnd) * this.#spline.length <
        this.restThreshold *
          viewDistance(this.lens, this.subject ? this.pose : undefined)
    ) {
      if (this.#progress !== this.#progressEnd) this.invalidate();
      this.#progress = this.#progressEnd;
      this.#progressSpring.velocity = 0;
      return false;
    }
    return true;
  }

  protected writePose(out: Pose): void {
    const spline = this.#spline;
    spline.pointAt(out.position, this.#progress);

    if (this.subject) {
      vec3.set(out.target, subjectPosition(this.subject));
    } else {
      const ahead = this.#progress + this.lookAhead / spline.length;
      if (spline.closed || ahead <= 1) {
        spline.pointAt(out.target, ahead);
      } else {
        // Past the end of an open rail: extend it along its last tangent,
        // continuing the look target without a jump.
        spline.pointAt(out.target, 1);
        spline.tangentAt(TEMP_TANGENT, 1);
        vec3.addScaled(
          out.target,
          TEMP_TANGENT,
          this.lookAhead - (1 - this.#progress) * spline.length,
        );
      }
    }

    vec3.set(out.up, this.up);
    quatLookAt(out.orientation, out.position, out.target, out.up);
  }

  #clamp(progress: number): number {
    return this.#spline.closed ? progress : Math.min(Math.max(progress, 0), 1);
  }
}

export type { RailEventMap, RailSettings, RailRigOptions };
export default RailRig;
