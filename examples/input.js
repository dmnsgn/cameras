import { PointerManager, KeyboardManager } from "cameras";
import { Pane } from "tweakpane";

const canvas = document.createElement("canvas");
Object.assign(canvas.style, {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
});
const context = canvas.getContext("2d");

// Bottom left, clear of the header and pane
const overlay = document.createElement("div");
Object.assign(overlay.style, {
  position: "absolute",
  bottom: "12px",
  left: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  maxHeight: "60vh",
  font: "12px ui-monospace, monospace",
  whiteSpace: "pre",
  pointerEvents: "none",
});
const log = document.createElement("div");
Object.assign(log.style, { overflow: "hidden", opacity: 0.8 });
const status = document.createElement("div");
overlay.append(log, status);
document.body.append(canvas, overlay);

const input = new PointerManager(canvas).enable();
const keyboard = new KeyboardManager(window).enable();

// State accumulated from gestures, drawn every frame
const STATE = {
  enabled: true,
  unadjustedMovement: true,
  logMoves: false,
  gesture: null,
  fling: null,
  rawPointers: new Map(),
  translation: [0, 0],
  scale: 1,
  rotation: 0,
  wheel: [0, 0],
  wheelDevice: "–",
  pinchScale: 1,
  pinchRotation: 0,
};

const lines = [];
const print = (text) => {
  lines.unshift(text);
  lines.length = Math.min(lines.length, 30);
  log.textContent = lines.join("\n");
};
const format = (value) =>
  Array.isArray(value)
    ? `[${value.map((v) => v.toFixed(2)).join(", ")}]`
    : typeof value === "number"
      ? value.toFixed(3)
      : value;
const describe = (event, keys) =>
  `${event.type.padEnd(6)} ${keys.map((key) => `${key}=${format(event[key])}`).join(" ")}`;

// Raw pointers, for drawing each contact only
for (const type of ["pointerdown", "pointermove"]) {
  canvas.addEventListener(type, (event) => {
    if (event.buttons || event.pointerType === "touch") {
      STATE.rawPointers.set(event.pointerId, [event.offsetX, event.offsetY]);
    }
  });
}
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (event) =>
    STATE.rawPointers.delete(event.pointerId),
  );
}

input.on("start", (event) => {
  STATE.gesture = event;
  STATE.fling = null;
  print(describe(event, ["pointerType", "pointerCount", "buttons", "locked"]));
});
input.on("move", (event) => {
  STATE.gesture = event;
  STATE.translation[0] += event.delta[0];
  STATE.translation[1] += event.delta[1];
  STATE.scale *= event.scale;
  STATE.rotation += event.rotation;
  if (STATE.logMoves) {
    print(describe(event, ["delta", "scale", "rotation", "velocity"]));
  }
});
input.on("end", (event) => {
  STATE.gesture = null;
  STATE.fling = event;
  print(describe(event, ["pointerCount", "velocity"]));
});
input.on("wheel", (event) => {
  STATE.wheel[0] += event.delta[0];
  STATE.wheel[1] += event.delta[1];
  STATE.wheelDevice = event.device;
  print(describe(event, ["delta", "device", "ndc"]));
});
input.on("pinch", (event) => {
  STATE.pinchScale *= event.scale;
  STATE.pinchRotation += event.rotation;
  print(describe(event, ["scale", "rotation", "ndc"]));
});
keyboard.on("down", ({ code, repeat }) => {
  if (!repeat) print(`key    down ${code}`);
});
keyboard.on("up", ({ code }) => print(`key    up   ${code}`));

// GUI
const pane = new Pane({ title: "Input" });

const managerFolder = pane.addFolder({ title: "PointerManager" });
managerFolder
  .addBinding(STATE, "enabled")
  .on("change", ({ value }) => (value ? input.enable() : input.disable()));
managerFolder.addBinding(input, "wheel", { label: "wheel (re-enable)" });
managerFolder.addBinding(input, "preventContextMenu");
managerFolder.addBinding(input, "velocitySmoothing", { min: 0.001, max: 0.5 });
managerFolder.addBinding(input, "restThreshold", { min: 0, max: 0.5 });
managerFolder.addBinding(input, "lineHeight", { min: 1, max: 100 });

const AREA = { x: 0, y: 0, width: 1, height: 1 };
const areaFolder = managerFolder.addFolder({ title: "interactiveArea" });
for (const key of Object.keys(AREA)) {
  areaFolder.addBinding(AREA, key, { min: 0, max: 1 }).on("change", () => {
    input.interactiveArea = [AREA.x, AREA.y, AREA.width, AREA.height];
  });
}

const lockFolder = pane.addFolder({ title: "Pointer lock" });
lockFolder.addBinding(STATE, "unadjustedMovement");
lockFolder
  .addButton({ title: "requestPointerLock" })
  .on("click", () =>
    input
      .requestPointerLock(STATE.unadjustedMovement)
      .catch((error) => print(`lock   error ${error.message}`)),
  );

const accumulatorsFolder = pane.addFolder({ title: "Accumulated" });
for (const key of [
  "scale",
  "rotation",
  "wheelDevice",
  "pinchScale",
  "pinchRotation",
]) {
  accumulatorsFolder.addBinding(STATE, key, { readonly: true });
}
accumulatorsFolder.addBinding(STATE, "logMoves");
accumulatorsFolder.addButton({ title: "reset" }).on("click", () => {
  Object.assign(STATE, {
    translation: [0, 0],
    scale: 1,
    rotation: 0,
    wheel: [0, 0],
    pinchScale: 1,
    pinchRotation: 0,
  });
  lines.length = 0;
  log.textContent = "";
});

// Render
const resize = () => {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
};
window.addEventListener("resize", resize);
resize();

const arrow = ([x, y], [dx, dy], color) => {
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + dx, y + dy);
  context.stroke();
};

const frame = () => {
  const { width, height } = canvas;
  const { clientWidth, clientHeight } = canvas;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineWidth = 2;

  // Interactive area
  const [ax, ay, aw, ah] = input.interactiveArea;
  context.strokeStyle = "#95171d";
  context.strokeRect(
    ax * clientWidth,
    ay * clientHeight,
    aw * clientWidth,
    ah * clientHeight,
  );
  const origin = [ax * clientWidth, ay * clientHeight];

  // Raw contacts
  context.fillStyle = "#f2f2f288";
  for (const [x, y] of STATE.rawPointers.values()) {
    context.beginPath();
    context.arc(x, y, 24, 0, Math.PI * 2);
    context.fill();
  }

  // Gesture centroid, accumulated scale and rotation
  const gesture = STATE.gesture ?? STATE.fling;
  if (gesture && !gesture.locked) {
    const center = [
      origin[0] + gesture.position[0],
      origin[1] + gesture.position[1],
    ];
    const radius = 40 * STATE.scale;
    context.strokeStyle = "#f2f2f2";
    context.beginPath();
    context.arc(center[0], center[1], radius, 0, Math.PI * 2);
    context.stroke();
    arrow(
      center,
      [Math.cos(STATE.rotation) * radius, -Math.sin(STATE.rotation) * radius],
      "#f2f2f2",
    );
    arrow(
      center,
      [gesture.velocity[0] * 0.1, gesture.velocity[1] * 0.1],
      STATE.gesture ? "#4caf50" : "#ff9800",
    );
  }

  const g = STATE.gesture;
  status.textContent = [
    `active ${input.active}  locked ${input.locked}`,
    `pointers ${g?.pointerCount ?? 0}  type ${g?.pointerType ?? "–"}  buttons ${(g?.buttons ?? 0).toString(2).padStart(6, "0")}`,
    `modifiers ${
      g
        ? Object.entries(g.modifiers)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join("+") || "–"
        : "–"
    }`,
    `ndc ${g ? format(g.ndc) : "–"}  aspect ${g ? g.aspect.toFixed(3) : "–"}`,
    `translation ${format(STATE.translation)}  wheel ${format(STATE.wheel)}`,
    `keys ${[...keyboard.pressed.keys()].join(" ") || "–"}  axis W/S ${keyboard.axis("KeyS", "KeyW")}`,
  ].join("\n");

  pane.refresh();
  requestAnimationFrame(frame);
};
frame();
