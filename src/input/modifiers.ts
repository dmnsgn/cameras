import type { Modifiers } from "./types.js";

/** Modifier flags, in binding suffix order. */
const MODIFIER_NAMES = ["shift", "ctrl", "alt", "meta"] as const;

type ModifierEvent = Event &
  Partial<Pick<MouseEvent, "shiftKey" | "ctrlKey" | "altKey" | "metaKey">>;

/** Modifier flags of an event, all false without one. */
const getModifiers = (event?: ModifierEvent): Modifiers => ({
  shift: !!event?.shiftKey,
  ctrl: !!event?.ctrlKey,
  alt: !!event?.altKey,
  meta: !!event?.metaKey,
});

export { MODIFIER_NAMES, getModifiers };
export type { ModifierEvent };
