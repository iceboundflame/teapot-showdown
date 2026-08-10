// ── SpaceMouse: 3DconnexionJS (3D services via local NL-Proxy) ─────
//
// Callback contract mirrors the official web_threejs.html sample,
// with one twist: navlib always navigates the *view*, so we hand it
// a phantom camera. Each view-matrix update it sends is converted
// into a delta and applied to the teapot instead; the real render
// camera never moves. navlib re-reads view.affine at every motion
// start, so the phantom re-anchors to the real camera and cannot
// drift between motions.

import * as THREE from "three";
import {
  SPACEMOUSE_UNITS_TO_METERS, settings, ui, inPreview, setBackendStatus,
} from "./state.js";
import { renderer, camera, movable, bowlPivotWorld, rotateMovable } from "./scene.js";
import { bumpActivity } from "./attract.js";

const chkInvert = document.getElementById("chk-invert");

// Pointer tracking for navlib getPointerPosition
let mouseX = 0, mouseY = 0;
addEventListener("mousemove", (e) => { mouseX = e.pageX; mouseY = e.pageY; });

let phantomView = null; // Matrix4 navlib last wrote during this motion

export const nav = {
  animating: false,
  controller: null,

  // -- coordinate system: X right, Y up, Z out of screen (column major)
  getCoordinateSystem() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  },

  getFrontView() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  },

  // navlib navigates the phantom camera, which drifts from the real
  // one during a motion — but its translation speed scales with the
  // distance from ITS camera to the scene. Reporting all geometry
  // translated by the drift keeps the camera↔scene relationship
  // navlib perceives identical to the one on screen (a virtual world
  // rigidly attached to the phantom). The body-frame delta replay in
  // setViewMatrix maps motion in that shifted world back to the real
  // scene exactly.
  phantomShift() {
    if (!phantomView) return new THREE.Vector3();
    return new THREE.Vector3().setFromMatrixPosition(phantomView)
      .sub(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld));
  },

  getConstructionPlane() {
    return [0, 1, 0, -nav.phantomShift().y]; // y = 0 ground plane
  },

  getFloorPlane() {
    return [0, 1, 0, -nav.phantomShift().y];
  },

  getUnitsToMeters() {
    return SPACEMOUSE_UNITS_TO_METERS;
  },

  getPerspective() {
    return true;
  },

  getViewRotatable() {
    return true;
  },

  // diagonal fov in radians (three.js fov is vertical, degrees)
  getFov() {
    const v = camera.fov * Math.PI / 180;
    return 2 * Math.atan(Math.tan(v / 2) * Math.sqrt(1 + camera.aspect * camera.aspect));
  },

  setFov() {
    // camera is fixed in this game; ignore navlib fov changes
  },

  getViewMatrix() {
    camera.updateMatrixWorld();
    return (phantomView ?? camera.matrixWorld).toArray();
  },

  setViewMatrix(data) {
    if (ui.inputMode !== "spacemouse") return;
    bumpActivity(); // cap deflection is user presence, same as the mouse
    const newM = new THREE.Matrix4().fromArray(data);
    const oldInv = (phantomView ?? camera.matrixWorld).clone().invert();
    phantomView = newM; // keep tracking even when gated, so no jump later
    if (inPreview()) return;

    // navlib's motion is relative to the phantom camera, whose frame
    // diverges from the render camera as rotation accumulates within
    // a motion. Take the delta in the phantom's own body frame, then
    // replay it through the fixed render camera's frame so that cap
    // directions always match what the player sees.
    const local = oldInv.multiply(newM); // body-frame delta
    const delta = camera.matrixWorld.clone()
      .multiply(local)
      .multiply(camera.matrixWorld.clone().invert());

    // camera moving one way looks like the object moving the other;
    // which sign feels right depends on the driver's camera/object
    // mode setting, hence the invert toggle
    if (!chkInvert.checked) delta.invert();

    if (settings.gameMode === "rot") {
      // rotation-only: apply just the rotational part, about the bowl
      rotateMovable(new THREE.Quaternion().setFromRotationMatrix(delta));
      return;
    }
    if (settings.gameMode === "trans") {
      // translation-only: move the origin, leave orientation alone
      movable.position.applyMatrix4(delta);
      return;
    }

    movable.updateMatrixWorld();
    delta.multiply(movable.matrixWorld)
      .decompose(movable.position, movable.quaternion, movable.scale);
    movable.scale.set(1, 1, 1);
  },

  getViewFrustum() {
    const tanHalf = Math.tan(camera.fov * Math.PI / 360);
    const bottom = -camera.near * tanHalf;
    const left = bottom * camera.aspect;
    return [left, -left, bottom, -bottom, camera.near, camera.far];
  },

  getViewExtents() {
    return null; // perspective only
  },
  setViewExtents() {},

  // movable only: the ghost is a target marker, not part of the model.
  // Including it drags the extents center (the driver's auto-pivot
  // fallback) to the midpoint between the two teapots, so rotations
  // pivot outside the pot when the driver ignores pivot.position.
  getModelExtents() {
    const box = new THREE.Box3().setFromObject(movable);
    box.translate(nav.phantomShift());
    return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
  },

  // rotations pivot about the center of the teapot's bowl
  getPivotPosition() {
    return bowlPivotWorld().add(nav.phantomShift()).toArray();
  },

  // the driver writes back the pivot it actually chose (auto-pivot);
  // log it so a mismatch with the bowl center is visible in devtools
  setPivotPosition(data) {
    console.log("[pose-match] navlib pivot:", data,
      "bowl:", bowlPivotWorld().add(nav.phantomShift()).toArray());
  },
  setPivotVisible() {},

  getSelectionEmpty() {
    return true;
  },

  // -- hit testing ---------------------------------------------------
  look: {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    aperture: 0.01,
    selection: false,
  },
  setLookFrom(data) { nav.look.origin.set(data[0], data[1], data[2]); },
  setLookDirection(data) { nav.look.direction.set(data[0], data[1], data[2]); },
  setLookAperture(data) { nav.look.aperture = data; },
  setSelectionOnly(data) { nav.look.selection = data; },

  getLookAt() {
    // navlib's ray lives in its shifted world — bring it back to the
    // real scene, raycast, and return the hit in navlib coordinates
    const shift = nav.phantomShift();
    const raycaster = new THREE.Raycaster(
      nav.look.origin.clone().sub(shift), nav.look.direction, camera.near, camera.far);
    // movable only: an auto-pivot hit test that lands on the ghost
    // would put the rotation center on the wrong teapot
    const hits = raycaster.intersectObjects([movable]);
    if (hits.length > 0) return hits[0].point.add(shift).toArray();
    return null;
  },

  getPointerPosition() {
    const rect = renderer.domElement.getBoundingClientRect();
    const pos = new THREE.Vector3(
      ((mouseX - rect.left) / rect.width) * 2 - 1,
      -((mouseY - rect.top) / rect.height) * 2 + 1,
      -1,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    pos.unproject(camera);
    return pos.add(nav.phantomShift()).toArray();
  },

  // -- frame / motion lifecycle --------------------------------------
  setTransaction() {},

  onStartMotion() {
    nav.animating = true;
    phantomView = null; // re-anchor the phantom camera
  },

  onStopMotion() {
    nav.animating = false;
    phantomView = null;
    // the pot now rests somewhere new; refresh the driver's pivot in
    // case it caches across motions instead of re-reading at start
    nav.pushPivot();
  },

  setActiveCommand() {},
  setSettingsChanged() {},

  // -- pivot push -----------------------------------------------------
  // The driver reads pivot.position at motion start and not again, so
  // a teleport (new game, R reset) with the cap still deflected leaves
  // it rotating about the teapot's old spot. Push the fresh pivot
  // instead of waiting for the next motion start to be asked.
  pushPivot() {
    if (!nav.controller) return;
    nav.controller.update3dcontroller({
      pivot: { position: bowlPivotWorld().add(nav.phantomShift()).toArray() },
    });
  },

  // -- connection lifecycle ------------------------------------------
  onConnect() {
    setBackendStatus("spacemouse", "3Dconnexion: connected", "pill ok");
    nav.controller.create3dmouse(renderer.domElement, "OpenAxis Teapot Showdown");
  },

  on3dmouseCreated() {
    setBackendStatus("spacemouse", "3Dconnexion: 3D mouse ready", "pill ok");
    // we drive frame timing from our RAF loop
    nav.controller.update3dcontroller({ frame: { timingSource: 1 } });
  },

  onDisconnect(reason) {
    setBackendStatus("spacemouse", "3Dconnexion: disconnected", "pill err");
    console.log("[pose-match] NL-Proxy disconnected:", reason);
  },
};

export async function initSpaceMouse() {
  if (nav.controller) return;
  setBackendStatus("spacemouse", "3Dconnexion: loading SDK…", "pill");
  await window._3dxReady;
  if (nav.controller) return; // double-click race
  if (typeof _3Dconnexion === "undefined") {
    setBackendStatus("spacemouse", "3Dconnexion: SDK not loaded", "pill err");
    return;
  }
  nav.controller = new _3Dconnexion(nav);
  setBackendStatus("spacemouse", "3Dconnexion: connecting…", "pill");
  if (!nav.controller.connect()) {
    setBackendStatus("spacemouse", "3Dconnexion: driver not found", "pill err");
  }
}
