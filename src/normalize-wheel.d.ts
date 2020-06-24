declare module "normalize-wheel" {
  interface NormalizedWheelEvent {
    spinX: number;
    spinY: number;
    pixelX: number;
    pixelY: number;
  }

  function normalizeWheel(event: Event): NormalizedWheelEvent;

  namespace normalizeWheel {
    export let getEventType: () => string;
  }

  export = normalizeWheel;
}
