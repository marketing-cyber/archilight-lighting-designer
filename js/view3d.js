// Three.js room: dollhouse cut-away (BackSide box), furniture, fittings, physically based lights,
// and direct editing — tap a fitting to select it, drag it along its surface. Dragging empty
// space orbits the camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { peakCandela, kelvinToRgb, clusterLights } from './calc.js';
import { decorById, lumensOf, WALL_FACES } from './decor.js';
import { productByHandle } from './plan.js';
import { decorModel, downlightModel, trackHeadModel, realModel } from './models.js';
import { buildShell, furnitureModel, contactShadow, backdrop } from './interior.js';
import { wallFeatures } from './furniture.js';

const EXPOSURE_K = 3;      // exposure = EXPOSURE_K / target lux
const NIGHT_FILL = 0.08;   // hemisphere fill at night, × target lux (enough to see the room with the lights off)
const BOUNCE = 0.18;       // light bounced off walls and ceiling while the lights are on, × target lux
const WHITE_BALANCE = 0.5; // 0 = raw black-body colour, 1 = white; eyes adapt, so 3000K reads warm, not orange
const DAY_SKY = 0.6;       // daylight hemisphere, × target lux
const DAY_SUN = 0.8;       // daylight directional, × target lux
const GLOW_CAP = 3;        // brightest glow, in display units after exposure (keeps a warm tint, not flat white)
const MAX_DECOR_LIGHTS = 10; // beyond this, extra decorative fittings glow but cast no light (GPU limits)
const ACCENT = 0xbc603c;
const MIN_PICK = 0.18;     // smallest tap target, metres

// Wall faces: rotation that turns a model's +z toward the room, and which side the camera must be on to see it.
const WALL = {
  n: { rotY: 0 }, s: { rotY: Math.PI }, w: { rotY: Math.PI / 2 }, e: { rotY: -Math.PI / 2 },
};

export class View3D {
  constructor(host, handlers = {}) {
    this.host = host;
    this.on = handlers;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = backdrop();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 300);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    RectAreaLightUniformsLib.init();
    this.staticRoot = new THREE.Group();
    this.root = new THREE.Group();
    this.scene.add(this.staticRoot, this.root);
    this.input = null;
    this.light = { cct: null, dim: 1, day: false, on: true };
    this.roomKey = '';
    this.staticKey = '';
    this.selected = null;
    this.pickables = [];
    this.tops = [];
    this.raycaster = new THREE.Raycaster();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const tick = () => {
      this.controls.update();
      this.hideNearWalls();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(input, light) {
    this.input = input;
    if (light) this.light = { ...this.light, ...light };
    this.rebuild();
  }

  setLight(light) {
    this.light = { ...this.light, ...light };
    this.rebuild();
  }

  select(ref) {
    this.selected = ref;
    this.rebuild();
  }

  resetView() {
    const { length: L, width: W, height: H } = this.input.room;
    this.frame(L, W, H);
  }

  frame(L, W, H) {
    const span = Math.max(L, W);
    // A raised three-quarter view from the front-right corner, like an interior render.
    this.camera.position.set(L * 0.5 + span * 0.25, H + span * 0.55, W * 0.5 + span * 1.05);
    this.controls.target.set(-L * 0.04, H * 0.32, -W * 0.08);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.maxDistance = span * 4;
    this.controls.update();
  }

  // plan (x, y) + height → world
  at(x, y, z) {
    const { length: L, width: W } = this.input.room;
    return new THREE.Vector3(x - L / 2, z, y - W / 2);
  }

  toPlan(v) {
    const { length: L, width: W } = this.input.room;
    return { x: v.x + L / 2, y: v.z + W / 2, z: v.y };
  }

  spot(pos, target, l, color, dim) {
    const angle = Math.min(Math.PI / 2.2, ((l.beam * Math.PI) / 360) * 1.6);
    const s = new THREE.SpotLight(color, peakCandela(l.lm, l.beam) * dim, 0, angle, 0.7, 2);
    s.position.copy(pos);
    s.target.position.copy(target);
    this.root.add(s, s.target);
  }

  // Glow strength for a lit surface of `lumens` spread over `area` m², capped so it keeps its colour.
  glowFor(lumens, area) {
    if (!this.light.on) return 0;
    const luminance = lumens / (Math.PI * Math.max(area, 1e-4));
    return Math.min(luminance, GLOW_CAP / this.renderer.toneMappingExposure) * this.light.dim;
  }

  lightUp(obj, color, intensity) {
    obj.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        if (!m.userData.glow) continue;
        m.emissive = color.clone();
        m.emissiveIntensity = intensity;
      }
    });
  }

  addPickable(obj, ref) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(MIN_PICK, MIN_PICK, MIN_PICK));
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial());
    proxy.visible = false;
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.userData.ref = ref;
    this.root.add(proxy);
    this.pickables.push(proxy);
    if (this.selected && this.selected.type === ref.type && this.selected.id === ref.id) {
      const helper = new THREE.Box3Helper(box.expandByScalar(0.02), ACCENT);
      this.root.add(helper);
    }
  }

  disposeGroup(g) {
    g.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => m.dispose()); });
    g.clear();
  }

  buildStatic() {
    const inp = this.input;
    this.disposeGroup(this.staticRoot);
    this.tops = [];
    const shell = buildShell(inp.room, wallFeatures(inp.roomType, inp.room, inp.furniture));
    this.walls = shell.walls;
    this.glass = shell.glass;
    this.staticRoot.add(shell.root);
    inp.furniture.forEach((f, i) => {
      const g = furnitureModel(f, inp.room, i + 1);
      g.position.copy(this.at(f.x, f.y, 0));
      this.staticRoot.add(g);
      if (f.kind !== 'rug') {
        const sh = contactShadow(f);
        sh.position.x = g.position.x;
        sh.position.z = g.position.z;
        this.staticRoot.add(sh);
      }
      g.traverse((o) => { if (o.userData.top) this.tops.push(o); });
    });
  }

  // Hide each wall the camera is behind, so the room stays open like a model.
  hideNearWalls() {
    if (!this.walls || !this.input) return;
    const { length: L, width: W } = this.input.room;
    const c = this.camera.position;
    this.walls.n.visible = c.z > -W / 2;
    this.walls.s.visible = c.z < W / 2;
    this.walls.w.visible = c.x > -L / 2;
    this.walls.e.visible = c.x < L / 2;
  }

  rebuild() {
    const inp = this.input;
    if (!inp) return;
    const { length: L, width: W, height: H } = inp.room;
    const key = `${L}x${W}x${H}`;
    if (key !== this.roomKey) { this.roomKey = key; this.frame(L, W, H); }
    const staticKey = `${inp.roomType}|${key}`;
    if (staticKey !== this.staticKey) { this.staticKey = staticKey; this.buildStatic(); }

    this.disposeGroup(this.root);
    this.pickables = [];
    const t = inp.target;
    this.renderer.toneMappingExposure = EXPOSURE_K / t;
    const on = this.light.on;
    const dim = on ? this.light.dim : 0;
    const tint = kelvinToRgb(this.light.cct || inp.cct).map((c) => c + (1 - c) * WHITE_BALANCE);
    const color = new THREE.Color().setRGB(...tint, THREE.SRGBColorSpace);
    const rebuildLater = () => this.rebuild();
    // Window: dusk blue at night, bright sky by day (in display units, like the glow).
    this.glass.emissive.set(this.light.day ? '#dfe8f0' : '#3a4a5e');
    this.glass.emissiveIntensity = (this.light.day ? 2.2 : 0.5) / this.renderer.toneMappingExposure;

    for (const d of inp.down) {
      const p = productByHandle(d.handle);
      const g = realModel(d.handle, rebuildLater) || downlightModel(p, inp.finish);
      g.position.copy(this.at(d.x, d.y, H));
      this.lightUp(g, color, this.glowFor(d.lm, 0.005));
      this.root.add(g);
      this.addPickable(g, { type: 'fixture', id: d.id });
    }
    if (on) for (const c of clusterLights(inp.down, inp.room)) this.spot(this.at(c.x, c.y, H - 0.02), this.at(c.x, c.y, 0), c, color, dim);

    if (inp.track) {
      const { x0, x1, y } = inp.track;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.035), new THREE.MeshStandardMaterial({ color: '#1b1d1c', roughness: 0.5 }));
      bar.position.copy(this.at((x0 + x1) / 2, y, H - 0.015));
      this.root.add(bar);
      for (const h of inp.heads) {
        const p = productByHandle(h.handle);
        const g = realModel(h.handle, rebuildLater) || trackHeadModel(p, inp.finish);
        g.position.copy(this.at(h.x, h.y, H - 0.03));
        this.lightUp(g, color, this.glowFor(h.lm, 0.002));
        this.root.add(g);
        this.addPickable(g, { type: 'fixture', id: h.id });
      }
      // ≤ 8 head lights keeps the shader within low-end GPU light limits.
      if (on) for (const c of clusterLights(inp.heads, inp.room, 8)) this.spot(this.at(c.x, y, H - 0.1), this.at(c.x, 0, 1.4), c, color, dim);
    }

    if (inp.coveLmPerM > 0) {
      // Each run washes the upper part of its wall (the cut-away hides the ceiling a real cove lights).
      const runs = [[L / 2, 0.15, L, L / 2, 0], [L / 2, W - 0.15, L, L / 2, W], [0.15, W / 2, W, 0, W / 2], [L - 0.15, W / 2, W, L, W / 2]];
      for (const [x, y, len, wx, wy] of runs) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: '#f2f2ee' }));
        strip.material.userData.glow = true;
        strip.position.copy(this.at(x, y, H - 0.12));
        strip.lookAt(this.at(wx, wy, H - 0.12));
        strip.rotateY(Math.PI / 2);
        this.lightUp(strip, color, this.glowFor(inp.coveLmPerM, 0.012));
        this.root.add(strip);
        if (!on) continue;
        const luminance = (inp.coveLmPerM * dim) / (Math.PI * 0.05); // cd/m² of a 50 mm emitting strip
        const rect = new THREE.RectAreaLight(color, luminance, len, 0.05);
        rect.position.copy(this.at(x, y, H - 0.12));
        rect.lookAt(this.at(wx, wy, H - 0.12));
        this.root.add(rect);
      }
    }

    let decorLights = 0;
    for (const d of inp.decor) {
      const p = decorById(d.pid);
      if (!p) continue;
      const g = realModel(d.pid, rebuildLater) || decorModel(p);
      const lm = lumensOf(p);
      if (d.face === 'ceiling') {
        g.position.copy(this.at(d.x, d.y, d.h));
        for (const c of g.userData.cables || []) {
          const top = c.clone().add(g.position);
          const len = H - top.y;
          if (len <= 0) continue;
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, len, 6), new THREE.MeshBasicMaterial({ color: '#2a2a2a' }));
          cable.position.set(top.x, top.y + len / 2, top.z);
          this.root.add(cable);
        }
      } else if (WALL_FACES.includes(d.face)) {
        g.position.copy(this.at(d.x, d.y, d.h));
        g.rotation.y = WALL[d.face].rotY;
      } else {
        g.position.copy(this.at(d.x, d.y, d.h));
      }
      const w = p.widthCm / 100, h = p.heightCm / 100;
      const area = p.finish === 'Stone White' ? Math.PI * (w * h + w * w / 2) : 0.004;
      this.lightUp(g, color, this.glowFor(lm, area));
      this.root.add(g);
      this.addPickable(g, { type: 'decor', id: d.id });
      if (!on || decorLights >= MAX_DECOR_LIGHTS) continue;
      g.updateMatrixWorld(true);
      const src = g.localToWorld(g.userData.lightAt.clone());
      if (g.userData.upDown) {
        for (const dir of [1, -1]) {
          const s = new THREE.SpotLight(color, peakCandela(lm / 2, 30) * dim, 0, Math.PI / 9, 0.5, 2);
          s.position.copy(src);
          s.target.position.copy(src).add(new THREE.Vector3(0, dir, 0));
          this.root.add(s, s.target);
        }
      } else {
        const pl = new THREE.PointLight(color, (lm / (4 * Math.PI)) * dim, 0, 2);
        pl.position.copy(src);
        this.root.add(pl);
      }
      decorLights++;
    }

    this.root.add(new THREE.HemisphereLight(0xffffff, 0x8d7b68, t * (this.light.day ? DAY_SKY : NIGHT_FILL)));
    if (on) this.root.add(new THREE.HemisphereLight(color, color.clone().multiplyScalar(0.6), t * BOUNCE * dim));
    if (this.light.day) {
      const sun = new THREE.DirectionalLight(0xfff4e0, t * DAY_SUN);
      sun.position.copy(this.at(-L, -W, H * 3));
      this.root.add(sun);
    }
  }

  // ---- Pointer: select and drag ------------------------------------------------------------------

  rayFrom(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  pick(e) {
    const hit = this.rayFrom(e).intersectObjects(this.pickables, false)[0];
    return hit ? { ref: hit.object.userData.ref, point: hit.point } : null;
  }

  // Nearest wall hit among the walls the camera can see (the cut-away hides the others).
  wallHit(ray) {
    const { length: L, width: W, height: H } = this.input.room;
    const cam = this.camera.position;
    const walls = [
      { face: 'n', plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), W / 2), seen: cam.z > -W / 2 },
      { face: 's', plane: new THREE.Plane(new THREE.Vector3(0, 0, -1), W / 2), seen: cam.z < W / 2 },
      { face: 'w', plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), L / 2), seen: cam.x > -L / 2 },
      { face: 'e', plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), L / 2), seen: cam.x < L / 2 },
    ];
    let best = null;
    for (const w of walls) {
      if (!w.seen) continue;
      const v = ray.intersectPlane(w.plane, new THREE.Vector3());
      if (!v) continue;
      const p = this.toPlan(v);
      if (p.x < -0.01 || p.x > L + 0.01 || p.y < -0.01 || p.y > W + 0.01 || p.z < 0 || p.z > H) continue;
      const dist = v.distanceTo(ray.origin);
      if (!best || dist < best.dist) best = { face: w.face, x: p.x, y: p.y, h: p.z, dist };
    }
    return best;
  }

  dragTarget(e) {
    const d = this.drag;
    const ray = this.rayFrom(e).ray;
    if (d.surface === 'wall') {
      const hit = this.wallHit(ray);
      return hit ? { face: hit.face, x: hit.x, y: hit.y, h: hit.h } : null;
    }
    if (d.surface === 'top') {
      const hit = this.raycaster.intersectObjects(this.tops, false)[0];
      if (hit) { const p = this.toPlan(hit.point); return { x: p.x, y: p.y }; }
      const v = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (!v) return null;
      const p = this.toPlan(v);
      return { x: p.x, y: p.y };
    }
    // Horizontal move at the height it was grabbed, so the fitting stays under the finger.
    const v = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.grab.y), new THREE.Vector3());
    if (!v) return null;
    const p = this.toPlan(v), g = this.toPlan(d.grab);
    return { x: d.origin.x + p.x - g.x, y: d.origin.y + p.y - g.y };
  }

  bindPointer() {
    const el = this.renderer.domElement;
    // Capture phase on the host runs before OrbitControls' own listener, so a drag on a fitting never orbits.
    this.host.addEventListener('pointerdown', (e) => {
      if (!this.input || e.button !== 0 || this.drag) return;
      const hit = this.pick(e);
      this.press = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      if (!hit) return;
      const ref = hit.ref;
      const item = ref.type === 'decor' ? this.input.decor.find((x) => x.id === ref.id)
        : [...this.input.down, ...this.input.heads].find((x) => x.id === ref.id);
      if (!item) return;
      const kind = ref.type === 'decor' ? decorById(item.pid)?.kind : 'fixture';
      const surface = kind === 'wall' ? 'wall' : kind === 'table' ? 'top' : 'plane';
      this.controls.enabled = false;
      this.drag = { ref, surface, grab: hit.point.clone(), origin: { x: item.x, y: item.y }, moved: false, pointerId: e.pointerId };
      el.style.cursor = 'grabbing';
    }, true);

    window.addEventListener('pointermove', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) {
        if (!this.drag.moved && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 4) return;
        this.drag.moved = true;
        const target = this.dragTarget(e);
        if (target) this.on.onMove?.(this.drag.ref, target);
        return;
      }
      if (e.target === el && e.pointerType === 'mouse' && !e.buttons) el.style.cursor = this.pick(e) ? 'grab' : '';
    });

    const end = (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) {
        const { ref, moved } = this.drag;
        this.drag = null;
        this.controls.enabled = true;
        el.style.cursor = '';
        if (moved) this.on.onDrop?.(ref);
        else this.on.onSelect?.(ref);
      } else if (this.press && e.pointerId === this.press.pointerId && e.target === el
        && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 4) {
        this.on.onSelect?.(null);
      }
      this.press = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) { this.drag = null; this.controls.enabled = true; this.on.onDrop?.(null); }
      this.press = null;
    });
  }

  // Screen position (CSS px, relative to the canvas) of a fitting, for automated checks.
  screenOf(ref) {
    const proxy = this.pickables.find((p) => p.userData.ref.type === ref.type && p.userData.ref.id === ref.id);
    if (!proxy) return null;
    const v = proxy.position.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // JPEG still of the current view, rendered now (the drawing buffer is preserved).
  snapshot() {
    this.hideNearWalls();
    this.renderer.render(this.scene, this.camera);
    try { return this.renderer.domElement.toDataURL('image/jpeg', 0.85); } catch { return ''; }
  }

  isBlank() {
    const probe = document.createElement('canvas');
    probe.width = 64; probe.height = 64;
    const g = probe.getContext('2d');
    g.drawImage(this.renderer.domElement, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let min = 765, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min < 30;
  }
}
