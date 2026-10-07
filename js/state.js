// Plan ⇄ URL fragment. Bad or outdated links never crash the page.
import { ROOMS, MOODS, clampSize } from './rooms.js';
import { productByHandle, isDownlight, isTrackHead, autoPlan } from './plan.js';
import { decorById, fitDecor, FACES } from './decor.js';
import { furnitureFor } from './furniture.js';

const KEYS = ['v', 'room', 'size', 'mood', 'finish', 'layers', 'edited', 'fixtures', 'track', 'cove', 'downModel', 'headModel'];
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toB64url(text) {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// An unedited plan is fully determined by its inputs, so its fittings are left out of the link.
export function encodeState(s) {
  const keys = s.edited ? KEYS : KEYS.filter((k) => !['fixtures', 'track', 'cove'].includes(k));
  const out = Object.fromEntries(keys.map((k) => [k, s[k]]));
  // Decorative lights as compact [product, x, y, h, face] rows.
  if (s.decor?.length) out.d = s.decor.map((d) => [d.pid, d.x, d.y, d.h, d.face]);
  return toB64url(JSON.stringify(out));
}

function decodeDecor(rows, room, size) {
  if (!Array.isArray(rows)) return { decor: [], dropped: 0 };
  const ok = rows.filter((r) => Array.isArray(r) && decorById(r[0]) && num(r[1]) && num(r[2]) && num(r[3]) && FACES.includes(r[4]));
  const items = ok.map(([pid, x, y, h, face], i) => ({ id: `a${i + 1}`, pid, x, y, h, face }));
  return { decor: fitDecor(items, size, furnitureFor(room, size)), dropped: rows.length - ok.length };
}

export function decodeState(str) {
  let raw;
  try { raw = JSON.parse(fromB64url(str)); } catch { return null; }
  if (!raw || raw.v !== 1 || !ROOMS[raw.room] || !MOODS[raw.mood] || !['Black', 'White'].includes(raw.finish)
    || !raw.size) return null;
  const size = clampSize(raw.size);
  const downModel = isDownlight(raw.downModel) ? raw.downModel : null;
  const headModel = isTrackHead(raw.headModel) ? raw.headModel : null;
  if (raw.fixtures === undefined && !raw.edited) {
    const layers = { track: Boolean(raw.layers?.track), cove: Boolean(raw.layers?.cove) };
    const d = decodeDecor(raw.d, raw.room, size);
    return { state: autoPlan({ v: 1, room: raw.room, size, mood: raw.mood, finish: raw.finish, layers, decor: d.decor, downModel, headModel }).state, dropped: d.dropped };
  }
  if (!Array.isArray(raw.fixtures)) return null;
  const t = raw.track;
  const track = t && num(t.y) && num(t.x0) && num(t.x1)
    ? { y: clamp(t.y, 0, size.width), x0: clamp(t.x0, 0, size.length), x1: clamp(t.x1, 0, size.length) } : null;
  const fixtures = [];
  let dropped = 0;
  for (const f of raw.fixtures) {
    const ok = f && typeof f.id === 'string' && num(f.x) && num(f.y)
      && ((f.layer === 'down' && isDownlight(f.handle)) || (f.layer === 'track' && track && isTrackHead(f.handle)));
    if (!ok) { dropped++; continue; }
    const p = productByHandle(f.handle);
    fixtures.push({
      id: f.id, layer: f.layer, handle: f.handle,
      x: f.layer === 'track' ? clamp(f.x, track.x0, track.x1) : clamp(f.x, 0, size.length),
      y: f.layer === 'track' ? track.y : clamp(f.y, 0, size.width),
      beam: num(f.beam) && p.beams.includes(f.beam) ? f.beam : (p.beams[0] ?? 36),
    });
  }
  const cove = raw.cove && productByHandle(raw.cove.handle) ? { handle: raw.cove.handle } : null;
  const d = decodeDecor(raw.d, raw.room, size);
  dropped += d.dropped;
  return {
    state: {
      v: 1, room: raw.room, size, mood: raw.mood, finish: raw.finish,
      layers: { track: Boolean(raw.layers?.track && track), cove: Boolean(cove) },
      edited: Boolean(raw.edited), fixtures, track, cove, decor: d.decor, downModel, headModel,
    },
    dropped,
  };
}
