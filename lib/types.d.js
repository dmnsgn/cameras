export let CameraType;

(function (CameraType) {
  CameraType[CameraType["Camera"] = 0] = "Camera";
  CameraType[CameraType["Perspective"] = 1] = "Perspective";
  CameraType[CameraType["Orthographic"] = 2] = "Orthographic";
})(CameraType || (CameraType = {}));