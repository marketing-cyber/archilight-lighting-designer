// Plan model: product lookup, auto-layout and edits. Pure — no DOM.
import { SNAPSHOT } from './data.js';
import { ROOMS, MOODS, clampSize } from './rooms.js';
import { lumenCount, lumenMethodLux, gridLayout } from './calc.js';
import { furnitureFor } from './furniture.js';
import { fitDecor } from './decor.js';
import { THUMBS } from './thumbs.js';

export const SNAPSHOT_DATE = SNAPSHOT.retrieved;
export const DOWNLIGHTS = SNAPSHOT.downlights;
export const TRACK_HEADS = SNAPSHOT.trackHeads;

const index = new Map();
for (const p of [...DOWNLIGHTS, ...TRACK_HEADS, ...SNAPSHOT.strips, ...Object.values(SNAPSHOT.parts)]) index.set(p.handle, p);
const downSet = new Set(DOWNLIGHTS.map((p) => p.handle));
const headSet = new Set(TRACK_HEADS.map((p) => p.handle));

export const productByHandle = (handle) => index.get(handle);
export const isDownlight = (handle) => downSet.has(handle);
export const isTrackHead = (handle) => headSet.has(handle);
export const finishMatches = (finish, want) => finish === want || finish.startsWith(`${want} and`);
// Local thumbnail when we have one (remote images are blocked in some frames), else a small
// Shopify rendition; local cut-outs are used as they are.
export function thumb(url, handle) {
  if (handle && THUMBS.has(handle)) return `assets/thumbs/${handle}.jpg`;
  if (!url) return '';
  return /^https?:/.test(url) ? `${url}${url.includes('?') ? '&' : '?'}width=160` : url;
}

// The product line a customer recognises: Lattice, Ray, Curion…
export function seriesOf(p) {
  const word = p.name.trim().split(/\s+/).find((w) => /^[a-z]/i.test(w)) || p.name;
  const k = word.replace(/\d.*$/, '').toLowerCase();
  if (k.startsWith('smart')) return 'Smart';
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// Downlight look, used for the shape filter and the 3D model.
export function downlightShape(name) {
  if (/cultro|linear|lattice l\d|slim [468]00/i.test(name)) return 'linear';
  if (/mocha 2|double|twin|quadro/i.test(name)) return 'twin';
  if (/lattice|quad|square|grid|taylor/i.test(name)) return 'square';
  return 'round';
}
export const isAdjustable = (name) => /\badj|tilt|flex|pictor|ds-at|halo|jet/i.test(name);

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const usable = (p) => Boolean(p && p.lm && !p.washer && p.beams.length);

// A listed variant with this CCT and finish (null = don't care). Variants without the
// option fall back to the product-level lists (e.g. finish carried in the product name).
const variantFits = (p, v, cct, finish) =>
  (cct == null || (v.cct != null ? v.cct === cct : p.ccts.includes(cct)))
  && (finish == null || (v.finish != null ? finishMatches(v.finish, finish) : p.finishes.some((f) => finishMatches(f, finish))));

export const offers = (p, cct, finish) => p.variants.some((v) => variantFits(p, v, cct, finish));

// Beams actually sold in this CCT/finish; falls back to the product's beam list.
export function beamsFor(p, cct, finish) {
  const listed = p.variants.filter((v) => v.beam && variantFits(p, v, cct, finish))
    .flatMap((v) => (v.beam.match(/\d+/g) || []).map(Number));
  const beams = [...new Set(listed)].filter((b) => p.beams.includes(b)).sort((a, b) => a - b);
  return beams.length ? beams : p.beams;
}

export function pickVariant(p, { cct, finish, beam, len } = {}) {
  if (!p.variants.length) return null;
  const score = (v) => (cct && v.cct === cct ? 8 : 0)
    - (cct && v.cct ? Math.abs(v.cct - cct) / 10000 : 0)
    + (finish && v.finish && finishMatches(v.finish, finish) ? 4 : 0)
    + (beam != null && v.beam && v.beam.split(/[- ]/).includes(String(beam)) ? 2 : 0)
    + (len && v.len === len ? 1 : 0);
  return p.variants.reduce((best, v) => (score(v) > score(best) ? v : best), p.variants[0]);
}

export function generalBeam(p, beams = p.beams) {
  const wide = beams.filter((b) => b <= 60);
  return wide.length ? Math.max(...wide) : Math.max(...beams);
}

export function accentBeam(p, beams = p.beams) {
  return beams.reduce((best, b) => (Math.abs(b - 36) < Math.abs(best - 36) ? b : best), beams[0]);
}

export function chooseDownlight(preset, size, cct, finish, pool = DOWNLIGHTS) {
  const { length: L, width: W, height: H } = size;
  const area = L * W, mount = H - preset.plane;
  const [lo, hi] = preset.sector === 'residential' ? [area < 8 ? 1 : 4, 12] : [2, 40];
  const score = (p) => {
    const count = gridLayout(lumenCount(preset.lux, area, p.lm), L, W, mount).length;
    const ratio = lumenMethodLux(count, p.lm, area) / preset.lux;
    const outside = (count < lo ? (lo - count) / lo : 0) + (count > hi ? (count - hi) / hi : 0);
    return Math.abs(ratio - 1.1) + outside + (p.watts * count) / 10000;
  };
  const tiers = [
    [(p) => offers(p, cct, finish), null],
    [(p) => offers(p, cct, null), `No ${finish.toLowerCase()} downlight fits this plan, so we picked the closest finish.`],
    [() => true, `No downlight at ${cct}K fits this plan, so we picked the closest colour temperature.`],
  ];
  for (const [filter, fallback] of tiers) {
    const candidates = pool.filter((p) => usable(p) && Math.max(...p.beams) >= 30 && p.mounting !== 'Surface Mounted' && filter(p));
    if (candidates.length) {
      const product = candidates.reduce((best, p) => (score(p) < score(best) ? p : best));
      return { product, fallback };
    }
  }
  return { product: null, fallback: null };
}

export function chooseTrackHead(cct, finish, from = TRACK_HEADS) {
  const pool = from.filter((p) => usable(p) && offers(p, cct, null));
  const byFinish = pool.filter((p) => offers(p, cct, finish));
  const exact = byFinish.filter((p) => p.finishes.includes(finish));
  const list = exact.length ? exact : byFinish.length ? byFinish : pool;
  return list.length ? list.reduce((best, p) => (Math.abs(p.lm - 500) < Math.abs(best.lm - 500) ? p : best)) : null;
}

export function chooseStrip(cct) {
  return SNAPSHOT.strips.find((s) => s.lmPerM && s.ccts.includes(cct)) || SNAPSHOT.strips.find((s) => s.lmPerM);
}

export function defaultState() {
  const r = ROOMS.living;
  return {
    v: 1, room: 'living', size: { length: r.size[0], width: r.size[1], height: r.size[2] },
    mood: 'soft', finish: 'White', layers: { track: false, cove: false }, edited: false,
    fixtures: [], track: null, cove: null, decor: [], downModel: null, headModel: null,
  };
}

function layoutTrack(s, cct, notices) {
  const { length: L, width: W } = s.size;
  const chosen = productByHandle(s.headModel);
  const head = usable(chosen) ? chosen : chooseTrackHead(cct, s.finish);
  const others = s.fixtures.filter((f) => f.layer !== 'track');
  if (!head) {
    notices.push('No track head with checked lumen data matches, so the track was left out.');
    return { track: null, fixtures: others };
  }
  const run = Math.max(1, Math.floor(L - 0.6));
  const x0 = round2((L - run) / 2), x1 = round2(x0 + run);
  const y = round2(W >= 2 ? 0.8 : W * 0.25); // along the far wall (y = 0), aimed at it; clear of a single downlight row
  const count = Math.max(2, Math.round(run / 0.8));
  const beam = accentBeam(head, beamsFor(head, cct, s.finish));
  const heads = Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`, layer: 'track', handle: head.handle, x: round2(x0 + ((i + 0.5) * run) / count), y, beam,
  }));
  return { track: { y, x0, x1 }, fixtures: [...others, ...heads] };
}

export function autoPlan(prev) {
  const s = { ...prev, size: clampSize(prev.size), edited: false, fixtures: [], track: null, cove: null };
  s.decor = fitDecor(prev.decor || [], s.size, furnitureFor(s.room, s.size)); // the customer's own lights stay
  const notices = [];
  const preset = ROOMS[s.room];
  const cct = MOODS[s.mood].cct;
  const { length: L, width: W, height: H } = s.size;
  const chosen = productByHandle(s.downModel);
  const pick = usable(chosen) ? { product: chosen, fallback: null } : chooseDownlight(preset, s.size, cct, s.finish);
  if (pick.fallback) notices.push(pick.fallback);
  if (pick.product) {
    const p = pick.product, beam = generalBeam(p, beamsFor(p, cct, s.finish));
    gridLayout(lumenCount(preset.lux, L * W, p.lm), L, W, H - preset.plane).forEach((pt, i) => {
      s.fixtures.push({ id: `d${i + 1}`, layer: 'down', handle: p.handle, x: round2(pt.x), y: round2(pt.y), beam });
    });
  } else {
    notices.push('No downlight with checked lumen data matches. Add one manually.');
  }
  if (s.layers.track) Object.assign(s, layoutTrack(s, cct, notices));
  if (s.layers.cove) s.cove = { handle: chooseStrip(cct).handle };
  return { state: s, notices };
}

export function applyPreferences(s) {
  const cct = MOODS[s.mood].cct;
  const notices = [];
  // The customer's own model choice stays; the list notes the closest variant if needed.
  const fits = (p) => p && p.lm && (offers(p, cct, s.finish) || p.handle === s.downModel || p.handle === s.headModel);
  const down = chooseDownlight(ROOMS[s.room], s.size, cct, s.finish);
  const head = chooseTrackHead(cct, s.finish);
  if (down.fallback) notices.push(down.fallback);
  const fixtures = s.fixtures.map((f) => {
    if (fits(productByHandle(f.handle))) return f;
    const p = f.layer === 'down' ? down.product : head;
    if (!p) return f;
    const beams = beamsFor(p, cct, s.finish);
    return { ...f, handle: p.handle, beam: f.layer === 'down' ? generalBeam(p, beams) : accentBeam(p, beams) };
  });
  return { state: { ...s, fixtures, cove: s.cove ? { handle: chooseStrip(cct).handle } : null }, notices };
}

export function setLayer(s, layer, on) {
  const notices = [];
  let next = { ...s, layers: { ...s.layers, [layer]: on }, edited: true };
  if (layer === 'track') {
    next = { ...next, track: null, fixtures: next.fixtures.filter((f) => f.layer !== 'track') };
    if (on) next = { ...next, ...layoutTrack(next, MOODS[s.mood].cct, notices) };
  } else {
    next.cove = on ? { handle: chooseStrip(MOODS[s.mood].cct).handle } : null;
  }
  return { state: next, notices };
}

export function moveFixture(s, id, x, y) {
  const { length: L, width: W } = s.size;
  return {
    ...s, edited: true,
    fixtures: s.fixtures.map((f) => {
      if (f.id !== id) return f;
      if (f.layer === 'track' && s.track) return { ...f, x: round2(clamp(x, s.track.x0, s.track.x1)) };
      return { ...f, x: round2(clamp(x, 0.05, L - 0.05)), y: round2(clamp(y, 0.05, W - 0.05)) };
    }),
  };
}

export function removeFixture(s, id) {
  return { ...s, edited: true, fixtures: s.fixtures.filter((f) => f.id !== id) };
}

export function setFixture(s, id, patch) {
  return {
    ...s, edited: true,
    fixtures: s.fixtures.map((f) => {
      if (f.id !== id) return f;
      const next = { ...f, ...patch };
      const p = productByHandle(next.handle);
      if (p && !p.beams.includes(next.beam)) next.beam = f.layer === 'down' ? generalBeam(p) : accentBeam(p);
      return next;
    }),
  };
}

const nextId = (s, prefix) => prefix + (1 + Math.max(0, ...s.fixtures
  .filter((f) => f.id.startsWith(prefix)).map((f) => parseInt(f.id.slice(1), 10) || 0)));

export function addDownlight(s) {
  const last = [...s.fixtures].reverse().find((f) => f.layer === 'down');
  const p = last ? productByHandle(last.handle)
    : chooseDownlight(ROOMS[s.room], s.size, MOODS[s.mood].cct, s.finish).product;
  if (!p) return { state: s, id: null };
  const id = nextId(s, 'd');
  const f = { id, layer: 'down', handle: p.handle, x: round2(s.size.length / 2), y: round2(s.size.width / 2), beam: last ? last.beam : generalBeam(p), role: 'ambient', why: 'added' };
  return { state: { ...s, edited: true, fixtures: [...s.fixtures, f] }, id };
}

const lit = (f) => {
  const p = productByHandle(f.handle);
  return p && p.lm ? { x: f.x, y: f.y, lm: p.lm, beam: f.beam } : null;
};

export function calcInputs(s) {
  const { length: L, width: W, height: H } = s.size;
  const strip = s.cove && productByHandle(s.cove.handle);
  return {
    room: { length: L, width: W, height: H, plane: ROOMS[s.room].plane },
    fixtures: s.fixtures.filter((f) => f.layer === 'down').map(lit).filter(Boolean),
    coveLumens: strip && strip.lmPerM ? strip.lmPerM * 2 * (L + W) : 0,
  };
}

export function statsFor(s, grid) {
  const { length: L, width: W } = s.size;
  let watts = 0, down = 0, track = 0;
  for (const f of s.fixtures) {
    const p = productByHandle(f.handle);
    if (!p) continue;
    watts += p.watts || 0;
    if (f.layer === 'down') down++; else track++;
  }
  const strip = s.cove && productByHandle(s.cove.handle);
  if (strip) watts += (strip.wattsPerM || 0) * 2 * (L + W);
  return {
    avg: grid.avg, min: grid.min, uniformity: grid.uniformity, target: ROOMS[s.room].lux,
    watts, wPerM2: watts / (L * W), counts: { down, track },
  };
}

export function sceneInputs(s) {
  const strip = s.cove && productByHandle(s.cove.handle);
  const withId = (f) => { const l = lit(f); return l && { ...l, id: f.id, handle: f.handle, role: f.role || (f.layer === 'track' ? 'accent' : 'ambient') }; };
  return {
    room: { ...s.size }, roomType: s.room, cct: MOODS[s.mood].cct, finish: s.finish, target: ROOMS[s.room].lux,
    down: s.fixtures.filter((f) => f.layer === 'down').map(withId).filter(Boolean),
    heads: s.fixtures.filter((f) => f.layer === 'track').map(withId).filter(Boolean),
    track: s.track, coveLmPerM: strip ? strip.lmPerM || 0 : 0,
    furniture: furnitureFor(s.room, s.size), decor: s.decor || [],
  };
}

// One plain sentence on general light level; no lux figures for the customer.
export function lightHint(s, stats) {
  const count = s.fixtures.filter((f) => f.layer === 'down').length;
  if (!count) return { level: 'low', text: 'Add downlights to light the whole room.' };
  const { avg, target } = stats;
  if (avg < target * 0.9) {
    const more = Math.max(1, Math.ceil((count * target) / Math.max(avg, 1)) - count);
    return { level: 'low', text: `This room may look dim. Add about ${more} more downlight${more > 1 ? 's' : ''}.` };
  }
  // A cove is a dimmable glow, so "too bright" is judged on the downlights alone (stats.downAvg).
  const downAvg = stats.downAvg ?? avg;
  if (downAvg > target * 1.8 && count > 1) {
    const fewer = Math.max(1, Math.min(count - 1, Math.floor(count - (count * target * 1.2) / downAvg)));
    return { level: 'high', text: `Brighter than this room needs. You could remove about ${fewer} downlight${fewer > 1 ? 's' : ''}.` };
  }
  return { level: 'ok', text: 'Bright enough for this room.' };
}

// Series cards for the drawer: usable products grouped by series, best known first.
export function seriesList(pool) {
  const groups = new Map();
  for (const p of pool.filter(usable)) {
    const k = seriesOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups].map(([name, products]) => ({ name, products, rep: products[0] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The model in `products` that best lights this room (falls back to the first usable one).
export function bestFor(s, products) {
  const cct = MOODS[s.mood].cct;
  const pick = chooseDownlight(ROOMS[s.room], s.size, cct, s.finish, products).product;
  return pick || products.find((p) => usable(p) && offers(p, cct, s.finish)) || products.find(usable) || null;
}

// Use this downlight model for the room: re-spaced for even light. Track, strip and decorative lights stay.
export function setDownModel(s, handle) {
  if (!isDownlight(handle) || !usable(productByHandle(handle))) return { state: s, notices: [] };
  const keep = s.fixtures.filter((f) => f.layer === 'track');
  const r = autoPlan({ ...s, downModel: handle, layers: { ...s.layers, track: false } });
  return {
    state: { ...r.state, layers: s.layers, track: s.track, cove: s.cove, fixtures: [...r.state.fixtures, ...keep], edited: s.edited || keep.length > 0 },
    notices: r.notices,
  };
}

// Use this track head on every head of the track, keeping their positions.
export function setHeadModel(s, handle) {
  const p = productByHandle(handle);
  if (!isTrackHead(handle) || !usable(p)) return s;
  const beam = accentBeam(p, beamsFor(p, MOODS[s.mood].cct, s.finish));
  return { ...s, headModel: handle, fixtures: s.fixtures.map((f) => (f.layer === 'track' ? { ...f, handle, beam } : f)) };
}
