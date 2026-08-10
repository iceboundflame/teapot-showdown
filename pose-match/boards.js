// Leaderboard + median-motion-graph rendering, claim chips, and the
// booth staff / hide-names inputs they read.

import { loadSessions, loadBoard, median, DEVICE } from "../lib/pose-match-shared.js";
import {
  settings, ui, run, MODE_SHORT, lbRangeLabel, stopProp,
} from "./state.js";
import { claimRun } from "./game.js";

// boards are daily and scoped to mode × time limit × tolerance; the
// left board is the current input (both mouse rotation styles share
// it), the right one spans all input devices. Colors/labels come from
// the shared DEVICE map, keyed by device group.
export const lbGroup = (input) => (input.startsWith("mouse") ? "mouse" : input);
const lbDot = (e) => `<span class="dot" style="background:${DEVICE[lbGroup(e.input)].hex}"></span>`;
// boards label by device group only — the mouse rotation style stays
// an internal recording detail (visible on the stats page)
const lbDeviceLabel = (e) => DEVICE[lbGroup(e.input)]?.label ?? e.input;

const lbExcludedSet = () => new Set((localStorage.getItem("pose-match-lb-exclude") || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

function lbRowsWhere(pred, keepTs) {
  const midnight = new Date().setHours(0, 0, 0, 0);
  const excluded = lbExcludedSet();
  const rows = loadBoard()
    .filter((e) => e.mode === settings.gameMode && e.limit === settings.timeLimit
      && (e.tol ?? "normal") === settings.tolLevel
      && (settings.lbRange !== "today" || e.ts >= midnight)
      && !excluded.has((e.name || "").trim().toLowerCase()) && pred(e))
    .sort(lbCompare);
  // personal (non-booth) mode: every run is the same player, so all
  // runs rank — the board is simply their highest scores
  if (!settings.booth) return rows;
  // one row per player per device: only a name's best entry with a
  // given device keeps a slot, so the same player can still appear
  // once per device on the all-devices board. Unnamed runs don't
  // occupy slots (no name, no fame) — except the just-finished run
  // (keepTs), which stays visible while the name prompt is open
  const seen = new Set();
  return rows.filter((e) => {
    const n = (e.name || "").trim().toLowerCase();
    if (!n) return e.ts === keepTs;
    const key = `${n}|${lbGroup(e.input)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// equal pose counts are common on short windows — break ties by how
// fast the last pose locked (legacy entries without ms rank last)
export const lbCompare = (a, b) =>
  b.poses - a.poses || (a.ms ?? Infinity) - (b.ms ?? Infinity) || a.ts - b.ts;
export const lbRows = (keepTs) =>
  lbRowsWhere((e) => lbGroup(e.input) === lbGroup(ui.inputMode), keepTs);

// booth boards show who; personal boards show when
const whoCell = (e) => settings.booth
  ? `<td>${e.name || "—"}</td>`
  : `<td>${new Date(e.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>`;

function boardHtml(rows, highlightTs, deviceLabel) {
  return rows
    .map((e, i) => `<tr${e.ts === highlightTs ? ' class="me"' : ""}>
      <td class="rank">${i + 1}</td>${whoCell(e)}
      <td>${e.poses} match${e.poses === 1 ? "" : "es"}${e.ms != null ? ` · ${(e.ms / 1000).toFixed(1)}s` : ""}</td>
      <td>${lbDot(e)}${deviceLabel(e)}</td></tr>`)
    .join("");
}

export function renderBoard(highlightTs) {
  const mine = lbRows(highlightTs).slice(0, 10);
  const all = lbRowsWhere(() => true, highlightTs).slice(0, 10);
  document.getElementById("lb-title").textContent = `Best scores ${lbRangeLabel()} · ${MODE_SHORT[settings.gameMode]}`;
  document.getElementById("lb-title-all").textContent = `All devices · ${MODE_SHORT[settings.gameMode]}`;
  document.getElementById("lb-sub").textContent = lbSpec(DEVICE[lbGroup(ui.inputMode)].label);
  document.getElementById("lb-sub-all").textContent = lbSpec(null);
  document.getElementById("lb-board").innerHTML = boardHtml(mine, highlightTs, () => "");
  document.getElementById("lb-board-all").innerHTML = boardHtml(all, highlightTs, lbDeviceLabel);
  document.getElementById("lb-wrap").classList.toggle("hidden", !all.length);
}

// one specifier format for every board sub-line: device? · limit · tol
// (the game mode lives on the title line)
const lbSpec = (device) =>
  [device, `time: ${settings.timeLimit}s`, `tolerance: ${settings.tolLevel}`].filter(Boolean).join(" · ");

// full refresh for the start screen; hover filtering re-renders only
// the board so the bars don't re-animate
export function renderStartPanels() {
  renderMotionBars("start-bars");
  renderStartBoard();
}

// combined daily board on the start screen, tracking the selected
// mode / time limit / tolerance
export function renderStartBoard() {
  const el = document.getElementById("start-board");
  el.classList.remove("hidden");
  const rows = lbRowsWhere((e) =>
    !ui.startBoardHover || lbGroup(e.input) === ui.startBoardHover).slice(0, 10);
  document.getElementById("start-board-title").textContent =
    `Best scores ${lbRangeLabel()} · ${MODE_SHORT[settings.gameMode]}`;
  document.getElementById("start-board-sub").textContent =
    lbSpec(ui.startBoardHover ? DEVICE[ui.startBoardHover].label : null);
  // always render 10 slots — placeholders keep the board height
  // constant so hover filtering doesn't reflow the stacked layout
  const placeholders = Array.from({ length: Math.max(0, 10 - rows.length) },
    (_, i) => `<tr class="lb-empty"><td class="rank">${rows.length + i + 1}</td><td>—</td><td></td><td></td></tr>`).join("");
  document.getElementById("start-board-table").innerHTML =
    boardHtml(rows, null, lbDeviceLabel) + placeholders;
}

// median motion time by device, from all recorded sessions (timed and
// free play) at the selected mode × tolerance
export function renderMotionBars(wrapId) {
  // group sessions by device, then optionally keep only each
  // device's top-N% sessions (fastest by per-session median) so a
  // few clumsy first attempts don't drown the graph
  const acc = new Map();
  const excluded = lbExcludedSet();
  for (const s of loadSessions()) {
    if (s.mode !== settings.gameMode || (s.tol ?? "normal") !== settings.tolLevel) continue;
    if (!s.motions.length) continue;
    const sname = (s.name || "").trim().toLowerCase();
    if (settings.graphPlayer) {
      // explicit player filter wins over the blocklist
      if (sname !== settings.graphPlayer.toLowerCase()) continue;
    } else if (excluded.has(sname)) {
      continue;
    }
    // one row per device: the mouse rotation styles are combined
    const key = lbGroup(s.input);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(s.motions.map((m) => m.ms));
  }
  const rows = [...acc.entries()]
    .map(([input, sessionTimes]) => {
      let kept = sessionTimes;
      if (settings.topPct) {
        kept = [...sessionTimes]
          .sort((a, b) => median(a) - median(b))
          .slice(0, Math.max(1, Math.ceil(sessionTimes.length * settings.topPct / 100)));
      }
      const v = kept.flat();
      return { input, n: v.length, med: median(v) };
    })
    .sort((a, b) => a.med - b.med);

  const el = document.getElementById(wrapId);
  // stay visible whenever any sessions exist at all — vanishing on a
  // filter mismatch (wrong tol/mode selected, player typo) hides the
  // very controls needed to fix it
  const show = rows.length > 0 || !!settings.graphPlayer || loadSessions().length > 0;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const max = rows.length ? Math.max(...rows.map((r) => r.med)) : 0;
  const fastest = rows[0];
  el.innerHTML =
    `<div class="lb-title">Median motion time · ${MODE_SHORT[settings.gameMode]}</div>`
    + `<div class="lb-sub">tolerance: ${settings.tolLevel}${settings.topPct ? ` · top ${settings.topPct}% of sessions` : ""}${settings.graphPlayer ? ` · player: ${settings.graphPlayer}` : ""}</div>`
    + (rows.length ? "" : `<div class="mbar-empty">${settings.graphPlayer
        ? "no named sessions for this player yet"
        : "no sessions for this mode / tolerance yet"}</div>`)
    + rows.map((r) => {
      const delta = rows.length < 2 ? ""
        : r === fastest
          ? '<span class="mbar-delta fastest">fastest</span>'
          : `<span class="mbar-delta">+${Math.round((r.med / fastest.med - 1) * 100)}%</span>`;
      return `<div class="mbar-row">
        <span class="mbar-label">${lbDot(r)}${DEVICE[r.input].label} <span class="mbar-n">&times;${r.n}</span></span>
        <span class="mbar-track"><span class="mbar-bar" style="width:${(r.med / max * 100).toFixed(1)}%;background:${DEVICE[lbGroup(r.input)].hex}"></span></span>
        <span class="mbar-val">${(r.med / 1000).toFixed(1)}s${delta}</span>
      </div>`;
    }).join("")
    + `<div class="mbar-filter"><span class="mbar-filter-label">sessions:</span>`
    + `<button data-toppct="0"${settings.topPct === 0 ? ' class="active"' : ""}>All</button>`
    + `<span class="mbar-top${settings.topPct ? " active" : ""}">Top&nbsp;<input class="mbar-custom" type="number" min="1" max="99" value="${settings.topPct || settings.lastTopN}" />%</span>`
    + `<input class="mbar-player${settings.graphPlayer ? " active" : ""}" type="text" maxlength="8" placeholder="player" value="${settings.graphPlayer.replace(/"/g, "&quot;")}" /></div>`
    + `<div class="mbar-foot"><a class="stats-link" href="stats.html">view stats &rarr;</a></div>`;
  el.querySelector(".stats-link").addEventListener("click", stopProp);
  el.querySelector("[data-toppct]").addEventListener("click", (e) => {
    e.stopPropagation(); // results overlay click means "play again"
    setTopPct(0);
  });
  const topChip = el.querySelector(".mbar-top");
  const custom = el.querySelector(".mbar-custom");
  const applyCustom = () => {
    const v = Math.round(+custom.value);
    if (Number.isFinite(v) && v >= 1 && v <= 99) setTopPct(v);
  };
  topChip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target !== custom) applyCustom();
  });
  custom.addEventListener("change", applyCustom);
  const player = el.querySelector(".mbar-player");
  player.addEventListener("click", stopProp);
  player.addEventListener("change", () => {
    settings.graphPlayer = player.value.trim();
    localStorage.setItem("pose-match-graph-player", settings.graphPlayer);
    renderMotionBars("start-bars");
    renderMotionBars("result-bars");
  });
}

// top-N% chips live inside the graph widget itself (see renderMotionBars)
function setTopPct(pct) {
  settings.topPct = pct;
  if (pct) settings.lastTopN = pct;
  localStorage.setItem("pose-match-top-pct", String(pct));
  renderMotionBars("start-bars");
  renderMotionBars("result-bars");
}

// staff list: rendered as one-tap claim buttons on every results
// screen, so staff runs get attributed without any pre-game setup
const staffInput = document.getElementById("staff-names");
staffInput.value = localStorage.getItem("pose-match-staff") || "";
staffInput.addEventListener("input", () => {
  localStorage.setItem("pose-match-staff", staffInput.value);
});
const staffNames = () => staffInput.value
  .split(",").map((n) => n.trim().slice(0, 8)).filter(Boolean);

// leaderboard name blocklist (comma-separated, case-insensitive)
const lbExcludeInput = document.getElementById("lb-exclude");
lbExcludeInput.value = localStorage.getItem("pose-match-lb-exclude") || "";
lbExcludeInput.addEventListener("input", () => {
  localStorage.setItem("pose-match-lb-exclude", lbExcludeInput.value);
  renderStartPanels(); // boards and the median graph both honor it
});

// one-tap attribution for staff runs, qualifying or not
export function renderClaimChips() {
  const el = document.getElementById("lb-claim");
  const names = staffNames();
  el.classList.toggle("hidden", !names.length || !run.lastRun);
  if (!names.length || !run.lastRun) return;
  el.innerHTML = `<span class="lb-claim-label">claim:</span>`
    + names.map((n) => `<button data-claim="${n.replace(/"/g, "&quot;")}"${
        run.lastRun.name === n ? ' class="active"' : ""}>${n}</button>`).join("");
  for (const b of el.querySelectorAll("[data-claim]")) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      claimRun(b.dataset.claim);
    });
  }
}
