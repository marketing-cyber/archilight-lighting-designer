// Wizard wiring: state → panel, 3D room, product list and enquiry.
// Flow: 1 Your room (type + size) → 2 Design (place Archilight lights in 3D, switch them on)
// → 3 Your list (picture of the design, products, distributor links, enquiry).
import { ROOMS, MOODS, LIMITS, clampSize } from './rooms.js';
import { illuminanceGrid } from './calc.js';
import * as P from './plan.js';
import * as D from './decor.js';
import { furnitureFor } from './furniture.js';
import { buildSchedule, scheduleText, mailtoUrl, enquiryText, DISTRIBUTOR_EMAIL, DISTRIBUTOR } from './schedule.js';
import { encodeState, decodeState } from './state.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STEPS = ['Your room', 'Design', 'Your list'];
const DESIGN = 1, LIST = 2;
const SECTORS = { residential: 'Residential', commercial: 'Commercial' };
const TABS = [
  { key: 'down', label: 'Downlights' },
  { key: 'pendant', label: 'Pendants', kinds: ['pendant'] },
  { key: 'wall', label: 'Wall lights', kinds: ['wall'] },
  { key: 'lamp', label: 'Lamps', kinds: ['table', 'floor'] },
  { key: 'track', label: 'Track & strip' },
];
const SHAPES = { all: 'All', round: 'Round', square: 'Square', linear: 'Linear', adjustable: 'Adjustable' };
const KIND_LABEL = { pendant: 'Pendant', wall: 'Wall light', table: 'Table lamp', floor: 'Floor lamp' };
const HISTORY = 40;
const narrow = () => window.matchMedia('(max-width: 760px)').matches;
const shortName = (name) => name.replace(/\s*(Recessed\s+)?(LED\s+)?Downlights?\b/i, '').replace(/\s*Tracklight Light/i, '').replace(/^Alabaster /, '').trim();

const app = {
  state: null, step: 0, selected: null, notices: [], sizeMsg: '', stats: null, tab: 'down', shape: 'all', openSeries: null,
  view3d: null, view3dFailed: false, light: { dim: 1, day: false, on: true }, history: [], snapshot: '',
  contact: { project: 'Residential' }, formMsg: '', formOk: false, mailto: '', enquiry: '',
  moveFrame: 0, toastTimer: 0, dragStart: null, sliderStart: null,
};

const furniture = () => furnitureFor(app.state.room, app.state.size);

function recompute() {
  const inp = P.calcInputs(app.state);
  app.stats = P.statsFor(app.state, illuminanceGrid(inp.room, inp.fixtures, inp.coveLumens));
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

function replan(next) {
  const r = P.autoPlan(next);
  commit(r.state, r.notices);
}

function render() { renderSteps(); renderPanel(); renderStage(); }

function renderSteps() {
  $('#steps').innerHTML = STEPS.map((label, i) =>
    `<li><button type="button" data-go="${i}"${i === app.step ? ' aria-current="step"' : ''}><span>0${i + 1}</span>${label}</button></li>`).join('');
}

const lightCount = (s) => s.fixtures.length + s.decor.length;

// ---- Step 1: your room ---------------------------------------------------------------------------

function roomHtml() {
  const s = app.state, room = ROOMS[s.room];
  const field = (key, label, lim) => `<label>${label}<span class="unit"><input type="number" inputmode="decimal" id="size-${key}" name="${key}" value="${s.size[key]}" min="${lim[0]}" max="${lim[1]}" step="0.1"> m</span></label>`;
  return `<h2>Light your space. <em>See it first.</em></h2>
    <ol class="how"><li>Tell us the room</li><li>Place Archilight lights and switch them on</li><li>Send the list for a quote</li></ol>
    <h3>Space</h3>
    <div class="seg" role="group" aria-label="Project type">${Object.entries(SECTORS).map(([k, v]) => `<button type="button" data-sector="${k}" aria-pressed="${room.sector === k}">${v}</button>`).join('')}</div>
    <div class="rooms">${Object.entries(ROOMS).filter(([, r]) => r.sector === room.sector).map(([k, r]) => `<button type="button" class="room" data-room="${k}" aria-pressed="${k === s.room}"><b>${r.label}</b></button>`).join('')}</div>
    <h3>Size</h3>
    <div class="dims">${field('length', 'Length', LIMITS.side)}${field('width', 'Width', LIMITS.side)}${field('height', 'Ceiling', LIMITS.height)}</div>
    ${app.sizeMsg ? `<p class="field-msg">${esc(app.sizeMsg)}</p>` : ''}
    <p class="muted">We start you with downlights spaced for even light. You can change everything in the next step.</p>
    <div class="nav"><span></span><button type="button" class="primary" data-go="${DESIGN}">Start designing →</button></div>`;
}

// ---- Step 2: design ------------------------------------------------------------------------------

function settingsHtml() {
  const s = app.state;
  return `<div class="settings">
    <div><span class="set-label">Light colour</span><div class="seg small">${Object.entries(MOODS).map(([k, m]) => `<button type="button" data-mood="${k}" aria-pressed="${k === s.mood}">${m.label.replace(' white', '')}</button>`).join('')}</div></div>
    <div><span class="set-label">Fittings</span><div class="seg small">${['White', 'Black'].map((x) => `<button type="button" data-finish="${x}" aria-pressed="${x === s.finish}">${x}</button>`).join('')}</div></div>
  </div>`;
}

function fixtureEditor(f) {
  const p = P.productByHandle(f.handle);
  const pool = (f.layer === 'down' ? P.DOWNLIGHTS : P.TRACK_HEADS).filter((q) => P.seriesOf(q) === P.seriesOf(p) && P.usable(q));
  const models = pool.map((q) => `<option value="${esc(q.handle)}"${q.handle === f.handle ? ' selected' : ''}>${esc(shortName(q.name))}</option>`).join('');
  const sold = P.beamsFor(p, MOODS[app.state.mood].cct, app.state.finish);
  const beams = [...new Set([...sold, f.beam])].sort((a, b) => a - b)
    .map((b) => `<option value="${b}"${b === f.beam ? ' selected' : ''}>${b}° ${b <= 24 ? 'narrow' : b <= 40 ? 'medium' : 'wide'}</option>`).join('');
  return `<div class="editor">
    <img src="${esc(P.thumb(p.image, p.handle))}" alt="" width="64" height="64">
    <div>
      <p class="editor-kind">${f.layer === 'down' ? 'This downlight' : 'This track light'}</p>
      <label>Model<select name="model">${models}</select></label>
      <label>Light spread<select name="beam">${beams}</select></label>
      <p class="muted"><a href="${esc(p.url)}" target="_blank" rel="noopener">View at ${DISTRIBUTOR.name} ↗</a></p>
      <div class="actions"><button type="button" data-action="delete">Remove</button><button type="button" data-action="deselect">Done</button></div>
    </div>
  </div>`;
}

function decorEditor(d) {
  const p = D.decorById(d.pid);
  const range = D.heightRange(p, d.face, app.state.size);
  const label = d.face === 'ceiling' ? 'Hanging height (bottom of the light)' : 'Height on the wall';
  const height = range[1] > range[0] ? `<label>${label}
      <span class="range-row"><input type="range" name="decor-h" min="${range[0]}" max="${range[1]}" step="0.05" value="${d.h}"><output>${d.h.toFixed(2)} m</output></span></label>` : '';
  const where = d.face === 'top' ? 'On a table top' : d.face === 'floor' ? 'On the floor' : '';
  return `<div class="editor">
    <img src="${esc(p.image)}" alt="" width="64" height="64" class="cutout">
    <div>
      <p class="editor-kind">${KIND_LABEL[p.kind]} · ${esc(p.finish)}</p>
      <p class="editor-name">${esc(p.name)}</p>
      ${height}${where ? `<p class="muted">${where}. Drag it to move it.</p>` : ''}
      <p class="muted"><a href="${esc(p.url)}" target="_blank" rel="noopener">View at ${DISTRIBUTOR.name} ↗</a></p>
      <div class="actions"><button type="button" data-action="duplicate">Add another</button><button type="button" data-action="delete">Remove</button><button type="button" data-action="deselect">Done</button></div>
    </div>
  </div>`;
}

function editorHtml() {
  const ref = app.selected;
  if (ref?.type === 'decor') return decorEditor(app.state.decor.find((d) => d.id === ref.id));
  if (ref?.type === 'fixture') return fixtureEditor(app.state.fixtures.find((f) => f.id === ref.id));
  return '<p class="muted select-hint">Tap a light in the room to move or change it. Drag anywhere else to turn the room.</p>';
}

const shapeOk = (p, shape) => shape === 'all' || (shape === 'adjustable' ? P.isAdjustable(p.name)
  : !P.isAdjustable(p.name) && (shape === 'square' ? ['square', 'twin'].includes(P.downlightShape(p.name)) : P.downlightShape(p.name) === shape));

// Series cards; the open series shows its models as chips. `current` is the handle in use.
function seriesHtml(list, current, kind) {
  const cards = list.map((x) => {
    const inUse = x.products.some((p) => p.handle === current);
    return `<button type="button" class="card${inUse ? ' in-use' : ''}" data-series="${esc(x.name)}" data-kind="${kind}">
      <span class="card-photo"><img src="${esc(P.thumb(x.rep.image, x.rep.handle))}" alt="" loading="lazy" width="160" height="160"></span>
      <span class="card-text"><small class="card-type">${kind === 'down' ? 'Downlights' : 'Track lights'}</small><span class="card-name">${esc(x.name)}</span><small>${inUse ? '● In your room' : `${x.products.length} model${x.products.length > 1 ? 's' : ''}`}</small></span>
    </button>`;
  }).join('');
  const open = list.find((x) => x.name === app.openSeries);
  const chips = open && open.products.length > 1 ? `<div class="models" aria-label="${esc(open.name)} models"><p class="set-label">${esc(open.name)} models</p>
      <div class="chips">${open.products.map((p) => `<button type="button" data-model="${esc(p.handle)}" data-kind="${kind}" aria-pressed="${p.handle === current}">${esc(shortName(p.name))}</button>`).join('')}</div></div>` : '';
  return `${chips}<div class="cards">${cards}</div>`;
}

function downTab() {
  const s = app.state;
  const down = s.fixtures.filter((f) => f.layer === 'down');
  const current = down[down.length - 1]?.handle || s.downModel;
  const p = P.productByHandle(current);
  const list = P.seriesList(P.DOWNLIGHTS)
    .map((x) => ({ ...x, products: x.products.filter((q) => shapeOk(q, app.shape)) }))
    .filter((x) => x.products.length)
    .map((x) => ({ ...x, rep: x.products.find((q) => q.handle === current) || x.products[0] }));
  return `<div class="current">
      ${p ? `<img src="${esc(P.thumb(p.image, p.handle))}" alt="" width="44" height="44">` : ''}
      <p><small>In your room</small>${p ? `${esc(shortName(p.name))} × ${down.length}` : 'No downlights yet'}</p>
      <div class="actions"><button type="button" data-action="add">+ Add one</button><button type="button" data-action="reset">Space evenly</button></div>
    </div>
    <div class="chips filter" role="group" aria-label="Shape">${Object.entries(SHAPES).map(([k, v]) => `<button type="button" data-shape="${k}" aria-pressed="${k === app.shape}">${v}</button>`).join('')}</div>
    <p class="muted">Pick a range: we choose the model and spacing that light this room evenly. Change the model below if you prefer another.</p>
    ${seriesHtml(list, current, 'down')}`;
}

function trackTab() {
  const s = app.state;
  const heads = s.fixtures.filter((f) => f.layer === 'track');
  const current = heads[0]?.handle || s.headModel;
  const list = P.seriesList(P.TRACK_HEADS).map((x) => ({ ...x, rep: x.products.find((q) => q.handle === current) || x.products[0] }));
  return `<label class="check"><input type="checkbox" id="layer-track" name="track"${s.layers.track ? ' checked' : ''}> Track lighting along the back wall${heads.length ? ` <small>(${heads.length} heads)</small>` : ''}</label>
    ${s.layers.track ? `<p class="muted">Track lights pick out art, shelves and walls. Choose a range:</p>${seriesHtml(list, current, 'head')}` : ''}
    <label class="check"><input type="checkbox" id="layer-cove" name="cove"${s.layers.cove ? ' checked' : ''}> Hidden strip light around the ceiling</label>
    <p class="muted">A soft glow along the top of the walls, in an aluminium profile.</p>`;
}

function decorTab(tab) {
  return `<div class="cards">${D.DECOR.filter((p) => tab.kinds.includes(p.kind)).map((p) => {
    const count = app.state.decor.filter((d) => d.pid === p.id).length;
    return `<button type="button" class="card${count ? ' in-use' : ''}" data-add="${esc(p.id)}">
      <span class="card-photo"><img src="${esc(p.image)}" alt="" loading="lazy" width="160" height="160"></span>
      <span class="card-text"><small class="card-type">${KIND_LABEL[p.kind]}s</small><span class="card-name">${esc(shortName(p.name))}</span>${count ? `<small>● ${count} in room · add another</small>` : '<small>Add to room +</small>'}</span>
    </button>`;
  }).join('')}</div>`;
}

function designHtml() {
  const tab = TABS.find((t) => t.key === app.tab);
  const tabs = `<div class="tabs" role="tablist">${TABS.map((t) =>
    `<button type="button" role="tab" data-tab="${t.key}" aria-selected="${t.key === app.tab}">${t.label}</button>`).join('')}</div>`;
  const body = tab.key === 'down' ? downTab() : tab.key === 'track' ? trackTab() : decorTab(tab);
  const n = lightCount(app.state);
  return `<h2>Design <em>your light.</em></h2>${settingsHtml()}${editorHtml()}${tabs}<div class="tab-body">${body}</div>
    <div class="nav sticky"><button type="button" data-go="0">Back</button><button type="button" class="primary" data-go="${LIST}">See my list · ${n} light${n === 1 ? '' : 's'} →</button></div>`;
}

// ---- Step 3: your list ---------------------------------------------------------------------------

function listHtml() {
  const lines = buildSchedule(app.state);
  const lights = lines.filter((l) => ['down', 'track-head', 'decor'].includes(l.role) || (l.role === 'cove' && /strip/i.test(l.name)));
  const parts = lines.filter((l) => !lights.includes(l));
  const row = (l) => `<tr>
    <td>${l.image ? `<img src="${esc(P.thumb(l.image, l.handle))}" alt="" width="44" height="44" loading="lazy"${l.role === 'decor' ? ' class="cutout"' : ''}>` : ''}</td>
    <td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a><small>${esc(l.option)}</small>${l.note ? `<small class="note">${esc(l.note)}</small>` : ''}</td>
    <td class="sku">${esc(l.sku)}</td><td class="qty">${l.qty}</td></tr>`;
  const table = (rows) => `<div class="table-wrap"><table class="schedule"><thead><tr><th></th><th>Product</th><th>SKU</th><th>Qty</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>`;
  const c = app.contact;
  const projects = ['Residential', 'Commercial', 'Architect / designer', 'Builder / electrician'];
  const s = app.state, room = ROOMS[s.room];
  return `<h2>Your <em>lighting list.</em></h2>
    ${app.snapshot ? `<figure class="snapshot"><img src="${app.snapshot}" alt="Your lighting design in 3D"><figcaption>${esc(room.label)}, ${s.size.length} × ${s.size.width} m · ${esc(MOODS[s.mood].label)} · ${esc(s.finish)} fittings</figcaption></figure>` : ''}
    ${lines.length ? `<h3>Lights</h3>${table(lights)}${parts.length ? `<h3>Track, profile and parts</h3>${table(parts)}` : ''}` : '<p class="muted">Your design has no lights yet.</p>'}
    <div class="actions"><button type="button" data-action="copy">Copy list</button><button type="button" data-go="${DESIGN}">Keep designing</button></div>
    <div class="distributor">
      <p class="set-label">Where to buy</p>
      <p>Archilight is supplied in New Zealand by <b>${DISTRIBUTOR.name}</b>. Every product above links to its page there, with stock and options.</p>
      <a class="text-link" href="${DISTRIBUTOR.url}" target="_blank" rel="noopener">Browse Archilight at ${DISTRIBUTOR.name} ↗</a>
    </div>
    <h3>Get a quote</h3>
    <p class="muted">Send this list and ${DISTRIBUTOR.name} will confirm drivers, compatibility and pricing.</p>
    <form id="enquiry" novalidate>
      <label>Name<input id="f-name" name="name" autocomplete="name" required value="${esc(c.name)}"></label>
      <label>Email<input id="f-email" name="email" type="email" autocomplete="email" required value="${esc(c.email)}"></label>
      <label>Phone (optional)<input id="f-phone" name="phone" type="tel" autocomplete="tel" value="${esc(c.phone)}"></label>
      <label>Project<select id="f-project" name="project">${projects.map((x) => `<option${x === c.project ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Region<input id="f-region" name="region" autocomplete="address-level1" value="${esc(c.region)}"></label>
      <label>Notes<textarea id="f-notes" name="notes" rows="3">${esc(c.notes)}</textarea></label>
      ${app.formMsg ? `<p class="${app.formOk ? 'ok-msg' : 'field-msg'}" role="status">${esc(app.formMsg)}</p>` : ''}
      ${app.mailto ? `<a id="mailto" class="button" href="${esc(app.mailto)}">Open the email draft again</a>` : ''}
      ${app.enquiry ? `<label>Your enquiry<textarea id="enquiry-text" rows="8" readonly>${esc(app.enquiry)}</textarea></label>
      <div class="actions"><button type="button" data-action="copy-enquiry">Copy enquiry</button></div>` : ''}
      <button type="submit" class="button primary">Send for a quote ↗</button>
      <p class="muted">This opens an email draft to <span class="address">${DISTRIBUTOR_EMAIL}</span> with your list. Nothing is sent until you press send.</p>
    </form>`;
}

function renderPanel() {
  const html = app.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('')
    + (app.step === 0 ? roomHtml() : app.step === DESIGN ? designHtml() : listHtml());
  $('#panel').innerHTML = html;
}

// ---- 3D stage ------------------------------------------------------------------------------------

function syncLightControls() {
  $('#lights').setAttribute('aria-pressed', String(app.light.on));
  $('#lights-label').textContent = app.light.on ? 'Lights on' : 'Lights off';
  $('#undo').disabled = !app.history.length;
}

function renderHint() {
  const h = P.lightHint(app.state, app.stats);
  const el = $('#hint');
  el.textContent = h.text;
  el.className = `hint-pill ${h.level}`;
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
    $('#controls3d').hidden = true;
    $('#view3d').innerHTML = '<p class="notice">The 3D room needs WebGL, which this browser could not start. You can still add lights from the list and get your product list.</p>';
  }
}

function draw3d() {
  if (!app.view3d) return;
  app.view3d.selected = app.selected;
  app.view3d.update(P.sceneInputs(app.state), { ...app.light });
}

async function renderStage() {
  renderHint();
  syncLightControls();
  await ensure3d();
  draw3d();
}

function select(ref) {
  app.selected = ref;
  if (ref && app.step !== DESIGN) app.step = DESIGN;
  renderSteps();
  renderPanel();
  draw3d();
}

function go(step) {
  const next = Math.max(0, Math.min(LIST, step));
  // A still of the lit room for the list page (taken with the selection box hidden).
  if (next === LIST && app.view3d) {
    app.view3d.selected = null;
    app.view3d.update(P.sceneInputs(app.state), { ...app.light, on: true });
    app.snapshot = app.view3d.snapshot();
    app.view3d.selected = app.selected;
  }
  app.step = next;
  app.formMsg = '';
  app.mailto = '';
  app.enquiry = '';
  render();
  $('#panel').scrollTop = 0;
  if (narrow()) $('#panel').scrollIntoView({ behavior: 'smooth' });
}

function pickRoom(key) {
  if (key === app.state.room) return; // keep the user's size and edits
  const r = ROOMS[key];
  app.selected = null;
  replan({ ...app.state, room: key, size: { length: r.size[0], width: r.size[1], height: r.size[2] } });
}

function setPref(patch) {
  const next = { ...app.state, ...patch };
  if (!next.edited) return replan(next);
  const r = P.applyPreferences(next);
  commit(r.state, r.notices);
}

function toast(text) {
  const t = $('#toast');
  $('#toast-text').textContent = text;
  $('#toast-see').hidden = !narrow() || app.step !== DESIGN;
  t.hidden = false;
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

function addDecor(pid) {
  const r = D.addDecor(app.state, pid, furniture());
  if (!r.id) return;
  app.selected = { type: 'decor', id: r.id };
  commit(r.state);
  if (narrow()) toast(`${KIND_LABEL[D.decorById(pid).kind]} added to the room.`);
}

function chooseDown(handle) {
  const r = P.setDownModel(app.state, handle);
  app.selected = null;
  commit(r.state, r.notices);
  const n = r.state.fixtures.filter((f) => f.layer === 'down').length;
  toast(`${shortName(P.productByHandle(handle).name)}: ${n} spaced for even light.`);
}

function chooseSeries(name, kind) {
  app.openSeries = name;
  const pool = kind === 'down' ? P.DOWNLIGHTS : P.TRACK_HEADS;
  const products = P.seriesList(pool).find((x) => x.name === name)?.products.filter((p) => kind !== 'down' || shapeOk(p, app.shape)) || [];
  if (kind === 'down') {
    const best = P.bestFor(app.state, products);
    if (best) chooseDown(best.handle);
  } else {
    const best = P.chooseTrackHead(MOODS[app.state.mood].cct, app.state.finish, products) || products[0];
    if (best) commit(P.setHeadModel(app.state, best.handle));
  }
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    app.formMsg = done;
    app.formOk = true;
  } catch {
    app.formMsg = 'Copying is blocked here. Select the text and copy it instead.';
    app.formOk = false;
  }
  renderPanel();
  if (!app.formOk) $('#enquiry-text')?.select();
}

function submitEnquiry() {
  const c = app.contact;
  app.mailto = '';
  app.enquiry = '';
  if (!c.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email || '')) {
    app.formMsg = 'Please add your name and a valid email address.';
    app.formOk = false;
    return renderPanel();
  }
  const lines = buildSchedule(app.state);
  app.enquiry = enquiryText(app.state, lines, c, location.href, app.stats);
  app.mailto = mailtoUrl(app.state, lines, c, location.href, app.stats);
  const full = decodeURIComponent(app.mailto.split('&body=')[1]) === app.enquiry;
  const copied = navigator.clipboard?.writeText(app.enquiry).then(() => true, () => false) ?? Promise.resolve(false);
  app.formMsg = full
    ? `We tried to open an email draft to ${DISTRIBUTOR_EMAIL}. If nothing opened, copy the enquiry below and email it to that address.`
    : `Your list is too long for an email link, so the draft is short. Paste the enquiry below into it, or email it to ${DISTRIBUTOR_EMAIL}.`;
  app.formOk = true;
  renderPanel();
  $('#mailto')?.click();
  copied.then((ok) => { if (ok && !full) { app.formMsg += ' It is already copied.'; renderPanel(); } });
}

function removeSelected() {
  const ref = app.selected;
  if (!ref) return;
  app.selected = null;
  commit(ref.type === 'decor' ? D.removeDecor(app.state, ref.id) : P.removeFixture(app.state, ref.id));
}

function onPanelClick(e) {
  const b = e.target.closest('button');
  if (!b || b.type === 'submit') return;
  const s = app.state;
  if (b.dataset.go) return go(Number(b.dataset.go));
  if (b.dataset.sector) {
    if (ROOMS[s.room].sector !== b.dataset.sector) pickRoom(Object.keys(ROOMS).find((k) => ROOMS[k].sector === b.dataset.sector));
    return;
  }
  if (b.dataset.room) return pickRoom(b.dataset.room);
  if (b.dataset.mood) return setPref({ mood: b.dataset.mood });
  if (b.dataset.finish) return setPref({ finish: b.dataset.finish });
  if (b.dataset.tab) { app.tab = b.dataset.tab; app.openSeries = null; return renderPanel(); }
  if (b.dataset.shape) { app.shape = b.dataset.shape; app.openSeries = null; return renderPanel(); }
  if (b.dataset.series) return chooseSeries(b.dataset.series, b.dataset.kind);
  if (b.dataset.model) {
    if (b.dataset.kind === 'down') return chooseDown(b.dataset.model);
    return commit(P.setHeadModel(s, b.dataset.model));
  }
  if (b.dataset.add) return addDecor(b.dataset.add);
  switch (b.dataset.action) {
    case 'add': {
      const r = P.addDownlight(s);
      if (r.id) app.selected = { type: 'fixture', id: r.id };
      return commit(r.state);
    }
    case 'reset': app.selected = null; return replan({ ...s });
    case 'delete': return removeSelected();
    case 'deselect': return select(null);
    case 'duplicate': {
      const r = D.duplicateDecor(s, app.selected.id, furniture());
      if (r.id) app.selected = { type: 'decor', id: r.id };
      return commit(r.state);
    }
    case 'copy': return copyText(scheduleText(app.state, buildSchedule(app.state)), 'Product list copied.');
    case 'copy-enquiry': return copyText(app.enquiry, 'Enquiry copied.');
    default: return undefined;
  }
}

function onPanelChange(e) {
  const t = e.target, s = app.state;
  if (['length', 'width', 'height'].includes(t.name)) {
    const raw = { ...s.size, [t.name]: parseFloat(t.value) };
    const size = clampSize(raw);
    app.sizeMsg = Math.abs(size[t.name] - raw[t.name]) > 0.005 || Number.isNaN(raw[t.name])
      ? `Room sides can be ${LIMITS.side[0]}–${LIMITS.side[1]} m and the ceiling ${LIMITS.height[0]}–${LIMITS.height[1]} m.` : '';
    return replan({ ...s, size });
  }
  if (t.name === 'track' || t.name === 'cove') {
    if (!s.edited) return replan({ ...s, layers: { ...s.layers, [t.name]: t.checked } });
    const r = P.setLayer(s, t.name, t.checked);
    return commit(r.state, r.notices);
  }
  if (t.name === 'model') return commit(P.setFixture(s, app.selected.id, { handle: t.value }));
  if (t.name === 'beam') return commit(P.setFixture(s, app.selected.id, { beam: Number(t.value) }));
  if (t.name === 'decor-h') {
    const prev = app.sliderStart || s;
    app.sliderStart = null;
    return commit(D.setDecorHeight(s, app.selected.id, Number(t.value), furniture()), [], { prev });
  }
  return undefined;
}

function onPanelInput(e) {
  const t = e.target;
  if (t.form?.id === 'enquiry') { app.contact[t.name] = t.value; return; }
  if (t.name === 'decor-h') {
    // Live while sliding; the link, list and undo step are recorded on release (change).
    app.sliderStart ||= app.state;
    app.state = D.setDecorHeight(app.state, app.selected.id, Number(t.value), furniture());
    t.nextElementSibling.textContent = `${Number(t.value).toFixed(2)} m`;
    draw3d();
  }
}

function onLightInput(e) {
  const t = e.target;
  if (t.name === 'dim') app.light.dim = Number(t.value) / 100;
  if (t.name === 'day') app.light.day = t.checked;
  app.view3d?.setLight({ ...app.light });
}

function init() {
  $('#snapshot-date').textContent = P.SNAPSHOT_DATE;
  document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);
  $('#steps').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
  $('#panel').addEventListener('click', onPanelClick);
  $('#panel').addEventListener('change', onPanelChange);
  $('#panel').addEventListener('input', onPanelInput);
  $('#panel').addEventListener('submit', (e) => { e.preventDefault(); submitEnquiry(); });
  $('#controls3d').addEventListener('input', onLightInput);
  $('#lights').addEventListener('click', () => { app.light.on = !app.light.on; syncLightControls(); app.view3d?.setLight({ ...app.light }); });
  $('#reset-view').addEventListener('click', () => app.view3d?.resetView());
  $('#undo').addEventListener('click', undo);
  $('#toast-see').addEventListener('click', () => { $('#toast').hidden = true; $('.stage').scrollIntoView({ behavior: 'smooth' }); });
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
    app.step = DESIGN;
    commit(restored.state, restored.dropped ? [`${restored.dropped} light(s) in this link are no longer in the catalogue and were removed.`] : [], { record: false });
    return;
  }
  const r = P.autoPlan(P.defaultState());
  commit(r.state, hash.startsWith('p=') ? ['That plan link could not be opened, so we started a new plan.', ...r.notices] : r.notices, { record: false });
}

window.__planner = {
  go, pickRoom, select, addDecor, undo, DESIGN, LIST,
  summary: () => ({ avg: app.stats.avg, target: app.stats.target, fittings: app.stats.counts.down, decor: app.state.decor.length }),
  view3dIsBlank: () => (app.view3d ? app.view3d.isBlank() : true),
  screenOf: (ref) => app.view3d?.screenOf(ref) ?? null,
  get selected() { return app.selected; },
  get state() { return app.state; },
};

init();
