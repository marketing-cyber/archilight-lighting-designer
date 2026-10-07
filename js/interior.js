// The room's interior: shell (oak floor, plaster walls with thickness, skirting, window, art),
// furniture in a warm-minimal palette (oak, walnut, travertine, bouclé, linen) and soft contact
// shadows. Textures are drawn on canvases at run time: no image files, no canvas filters (Safari).
// Plan → world: x − L/2, height, y − W/2 (the back wall y = 0 is at world z = −W/2).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PALETTE = {
  plaster: '#ece6db', cut: '#3b3733', slab: '#2c2926', skirting: '#e6dfd2',
  oak: '#b48c63', walnut: '#6d4c35', travertine: '#d8cbb3', boucle: '#ddd4c6', linen: '#eeeae3',
  clay: '#b9a58a', olive: '#8c8a76', metal: '#2a2928', greige: '#cfc7b8', sage: '#a3a891', stone: '#cdbfaa',
};

// ---- Deterministic noise and canvas textures ----------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texCache = new Map();
function canvasTexture(key, size, draw, { repeat = true, color = true } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = size[0]; c.height = size[1];
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

const shade = (hex, f) => {
  const c = new THREE.Color(hex);
  return `#${c.multiplyScalar(f).getHexString()}`;
};

// Speckle multiplied over a material colour (values near white keep the colour).
function speckle(g, w, h, seed, amount, count) {
  const r = rng(seed);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = Math.round(255 - r() * amount);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

// Oak planks: 1024 px = 2.4 m, planks 0.18 m wide running along x.
export function oakFloor() {
  return canvasTexture('oak', [1024, 1024], (g, w, h) => {
    const r = rng(7);
    const px = w / 2.4, row = 0.18 * px;
    for (let y = 0; y < h; y += row) {
      let x = -r() * px;
      while (x < w) {
        const len = (0.9 + r() * 1.1) * px;
        const tone = 0.88 + r() * 0.2;
        g.fillStyle = shade(PALETTE.oak, tone);
        g.fillRect(x, y, len, row);
        for (let k = 0; k < 9; k++) {
          const gy = y + r() * row;
          g.strokeStyle = `rgba(70,45,25,${0.05 + r() * 0.08})`;
          g.lineWidth = 0.6 + r() * 1.2;
          g.beginPath();
          g.moveTo(x, gy);
          g.bezierCurveTo(x + len * 0.3, gy + (r() - 0.5) * 6, x + len * 0.7, gy + (r() - 0.5) * 6, x + len, gy + (r() - 0.5) * 4);
          g.stroke();
        }
        g.fillStyle = 'rgba(40,25,15,0.45)';
        g.fillRect(x, y, 1.5, row);
        x += len;
      }
      g.fillStyle = 'rgba(40,25,15,0.35)';
      g.fillRect(0, y, w, 1.2);
    }
  });
}

export const plaster = () => canvasTexture('plaster', [512, 512], (g, w, h) => {
  speckle(g, w, h, 11, 14, 9000);
  const r = rng(12);
  for (let i = 0; i < 40; i++) {
    const grd = g.createRadialGradient(r() * w, r() * h, 0, r() * w, r() * h, 40 + r() * 80);
    grd.addColorStop(0, 'rgba(0,0,0,0.035)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
});

export const fabric = () => canvasTexture('fabric', [256, 256], (g, w, h) => speckle(g, w, h, 21, 40, 7000));

export const travertine = () => canvasTexture('travertine', [512, 512], (g, w, h) => {
  speckle(g, w, h, 31, 18, 4000);
  const r = rng(32);
  for (let i = 0; i < 70; i++) {
    const y = r() * h;
    g.strokeStyle = `rgba(120,95,65,${0.05 + r() * 0.1})`;
    g.lineWidth = 0.5 + r() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 10, w * 0.6, y + (r() - 0.5) * 10, w, y + (r() - 0.5) * 8);
    g.stroke();
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(110,85,55,${0.1 + r() * 0.15})`;
    g.beginPath();
    g.ellipse(r() * w, r() * h, 1 + r() * 4, 0.5 + r(), 0, 0, Math.PI * 2);
    g.fill();
  }
});

export const woodGrain = (key, base) => canvasTexture(`grain-${key}`, [512, 512], (g, w, h) => {
  const r = rng(key.length * 97);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const y = r() * h;
    g.strokeStyle = `rgba(40,25,15,${0.04 + r() * 0.08})`;
    g.lineWidth = 0.5 + r() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(w * 0.33, y + (r() - 0.5) * 14, w * 0.66, y + (r() - 0.5) * 14, w, y + (r() - 0.5) * 10);
    g.stroke();
  }
});

export const rugTexture = () => canvasTexture('rug', [512, 512], (g, w, h) => {
  speckle(g, w, h, 41, 30, 30000);
  g.strokeStyle = 'rgba(120,100,75,0.35)';
  g.lineWidth = 10;
  g.strokeRect(22, 22, w - 44, h - 44);
  g.strokeStyle = 'rgba(120,100,75,0.18)';
  g.lineWidth = 3;
  g.strokeRect(40, 40, w - 80, h - 80);
}, { repeat: false });

export const curtainTexture = () => canvasTexture('curtain', [256, 64], (g, w, h) => {
  for (let x = 0; x < w; x++) {
    const v = Math.round(225 + 30 * Math.sin((x / w) * Math.PI * 10));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, h);
  }
});

const ART_PALETTES = [
  ['#e9e0d0', '#c08a64', '#8c9479', '#3f3b36'],
  ['#e4dccd', '#a9705a', '#d3b58f', '#5d6250'],
];

export function artTexture(seed) {
  return canvasTexture(`art-${seed}`, [384, 512], (g, w, h) => {
    const [bg, a, b, c] = ART_PALETTES[seed % ART_PALETTES.length];
    const r = rng(seed + 5);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // An arch, a sun and a horizon band: quiet shapes in earth tones.
    g.fillStyle = a;
    g.beginPath();
    g.moveTo(w * 0.18, h * 0.86);
    g.lineTo(w * 0.18, h * 0.5);
    g.arc(w * 0.42, h * 0.5, w * 0.24, Math.PI, 0);
    g.lineTo(w * 0.66, h * 0.86);
    g.fill();
    g.fillStyle = b;
    g.beginPath();
    g.arc(w * (0.62 + r() * 0.1), h * (0.3 + r() * 0.08), w * 0.13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c;
    g.fillRect(w * 0.1, h * 0.86, w * 0.8, h * 0.025);
  }, { repeat: false });
}

// Alpha maps read the green channel, so shadow strength is drawn as grey on black.
const shadowTex = () => canvasTexture('shadow', [128, 128], (g, w, h) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgb(140,140,140)');
  grd.addColorStop(0.55, 'rgb(80,80,80)');
  grd.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}, { repeat: false, color: false });

const edgeTex = () => canvasTexture('edge', [4, 64], (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgb(80,80,80)');
  grd.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}, { repeat: false, color: false });

const decal = (opacity) => new THREE.MeshBasicMaterial({
  color: 0x000000, alphaMap: null, transparent: true, opacity, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

export const backdrop = () => canvasTexture('backdrop', [8, 256], (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#2d2b28');
  grd.addColorStop(1, '#121211');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}, { repeat: false });

// ---- Mesh helpers -------------------------------------------------------------------------------

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });
const M = {
  oak: () => std('#ffffff', { map: woodGrain('oak', PALETTE.oak), roughness: 0.6 }),
  walnut: () => std('#ffffff', { map: woodGrain('walnut', PALETTE.walnut), roughness: 0.55 }),
  travertine: () => std(PALETTE.travertine, { map: travertine(), roughness: 0.5 }),
  boucle: (c = PALETTE.boucle) => std(c, { map: fabric(), roughness: 1 }),
  linen: (c = PALETTE.linen) => std(c, { map: fabric(), roughness: 1 }),
  metal: () => std(PALETTE.metal, { roughness: 0.4, metalness: 0.5 }),
  paint: (c) => std(c, { roughness: 0.7 }),
};

function rbox(w, h, d, r, material, x = 0, y = 0, z = 0) {
  const rad = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rad), material);
  m.position.set(x, y, z);
  return m;
}
const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
};
const cyl = (rt, rb, h, material, x = 0, y = 0, z = 0, seg = 32) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  return m;
};
const asTop = (m) => { m.userData.top = true; return m; };

function legs4(w, d, h, inset, material, r = 0.018) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => cyl(r, r * 0.8, h, material, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset), 10));
}

// Vertical flutes across a front face: `len` wide, centred at `at` (local), facing `normal` (±x or ±z).
function flutes(len, h, y0, at, normal, material) {
  const g = new THREE.Group();
  const n = Math.max(4, Math.floor(len / 0.045));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (len * (i + 0.5)) / n;
    const f = cyl(0.016, 0.016, h, material, 0, y0 + h / 2, 0, 8);
    if (normal.x) f.position.set(at.x, y0 + h / 2, at.z + t);
    else f.position.set(at.x + t, y0 + h / 2, at.z);
    g.add(f);
  }
  return g;
}

function bookStack(seed) {
  const r = rng(seed);
  const g = new THREE.Group();
  const colors = ['#c9b79c', '#8d8a7a', '#b07a5a', '#e5ded2', '#5f5a52'];
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const t = 0.025 + r() * 0.015;
    const b = box(0.24 - i * 0.02, t, 0.17 - i * 0.01, M.paint(colors[Math.floor(r() * colors.length)]), (r() - 0.5) * 0.02, y + t / 2, 0);
    b.rotation.y = (r() - 0.5) * 0.3;
    g.add(b);
    y += t;
  }
  return g;
}

function vase(h, color) {
  const pts = [[0, 0], [0.05, 0], [0.07, h * 0.25], [0.075, h * 0.5], [0.045, h * 0.85], [0.035, h]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 28), std(color, { roughness: 0.85 }));
}

function plantModel(f, seed) {
  const g = new THREE.Group();
  const r = rng(seed);
  const potH = Math.min(0.45, f.h * 0.28);
  const potPts = [[0, 0], [0.17, 0], [0.21, potH * 0.85], [0.215, potH], [0.19, potH]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(potPts, 28), std(PALETTE.stone, { map: fabric(), roughness: 0.95 })));
  g.add(cyl(0.18, 0.18, 0.02, std('#3d3027', { roughness: 1 }), 0, potH - 0.03, 0));
  const trunkH = f.h * 0.55;
  const trunk = cyl(0.018, 0.026, trunkH, std('#6b5a48', { roughness: 0.9 }), 0, potH + trunkH / 2 - 0.05, 0, 8);
  g.add(trunk);
  const leafMats = ['#7b8466', '#6d775a', '#8a9272', '#636c50'].map((c) => std(c, { roughness: 0.85, side: THREE.DoubleSide }));
  // Olive-like crown: clusters of small narrow leaves around a few branch tips.
  const crownY = potH + trunkH * 0.85, crownR = 0.3;
  const leafGeo = new THREE.SphereGeometry(0.035, 6, 4);
  for (let c = 0; c < 9; c++) {
    const a = r() * Math.PI * 2, rad = crownR * (0.3 + 0.7 * r());
    const tip = new THREE.Vector3(Math.cos(a) * rad, crownY + (r() - 0.25) * (f.h - crownY) * 0.9, Math.sin(a) * rad);
    const base = new THREE.Vector3(0, crownY - 0.05, 0);
    const branch = cyl(0.003, 0.005, tip.distanceTo(base), std('#6b5a48'), 0, 0, 0, 5);
    branch.position.copy(base).add(tip).multiplyScalar(0.5);
    branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize());
    g.add(branch);
    for (let i = 0; i < 30; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMats[Math.floor(r() * leafMats.length)]);
      // more leaves toward the tip, a few along the branch
      const along = Math.sqrt(r());
      const p = base.clone().lerp(tip, 0.35 + 0.65 * along);
      leaf.position.set(p.x + (r() - 0.5) * 0.26, p.y + (r() - 0.5) * 0.22, p.z + (r() - 0.5) * 0.26);
      leaf.scale.set(0.45, 0.3, 1.6);
      leaf.rotation.set(r() * 3, r() * 3, r() * 3);
      g.add(leaf);
    }
  }
  return g;
}

// Which way the piece's front faces, from the wall it stands against.
function frontOf(f, size) {
  if (f.x + f.w / 2 > size.length - 0.15) return new THREE.Vector3(-1, 0, 0);
  if (f.x - f.w / 2 < 0.15) return new THREE.Vector3(1, 0, 0);
  if (f.y + f.d / 2 > size.width - 0.15) return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 0, 1);
}

function cabinet(f, size, body, topMat, { legs = true, fluted = false, decor = false, seed = 1 } = {}) {
  const g = new THREE.Group();
  const legH = legs ? 0.12 : 0.06;
  if (legs) g.add(...legs4(f.w, f.d, legH, 0.06, M.metal(), 0.012));
  else g.add(box(f.w - 0.08, legH, f.d - 0.08, std(PALETTE.slab, { roughness: 0.9 }), 0, legH / 2, 0));
  const bodyH = f.h - legH - 0.03;
  g.add(rbox(f.w, bodyH, f.d, 0.02, body, 0, legH + bodyH / 2, 0));
  g.add(asTop(rbox(f.w + 0.02, 0.03, f.d + 0.02, 0.008, topMat, 0, f.h - 0.015, 0)));
  const front = frontOf(f, size);
  const len = front.x ? f.d : f.w;
  const at = new THREE.Vector3(front.x * (f.w / 2 + 0.004), 0, front.z * (f.d / 2 + 0.004));
  if (fluted) g.add(flutes(len - 0.06, bodyH - 0.04, legH + 0.02, at, front, body));
  else {
    // door / drawer seams
    const seams = Math.max(1, Math.round(len / 0.5));
    for (let i = 1; i < seams; i++) {
      const t = -len / 2 + (len * i) / seams;
      const s = box(front.x ? 0.004 : 0.006, bodyH - 0.04, front.x ? 0.006 : 0.004, std('#2a2420'), 0, legH + bodyH / 2, 0);
      if (front.x) s.position.set(at.x, s.position.y, t); else s.position.set(t, s.position.y, at.z);
      g.add(s);
    }
  }
  if (decor) {
    const v = vase(0.3, '#d6cbb9');
    v.position.set(0, f.h, 0);
    g.add(v);
    const b = bookStack(seed);
    b.position.set(front.x ? 0 : -f.w * 0.12, f.h, front.x ? f.d * 0.12 : 0);
    g.add(b);
  }
  return g;
}

function seat(f, kind) {
  const g = new THREE.Group();
  const back = f.back || -1;
  const metal = M.metal();
  if (kind === 'stool') {
    g.add(cyl(0.02, 0.02, f.h - 0.05, metal, 0, (f.h - 0.05) / 2, 0, 10));
    g.add(cyl(0.17, 0.19, 0.015, metal, 0, 0.008, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.008, 6, 28), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.28;
    g.add(ring);
    g.add(rbox(0.38, 0.06, 0.38, 0.025, M.boucle(), 0, f.h - 0.03, 0));
    return g;
  }
  if (kind === 'task-chair') {
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5;
      const arm = box(0.28, 0.03, 0.035, metal, Math.cos(a) * 0.14, 0.05, Math.sin(a) * 0.14);
      arm.rotation.y = -a;
      g.add(arm);
    }
    g.add(cyl(0.022, 0.022, 0.38, metal, 0, 0.24, 0, 10));
    g.add(rbox(0.5, 0.08, 0.48, 0.035, M.boucle(PALETTE.olive), 0, 0.47, 0));
    g.add(rbox(0.46, 0.42, 0.06, 0.03, M.boucle(PALETTE.olive), 0, 0.76, back * 0.22));
    return g;
  }
  const oak = M.oak();
  g.add(...legs4(f.w - 0.02, f.d - 0.02, 0.44, 0.04, oak, 0.015));
  g.add(rbox(f.w, 0.045, f.d, 0.015, oak, 0, 0.455, 0));
  g.add(rbox(f.w - 0.06, 0.04, f.d - 0.06, 0.018, M.linen(PALETTE.clay), 0, 0.495, 0));
  g.add(rbox(f.w, 0.3, 0.035, 0.015, oak, 0, f.h - 0.15, back * (f.d / 2 - 0.02)));
  return g;
}

function sofa(f) {
  const g = new THREE.Group();
  const back = f.back || -1;
  const fab = M.boucle();
  g.add(box(f.w - 0.12, 0.06, f.d - 0.12, std(PALETTE.slab, { roughness: 0.9 }), 0, 0.03, 0));
  g.add(rbox(f.w, 0.3, f.d, 0.06, fab, 0, 0.21, 0));
  const armW = 0.2, inner = f.w - armW * 2;
  const n = inner > 1.9 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const cx = -inner / 2 + (inner * (i + 0.5)) / n;
    g.add(rbox(inner / n - 0.015, 0.14, f.d - 0.26, 0.06, fab, cx, 0.42, -back * 0.08)); // seat cushions sit forward of the back cushions
    g.add(rbox(inner / n - 0.02, 0.4, 0.22, 0.09, fab, cx, 0.58, back * (f.d / 2 - 0.14)));
  }
  for (const s of [-1, 1]) g.add(rbox(armW, 0.58, f.d, 0.09, fab, s * (f.w / 2 - armW / 2), 0.29, 0));
  const pillows = [PALETTE.clay, PALETTE.olive];
  pillows.forEach((c, i) => {
    const p = rbox(0.42, 0.4, 0.13, 0.06, M.linen(c), (i ? 1 : -1) * (inner / 2 - 0.3), 0.66, back * (f.d / 2 - 0.3));
    p.rotation.z = (i ? -1 : 1) * 0.12;
    p.rotation.x = back * 0.15;
    g.add(p);
  });
  return g;
}

function bed(f) {
  const g = new THREE.Group();
  const back = f.back || -1;
  const up = M.boucle(PALETTE.stone);
  g.add(rbox(f.w, 0.3, f.d, 0.05, up, 0, 0.15, 0));
  g.add(rbox(f.w - 0.06, 0.18, f.d - 0.1, 0.06, M.linen('#f4f1ec'), 0, 0.39, 0));
  g.add(rbox(f.w + 0.03, 0.07, f.d * 0.68, 0.035, M.linen(PALETTE.linen), 0, 0.5, -back * f.d * 0.16));
  g.add(rbox(f.w + 0.05, 0.05, 0.42, 0.025, M.linen(PALETTE.clay), 0, 0.545, -back * (f.d / 2 - 0.3)));
  g.add(rbox(f.w + 0.2, 1.15, 0.1, 0.05, up, 0, 0.575, back * (f.d / 2 + 0.02)));
  for (const s of [-1, 1]) {
    const p = rbox(f.w * 0.42, 0.15, 0.4, 0.07, M.linen('#faf8f4'), s * f.w * 0.23, 0.55, back * (f.d / 2 - 0.3));
    p.rotation.x = back * 0.35;
    g.add(p);
  }
  const c = rbox(0.42, 0.32, 0.12, 0.05, M.linen(PALETTE.olive), 0, 0.62, back * (f.d / 2 - 0.45));
  c.rotation.x = back * 0.25;
  g.add(c);
  return g;
}

export function furnitureModel(f, size, seed = 1) {
  const g = new THREE.Group();
  switch (f.kind) {
    case 'rug': g.add(rbox(f.w, 0.012, f.d, 0.004, std(PALETTE.boucle, { map: rugTexture(), roughness: 1 }), 0, 0.006, 0)); break;
    case 'sofa': g.add(sofa(f)); break;
    case 'bed': g.add(bed(f)); break;
    case 'chair': case 'stool': case 'task-chair': g.add(seat(f, f.kind)); break;
    case 'plant': g.add(plantModel(f, seed)); break;
    case 'side-table': {
      const r = Math.min(f.w, f.d) / 2;
      const oak = M.oak();
      g.add(asTop(cyl(r, r, 0.035, oak, 0, f.h - 0.0175, 0, 40)));
      g.add(cyl(0.05, 0.06, f.h - 0.06, oak, 0, (f.h - 0.06) / 2 + 0.025, 0, 20));
      g.add(cyl(r * 0.7, r * 0.75, 0.025, oak, 0, 0.0125, 0, 40));
      break;
    }
    case 'cafe-table': {
      const r = Math.min(f.w, f.d) / 2;
      g.add(asTop(cyl(r, r, 0.03, M.travertine(), 0, f.h - 0.015, 0, 40)));
      g.add(cyl(0.03, 0.03, f.h - 0.04, M.metal(), 0, (f.h - 0.04) / 2 + 0.01, 0, 12));
      g.add(cyl(0.22, 0.24, 0.02, M.metal(), 0, 0.01, 0, 32));
      break;
    }
    case 'coffee-table': {
      g.add(asTop(rbox(f.w, f.h, f.d, 0.07, M.travertine(), 0, f.h / 2, 0)));
      const b = bookStack(seed + 3);
      b.position.set(-f.w * 0.22, f.h, 0);
      g.add(b);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std('#2f2b27', { roughness: 0.6, side: THREE.DoubleSide }));
      bowl.position.set(f.w * 0.2, f.h + 0.06, 0);
      g.add(bowl);
      break;
    }
    case 'dining-table': case 'desk': {
      const oak = M.oak();
      g.add(asTop(rbox(f.w, 0.04, f.d, 0.015, oak, 0, f.h - 0.02, 0)));
      if (f.kind === 'desk') {
        for (const s of [-1, 1]) {
          g.add(box(0.03, f.h - 0.04, 0.03, M.metal(), s * (f.w / 2 - 0.06), (f.h - 0.04) / 2, -(f.d / 2 - 0.06)));
          g.add(box(0.03, f.h - 0.04, 0.03, M.metal(), s * (f.w / 2 - 0.06), (f.h - 0.04) / 2, f.d / 2 - 0.06));
          g.add(box(0.03, 0.03, f.d - 0.1, M.metal(), s * (f.w / 2 - 0.06), 0.015, 0));
        }
        g.add(rbox(0.33, 0.012, 0.23, 0.004, std('#bfc0bd', { metalness: 0.6, roughness: 0.35 }), f.w * 0.12, f.h + 0.006, 0.05));
      } else {
        for (const s of [-1, 1]) g.add(rbox(0.1, f.h - 0.04, f.d * 0.6, 0.03, oak, s * (f.w / 2 - 0.3), (f.h - 0.04) / 2, 0));
        const v = vase(0.26, '#cbbfae');
        v.position.set(0, f.h, 0);
        g.add(v);
      }
      break;
    }
    case 'nightstand': {
      const oak = M.oak();
      g.add(asTop(rbox(f.w, f.h - 0.05, f.d, 0.02, oak, 0, (f.h - 0.05) / 2 + 0.05, 0)));
      g.add(box(f.w - 0.1, 0.05, f.d - 0.1, std(PALETTE.slab, { roughness: 0.9 }), 0, 0.025, 0));
      g.add(box(f.w - 0.06, 0.006, 0.004, std('#2a2420'), 0, f.h * 0.62, f.d / 2 + 0.002));
      break;
    }
    case 'sideboard': g.add(cabinet(f, size, M.walnut(), M.walnut(), { fluted: true, decor: true, seed })); break;
    case 'dresser': g.add(cabinet(f, size, M.walnut(), M.walnut(), { decor: true, seed })); break;
    case 'console': g.add(cabinet(f, size, M.walnut(), M.travertine(), { fluted: true, decor: true, seed })); break;
    case 'counter': {
      g.add(cabinet(f, size, M.paint(PALETTE.greige), M.travertine(), { legs: false }));
      // splashback and a floating oak shelf on the wall behind
      g.add(box(f.w, 0.55, 0.02, M.travertine(), 0, f.h + 0.275, -f.d / 2 + 0.01));
      g.add(rbox(Math.min(1.6, f.w * 0.5), 0.04, 0.24, 0.01, M.oak(), f.w * 0.18, f.h + 0.85, -f.d / 2 + 0.12));
      for (let i = 0; i < 3; i++) {
        const j = vase(0.16 + i * 0.04, ['#e2d9c8', '#b9a58a', '#8c8a76'][i]);
        j.position.set(f.w * 0.18 - 0.3 + i * 0.25, f.h + 0.87, -f.d / 2 + 0.12);
        g.add(j);
      }
      break;
    }
    case 'island': g.add(cabinet(f, size, M.oak(), M.travertine(), { legs: false, fluted: true })); break;
    case 'bar': g.add(cabinet(f, size, M.walnut(), M.travertine(), { legs: false, fluted: true })); break;
    case 'display': g.add(asTop(rbox(f.w, f.h, f.d, 0.04, M.travertine(), 0, f.h / 2, 0))); break;
    case 'shelving': {
      const oak = M.oak();
      for (const s of [-1, 1]) g.add(box(0.03, f.h, f.d, oak, s * (f.w / 2 - 0.015), f.h / 2, 0));
      const r = rng(seed + 9);
      const colors = ['#e2d9c8', '#b9a58a', '#8c8a76', '#cfc7b8', '#6d4c35'];
      for (let i = 0; i < 5; i++) {
        const y = 0.1 + (i * (f.h - 0.15)) / 4;
        g.add(box(f.w - 0.06, 0.025, f.d, oak, 0, y, 0));
        if (i === 4) continue;
        for (let x = -f.w / 2 + 0.2; x < f.w / 2 - 0.2; x += 0.35 + r() * 0.35) {
          const ob = r() > 0.5 ? vase(0.15 + r() * 0.15, colors[Math.floor(r() * 5)])
            : box(0.18, 0.2 + r() * 0.1, 0.25, M.paint(colors[Math.floor(r() * 5)]), 0, 0, 0);
          ob.position.set(x, y + 0.0125 + (ob.geometry.type === 'BoxGeometry' ? ob.geometry.parameters.height / 2 : 0), 0);
          g.add(ob);
        }
      }
      break;
    }
    default: g.add(asTop(rbox(f.w, f.h, f.d, 0.02, M.oak(), 0, f.h / 2, 0)));
  }
  return g;
}

// Soft shadow under a piece (rugs excluded).
export function contactShadow(f) {
  const round = ['plant', 'side-table', 'cafe-table', 'stool', 'task-chair'].includes(f.kind);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(f.w + 0.35, f.d + 0.35),
    Object.assign(decal(round ? 0.7 : 0.9), { alphaMap: shadowTex() }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.renderOrder = 1;
  return m;
}

// ---- Shell --------------------------------------------------------------------------------------

const WALL_T = 0.12;

function wallFeatureModel(ft, seed, glass) {
  const g = new THREE.Group();
  if (ft.kind === 'art') {
    g.add(box(ft.w + 0.05, ft.hgt + 0.05, 0.03, M.oak(), 0, 0, 0.015));
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(ft.w - 0.06, ft.hgt - 0.06), std('#ffffff', { map: artTexture(seed), roughness: 0.9 }));
    canvas.position.z = 0.031;
    g.add(canvas);
    return g;
  }
  // window: bronze frame, glass that shows the sky, linen curtains to the floor
  const frame = std('#4a4540', { roughness: 0.45, metalness: 0.4 });
  const t = 0.05;
  g.add(box(ft.w, t, 0.07, frame, 0, ft.hgt / 2 - t / 2, 0.035), box(ft.w, t, 0.07, frame, 0, -ft.hgt / 2 + t / 2, 0.035));
  g.add(box(t, ft.hgt, 0.07, frame, -ft.w / 2 + t / 2, 0, 0.035), box(t, ft.hgt, 0.07, frame, ft.w / 2 - t / 2, 0, 0.035));
  g.add(box(0.03, ft.hgt - 2 * t, 0.05, frame, 0, 0, 0.035));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(ft.w - 2 * t, ft.hgt - 2 * t), glass);
  pane.position.z = 0.01;
  g.add(pane);
  g.add(box(ft.w + 0.1, 0.03, 0.12, std(PALETTE.skirting), 0, -ft.hgt / 2 - 0.015, 0.06));
  return g;
}

function curtains(ft, H) {
  const g = new THREE.Group();
  const mat = std(PALETTE.linen, { map: curtainTexture(), roughness: 1, transparent: true, opacity: 0.94 });
  const h = H - 0.12;
  for (const s of [-1, 1]) {
    const c = rbox(0.42, h, 0.06, 0.025, mat, s * (ft.w / 2 + 0.17), h / 2, 0.12);
    g.add(c);
  }
  const rod = cyl(0.012, 0.012, ft.w + 0.9, M.metal(), 0, h + 0.03, 0.12, 10);
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
  return g;
}

// Walls are separate groups, keyed n/e/s/w, so the view can hide the ones between camera and room.
export function buildShell(size, features) {
  const { length: L, width: W, height: H } = size;
  const root = new THREE.Group();
  const walls = {};
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), std('#ffffff', { map: oakFloor().clone(), roughness: 0.55 }));
  floor.material.map.repeat.set(L / 2.4, W / 2.4);
  floor.material.map.needsUpdate = true;
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);
  // Base slab top sits just under the floor plane (same height would z-fight).
  root.add(box(L + 2 * WALL_T, 0.2, W + 2 * WALL_T, std(PALETTE.slab, { roughness: 0.9 }), 0, -0.106, 0));

  const plasterMat = std(PALETTE.plaster, { map: plaster(), roughness: 0.95 });
  const cut = std(PALETTE.cut, { roughness: 0.9 });
  const skirting = std(PALETTE.skirting, { roughness: 0.6 });
  const edge = Object.assign(decal(0.6), { alphaMap: edgeTex() });
  const glass = std('#000000', { roughness: 0.1, metalness: 0 });
  glass.emissive = new THREE.Color('#9db3c9');

  // [face, length along wall, centre, rotation that turns +z into the room]
  const defs = {
    n: { len: L, pos: [0, -W / 2], rotY: 0 },
    s: { len: L, pos: [0, W / 2], rotY: Math.PI },
    w: { len: W, pos: [-L / 2, 0], rotY: Math.PI / 2 },
    e: { len: W, pos: [L / 2, 0], rotY: -Math.PI / 2 },
  };
  let seed = 1;
  for (const [face, d] of Object.entries(defs)) {
    const g = new THREE.Group();
    g.position.set(d.pos[0], 0, d.pos[1]);
    g.rotation.y = d.rotY;
    // In wall-local space the room is toward +z; the wall body sits behind z = 0.
    const extra = face === 'n' || face === 's' ? 2 * WALL_T : 0;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(d.len + extra, H, WALL_T), [cut, cut, cut, cut, plasterMat, cut]);
    slab.position.set(0, H / 2, -WALL_T / 2);
    g.add(slab);
    g.add(box(d.len, 0.08, 0.014, skirting, 0, 0.04, 0.007));
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(d.len, 0.35), edge);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.003, 0.175);
    shadow.renderOrder = 1;
    g.add(shadow);
    // along-wall coordinate → wall-local x (n: +x; s: −x; w: plan y runs toward −local x… see rotY)
    const localX = (along) => (face === 'n' ? along - L / 2 : face === 's' ? L / 2 - along : face === 'w' ? W / 2 - along : along - W / 2);
    for (const ft of features.filter((x) => x.face === face)) {
      const m = wallFeatureModel(ft, seed++, glass);
      m.position.set(localX(ft.along), ft.h, 0);
      g.add(m);
      if (ft.kind === 'window') {
        const c = curtains(ft, H);
        c.position.x = localX(ft.along);
        g.add(c);
      }
    }
    root.add(g);
    walls[face] = g;
  }
  return { root, walls, glass };
}
