// Shared modal machinery. A "modal" is an existing element promoted to
// a full-screen surface by body classes (`modal-open modal-<name>`), so
// CSS owns each surface's presentation — a dedicated overlay (device
// setup), a swapped-in start-screen panel (options/scores/stats) — and
// this module owns the behavior they all share: one open at a time,
// closed by the shared ✕, a backdrop tap, or Escape (Escape is wired in
// main.js so it can order modal-close against the game's own Esc uses).
//
// register(name, keep) declares the selector for the surface's own
// content: clicks inside it never backdrop-close. Controls that open
// modals from their own click handlers are listed in OPENERS so the
// opening click doesn't fall through and immediately self-close.

const registry = new Map(); // name -> keep selector
let active = null;

const OPENERS = "[data-modal], [data-setup]";

// any [data-modal="name"] control toggles its surface — no per-opener
// wiring needed
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-modal]");
  if (opener) toggleModal(opener.dataset.modal);
});

export function registerModal(name, keep) {
  registry.set(name, keep);
}

export const activeModal = () => active;

export function openModal(name) {
  closeModal();
  active = name;
  document.body.classList.add("modal-open", `modal-${name}`);
}

// for opener chips: reopening the active surface closes it
export function toggleModal(name) {
  if (active === name) closeModal();
  else openModal(name);
}

export function closeModal() {
  if (!active) return;
  document.body.classList.remove("modal-open", `modal-${active}`);
  active = null;
}

// backdrop: any click outside the active surface closes it
document.addEventListener("click", (e) => {
  if (!active) return;
  if (e.target.closest(registry.get(active)) || e.target.closest(OPENERS)) return;
  closeModal();
});
