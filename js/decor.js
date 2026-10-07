// Decorative lights (pendants, wall lights, table and floor lamps): default placement and
// surface-bound moves. Pure — no DOM, no three.js.
// An item is { id, pid, x, y, h, face }:
//   face 'ceiling' (pendants): h = height of the fitting's bottom;
//   face 'n' | 'e' | 's' | 'w' (wall lights): on that wall (n: y = 0, s: y = W, w: x = 0, e: x = L), h = centre height;
//   face 'top' | 'floor' (lamps): h = height of the surface it stands on.
import { DECOR_PRODUCTS } from './decor-data.js';
import { supportAt, blockedAt, wallFeatures } from './furniture.js';

export const DECOR = DECOR_PRODUCTS;
const byId = new Map(DECOR.map((p) => [p.id, p]));
export const decorById = (id) => byId.get(id);
export const WALL_FACES = ['n', 'e', 's', 'w'];
export const FACES = ['ceiling', 'floor', 'top', ...WALL_FACES];

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const r2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const sizeOf = (p) => ({ w: p.widthCm / 100, h: p.heightCm / 100 });
// Decorative listings rarely state lumens; ~80 lm/W is typical for warm LED in a diffusing shade.
export const lumensOf = (p) => p.lm || Math.round(p.watts * 80);
export const wallLength = (face, size) => (face === 'n' || face === 's' ? size.length : size.width);
const alongOf = (it) => (it.face === 'n' || it.face === 's' ? it.x : it.y);

// Allowed height range for an item of product p (see the face notes above).
export function heightRange(p, face, size) {
  const { h: ph } = sizeOf(p);
  const H = size.height;
  if (face === 'ceiling') return [1.2, r2(H - ph - 0.1)];
  if (WALL_FACES.includes(face)) return [r2(0.3 + ph / 2), r2(H - 0.1 - ph / 2)];
  return [0, 0];
}

// Snap an item onto a surface its kind allows, inside the room.
export function normalize(it, size, furniture) {
  const p = decorById(it.pid);
  const { length: L, width: W } = size;
  const { w: pw } = sizeOf(p);
  const out = { id: it.id, pid: it.pid };
  if (p.kind === 'pendant') {
    const [lo, hi] = heightRange(p, 'ceiling', size);
    Object.assign(out, { face: 'ceiling', x: clamp(it.x, pw / 2, L - pw / 2), y: clamp(it.y, pw / 2, W - pw / 2), h: clamp(it.h, lo, hi) });
  } else if (p.kind === 'wall') {
    const face = WALL_FACES.includes(it.face) ? it.face : 'n';
    const len = wallLength(face, size);
    const along = clamp(WALL_FACES.includes(it.face) ? alongOf(it) : it.x, pw / 2 + 0.05, len - pw / 2 - 0.05);
    const [lo, hi] = heightRange(p, face, size);
    const pos = { n: [along, 0], s: [along, W], w: [0, along], e: [L, along] }[face];
    Object.assign(out, { face, x: pos[0], y: pos[1], h: clamp(it.h, lo, hi) });
  } else {
    const m = p.kind === 'floor' ? 0.25 : 0.1;
    const x = clamp(it.x, m, L - m), y = clamp(it.y, m, W - m);
    const h = p.kind === 'floor' ? 0 : supportAt(furniture, x, y);
    Object.assign(out, { face: h > 0 ? 'top' : 'floor', x, y, h });
  }
  out.x = r2(out.x); out.y = r2(out.y); out.h = r2(out.h);
  // the scheme's layer and reason travel with the light
  if (it.role) out.role = it.role;
  if (it.why) out.why = it.why;
  return out;
}

export const fitDecor = (decor, size, furniture) => decor.filter((d) => decorById(d.pid)).map((d) => normalize(d, size, furniture));

const nextId = (decor) => `a${1 + Math.max(0, ...decor.map((d) => parseInt(d.id.slice(1), 10) || 0))}`;

const PENDANT_OVER = ['dining-table', 'island', 'bar', 'desk', 'display', 'cafe-table', 'coffee-table'];
const LAMP_ON = ['nightstand', 'side-table', 'sideboard', 'dresser', 'console', 'desk', 'counter', 'bar', 'display', 'cafe-table', 'coffee-table'];

function pendantSpot(decor, p, size, furniture) {
  const { w: pw, h: ph } = sizeOf(p);
  const H = size.height;
  const table = PENDANT_OVER.map((k) => furniture.find((f) => f.kind === k)).find(Boolean);
  const cx = table ? table.x : size.length / 2, cy = table ? table.y : size.width / 2;
  const others = decor.filter((d) => decorById(d.pid)?.kind === 'pendant');
  const step = Math.max(0.45, pw + 0.15);
  const offsets = [0, -1, 1, -2, 2, -3, 3];
  const x = cx + step * (offsets.find((o) => !others.some((d) => Math.abs(d.x - (cx + o * step)) < step * 0.9 && Math.abs(d.y - cy) < step)) ?? 0);
  // Over a table: about 0.8 m above its top. Elsewhere: high enough to walk under.
  const h = table && table.h >= 0.7 ? table.h + 0.8 : Math.max(2.05, H - 0.5 - ph);
  return { x, y: cy, h, face: 'ceiling' };
}

function wallSpot(decor, p, size, furniture, room) {
  const walls = decor.filter((d) => WALL_FACES.includes(d.face));
  const { w: pw, h: ph } = sizeOf(p);
  const features = wallFeatures(room, size, furniture);
  const taken = (face, along, h = 1.8) => walls.some((d) => d.face === face && Math.abs(alongOf(d) - along) < 0.5)
    || features.some((f) => f.face === face && Math.abs(f.along - along) < f.w / 2 + pw / 2 + 0.15 && Math.abs(f.h - h) < f.hgt / 2 + ph / 2 + 0.1);
  const tall = (face, along, h) => furniture.some((f) => f.kind !== 'rug' && f.h > h - ph / 2 - 0.1 && (
    face === 'n' ? f.y - f.d / 2 < 0.1 && Math.abs(f.x - along) < f.w / 2 + 0.2
      : face === 'w' ? f.x - f.w / 2 < 0.1 && Math.abs(f.y - along) < f.d / 2 + 0.2
        : face === 'e' ? f.x + f.w / 2 > size.length - 0.1 && Math.abs(f.y - along) < f.d / 2 + 0.2 : false));
  if (room === 'bedroom') {
    for (const n of furniture.filter((f) => f.kind === 'nightstand')) {
      if (!taken('n', n.x, 1.15)) return { face: 'n', x: n.x, y: 0, h: 1.15 };
    }
  }
  for (const face of ['n', 'w', 'e']) {
    const len = wallLength(face, size);
    for (const k of [0.25, 0.75, 0.5, 0.125, 0.875, 0.375, 0.625]) {
      const along = len * k;
      if (taken(face, along) || tall(face, along, 1.8)) continue;
      return face === 'n' ? { face, x: along, y: 0, h: 1.8 } : { face, x: face === 'w' ? 0 : size.length, y: along, h: 1.8 };
    }
  }
  return { face: 'n', x: size.length / 2, y: 0, h: 1.8 };
}

function lampSpot(decor, p, size, furniture) {
  const lamps = decor.filter((d) => ['table', 'floor'].includes(decorById(d.pid)?.kind));
  const free = (pt, r) => !lamps.some((d) => dist(d, pt) < r);
  if (p.kind === 'table') {
    for (const kind of LAMP_ON) {
      for (const f of furniture.filter((q) => q.kind === kind)) {
        const pts = f.w < 0.8 && f.d < 0.8 ? [{ x: f.x, y: f.y }]
          : f.w >= f.d ? [{ x: f.x - f.w / 4, y: f.y }, { x: f.x + f.w / 4, y: f.y }] : [{ x: f.x, y: f.y - f.d / 4 }, { x: f.x, y: f.y + f.d / 4 }];
        const pt = pts.find((q) => free(q, 0.35));
        if (pt) return pt;
      }
    }
  }
  const { length: L, width: W } = size;
  const sofa = furniture.find((f) => f.kind === 'sofa' || f.kind === 'bed');
  const pts = [
    ...(sofa ? [{ x: sofa.x - sofa.w / 2 - 0.35, y: sofa.y + sofa.d / 2 }, { x: sofa.x + sofa.w / 2 + 0.35, y: sofa.y + sofa.d / 2 }] : []),
    { x: 0.35, y: 0.35 }, { x: L - 0.35, y: 0.35 }, { x: 0.35, y: W - 0.35 }, { x: L - 0.35, y: W - 0.35 }, { x: L / 2, y: W / 2 },
  ];
  return pts.find((pt) => !blockedAt(furniture, pt.x, pt.y, 0.15) && free(pt, 0.6)) || pts[pts.length - 1];
}

// Add product `pid` where it would usually go in this room.
export function addDecor(s, pid, furniture) {
  const p = decorById(pid);
  if (!p) return { state: s, id: null };
  const decor = s.decor || [];
  const spot = p.kind === 'pendant' ? pendantSpot(decor, p, s.size, furniture)
    : p.kind === 'wall' ? wallSpot(decor, p, s.size, furniture, s.room)
      : lampSpot(decor, p, s.size, furniture);
  const id = nextId(decor);
  const item = normalize({ id, pid, h: 0, face: 'floor', role: 'decor', why: 'added', ...spot }, s.size, furniture);
  return { state: { ...s, decor: [...decor, item] }, id };
}

// target: { x, y } for ceiling / floor / lamps; { face, x, y, h } for wall lights (h optional).
export function moveDecor(s, id, target, furniture) {
  return {
    ...s,
    decor: s.decor.map((d) => (d.id === id ? normalize({ ...d, ...target, h: target.h ?? d.h }, s.size, furniture) : d)),
  };
}

export function setDecorHeight(s, id, h, furniture) {
  return { ...s, decor: s.decor.map((d) => (d.id === id ? normalize({ ...d, h }, s.size, furniture) : d)) };
}

export const removeDecor = (s, id) => ({ ...s, decor: s.decor.filter((d) => d.id !== id) });

export function duplicateDecor(s, id, furniture) {
  const d = s.decor.find((x) => x.id === id);
  if (!d) return { state: s, id: null };
  // Next to the original, along its wall or along the room's length; back the other way at the edge.
  const step = Math.max(0.4, sizeOf(decorById(d.pid)).w + 0.2);
  const key = d.face === 'w' || d.face === 'e' ? 'y' : 'x';
  const max = key === 'x' ? s.size.length : s.size.width;
  const newId = nextId(s.decor);
  const copy = normalize({ ...d, id: newId, [key]: d[key] + step < max - step / 2 ? d[key] + step : d[key] - step }, s.size, furniture);
  return { state: { ...s, decor: [...s.decor, copy] }, id: newId };
}
