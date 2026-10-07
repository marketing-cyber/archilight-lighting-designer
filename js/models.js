// Simplified 3D models of the fittings and furniture, built from product sizes.
// Units: metres, +y up. Each fitting model's origin is its mounting point:
//   pendant: bottom centre of the fitting (the scene adds the cable to the ceiling, from userData.cables);
//   wall light: on the wall surface, the fitting stands out along +z;
//   table / floor lamp: centre of the base, standing on its support.
// Parts that glow when lit carry userData.glow; userData.lightAt is the light source position.
//
// Real models: put a .glb in assets/models/ and list it in GLB_FILES under the product id
// (decorative) or handle (downlights, track heads). It replaces the simplified model, same origin rules.
import * as THREE from 'three';
import { downlightShape } from './plan.js';

export const GLB_FILES = {};

export const FINISH = {
  'Stone White': '#efe9df', White: '#f2f2ee', Black: '#1b1d1c', 'Sage Green': '#9aa58c', 'Dark Grey': '#4a4c4a', Grey: '#8a8c88',
};

const glbCache = new Map();

// The loaded model if it is ready; otherwise starts loading and calls onReady once it is.
export function realModel(key, onReady) {
  const file = GLB_FILES[key];
  if (!file) return null;
  const hit = glbCache.get(key);
  if (hit instanceof THREE.Object3D) return hit.clone(true);
  if (!hit) {
    glbCache.set(key, 'loading');
    // The loader is fetched only once a real model is listed.
    import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().load(file, (g) => { glbCache.set(key, g.scene); onReady(); }, undefined, () => glbCache.set(key, 'failed')))
      .catch(() => glbCache.set(key, 'failed'));
  }
  return null;
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...opts });
const glowMat = (color) => {
  const m = mat(color, { roughness: 0.5 });
  m.userData.glow = true;
  return m;
};
const mesh = (geo, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
};
const rod = (len, r, material) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), material);

function capsule(radius, length, material) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 8, 20), material);
}

function group(parts, lightAt, cables = [new THREE.Vector3(0, 0, 0)]) {
  const g = new THREE.Group();
  g.add(...parts);
  g.userData.lightAt = lightAt;
  g.userData.cables = cables;
  return g;
}

// ---- Decorative fittings, by product id ---------------------------------------------------------

const PENDANTS = {
  'orbi-sphere-pendant': (w, h, m) => group([mesh(new THREE.SphereGeometry(w / 2, 32, 20), m, 0, w / 2, 0)], new THREE.Vector3(0, w / 2, 0), [new THREE.Vector3(0, w, 0)]),
  'orbi-disc-pendant': (w, h, m) => {
    const s = mesh(new THREE.SphereGeometry(w / 2, 32, 16), m, 0, h / 2, 0);
    s.scale.set(1, h / w, 0.45);
    return group([s], new THREE.Vector3(0, h / 2, 0), [new THREE.Vector3(0, h, 0)]);
  },
  'halo-pendant': (w, h, m) => {
    const tube = Math.min(0.03, h / 2);
    const ring = mesh(new THREE.TorusGeometry(w / 2 - tube, tube, 14, 64), m, 0, tube, 0);
    ring.rotation.x = Math.PI / 2;
    const r = w / 2 - tube;
    const cables = [0, 1, 2].map((i) => new THREE.Vector3(Math.cos((i * 2 * Math.PI) / 3) * r, tube * 2, Math.sin((i * 2 * Math.PI) / 3) * r));
    return group([ring], new THREE.Vector3(0, tube, 0), cables);
  },
  'vertical-spindle-pendant': (w, h, m) => group([mesh(capsule(w / 2, h - w, m).geometry, m, 0, h / 2, 0)], new THREE.Vector3(0, h / 2, 0), [new THREE.Vector3(0, h, 0)]),
  'horizontal-spindle-pendant': (w, h, m) => {
    const c = mesh(capsule(h / 2, w - h, m).geometry, m, 0, h / 2, 0);
    c.rotation.z = Math.PI / 2;
    return group([c], new THREE.Vector3(0, h / 2, 0), [new THREE.Vector3(-w * 0.35, h, 0), new THREE.Vector3(w * 0.35, h, 0)]);
  },
  'shade-pendant': (w, h, m) => {
    const shade = mesh(new THREE.CylinderGeometry(w * 0.3, w / 2, h, 32, 1, true), m, 0, h / 2, 0);
    shade.material = m.clone();
    shade.material.side = THREE.DoubleSide;
    shade.material.userData.glow = true;
    return group([shade], new THREE.Vector3(0, h * 0.4, 0), [new THREE.Vector3(0, h, 0)]);
  },
  'orbi-semi-sphere-pendant': (w, h, m, metal) => {
    const dome = mesh(new THREE.SphereGeometry(w / 2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0, 0);
    dome.material = m.clone();
    dome.material.side = THREE.DoubleSide;
    dome.material.userData.glow = true;
    const stem = rod(h - w / 2, 0.006, metal);
    stem.position.y = w / 2 + (h - w / 2) / 2;
    return group([dome, stem], new THREE.Vector3(0, w * 0.15, 0), [new THREE.Vector3(0, h, 0)]);
  },
};
PENDANTS['halo-pendant-340'] = PENDANTS['halo-pendant'];
PENDANTS['halo-pendant-790'] = PENDANTS['halo-pendant'];

const plate = (r, metal) => {
  const p = mesh(new THREE.CylinderGeometry(r, r, 0.015, 24), metal, 0, 0, 0.0075);
  p.rotation.x = Math.PI / 2;
  return p;
};

const WALLS = {
  'orbi-sphere-wall': (w, h, m, metal) => {
    const arm = rod(0.06, 0.008, metal);
    arm.rotation.x = Math.PI / 2;
    arm.position.z = 0.03;
    return group([plate(0.04, metal), arm, mesh(new THREE.SphereGeometry(w / 2, 32, 20), m, 0, 0, 0.05 + w / 2)], new THREE.Vector3(0, 0, 0.05 + w / 2));
  },
  'halo-wall': (w, h, m, metal) => {
    const tube = Math.min(0.03, h / 2);
    const ring = mesh(new THREE.TorusGeometry(w / 2 - tube, tube, 14, 64), m, 0, 0, 0.04);
    const stand = rod(0.04, 0.006, metal);
    stand.rotation.x = Math.PI / 2;
    stand.position.set(0, -(w / 2 - tube), 0.02);
    return group([ring, stand], new THREE.Vector3(0, 0, 0.08));
  },
  'spindle-wall': (w, h, m, metal) => {
    const c = mesh(capsule(h / 2, w - h, m).geometry, m, 0, 0, 0.03 + h / 2);
    c.rotation.z = Math.PI / 2;
    return group([plate(0.035, metal), c], new THREE.Vector3(0, 0, 0.03 + h / 2));
  },
  'disk-wall': (w, h, m) => {
    const d = mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.025, 48), m, 0, 0, 0.03);
    d.rotation.x = Math.PI / 2;
    return group([d], new THREE.Vector3(0, 0, 0.06));
  },
  'bok-wall': (w, h, m) => group([mesh(new THREE.BoxGeometry(w, h, 0.1), m, 0, 0, 0.05)], new THREE.Vector3(0, 0, 0.12)),
  'cyra-wall': (w, h, m) => {
    const c = mesh(new THREE.CylinderGeometry(h / 2, h / 2, w, 24, 1, false, 0, Math.PI), m, 0, 0, 0);
    c.rotation.z = Math.PI / 2;
    return group([c], new THREE.Vector3(0, 0, 0.06));
  },
  'uriah-wall': (w, h, m, metal, glow, body) => {
    const c = mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 28), body, 0, 0, w / 2 + 0.01);
    const top = mesh(new THREE.CircleGeometry(w / 2 - 0.01, 24), glow, 0, h / 2 + 0.001, w / 2 + 0.01);
    top.rotation.x = -Math.PI / 2;
    const bottom = mesh(new THREE.CircleGeometry(w / 2 - 0.01, 24), glow, 0, -h / 2 - 0.001, w / 2 + 0.01);
    bottom.rotation.x = Math.PI / 2;
    const g = group([c, top, bottom], new THREE.Vector3(0, 0, w / 2 + 0.01));
    g.userData.upDown = true;
    return g;
  },
};

const base = (r, metal) => mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.015, 32), metal, 0, 0.0075, 0);

const LAMPS = {
  'orbi-sphere-table': (w, h, m, metal) => group([base(w * 0.35, metal), mesh(new THREE.SphereGeometry(w / 2, 32, 20), m, 0, 0.012 + w / 2, 0)], new THREE.Vector3(0, w / 2, 0)),
  'orbi-oval-table': (w, h, m, metal) => {
    const s = mesh(new THREE.SphereGeometry(w / 2, 32, 20), m, 0, 0.012 + (h - 0.012) / 2, 0);
    s.scale.y = (h - 0.012) / w;
    return group([base(w * 0.35, metal), s], new THREE.Vector3(0, h / 2, 0));
  },
  'aksel-table': (w, h, m, metal, glow, body) => {
    const stem = rod(h - 0.06, 0.006, body);
    stem.position.y = (h - 0.06) / 2;
    const head = mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.36, 0.06, 24), body, 0, h - 0.03, 0);
    const lens = mesh(new THREE.CircleGeometry(w * 0.3, 20), glow, 0, h - 0.061, 0);
    lens.rotation.x = Math.PI / 2;
    return group([base(w / 2, body), stem, head, lens], new THREE.Vector3(0, h - 0.08, 0));
  },
  'lexi-table': (w, h, m, metal, glow, body) => {
    const stem = mesh(new THREE.CylinderGeometry(0.03, 0.045, h * 0.7, 24), body, 0, h * 0.35, 0);
    const dome = mesh(new THREE.SphereGeometry(w / 2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, h - w / 2, 0);
    dome.material = body.clone();
    dome.material.side = THREE.DoubleSide;
    const under = mesh(new THREE.CircleGeometry(w / 2 - 0.005, 32), glow, 0, h - w / 2 - 0.001, 0);
    under.rotation.x = Math.PI / 2;
    return group([stem, dome, under], new THREE.Vector3(0, h - w / 2 - 0.05, 0));
  },
  'tri-spear-floor': (w, h, m, metal, glow, body) => {
    const apex = new THREE.Vector3(0, h * 0.9, 0);
    const legs = [0, 1, 2].map((i) => {
      const foot = new THREE.Vector3(Math.cos((i * 2 * Math.PI) / 3) * w / 2, 0, Math.sin((i * 2 * Math.PI) / 3) * w / 2);
      const len = foot.distanceTo(apex);
      const leg = rod(len, 0.01, body);
      leg.position.copy(foot).add(apex).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apex.clone().sub(foot).normalize());
      return leg;
    });
    const shade = mesh(new THREE.ConeGeometry(0.12, 0.2, 32, 1, true), body, 0, h - 0.1, 0);
    shade.material = body.clone();
    shade.material.side = THREE.DoubleSide;
    const lens = mesh(new THREE.CircleGeometry(0.11, 24), glow, 0, h - 0.19, 0);
    lens.rotation.x = Math.PI / 2;
    return group([...legs, shade, lens], new THREE.Vector3(0, h - 0.25, 0));
  },
};

// Alabaster glows through its whole body; painted fittings glow only at their diffuser.
export function decorModel(p) {
  const w = p.widthCm / 100, h = p.heightCm / 100;
  const stone = p.finish === 'Stone White';
  const body = stone ? glowMat(FINISH[p.finish]) : mat(FINISH[p.finish] || '#ddd', { roughness: 0.45 });
  const metal = mat('#c9b48a', { metalness: 0.6, roughness: 0.35 });
  const glow = glowMat('#fff6e8');
  const make = { pendant: PENDANTS, wall: WALLS, table: LAMPS, floor: LAMPS }[p.kind][p.id];
  // Alabaster: the body is the light. Painted fittings: diffusers glow, `body` stays painted.
  if (make) return make(w, h, stone ? body : glow, metal, glow, body);
  // Unknown shape: a glowing sphere of the right size.
  return group([mesh(new THREE.SphereGeometry(Math.min(w, h) / 2, 24, 16), glow, 0, h / 2, 0)], new THREE.Vector3(0, h / 2, 0), [new THREE.Vector3(0, h, 0)]);
}

// ---- Architectural fittings ----------------------------------------------------------------------

// Recessed downlight: trim flush with the ceiling, origin at the ceiling surface, face down.
export function downlightModel(p, finish) {
  // The trim glows too, so a lit downlight still shows as a light when the room is seen from above.
  const trim = glowMat(FINISH[finish] || FINISH.White);
  const glow = glowMat('#fff6e8');
  const shape = downlightShape(p.name);
  const parts = [];
  if (shape === 'linear') {
    parts.push(mesh(new THREE.BoxGeometry(0.3, 0.01, 0.06), trim, 0, -0.005, 0), mesh(new THREE.BoxGeometry(0.27, 0.002, 0.035), glow, 0, -0.011, 0));
  } else if (shape === 'twin' || shape === 'square') {
    const n = shape === 'twin' ? 2 : 1;
    parts.push(mesh(new THREE.BoxGeometry(0.11 * n, 0.01, 0.11), trim, 0, -0.005, 0));
    for (let i = 0; i < n; i++) parts.push(mesh(new THREE.BoxGeometry(0.075, 0.002, 0.075), glow, (i - (n - 1) / 2) * 0.11, -0.011, 0));
  } else {
    parts.push(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 28), trim, 0, -0.005, 0), mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.002, 24), glow, 0, -0.011, 0));
  }
  return group(parts, new THREE.Vector3(0, -0.02, 0));
}

// Track spotlight hanging from the track (origin), aimed toward -z (the back wall) and down.
export function trackHeadModel(p, finish) {
  const body = mat(FINISH[finish] || FINISH.Black, { roughness: 0.35 });
  const glow = glowMat('#fff6e8');
  const adaptor = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), body, 0, -0.015, 0);
  const stem = rod(0.05, 0.006, body);
  stem.position.y = -0.055;
  const head = new THREE.Group();
  const can = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.11, 24), body);
  const lens = mesh(new THREE.CircleGeometry(0.026, 20), glow, 0, -0.0551, 0);
  lens.rotation.x = Math.PI / 2;
  head.add(can, lens);
  head.position.y = -0.1;
  head.rotation.x = 0.7; // lens turns toward −z, the back wall
  return group([adaptor, stem, head], new THREE.Vector3(0, -0.13, 0));
}
