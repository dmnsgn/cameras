import perlinNoise1D from "perlin-noise-1d";
import { vec3 } from "pex-math";

import PoseModifier from "./PoseModifier.js";
import { quatPanTiltRoll } from "../core/math.js";

import type { Vec3 } from "pex-math";
import type { Pose } from "../core/pose.js";
import type { Second } from "../core/types.js";

interface ShakeSettings {
  /** Current trauma in [0, 1]. */
  trauma?: number;
  /** Trauma lost per second. */
  decay?: number;
  /** Shake grows with trauma to this power: 2 or 3 keeps small hits subtle. */
  exponent?: number;
  /** Maximum pan, tilt and roll in radians at full trauma. */
  maxAngles?: Vec3;
  /** Maximum offset along the camera's right, up and back axes at full trauma. */
  maxOffset?: Vec3;
  /** Noise frequency in Hz. */
  frequency?: number;
  seed?: number;
}

const TEMP_ANGLES = vec3.create();
const TEMP_OFFSET = vec3.create();

/**
 * Trauma based camera shake: hits add trauma, which decays over time, and the
 * shake grows with trauma squared through smooth noise.
 *
 * Rotation shake reads better than translation for distant subjects;
 * translation suits close ones.
 *
 * @see Eiserloh, S. (2016). Math for game programmers: juicing your cameras with math. GDC. https://www.gdcvault.com/play/1023557/Math-for-Game-Programmers-Juicing
 */
class Shake extends PoseModifier<ShakeSettings> {
  public trauma = 0;
  // Bevy's example of the talk: https://github.com/bevyengine/bevy/blob/main/examples/camera/2d_screen_shake.rs
  public decay = 0.5;
  public exponent = 2;
  public maxAngles: Vec3 = [0.06, 0.06, 0.08];
  public maxOffset: Vec3 = [0, 0, 0];
  public frequency = 20;
  public seed = 0;

  #time = 0;

  constructor(options: ShakeSettings = {}) {
    super();
    this.set(options);
  }

  /** Current shake amount in [0, 1]. */
  public get amount(): number {
    return Math.pow(this.trauma, this.exponent);
  }

  /** Add trauma, e.g. 0.3 for a bump, 1 for an explosion. */
  public addTrauma(amount: number): this {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount));
    return this;
  }

  protected modify(out: Pose, dt: Second): boolean {
    this.#time += dt;
    const amount = this.amount;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    if (amount === 0) return false;

    const t = this.#time * this.frequency;
    const seed = this.seed * 6;

    for (let i = 0; i < 3; i++) {
      TEMP_ANGLES[i] = this.maxAngles[i] * perlinNoise1D(t, seed + i) * amount;
      TEMP_OFFSET[i] =
        this.maxOffset[i] * perlinNoise1D(t, seed + 3 + i) * amount;
    }
    quatPanTiltRoll(out.orientation, TEMP_ANGLES);
    vec3.add(out.position, vec3.multQuat(TEMP_OFFSET, out.orientation));
    return true;
  }
}

export type { ShakeSettings };
export default Shake;
