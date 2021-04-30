// General
// Camera
export let CameraType;

(function (CameraType) {
  CameraType[CameraType["Camera"] = 0] = "Camera";
  CameraType[CameraType["Perspective"] = 1] = "Perspective";
  CameraType[CameraType["Orthographic"] = 2] = "Orthographic";
})(CameraType || (CameraType = {}));

export let ControlsActions; // PointerManager

(function (ControlsActions) {
  ControlsActions["Rotate"] = "Rotate";
  ControlsActions["RotatePolar"] = "RotatePolar";
  ControlsActions["RotateAzimuth"] = "RotateAzimuth";
  ControlsActions["Dolly"] = "Dolly";
  ControlsActions["Zoom"] = "Zoom";
})(ControlsActions || (ControlsActions = {}));

export let PointerManagerState;

(function (PointerManagerState) {
  PointerManagerState["Idle"] = "Idle";
  PointerManagerState["MouseWheel"] = "MouseWheel";
  PointerManagerState["MouseLeft"] = "MouseLeft";
  PointerManagerState["MouseMiddle"] = "MouseMiddle";
  PointerManagerState["MouseRight"] = "MouseRight";
  PointerManagerState["TouchOne"] = "TouchOne";
  PointerManagerState["TouchTwo"] = "TouchTwo";
  PointerManagerState["TouchThree"] = "TouchThree";
})(PointerManagerState || (PointerManagerState = {}));