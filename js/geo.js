// Small geometry helpers. Coordinates are [lng, lat] everywhere.

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const p1 = toRad(a[1]);
  const p2 = toRad(b[1]);
  const dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Move from a point by distance (m) along bearing (deg).
export function destination(p, dist, brg) {
  const d = dist / R;
  const t = toRad(brg);
  const p1 = toRad(p[1]);
  const l1 = toRad(p[0]);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(l2), toDeg(p2)];
}

export function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function cumulative(coords) {
  const out = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + haversine(coords[i - 1], coords[i]);
  return out;
}

// Point at distance d along a line, given cumulative distances.
export function pointAt(coords, cum, d) {
  if (!coords.length) return null;
  if (d <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (d >= total) return coords[coords.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  return lerp(coords[lo], coords[hi], seg > 0 ? (d - cum[lo]) / seg : 0);
}

// Resample a line at a fixed spacing (m). Returns {coords, dist}.
export function resample(coords, spacing) {
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] || 0;
  const n = Math.max(2, Math.ceil(total / spacing) + 1);
  const out = [];
  const dist = [];
  for (let i = 0; i < n; i++) {
    const d = Math.min(total, (i * total) / (n - 1));
    out.push(pointAt(coords, cum, d));
    dist.push(d);
  }
  return { coords: out, dist };
}

// Nearest position on a polyline to point p. Returns {dist (m to line), along (m from start), index}.
export function nearestOnLine(coords, cum, p) {
  let best = { dist: Infinity, along: 0, index: 0 };
  const kx = Math.cos(toRad(p[1])) * 111320;
  const ky = 110540;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + dx * t, y = ay + dy * t;
    const d = Math.sqrt(x * x + y * y);
    if (d < best.dist) best = { dist: d, along: cum[i] + (cum[i + 1] - cum[i]) * t, index: i };
  }
  return best;
}

export function bboxOf(coords, pad = 0) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w - pad, s - pad, e + pad, n + pad];
}

// Web mercator tile math
export function lngToTileX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
export function latToTileY(lat, z) {
  const r = toRad(lat);
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
// Fractional pixel position inside the world at zoom z for 256px tiles
export function lngLatToWorldPx(p, z) {
  const scale = 256 * 2 ** z;
  const x = ((p[0] + 180) / 360) * scale;
  const r = toRad(p[1]);
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale;
  return [x, y];
}

export function tilesInBbox(bbox, z) {
  const [w, s, e, n] = bbox;
  const x0 = lngToTileX(w, z), x1 = lngToTileX(e, z);
  const y0 = latToTileY(n, z), y1 = latToTileY(s, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

export function fmtDist(m) {
  if (m == null || isNaN(m)) return '–';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
export function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function fmtPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}
