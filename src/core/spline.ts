import inverseLerp from "inverse-lerp";
import { avec3, utils, vec3 } from "pex-math";

import type { TypedArray, Vec3 } from "pex-math";

interface SplineOptions {
  /** 0 uniform, 0.5 centripetal, 1 chordal. */
  alpha?: number;
  closed?: boolean;
  /** Arc length table resolution per segment. */
  samplesPerSegment?: number;
}

const TEMP_A = vec3.create();
const TEMP_B = vec3.create();

/**
 * Catmull-Rom spline through points, parameterized by arc length. Points are
 * flat: x, y, z of each point in sequence.
 *
 * Centripetal parameterization (alpha 0.5) never forms cusps or
 * self-intersections within a segment, which keeps camera rails smooth.
 *
 * @see Yuksel, C., Schaefer, S. & Keyser, J. (2011). Parameterization and applications of Catmull-Rom curves. https://doi.org/10.1016/j.cad.2010.08.008
 */
class Spline {
  public readonly points: Float64Array;
  public readonly alpha: number;
  public readonly closed: boolean;

  // Points with a neighbour on each side of every segment: wrapped when closed,
  // reflected end points extending open curves.
  #controls: Float64Array;
  // Knot intervals between consecutive controls.
  #knots: Float64Array;
  #lengths: Float64Array;
  #samples: number;

  constructor(
    points: number[] | TypedArray,
    { alpha = 0.5, closed = false, samplesPerSegment = 32 }: SplineOptions = {},
  ) {
    const count = Math.floor(points.length / 3);
    if (count < 2) throw new RangeError("Spline needs two points.");
    this.points = Float64Array.from(points.slice(0, count * 3));
    this.alpha = alpha;
    this.closed = closed;

    const controls = (this.#controls = new Float64Array((count + 3) * 3));
    for (let i = 0; i < count + 3; i++) {
      avec3.set(controls, i, this.points, (i - 1 + count) % count);
    }
    if (!closed) {
      for (const [control, edge, inner] of [
        [0, 0, 1],
        [count + 1, count - 1, count - 2],
      ]) {
        avec3.set(controls, control, this.points, edge);
        avec3.scale(controls, control, 2);
        avec3.sub(controls, control, this.points, inner);
      }
    }
    this.#knots = new Float64Array(count + 2);
    for (let i = 0; i < this.#knots.length; i++) {
      this.#knots[i] = Math.max(
        Math.pow(avec3.distance(controls, i, controls, i + 1), alpha),
        1e-8,
      );
    }

    this.#samples = samplesPerSegment * this.segmentCount;
    this.#lengths = new Float64Array(this.#samples + 1);

    // Cumulative chord lengths of a dense sampling approximate the arc length.
    this.pointAtParameter(TEMP_A, 0);
    for (let i = 1; i <= this.#samples; i++) {
      this.pointAtParameter(TEMP_B, i / this.#samples);
      this.#lengths[i] = this.#lengths[i - 1] + vec3.distance(TEMP_A, TEMP_B);
      vec3.set(TEMP_A, TEMP_B);
    }
  }

  public get segmentCount(): number {
    const count = this.points.length / 3;
    return this.closed ? count : count - 1;
  }

  public get length(): number {
    return this.#lengths[this.#samples];
  }

  /** Point at a fraction of the arc length, wrapped when closed. */
  public pointAt(out: Vec3, u: number): Vec3 {
    return this.pointAtParameter(out, this.parameterAt(u));
  }

  /** Unit tangent at a fraction of the arc length. */
  public tangentAt(out: Vec3, u: number, epsilon = 1e-4): Vec3 {
    const t = this.parameterAt(u);
    const [a, b] = this.closed
      ? [t - epsilon, t + epsilon]
      : [Math.max(0, t - epsilon), Math.min(1, t + epsilon)];
    this.pointAtParameter(TEMP_A, a);
    this.pointAtParameter(out, b);
    return vec3.normalize(vec3.sub(out, TEMP_A));
  }

  /** Curve parameter in [0, 1] at a fraction of the arc length. */
  public parameterAt(u: number): number {
    u = this.closed ? u - Math.floor(u) : utils.clamp(u, 0, 1);
    const target = u * this.length;

    let low = 0;
    let high = this.#samples;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.#lengths[middle] < target) low = middle + 1;
      else high = middle;
    }
    if (low === 0) return 0;

    const fraction = inverseLerp(
      this.#lengths[low - 1],
      this.#lengths[low],
      target,
    );
    return (low - 1 + fraction) / this.#samples;
  }

  /** Point at a curve parameter in [0, 1], not uniform in arc length. */
  public pointAtParameter(out: Vec3, t: number): Vec3 {
    const count = this.segmentCount;
    const scaled =
      (this.closed ? t - Math.floor(t) : utils.clamp(t, 0, 1)) * count;
    const segment = Math.min(Math.floor(scaled), count - 1);
    return this.#segmentPoint(out, segment, scaled - segment);
  }

  // Barry-Goldman pyramidal formulation with non-uniform knots.
  #segmentPoint(out: Vec3, segment: number, t: number): Vec3 {
    const c = this.#controls;
    const t0 = 0;
    const t1 = t0 + this.#knots[segment];
    const t2 = t1 + this.#knots[segment + 1];
    const t3 = t2 + this.#knots[segment + 2];
    const time = t1 + (t2 - t1) * t;

    for (let i = 0, o = segment * 3; i < 3; i++, o++) {
      const a1 = ((t1 - time) * c[o] + (time - t0) * c[o + 3]) / (t1 - t0);
      const a2 = ((t2 - time) * c[o + 3] + (time - t1) * c[o + 6]) / (t2 - t1);
      const a3 = ((t3 - time) * c[o + 6] + (time - t2) * c[o + 9]) / (t3 - t2);
      const b1 = ((t2 - time) * a1 + (time - t0) * a2) / (t2 - t0);
      const b2 = ((t3 - time) * a2 + (time - t1) * a3) / (t3 - t1);
      out[i] = ((t2 - time) * b1 + (time - t1) * b2) / (t2 - t1);
    }
    return out;
  }
}

export type { SplineOptions };
export default Spline;
