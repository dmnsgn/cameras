# cameras

[![npm version](https://img.shields.io/npm/v/cameras)](https://www.npmjs.com/package/cameras)
[![stability-stable](https://img.shields.io/badge/stability-stable-green.svg)](https://www.npmjs.com/package/cameras)
[![npm minzipped size](https://img.shields.io/bundlephobia/minzip/cameras)](https://bundlephobia.com/package/cameras)
[![dependencies](https://img.shields.io/librariesio/release/npm/cameras)](https://github.com/dmnsgn/cameras/blob/main/package.json)
[![types](https://img.shields.io/npm/types/cameras)](https://github.com/microsoft/TypeScript)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673.svg)](https://conventionalcommits.org)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![license](https://img.shields.io/github/license/dmnsgn/cameras)](https://github.com/dmnsgn/cameras/blob/main/LICENSE.md)

Cameras, controls and cinematic rigs for 3D rendering: orbit, map, first person, fly and trackball controls, shots, rails, cranes, framing, handheld and shake, with a physical lens. Engine agnostic, WebGPU first.

[![paypal](https://img.shields.io/badge/donate-paypal-informational?logo=paypal)](https://paypal.me/dmnsgn)
[![coinbase](https://img.shields.io/badge/donate-coinbase-informational?logo=coinbase)](https://commerce.coinbase.com/checkout/56cbdf28-e323-48d8-9c98-7019e72c97f3)
[![twitter](https://img.shields.io/twitter/follow/dmnsgn?style=social)](https://twitter.com/dmnsgn)
[![bluesky](https://img.shields.io/badge/-blue?logo=bluesky&label=Follow%20%40dmnsgn.me&style=social)](https://bsky.app/profile/dmnsgn.me)

[![cameras screenshot](https://raw.githubusercontent.com/dmnsgn/cameras/main/screenshot.jpg)](https://dmnsgn.github.io/cameras/)


## Installation

```bash
npm install cameras
```

## Usage

See the [examples](https://dmnsgn.github.io/cameras/) and their [source](examples/).

```js
import { PerspectiveCamera, OrbitControls, PointerManager } from "cameras";

const camera = new PerspectiveCamera({ position: [3, 3, 3] });

const input = new PointerManager(canvas).enable();
const controls = new OrbitControls({
  lens: camera,
  position: [3, 3, 3],
  target: [0, 0, 0],
  dollyToCursor: true,
}).attach(input);

// Frame loop: dt in seconds
if (controls.update(dt)) {
  controls.applyTo(camera);
  camera.updateProjectionMatrix();
  camera.update();
}
// Render with camera.projectionMatrix and camera.viewMatrix
```

### Modules

Each module is also available as a subpath export, e.g. `cameras/controls`.

| Module             | Contents                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cameras/camera`   | `Camera`, `PerspectiveCamera`, `OrthographicCamera`, `projection`, `lens`: WebGPU depth by default, reversed-Z, infinite far, view offset, jitter, physical lens          |
| `cameras/input`    | `PointerManager` (mouse, pen, touch, wheel, trackpad pinch, Safari gestures, pointer lock), `KeyboardManager`, `wheel`, `pointers`, `modifiers`                           |
| `cameras/controls` | `OrbitControls`, `MapControls`, `FirstPersonControls`, `FlyControls`, `TrackballControls`, bases `Controls`, `TargetControls`, `SteeringControls`, `bindings`, `gestures` |
| `cameras/rigs`     | `Sequence` and camera moves, `RailRig`, `CraneRig`, `Switcher`, `PoseModifier`, `Composer`, `GroupFraming`, `FollowZoom`, `AutoFocus`, `Handheld`, `Shake`                |
| `cameras/core`     | `PoseSource`, `Emitter`, `pose`, `Spline`, math (spherical coordinates, angles, quaternions)                                                                              |

### Design

- **Input and controls are separate.** `PointerManager` turns DOM events into gestures and knows nothing about cameras. Controllers never touch the DOM: every action is also a method.
- **Controllers and rigs output a pose** (`position`, `target`, `up`, `orientation`, `zoom`, `fov`, `focusDistance`) applied to any camera through an adapter. They read a lens (`{ type, aspect, fov | size }`), which the camera classes satisfy.
- **`update(dt)` is synchronous and frame rate independent.** Damping uses closed-form critically damped springs. It returns whether the pose changed, for on-demand rendering. Events: `wake`, `update`, `rest`, plus `controlstart`, `control`, `controlend` and `transitionstart` for controllers.
- **Fling.** Releasing a fast drag coasts with the release velocity, decaying with an `inertia` half-life (iOS scroll deceleration rates for orbit, map and trackball, off for first person and fly). The coast distance is the same at any frame rate. `controlend` waits for it, and a new press interrupts it.
- **Cinematographic vocabulary**: arc, dolly, zoom, truck, pedestal, pan, tilt, roll, crane, rack focus, dolly zoom.

### Bindings

Gestures map to actions by key. The most specific key wins, modifiers fall back to the plain key and `null` disables one.

```js
controls.bindings["mouse:primary+shift"] = "truck-pedestal";
controls.bindings["wheel:trackpad"] = "truck-dolly";
controls.bindings["touch:2"] = ["dolly", "truck-pedestal", "twist"];
controls.bindings["mouse:secondary"] = null;
```

Keys: `mouse:primary|secondary|auxiliary|back|forward` (and chords like `mouse:primary+secondary`), `pen:*`, `touch:1|2|3`, `locked`, `wheel`, `wheel:mouse|trackpad`, `pinch`, with `+shift`, `+ctrl`, `+alt`, `+meta`.

### Rigs and modifiers

```js
import { Sequence, Composer, Shake } from "cameras";

const sequence = new Sequence({
  shots: [
    { shot: { position: [0, 8, 22], target: [0, 0, 0], fov: 0.9 }, hold: 1 },
    {
      shot: {
        position: [40, 2, 3],
        target: [40, 0, 0],
        fov: 0.5,
        focusDistance: 3,
      },
      duration: 4,
      move: "zoom-pan",
    },
  ],
}).play();

const composer = new Composer({ lens: camera, subject: () => player.position });
const shake = new Shake();
shake.addTrauma(0.5);

// Modifiers own their output pose: sources are never modified.
sequence.update(dt);
composer.update(sequence.pose, dt);
shake.update(composer.pose, dt);
shake.applyTo(camera);
```

`sequence.seek(time)` is deterministic, for offline renders driven by their own clock.

## API

See the [documentation](https://dmnsgn.github.io/cameras/docs).

## License

MIT. See [license file](https://github.com/dmnsgn/cameras/blob/main/LICENSE.md).
