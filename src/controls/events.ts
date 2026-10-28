// Shared and frozen: emitted at input or frame rate without allocating.
const CONTROL_START = Object.freeze({ type: "controlstart" as const });
const CONTROL = Object.freeze({ type: "control" as const });
const CONTROL_END = Object.freeze({ type: "controlend" as const });
const TRANSITION_START = Object.freeze({
  type: "transitionstart" as const,
});

export { CONTROL_START, CONTROL, CONTROL_END, TRANSITION_START };
