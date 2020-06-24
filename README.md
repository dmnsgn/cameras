# cameras [![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

[![npm version](https://badge.fury.io/js/cameras.svg)](https://www.npmjs.com/package/cameras)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

Cameras for 3D rendering.

![](https://raw.githubusercontent.com/dmnsgn/cameras/master/screenshot.jpg)

See the [demo](https://dmnsgn.github.io/cameras/) and its [source](demo.js) for a usage example.

## Installation

```bash
npm install cameras
```

[![NPM](https://nodei.co/npm/cameras.png)](https://nodei.co/npm/cameras/)

## Usage

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

See the [Typescript types](src/types.d.ts) for options (PerspectiveCameraOptions, OrthographicCameraOptions, ControlsOptions).

## License

MIT. See [license file](https://github.com/dmnsgn/cameras/blob/master/LICENSE.md).
