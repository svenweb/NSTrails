// Elevation sampling from Terrarium DEM tiles (AWS open terrain tiles).
import { demSource, DEM_MAXZOOM } from './tiles.js';
import { lngLatToWorldPx, resample } from './geo.js';

const Z = DEM_MAXZOOM;
const tilePromises = new Map();

function tile(x, y) {
  const key = `${x}/${y}`;
  if (!tilePromises.has(key)) {
    const p = demSource.getDemTile(Z, x, y).catch((e) => {
      tilePromises.delete(key);
      throw e;
    });
    tilePromises.set(key, p);
    if (tilePromises.size > 400) tilePromises.delete(tilePromises.keys().next().value);
  }
  return tilePromises.get(key);
}

function sampleTile(t, px, py) {
  const w = t.width, h = t.height;
  const sx = (px * w) / 256 - 0.5, sy = (py * h) / 256 - 0.5;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
  const d = t.data;
  const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + e * fx * fy;
}

export async function elevationAt(p) {
  const [wx, wy] = lngLatToWorldPx(p, Z);
  const tx = Math.floor(wx / 256), ty = Math.floor(wy / 256);
  try {
    const t = await tile(tx, ty);
    return sampleTile(t, wx - tx * 256, wy - ty * 256);
  } catch {
    return null;
  }
}

export async function elevations(coords) {
  return Promise.all(coords.map(elevationAt));
}

// Build an elevation profile for a route: resampled every `spacing` metres.
export async function profile(coords, spacing = 25) {
  if (coords.length < 2) return null;
  const rs = resample(coords, spacing);
  const ele = await elevations(rs.coords);
  // Fill gaps (missing tiles) by carrying neighbours.
  let last = ele.find((v) => v != null) ?? 0;
  for (let i = 0; i < ele.length; i++) {
    if (ele[i] == null) ele[i] = last;
    else last = ele[i];
  }
  // Light smoothing to remove DEM pixel noise.
  const sm = ele.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) {
      const v = ele[i + k];
      if (v != null) { s += v; n++; }
    }
    return s / n;
  });
  return { coords: rs.coords, dist: rs.dist, ele: sm, ...gainLoss(sm) };
}

export function gainLoss(ele, threshold = 3) {
  let gain = 0, loss = 0, min = Infinity, max = -Infinity;
  let ref = ele[0];
  for (const v of ele) {
    if (v < min) min = v;
    if (v > max) max = v;
    const d = v - ref;
    if (d >= threshold) { gain += d; ref = v; }
    else if (d <= -threshold) { loss -= d; ref = v; }
  }
  return { gain, loss, min, max };
}

// Moving-time estimate. Hiking: Tobler's hiking function scaled by a fitness
// factor. Running: flat pace adjusted for grade (rough GAP model).
export function estimateTime(prof, mode, { flatPace = 360, hikeFactor = 1 } = {}) {
  if (!prof) return null;
  let t = 0;
  for (let i = 1; i < prof.dist.length; i++) {
    const dx = prof.dist[i] - prof.dist[i - 1];
    if (dx <= 0) continue;
    const g = (prof.ele[i] - prof.ele[i - 1]) / dx;
    if (mode === 'run') {
      const gp = g * 100;
      let f = gp >= 0 ? 1 + 0.035 * gp + 0.0015 * gp * gp : Math.max(0.82, 1 + 0.018 * gp + 0.0012 * gp * gp);
      if (gp < -10) f = 0.88 + (-gp - 10) * 0.02; // steep descents slow you down
      t += (dx / 1000) * flatPace * f;
    } else {
      const kmh = 6 * Math.exp(-3.5 * Math.abs(g + 0.05));
      t += (dx / 1000 / Math.max(kmh, 0.5)) * 3600 * hikeFactor;
    }
  }
  return t;
}
