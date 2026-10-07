// Furniture and wall features per room type, so lamps have somewhere to sit and light has
// something to land on. Plan coordinates in metres: x along the length (0 = left wall),
// y along the width (0 = back wall). A piece is an axis-aligned box: centre (x, y), footprint
// w × d, height h; `top` = a lamp can stand on it; `back` = side its backrest faces (−1 = toward y = 0).

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const GAP = 0.05;

const piece = (kind, label, x, y, w, d, h, top = false, extra = {}) => ({ kind, label, x: r2(x), y: r2(y), w: r2(w), d: r2(d), h, top, ...extra });
const plant = (x, y, h = 1.5) => piece('plant', 'Plant', x, y, 0.5, 0.5, h);

function spread(n, lo, hi) {
  if (n <= 0) return [];
  const step = (hi - lo) / n;
  return Array.from({ length: n }, (_, i) => lo + step * (i + 0.5));
}

function stools(n, x0, x1, y, back) {
  return spread(n, x0, x1).map((x) => piece('stool', 'Stool', x, y, 0.4, 0.4, 0.68, false, { back }));
}

const LAYOUTS = {
  living(L, W) {
    const sw = clamp(L * 0.5, 1.6, 2.6), sd = 0.95, sy = GAP + sd / 2;
    const cw = Math.min(1.2, sw * 0.55), cy = sy + sd / 2 + 0.45 + 0.3;
    const bd = Math.min(1.8, W * 0.4);
    return [
      piece('rug', 'Rug', L / 2, sy + sd / 2 + Math.min(2, W - 1.4) / 2, Math.min(L - 1, sw + 0.6), Math.min(2, W - 1.4), 0.01),
      piece('sofa', 'Sofa', L / 2, sy, sw, sd, 0.78, false, { back: -1 }),
      piece('side-table', 'Side table', L / 2 - sw / 2 - 0.3, 0.3, 0.45, 0.45, 0.52, true),
      piece('side-table', 'Side table', L / 2 + sw / 2 + 0.3, 0.3, 0.45, 0.45, 0.52, true),
      piece('coffee-table', 'Coffee table', L / 2, cy, cw, 0.6, 0.36, true),
      piece('sideboard', 'Sideboard', L - GAP - 0.225, W - 0.5 - bd / 2, 0.45, bd, 0.72, true),
      plant(0.4, W - 0.4, 1.7),
    ];
  },
  bedroom(L, W) {
    const bw = L < 2.8 ? 1.4 : 1.6, bd = 2.1;
    return [
      piece('rug', 'Rug', L / 2, GAP + bd * 0.75, Math.min(L - 0.8, bw + 1), Math.min(W - 0.6, 1.6), 0.01),
      piece('bed', 'Bed', L / 2, GAP + bd / 2, bw, bd, 0.55, false, { back: -1 }),
      piece('nightstand', 'Bedside table', L / 2 - bw / 2 - 0.3, 0.25, 0.45, 0.4, 0.52, true),
      piece('nightstand', 'Bedside table', L / 2 + bw / 2 + 0.3, 0.25, 0.45, 0.4, 0.52, true),
      piece('dresser', 'Chest of drawers', L - GAP - 0.25, W - 0.4 - 0.6, 0.5, 1.2, 0.85, true),
      plant(0.4, W - 0.4, 1.3),
    ];
  },
  kitchen(L, W) {
    const iw = clamp(L * 0.45, 1.2, 2.4), iy = GAP + 0.6 + 1.1 + 0.45;
    return [
      piece('counter', 'Bench', L / 2, GAP + 0.3, L - 2 * GAP, 0.6, 0.9, true),
      piece('island', 'Island', L / 2, iy, iw, 0.9, 0.9, true),
      ...stools(Math.max(1, Math.floor(iw / 0.6)), L / 2 - iw / 2, L / 2 + iw / 2, iy + 0.45 + 0.3, 1),
      plant(0.4, W - 0.4, 1.2),
    ];
  },
  dining(L, W) {
    const tw = clamp(L * 0.45, 1.2, 2.4), td = 0.95;
    const chairs = [];
    for (const x of spread(Math.max(1, Math.floor(tw / 0.6)), L / 2 - tw / 2, L / 2 + tw / 2)) {
      chairs.push(piece('chair', 'Chair', x, W / 2 - td / 2 - 0.3, 0.45, 0.45, 0.82, false, { back: -1 }));
      chairs.push(piece('chair', 'Chair', x, W / 2 + td / 2 + 0.3, 0.45, 0.45, 0.82, false, { back: 1 }));
    }
    return [
      piece('rug', 'Rug', L / 2, W / 2, Math.min(L - 0.6, tw + 1.4), Math.min(W - 0.6, td + 1.6), 0.01),
      piece('dining-table', 'Dining table', L / 2, W / 2, tw, td, 0.75, true),
      ...chairs,
      piece('sideboard', 'Sideboard', L / 2, GAP + 0.225, Math.min(1.8, L * 0.4), 0.45, 0.78, true),
      plant(0.4, W - 0.4, 1.6),
    ];
  },
  office(L, W) {
    const cols = Math.max(1, Math.min(4, Math.floor((L - 1) / 1.8)));
    const rows = Math.max(1, Math.min(3, Math.floor((W - 1.2) / 1.8)));
    const out = [];
    for (const y of spread(rows, 0.5, W - 1.0)) for (const x of spread(cols, 0.5, L - 0.5)) {
      out.push(piece('desk', 'Desk', x, y, 1.4, 0.7, 0.74, true));
      out.push(piece('task-chair', 'Chair', x, y + 0.35 + 0.35, 0.55, 0.55, 0.95, false, { back: 1 }));
    }
    out.push(plant(0.35, W - 0.35, 1.6), plant(L - 0.35, W - 0.35, 1.6));
    return out;
  },
  retail(L, W) {
    const cols = Math.max(1, Math.min(3, Math.floor((L - 1.6) / 2.6)));
    const rows = Math.max(1, Math.min(2, Math.floor((W - 1.6) / 2.4)));
    const out = [piece('shelving', 'Wall shelving', L / 2, GAP + 0.2, L - 0.4, 0.4, 2)];
    for (const y of spread(rows, 1.2, W - 0.4)) for (const x of spread(cols, 0.4, L - 0.4)) {
      out.push(piece('display', 'Display plinth', x, y, 1.2, 0.8, 0.9, true));
    }
    out.push(plant(0.4, W - 0.4, 1.7));
    return out;
  },
  hospitality(L, W) {
    const bw = Math.min(L * 0.5, 4), bx = GAP + bw / 2 + 0.4;
    const cols = Math.max(1, Math.min(4, Math.floor((L - 0.6) / 1.8)));
    const rows = Math.max(1, Math.min(3, Math.floor((W - 2.2) / 1.9)));
    const out = [
      piece('bar', 'Bar counter', bx, GAP + 0.3, bw, 0.6, 1.05, true),
      ...stools(Math.max(1, Math.floor(bw / 0.65)), bx - bw / 2, bx + bw / 2, GAP + 0.6 + 0.3, 1),
    ];
    for (const y of spread(rows, 2.1, W - 0.1)) for (const x of spread(cols, 0.3, L - 0.3)) {
      out.push(piece('cafe-table', 'Table', x, y, 0.75, 0.75, 0.75, true));
      out.push(piece('chair', 'Chair', x, y - 0.65, 0.42, 0.42, 0.8, false, { back: -1 }));
      out.push(piece('chair', 'Chair', x, y + 0.65, 0.42, 0.42, 0.8, false, { back: 1 }));
    }
    return out;
  },
  corridor(L, W) {
    return [
      ...(W >= 1.2 ? [piece('rug', 'Runner', L / 2, W / 2 + (W >= 1.4 ? 0.15 : 0), L - 1.2, 0.7, 0.01)] : []),
      ...(W >= 1.4 ? [piece('console', 'Console table', L / 2, GAP + 0.175, Math.min(1.2, L * 0.5), 0.35, 0.8, true)] : []),
    ];
  },
};

const overlaps = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w + GAP && Math.abs(a.y - b.y) * 2 < a.d + b.d + GAP;
const fits = (p, L, W) => p.w > 0.2 && p.d > 0.2 && p.x - p.w / 2 >= 0 && p.x + p.w / 2 <= L && p.y - p.d / 2 >= 0 && p.y + p.d / 2 <= W;

// Pieces that don't fit the room, or would collide with an earlier piece, are left out.
export function furnitureFor(room, size) {
  const { length: L, width: W } = size;
  const make = LAYOUTS[room] || (() => []);
  const kept = [];
  for (const p of make(L, W)) {
    if (!fits(p, L, W)) continue;
    if (p.kind !== 'rug' && kept.some((q) => q.kind !== 'rug' && overlaps(p, q))) continue;
    kept.push(p);
  }
  return kept.map((p, i) => ({ id: `f${i + 1}`, ...p }));
}

// Things on the walls: a window on the left wall and a picture above the main back-wall piece.
// { kind, face, along (centre along the wall), h (centre height), w, hgt }
export function wallFeatures(room, size, furniture) {
  const { length: L, width: W, height: H } = size;
  const out = [];
  if (room !== 'corridor' && W >= 2.4) {
    const w = clamp(W * 0.45, 0.9, 2.2);
    const sill = 0.9, top = Math.min(2.25, H - 0.25);
    out.push({ kind: 'window', face: 'w', along: r2(W / 2), h: r2((sill + top) / 2), w: r2(w), hgt: r2(top - sill) });
  }
  const anchor = ['sofa', 'bed', 'sideboard', 'console'].map((k) => furniture.find((f) => f.kind === k && f.y - f.d / 2 < 0.3)).find(Boolean);
  if (anchor) {
    const above = anchor.kind === 'bed' ? 1.15 : anchor.h;
    const hgt = Math.min(0.8, H - above - 0.5);
    if (hgt >= 0.4) {
      const w = r2(Math.min(1.2, anchor.w * 0.55, hgt * 1.5));
      out.push({ kind: 'art', face: 'n', along: anchor.x, h: r2(above + 0.25 + hgt / 2), w, hgt: r2(hgt) });
    }
  } else if (room === 'office' && L >= 3) {
    out.push({ kind: 'art', face: 'n', along: r2(L / 2), h: 1.6, w: 1.2, hgt: 0.8 });
  }
  return out;
}

// Height of the highest lamp-friendly top under (x, y), or 0 for the floor.
export function supportAt(furniture, x, y) {
  let h = 0;
  for (const p of furniture) {
    if (p.top && Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.d / 2) h = Math.max(h, p.h);
  }
  return h;
}

// True if (x, y) is under a solid piece (rugs don't count).
export function blockedAt(furniture, x, y, margin = 0) {
  return furniture.some((p) => p.kind !== 'rug' && Math.abs(x - p.x) <= p.w / 2 + margin && Math.abs(y - p.y) <= p.d / 2 + margin);
}
