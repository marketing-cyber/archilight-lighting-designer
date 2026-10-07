// One-page lighting designer: the brief (room, size, what happens there, mood) on one side,
// the 3D room with lighting scenes in the middle, and the layered scheme — with the reason for
// every light, product choices and the product list — on the other.
import { ROOMS, MOODS, LIMITS, clampSize } from './rooms.js';
import { illuminanceGrid } from './calc.js';
import * as P from './plan.js';
import * as D from './decor.js';
import * as S from './scheme.js';
import { furnitureFor } from './furniture.js';
import { buildSchedule, scheduleText, DISTRIBUTOR } from './schedule.js';
import { encodeState, decodeState } from './state.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SECTORS = { residential: 'Residential', commercial: 'Commercial' };
const SHAPES = { all: 'All', round: 'Round', square: 'Square', linear: 'Linear', adjustable: 'Adjustable' };
const KIND_LABEL = { pendant: 'Pendant', wall: 'Wall light', table: 'Table lamp', floor: 'Floor lamp' };
const ADD_TABS = [
  { key: 'pendant', label: 'Pendants', kinds: ['pendant'] },
  { key: 'wall', label: 'Wall lights', kinds: ['wall'] },
  { key: 'lamp', label: 'Lamps', kinds: ['table', 'floor'] },
];
const HISTORY = 40;
const narrow = () => window.matchMedia('(max-width: 760px)').matches;
const shortName = (name) => name.replace(/\s*(Recessed\s+)?(LED\s+)?Downlights?\b/i, '').replace(/\s*Tracklight Light/i, '').replace(/^Alabaster /, '').trim();

const app = {
  state: null, selected: null, notices: [], sizeMsg: '', stats: null,
  scene: 'everyday', layersOn: { ambient: true, task: true, accent: true, decor: true }, day: false,
  changing: null, adding: false, addTab: 'pendant', shape: 'all', openSeries: null, listOpen: false,
  view3d: null, view3dFailed: false, history: [], copyMsg: '', copyOk: false, copyText: '',
  moveFrame: 0, toastTimer: 0, dragStart: null, sliderStart: null,
};

const furniture = () => furnitureFor(app.state.room, app.state.size);

function recompute() {
  const inp = P.calcInputs(app.state);
  app.stats = P.statsFor(app.state, illuminanceGrid(inp.room, inp.fixtures, inp.coveLumens));
  app.stats.downAvg = inp.coveLumens ? illuminanceGrid(inp.room, inp.fixtures, 0).avg : app.stats.avg;
}

function exists(ref) {
  if (!ref) return false;
  return ref.type === 'decor' ? app.state.decor.some((d) => d.id === ref.id) : app.state.fixtures.some((f) => f.id === ref.id);
}

// Every customer edit goes through here; `prev` is what Undo returns to (defaults to the current plan).
function commit(next, notices = [], { record = true, prev = app.state } = {}) {
  if (record && prev && prev !== next) {
    app.history.push(prev);
    if (app.history.length > HISTORY) app.history.shift();
  }
  app.state = next;
  app.notices = notices;
  if (!exists(app.selected)) app.selected = null;
  if (!S.scenesFor(next.uses || []).includes(app.scene)) app.scene = 'everyday';
  recompute();
  try { history.replaceState(null, '', `#p=${encodeState(next)}`); } catch { /* some frames block history */ }
  render();
}

function undo() {
  const prev = app.history.pop();
  if (!prev) return;
  commit(prev, [], { record: false });
  toast('Undone.');
}

// Brief changes redesign the whole scheme (Undo brings the previous one back).
function redesign(patch) {
  app.selected = null;
  app.changing = null;
  const r = S.designScheme({ ...app.state, ...patch });
  commit(r.state, r.notices);
}

function render() { renderBrief(); renderScheme(); renderStage(); }

// ---- Brief ---------------------------------------------------------------------------------------

function renderBrief() {
  const s = app.state, room = ROOMS[s.room];
  const field = (key, label, lim) => `<label>${label}<span class="unit"><input type="number" inputmode="decimal" id="size-${key}" name="${key}" value="${s.size[key]}" min="${lim[0]}" max="${lim[1]}" step="0.1"> m</span></label>`;
  $('#brief').innerHTML = `
    <h1>Light your space. <em>See it first.</em></h1>
    <p class="lede">Tell us about the room. We light it the way a lighting designer would, in layers, with Archilight products.</p>
    <h3>Space</h3>
    <div class="seg small" role="group" aria-label="Project type">${Object.entries(SECTORS).map(([k, v]) => `<button type="button" data-sector="${k}" aria-pressed="${room.sector === k}">${v}</button>`).join('')}</div>
    <div class="chips rooms">${Object.entries(ROOMS).filter(([, r]) => r.sector === room.sector).map(([k, r]) => `<button type="button" data-room="${k}" aria-pressed="${k === s.room}">${r.label}</button>`).join('')}</div>
    <h3>Size</h3>
    <div class="dims">${field('length', 'Length', LIMITS.side)}${field('width', 'Width', LIMITS.side)}${field('height', 'Ceiling', LIMITS.height)}</div>
    ${app.sizeMsg ? `<p class="field-msg">${esc(app.sizeMsg)}</p>` : ''}
    <h3>What happens here?</h3>
    <div class="chips uses" role="group" aria-label="Uses">${S.usesFor(s.room).map((u) => `<button type="button" data-use="${u}" aria-pressed="${s.uses.includes(u)}">${S.USES[u].label}</button>`).join('')}</div>
    <h3>Light colour</h3>
    <div class="seg small">${Object.entries(MOODS).map(([k, m]) => `<button type="button" data-mood="${k}" aria-pressed="${k === s.mood}">${m.label.replace(' white', '')}</button>`).join('')}</div>
    <h3>Fittings</h3>
    <div class="seg small">${['White', 'Black'].map((x) => `<button type="button" data-finish="${x}" aria-pressed="${x === s.finish}">${x}</button>`).join('')}</div>
    <p class="muted note">Changing the room, size or uses redesigns the lighting. Undo brings your edits back.</p>`;
}

// ---- Scheme --------------------------------------------------------------------------------------

// Lights grouped by layer and product: one row per group.
function groups() {
  const s = app.state;
  const out = [];
  const add = (key, g) => {
    const found = out.find((x) => x.key === key);
    if (found) found.items.push(g.item);
    else out.push({ key, ...g, items: [g.item] });
  };
  for (const f of s.fixtures) {
    const role = S.roleOf(f);
    add(`${role}|${f.layer}|${f.handle}`, { role, kind: f.layer === 'track' ? 'head' : 'down', product: P.productByHandle(f.handle), why: f.why, item: f });
  }
  if (s.cove) out.push({ key: 'ambient|cove', role: 'ambient', kind: 'cove', product: P.productByHandle(s.cove.handle), why: 'cove', items: [] });
  for (const d of s.decor) {
    const role = S.roleOf(d);
    add(`${role}|decor|${d.pid}`, { role, kind: 'decor', product: D.decorById(d.pid), why: d.why, item: d });
  }
  return out;
}

function whyText(g) {
  const n = g.items.length;
  const s = app.state;
  const f = furniture();
  const spacing = Math.sqrt((s.size.length * s.size.width) / Math.max(1, n)).toFixed(1);
  const seat = f.find((x) => x.kind === 'sofa') ? ', kept off the area above the sofa' : f.find((x) => x.kind === 'bed') ? ', kept off the area above the bed head' : '';
  return {
    grid: `Spaced about ${spacing} m apart for even light${seat}.`,
    bench: 'In a row above the front edge of the bench, so you never work in your own shadow.',
    dining: 'Over the dining table, 0.8 m above it: light on the table, no glare in your eyes.',
    island: 'Over the island, 0.8 m above the bench.',
    bar: 'Over the bar counter, 0.8 m above it.',
    reading: 'Beside the sofa, for reading.',
    'bed-reading': 'Above each bedside table at 1.15 m, for reading in bed.',
    art: 'Aimed at the back wall and its art. Lit walls make a room feel bigger.',
    'relax-wall': 'Either side of the picture, for a soft glow in the evening.',
    'relax-lamp': 'A lamp at eye level for evenings.',
    guests: 'On the side wall, for a warm glow when guests are over.',
    wayfinding: 'Along the wall, to light the way.',
    cove: 'Hidden at the top of the walls, washing them with a soft glow.',
  }[g.why] || 'Added by you.';
}

const thumbOf = (g) => (g.kind === 'decor' ? g.product.image : P.thumb(g.product?.image, g.product?.handle));

const shapeOk = (p, shape) => shape === 'all' || (shape === 'adjustable' ? P.isAdjustable(p.name)
  : !P.isAdjustable(p.name) && (shape === 'square' ? ['square', 'twin'].includes(P.downlightShape(p.name)) : P.downlightShape(p.name) === shape));

function chooserHtml(g) {
  if (g.kind === 'down' || g.kind === 'head') {
    const pool = g.kind === 'down' ? P.DOWNLIGHTS : P.TRACK_HEADS;
    const current = g.product.handle;
    const list = P.seriesList(pool)
      .map((x) => ({ ...x, products: g.kind === 'down' ? x.products.filter((q) => shapeOk(q, app.shape)) : x.products }))
      .filter((x) => x.products.length)
      .map((x) => ({ ...x, rep: x.products.find((q) => q.handle === current) || x.products[0] }));
    const open = list.find((x) => x.name === app.openSeries);
    const filter = g.kind === 'down' ? `<div class="chips filter" role="group" aria-label="Shape">${Object.entries(SHAPES).map(([k, v]) => `<button type="button" data-shape="${k}" aria-pressed="${k === app.shape}">${v}</button>`).join('')}</div>` : '';
    return `<div class="chooser">
      <p class="muted">${g.kind === 'down' ? 'Pick a range. We choose the model that lights this room evenly and change every downlight to it.' : 'Pick a range for the track heads.'}</p>
      ${filter}
      ${open && open.products.length > 1 ? `<div class="models"><p class="set-label">${esc(open.name)} models</p><div class="chips">${open.products.map((p) => `<button type="button" data-model="${esc(p.handle)}" data-kind="${g.kind}" aria-pressed="${p.handle === current}">${esc(shortName(p.name))}</button>`).join('')}</div></div>` : ''}
      <div class="cards">${list.map((x) => {
        const inUse = x.products.some((p) => p.handle === current);
        return `<button type="button" class="card${inUse ? ' in-use' : ''}" data-series="${esc(x.name)}" data-kind="${g.kind}">
          <span class="card-photo"><img src="${esc(P.thumb(x.rep.image, x.rep.handle))}" alt="" loading="lazy" width="160" height="160"></span>
          <span class="card-text"><span class="card-name">${esc(x.name)}</span><small>${inUse ? '● In use' : `${x.products.length} model${x.products.length > 1 ? 's' : ''}`}</small></span>
        </button>`;
      }).join('')}</div>
      <button type="button" class="link" data-action="close-chooser">Done</button>
    </div>`;
  }
  return `<div class="chooser">
    <p class="muted">Swap for another ${KIND_LABEL[g.product.kind].toLowerCase()}; it stays in the same place.</p>
    <div class="cards">${D.DECOR.filter((p) => p.kind === g.product.kind).map((p) => `<button type="button" class="card${p.id === g.product.id ? ' in-use' : ''}" data-swap="${esc(p.id)}" data-group="${esc(g.key)}">
      <span class="card-photo"><img src="${esc(p.image)}" alt="" loading="lazy" width="160" height="160"></span>
      <span class="card-text"><span class="card-name">${esc(shortName(p.name))}</span><small>${p.id === g.product.id ? '● In use' : esc(p.finish)}</small></span>
    </button>`).join('')}</div>
    <button type="button" class="link" data-action="close-chooser">Done</button>
  </div>`;
}

function rowHtml(g) {
  const p = g.product;
  const qty = g.kind === 'cove' ? `${Math.ceil(2 * (app.state.size.length + app.state.size.width))} m` : `× ${g.items.length}`;
  const open = app.changing === g.key;
  return `<li class="row${open ? ' open' : ''}">
    <img src="${esc(thumbOf(g))}" alt="" width="56" height="56" loading="lazy">
    <div class="row-text">
      <p class="row-name"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(shortName(p.name))}</a> <span class="qty">${qty}</span></p>
      <p class="why">${esc(whyText(g))}</p>
      <p class="row-actions">${g.kind !== 'cove' ? `<button type="button" class="link" data-change="${esc(g.key)}">${open ? 'Close' : 'Change'}</button>` : ''}<button type="button" class="link" data-remove="${esc(g.key)}">Remove</button></p>
    </div>
    ${open ? chooserHtml(g) : ''}
  </li>`;
}

function emptyLayer(role) {
  const tips = {
    ambient: '<button type="button" class="link" data-action="redesign">Add even background light</button>',
    task: '<span class="muted">Choose a use like Cooking, Dining or Reading to add task light.</span>',
    accent: '<button type="button" class="link" data-action="track-on">Add track lights on the back wall</button>',
    decor: '<button type="button" class="link" data-action="add-open">Add a pendant, wall light or lamp</button>',
  };
  return `<li class="row empty">${tips[role]}</li>`;
}

function addHtml() {
  if (!app.adding) return '<button type="button" class="button" data-action="add-open">+ Add a light</button>';
  const tab = ADD_TABS.find((t) => t.key === app.addTab);
  return `<div class="add">
    <div class="tabs" role="tablist">${ADD_TABS.map((t) => `<button type="button" role="tab" data-addtab="${t.key}" aria-selected="${t.key === app.addTab}">${t.label}</button>`).join('')}
      <button type="button" role="tab" data-action="add-down" aria-selected="false">+ Downlight</button></div>
    <div class="cards">${D.DECOR.filter((p) => tab.kinds.includes(p.kind)).map((p) => `<button type="button" class="card" data-add="${esc(p.id)}">
      <span class="card-photo"><img src="${esc(p.image)}" alt="" loading="lazy" width="160" height="160"></span>
      <span class="card-text"><small class="card-type">${KIND_LABEL[p.kind]}</small><span class="card-name">${esc(shortName(p.name))}</span><small>Add to room +</small></span>
    </button>`).join('')}</div>
    <button type="button" class="link" data-action="add-close">Done</button>
  </div>`;
}

function listHtml() {
  const lines = buildSchedule(app.state);
  const row = (l) => `<tr>
    <td>${l.image ? `<img src="${esc(P.thumb(l.image, l.handle))}" alt="" width="40" height="40" loading="lazy">` : ''}</td>
    <td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a><small>${esc(l.option)}</small>${l.note ? `<small class="note">${esc(l.note)}</small>` : ''}</td>
    <td class="sku">${esc(l.sku)}</td><td class="qty">${l.qty}</td></tr>`;
  return `<details class="product-list"${app.listOpen ? ' open' : ''}>
      <summary><span>Product list</span><small>${lines.length} line${lines.length === 1 ? '' : 's'} with SKUs, including track and strip parts</small></summary>
      ${lines.length ? `<div class="table-wrap"><table class="schedule"><thead><tr><th></th><th>Product</th><th>SKU</th><th>Qty</th></tr></thead><tbody>${lines.map(row).join('')}</tbody></table></div>` : '<p class="muted">No lights yet.</p>'}
    </details>
    <div class="actions"><button type="button" class="primary" data-action="copy">Copy product list</button></div>
    ${app.copyMsg ? `<p class="${app.copyOk ? 'ok-msg' : 'field-msg'}" role="status">${esc(app.copyMsg)}</p>` : ''}
    ${app.copyText ? `<label>Your list<textarea id="list-text" rows="8" readonly>${esc(app.copyText)}</textarea></label>` : ''}
    <div class="distributor">
      <p class="set-label">Where to buy</p>
      <p>Archilight is supplied in New Zealand by <b>${DISTRIBUTOR.name}</b>. Every product here links to its page there.</p>
      <a class="text-link" href="${DISTRIBUTOR.url}" target="_blank" rel="noopener">Browse Archilight at ${DISTRIBUTOR.name} ↗</a>
    </div>`;
}

// Selected-light card (from a tap in the room).
function editorHtml() {
  const ref = app.selected;
  if (ref?.type === 'decor') {
    const d = app.state.decor.find((x) => x.id === ref.id);
    const p = D.decorById(d.pid);
    const range = D.heightRange(p, d.face, app.state.size);
    const label = d.face === 'ceiling' ? 'Hanging height (bottom of the light)' : 'Height on the wall';
    const height = range[1] > range[0] ? `<label>${label}
        <span class="range-row"><input type="range" name="decor-h" min="${range[0]}" max="${range[1]}" step="0.05" value="${d.h}"><output>${d.h.toFixed(2)} m</output></span></label>` : '';
    return `<div class="editor">
      <img src="${esc(p.image)}" alt="" width="64" height="64">
      <div>
        <p class="editor-kind">Selected · ${S.ROLE_INFO[S.roleOf(d)].label} · ${KIND_LABEL[p.kind]}</p>
        <p class="editor-name">${esc(p.name)}</p>
        ${height}
        <div class="actions"><button type="button" data-action="duplicate">Add another</button><button type="button" data-action="delete">Remove</button><button type="button" data-action="deselect">Done</button></div>
      </div>
    </div>`;
  }
  if (ref?.type === 'fixture') {
    const f = app.state.fixtures.find((x) => x.id === ref.id);
    const p = P.productByHandle(f.handle);
    const sold = P.beamsFor(p, MOODS[app.state.mood].cct, app.state.finish);
    const beams = [...new Set([...sold, f.beam])].sort((a, b) => a - b)
      .map((b) => `<option value="${b}"${b === f.beam ? ' selected' : ''}>${b}° ${b <= 24 ? 'narrow' : b <= 40 ? 'medium' : 'wide'}</option>`).join('');
    return `<div class="editor">
      <img src="${esc(P.thumb(p.image, p.handle))}" alt="" width="64" height="64">
      <div>
        <p class="editor-kind">Selected · ${S.ROLE_INFO[S.roleOf(f)].label} · ${f.layer === 'down' ? 'Downlight' : 'Track light'}</p>
        <p class="editor-name">${esc(shortName(p.name))}</p>
        <label>Light spread<select name="beam">${beams}</select></label>
        <div class="actions"><button type="button" data-action="delete">Remove</button><button type="button" data-action="deselect">Done</button></div>
      </div>
    </div>`;
  }
  return '';
}

function renderScheme() {
  const all = groups();
  const count = app.state.fixtures.length + app.state.decor.length;
  const layers = S.ROLES.map((role) => {
    const gs = all.filter((g) => g.role === role);
    const n = gs.reduce((a, g) => a + (g.kind === 'cove' ? 1 : g.items.length), 0);
    return `<section class="layer">
      <header><span class="layer-name">${S.ROLE_INFO[role].label}</span><span class="layer-count">${n || '—'}</span></header>
      <p class="muted">${S.ROLE_INFO[role].blurb}</p>
      <ul>${gs.length ? gs.map(rowHtml).join('') : emptyLayer(role)}</ul>
    </section>`;
  }).join('');
  $('#scheme').innerHTML = `${app.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('')}
    ${editorHtml()}
    <h2>Your <em>lighting scheme.</em></h2>
    <p class="lede">${count} light${count === 1 ? '' : 's'} in four layers. Tap a light in the room to move it.</p>
    ${layers}
    <div class="add-wrap">${addHtml()}</div>
    ${listHtml()}`;
}

// ---- 3D stage and scenes -------------------------------------------------------------------------

function levels() {
  const base = S.SCENES[app.scene].levels;
  return Object.fromEntries(S.ROLES.map((r) => [r, app.layersOn[r] ? base[r] : 0]));
}

function renderSceneBar() {
  const scenes = S.scenesFor(app.state.uses || []);
  $('#scene-bar').innerHTML = `
    <div class="scene-group"><span class="set-label">Scene</span><div class="seg small">${scenes.map((k) => `<button type="button" data-scene="${k}" aria-pressed="${k === app.scene}">${S.SCENES[k].label}</button>`).join('')}</div></div>
    <div class="scene-group"><span class="set-label">Layers</span><div class="chips layers">${S.ROLES.map((r) => `<button type="button" data-layer="${r}" aria-pressed="${app.layersOn[r]}">${S.ROLE_INFO[r].label}</button>`).join('')}</div></div>
    <label class="inline"><input id="day" type="checkbox" name="day"${app.day ? ' checked' : ''}> Daylight</label>`;
}

function renderHint() {
  const h = P.lightHint(app.state, app.stats);
  const el = $('#hint');
  el.textContent = h.text;
  el.className = `hint-pill ${h.level}`;
  $('#undo').disabled = !app.history.length;
}

async function ensure3d() {
  if (app.view3d || app.view3dFailed) return;
  try {
    const { View3D } = await import('./view3d.js');
    app.view3d = new View3D($('#view3d'), {
      onSelect: (ref) => select(ref),
      onMove: (ref, target) => {
        app.dragStart ||= app.state;
        app.state = ref.type === 'decor' ? D.moveDecor(app.state, ref.id, target, furniture()) : P.moveFixture(app.state, ref.id, target.x, target.y);
        app.selected = ref;
        app.moveFrame ||= requestAnimationFrame(() => { app.moveFrame = 0; draw3d(); });
      },
      onDrop: () => {
        cancelAnimationFrame(app.moveFrame);
        app.moveFrame = 0;
        const prev = app.dragStart;
        app.dragStart = null;
        commit(app.state, app.notices, { prev });
      },
    });
  } catch {
    app.view3dFailed = true;
    $('#view3d').innerHTML = '<p class="notice">The 3D room needs WebGL, which this browser could not start. Your scheme and product list still work.</p>';
  }
}

function draw3d() {
  if (!app.view3d) return;
  app.view3d.selected = app.selected;
  app.view3d.update(P.sceneInputs(app.state), { day: app.day, levels: levels() });
}

async function renderStage() {
  renderHint();
  renderSceneBar();
  await ensure3d();
  draw3d();
}

function select(ref) {
  app.selected = ref;
  renderScheme();
  draw3d();
  if (ref && !narrow()) $('#scheme').scrollTop = 0;
}

function toast(text) {
  const t = $('#toast');
  $('#toast-text').textContent = text;
  $('#toast-see').hidden = !narrow();
  t.hidden = false;
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ---- Actions -------------------------------------------------------------------------------------

function pickRoom(key) {
  if (key === app.state.room) return;
  const r = ROOMS[key];
  redesign({ room: key, size: { length: r.size[0], width: r.size[1], height: r.size[2] }, uses: S.DEFAULT_USES[key] });
}

function setPref(patch) {
  const r = P.applyPreferences({ ...app.state, ...patch });
  commit(r.state, r.notices);
}

const groupByKey = (key) => groups().find((g) => g.key === key);

function removeGroup(key) {
  const g = groupByKey(key);
  if (!g) return undefined;
  const s = app.state;
  app.changing = null;
  if (g.kind === 'cove') return commit(P.setLayer(s, 'cove', false).state);
  if (g.kind === 'head' && g.items.length === s.fixtures.filter((f) => f.layer === 'track').length) return commit(P.setLayer(s, 'track', false).state);
  const ids = new Set(g.items.map((x) => x.id));
  if (g.kind === 'decor') return commit({ ...s, decor: s.decor.filter((d) => !ids.has(d.id)) });
  return commit({ ...s, fixtures: s.fixtures.filter((f) => !ids.has(f.id)) });
}

function chooseSeries(name, kind) {
  app.openSeries = name;
  const pool = kind === 'down' ? P.DOWNLIGHTS : P.TRACK_HEADS;
  const products = P.seriesList(pool).find((x) => x.name === name)?.products.filter((p) => kind !== 'down' || shapeOk(p, app.shape)) || [];
  const best = kind === 'down' ? P.bestFor(app.state, products)
    : P.chooseTrackHead(MOODS[app.state.mood].cct, app.state.finish, products) || products[0];
  if (best) chooseModel(best.handle, kind);
}

function chooseModel(handle, kind) {
  if (kind === 'down') {
    const r = S.restyleDownlights(app.state, handle);
    app.changing = `ambient|down|${handle}`;
    commit(r.state, r.notices);
    toast(`All downlights are now ${shortName(P.productByHandle(handle).name)}.`);
  } else {
    app.changing = `accent|track|${handle}`;
    commit(P.setHeadModel(app.state, handle));
  }
}

function addDecor(pid) {
  const r = D.addDecor(app.state, pid, furniture());
  if (!r.id) return;
  app.selected = { type: 'decor', id: r.id };
  commit(r.state);
  toast(`${KIND_LABEL[D.decorById(pid).kind]} added to the room.`);
}

function removeSelected() {
  const ref = app.selected;
  if (!ref) return;
  app.selected = null;
  commit(ref.type === 'decor' ? D.removeDecor(app.state, ref.id) : P.removeFixture(app.state, ref.id));
}

// Copy the list; where the clipboard is blocked, show it selected so the customer can copy it.
async function copyList() {
  const text = scheduleText(app.state, buildSchedule(app.state));
  try {
    await navigator.clipboard.writeText(text);
    app.copyMsg = 'Product list copied.';
    app.copyOk = true;
    app.copyText = '';
  } catch {
    app.copyMsg = 'Copying is blocked here. Select the list below and copy it.';
    app.copyOk = false;
    app.copyText = text;
  }
  renderScheme();
  if (!app.copyOk) $('#list-text')?.select();
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return undefined;
  const s = app.state;
  const d = b.dataset;
  if (d.sector) {
    if (ROOMS[s.room].sector !== d.sector) pickRoom(Object.keys(ROOMS).find((k) => ROOMS[k].sector === d.sector));
    return undefined;
  }
  if (d.room) return pickRoom(d.room);
  if (d.use) return redesign({ uses: s.uses.includes(d.use) ? s.uses.filter((u) => u !== d.use) : [...s.uses, d.use] });
  if (d.mood) return setPref({ mood: d.mood });
  if (d.finish) return setPref({ finish: d.finish });
  if (d.scene) { app.scene = d.scene; return renderStage(); }
  if (d.layer) { app.layersOn[d.layer] = !app.layersOn[d.layer]; return renderStage(); }
  if (d.change) { app.changing = app.changing === d.change ? null : d.change; app.openSeries = null; return renderScheme(); }
  if (d.remove) return removeGroup(d.remove);
  if (d.shape) { app.shape = d.shape; app.openSeries = null; return renderScheme(); }
  if (d.series) return chooseSeries(d.series, d.kind);
  if (d.model) return chooseModel(d.model, d.kind);
  if (d.swap) {
    const g = groupByKey(d.group);
    if (!g) return undefined;
    app.changing = `${g.role}|decor|${d.swap}`;
    return commit(S.swapDecor(s, g.product.id, g.role, d.swap, furniture()));
  }
  if (d.addtab) { app.addTab = d.addtab; return renderScheme(); }
  if (d.add) return addDecor(d.add);
  switch (d.action) {
    case 'redesign': return redesign({});
    case 'track-on': return commit(P.setLayer(s, 'track', true).state);
    case 'add-open': app.adding = true; return renderScheme();
    case 'add-close': app.adding = false; return renderScheme();
    case 'add-down': {
      const r = P.addDownlight(s);
      if (r.id) app.selected = { type: 'fixture', id: r.id };
      return commit(r.state);
    }
    case 'close-chooser': app.changing = null; return renderScheme();
    case 'delete': return removeSelected();
    case 'deselect': return select(null);
    case 'duplicate': {
      const r = D.duplicateDecor(s, app.selected.id, furniture());
      if (r.id) app.selected = { type: 'decor', id: r.id };
      return commit(r.state);
    }
    case 'copy': return copyList();
    default: return undefined;
  }
}

function onChange(e) {
  const t = e.target, s = app.state;
  if (['length', 'width', 'height'].includes(t.name)) {
    const raw = { ...s.size, [t.name]: parseFloat(t.value) };
    const size = clampSize(raw);
    app.sizeMsg = Math.abs(size[t.name] - raw[t.name]) > 0.005 || Number.isNaN(raw[t.name])
      ? `Room sides can be ${LIMITS.side[0]}–${LIMITS.side[1]} m and the ceiling ${LIMITS.height[0]}–${LIMITS.height[1]} m.` : '';
    return redesign({ size });
  }
  if (t.name === 'beam') return commit(P.setFixture(s, app.selected.id, { beam: Number(t.value) }));
  if (t.name === 'decor-h') {
    const prev = app.sliderStart || s;
    app.sliderStart = null;
    return commit(D.setDecorHeight(s, app.selected.id, Number(t.value), furniture()), [], { prev });
  }
  if (t.name === 'day') { app.day = t.checked; return draw3d(); }
  return undefined;
}

function onInput(e) {
  const t = e.target;
  if (t.name === 'decor-h') {
    // Live while sliding; the link and the undo step are recorded on release (change).
    app.sliderStart ||= app.state;
    app.state = D.setDecorHeight(app.state, app.selected.id, Number(t.value), furniture());
    t.nextElementSibling.textContent = `${Number(t.value).toFixed(2)} m`;
    draw3d();
  }
}

function init() {
  document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);
  for (const el of [$('#brief'), $('#scheme'), $('#scene-bar')]) {
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
  }
  $('#scheme').addEventListener('toggle', (e) => { if (e.target.matches('details')) app.listOpen = e.target.open; }, true);
  $('#reset-view').addEventListener('click', () => app.view3d?.resetView());
  $('#undo').addEventListener('click', undo);
  $('#toast-see').addEventListener('click', () => { $('#toast').hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected && !typing) {
      e.preventDefault();
      removeSelected();
    }
    if (e.key === 'Escape' && app.selected) select(null);
  });

  const hash = location.hash.slice(1);
  const restored = hash.startsWith('p=') ? decodeState(hash.slice(2)) : null;
  if (restored) {
    // Links from before the layered scheme carry no reasons: design them afresh from their brief.
    const st = [...restored.state.fixtures, ...restored.state.decor].some((x) => x.why && x.why !== 'added') ? restored.state : S.designScheme(restored.state).state;
    commit(st, restored.dropped ? [`${restored.dropped} light(s) in this link are no longer in the catalogue and were removed.`] : [], { record: false });
    return;
  }
  const r = S.designScheme({ ...P.defaultState(), uses: S.DEFAULT_USES.living });
  commit(r.state, hash.startsWith('p=') ? ['That plan link could not be opened, so we started a new design.', ...r.notices] : r.notices, { record: false });
}

window.__planner = {
  pickRoom, select, addDecor, undo, redesign,
  setScene: (k) => { app.scene = k; renderStage(); },
  summary: () => ({ avg: app.stats.avg, target: app.stats.target, fittings: app.stats.counts.down, decor: app.state.decor.length }),
  view3dIsBlank: () => (app.view3d ? app.view3d.isBlank() : true),
  screenOf: (ref) => app.view3d?.screenOf(ref) ?? null,
  get selected() { return app.selected; },
  get state() { return app.state; },
};

init();
