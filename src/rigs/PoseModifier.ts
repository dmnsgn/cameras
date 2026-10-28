import * as pose from "../core/pose.js";
import { assignOptions } from "../core/options.js";

import type { Pose, PoseAdapter } from "../core/pose.js";
import type { Second } from "../core/types.js";

/**
 * Post-process a pose from any source. The output is separate so sources never
 * see their pose modified.
 *
 * ```js
 * controls.update(dt);
 * composer.update(controls.pose, dt);
 * shake.update(composer.pose, dt);
 * shake.applyTo(camera);
 * ```
 */
export default abstract class PoseModifier<Settings extends object = object> {
  public readonly pose: Pose = pose.create();
  public enabled = true;

  /** Update settings without aliasing the given arrays and objects. */
  public set(options: Settings): this {
    return assignOptions(this, options);
  }

  /**
   * Copy the input pose and modify the copy.
   *
   * @returns Whether the modifier is still changing the pose over time.
   */
  public update(input: Pose, dt: Second): boolean {
    pose.set(this.pose, input);
    return this.enabled ? this.modify(this.pose, dt) : false;
  }

  public applyTo<T>(object: T, adapter?: PoseAdapter<T>): T {
    return pose.applyTo(this.pose, object, adapter);
  }

  protected abstract modify(out: Pose, dt: Second): boolean;
}
