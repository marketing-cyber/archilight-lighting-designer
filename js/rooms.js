// Room presets: target average illuminance (lux) and working-plane height (m).
export const ROOMS = {
  living: { label: 'Living room', sector: 'residential', lux: 150, size: [5, 4, 2.6], plane: 0 },
  kitchen: { label: 'Kitchen', sector: 'residential', lux: 300, size: [4, 3.5, 2.6], plane: 0 },
  bedroom: { label: 'Bedroom', sector: 'residential', lux: 100, size: [4, 3.6, 2.6], plane: 0 },
  dining: { label: 'Dining', sector: 'residential', lux: 150, size: [4, 3.5, 2.6], plane: 0 },
  office: { label: 'Office', sector: 'commercial', lux: 500, size: [8, 6, 2.8], plane: 0.75 },
  retail: { label: 'Retail', sector: 'commercial', lux: 750, size: [10, 7, 3.2], plane: 0.75 },
  hospitality: { label: 'Restaurant / café', sector: 'commercial', lux: 200, size: [10, 8, 3], plane: 0.75 },
  corridor: { label: 'Corridor', sector: 'commercial', lux: 100, size: [12, 1.8, 2.7], plane: 0 },
};

export const MOODS = {
  warm: { label: 'Warm white', cct: 2700 },
  soft: { label: 'Neutral white', cct: 3000 },
  bright: { label: 'Cool white', cct: 4000 },
};

export const LIMITS = { side: [1, 30], height: [2.2, 6] };

const fit = (v, [lo, hi], fallback) => {
  const n = Number.isFinite(v) ? v : fallback;
  return Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100;
};

export function clampSize(size) {
  return {
    length: fit(Number(size.length), LIMITS.side, 5),
    width: fit(Number(size.width), LIMITS.side, 4),
    height: fit(Number(size.height), LIMITS.height, 2.6),
  };
}
