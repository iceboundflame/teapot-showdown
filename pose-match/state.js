// Shared constants + cross-module mutable state for pose-match.
//
// ES module bindings are read-only for importers, so every value that
// more than one module mutates lives inside an exported object
// (settings / ui / game / run / attract) under its original variable
// name — modules mutate e.g. `ui.inputMode` instead of a shared `let`.

// ── Tunables ────────────────────────────────────────────────────────

export const N_POSES = 5;
// per-match look at the target: teapot hidden, controls off. The clock
// keeps running through it, so a round costs exactly timeLimit of wall
// time and the preview eats into it.
export const PREVIEW_MS = 200;
// match tolerance, selectable on the start screen (scales dist+angle)
export const TOL_LEVELS = { precise: 0.5, normal: 1, loose: 2 };
const BASE_TOL_DIST = 0.35;     // world units, at "normal"
const BASE_TOL_ANGLE = 12 * Math.PI / 180;
export const tolDist = () => BASE_TOL_DIST * TOL_LEVELS[settings.tolLevel];
export const tolAngle = () => BASE_TOL_ANGLE * TOL_LEVELS[settings.tolLevel];
export const DWELL_MS = 400;           // hold-in-tolerance time to lock a pose
export const NEAR_FACTOR = 2.5;        // "getting close" feedback threshold

// SpaceMouse translation speed: navlib derives translation velocity
// from how large it believes a world unit is. Raising this slows
// translation without touching rotation — the driver-native knob
// (per-frame delta scaling gets defeated by navlib's internal loop,
// which doesn't read our applied position back mid-motion).
export const SPACEMOUSE_UNITS_TO_METERS = 0.4; // was 0.1 (teapot bowl ≈ 20 cm)

// 'rot' (rotation only) | 'trans' (translation only) |
// '6dof' (rotation + translation)
export const MODES = ["rot", "trans", "6dof"];

// time limit in seconds — every game is timed
export const TIME_LIMITS = [20, 30, 45, 60];

export const MODE_SHORT = { rot: "rotation", trans: "translation", "6dof": "rotation + translation" };

export const ATTRACT_IDLE_MS = 10000;

// the results screen appears the instant the clock runs out, under a
// mouse that's still mid-play — ignore "play again" until the hands
// have caught up, so a stray click can't skip the name prompt
export const RESULTS_ARM_MS = 1200;

// ── Persisted settings ──────────────────────────────────────────────

// median-motion graph filter: 0 = all sessions, else keep only each
// device's fastest N% of sessions
const topPct = (() => {
  const v = +localStorage.getItem("pose-match-top-pct");
  return Number.isInteger(v) && v >= 0 && v < 100 ? v : 0;
})();

export const settings = {
  // booth mode: per-run name entry + staff claim chips. Off by default
  // — on a personal device the boards are all one player, so runs rank
  // unnamed and no keyboard ever pops up (attract mode is independent)
  booth: localStorage.getItem("pose-match-booth") === "1",
  gameMode: MODES.includes(localStorage.getItem("pose-match-mode"))
    ? localStorage.getItem("pose-match-mode")
    : "6dof",
  tolLevel: localStorage.getItem("pose-match-tol") in TOL_LEVELS
    ? localStorage.getItem("pose-match-tol")
    : "loose",
  timeLimit: TIME_LIMITS.includes(+localStorage.getItem("pose-match-limit"))
    ? +localStorage.getItem("pose-match-limit")
    : 30,
  topPct,
  lastTopN: topPct || 25, // remembered N while "All" is selected
  // graph-only player filter (exact name match, e.g. your own tag)
  graphPlayer: (localStorage.getItem("pose-match-graph-player") || "").trim(),
  // leaderboard range: today's competition or the all-time board
  lbRange: ["today", "all"].includes(localStorage.getItem("pose-match-lb-range"))
    ? localStorage.getItem("pose-match-lb-range")
    : "today",
  // mouse rotation style: one "Mouse" input button, the style is a setting.
  // Sessions still record mouse / mouse-holroyd separately for the stats.
  mouseRotType: ["tumbler", "trackball"].includes(localStorage.getItem("pose-match-mouserot"))
    ? localStorage.getItem("pose-match-mouserot")
    : "trackball",
};

export const lbRangeLabel = () => (settings.lbRange === "today" ? "today" : "all time");

export const hasRotation = () => settings.gameMode !== "trans";
export const hasTranslation = () => settings.gameMode !== "rot";

// ── Shared mutable state ────────────────────────────────────────────

// active input backend, chosen on the start screen
// (declared early: resetMovable runs at load and reads it)
export const ui = {
  inputMode: null,        // 'mouse' | 'mouse-holroyd' | 'touch' | 'spacemouse' | 'rotatrix'
  spaceHeld: false,       // spacebar peeks at the ghost by hiding the teapot
  startBoardHover: null,  // input group while hovering an input button
};

export const game = {
  state: "idle",        // idle | running | done
  poses: [],
  index: 0,
  startTime: 0,
  poseStartTime: 0,
  motions: [],          // {from:{t,q}, to:{t,q}, ms} per matched pose
  segmentFrom: null,    // teapot pose snapshot at segment start
  dwellStart: null,
  phase: "active",      // active | preview (rot mode: memorize the target)
  previewStart: 0,
  doneAt: 0,            // when the results screen went up (arming delay)
};

export function inPreview() {
  return game.state === "running" && game.phase === "preview";
}

// the just-finished run: pendingScore is the entry awaiting a name
// (top-10 runs only), lastRun the one the claim chips can attribute
export const run = { pendingScore: null, lastRun: null };

// attract-mode state lives up here so setGameMode can consult it
// (demo-driven mode switches must not persist); logic sits in attract.js
export const attract = {
  active: false, poses: [], index: 0, shown: 0,
  phase: "move", phaseT0: 0, from: null, rng: null, savedMode: null,
  lastActivity: performance.now(),
  // deliberate entry (page load / Esc): mouse motion doesn't dismiss,
  // only a click, key, or touch. Timer entry stays motion-dismissable.
  sticky: false,
};

// stop a click from bubbling to the results overlay (which reads any
// click as "play again")
export const stopProp = (e) => e.stopPropagation();

// ── Backend status pill ─────────────────────────────────────────────

export const pillInput = document.getElementById("pill-input");

// last-known status per backend so switching restores the right pill
export const backendStatus = {
  // plain "mouse" is tumbler in rot/6dof but also the merged trans-mode
  // recording, so its pill stays variant-free
  mouse: { text: "input: Mouse", cls: "pill" },
  "mouse-holroyd": { text: "input: Mouse (trackball)", cls: "pill" },
  touch: { text: "input: Touch", cls: "pill" },
  spacemouse: { text: "3Dconnexion: not initialized", cls: "pill" },
  rotatrix: { text: "OpenAxis: not initialized", cls: "pill" },
};

export function setBackendStatus(backend, text, cls) {
  backendStatus[backend] = { text, cls };
  if (ui.inputMode === backend) {
    pillInput.textContent = text;
    pillInput.className = cls;
  }
  // availability probes listen for these (input button graying)
  dispatchEvent(new CustomEvent("backend-status", { detail: { backend, cls } }));
}
