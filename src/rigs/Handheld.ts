import perlinNoise1D from "perlin-noise-1d";
import { vec3 } from "pex-math";

import PoseModifier from "./PoseModifier.js";
import { tanHalfFov } from "../camera/lens.js";
import { ZERO, quatPanTiltRoll } from "../core/math.js";

import type { Vec3 } from "pex-math";
import type { Pose } from "../core/pose.js";
import type { Lens } from "../camera/types.js";
import type { Radian, Second } from "../core/types.js";

/** One octave of rotation noise. */
interface NoiseLayer {
  /** Peak pan, tilt and roll in radians. */
  amplitude: Vec3;
  /** Pan, tilt and roll frequencies in Hz. */
  frequency: Vec3;
}

interface HandheldSettings {
  layers?: NoiseLayer[];
  lens?: Lens;
  /**
   * Field of view the layers are defined for. Other fields of view scale the
   * angles with the view, keeping the shake's size on screen, as Cinemachine's
   * tele and wide angle profiles do. null keeps the angles.
   */
  referenceFov?: Radian | null;
  /** Amplitude gain: 0 is a tripod, 1 the layers as defined. */
  amplitude?: number;
  /** Frequency gain: higher breathes faster. */
  frequency?: number;
  seed?: number;
}

// Cinemachine profile channels evaluate (Mathf.PerlinNoise(t, 0) - 0.5) *
// amplitude, in degrees around X (tilt) and Y (pan). Sampled on a lattice line,
// 2D Perlin noise peaks at half its range: assuming Unity's improved Perlin
// noise remapped to [0, 1], a quarter of the amplitude. Unverified: Unity's
// implementation isn't public.
const layer = (
  [tilt, tiltHz]: [number, number],
  [pan, panHz]: [number, number],
): NoiseLayer => ({
  amplitude: [(pan * Math.PI) / 720, (tilt * Math.PI) / 720, 0],
  frequency: [panHz, tiltHz, 0],
});

/**
 * Cinemachine's default lens, which its normal focal length profiles pair with:
 * its tele and wide angle variants shrink and grow the angles with the view.
 */
const HANDHELD_FOV: Radian = (40 * Math.PI) / 180;

/**
 * Cinemachine handheld noise profiles at a normal focal length: a slow drift,
 * a sway and a tremor, in rotation only.
 *
 * @see https://github.com/Unity-Technologies/com.unity.cinemachine/tree/main/com.unity.cinemachine/Presets/Noise
 */
const HANDHELD_LAYERS = {
  mild: [
    layer([7, 0.15], [5, 0.1]),
    layer([4, 0.8], [2, 0.75]),
    layer([1, 1.2], [0.8, 1.5]),
  ],
  strong: [
    layer([10, 0.4], [10, 0.06]),
    layer([5, 1.44], [3, 0.73]),
    layer([3, 2.49], [1, 2]),
  ],
  extreme: [
    layer([15, 0.2], [7, 0.25]),
    layer([5, 0.9], [3, 1]),
    layer([2, 2], [1, 0]),
  ],
} satisfies Record<string, NoiseLayer[]>;

const TEMP_ANGLES = vec3.create();

/**
 * Continuous handheld camera noise: layered octaves of smooth rotation noise,
 * through holds and moves alike. Stack a `Shake` after it for impacts.
 *
 * @see https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineBasicMultiChannelPerlin.html
 */
class Handheld extends PoseModifier<HandheldSettings> {
  // A copy: settings are written into this array.
  public layers: NoiseLayer[] = structuredClone(HANDHELD_LAYERS.mild);
  public lens?: Lens;
  public referenceFov: Radian | null = HANDHELD_FOV;
  public amplitude = 1;
  public frequency = 1;
  public seed = 0;

  #time = 0;

  constructor(options: HandheldSettings = {}) {
    super();
    this.set(options);
  }

  protected modify(out: Pose, dt: Second): boolean {
    // Gained time keeps the noise continuous when the frequency changes.
    this.#time += dt * this.frequency;
    if (!this.amplitude) return false;

    vec3.set(TEMP_ANGLES, ZERO);
    for (let l = 0; l < this.layers.length; l++) {
      const { amplitude, frequency } = this.layers[l];
      for (let i = 0; i < 3; i++) {
        const seed = (this.seed * this.layers.length + l) * 3 + i;
        TEMP_ANGLES[i] +=
          amplitude[i] * perlinNoise1D(this.#time * frequency[i], seed);
      }
    }
    const view =
      this.referenceFov === null
        ? 1
        : tanHalfFov(this.lens, out) / Math.tan(this.referenceFov / 2);
    vec3.scale(TEMP_ANGLES, this.amplitude * view);
    quatPanTiltRoll(out.orientation, TEMP_ANGLES);
    return true;
  }
}

export { HANDHELD_FOV, HANDHELD_LAYERS };
export type { NoiseLayer, HandheldSettings };
export default Handheld;
