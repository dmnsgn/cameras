import Emitter from "../core/Emitter.js";

import { getModifiers } from "./modifiers.js";

import type {
  KeyboardEventDetail,
  KeyboardManagerEventMap,
  KeyboardManagerOptions,
  Modifiers,
} from "./types.js";

// Modifier codes and the flag reporting them held.
const MODIFIERS = new Map<string, keyof Modifiers>([
  ["ShiftLeft", "shift"],
  ["ShiftRight", "shift"],
  ["ControlLeft", "ctrl"],
  ["ControlRight", "ctrl"],
  ["AltLeft", "alt"],
  ["AltRight", "alt"],
  ["MetaLeft", "meta"],
  ["MetaRight", "meta"],
]);

// Focusable controls own their keys: Space activates buttons, arrows move sliders.
const CONTROLS =
  "input, textarea, select, button, a[href], summary, [tabindex]";

/**
 * Tracks pressed keys by physical code, for continuous controls like first
 * person or fly.
 */
export default class KeyboardManager extends Emitter<KeyboardManagerEventMap> {
  public readonly target: EventTarget;
  /** Codes whose default action is prevented, unless Ctrl, Alt or Meta is held. */
  public preventDefault: Set<string>;
  public filter = (event: KeyboardEvent): boolean => {
    // Events heard outside a shadow root are retargeted to its host.
    const origin = event.composedPath()[0] as Partial<HTMLElement>;
    return (
      origin === this.target ||
      !(origin.isContentEditable || origin.matches?.(CONTROLS))
    );
  };

  #abortController: AbortController | null = null;
  // Pressed codes and their key.
  #pressed = new Map<string, string>();

  /** @param target Usually `window`, or a focusable element. */
  constructor(target: EventTarget, options: KeyboardManagerOptions = {}) {
    super();
    this.target = target;
    this.preventDefault = new Set(options.preventDefault);
    this.filter = options.filter ?? this.filter;
  }

  /** Listening to input. */
  public get enabled(): boolean {
    return this.#abortController !== null;
  }

  /** Pressed codes and their key. */
  public get pressed(): ReadonlyMap<string, string> {
    return this.#pressed;
  }

  /** Any of the codes is pressed. */
  public isPressed(codes: string | string[]): boolean {
    return this.#any(codes);
  }

  /**
   * -1, 0 or 1 from two sets of keys, e.g. `axis(["KeyS", "ArrowDown"],
   * ["KeyW", "ArrowUp"])`.
   */
  public axis(
    negative: string | string[],
    positive: string | string[],
  ): -1 | 0 | 1 {
    return ((this.#any(positive) ? 1 : 0) - (this.#any(negative) ? 1 : 0)) as
      -1 | 0 | 1;
  }

  #any(codes: string | string[]): boolean {
    if (typeof codes === "string") return this.#pressed.has(codes);
    for (const code of codes) if (this.#pressed.has(code)) return true;
    return false;
  }

  /** Start listening. */
  public enable(): this {
    if (this.#abortController) return this;
    this.#abortController = new AbortController();
    const options = { signal: this.#abortController.signal };
    const target = this.target;
    target.addEventListener(
      "keydown",
      this.#onKeyDown as EventListener,
      options,
    );
    target.addEventListener("keyup", this.#onKeyUp as EventListener, options);

    // Blur doesn't bubble: losing window focus only reaches the window.
    const view =
      (target as Window).window ??
      (target as Document).defaultView ??
      (target as Element).ownerDocument?.defaultView;
    view?.addEventListener("blur", this.releaseAll, options);
    // Elements also miss the keyups once focus leaves them.
    if ((target as Element).ownerDocument) {
      target.addEventListener(
        "focusout",
        this.#onFocusOut as EventListener,
        options,
      );
    }
    return this;
  }

  /** Stop listening and release pressed keys. */
  public disable(): this {
    if (!this.#abortController) return this;
    this.releaseAll();
    this.#abortController.abort();
    this.#abortController = null;
    return this;
  }

  /** Disable and remove all listeners. */
  public dispose(): void {
    this.disable();
    this.removeAllListeners();
  }

  /**
   * Release every pressed key, emitting `up` for each. Prevents stuck keys when
   * focus is lost.
   */
  public releaseAll = (): void => {
    this.#release(() => true);
  };

  #release(predicate: (code: string) => boolean): void {
    for (const [code, key] of this.#pressed) {
      if (!predicate(code)) continue;
      this.#pressed.delete(code);
      this.emit("up", this.#detail("up", code, key, false));
    }
  }

  // Modifier keyups can be lost, e.g. the first released of two held Shift
  // keys on Windows.
  #releaseStaleModifiers(event: KeyboardEvent): void {
    const held = getModifiers(event);
    this.#release((code) => {
      const flag = MODIFIERS.get(code);
      return flag !== undefined && !held[flag];
    });
  }

  #detail(
    type: KeyboardEventDetail["type"],
    code: string,
    key: string,
    repeat: boolean,
    event?: KeyboardEvent,
  ): KeyboardEventDetail {
    return {
      type,
      code,
      key,
      repeat,
      modifiers: getModifiers(event),
      originalEvent: event,
    };
  }

  // Leave browser shortcuts alone, e.g. Alt+Arrow history navigation.
  #prevent(event: KeyboardEvent): void {
    if (
      this.preventDefault.has(event.code) &&
      !(event.ctrlKey || event.altKey || event.metaKey)
    ) {
      event.preventDefault();
    }
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    this.#releaseStaleModifiers(event);
    const { code, key } = event;

    // macOS reports Caps Lock toggles, not presses.
    if (code === "CapsLock" || !this.filter(event)) return;
    // Shortcuts aren't movement, and macOS drops their keyup.
    if ((event.ctrlKey || event.metaKey) && !MODIFIERS.has(code)) return;

    this.#prevent(event);
    this.#pressed.set(code, key);
    this.emit("down", this.#detail("down", code, key, event.repeat, event));
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    const { code, key } = event;
    if (this.#pressed.delete(code)) {
      this.#prevent(event);
      this.emit("up", this.#detail("up", code, key, event.repeat, event));
    }
    this.#releaseStaleModifiers(event);

    // macOS drops keyups while Meta is held: release keys that may have been
    // let go meanwhile. Modifiers are tracked by their flags instead.
    if (MODIFIERS.get(code) === "meta") {
      this.#release((pressed) => !MODIFIERS.has(pressed));
    }
  };

  #onFocusOut = (event: FocusEvent): void => {
    if (!(this.target as Node).contains(event.relatedTarget as Node | null)) {
      this.releaseAll();
    }
  };
}
