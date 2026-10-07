// A lighting designer's scheme from a short brief: the room, what happens in it, the mood.
// Builds the four layers designers use — ambient, task, accent, decorative — with the usual
// placement rules, and tags every light with its layer (`role`) and why it is there (`why`).
// Pure — no DOM.
import { ROOMS, MOODS } from './rooms.js';
import { autoPlan, productByHandle, generalBeam, beamsFor, isDownlight, usable } from './plan.js';
import { furnitureFor, wallFeatures } from './furniture.js';
import { decorById, normalize, WALL_FACES } from './decor.js';

export const ROLES = ['ambient', 'task', 'accent', 'decor'];
export const ROLE_INFO = {
  ambient: { label: 'Ambient', blurb: 'Even background light for the whole room.' },
  task: { label: 'Task', blurb: 'Brighter light where you cook, read or eat.' },
  accent: { label: 'Accent', blurb: 'Light on walls and art, so the room has depth.' },
  decor: { label: 'Decorative', blurb: 'Lights you see, at eye level: the character of the room.' },
};

// What happens in the room. `rooms` lists where each use is offered.
export const USES = {
  relax: { label: 'Relax & TV', rooms: ['living', 'bedroom'] },
  reading: { label: 'Reading', rooms: ['living', 'bedroom'] },
  cooking: { label: 'Cooking', rooms: ['kitchen'] },
  dining: { label: 'Dining', rooms: ['dining', 'kitchen', 'hospitality'] },
  working: { label: 'Working', rooms: ['office'] },
  art: { label: 'Art & display', rooms: ['living', 'dining', 'bedroom', 'office', 'retail', 'hospitality', 'corridor'] },
  entertaining: { label: 'Entertaining', rooms: ['living', 'dining', 'kitchen', 'hospitality'] },
};
export const DEFAULT_USES = {
  living: ['relax', 'reading', 'art'], kitchen: ['cooking', 'dining'], bedroom: ['relax', 'reading'],
  dining: ['dining', 'art'], office: ['working'], retail: ['art'], hospitality: ['dining', 'entertaining'], corridor: ['art'],
};
export const usesFor = (room) => Object.keys(USES).filter((k) => USES[k].rooms.includes(room));
export const validUses = (room, uses) => (Array.isArray(uses) ? uses.filter((u) => USES[u]?.rooms.includes(room)) : DEFAULT_USES[room]);

// Lighting scenes: how bright each layer is (0–1).
export const SCENES = {
  everyday: { label: 'Everyday', levels: { ambient: 1, task: 1, accent: 0.6, decor: 0.7 } },
  evening: { label: 'Evening', levels: { ambient: 0.3, task: 0.2, accent: 0.7, decor: 1 } },
  dinner: { label: 'Dinner', levels: { ambient: 0.2, task: 0.9, accent: 0.5, decor: 0.8 } },
  movie: { label: 'Movie', levels: { ambient: 0, task: 0, accent: 0.25, decor: 0.35 } },
  off: { label: 'Off', levels: { ambient: 0, task: 0, accent: 0, decor: 0 } },
};
export function scenesFor(uses) {
  return ['everyday', 'evening', ...(uses.some((u) => u === 'dining' || u === 'entertaining') ? ['dinner'] : []),
    ...(uses.includes('relax') ? ['movie'] : []), 'off'];
}

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Keep general downlights off the space above seated or lying heads (glare), and off the bench
// run when task lights cover it. Points inside a zone move to its room-side edge.
function avoidZones(points, furniture, size, counterFront) {
  const zones = [];
  for (const f of furniture) {
    if (f.kind === 'sofa') zones.push({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: 0, y1: f.y + f.d / 2 + 0.15 });
    if (f.kind === 'bed') zones.push({ x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: 0, y1: f.y - f.d / 2 + 0.75 });
  }
  return points.map((p) => {
    let { x, y } = p;
    for (const z of zones) if (x > z.x0 && x < z.x1 && y > z.y0 && y < z.y1) y = z.y1 + 0.2;
    if (counterFront != null && y < counterFront + 0.5) y = counterFront + 0.5;
    return { x: r2(clamp(x, 0.2, size.length - 0.2)), y: r2(clamp(y, 0.2, size.width - 0.2)) };
  }).filter((p, i, all) => all.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.4) === i);
}

const decorItem = (id, pid, spot, role, why, size, furniture) => ({ ...normalize({ id, pid, h: 0, face: 'floor', ...spot }, size, furniture), role, why });

function pendantRow(pid, over, count, size, furniture, nextId, why) {
  const p = decorById(pid);
  const ph = p.heightCm / 100;
  const h = Math.min(over.h + 0.8, size.height - ph - 0.1);
  const along = over.w >= over.d;
  const len = along ? over.w : over.d;
  return Array.from({ length: count }, (_, i) => {
    const t = -len / 2 + (len * (i + 0.5)) / count;
    return decorItem(nextId(), pid, { face: 'ceiling', x: along ? over.x + t : over.x, y: along ? over.y : over.y + t, h }, 'task', why, size, furniture);
  });
}

function wallPair(pid, face, centre, gap, h, size, furniture, nextId, role, why) {
  const len = face === 'n' || face === 's' ? size.length : size.width;
  return [-1, 1].map((s) => {
    const along = clamp(centre + s * gap, 0.3, len - 0.3);
    const spot = face === 'n' ? { x: along, y: 0 } : face === 's' ? { x: along, y: size.width } : face === 'w' ? { x: 0, y: along } : { x: size.length, y: along };
    return decorItem(nextId(), pid, { face, h, ...spot }, role, why, size, furniture);
  });
}

// The full scheme. `s` carries room, size, mood, finish, uses and any chosen downlight / track models.
export function designScheme(s) {
  const uses = validUses(s.room, s.uses);
  const has = (u) => uses.includes(u);
  const size = s.size;
  const furniture = furnitureFor(s.room, size);
  const features = wallFeatures(s.room, size, furniture);
  const residential = ROOMS[s.room].sector === 'residential';
  const cove = residential && (has('relax') || has('entertaining')) && size.height >= 2.4;
  const base = autoPlan({ ...s, uses, layers: { track: has('art'), cove }, decor: [] });
  const notices = base.notices;
  let fixtures = base.state.fixtures;

  // Ambient: the auto-spaced grid, kept clear of heads and of the bench run.
  const counter = has('cooking') ? furniture.find((f) => f.kind === 'counter') : null;
  const counterFront = counter ? counter.y + counter.d / 2 : null;
  const down = fixtures.filter((f) => f.layer === 'down');
  const moved = avoidZones(down, furniture, size, counterFront);
  fixtures = [
    ...moved.map((p, i) => ({ ...down[0], id: `d${i + 1}`, x: p.x, y: p.y, role: 'ambient', why: 'grid' })),
    ...fixtures.filter((f) => f.layer === 'track').map((f) => ({ ...f, role: 'accent', why: 'art' })),
  ].filter((f) => f.handle);

  // Task: a row of downlights above the front edge of the bench, so the cook isn't in their own shadow.
  if (counter && down[0]) {
    const n = Math.max(2, Math.round(counter.w / 1.1));
    for (let i = 0; i < n; i++) {
      fixtures.push({ ...down[0], id: `d${fixtures.length + 1}`, x: r2(counter.x - counter.w / 2 + (counter.w * (i + 0.5)) / n), y: r2(counterFront), role: 'task', why: 'bench' });
    }
  }

  let k = 0;
  const nextId = () => `a${++k}`;
  const decor = [];
  const find = (kind) => furniture.find((f) => f.kind === kind);

  // Task: pendants over the dining table, island and bar; reading lights.
  if (has('dining')) {
    const table = find('dining-table');
    if (table) decor.push(...(table.w >= 1.8 ? pendantRow('horizontal-spindle-pendant', table, 1, size, furniture, nextId, 'dining')
      : pendantRow('orbi-sphere-pendant', table, 2, size, furniture, nextId, 'dining')));
    const island = find('island');
    if (island) decor.push(...pendantRow('orbi-disc-pendant', island, island.w >= 1.8 ? 3 : 2, size, furniture, nextId, 'island'));
    const bar = find('bar');
    if (bar) decor.push(...pendantRow('orbi-sphere-pendant', bar, Math.max(2, Math.min(4, Math.round(bar.w / 0.9))), size, furniture, nextId, 'bar'));
  }
  if (has('reading')) {
    if (s.room === 'bedroom') {
      for (const n of furniture.filter((f) => f.kind === 'nightstand')) {
        decor.push(decorItem(nextId(), 'orbi-sphere-wall', { face: 'n', x: n.x, y: 0, h: 1.15 }, 'task', 'bed-reading', size, furniture));
      }
    } else {
      const sofa = find('sofa');
      if (sofa) {
        const x = sofa.x - sofa.w / 2 - 0.35 > 0.4 ? sofa.x - sofa.w / 2 - 0.35 : sofa.x + sofa.w / 2 + 0.35;
        decor.push(decorItem(nextId(), 'tri-spear-floor', { x, y: sofa.y + sofa.d / 2 + 0.1 }, 'task', 'reading', size, furniture));
      }
    }
  }

  // Decorative: wall lights either side of the picture and a lamp for evenings; a glow for guests.
  if (has('relax')) {
    const art = features.find((f) => f.kind === 'art' && f.face === 'n');
    if (art && !(s.room === 'bedroom' && has('reading'))) {
      decor.push(...wallPair('halo-wall', 'n', art.along, art.w / 2 + 0.45, Math.min(1.75, art.h), size, furniture, nextId, 'decor', 'relax-wall'));
    }
    const top = furniture.find((f) => f.kind === 'side-table') || furniture.find((f) => f.kind === 'nightstand' && !has('reading')) || find('sideboard');
    if (top) decor.push(decorItem(nextId(), s.room === 'bedroom' ? 'orbi-sphere-table' : 'orbi-oval-table', { x: top.x, y: top.y }, 'decor', 'relax-lamp', size, furniture));
  }
  if (has('entertaining')) {
    const face = features.some((f) => f.face === 'e') ? 'w' : 'e';
    const len = size.width;
    decor.push(...wallPair('disk-wall', face, len / 2, Math.min(1.2, len / 4), 1.8, size, furniture, nextId, 'decor', 'guests'));
  }
  if (has('art') && s.room === 'corridor') {
    for (let x = 1.2; x < size.length - 0.6; x += 2.4) decor.push(decorItem(nextId(), 'cyra-wall', { face: 'n', x, y: 0, h: 1.8 }, 'decor', 'wayfinding', size, furniture));
  }

  const state = {
    ...base.state, uses, fixtures, decor, edited: true,
    cove: base.state.cove ? { ...base.state.cove } : null,
    layers: { track: fixtures.some((f) => f.layer === 'track'), cove: Boolean(base.state.cove) },
  };
  return { state, notices };
}

// Change every downlight to `handle`; the ambient grid is re-spaced for it, task lights keep their places.
export function restyleDownlights(s, handle) {
  const p = productByHandle(handle);
  if (!isDownlight(handle) || !usable(p)) return { state: s, notices: [] };
  const r = designScheme({ ...s, downModel: handle });
  const ambient = r.state.fixtures.filter((f) => f.role === 'ambient');
  const beam = generalBeam(p, beamsFor(p, MOODS[s.mood].cct, s.finish));
  const others = s.fixtures.filter((f) => f.role !== 'ambient').map((f) => (f.layer === 'down' ? { ...f, handle, beam } : f));
  const fixtures = [...ambient, ...others].map((f, i) => (f.layer === 'down' ? { ...f, id: `d${i + 1}` } : f));
  return { state: { ...s, downModel: handle, fixtures }, notices: r.notices };
}

// Swap every decorative light in a group (same product and layer) for another product of the same kind.
export function swapDecor(s, fromPid, role, toPid, furniture) {
  const to = decorById(toPid), from = decorById(fromPid);
  if (!to || !from || to.kind !== from.kind) return s;
  return { ...s, decor: s.decor.map((d) => (d.pid === fromPid && d.role === role ? { ...normalize({ ...d, pid: toPid }, s.size, furniture), role: d.role, why: d.why } : d)) };
}

export const roleOf = (item) => item.role || (item.layer === 'track' ? 'accent' : item.layer === 'down' ? 'ambient' : 'decor');
