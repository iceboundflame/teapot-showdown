// Shared between pose-match.html and pose-match-stats.html.
//
// This module owns the localStorage layer (keys + typed loaders), the
// per-device display data, and the small stats helpers both pages need,
// so the two pages can't drift out of agreement on any of them.
//
// The leaderboard is a pure projection of the timed sessions plus the
// player names entered on the results screen (joined by session ts), so
// it can always be rebuilt from the sessions store — e.g. after a stats
// import or clear.

export const SESSIONS_KEY = "pose-match-sessions";
export const LB_KEY = "pose-match-leaderboard";

function loadJson(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const loadSessions = () => loadJson(SESSIONS_KEY);
export const loadBoard = () => loadJson(LB_KEY);

// Per-input display data. The game folds the two mouse rotation styles
// into one "mouse" group on its boards; the stats page keeps them apart,
// but the colors and labels come from here for both.
export const DEVICE = {
  mouse:           { label: "Mouse",                     hex: "#c98500" },
  "mouse-holroyd": { label: "Mouse (Virtual Trackball)", hex: "#199e70" },
  touch:           { label: "Touch",                     hex: "#9a6fe0" },
  spacemouse:      { label: "SpaceMouse",                hex: "#3987e5" },
  rotatrix:        { label: "Rotatrix",                  hex: "#e66767" },
};

export function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function rebuildLeaderboard() {
  const names = new Map(loadBoard().map((e) => [e.ts, e.name]));
  const board = loadSessions()
    .filter((s) => s.limit && Array.isArray(s.motions))
    .map((s) => ({
      // sessions carry the name themselves since it's stamped on commit;
      // the old board is a fallback for data recorded before that
      name: s.name || names.get(s.ts) || "",
      poses: s.motions.length,
      ms: +s.motions.reduce((a, m) => a + m.ms, 0).toFixed(1),
      input: s.input,
      mode: s.mode,
      tol: s.tol ?? "normal",
      limit: s.limit,
      ts: s.ts,
    }));
  localStorage.setItem(LB_KEY, JSON.stringify(board));
}
