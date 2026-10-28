import inverseLerp from "inverse-lerp";

import PoseSource from "../core/PoseSource.js";

import { interpolateShots, writeShot } from "./shot.js";

import type { Pose } from "../core/pose.js";
import type { PoseSourceEventMap } from "../core/PoseSource.js";
import type { Second } from "../core/types.js";
import type { MoveOptions, Shot } from "./shot.js";

const END = Object.freeze({ type: "end" as const });

interface SequenceShot extends MoveOptions {
  shot: Shot;
  /** Move from the previous shot, 0 to cut. Ignored for the first one. */
  duration?: Second;
  /** Time spent on the shot after arriving. */
  hold?: Second;
}

interface SequenceEventMap extends PoseSourceEventMap {
  /** A move towards `index` started, or the sequence started on `index`. */
  shotchange: { type: "shotchange"; index: number };
  end: { type: "end" };
}

interface SequenceSettings {
  shots?: SequenceShot[];
  loop?: boolean;
  /** Playback rate, negative to reverse. */
  speed?: number;
}

/**
 * Timeline of shots, moves and holds. `seek` is deterministic, so offline
 * renders can drive it with their own clock.
 */
class Sequence extends PoseSource<SequenceEventMap, SequenceSettings> {
  public shots: SequenceShot[] = [];
  public loop = false;
  public speed = 1;

  #time = 0;
  // Playhead at the previous step: seeks move it too.
  #steppedTime = 0;
  #playing = false;
  #index = -1;

  constructor(options: SequenceSettings = {}) {
    super();
    this.set(options);
  }

  public get time(): Second {
    return this.#time;
  }

  public get playing(): boolean {
    return this.#playing;
  }

  /** Total duration of moves and holds. */
  public get duration(): Second {
    return this.shots.reduce(
      (sum, { duration = 0, hold = 0 }, i) => sum + (i ? duration : 0) + hold,
      0,
    );
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

  /** Jump to a time, clamped or wrapped when looping. */
  public seek(time: Second): this {
    this.#time = this.#wrap(time, this.duration);
    this.invalidate();
    return this;
  }

  /**
   * Write the pose at a time into `out`, without changing the playhead.
   *
   * @returns Index of the shot being moved to or held, -1 without shots.
   */
  public evaluate(out: Pose, time: Second): number {
    const { shots } = this;
    if (!shots.length) return -1;

    const duration = this.duration;
    time = this.#wrap(time, duration);
    const last = shots.length - 1;
    // The end shows the last shot, even one taking no time.
    if (time >= duration) {
      writeShot(out, shots[last].shot);
      return last;
    }
    let start = shots[0].hold ?? 0;
    let i = 0;
    while (i < last && time > start) {
      const { shot, duration = 0, hold = 0 } = shots[++i];
      if (time < start + duration) {
        const t = inverseLerp(start, start + duration, time);
        interpolateShots(out, shots[i - 1].shot, shot, t, shots[i]);
        return i;
      }
      start += duration + hold;
    }
    writeShot(out, shots[i].shot);
    return i;
  }

  protected step(dt: Second): boolean {
    const duration = this.duration;
    // Nothing can play: a stopped playhead or an empty loop.
    if (this.#playing && this.speed && (!this.loop || duration)) {
      const next = this.#time + dt * this.speed;
      // Only the boundary ahead of the playback direction ends it.
      const ended =
        !this.loop && (this.speed > 0 ? next >= duration : next <= 0);
      this.seek(next);
      if (ended) {
        this.#playing = false;
        this.emit("end", END);
      }
    }

    // External clocks seek every frame: moving until the playhead stops, so
    // they wake and rest once.
    const moving = this.#time !== this.#steppedTime;
    this.#steppedTime = this.#time;
    return moving;
  }

  #wrap(time: Second, duration: Second): Second {
    return this.loop && duration > 0
      ? time - Math.floor(time / duration) * duration
      : Math.min(Math.max(time, 0), duration);
  }

  protected writePose(out: Pose): void {
    const index = this.evaluate(out, this.#time);
    if (index === this.#index) {
      return;
    }

    this.#index = index;
    this.emit("shotchange", { type: "shotchange", index });
  }
}

export type { SequenceShot, SequenceEventMap, SequenceSettings };
export default Sequence;
