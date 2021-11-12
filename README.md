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

Cameras for 3D rendering.

[![paypal](https://img.shields.io/badge/donate-paypal-informational?logo=paypal)](https://paypal.me/dmnsgn)
[![coinbase](https://img.shields.io/badge/donate-coinbase-informational?logo=coinbase)](https://commerce.coinbase.com/checkout/56cbdf28-e323-48d8-9c98-7019e72c97f3)
[![twitter](https://img.shields.io/twitter/follow/dmnsgn?style=social)](https://twitter.com/dmnsgn)

![](https://raw.githubusercontent.com/dmnsgn/cameras/master/screenshot.jpg)

## Installation

```bash
npm install cameras
```

## Usage

See the [demo](https://dmnsgn.github.io/cameras/) and its [source](index.html).

```js
import { PerspectiveCamera } from "cameras";

const perspectiveCamera = new PerspectiveCamera({
  fov: Math.PI / 2,
  near: 1,
  far: 1000,
  position: [3, 3, 3],
  target: [0, 1, 0],
});

// Create controls
const perspectiveCameraControls = new Controls({
  element: regl._gl.canvas,
  camera: perspectiveCamera,
});

// Update controls and set camera with controls position/target
perspectiveCameraControls.update();
perspectiveCamera.position = perspectiveCameraControls.position;
perspectiveCamera.target = perspectiveCameraControls.target;

// Update view matrices (call when changing position/target/up)
perspectiveCamera.update();

// Update projection matrix  (call when changing near/far/view and other camera type specific options)
perspectiveCamera.updateProjectionMatrix();
```

## API

See the [documentation](https://dmnsgn.github.io/cameras/docs) and [Typescript types](src/types.ts).

## License

MIT. See [license file](https://github.com/dmnsgn/cameras/blob/main/LICENSE.md).
