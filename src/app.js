import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */

const GRID = 24;            // baseplate is GRID x GRID studs
const H = 1.2;              // brick height in world units
const GAP = 0.045;          // hairline gap between neighbouring bricks
const STUD_R = 0.29;
const STUD_H = 0.16;
const MAX_LEVEL = 24;
const AUTO_KEY = 'brickstudio.autosave.v1';
const SLOT_KEY = 'brickstudio.slot.v1';
const SOUND_KEY = 'brickstudio.sound';

const COLORS = [
  { name: 'Cherry',      hex: '#d0212c' },
  { name: 'Tangerine',   hex: '#f2761d' },
  { name: 'Butter',      hex: '#f4c62a' },
  { name: 'Lime',        hex: '#a3c31a' },
  { name: 'Forest',      hex: '#2c8a49' },
  { name: 'Mint',        hex: '#7fd6b0' },
  { name: 'Sky',         hex: '#4bb2e6' },
  { name: 'Ocean',       hex: '#1566c9' },
  { name: 'Violet',      hex: '#7b4bd6' },
  { name: 'Magenta',     hex: '#df3f97' },
  { name: 'Pink',        hex: '#f6a3c1' },
  { name: 'Cream',       hex: '#f1ede2' },
  { name: 'Sand',        hex: '#e3cd9e' },
  { name: 'Brown',       hex: '#80502f' },
  { name: 'Slate',       hex: '#8b93a1' },
  { name: 'Charcoal',    hex: '#2a2d35' },
];

const SIZES = [
  { w: 1, d: 1 },
  { w: 2, d: 1 },
  { w: 4, d: 1 },
  { w: 2, d: 2 },
  { w: 2, d: 3 },
  { w: 4, d: 2 },
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

/* ------------------------------------------------------------------ *
 *  Renderer, scene, camera
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;

const scene = new THREE.Scene();
scene.background = gradientBackground();
scene.fog = new THREE.FogExp2(0x070a12, 0.0095);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);

/* ------------------------------------------------------------------ *
 *  Studio environment + lights
 * ------------------------------------------------------------------ */

function gradientBackground() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#141d33');
  grad.addColorStop(0.42, '#0a1120');
  grad.addColorStop(1, '#05070d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function studioEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x05080f);

  const panel = (color, intensity, x, y, z, size, aspect = 1) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size * aspect),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  };

  panel(0xffffff, 3.0, 0, 12, 1, 11, 0.55);
  panel(0xbcd6ff, 1.7, -10, 5, -7, 8, 0.8);
  panel(0xffb37a, 1.35, 10, 4, 6, 7, 0.8);
  panel(0xffffff, 0.7, 2, 1, 11, 7, 0.6);
  panel(0x22385e, 0.9, 0, -9, 0, 12, 1);

  const env = pmrem.fromScene(envScene, 0.03);
  pmrem.dispose();
  envScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return env.texture;
}

scene.environment = studioEnvironment();

const hemi = new THREE.HemisphereLight(0xc6d9ff, 0x131722, 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff1dd, 2.7);
key.position.set(13, 24, 11);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -21;
key.shadow.camera.right = 21;
key.shadow.camera.top = 21;
key.shadow.camera.bottom = -21;
key.shadow.camera.near = 1;
key.shadow.camera.far = 70;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
scene.add(key);

const fill = new THREE.DirectionalLight(0x87b4ff, 1.0);
fill.position.set(-16, 10, -12);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffc89a, 0.75);
rim.position.set(-4, 7, 16);
scene.add(rim);

const facade = new THREE.DirectionalLight(0xffe3c8, 1.25);
facade.position.set(-12, 13, -15);
scene.add(facade);

/* ------------------------------------------------------------------ *
 *  Ground and baseplate
 * ------------------------------------------------------------------ */

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(160, 160),
  new THREE.MeshStandardMaterial({ color: 0x0a0f1b, roughness: 0.94, metalness: 0.08 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.63;
ground.receiveShadow = true;
scene.add(ground);

const baseMat = new THREE.MeshPhysicalMaterial({
  color: 0x2a3346,
  roughness: 0.6,
  metalness: 0.05,
  clearcoat: 0.28,
  clearcoatRoughness: 0.5,
  envMapIntensity: 0.7,
});

const baseMesh = new THREE.Mesh(new RoundedBoxGeometry(GRID, 0.62, GRID, 4, 0.16), baseMat);
baseMesh.position.y = -0.31;
baseMesh.receiveShadow = true;
baseMesh.castShadow = true;
scene.add(baseMesh);

const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 18, 1);
const studMat = new THREE.MeshPhysicalMaterial({
  color: 0x373f54,
  roughness: 0.55,
  metalness: 0.06,
  clearcoat: 0.25,
  clearcoatRoughness: 0.55,
  envMapIntensity: 0.6,
});
const plateStuds = new THREE.InstancedMesh(studGeo, studMat, GRID * GRID);
plateStuds.receiveShadow = true;
{
  const m = new THREE.Matrix4();
  let i = 0;
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      m.makeTranslation(x - GRID / 2 + 0.5, STUD_H / 2, z - GRID / 2 + 0.5);
      plateStuds.setMatrixAt(i++, m);
    }
  }
  plateStuds.instanceMatrix.needsUpdate = true;
}
scene.add(plateStuds);

// Soft pool of light on the floor for depth.
function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glow = new THREE.Mesh(
  new THREE.PlaneGeometry(74, 74),
  new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(96, 146, 255, 0.34)', 'rgba(96, 146, 255, 0)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.85,
  }),
);
glow.rotation.x = -Math.PI / 2;
glow.position.y = -0.615;
scene.add(glow);

const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 46),
  new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(0, 0, 0, 0.55)', 'rgba(0, 0, 0, 0)'),
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  }),
);
contact.rotation.x = -Math.PI / 2;
contact.position.y = -0.605;
scene.add(contact);

/* ------------------------------------------------------------------ *
 *  Shared brick geometry + materials
 * ------------------------------------------------------------------ */

const geomCache = new Map();
const matCache = new Map();

function brickGeometry(w, d) {
  const cacheKey = `${w}x${d}`;
  const cached = geomCache.get(cacheKey);
  if (cached) return cached;

  const body = new RoundedBoxGeometry(w - GAP, H, d - GAP, 3, 0.048);
  body.translate(0, H / 2, 0);
  const parts = [body];

  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const stud = new THREE.CylinderGeometry(STUD_R * 0.95, STUD_R, STUD_H, 18, 1, false);
      stud.translate(i - (w - 1) / 2, H + STUD_H / 2, j - (d - 1) / 2);
      parts.push(stud);
    }
  }

  const converted = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(converted, false);
  merged.computeBoundingSphere();
  new Set(parts.concat(converted)).forEach((p) => p.dispose());
  geomCache.set(cacheKey, merged);
  return merged;
}

function brickMaterial(hex) {
  const cached = matCache.get(hex);
  if (cached) return cached;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: 0.34,
    metalness: 0.0,
    clearcoat: 0.62,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });
  matCache.set(hex, mat);
  return mat;
}

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */

function readSoundPref() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

const state = {
  bricks: [],                // { mesh, data }
  brickMeshes: [],
  occ: new Map(),            // "x,z,level" -> brick
  sizeIndex: 5,
  rotated: false,
  color: COLORS[7],
  tool: 'build',
  hover: null,
  sound: readSoundPref(),
};

function viewDefaults() {
  const portrait = window.innerWidth / Math.max(1, window.innerHeight) < 0.85;
  return { radius: portrait ? 36 : 42, targetY: portrait ? 3.2 : 3.1, fov: portrait ? 52 : 42 };
}

const VIEW = viewDefaults();

const orbit = {
  theta: 3.85,
  phi: 1.0,
  radius: VIEW.radius,
  target: new THREE.Vector3(0, VIEW.targetY, 0),
  tTheta: 3.85,
  tPhi: 1.0,
  tRadius: VIEW.radius,
  tTarget: new THREE.Vector3(0, VIEW.targetY, 0),
};

const history = [];
const future = [];

/* ------------------------------------------------------------------ *
 *  Brick helpers
 * ------------------------------------------------------------------ */

const cellKey = (x, z, level) => `${x},${z},${level}`;
const centerX = (x, w) => x + w / 2 - GRID / 2;
const centerZ = (z, d) => z + d / 2 - GRID / 2;

function currentSize() {
  const s = SIZES[state.sizeIndex];
  return state.rotated ? { w: s.d, d: s.w } : { w: s.w, d: s.d };
}

function addBrick(data, { animate = false } = {}) {
  const mesh = new THREE.Mesh(brickGeometry(data.w, data.d), brickMaterial(data.color));
  mesh.position.set(centerX(data.x, data.w), data.level * H, centerZ(data.z, data.d));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const brick = { mesh, data };
  mesh.userData.brick = brick;
  state.bricks.push(brick);
  state.brickMeshes.push(mesh);

  for (let i = 0; i < data.w; i++) {
    for (let j = 0; j < data.d; j++) {
      state.occ.set(cellKey(data.x + i, data.z + j, data.level), brick);
    }
  }

  if (animate) {
    mesh.scale.set(0.72, 0.62, 0.72);
    mesh.position.y += 0.32;
    pops.push({ mesh, baseY: data.level * H, t: 0 });
  }
  return brick;
}

const pops = [];

function removeBrick(brick) {
  const { mesh, data } = brick;
  scene.remove(mesh);
  for (let i = 0; i < data.w; i++) {
    for (let j = 0; j < data.d; j++) {
      state.occ.delete(cellKey(data.x + i, data.z + j, data.level));
    }
  }
  state.bricks = state.bricks.filter((b) => b !== brick);
  state.brickMeshes = state.brickMeshes.filter((m) => m !== mesh);
}

function clearBricks() {
  for (const b of state.bricks) scene.remove(b.mesh);
  state.bricks = [];
  state.brickMeshes = [];
  state.occ.clear();
  pops.length = 0;
}

function countBricks() {
  return state.bricks.length;
}

/* ------------------------------------------------------------------ *
 *  Placement target
 * ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpNormal = new THREE.Vector3();

function targetFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects([baseMesh, ...state.brickMeshes], false);
  if (!hits.length) return null;

  const hit = hits[0];
  const point = hit.point;

  if (hit.object === baseMesh) {
    if (!hit.face || hit.face.normal.y < 0.5) return null;
    const i = Math.floor(point.x + GRID / 2);
    const j = Math.floor(point.z + GRID / 2);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null;
    const { w, d } = currentSize();
    return candidate(i, j, 0, w, d, null);
  }

  const brick = hit.object.userData.brick;
  if (!brick) return null;
  const data = brick.data;

  tmpNormal.copy(hit.face.normal);
  const onTop = tmpNormal.y > 0.6;
  let i = Math.floor(point.x + GRID / 2);
  let j = Math.floor(point.z + GRID / 2);
  let level = data.level;

  if (onTop) {
    level = data.level + 1;
  } else if (Math.abs(tmpNormal.x) > Math.abs(tmpNormal.z)) {
    i += Math.sign(tmpNormal.x);
  } else {
    j += Math.sign(tmpNormal.z);
  }

  i = clamp(i, 0, GRID - 1);
  j = clamp(j, 0, GRID - 1);
  const { w, d } = currentSize();
  return candidate(i, j, level, w, d, brick);
}

function candidate(i, j, level, w, d, hitBrick) {
  const x = i - Math.floor((w - 1) / 2);
  const z = j - Math.floor((d - 1) / 2);
  let valid = x >= 0 && z >= 0 && x + w <= GRID && z + d <= GRID && level >= 0 && level < MAX_LEVEL;

  if (valid) {
    let supported = level === 0;
    for (let a = 0; a < w && valid; a++) {
      for (let b = 0; b < d; b++) {
        if (state.occ.has(cellKey(x + a, z + b, level))) {
          valid = false;
          break;
        }
        if (!supported && state.occ.has(cellKey(x + a, z + b, level - 1))) supported = true;
      }
    }
    if (!supported) valid = false;
  }

  return { x, z, level, w, d, valid, brick: hitBrick };
}

/* ------------------------------------------------------------------ *
 *  Ghost preview + erase highlight
 * ------------------------------------------------------------------ */

const ghostMat = new THREE.MeshPhysicalMaterial({
  color: state.color.hex,
  roughness: 0.3,
  metalness: 0,
  clearcoat: 0.5,
  transparent: true,
  opacity: 0.58,
  depthWrite: false,
  emissive: new THREE.Color(state.color.hex),
  emissiveIntensity: 0.18,
});

const ghost = new THREE.Mesh(brickGeometry(SIZES[state.sizeIndex].w, SIZES[state.sizeIndex].d), ghostMat);
ghost.visible = false;
ghost.renderOrder = 4;
scene.add(ghost);

const highlightMat = new THREE.LineBasicMaterial({
  color: 0xffb27a,
  transparent: true,
  opacity: 0.95,
  depthTest: true,
});
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  highlightMat,
);
highlight.visible = false;
highlight.renderOrder = 6;
scene.add(highlight);

function refreshGhost() {
  if (!state.hover || state.tool !== 'build') {
    ghost.visible = false;
    return;
  }
  const t = state.hover;
  ghost.geometry = brickGeometry(t.w, t.d);
  ghost.position.set(centerX(t.x, t.w), t.level * H, centerZ(t.z, t.d));
  if (t.valid) {
    ghostMat.color.set(state.color.hex);
    ghostMat.emissive.set(state.color.hex);
    ghostMat.emissiveIntensity = 0.16;
    ghostMat.opacity = 0.5;
  } else {
    ghostMat.color.set('#ff2f2f');
    ghostMat.emissive.set('#ff2020');
    ghostMat.emissiveIntensity = 0.34;
    ghostMat.opacity = 0.42;
  }
  ghost.visible = true;
}

function refreshHighlight() {
  if (state.tool !== 'erase' || !state.hover || !state.hover.brick) {
    highlight.visible = false;
    return;
  }
  const { data: b } = state.hover.brick;
  highlight.position.set(centerX(b.x, b.w), b.level * H + H / 2, centerZ(b.z, b.d));
  highlight.scale.set(b.w + 0.06, H + 0.08, b.d + 0.06);
  highlight.visible = true;
}

function refreshPreview() {
  refreshGhost();
  refreshHighlight();
}

/* ------------------------------------------------------------------ *
 *  Interactions
 * ------------------------------------------------------------------ */

let audioCtx = null;

function ensureAudio() {
  if (!state.sound) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function blip(freq, dur, type, gain, slide = 0, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function soundPlace() {
  blip(520, 0.07, 'triangle', 0.07, 240);
  blip(980, 0.045, 'sine', 0.035, 90, 0.035);
}

function soundRemove() {
  blip(300, 0.09, 'triangle', 0.05, -110);
}

function soundDeny() {
  blip(180, 0.09, 'square', 0.025, -40);
}

function soundUi() {
  blip(720, 0.035, 'sine', 0.03, 80);
}

function pushHistory() {
  history.push(JSON.stringify(serialize()));
  if (history.length > 80) history.shift();
  future.length = 0;
  syncHistoryButtons();
}

function commitAndPlace(target) {
  if (!target) return;
  if (!target.valid) {
    if (target.brick) soundDeny();
    return;
  }
  pushHistory();
  addBrick(
    { x: target.x, z: target.z, level: target.level, w: target.w, d: target.d, color: state.color.hex },
    { animate: true },
  );
  soundPlace();
  state.hover = null;
  afterChange();
}

function commitAndErase(brick) {
  if (!brick) return;
  pushHistory();
  removeBrick(brick);
  soundRemove();
  state.hover = null;
  afterChange();
}

function afterChange() {
  refreshPreview();
  updateCount();
  queueAutosave();
}

function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(serialize()));
  rebuild(JSON.parse(history.pop()));
  soundUi();
  syncHistoryButtons();
}

function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(serialize()));
  rebuild(JSON.parse(future.pop()));
  soundUi();
  syncHistoryButtons();
}

function rebuild(bricks) {
  clearBricks();
  for (const data of bricks) addBrick(data, { animate: false });
  state.hover = null;
  refreshPreview();
  updateCount();
  queueAutosave();
}

function serialize() {
  return state.bricks.map(({ data }) => ({
    x: data.x,
    z: data.z,
    level: data.level,
    w: data.w,
    d: data.d,
    color: data.color,
  }));
}

/* ------------------------------------------------------------------ *
 *  Pointer + orbit controls
 * ------------------------------------------------------------------ */

const pointers = new Map();
let drag = null;
let pinch = null;
let downInfo = null;

function panBy(dx, dy) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  const scale = orbit.tRadius * 0.00115;
  orbit.tTarget.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
  orbit.tTarget.x = clamp(orbit.tTarget.x, -12, 12);
  orbit.tTarget.z = clamp(orbit.tTarget.z, -12, 12);
  orbit.tTarget.y = clamp(orbit.tTarget.y, 0.2, 10);
}

function onPointerDown(e) {
  if (e.button !== undefined && e.button > 2) return;
  if (!e.isPrimary && e.pointerType === 'mouse') return;

  closeHelpIfOpen();

  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    /* synthetic pointer events may not be capturable */
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    drag = null;
    downInfo = null;
    return;
  }

  if (pointers.size > 2) return;

  const isPan = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2);
  drag = { mode: isPan ? 'pan' : 'orbit', lastX: e.clientX, lastY: e.clientY };
  downInfo = { x: e.clientX, y: e.clientY, time: performance.now(), button: e.button, type: e.pointerType };
  canvas.classList.add('is-orbiting');
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinch.dist > 0 && dist > 0) {
      orbit.tRadius = clamp(orbit.tRadius * (pinch.dist / dist), 10, 72);
    }
    panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
    pinch = { dist, mid };
    return;
  }

  if (drag) {
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    if (downInfo) {
      const total = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
      if (total > 6) downInfo.moved = true;
    }

    if (drag.mode === 'orbit') {
      orbit.tTheta -= dx * 0.0062;
      orbit.tPhi = clamp(orbit.tPhi - dy * 0.0062, 0.2, 1.43);
    } else {
      panBy(dx, dy);
    }
    return;
  }

  if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
    state.hover = targetFromClient(e.clientX, e.clientY);
    refreshPreview();
  }
}

function onPointerUp(e) {
  const wasTap =
    downInfo &&
    !downInfo.moved &&
    pointers.size === 1 &&
    performance.now() - downInfo.time < 800 &&
    (!downInfo.button || downInfo.button === 0) &&
    !pinch;

  pointers.delete(e.pointerId);

  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    drag = null;
    canvas.classList.remove('is-orbiting');
  } else {
    drag = null;
  }

  if (wasTap) {
    const target = targetFromClient(e.clientX, e.clientY);
    if (state.tool === 'build') commitAndPlace(target);
    else commitAndErase(target?.brick);
    state.hover = null;
    refreshPreview();
  }

  downInfo = null;
}

function onPointerLeave(e) {
  if (e.pointerType === 'mouse' && !drag) {
    state.hover = null;
    refreshPreview();
  }
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('pointerleave', onPointerLeave);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.tRadius = clamp(orbit.tRadius * Math.exp(e.deltaY * 0.0011), 10, 72);
  },
  { passive: false },
);

/* ------------------------------------------------------------------ *
 *  Camera loop
 * ------------------------------------------------------------------ */

function updateCamera(dt) {
  orbit.theta = damp(orbit.theta, orbit.tTheta, 12, dt);
  orbit.phi = damp(orbit.phi, orbit.tPhi, 12, dt);
  orbit.radius = damp(orbit.radius, orbit.tRadius, 10, dt);
  orbit.target.x = damp(orbit.target.x, orbit.tTarget.x, 12, dt);
  orbit.target.y = damp(orbit.target.y, orbit.tTarget.y, 12, dt);
  orbit.target.z = damp(orbit.target.z, orbit.tTarget.z, 12, dt);

  const sinPhi = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.cos(orbit.phi),
    orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
}

function resize() {
  const panel = document.querySelector('.panel');
  const mobile = window.innerWidth <= 900;
  const w = window.innerWidth;
  const reserved = mobile && panel ? panel.offsetHeight : 0;
  const h = Math.max(220, window.innerHeight - reserved);
  document.documentElement.style.setProperty('--panel-height', `${reserved}px`);

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.85 ? 52 : 42;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.ResizeObserver) {
  new ResizeObserver(() => resize()).observe(document.querySelector('.panel'));
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */

const ui = {
  sizes: document.getElementById('sizes'),
  swatches: document.getElementById('swatches'),
  sizeLabel: document.getElementById('sizeLabel'),
  colorLabel: document.getElementById('colorLabel'),
  brickCount: document.getElementById('brickCount'),
  countChip: document.getElementById('countChip'),
  toast: document.getElementById('toast'),
  hint: document.getElementById('hint'),
  undo: document.getElementById('undoBtn'),
  redo: document.getElementById('redoBtn'),
  sound: document.getElementById('soundBtn'),
  help: document.getElementById('helpModal'),
  helpBtn: document.getElementById('helpBtn'),
  helpClose: document.getElementById('helpClose'),
  toolButtons: [...document.querySelectorAll('[data-tool]')],
};

let toastTimer = 0;

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function updateCount() {
  const n = countBricks();
  ui.brickCount.textContent = n;
  ui.countChip.title = `${n} brick${n === 1 ? '' : 's'} on the baseplate`;
}

function syncHistoryButtons() {
  ui.undo.disabled = history.length === 0;
  ui.redo.disabled = future.length === 0;
}

function updateSizeLabel() {
  const { w, d } = currentSize();
  ui.sizeLabel.textContent = `${w}×${d}`;
}

function selectSize(index, quiet = false) {
  state.sizeIndex = index;
  [...ui.sizes.children].forEach((btn, i) => {
    const active = i === state.sizeIndex;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  updateSizeLabel();
  refreshGhost();
  if (!quiet) soundUi();
}

function selectColor(color, quiet = false) {
  state.color = color;
  [...ui.swatches.children].forEach((btn) => {
    const active = btn.dataset.hex === color.hex;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  ui.colorLabel.textContent = color.name;
  refreshGhost();
  if (!quiet) soundUi();
}

function setTool(tool, quiet = false) {
  state.tool = tool;
  ui.toolButtons.forEach((btn) => {
    const active = btn.dataset.tool === tool;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  canvas.classList.toggle('is-erase', tool === 'erase');
  ui.hint.innerHTML = hintMarkup();
  refreshPreview();
  if (!quiet) soundUi();
}

function hintMarkup() {
  if (state.tool === 'build') {
    return '<span class="hint-dot" aria-hidden="true"></span>' +
      '<span class="hint-desktop">Drag to orbit <span class="sep">·</span> scroll to zoom <span class="sep">·</span> click to place</span>' +
      '<span class="hint-touch">Drag to orbit <span class="sep">·</span> tap to place</span>';
  }
  return '<span class="hint-dot" aria-hidden="true"></span>' +
    '<span class="hint-desktop">Click any brick to lift it off</span>' +
    '<span class="hint-touch">Tap a brick to lift it off</span>';
}

function rotate() {
  state.rotated = !state.rotated;
  updateSizeLabel();
  refreshGhost();
  soundUi();
}

function openHelp() {
  ui.help.hidden = false;
  ui.helpClose.focus();
}

function closeHelp() {
  if (ui.help.hidden) return;
  ui.help.hidden = true;
  ui.helpBtn.focus();
}

function closeHelpIfOpen() {
  if (!ui.help.hidden) closeHelp();
}

/* ------------------------------------------------------------------ *
 *  Persistence
 * ------------------------------------------------------------------ */

let autosaveTimer = 0;

function queueAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTO_KEY, JSON.stringify({ v: 1, bricks: serialize() }));
    } catch {
      /* storage may be unavailable */
    }
  }, 350);
}

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.bricks) ? parsed.bricks : null;
  } catch {
    return null;
  }
}

function loadBuild(bricks, message) {
  if (!bricks || !bricks.length) {
    toast(message || 'That save is empty');
    return;
  }
  clearBricks();
  for (const data of bricks) addBrick(data, { animate: false });
  history.length = 0;
  future.length = 0;
  syncHistoryButtons();
  state.hover = null;
  refreshPreview();
  updateCount();
  queueAutosave();
  if (message) toast(message);
}

function saveBuild() {
  try {
    localStorage.setItem(SLOT_KEY, JSON.stringify({ v: 1, bricks: serialize() }));
    toast('Build saved to this browser');
    soundUi();
  } catch {
    toast('Could not save in this browser');
  }
}

function exportPng() {
  renderer.render(scene, camera);
  try {
    const link = document.createElement('a');
    link.download = `brick-studio-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
    toast('PNG snapshot exported');
    soundUi();
  } catch {
    toast('Export is not available here');
  }
}

/* ------------------------------------------------------------------ *
 *  Demo build (first visit)
 * ------------------------------------------------------------------ */

function buildDemo() {
  // A brick rainbow: a half-annulus of six colour bands standing on the plate.
  const BANDS = ['#d0212c', '#f2761d', '#f4c62a', '#2c8a49', '#1566c9', '#7b4bd6'];
  const OUTER = 10;
  const INNER = 4;
  const CX = 12;

  for (let level = 0; level < 10; level++) {
    const row = [];
    for (let x = 0; x < GRID; x++) {
      const dx = x + 0.5 - CX;
      const dy = level + 0.5;
      const dist = Math.hypot(dx, dy);
      if (dist >= INNER && dist < OUTER) {
        const band = Math.min(BANDS.length - 1, Math.floor(OUTER - dist));
        row.push({ x, band });
      }
    }

    let i = 0;
    while (i < row.length) {
      let j = i;
      while (
        j + 1 < row.length &&
        row[j + 1].x === row[j].x + 1 &&
        row[j + 1].band === row[i].band
      ) {
        j += 1;
      }

      const color = BANDS[row[i].band];
      let cursor = row[i].x;
      const endX = row[j].x;
      while (cursor <= endX) {
        const w = Math.min(4, endX - cursor + 1);
        for (const z of [9, 11]) {
          addBrick({ x: cursor, z, level, w, d: 2, color }, { animate: false });
        }
        cursor += w;
      }
      i = j + 1;
    }
  }

  // A couple of flowers at the feet of the arch
  addBrick({ x: 8, z: 7, level: 0, w: 1, d: 1, color: '#7fae22' }, { animate: false });
  addBrick({ x: 15, z: 7, level: 0, w: 1, d: 1, color: '#df3f97' }, { animate: false });

  updateCount();
  queueAutosave();
}

/* ------------------------------------------------------------------ *
 *  UI wiring
 * ------------------------------------------------------------------ */

SIZES.forEach((s, index) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'size-btn';
  btn.dataset.size = String(index);
  btn.setAttribute('aria-label', `Brick ${s.w} by ${s.d}`);
  btn.style.setProperty('--cols', s.w);
  btn.style.setProperty('--rows', s.d);
  btn.innerHTML = `<span class="dots" aria-hidden="true">${'<i></i>'.repeat(s.w * s.d)}</span><span class="lbl">${s.w}×${s.d}</span>`;
  btn.addEventListener('click', () => selectSize(index));
  ui.sizes.appendChild(btn);
});

COLORS.forEach((color, index) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch';
  btn.dataset.hex = color.hex;
  btn.style.background = color.hex;
  btn.title = color.name;
  btn.setAttribute('aria-label', color.name);
  btn.addEventListener('click', () => selectColor(color));
  ui.swatches.appendChild(btn);
  if (index === 7) btn.classList.add('active');
});

ui.toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

document.getElementById('rotateBtn').addEventListener('click', rotate);
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!state.bricks.length) {
    toast('The baseplate is already empty');
    return;
  }
  pushHistory();
  clearBricks();
  afterChange();
  soundRemove();
  toast('Cleared — undo to bring it back');
});

document.getElementById('saveBtn').addEventListener('click', saveBuild);
document.getElementById('loadBtn').addEventListener('click', () => {
  const saved = readStore(SLOT_KEY);
  if (!saved) {
    toast('No saved build yet — press Save first');
    return;
  }
  loadBuild(saved, 'Saved build loaded');
});
document.getElementById('pngBtn').addEventListener('click', exportPng);

document.getElementById('resetBtn').addEventListener('click', () => {
  const defaults = viewDefaults();
  orbit.tTheta = 3.85;
  orbit.tPhi = 1.0;
  orbit.tRadius = defaults.radius;
  orbit.tTarget.set(0, defaults.targetY, 0);
  soundUi();
});

ui.sound.addEventListener('click', () => {
  state.sound = !state.sound;
  try {
    localStorage.setItem(SOUND_KEY, state.sound ? 'on' : 'off');
  } catch {
    /* storage may be unavailable */
  }
  ui.sound.setAttribute('aria-pressed', String(state.sound));
  if (state.sound) {
    ensureAudio();
    soundUi();
    toast('Sound on');
  } else {
    toast('Sound off');
  }
});
ui.sound.setAttribute('aria-pressed', String(state.sound));

ui.helpBtn.addEventListener('click', openHelp);
ui.helpClose.addEventListener('click', closeHelp);
ui.help.addEventListener('click', (e) => {
  if (e.target === ui.help) closeHelp();
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    closeHelp();
    return;
  }
  if (ui.help.hidden === false) return;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case 'b':
      setTool('build');
      break;
    case 'e':
      setTool('erase');
      break;
    case 'r':
      rotate();
      break;
    case 'f':
      document.getElementById('resetBtn').click();
      break;
    case 'm':
      ui.sound.click();
      break;
    case 'h':
    case '?':
      openHelp();
      break;
    default: {
      const n = Number(e.key);
      if (n >= 1 && n <= SIZES.length) selectSize(n - 1);
    }
  }
});

window.addEventListener('pagehide', () => {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify({ v: 1, bricks: serialize() }));
  } catch {
    /* ignore */
  }
});

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */

resize();
selectSize(state.sizeIndex, true);
selectColor(state.color, true);
setTool('build', true);
updateCount();
syncHistoryButtons();

const autosaved = readStore(AUTO_KEY);
if (autosaved) {
  for (const data of autosaved) addBrick(data, { animate: false });
  updateCount();
} else {
  buildDemo();
}

// Nice opening camera drift.
orbit.theta = 3.85 - 0.22;
orbit.tTheta = 3.85;

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  for (let i = pops.length - 1; i >= 0; i--) {
    const pop = pops[i];
    pop.t += dt * 5.5;
    const t = Math.min(pop.t, 1);
    const overshoot = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
    const s = 0.72 + 0.28 * overshoot;
    pop.mesh.scale.set(s, 0.62 + 0.38 * overshoot, s);
    pop.mesh.position.y = pop.baseY + (1 - t) * 0.32;
    if (t >= 1) {
      pop.mesh.scale.set(1, 1, 1);
      pop.mesh.position.y = pop.baseY;
      pops.splice(i, 1);
    }
  }

  updateCamera(dt);
  if (state.hover && state.tool === 'build') refreshGhost();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
