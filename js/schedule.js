// Product schedule (with accessories) and the enquiry email draft.
import { SNAPSHOT } from './data.js';
import { ROOMS, MOODS } from './rooms.js';
import { productByHandle, pickVariant, finishMatches } from './plan.js';
import { decorById } from './decor.js';

export const DISTRIBUTOR_EMAIL = 'contact@archilight.co.nz';
// Archilight's New Zealand distributor: every product links to its page there.
export const DISTRIBUTOR = { name: 'Wellforces', url: 'https://wellforces.co.nz/collections/archilight' };
const MAILTO_LIMIT = 2000; // common mail-client limit for a mailto: URL
const KITS = SNAPSHOT.kits;

export function trackSegments(run) {
  const twos = Math.floor(run / 2);
  return { twos, ones: Math.round(run - twos * 2) };
}

const line = (role, p, variant, qty, option, note = '') => ({
  role, handle: p.handle, name: p.name, image: p.image, url: p.url, sku: variant?.sku || '', option, qty, note,
});

function lightLines(s, layer, role) {
  const cct = MOODS[s.mood].cct;
  const groups = new Map();
  for (const f of s.fixtures.filter((x) => x.layer === layer)) {
    const key = `${f.handle}|${f.beam}`;
    groups.set(key, { f, qty: (groups.get(key)?.qty || 0) + 1 });
  }
  return [...groups.values()].map(({ f, qty }) => {
    const p = productByHandle(f.handle);
    const v = pickVariant(p, { cct, finish: s.finish, beam: f.beam });
    const finish = v?.finish || (p.finishes.length === 1 ? p.finishes[0] : s.finish);
    const beam = v?.beam ? v.beam.replace(/ Degree$/, '°') : `${f.beam}°`;
    const option = [v?.cct ? `${v.cct}K` : null, finish, beam].filter(Boolean).join(' · ');
    const exact = v && (v.cct == null || v.cct === cct) && (v.finish == null || finishMatches(v.finish, s.finish))
      && (v.beam == null || v.beam.split(/[- ]/).includes(String(f.beam)));
    return line(role, p, v, qty, option, exact ? '' : 'Closest listed variant. The distributor will confirm the exact option.');
  });
}

function trackLines(s) {
  const heads = s.fixtures.filter((f) => f.layer === 'track');
  if (!s.track || !heads.length) return [];
  const run = Math.round(s.track.x1 - s.track.x0);
  const { twos, ones } = trackSegments(run);
  const track = productByHandle(KITS.track.track);
  const note = 'Motion S 48V. Driver size and head compatibility confirmed by the distributor.';
  const out = [];
  if (twos) out.push(line('track', track, pickVariant(track, { len: 200 }), twos, '2 m length', note));
  if (ones) out.push(line('track', track, pickVariant(track, { len: 100 }), ones, '1 m length', twos ? '' : note));
  const part = (h, qty, option) => { const p = productByHandle(h); out.push(line('track', p, p.variants[0], qty, option)); };
  if (twos + ones > 1) part(KITS.track.joiner, twos + ones - 1, 'Straight joiner');
  part(KITS.track.feeder, 1, 'Power feeder');
  part(KITS.track.endcaps, 1, 'End caps (pair)');
  return out;
}

function coveLines(s) {
  if (!s.cove) return [];
  const { length: L, width: W } = s.size;
  const walls = [L, W, L, W];
  const perWall = walls.map((w) => Math.ceil(w / 2));
  const strip = productByHandle(s.cove.handle);
  const cct = MOODS[s.mood].cct;
  const sv = pickVariant(strip, { cct, len: 100 });
  const profile = productByHandle(KITS.cove.profiles[s.finish]);
  const joiner = productByHandle(KITS.cove.joiner);
  const endCap = productByHandle(KITS.cove.endCap);
  const joiners = perWall.reduce((n, k) => n + k - 1, 0);
  const out = [
    line('cove', strip, sv, Math.ceil(2 * (L + W)), `${sv?.cct ? `${sv.cct}K · ` : ''}per metre`, 'Strip driver sized by the distributor.'),
    line('cove', profile, profile.variants[0], perWall.reduce((a, b) => a + b, 0), 'VARIO 01 profile, 2 m'),
  ];
  if (joiners) out.push(line('cove', joiner, joiner.variants[0], joiners, 'Straight joiner'));
  out.push(line('cove', endCap, endCap.variants[0], 8, 'End cap',
    s.finish === 'Black' ? '' : 'Only black end caps are listed, so the distributor will confirm the colour.'));
  return out;
}

const KIND_LABEL = { pendant: 'Pendant', wall: 'Wall light', table: 'Table lamp', floor: 'Floor lamp' };

function decorLines(s) {
  const cct = MOODS[s.mood].cct;
  const counts = new Map();
  for (const d of s.decor || []) counts.set(d.pid, (counts.get(d.pid) || 0) + 1);
  return [...counts].map(([pid, qty]) => {
    const p = decorById(pid);
    const v = p.variants.find((x) => x.cct === cct) || p.variants[0];
    const got = p.ccts.includes(cct) ? cct : p.ccts.reduce((a, b) => (Math.abs(b - cct) < Math.abs(a - cct) ? b : a));
    const note = got === cct ? '' : `Made in ${p.ccts.map((k) => `${k}K`).join(' / ')} only. The distributor will confirm.`;
    return line('decor', p, v, qty, [KIND_LABEL[p.kind], p.finish, `${got}K`].join(' · '), note);
  });
}

export function buildSchedule(s) {
  return [...lightLines(s, 'down', 'down'), ...lightLines(s, 'track', 'track-head'), ...trackLines(s), ...coveLines(s), ...decorLines(s)];
}

export function scheduleText(s, lines) {
  const room = ROOMS[s.room];
  const head = `${room.label}, ${s.size.length} × ${s.size.width} × ${s.size.height} m`;
  return [head, ...lines.map((l) => `${l.qty} × ${l.name}${l.sku ? ` [${l.sku}]` : ''} (${l.option})${l.note ? ` (${l.note})` : ''}`)].join('\n');
}

const opt = (label, v) => (v && String(v).trim() ? `${label}: ${String(v).trim()}` : null);

function contactLines(s, contact, stats) {
  const room = ROOMS[s.room];
  const { length: L, width: W, height: H } = s.size;
  return [
    opt('Name', contact.name), opt('Email', contact.email), opt('Phone', contact.phone),
    opt('Project', contact.project), opt('Region', contact.region), '',
    `Room: ${room.label} (${L} × ${W} × ${H} m), target ${room.lux} lx, plan estimate ${Math.round(stats.avg)} lx`,
    `Light colour: ${MOODS[s.mood].label} (${MOODS[s.mood].cct}K) · ${s.finish} fittings`, '',
  ];
}

export function enquiryText(s, lines, contact, planUrl, stats) {
  return [
    ...contactLines(s, contact, stats),
    'Product list:', scheduleText(s, lines), '',
    opt('Notes', contact.notes), `Open the plan: ${planUrl}`, '',
    'Estimate only — not a certified lighting calculation.',
  ].filter((x) => x !== null).join('\n');
}

// Full enquiry when it fits a mailto: URL; otherwise a short draft the customer pastes the list into.
export function mailtoUrl(s, lines, contact, planUrl, stats) {
  const room = ROOMS[s.room];
  const subject = `Lighting plan enquiry: ${room.label}, ${s.size.length} × ${s.size.width} m`;
  const head = `mailto:${DISTRIBUTOR_EMAIL}?subject=${encodeURIComponent(subject)}&body=`;
  const full = head + encodeURIComponent(enquiryText(s, lines, contact, planUrl, stats));
  if (full.length <= MAILTO_LIMIT) return full;
  const short = [
    ...contactLines(s, contact, stats), opt('Notes', contact.notes),
    `My product list (${lines.length} lines) from the Archilight planner is pasted below:`, '', '',
  ].filter((x) => x !== null).join('\n');
  return head + encodeURIComponent(short);
}
