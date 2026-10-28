import { quat, utils, vec3 } from "pex-math";
import { smoothDamp } from "ressort";

import { quatFromUnitVectors, quatLookAt } from "../core/math.js";
import PoseSource, { SPRING_SMOOTH_TIME } from "../core/PoseSource.js";
import { viewDistance } from "../camera/lens.js";

import type { Vec3 } from "pex-math";
import type { SpringState } from "ressort";
import type { Lens } from "../camera/types.js";
import type { Pose } from "../core/pose.js";
import type { PoseSourceEventMap } from "../core/PoseSource.js";
import type { Radian, Second } from "../core/types.js";

interface CraneSettings {
  /** Base of the column. */
  pivot?: Vec3;
  up?: Vec3;
  /** Point the head follows. The head looks along the arm, level, otherwise. */
  target?: Vec3 | null;
  lens?: Lens;
  smoothTime?: Second;
  /**
   * Screen angle below which motion rests. Camera zoom applied outside the pose
   * isn't accounted for.
   */
  restThreshold?: Radian;
}

interface CraneRigOptions extends CraneSettings {
  /** Column height. */
  height?: number;
  armLength?: number;
  /** Arm rotation around the column, counter-clockwise from +Z. */
  swing?: Radian;
  /** Arm elevation above the horizon. */
  boom?: Radian;
}

type Channel = "height" | "armLength" | "swing" | "boom";
const CHANNELS: Channel[] = ["height", "armLength", "swing", "boom"];
const ANGLES = new Set<Channel>(["swing", "boom"]);

const TEMP_QUAT = quat.create();
const TEMP_DIRECTION = vec3.create();
const TEMP_UP = vec3.create();

/** Jib crane: a column with a swinging, booming arm carrying the camera head. */
class CraneRig extends PoseSource<PoseSourceEventMap, CraneSettings> {
  public pivot: Vec3 = [0, 0, 0];
  public up: Vec3 = [0, 1, 0];
  public target: Vec3 | null = null;
  public lens?: Lens;
  public smoothTime: Second = SPRING_SMOOTH_TIME;
  public restThreshold = 1e-4;

  #current: Record<Channel, number> = {
    height: 1,
    armLength: 3,
    swing: 0,
    boom: 0,
  };
  #end: Record<Channel, number> = { ...this.#current };
  #springs: Record<Channel, SpringState> = {
    height: { velocity: 0 },
    armLength: { velocity: 0 },
    swing: { velocity: 0 },
    boom: { velocity: 0 },
  };

  constructor({
    height,
    armLength,
    swing,
    boom,
    ...options
  }: CraneRigOptions = {}) {
    super();
    this.set(options);
    const end = this.#end;
    this.#end = {
      height: height ?? end.height,
      armLength: armLength ?? end.armLength,
      swing: swing ?? end.swing,
      boom: boom ?? end.boom,
    };
    this.#current = { ...this.#end };
  }

  public get(channel: Channel, end = false): number {
    return (end ? this.#end : this.#current)[channel];
  }

  /** Rotate the arm around the column. */
  public swingTo(angle: Radian, transition = true): this {
    return this.#to("swing", angle, transition);
  }

  /** Raise or lower the arm. */
  public boomTo(angle: Radian, transition = true): this {
    return this.#to("boom", angle, transition);
  }

  /** Telescope the arm. */
  public extendTo(length: number, transition = true): this {
    return this.#to("armLength", Math.max(0, length), transition);
  }

  /** Raise or lower the column. */
  public pedestalTo(height: number, transition = true): this {
    return this.#to("height", height, transition);
  }

  protected step(dt: Second): boolean {
    const length =
      this.restThreshold *
      viewDistance(this.lens, this.target ? this.pose : undefined);
    let moving = false;
    for (const channel of CHANNELS) {
      this.#current[channel] = smoothDamp(
        this.#current[channel],
        this.#end[channel],
        this.#springs[channel],
        this.smoothTime,
        dt,
      );
      const remaining = Math.abs(this.#current[channel] - this.#end[channel]);
      // Angles turn the head and swing the camera along the arm.
      if (
        ANGLES.has(channel)
          ? remaining > this.restThreshold ||
            remaining * this.#end.armLength > length
          : remaining > length
      ) {
        moving = true;
      }
    }
    if (!moving && CHANNELS.some((c) => this.#current[c] !== this.#end[c])) {
      this.#stop();
      this.invalidate();
    }
    return moving;
  }

  protected writePose(out: Pose): void {
    const { height, armLength, swing, boom } = this.#current;
    const up = vec3.normalize(vec3.set(TEMP_UP, this.up));
    const inverse = quat.conjugate(
      quatFromUnitVectors(TEMP_QUAT, up, utils.Y_UP),
    );

    // Arm direction in Y-up space, then into the rig's up space.
    TEMP_DIRECTION[0] = Math.sin(swing) * Math.cos(boom);
    TEMP_DIRECTION[1] = Math.sin(boom);
    TEMP_DIRECTION[2] = Math.cos(swing) * Math.cos(boom);
    vec3.multQuat(TEMP_DIRECTION, inverse);

    vec3.addScaled(vec3.set(out.position, this.pivot), up, height);
    vec3.addScaled(out.position, TEMP_DIRECTION, armLength);

    if (this.target) {
      vec3.set(out.target, this.target);
    } else {
      // Level head looking along the arm.
      TEMP_DIRECTION[0] = Math.sin(swing);
      TEMP_DIRECTION[1] = 0;
      TEMP_DIRECTION[2] = Math.cos(swing);
      vec3.multQuat(TEMP_DIRECTION, inverse);
      vec3.add(vec3.set(out.target, out.position), TEMP_DIRECTION);
    }
    vec3.set(out.up, this.up);
    quatLookAt(out.orientation, out.position, out.target, out.up);
  }

  #to(channel: Channel, value: number, transition: boolean): this {
    this.#end[channel] = value;
    if (!transition) {
      this.#current[channel] = value;
      this.#springs[channel].velocity = 0;
    }
    this.invalidate();
    return this;
  }

  #stop(): void {
    for (const channel of CHANNELS) {
      this.#current[channel] = this.#end[channel];
      this.#springs[channel].velocity = 0;
    }
  }
}

export type { CraneSettings, CraneRigOptions };
export default CraneRig;
