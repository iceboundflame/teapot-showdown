// ── Mouse fallback controls (always active) ─────────────────────────

import * as THREE from "three";
import { settings, ui, game, inPreview, hasRotation, hasTranslation } from "./state.js";
import { renderer, camera, movable, bowlPivotWorld, rotateMovable } from "./scene.js";

const chkRevWheel = document.getElementById("chk-revwheel");

const ROT_SPEED = 0.011;
const PAN_SPEED = 0.006;
let dragging = false;
let rightBtn = false;
let panning = false;
let lastX = 0, lastY = 0;

// ── Holroyd virtual trackball ───────────────────────────────────────
//
// Control surface: unit sphere for d < r/√2, hyperbolic sheet
// z = r²/2d outside (C1-continuous), so it stays smooth across the
// rim and dragging around the rim gives pure roll. Path-independent:
// the rotation is recomputed from the drag-START point to the current
// point and applied to the drag-start orientation, so a closed-loop
// drag returns the teapot to where it began. Ball is centered on the
// projected bowl pivot, sized to the teapot's apparent radius.

let hDrag = null; // anchor state for the active Holroyd drag

// angle multiplier: 1 = true grab correspondence (slow), 2 = Shoemake's
// classic arcball rate; path independence holds at any value
const HOLROYD_GAIN = 2.0;

function holroydVec(px, py, center, radius) {
  const u = (px - center[0]) / radius;
  const v = (center[1] - py) / radius; // screen y is down
  const d2 = u * u + v * v;
  const z = d2 <= 0.5 ? Math.sqrt(1 - d2) : 1 / (2 * Math.sqrt(d2));
  return new THREE.Vector3(u, v, z).normalize();
}

function beginHolroydDrag(e) {
  const pivot = bowlPivotWorld();
  const ndc = pivot.clone().project(camera);
  const center = [(ndc.x + 1) / 2 * innerWidth, (1 - ndc.y) / 2 * innerHeight];
  const dist = camera.position.distanceTo(pivot);
  const pxPerUnit = (innerHeight / 2) / (dist * Math.tan(camera.fov * Math.PI / 360));
  const radius = THREE.MathUtils.clamp(
    2.2 * pxPerUnit, 90, 0.45 * Math.min(innerWidth, innerHeight));
  hDrag = {
    center,
    radius,
    pivot,
    v0: holroydVec(e.clientX, e.clientY, center, radius),
    quat0: movable.quaternion.clone(),
    pos0: movable.position.clone(),
  };
}

function holroydMove(px, py) {
  const v1 = holroydVec(px, py, hDrag.center, hDrag.radius);
  const axis = new THREE.Vector3().crossVectors(hDrag.v0, v1);
  if (axis.lengthSq() < 1e-14) return;
  const angle = HOLROYD_GAIN * Math.acos(THREE.MathUtils.clamp(hDrag.v0.dot(v1), -1, 1));
  axis.normalize().applyQuaternion(camera.quaternion); // view → world
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  movable.quaternion.copy(q).multiply(hDrag.quat0);
  movable.position.copy(hDrag.pos0)
    .sub(hDrag.pivot).applyQuaternion(q).add(hDrag.pivot);
}

// mouse control only drives the teapot in the mouse input modes — a
// spacemouse/rotatrix run must not be assisted by stray drags.
// "touch" is the mouse family recorded under its own name; its
// rotation style comes straight from the setting
const isMouseInput = () =>
  ui.inputMode === "mouse" || ui.inputMode === "mouse-holroyd" || ui.inputMode === "touch";
const useHolroyd = () =>
  ui.inputMode === "mouse-holroyd"
  || (ui.inputMode === "touch" && settings.mouseRotType === "trackball");

// ── Touch gestures ──────────────────────────────────────────────────
//
// One finger rotates (pans in translation-only mode). Two fingers pan
// with the centroid and drive depth with the pinch distance — the
// touch equivalents of shift-drag and the wheel. Every finger change
// re-anchors the active gesture so nothing jumps; pen counts as touch.

const touches = new Map(); // pointerId -> {x, y}
let pinchDist = 0;         // baseline finger spread for depth

const isTouch = (e) => e.pointerType !== "mouse";

// world units per CSS px at the teapot's depth, so touch translation
// tracks the finger 1:1 on screen regardless of viewport size (the
// fixed PAN_SPEED is a desktop mouse gain and undershoots on phones)
function worldPerPx() {
  const dist = camera.position.distanceTo(movable.position);
  return (2 * dist * Math.tan(camera.fov * Math.PI / 360)) / innerHeight;
}

function touchSpread() {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function anchorTouch() {
  hDrag = null;
  if (touches.size === 1 && hasRotation() && useHolroyd()) {
    const [t] = touches.values();
    beginHolroydDrag({ clientX: t.x, clientY: t.y });
  } else if (touches.size === 2) {
    pinchDist = touchSpread();
  }
}

function touchMove(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  const px = t.x, py = t.y;
  t.x = e.clientX;
  t.y = e.clientY;
  if (game.state !== "running" || inPreview()) return;

  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

  if (touches.size === 1) {
    if (!hasRotation()) {
      // translation-only: one finger pans
      if (!hasTranslation()) return;
      const wpp = worldPerPx();
      movable.position.addScaledVector(camRight, (t.x - px) * wpp);
      movable.position.addScaledVector(camUp, -(t.y - py) * wpp);
    } else if (useHolroyd()) {
      if (hDrag) holroydMove(t.x, t.y);
    } else {
      const q = new THREE.Quaternion()
        .setFromAxisAngle(camUp, (t.x - px) * ROT_SPEED)
        .multiply(new THREE.Quaternion().setFromAxisAngle(camRight, (t.y - py) * ROT_SPEED));
      rotateMovable(q);
    }
    return;
  }

  // two fingers. One finger's delta moves the centroid by half of it,
  // so halving gives exact centroid-following pan
  if (!hasTranslation()) return;
  const wpp = worldPerPx();
  movable.position.addScaledVector(camRight, (t.x - px) / 2 * wpp);
  movable.position.addScaledVector(camUp, -(t.y - py) / 2 * wpp);
  // spreading the fingers pulls the teapot toward the camera, at the
  // same screen-matched rate as the pan
  const d = touchSpread();
  const camFwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
  movable.position.addScaledVector(camFwd, -(d - pinchDist) * wpp);
  pinchDist = d;
}

renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (!isMouseInput()) return;
  if (isTouch(e)) {
    if (touches.size >= 2) return; // ignore fingers beyond the second
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    renderer.domElement.setPointerCapture(e.pointerId);
    anchorTouch();
    return;
  }
  dragging = true;
  rightBtn = e.button === 2;
  // translation-only mode: plain drag translates
  panning = rightBtn || e.shiftKey || !hasRotation();
  lastX = e.clientX;
  lastY = e.clientY;
  if (!panning && useHolroyd()) beginHolroydDrag(e);
  renderer.domElement.setPointerCapture(e.pointerId);
});
function endPointer(e) {
  if (isTouch(e)) {
    if (touches.delete(e.pointerId)) anchorTouch();
    return;
  }
  dragging = false;
  hDrag = null;
}
renderer.domElement.addEventListener("pointerup", endPointer);
// the browser can still cancel a captured pointer (incoming call,
// system gesture) — treat it as the finger lifting
renderer.domElement.addEventListener("pointercancel", endPointer);
renderer.domElement.addEventListener("pointermove", (e) => {
  if (isTouch(e)) {
    touchMove(e);
    return;
  }
  if (!dragging || game.state !== "running" || inPreview()) return;
  // shift can flip pan <-> rotate mid-drag; the trackball re-anchors
  // at the current pointer position when rotation resumes
  const wantPan = rightBtn || e.shiftKey || !hasRotation();
  if (wantPan !== panning) {
    panning = wantPan;
    hDrag = null;
    if (!panning && useHolroyd()) beginHolroydDrag(e);
  }
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

  if (panning) {
    if (!hasTranslation()) return;
    movable.position.addScaledVector(camRight, dx * PAN_SPEED);
    movable.position.addScaledVector(camUp, -dy * PAN_SPEED);
  } else if (!hasRotation()) {
    // translation-only: drag-rotate disabled
  } else if (useHolroyd()) {
    if (hDrag) holroydMove(e.clientX, e.clientY);
  } else {
    const q = new THREE.Quaternion()
      .setFromAxisAngle(camUp, dx * ROT_SPEED)
      .multiply(new THREE.Quaternion().setFromAxisAngle(camRight, dy * ROT_SPEED));
    rotateMovable(q);
  }
});
renderer.domElement.addEventListener("wheel", (e) => {
  if (!isMouseInput() || game.state !== "running" || !hasTranslation() || inPreview()) return;
  e.preventDefault();
  const camFwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
  const dir = chkRevWheel.checked ? -1 : 1;
  // shift+wheel: browsers remap the delta to deltaX, but shift is our
  // pan modifier and scrolling mid-pan should still drive depth
  const delta = e.deltaY || (e.shiftKey ? e.deltaX : 0);
  movable.position.addScaledVector(camFwd, delta * 0.004 * dir);
}, { passive: false });
