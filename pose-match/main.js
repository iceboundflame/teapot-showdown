// Entry point: overlay/chip/keyboard wiring and the render loop.
// Import order matters only for the modules with top-level side
// effects (scene builds the renderer, input-mouse/attract register
// listeners); everything stateful goes through state.js.

import {
  ATTRACT_IDLE_MS, RESULTS_ARM_MS, settings, ui, game, attract, hasTranslation,
  backendStatus, pillInput, stopProp,
} from "./state.js";
import {
  scene, renderer, camera, cameraFovForAspect, movable, ghost, movableMarker,
  ghostMarker, updateGroundMarker, resetMovable,
} from "./scene.js";
import {
  startGame, cancelGame, updateGame, updateMovableVisibility, saveLbName,
} from "./game.js";
import { renderStartPanels, renderStartBoard, lbGroup } from "./boards.js";
import "./input-mouse.js";
import { nav, initSpaceMouse } from "./input-spacemouse.js";
import { oaClient, oaTags, releaseRotatrix, probeRotatrix } from "./input-rotatrix.js";
import { initAttract, stepAttract, requestAttract } from "./attract.js";
import {
  registerModal, openModal, toggleModal, closeModal, activeModal,
} from "./modal.js";

// coarse-pointer devices get touch affordances (CSS hooks + hint copy)
const touchUI = matchMedia("(pointer: coarse)").matches;
if (touchUI) {
  document.body.classList.add("touch");
  // same input path, honest name: fingers aren't a mouse
  document.querySelector('[data-input="mouse"] .input-label').textContent = "Touch";
}

// ── Input mode selection ────────────────────────────────────────────

// surface install instructions only if the SDK failed to load from
// every source (local copy, app vendor route, 3dconnexion.com)
window._3dxReady.then((ok) => {
  if (!ok) document.getElementById("sdk-note").classList.remove("hidden");
});

const chkInvert = document.getElementById("chk-invert");
const chkLefthand = document.getElementById("chk-lefthand");
const chkRevWheel = document.getElementById("chk-revwheel");

// settings checkboxes persist; the lefthand toggle also re-sends tags
// so the host profile can switch without a reconnect
for (const [chk, key] of [
  [chkInvert, "pose-match-invert-3dx"],
  [chkLefthand, "pose-match-lefthand"],
  [chkRevWheel, "pose-match-revwheel"],
]) {
  chk.checked = localStorage.getItem(key) === "1";
  chk.addEventListener("change", () => {
    localStorage.setItem(key, chk.checked ? "1" : "0");
    if (chk === chkLefthand && oaClient?.getState() === "connected") {
      oaClient.sendTags(oaTags());
    }
  });
}

const overlayStart = document.getElementById("overlay-start");
const overlayResults = document.getElementById("overlay-results");
const elLbName = document.getElementById("lb-name");

// booth mode toggle: the staff / hide-names / attract controls only
// mean something at a booth, so they fold away with it
const chkBooth = document.getElementById("chk-booth");
const boothExtras = document.getElementById("booth-extras");
chkBooth.checked = settings.booth;
boothExtras.classList.toggle("hidden", !settings.booth);
chkBooth.addEventListener("change", () => {
  settings.booth = chkBooth.checked;
  localStorage.setItem("pose-match-booth", chkBooth.checked ? "1" : "0");
  boothExtras.classList.toggle("hidden", !settings.booth);
  renderStartPanels();
});

// ── Modal surfaces ──────────────────────────────────────────────────
// same machinery for all four: device setup (dedicated overlay) and
// the mobile options / scores / stats panels (swapped-in start-screen
// elements). CSS keys off body.modal-<name>; modal.js does the rest.

registerModal("setup", ".setup-panel");
registerModal("about", ".setup-panel");
registerModal("options", ".settings");
registerModal("scores", "#start-board");
registerModal("stats", "#start-bars");

document.getElementById("panel-close").addEventListener("click", closeModal);
// [data-modal] openers (chips, about link, close buttons) are wired
// inside modal.js; only the setup surface needs extra logic to pick
// the device section
function openSetupFor(device) {
  for (const sec of document.querySelectorAll("[data-setup-section]")) {
    sec.classList.toggle("hidden", sec.dataset.setupSection !== device);
  }
  openModal("setup");
}
for (const link of overlayStart.querySelectorAll("[data-setup]")) {
  link.addEventListener("click", () => openSetupFor(link.dataset.setup));
}

// ── Device setup content ────────────────────────────────────────────

// profile body in the shape the Rotatrix app's per-profile
// "Edit as YAML" view expects (no `profiles:` wrapper, no name key);
// rotatrix-profile.yaml in the repo is the same profile for
// hand-merging into a config file
document.getElementById("setup-yaml").value =
`description: Teapot Showdown — activates on the game's app.teapot_showdown tag
triggers:
  - tag:app.teapot_showdown
ball_mode: mouse
bindings:
  - name: Object
    triggers:
      - tag:object
    ball_mode: rotatrix
    navigation_mode: object
    axis_map: obj_rotate
    axis_dominance: off
    label: Rotate
    bindings:
      - name: Translate
        triggers:
          - btn:2
          - key:shift
          - tag:translate
        axis_map: obj_translate
        axis_dominance: off
        label:
          text: Translate
          mode: replace
        bindings:
          - name: Translate (lefthand)
            triggers:
              - tag:lefthand
            axis_map: obj_translate_lefthand
            axis_dominance: off
`;

// ── Touch play controls ─────────────────────────────────────────────

// keyboard-free play controls (visible on touch devices while running)
document.getElementById("tc-exit").addEventListener("click", cancelGame);
document.getElementById("tc-reset").addEventListener("click", resetMovable);
const tcPeek = document.getElementById("tc-peek");
tcPeek.addEventListener("pointerdown", (e) => {
  e.preventDefault(); // no focus grab, no synthetic click
  ui.spaceHeld = true;
  updateMovableVisibility();
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
  tcPeek.addEventListener(ev, () => {
    ui.spaceHeld = false;
    updateMovableVisibility();
  });
}

const btnCopyYaml = document.getElementById("btn-copy-yaml");
btnCopyYaml.addEventListener("click", async () => {
  const yaml = document.getElementById("setup-yaml");
  try {
    await navigator.clipboard.writeText(yaml.value);
  } catch {
    yaml.select();
    document.execCommand("copy");
  }
  btnCopyYaml.textContent = "copied ✓";
  setTimeout(() => { btnCopyYaml.textContent = "copy"; }, 1500);
});

// ── Device availability ─────────────────────────────────────────────
// the SpaceMouse / Rotatrix buttons start gray and only light up once
// their local service answers; until then they can't start a run — a
// click opens that device's setup instructions instead.

const avail = { spacemouse: null, rotatrix: null };

function updateInputAvailability() {
  for (const dev of ["spacemouse", "rotatrix"]) {
    const btn = overlayStart.querySelector(`[data-input="${dev}"]`);
    btn.classList.toggle("unavailable", avail[dev] !== true);
    btn.title = avail[dev] === true ? ""
      : avail[dev] === null ? "connecting…"
      : "not detected — click for setup instructions";
  }
}
updateInputAvailability();

// probe on touch devices too — a touch-enabled PC can still have the
// driver or the Rotatrix app running; on a phone the probes simply
// fail and the buttons stay gray, routing to setup instructions

// SpaceMouse: connect navlib eagerly; its status events double as
// the probe (SDK missing / driver not found → err)
addEventListener("backend-status", (e) => {
  if (e.detail.backend !== "spacemouse") return;
  if (e.detail.cls.includes("ok")) avail.spacemouse = true;
  else if (e.detail.cls.includes("err")) avail.spacemouse = false;
  updateInputAvailability();
});
initSpaceMouse();

// Rotatrix: bare-socket probe, re-checked while the start screen is
// up so launching the app flips the button without a reload
const refreshRotatrix = async () => {
  if (overlayStart.classList.contains("hidden")) return;
  avail.rotatrix = await probeRotatrix();
  updateInputAvailability();
};
refreshRotatrix();
setInterval(refreshRotatrix, 5000);

function selectInput(mode) {
  closeModal(); // a stray modal class would keep the ✕ up in-game
  // no run on a device that hasn't connected — route to its setup
  // instructions instead
  if (mode in avail && avail[mode] !== true) {
    openSetupFor(mode);
    return;
  }
  // one Mouse button; the rotation-style setting picks the variant.
  // Translation-only has no rotation, so the variants are identical —
  // record it as plain mouse. Touch devices record as "touch" (the
  // rotation-style setting still applies inside the touch path).
  if (mode === "mouse" && touchUI) {
    mode = "touch";
  } else if (mode === "mouse" && settings.mouseRotType === "trackball" && settings.gameMode !== "trans") {
    mode = "mouse-holroyd";
  }
  if (ui.inputMode === "rotatrix" && mode !== "rotatrix") releaseRotatrix();
  ui.inputMode = mode;
  if (mode === "spacemouse") initSpaceMouse();
  const st = backendStatus[mode];
  pillInput.textContent = st.text;
  pillInput.className = st.cls;
  pillInput.classList.remove("hidden");
  updateHint();
  startGame();
}

for (const btn of overlayStart.querySelectorAll("[data-input]")) {
  btn.addEventListener("click", () => selectInput(btn.dataset.input));
  // hovering a device previews its slice of the daily leaderboard
  btn.addEventListener("mouseenter", () => {
    ui.startBoardHover = lbGroup(btn.dataset.input);
    renderStartBoard();
  });
  btn.addEventListener("mouseleave", () => {
    ui.startBoardHover = null;
    renderStartBoard();
  });
}

// mark the chip whose data-<attr> matches val as the active one
const activateChip = (chips, attr, val) => {
  for (const c of chips) c.classList.toggle("active", c.dataset[attr] === String(val));
};

const modeChips = overlayStart.querySelectorAll("[data-mode]");
const elHint = document.getElementById("hint");
function setGameMode(m) {
  settings.gameMode = m;
  // attract-mode demos cycle through the modes; don't persist those
  if (!attract.active) localStorage.setItem("pose-match-mode", m);
  activateChip(modeChips, "mode", m);
  // translation-only: the mouse variants differ only in rotation
  // mapping, so the rotation-style setting is moot (it stays visible
  // but sessions record plain "mouse")
  updateHint();
  renderStartPanels();
}

// mouse drag/wheel tips only when a mouse input is active; touch
// devices get gesture tips and rely on the on-screen buttons instead
// of keyboard shortcuts
function updateHint() {
  if (touchUI) {
    elHint.innerHTML = (settings.gameMode === "trans"
      ? ["drag: move", "two fingers: pan", "pinch: depth"]
      : settings.gameMode === "rot"
        ? ["drag: rotate"]
        : ["drag: rotate", "two fingers: pan", "pinch: depth"])
      .join(" &middot; ");
    return;
  }
  const mouseActive = ui.inputMode === "mouse" || ui.inputMode === "mouse-holroyd";
  const mouseTips = !mouseActive ? []
    : settings.gameMode === "trans"
      ? ["drag: move", "wheel: depth"]
      : ["drag: rotate", "shift/right-drag: pan", "wheel: depth"];
  elHint.innerHTML = [...mouseTips, "space: peek at target", "R: reset teapot", "Esc: cancel"]
    .join(" &middot; ");
}
setGameMode(settings.gameMode);
for (const c of modeChips) c.addEventListener("click", () => setGameMode(c.dataset.mode));

const tolChips = overlayStart.querySelectorAll("[data-tol]");
function setTolLevel(t) {
  settings.tolLevel = t;
  localStorage.setItem("pose-match-tol", t);
  activateChip(tolChips, "tol", t);
  renderStartPanels();
}
setTolLevel(settings.tolLevel);
for (const c of tolChips) c.addEventListener("click", () => setTolLevel(c.dataset.tol));

const limitChips = overlayStart.querySelectorAll("[data-limit]");
function setTimeLimit(sec) {
  settings.timeLimit = sec;
  localStorage.setItem("pose-match-limit", String(sec));
  activateChip(limitChips, "limit", sec);
  renderStartPanels();
}
setTimeLimit(settings.timeLimit);
for (const c of limitChips) c.addEventListener("click", () => setTimeLimit(+c.dataset.limit));

const mouseRotChips = overlayStart.querySelectorAll("[data-mouserot]");
function setMouseRot(t) {
  settings.mouseRotType = t;
  localStorage.setItem("pose-match-mouserot", t);
  activateChip(mouseRotChips, "mouserot", t);
}
setMouseRot(settings.mouseRotType);
for (const c of mouseRotChips) c.addEventListener("click", () => setMouseRot(c.dataset.mouserot));

const rangeChips = document.querySelectorAll("#lb-range [data-range]");
function setLbRange(r) {
  settings.lbRange = r;
  localStorage.setItem("pose-match-lb-range", r);
  activateChip(rangeChips, "range", r);
  renderStartBoard();
}
setLbRange(settings.lbRange);
for (const c of rangeChips) c.addEventListener("click", () => setLbRange(c.dataset.range));

const chkAttract = document.getElementById("chk-attract");

// reset the panel to booth defaults (hide-names is deliberately kept)
document.getElementById("btn-defaults").addEventListener("click", () => {
  setTolLevel("loose");
  setTimeLimit(30);
  setMouseRot("trackball");
  for (const chk of [chkInvert, chkLefthand, chkRevWheel]) {
    if (chk.checked) {
      chk.checked = false;
      chk.dispatchEvent(new Event("change")); // persist + re-send tags
    }
  }
  if (!chkAttract.checked) {
    chkAttract.checked = true;
    chkAttract.dispatchEvent(new Event("change"));
  }
  setLbRange("today");
  renderStartPanels();
});

// play again returns to the input/mode selector (click, Enter, or Esc).
// In mouse mode the run ends under a hand that's still clicking, so the
// first moments after the results appear are dead — otherwise a stray
// click dismisses the screen before the name prompt is ever read, and
// the run stays on the board anonymous.
function returnToStart() {
  if (game.state === "done" && performance.now() - game.doneAt < RESULTS_ARM_MS) return;
  overlayResults.classList.add("hidden");
  overlayStart.classList.remove("hidden");
  renderStartPanels();
}
overlayResults.addEventListener("click", returnToStart);

// leaderboard entry: keep clicks from falling through to play-again
const lbEntry = document.getElementById("lb-entry");
lbEntry.addEventListener("click", stopProp);
document.getElementById("lb-board").addEventListener("click", stopProp);
document.getElementById("lb-save").addEventListener("click", saveLbName);
elLbName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveLbName();
});

// ── Keyboard ────────────────────────────────────────────────────────

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement
      && (e.target.type === "text" || e.target.type === "number")) return;
  if (e.key === "Escape" && activeModal()) {
    closeModal();
    return;
  }
  if ((e.key === "Enter" || e.key === "Escape") && game.state === "done"
      && !overlayResults.classList.contains("hidden")) {
    returnToStart();
    return;
  }
  if (e.key === "Escape" && game.state === "idle") {
    // start the attract demo right away instead of waiting out the
    // idle timer (no-op when attract mode is disabled); deliberate,
    // so it takes a click/key/touch to dismiss
    requestAttract(true);
    return;
  }
  if (e.key === "r" || e.key === "R") resetMovable();
  if (e.key === "Escape") cancelGame();
  if (e.code === "Space" && game.state === "running") {
    e.preventDefault();
    ui.spaceHeld = true; // peek at the ghost; the clock keeps running
    updateMovableVisibility();
  }
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    ui.spaceHeld = false;
    updateMovableVisibility();
  }
});
addEventListener("blur", () => {
  ui.spaceHeld = false;
  updateMovableVisibility();
});

initAttract(setGameMode);
// the page opens straight into the demo (when attract is enabled);
// being deliberate, it holds until a click/key/touch, not mouse motion
requestAttract(true);

// ── Render loop ─────────────────────────────────────────────────────

function animate(time) {
  requestAnimationFrame(animate);
  if (nav.animating && nav.controller) {
    // feed the frame time so navlib emits this frame's transform
    nav.controller.update3dcontroller({ frame: { time } });
  }
  updateGame(performance.now());
  // no attract demo while someone is reading a modal surface
  if (game.state !== "running" && chkAttract.checked && !activeModal()
      && performance.now() - attract.lastActivity > ATTRACT_IDLE_MS) {
    stepAttract(performance.now());
  }
  const markersOn = (game.state === "running" || attract.active) && hasTranslation();
  updateGroundMarker(movableMarker, movable, markersOn && movable.visible);
  updateGroundMarker(ghostMarker, ghost, markersOn && ghost.visible);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ── Resize ──────────────────────────────────────────────────────────

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = cameraFovForAspect(camera.aspect);
  camera.updateProjectionMatrix();
});
