// Game state machine: start/finish/cancel, per-frame match checking,
// session + leaderboard writes.

import {
  SESSIONS_KEY, LB_KEY, loadSessions, loadBoard,
} from "../lib/pose-match-shared.js";
import {
  N_POSES, PREVIEW_MS, DWELL_MS, NEAR_FACTOR, RESULTS_ARM_MS,
  tolDist, tolAngle,
  settings, ui, game, run, inPreview, hasRotation, hasTranslation,
} from "./state.js";
import {
  renderer, movable, ghost, ghostMat, GHOST_OPACITY, movableMarker,
  resetMovable, seededRandom, generatePoses, _qTmp,
} from "./scene.js";
import {
  renderBoard, renderClaimChips, renderMotionBars, renderStartPanels,
  lbRows, lbCompare,
} from "./boards.js";
import {
  oaClient, oaTags, engageRotatrix, releaseRotatrix, sendObjectState,
} from "./input-rotatrix.js";
import { bumpActivity } from "./attract.js";

const elTimer = document.getElementById("timer");
const elPoseCount = document.getElementById("pose-count");
const elDelta = document.getElementById("delta");
const overlayStart = document.getElementById("overlay-start");
const overlayResults = document.getElementById("overlay-results");
const elLbName = document.getElementById("lb-name");
const lbEntry = document.getElementById("lb-entry");

export function updateMovableVisibility() {
  movable.visible = !(ui.spaceHeld || (game.state === "running" && game.phase === "preview"));
}

// timed runs draw poses on demand from the same rng stream
function extendPoses() {
  const last = game.poses[game.poses.length - 1];
  game.poses.push(...generatePoses(game.rng, N_POSES, last.pos, last.quat));
}

export function startGame() {
  game.rng = seededRandom((Math.floor(performance.now()) % 100000) * 7 + 12345);
  game.poses = generatePoses(game.rng, N_POSES);
  game.index = 0;
  game.motions = [];
  game.dwellStart = null;
  game.startTime = performance.now();
  game.poseStartTime = game.startTime;
  game.state = "running";
  if (ui.inputMode === "rotatrix") {
    engageRotatrix();
    // fresh connects send tags via onStateChange; an already-open
    // connection needs the mode's tags pushed explicitly
    if (oaClient?.getState() === "connected") oaClient.sendTags(oaTags());
  }
  resetMovable();
  applyGhostPose();
  overlayStart.classList.add("hidden");
  overlayResults.classList.add("hidden");
  // hide the cursor only when the trackball is the input — its mouse
  // half would wander the screen distractingly. Mouse/spacemouse
  // players keep their cursor.
  document.body.classList.toggle("playing", ui.inputMode === "rotatrix");
  document.body.classList.add("ingame"); // shows the touch controls
  renderer.domElement.focus();
}

function snapPose(pos, quat) {
  return {
    t: pos.toArray().map((v) => +v.toFixed(4)),
    q: quat.toArray().map((v) => +v.toFixed(5)),
  };
}

function applyGhostPose() {
  const p = game.poses[game.index];
  ghost.position.copy(p.pos);
  ghost.quaternion.copy(p.quat);
  ghost.visible = true;
  // fresh target, fresh tint — a round can end (time-up, Esc) with the
  // ghost still tinted, and the preview phase never recolors it
  ghostMat.color.setHex(0xe2ddd3);
  ghostMat.opacity = GHOST_OPACITY;
  game.segmentFrom = snapPose(movable.position, movable.quaternion);

  // give a short look at the target first: teapot hidden, controls
  // off (essential in rot mode where the teapot sits right on top of
  // the ghost). The clock keeps running — see updateGame.
  game.phase = "preview";
  game.previewStart = performance.now();
  updateMovableVisibility();
}

function fmtTime(ms) {
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// "Click to play again" stays inert (and unadvertised) for a beat after
// the results go up — see returnToStart in main.js
let armTimer = null;
function armResults() {
  clearTimeout(armTimer);
  overlayResults.classList.remove("armed");
  armTimer = setTimeout(() => overlayResults.classList.add("armed"), RESULTS_ARM_MS);
}

function finishGame(now) {
  game.state = "done";
  game.doneAt = now;
  armResults();
  ghost.visible = false;
  document.body.classList.remove("playing", "ingame");
  if (ui.inputMode === "rotatrix") releaseRotatrix();
  const total = now - game.startTime;
  const score = game.motions.length;
  const lockMs = +game.motions.reduce((a, m) => a + m.ms, 0).toFixed(1);
  // a device-only game generates no pointer/key events, so without this
  // the results screen could flip straight into attract mode
  bumpActivity();

  document.getElementById("total").textContent = score
    ? `${score} match${score === 1 ? "" : "es"} in ${(lockMs / 1000).toFixed(1)}s`
    : "0 matches";

  // record every session, timed or not. The leaderboard entry (below)
  // shares this ts so the board is a rebuildable projection of the
  // sessions store (see lib/pose-match-shared.js)
  const sessionTs = Date.now();
  const sessions = loadSessions();
  sessions.push({
    ts: sessionTs,
    input: ui.inputMode,
    mode: settings.gameMode,
    tol: settings.tolLevel,
    limit: settings.timeLimit,
    total: +total.toFixed(1),
    motions: game.motions,
  });
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));

  // leaderboard: timed runs only. A qualifying score is saved
  // immediately with a blank name — walking away can't lose it — and
  // the name field is focused so typing + Enter fills it in.
  const entry = {
    name: "", poses: score,
    ms: lockMs,
    input: ui.inputMode, mode: settings.gameMode, tol: settings.tolLevel,
    limit: settings.timeLimit, ts: sessionTs,
  };
  const board = loadBoard();
  const ranked = [...lbRows(entry.ts), entry].sort(lbCompare);
  // every session lands in the board store (it mirrors the sessions
  // store 1:1)
  board.push(entry);
  localStorage.setItem(LB_KEY, JSON.stringify(board));
  // the name prompt only appears in booth mode, for runs that make the
  // board — a non-qualifier has no reason to type, and an Enter-through
  // would just pollute the data. No prefill for the same reason. On a
  // personal device there's nothing to claim, and skipping the prompt
  // also skips the focus() that pops the mobile keyboard.
  run.pendingScore = settings.booth && ranked.indexOf(entry) < 10 ? entry : null;
  run.lastRun = entry;
  elLbName.value = "";
  renderBoard(entry.ts);
  document.getElementById("lb-entry").classList.toggle("hidden", !run.pendingScore);
  renderClaimChips();
  renderMotionBars("result-bars");
  overlayResults.classList.remove("hidden");
  if (run.pendingScore) {
    elLbName.focus();
    elLbName.select();
  }
}

export function claimRun(name) {
  if (!run.lastRun) return;
  run.lastRun.name = name;
  const board = loadBoard();
  const entry = board.find((e) => e.ts === run.lastRun.ts);
  if (entry) entry.name = name;
  localStorage.setItem(LB_KEY, JSON.stringify(board));
  const sessions = loadSessions();
  const sess = sessions.find((x) => x.ts === run.lastRun.ts);
  if (sess) {
    sess.name = name;
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
  run.pendingScore = null;
  document.getElementById("lb-entry").classList.add("hidden");
  renderBoard(run.lastRun.ts);
  renderClaimChips();
}

// the entry is already on the board (blank name) — this just names it,
// and stamps the name onto the session record too so exports and
// rebuilds keep the attribution
export function saveLbName() {
  if (!run.pendingScore) return;
  const name = elLbName.value.trim().slice(0, 8);
  const board = loadBoard();
  const entry = board.find((e) => e.ts === run.pendingScore.ts);
  if (entry) entry.name = name;
  localStorage.setItem(LB_KEY, JSON.stringify(board));
  const sessions = loadSessions();
  const sess = sessions.find((x) => x.ts === run.pendingScore.ts);
  if (sess) {
    sess.name = name || undefined;
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
  renderBoard(run.pendingScore.ts);
  run.pendingScore = null;
  lbEntry.classList.add("hidden");
}

// ── Match checking ──────────────────────────────────────────────────

function poseError() {
  const target = game.poses[game.index];
  const dist = movable.position.distanceTo(target.pos);
  const dot = Math.min(1, Math.abs(_qTmp.copy(movable.quaternion).dot(target.quat)));
  const angle = 2 * Math.acos(dot);
  return { dist, angle };
}

export function updateGame(now) {
  if (game.state !== "running") return;

  elPoseCount.textContent = `${game.index} matched`;

  const clockText = (elapsed) => fmtTime(settings.timeLimit * 1000 - elapsed);

  if (game.phase === "preview") {
    // the clock keeps running through the preview (it counts toward
    // the round but never the pose)
    const previewElapsed = now - game.startTime;
    if (previewElapsed >= settings.timeLimit * 1000) {
      finishGame(now);
      return;
    }
    elTimer.textContent = clockText(previewElapsed);
    elDelta.textContent = "memorize the target…";
    elDelta.className = "delta";
    if (now - game.previewStart >= PREVIEW_MS) {
      // pose time starts when control returns, so motion medians never
      // include the preview
      game.poseStartTime = now;
      game.phase = "active";
      updateMovableVisibility();
      // discard whatever the host integrated during the preview
      if (ui.inputMode === "rotatrix") sendObjectState();
    }
    return;
  }

  const elapsed = now - game.startTime;
  if (elapsed >= settings.timeLimit * 1000) {
    // time's up — the in-progress motion is discarded
    finishGame(now);
    return;
  }
  elTimer.textContent = clockText(elapsed);

  const { dist, angle } = poseError();
  const distOk = !hasTranslation() || dist <= tolDist();
  const distNear = !hasTranslation() || dist <= tolDist() * NEAR_FACTOR;
  const angleOk = !hasRotation() || angle <= tolAngle();
  const angleNear = !hasRotation() || angle <= tolAngle() * NEAR_FACTOR;
  const within = distOk && angleOk;
  const near = distNear && angleNear;

  elDelta.textContent = "Δ " + [
    hasTranslation() ? `${dist.toFixed(2)}u` : null,
    hasRotation() ? `${(angle * 180 / Math.PI).toFixed(0)}°` : null,
  ].filter(Boolean).join("  ");
  elDelta.className = "delta" + (within ? " locked" : near ? " near" : "");

  // per-axis feedback: the solid teapot's ground marker tracks the
  // translation error; the ghost tint tracks rotation (falling back
  // to distance in translation-only mode, where the marker says the
  // same thing)
  movableMarker.setColor(distOk ? 0x55b06a : distNear ? 0xc9a13f : 0xffffff);
  const ghostOk = hasRotation() ? angleOk : distOk;
  const ghostNear = hasRotation() ? angleNear : distNear;

  if (within) {
    if (game.dwellStart === null) game.dwellStart = now;
    const frac = Math.min(1, (now - game.dwellStart) / DWELL_MS);
    ghostMat.color.setHex(0x55b06a);
    ghostMat.opacity = GHOST_OPACITY + (0.95 - GHOST_OPACITY) * frac;
    if (frac >= 1) {
      const p = game.poses[game.index];
      game.motions.push({
        from: game.segmentFrom,
        to: snapPose(p.pos, p.quat),
        ms: +(now - game.poseStartTime).toFixed(1),
      });
      game.poseStartTime = now;
      game.dwellStart = null;
      game.index += 1;
      if (game.index >= game.poses.length) extendPoses();
      applyGhostPose();
    }
  } else {
    game.dwellStart = null;
    ghostMat.color.setHex(ghostOk ? 0x55b06a : ghostNear ? 0xc9a13f : 0xe2ddd3);
    ghostMat.opacity = GHOST_OPACITY;
  }
}

// Esc aborts the run: nothing is recorded, back to the start screen
export function cancelGame() {
  if (game.state !== "running") return;
  game.state = "idle";
  ghost.visible = false;
  document.body.classList.remove("playing", "ingame");
  updateMovableVisibility();
  if (ui.inputMode === "rotatrix") releaseRotatrix();
  overlayResults.classList.add("hidden");
  overlayStart.classList.remove("hidden");
  renderStartPanels();
}
