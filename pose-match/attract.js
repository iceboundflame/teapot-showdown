// ── Attract mode ────────────────────────────────────────────────────
//
// The page opens straight into the demo, and after 10s without input
// on the start/results screens the teapot tumbles and drifts to draw
// booth passers-by. A timer-started demo dismisses on any interaction
// (mouse motion included); a deliberate one (page load, Esc) holds on
// until a click, key, or touch. Toggle lives in Game options.
// (The attract state object itself lives in state.js so setGameMode
// can consult it.)

import {
  ATTRACT_IDLE_MS, MODES, N_POSES, NEAR_FACTOR, tolDist, tolAngle,
  settings, attract, hasRotation, hasTranslation,
} from "./state.js";
import {
  movable, ghost, ghostMat, GHOST_OPACITY, movableMarker,
  resetMovable, seededRandom, generatePoses, _qTmp,
} from "./scene.js";

// setGameMode lives in main.js (it drives the mode chips / hint /
// panels); main.js hands it in via initAttract to avoid a cycle
let setGameMode = null;
export function initAttract(setGameModeFn) {
  setGameMode = setGameModeFn;
}

const chkAttract = document.getElementById("chk-attract");
chkAttract.checked = localStorage.getItem("pose-match-attract") !== "0"; // default on
chkAttract.addEventListener("change", () => {
  localStorage.setItem("pose-match-attract", chkAttract.checked ? "1" : "0");
  bumpActivity();
});

const ATTRACT_MOVE_MS = 2600;       // glide to the target
const ATTRACT_HOLD_MS = 700;        // "locked" flash before the next pose
const ATTRACT_POSES_PER_MODE = 3;   // then rotate to the next game mode

// make the demo start on the next frame instead of waiting out the
// idle timer; sticky entries ignore mouse motion (see listener below)
export function requestAttract(sticky = false) {
  attract.sticky = sticky;
  attract.lastActivity = performance.now() - ATTRACT_IDLE_MS;
}

export function bumpActivity() {
  attract.lastActivity = performance.now();
  if (attract.active) {
    attract.active = false;
    attract.sticky = false;
    document.body.classList.remove("attracting");
    ghost.visible = false;
    ghostMat.color.setHex(0xe2ddd3);
    ghostMat.opacity = GHOST_OPACITY;
    resetMovable();
    // hand the mode selector back to the user's real choice
    if (attract.savedMode && attract.savedMode !== settings.gameMode) {
      setGameMode(attract.savedMode);
    }
  }
}
for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) {
  addEventListener(ev, (e) => {
    // a deliberately-opened demo shrugs off mere mouse motion
    if (attract.active && attract.sticky
        && (e.type === "pointermove" || e.type === "wheel")) return;
    bumpActivity();
  }, { capture: true, passive: true });
}

function beginAttractMove(now) {
  attract.phase = "move";
  attract.phaseT0 = now;
  attract.from = { pos: movable.position.clone(), quat: movable.quaternion.clone() };
  const p = attract.poses[attract.index];
  ghost.position.copy(p.pos);
  ghost.quaternion.copy(p.quat);
  ghost.visible = true;
}

const easeInOut = (u) => u * u * (3 - 2 * u);

// self-playing demo of the selected mode: the ghost appears and the
// teapot glides onto it with the same tolerance feedback as real play
export function stepAttract(now) {
  if (!attract.active) {
    attract.active = true;
    attract.savedMode = settings.gameMode;
    attract.shown = 0;
    document.body.classList.add("attracting");
    attract.rng = seededRandom((Math.floor(now) % 100000) * 13 + 777);
    // start the demo on a random mode, not always the selected one
    setGameMode(MODES[Math.floor(attract.rng() * MODES.length)]);
    resetMovable();
    attract.poses = generatePoses(attract.rng, N_POSES);
    attract.index = 0;
    beginAttractMove(now);
  }
  const p = attract.poses[attract.index];
  if (attract.phase === "move") {
    const e = easeInOut(Math.min(1, (now - attract.phaseT0) / ATTRACT_MOVE_MS));
    movable.position.lerpVectors(attract.from.pos, p.pos, e);
    movable.quaternion.slerpQuaternions(attract.from.quat, p.quat, e);

    const dist = movable.position.distanceTo(p.pos);
    const dot = Math.min(1, Math.abs(_qTmp.copy(movable.quaternion).dot(p.quat)));
    const angle = 2 * Math.acos(dot);
    const distOk = !hasTranslation() || dist <= tolDist();
    const distNear = !hasTranslation() || dist <= tolDist() * NEAR_FACTOR;
    const angleOk = !hasRotation() || angle <= tolAngle();
    const angleNear = !hasRotation() || angle <= tolAngle() * NEAR_FACTOR;
    movableMarker.setColor(distOk ? 0x55b06a : distNear ? 0xc9a13f : 0xffffff);
    const ghostOk = hasRotation() ? angleOk : distOk;
    const ghostNear = hasRotation() ? angleNear : distNear;
    ghostMat.color.setHex(ghostOk ? 0x55b06a : ghostNear ? 0xc9a13f : 0xe2ddd3);

    if (e >= 1) {
      attract.phase = "hold";
      attract.phaseT0 = now;
      ghostMat.opacity = 0.95; // the dwell-lock flash
    }
  } else if (now - attract.phaseT0 >= ATTRACT_HOLD_MS) {
    ghostMat.color.setHex(0xe2ddd3);
    ghostMat.opacity = GHOST_OPACITY;
    attract.index += 1;
    attract.shown += 1;
    if (attract.shown % ATTRACT_POSES_PER_MODE === 0) {
      // rotate the demo (and the mode chips / leaderboard / graph
      // with it) to the next game mode
      setGameMode(MODES[(MODES.indexOf(settings.gameMode) + 1) % MODES.length]);
      resetMovable();
      attract.poses = generatePoses(attract.rng, N_POSES);
      attract.index = 0;
    } else if (attract.index >= attract.poses.length) {
      const last = attract.poses[attract.poses.length - 1];
      attract.poses.push(...generatePoses(attract.rng, N_POSES, last.pos, last.quat));
    }
    beginAttractMove(now);
  }
}
