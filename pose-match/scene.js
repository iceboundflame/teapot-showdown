// Three.js scene: renderer/camera/lights, the two teapots, ground
// markers, and pose generation.

import * as THREE from "three";
import { TeapotGeometry } from "three/examples/jsm/geometries/TeapotGeometry.js";
import { ui, hasRotation, hasTranslation, tolDist, tolAngle } from "./state.js";
import { sendObjectState } from "./input-rotatrix.js";
import { nav } from "./input-spacemouse.js";

// ── Scene ───────────────────────────────────────────────────────────

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121110);
scene.fog = new THREE.Fog(0x121110, 25, 60);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.style.outline = "none"; // no focus ring on the canvas

// level camera, looking straight down -Z.
// three.js fov is vertical, so a portrait screen would shrink the
// horizontal view below the pose x-range and strand targets offscreen.
// On aspect < 1 hold the horizontal fov at the desktop value and let
// the vertical fov grow instead — same playfield width everywhere.
const BASE_FOV = 50; // degrees, vertical == horizontal limit at aspect 1
export function cameraFovForAspect(aspect) {
  if (aspect >= 1) return BASE_FOV;
  return Math.atan(Math.tan(BASE_FOV * Math.PI / 360) / aspect) * 360 / Math.PI;
}
export const camera = new THREE.PerspectiveCamera(
  cameraFovForAspect(innerWidth / innerHeight), innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.2, 12);
scene.add(camera);

scene.add(new THREE.GridHelper(30, 30, 0x4a4642, 0x2b2825));
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(6, 10, 7);
scene.add(dirLight);
scene.add(new THREE.HemisphereLight(0xb3a996, 0x38302a, 0.5));

// ── Teapots ─────────────────────────────────────────────────────────

const teapotGeo = new TeapotGeometry(0.9, 8);
teapotGeo.computeBoundingBox();

// spout and handle are the geometry's two x-extremes; give each a
// glaze-dip tint (vertex colors multiply the texture) so the two ends
// are unambiguous even end-on: slate-indigo spout, clay-brown handle.
// Dark-vs-light tonal contrast reads in any lighting, unlike hue
// alone. The short lerp ramp mimics a dipped glaze edge.
{
  const pos = teapotGeo.attributes.position;
  let maxX = 0, minX = 0;
  for (let i = 0; i < pos.count; i++) {
    maxX = Math.max(maxX, pos.getX(i));
    minX = Math.min(minX, pos.getX(i));
  }
  const spoutTint = new THREE.Color("#4d5878");
  const handleTint = new THREE.Color("#a2714e");
  const white = new THREE.Color(1, 1, 1);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    c.copy(white);
    if (x > 0.55 * maxX) {
      c.lerp(spoutTint, Math.min(1, (x - 0.55 * maxX) / (0.2 * maxX)));
    } else if (x < 0.55 * minX) {
      c.lerp(handleTint, Math.min(1, (x - 0.55 * minX) / (0.2 * minX)));
    }
    colors.set([c.r, c.g, c.b], i * 3);
  }
  teapotGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// The bottom disc (the base the pot sits on) gets its own material, so
// split the triangles into two draw groups: body first, bottom last.
// The disc is the only surface that is both down-facing and at the very
// base — the spout/handle undersides face down too but sit mid-height.
{
  const index = teapotGeo.index;
  const pos = teapotGeo.attributes.position;
  const nrm = teapotGeo.attributes.normal;
  const bb = teapotGeo.boundingBox;
  const yCut = bb.min.y + 0.1 * (bb.max.y - bb.min.y);
  const isBottom = (v) => pos.getY(v) < yCut && nrm.getY(v) < -0.5;
  const body = [], bottom = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    (isBottom(a) && isBottom(b) && isBottom(c) ? bottom : body).push(a, b, c);
  }
  teapotGeo.setIndex([...body, ...bottom]);
  teapotGeo.clearGroups();
  teapotGeo.addGroup(0, body.length, 0);
  teapotGeo.addGroup(body.length, bottom.length, 1);
}

// rotation pivot: center of the bowl — on the pot's vertical axis at
// mid-height (the raw bbox center is dragged sideways by spout/handle)
const PIVOT_LOCAL = new THREE.Vector3(
  0,
  (teapotGeo.boundingBox.min.y + teapotGeo.boundingBox.max.y) / 2,
  0,
);

// Both teapots wear the same unglazed bisque finish: warm white with a
// subtle fired-clay speckle. Orientation reads from the tinted spout
// and handle plus the ringed figure on the base, not from a surface
// pattern.
function makeBisqueCanvas() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#e9e3d7";
  g.fillRect(0, 0, size, size);
  // speckle like rough fired clay (fixed PRNG so both pots match)
  const rng = seededRandom(7);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = rng() > 0.5 ? "#d6cdbc" : "#f4efe6";
    const r = 2 + rng() * 5;
    g.beginPath();
    g.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  return { c, g, size };
}

function canvasTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const teapotTex = canvasTexture(makeBisqueCanvas().c);

// Bottom texture: the same bisque plus a foot ring and spokes, so the
// underside is unmistakable. The four bottom patches are mapped
// polar-style — v=1 collapses to the disc center and v shrinks
// outward, u sweeps a quarter turn — so with flipY the canvas top row
// is the center, horizontal bands become concentric rings, and
// vertical lines become radial spokes (repeating 4x around, which
// just extends the pattern).
function makeBottomTexture() {
  const { c, g, size } = makeBisqueCanvas();
  g.fillStyle = "#9d9280";
  // foot ring near the outer edge, plus a thin echo closer in
  g.fillRect(0, 0.46 * size, size, 0.08 * size);
  g.fillRect(0, 0.13 * size, size, 0.02 * size);
  // spokes between the rings; 3 per patch = 12 around the base
  for (let i = 0; i < 3; i++) {
    g.fillRect((i / 3 + 0.15) * size, 0.15 * size, 0.04 * size, 0.31 * size);
  }
  return canvasTexture(c);
}
const bottomTex = makeBottomTexture();

export const movable = new THREE.Mesh(teapotGeo, [
  new THREE.MeshStandardMaterial({ map: teapotTex, vertexColors: true, roughness: 0.4, metalness: 0.15 }),
  new THREE.MeshStandardMaterial({ map: bottomTex, vertexColors: true, roughness: 0.85, metalness: 0 }),
]);
scene.add(movable);

export function bowlPivotWorld() {
  movable.updateMatrixWorld();
  return movable.localToWorld(PIVOT_LOCAL.clone());
}

// Ghost: translucent against the scene, but opaque to itself — a
// depth-only prepass fills the depth buffer with the front surface so
// the shaded pass can't see the interior or back side.
// same map as the solid teapot; the gray tint multiplies over it, and
// the amber/green feedback tints read through
export const GHOST_OPACITY = 0.5;
export const ghostMat = new THREE.MeshStandardMaterial({
  map: teapotTex,
  vertexColors: true,
  color: 0xe2ddd3,
  emissive: 0x2a2622, // lift the shadowed side so the pattern stays readable
  transparent: true,
  opacity: GHOST_OPACITY,
  roughness: 0.8,
  depthWrite: false,
});
// the prepass is flagged transparent only to put it in the transparent
// queue, where renderOrder sorts it against the ground markers (0) —
// they must draw before its depth lands or the ghost culls them.
// renderOrder can't order across the opaque/transparent split, so an
// opaque prepass would always win, whatever its value.
const ghostDepth = new THREE.Mesh(
  teapotGeo,
  new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true }),
);
ghostDepth.renderOrder = 1;
ghostDepth.raycast = () => {}; // a render-only twin of the shade: never probed
// the ghost bottom shares the tint Color instance with ghostMat, and
// copies its opacity each frame, so the feedback code in game/attract
// can keep mutating ghostMat alone and the whole ghost follows
const ghostBottomMat = new THREE.MeshStandardMaterial({
  map: bottomTex,
  vertexColors: true,
  emissive: 0x2a2622,
  transparent: true,
  opacity: GHOST_OPACITY,
  roughness: 0.9,
  depthWrite: false,
});
ghostBottomMat.color = ghostMat.color;
const ghostShade = new THREE.Mesh(teapotGeo, [ghostMat, ghostBottomMat]);
ghostShade.onBeforeRender = () => { ghostBottomMat.opacity = ghostMat.opacity; };
ghostShade.renderOrder = 2;
export const ghost = new THREE.Group();
ghost.add(ghostDepth, ghostShade);
scene.add(ghost);

// Ground markers: a ring on the grid plane under each teapot (plus a
// stem up to the bowl) anchors its x/z against the grid. Without
// them, depth toward the camera only reads as apparent size, which
// is too weak a cue when a target spawns far in z.
function makeGroundMarker(color, opacity, probeStem = false) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.38, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.5 }),
  );
  const group = new THREE.Group();
  group.add(ring, stem);
  group.visible = false;
  scene.add(group);
  return {
    group, stem, probeStem,
    // stem-probe memo, keyed on the pose it was measured at
    top: 0,
    atPos: new THREE.Vector3(NaN, NaN, NaN),
    atQuat: new THREE.Quaternion(),
    setColor(hex) {
      ring.material.color.setHex(hex);
      stem.material.color.setHex(hex);
    },
  };
}
export const movableMarker = makeGroundMarker(0xffffff, 0.85);
export const ghostMarker = makeGroundMarker(0xe2ddd3, 0.45, true);

// scratch for the stem probe below
const _rc = new THREE.Raycaster();
const _rayFrom = new THREE.Vector3();
const _rayUp = new THREE.Vector3(0, 1, 0);
const _hits = [];

// Where the stem stops. Only the see-through ghost needs a real answer:
// the solid teapot is closed, so it draws over the stem's last stretch
// either way, and ending at the underside or running on to the bowl
// center are the same picture.
function stemTop(marker, obj, pivot) {
  if (!marker.probeStem) return pivot.y;
  // the ghost holds its pose for a whole segment — measure on change only
  if (obj.position.equals(marker.atPos) && obj.quaternion.equals(marker.atQuat)) return marker.top;
  // No fixed point on the pot is "the underside": the local bottom rides
  // up top when the pot is inverted, and the lowest vertex sits up to a
  // whole teapot below the surface the stem rises through. Probing along
  // the stem always hits — the pivot it aims at is inside the pot.
  _hits.length = 0;
  _rc.set(_rayFrom.set(pivot.x, 0, pivot.z), _rayUp);
  _rc.intersectObject(obj, true, _hits);
  marker.top = _hits.length ? _hits[0].point.y : pivot.y;
  marker.atPos.copy(obj.position);
  marker.atQuat.copy(obj.quaternion);
  return marker.top;
}

export function updateGroundMarker(marker, obj, show) {
  marker.group.visible = show;
  if (!show) return;
  obj.updateMatrixWorld();
  const pivot = obj.localToWorld(PIVOT_LOCAL.clone());
  marker.group.position.set(pivot.x, 0.02, pivot.z);
  marker.stem.scale.y = Math.max(0.01, stemTop(marker, obj, pivot) - 0.02);
}

export const HOME_POS = new THREE.Vector3(0, 2.2, 4);
export function resetMovable() {
  movable.position.copy(HOME_POS);
  movable.quaternion.identity();
  if (ui.inputMode === "rotatrix") sendObjectState();
  if (ui.inputMode === "spacemouse") nav.pushPivot();
}
resetMovable();

// rotate the teapot about its bowl center by a world-frame quaternion
export function rotateMovable(q) {
  const pivot = bowlPivotWorld();
  movable.position.sub(pivot).applyQuaternion(q).add(pivot);
  movable.quaternion.premultiply(q);
}

// scratch quaternion shared by the match checks (game + attract)
export const _qTmp = new THREE.Quaternion();

// ── Pose generation (seeded so each run is a fresh but fair set) ───

export function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// each target must be a real move from where the teapot will be when
// it appears. Targets are separated by a guaranteed-motion floor plus
// a lock tolerance at BOTH ends: the teapot rests up to one tolerance
// from the old target, and the new pose locks one tolerance early —
// without the 2× compensation, loose tolerance could spawn targets
// already inside the lock zone.
const MIN_POSE_ANGLE_GAP = 21 * Math.PI / 180;
const MIN_POSE_DIST_GAP = 1.3; // any mode with translation (trans, 6dof)
const minPoseAngle = () => MIN_POSE_ANGLE_GAP + 2 * tolAngle();
const minPoseDist = () => MIN_POSE_DIST_GAP + 2 * tolDist();

export function generatePoses(rng, n, fromPos = HOME_POS, fromQuat = new THREE.Quaternion()) {
  const poses = [];
  let prevPos = fromPos;
  let prevQuat = fromQuat;
  for (let i = 0; i < n; i++) {
    let pos, quat;
    for (let tries = 0; tries < 100; tries++) {
      pos = hasTranslation()
        ? new THREE.Vector3(
            (rng() * 2 - 1) * 3.2,
            0.9 + rng() * 2.8,
            (rng() * 2 - 1) * 2.2,
          )
        : HOME_POS.clone();
      if (hasRotation()) {
        const axis = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
        const angle = (40 + rng() * 140) * Math.PI / 180;
        quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      } else {
        quat = new THREE.Quaternion();
      }

      const dot = Math.min(1, Math.abs(quat.dot(prevQuat)));
      const angleOk = !hasRotation() || 2 * Math.acos(dot) >= minPoseAngle();
      const distOk = !hasTranslation() || pos.distanceTo(prevPos) >= minPoseDist();
      if (angleOk && distOk) break;
    }
    poses.push({ pos, quat });
    prevPos = pos;
    prevQuat = quat;
  }
  return poses;
}
