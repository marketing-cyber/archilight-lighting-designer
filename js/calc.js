// Lighting maths for the planner. Units: metres, lumens, lux, candela.
// Estimate only — not a certified lighting calculation.

export const UF = 0.55;            // utilisation factor, general lighting
export const MF = 0.8;             // maintenance factor
export const COVE_UF = 0.3;        // indirect cove light reaching the working plane
export const SPACING_RATIO = 1.4;  // max spacing / mounting height
export const DIRECT_SHARE = 0.7;   // heatmap: share shaped by point calc, rest = inter-reflection

export function lumenCount(targetLux, area, lumens) {
  if (!(area > 0) || !(lumens > 0)) throw new RangeError('area and lumens must be positive');
  return Math.max(1, Math.ceil((targetLux * area) / (lumens * UF * MF)));
}

export function lumenMethodLux(count, lumens, area, uf = UF) {
  return (count * lumens * uf * MF) / area;
}

// Even grid over an L × W room: half spacing to the walls, spacing capped by SPACING_RATIO.
export function gridLayout(count, length, width, mountHeight) {
  const maxSpacing = SPACING_RATIO * mountHeight;
  let nx = Math.max(1, Math.round(Math.sqrt((count * length) / width)));
  let ny = Math.max(1, Math.ceil(count / nx));
  while (length / nx > maxSpacing) nx++;
  while (width / ny > maxSpacing) ny++;
  const pts = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) pts.push({ x: ((i + 0.5) * length) / nx, y: ((j + 0.5) * width) / ny });
  }
  return pts;
}

// Gaussian beam: intensity halves at half the beam angle.
const halfAngle = (beamDeg) => (beamDeg * Math.PI) / 360;
const fluxFactors = new Map();
function fluxFactor(beamDeg) {
  if (!fluxFactors.has(beamDeg)) {
    const h = halfAngle(beamDeg), steps = 600, dt = Math.PI / 2 / steps;
    let sum = 0;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) * dt;
      sum += 2 * Math.PI * Math.sin(t) * Math.exp(-Math.LN2 * (t / h) ** 2) * dt;
    }
    fluxFactors.set(beamDeg, sum);
  }
  return fluxFactors.get(beamDeg);
}

export function peakCandela(lumens, beamDeg) {
  return lumens / fluxFactor(beamDeg);
}

export function intensityAt(lumens, beamDeg, thetaRad) {
  return peakCandela(lumens, beamDeg) * Math.exp(-Math.LN2 * (thetaRad / halfAngle(beamDeg)) ** 2);
}

// Illuminance at (px, py, pz) from a downward-facing fitting at height mountZ.
export function directLux(f, px, py, pz, mountZ) {
  const dz = mountZ - pz;
  if (dz <= 0) return 0;
  const dx = px - f.x, dy = py - f.y;
  const d2 = dx * dx + dy * dy + dz * dz;
  const cos = dz / Math.sqrt(d2);
  return (intensityAt(f.lm, f.beam, Math.acos(cos)) * cos) / d2;
}

// Point calculation sets the pattern; the lumen method sets the level.
export function illuminanceGrid(room, fixtures, coveLumens = 0) {
  const { length: L, width: W, height: H, plane } = room;
  const area = L * W;
  const cell = Math.max(0.1, Math.max(L, W) / 120);
  const nx = Math.max(1, Math.round(L / cell));
  const ny = Math.max(1, Math.round(W / cell));
  const dz = Math.max(0.1, H - plane);
  const src = fixtures.map((f) => ({
    x: f.x, y: f.y, i0: peakCandela(f.lm, f.beam), k: Math.LN2 / halfAngle(f.beam) ** 2,
  }));
  const direct = new Float32Array(nx * ny);
  let directSum = 0;
  for (let j = 0; j < ny; j++) {
    const py = ((j + 0.5) * W) / ny;
    for (let i = 0; i < nx; i++) {
      const px = ((i + 0.5) * L) / nx;
      let e = 0;
      for (const s of src) {
        const dx = px - s.x, dy = py - s.y;
        const d2 = dx * dx + dy * dy + dz * dz;
        const cos = dz / Math.sqrt(d2);
        const t = Math.acos(cos);
        e += (s.i0 * Math.exp(-s.k * t * t) * cos) / d2;
      }
      direct[j * nx + i] = e;
      directSum += e;
    }
  }
  const directMean = directSum / direct.length;
  const lumenAvg = (fixtures.reduce((sum, f) => sum + f.lm, 0) * UF * MF) / area;
  const coveAvg = (coveLumens * COVE_UF * MF) / area;
  const values = new Float32Array(nx * ny);
  let min = Infinity, max = 0, sum = 0;
  for (let n = 0; n < values.length; n++) {
    const shaped = directMean > 0 ? (DIRECT_SHARE * direct[n]) / directMean + (1 - DIRECT_SHARE) : 0;
    const v = lumenAvg * shaped + coveAvg;
    values[n] = v;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const avg = sum / values.length;
  return { nx, ny, values, avg, min, max, uniformity: avg > 0 ? min / avg : 0 };
}

// Merge many fittings into ≤ max lights for real-time 3D (lumens conserved).
export function clusterLights(lights, room, max = 12) {
  if (lights.length <= max) return lights;
  const kx = Math.min(max, Math.max(1, Math.ceil(Math.sqrt((max * room.length) / room.width))));
  const ky = Math.max(1, Math.floor(max / kx));
  const buckets = new Map();
  for (const l of lights) {
    const i = Math.min(kx - 1, Math.floor((l.x / room.length) * kx));
    const j = Math.min(ky - 1, Math.floor((l.y / room.width) * ky));
    const b = buckets.get(`${i},${j}`) || { x: 0, y: 0, lm: 0, n: 0, beam: 0 };
    b.x += l.x; b.y += l.y; b.lm += l.lm; b.n++; b.beam = Math.max(b.beam, l.beam);
    buckets.set(`${i},${j}`, b);
  }
  return [...buckets.values()].map((b) => ({
    x: b.x / b.n, y: b.y / b.n, lm: b.lm, beam: Math.min(120, b.beam + (b.n > 1 ? 30 : 0)),
  }));
}

// Approximate colour of a black body (Tanner Helland's fit).
export function kelvinToRgb(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}
