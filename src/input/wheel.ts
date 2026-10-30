import type { Vec2 } from "pex-math";
import type { Pixel } from "../core/types.js";
import type { WheelDevice } from "./types.js";

/**
 * One Firefox wheel notch (3 lines) matches one Chrome notch (100 px).
 *
 * @see https://source.chromium.org/chromium/chromium/src/+/main:ui/events/blink/web_input_event_builders_win.cc
 */
const DEFAULT_LINE_HEIGHT: Pixel = 100 / 3;

/**
 * Chromium's PDF viewer pinch: `Math.exp(-event.deltaY / 100)`, clamped to a
 * 1.25 ratio so a mouse notch doesn't zoom as much as a full pinch. The clamp
 * is symmetric in log space.
 *
 * @see https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/resources/pdf/gesture_detector.ts
 */
const PINCH_SENSITIVITY = 0.01;
const MAX_PINCH_DELTA: Pixel = Math.log(1.25) / PINCH_SENSITIVITY;

/**
 * Wheel events closer than this, in milliseconds, belong to the same stream:
 * Chromium's wheel latching transaction. Firefox's
 * `mousewheel.transaction.timeout` is 1500 ms.
 *
 * @see https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/content/browser/renderer_host/input/mouse_wheel_phase_handler.h
 */
const STREAM_GAP = 500;

/**
 * Convert wheel deltas to CSS pixels whatever the `deltaMode`.
 *
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=1392460
 */
function normalizeDelta(
  out: Vec2,
  // Firefox converts lines to pixels its own way unless deltaMode is read first.
  {
    deltaMode,
    deltaX,
    deltaY,
  }: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  lineHeight: Pixel,
  pageHeight: Pixel,
): Vec2 {
  let factor = 1;
  if (deltaMode === 1) {
    factor = lineHeight;
  } else if (deltaMode === 2) {
    factor = pageHeight;
  }
  out[0] = deltaX * factor;
  out[1] = deltaY * factor;
  return out;
}

/**
 * Scale ratio of a ctrlKey wheel event: trackpad pinch in Chrome, Firefox and
 * Edge, or ctrl+wheel.
 *
 * @param deltaY Pixel delta.
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=1052253
 */
function pinchScale(deltaY: Pixel): number {
  return Math.exp(
    -Math.max(-MAX_PINCH_DELTA, Math.min(deltaY, MAX_PINCH_DELTA)) *
      PINCH_SENSITIVITY,
  );
}

/**
 * Best effort guess of the wheel device. Browsers expose no reliable signal, so
 * ambiguous events return "unknown".
 *
 * @param event Wheel event.
 * @param [previousDeltaY] Delta of the previous event in the same stream.
 * @see https://github.com/w3c/pointerevents/issues/596
 */
function classifyDevice(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">,
  previousDeltaY?: number,
): WheelDevice {
  // deltaMode first, see normalizeDelta.
  const { deltaMode, deltaX, deltaY, shiftKey } = event;
  // Firefox reports mouse notches in lines, trackpads in pixels.
  if (deltaMode !== 0) return "mouse";
  // Two axis scrolling, unless shift maps a vertical wheel to horizontal.
  if (deltaX !== 0 && !shiftKey) return "trackpad";
  // Notches repeat the same large delta, trackpad momentum decays.
  return Math.abs(deltaY) >= 50 && deltaY === previousDeltaY
    ? "mouse"
    : "unknown";
}

/** Consecutive wheel events, sharing one device guess. */
class WheelStream {
  /** First conclusive guess of the stream. */
  public device: WheelDevice = "unknown";

  #lastTime = -Infinity;
  #lastDeltaY = 0;

  /** The event would start a new stream. */
  public isNew({ timeStamp }: Pick<WheelEvent, "timeStamp">): boolean {
    return timeStamp - this.#lastTime > STREAM_GAP;
  }

  /** Add an accepted event. Pinches extend the stream without a guess. */
  public add(
    event: Pick<
      WheelEvent,
      "deltaX" | "deltaY" | "deltaMode" | "shiftKey" | "ctrlKey" | "timeStamp"
    >,
  ): WheelDevice {
    const isNew = this.isNew(event);
    this.#lastTime = event.timeStamp;
    if (event.ctrlKey) return this.device;

    const device = classifyDevice(event, isNew ? undefined : this.#lastDeltaY);
    if (isNew || this.device === "unknown") this.device = device;
    this.#lastDeltaY = event.deltaY;
    return this.device;
  }
}

export {
  DEFAULT_LINE_HEIGHT,
  MAX_PINCH_DELTA,
  PINCH_SENSITIVITY,
  STREAM_GAP,
  normalizeDelta,
  pinchScale,
  classifyDevice,
  WheelStream,
};
