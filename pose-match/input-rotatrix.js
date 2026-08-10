// ── Rotatrix: OpenAxis server-side navigation (3D services style) ──
//
// Same pattern as 3d-services.html object mode: on motion start the
// host asks for what it needs (object.pose / object.pivot), we send
// absolute state, and the host streams back absolute object poses.

import * as THREE from "three";
import { OpenAxisClient, manageFocus } from "../lib/openaxis-client/index.js";
import {
  settings, ui, hasRotation, hasTranslation, inPreview, setBackendStatus,
} from "./state.js";
import { renderer, camera, movable, bowlPivotWorld } from "./scene.js";
import { bumpActivity } from "./attract.js";

const chkLefthand = document.getElementById("chk-lefthand");

// ── Conversion helpers ──────────────────────────────────────────────

export function threeQuatToRotvec(q) {
  const sinHalf = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z);
  if (sinHalf < 1e-8) return [0, 0, 0];
  const angle = 2 * Math.atan2(sinHalf, q.w);
  const s = angle / sinHalf;
  return [q.x * s, q.y * s, q.z * s];
}

export function rotvecToThreeQuat(rv) {
  const angle = Math.sqrt(rv[0] * rv[0] + rv[1] * rv[1] + rv[2] * rv[2]);
  if (angle < 1e-8) return new THREE.Quaternion(0, 0, 0, 1);
  const half = angle / 2;
  const s = Math.sin(half) / angle;
  return new THREE.Quaternion(rv[0] * s, rv[1] * s, rv[2] * s, Math.cos(half));
}

// ── Client state ────────────────────────────────────────────────────

// oaClient is assigned once in initRotatrix; importers read it through
// the live module binding (they never assign it)
export let oaClient = null;
let oaFm = null;

// in translation-only mode the extra "translate" tag lets the host
// profile lock rotation server-side.
// app.teapot_showdown activates the game's own profile (see
// rotatrix-profile.yaml); object selects its Object binding.
export function oaTags() {
  const tags = ["app.teapot_showdown", "object"];
  if (settings.gameMode === "trans") tags.push("translate");
  if (chkLefthand.checked) tags.push("lefthand");
  return tags;
}

// hard-override the host's object pose to match the teapot. The tags
// stay untouched all game (dropping "object" would release the ball
// back to the mouse cursor mid-game — distracting), so whenever we
// ignore the host's stream (the memorize preview) or move the teapot
// ourselves (reset), we re-anchor its integrator with an absolute
// pose instead — otherwise the next accepted update would teleport
// the teapot by the accumulated difference.
// poses the host emitted before processing our override are still in
// flight when it's sent; until one arrives near the anchor (or the
// deadline passes), incoming far-away poses are stale and dropped
let oaResync = null; // {t, q, deadline}

export function sendObjectState() {
  if (!oaClient || oaClient.getState() !== "connected") return;
  const rv = threeQuatToRotvec(movable.quaternion);
  const p = movable.position;
  oaClient.sendObjectPose([p.x, p.y, p.z], rv, "absolute");
  oaClient.sendObjectPivot(bowlPivotWorld().toArray());
  oaResync = {
    t: movable.position.clone(),
    q: movable.quaternion.clone(),
    deadline: performance.now() + 250,
  };
}

// release the device between games so the Rotatrix host hands the
// trackball back to mouse duty while the results screen is up
export function releaseRotatrix() {
  if (!oaClient) return;
  oaFm?.stop(); // else its focus handler would auto-reconnect
  oaClient.disconnect();
}

export function engageRotatrix() {
  if (!oaClient) {
    initRotatrix();
    return;
  }
  oaFm?.start();
  if (oaClient.getState() === "disconnected") {
    oaClient.connect().catch(() => {});
  }
}

// plain ws to localhost is blocked from https origins (github.io), so
// there we lead with the Rotatrix app's Local HTTPS listener (wss
// :6609, enabled under Integrations); the client falls back to the
// other URL either way
const OA_URLS = location.protocol === "https:"
  ? ["wss://localhost:6609", "ws://localhost:6607"]
  : ["ws://localhost:6607", "wss://localhost:6609"];

// availability probe for the start screen: a bare socket open/close.
// No hello and no tags are sent, so the host activates no profile —
// the ball stays a mouse.
export function probeRotatrix(timeoutMs = 1200) {
  const tryUrl = (url) => new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch { resolve(false); return; }
    const timer = setTimeout(() => { ws.close(); resolve(false); }, timeoutMs);
    ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(timer); resolve(false); };
  });
  return Promise.all(OA_URLS.map(tryUrl)).then((r) => r.some(Boolean));
}

export function initRotatrix() {
  if (oaClient) return;
  setBackendStatus("rotatrix", "OpenAxis: connecting…", "pill");

  oaClient = new OpenAxisClient({
    clientName: "teapot-showdown",
    urls: OA_URLS,
    tags: oaTags(),
    capabilities: ["3d"],
  }, {
    onStateChange(state) {
      setBackendStatus(
        "rotatrix",
        `OpenAxis: ${state}`,
        state === "connected" ? "pill ok" : "pill err",
      );
      if (state === "connected") {
        oaClient.sendWorldOrientation([0, 0, -1], [0, 1, 0], "right");
        oaClient.sendTranslationScale("viewport");
        oaClient.sendNavigationPreferences(true);
        oaClient.sendTags(oaTags());
      }
    },

    onMotionStart(need) {
      for (const item of need) {
        switch (item) {
          case "camera.pose": {
            const rv = threeQuatToRotvec(camera.quaternion);
            const p = camera.position;
            oaClient.sendCameraPose([p.x, p.y, p.z], rv, "absolute", camera.fov * Math.PI / 180);
            break;
          }
          case "camera.pivot":
            oaClient.sendCameraPivot(bowlPivotWorld().toArray());
            break;
          case "object.pose": {
            const rv = threeQuatToRotvec(movable.quaternion);
            const p = movable.position;
            oaClient.sendObjectPose([p.x, p.y, p.z], rv, "absolute");
            break;
          }
          case "object.pivot":
            oaClient.sendObjectPivot(bowlPivotWorld().toArray());
            break;
        }
      }
    },

    onMotionEnd() {},

    onCameraPose() {
      // camera is fixed in this game; the object profile shouldn't
      // send these, but ignore them if it does
    },
    onCameraPivot() {},

    onObjectPose(pose) {
      if (ui.inputMode !== "rotatrix" || inPreview()) return;
      bumpActivity(); // trackball motion is user presence, same as the mouse
      const q = rotvecToThreeQuat(pose.r);
      if (oaResync) {
        if (performance.now() > oaResync.deadline) {
          oaResync = null; // fail-safe: never gate input for long
        } else {
          const farT = hasTranslation() &&
            Math.hypot(pose.t[0] - oaResync.t.x, pose.t[1] - oaResync.t.y, pose.t[2] - oaResync.t.z) > 0.3;
          const farR = hasRotation() &&
            2 * Math.acos(Math.min(1, Math.abs(q.dot(oaResync.q)))) > 20 * Math.PI / 180;
          if (farT || farR) return; // stale pre-override pose
          oaResync = null; // host has caught up
        }
      }
      if (hasRotation()) movable.quaternion.copy(q);
      if (hasTranslation()) movable.position.set(pose.t[0], pose.t[1], pose.t[2]);
    },
    onObjectPivot() {},

    onError(code, message) {
      console.error(`[pose-match] OpenAxis error: ${code} — ${message}`);
    },
  });

  oaFm = manageFocus(oaClient, {});
  renderer.domElement.addEventListener("click", () => oaFm?.resume());
}
