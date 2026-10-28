import { MODIFIER_NAMES } from "../input/modifiers.js";
import { MouseButton } from "../input/types.js";

import type { Modifiers } from "../input/types.js";
import type { Bindings, Gesture } from "./types.js";

const BUTTONS = Object.entries(MouseButton).map(
  ([name, flag]) => [name.toLowerCase(), flag] as const,
);

const modifierSuffix = (modifiers: Modifiers): string =>
  MODIFIER_NAMES.filter((name) => modifiers[name])
    .map((name) => `+${name}`)
    .join("");

/** Binding keys of a gesture, most specific first. */
function gestureKeys(gesture: Gesture): string[] {
  const bases: string[] = [];

  if (gesture.type === "wheel") {
    bases.push(`wheel:${gesture.device}`, "wheel");
  } else if (gesture.type === "pinch") {
    bases.push("pinch");
  } else if (gesture.locked) {
    bases.push("locked");
  } else if (gesture.pointerType === "touch") {
    bases.push(`touch:${gesture.pointerCount}`);
  } else {
    const buttons = BUTTONS.filter(([, flag]) => gesture.buttons & flag)
      .map(([name]) => name)
      .join("+");
    if (gesture.pointerType === "pen") bases.push(`pen:${buttons}`);
    bases.push(`mouse:${buttons}`);
  }

  const suffix = modifierSuffix(gesture.modifiers);
  return suffix ? [...bases.map((base) => base + suffix), ...bases] : bases;
}

/**
 * Actions bound to a gesture.
 *
 * @returns An empty array when unbound or disabled.
 */
function resolve<Action extends string>(
  bindings: Bindings<Action>,
  gesture: Gesture,
): readonly Action[] {
  for (const key of gestureKeys(gesture)) {
    if (!Object.hasOwn(bindings, key)) continue;
    const actions = bindings[key];
    if (actions === null) return [];
    return typeof actions === "string" ? [actions as Action] : actions;
  }
  return [];
}

export { gestureKeys, resolve };
