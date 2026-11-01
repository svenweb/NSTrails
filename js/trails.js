// OSM trail network (via Overpass) + an in-browser A* router so routes snap
// to real trails — fully offline once the network has been downloaded.
import * as store from './store.js';
import { haversine } from './geo.js';
import { NORTH_SHORE_BBOX } from './tiles.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const TRAIL_TYPES = new Set(['path', 'footway', 'track', 'bridleway', 'steps', 'cycleway', 'pedestrian']);
const COST = {
  path: 1, footway: 1, track: 1, bridleway: 1, steps: 1.15, cycleway: 1.05, pedestrian: 1.05,
  living_street: 1.1, residential: 1.15, service: 1.15, unclassified: 1.2, road: 1.2,
  tertiary: 1.35, secondary: 1.7, primary: 2,
};

export function overpassQuery(bbox) {
  const [w, s, e, n] = bbox;
  const hw = Object.keys(COST).join('|');
  return `[out:json][timeout:180];
way["highway"~"^(${hw})$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"](${s},${w},${n},${e});
out body geom qt;`;
}

// Fetch from Overpass and compact into {bbox, fetched, ways:[{id,name,hw,sac,mtb,surface,nodes,coords}]}
export async function fetchNetwork(bbox = NORTH_SHORE_BBOX, onStatus) {
  const body = 'data=' + encodeURIComponent(overpassQuery(bbox));
  let lastErr;
  for (const url of OVERPASS) {
    try {
      onStatus?.(`Querying ${new URL(url).host}…`);
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      onStatus?.('Processing trail data…');
      const json = await res.json();
      const ways = [];
      for (const el of json.elements || []) {
        if (el.type !== 'way' || !el.geometry || !el.nodes) continue;
        const t = el.tags || {};
        ways.push({
          id: el.id,
          name: t.name || t['name:en'] || '',
          hw: t.highway,
          sac: t.sac_scale || '',
          mtb: t['mtb:scale'] || '',
          surface: t.surface || '',
          nodes: el.nodes,
          coords: el.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]),
        });
      }
      const net = { bbox, fetched: Date.now(), ways };
      await store.put('kv', 'trails', net);
      return net;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Overpass unavailable');
}

export const loadNetwork = () => store.get('kv', 'trails');

export function trailsGeoJSON(net) {
  return {
    type: 'FeatureCollection',
    features: net.ways
      .filter((w) => TRAIL_TYPES.has(w.hw))
      .map((w) => ({
        type: 'Feature',
        id: w.id,
        properties: { name: w.name, hw: w.hw, sac: w.sac, mtb: w.mtb, surface: w.surface },
        geometry: { type: 'LineString', coordinates: w.coords },
      })),
  };
}

// Unique named trails, for offline search.
export function trailIndex(net) {
  const byName = new Map();
  for (const w of net.ways) {
    if (!w.name || !TRAIL_TYPES.has(w.hw)) continue;
    let e = byName.get(w.name);
    if (!e) byName.set(w.name, (e = { name: w.name, bbox: [180, 90, -180, -90], hw: w.hw, sac: w.sac }));
    for (const c of w.coords) {
      e.bbox[0] = Math.min(e.bbox[0], c[0]); e.bbox[1] = Math.min(e.bbox[1], c[1]);
      e.bbox[2] = Math.max(e.bbox[2], c[0]); e.bbox[3] = Math.max(e.bbox[3], c[1]);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

const CELL = 0.002; // grid cell size in degrees (~150 x 220 m)

export class Router {
  constructor(net) {
    const idx = new Map();
    const lng = [], lat = [], adj = [];
    const eu = [], ev = [], ef = [], ew = [];
    const add = (id, c) => {
      let i = idx.get(id);
      if (i === undefined) {
        i = lng.length;
        idx.set(id, i);
        lng.push(c[0]); lat.push(c[1]);
        adj.push([]);
      }
      return i;
    };
    this.wayNames = [];
    net.ways.forEach((w, wi) => {
      this.wayNames.push(w.name || '');
      const f = COST[w.hw] ?? 1.3;
      let prev = -1;
      for (let k = 0; k < w.nodes.length; k++) {
        const i = add(w.nodes[k], w.coords[k]);
        if (prev >= 0 && prev !== i) {
          const d = haversine([lng[prev], lat[prev]], [lng[i], lat[i]]);
          adj[prev].push(i, d * f, wi);
          adj[i].push(prev, d * f, wi);
          eu.push(prev); ev.push(i); ef.push(f); ew.push(wi);
        }
        prev = i;
      }
    });
    this.lng = Float64Array.from(lng);
    this.lat = Float64Array.from(lat);
    this.adj = adj;
    this.eu = Int32Array.from(eu); this.ev = Int32Array.from(ev);
    this.ef = Float32Array.from(ef); this.ew = Int32Array.from(ew);
    // Spatial grid over edges (each edge registered in every cell its bbox touches).
    this.grid = new Map();
    for (let e = 0; e < eu.length; e++) {
      const a = eu[e], b = ev[e];
      const x0 = Math.floor(Math.min(lng[a], lng[b]) / CELL), x1 = Math.floor(Math.max(lng[a], lng[b]) / CELL);
      const y0 = Math.floor(Math.min(lat[a], lat[b]) / CELL), y1 = Math.floor(Math.max(lat[a], lat[b]) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(e);
      }
    }
  }

  coord(i) { return [this.lng[i], this.lat[i]]; }

  // Nearest point on any trail segment within maxDist metres.
  // Returns {e, t, point, d} (edge index, fraction along edge, snapped [lng,lat], distance).
  snap(p, maxDist = 400) {
    const kx = Math.cos((p[1] * Math.PI) / 180) * 111320, ky = 110540;
    const rx = Math.ceil(maxDist / kx / CELL), ry = Math.ceil(maxDist / ky / CELL);
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    let best = null;
    const seen = new Set();
    for (let dx = -rx; dx <= rx; dx++) for (let dy = -ry; dy <= ry; dy++) {
      const cell = this.grid.get(`${cx + dx},${cy + dy}`);
      if (!cell) continue;
      for (const e of cell) {
        if (seen.has(e)) continue;
        seen.add(e);
        const a = this.eu[e], b = this.ev[e];
        const ax = (this.lng[a] - p[0]) * kx, ay = (this.lat[a] - p[1]) * ky;
        const bx = (this.lng[b] - p[0]) * kx, by = (this.lat[b] - p[1]) * ky;
        const vx = bx - ax, vy = by - ay;
        const len2 = vx * vx + vy * vy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2)) : 0;
        const x = ax + vx * t, y = ay + vy * t;
        const d = Math.hypot(x, y);
        if (d <= maxDist && (!best || d < best.d)) best = { e, t, d };
      }
    }
    if (!best) return null;
    const a = this.eu[best.e], b = this.ev[best.e];
    best.point = [this.lng[a] + (this.lng[b] - this.lng[a]) * best.t, this.lat[a] + (this.lat[b] - this.lat[a]) * best.t];
    return best;
  }

  // A* between two lng/lat points, starting/ending part-way along trail segments.
  // Returns {coords, names} or null.
  route(a, b, maxSnap = 400) {
    const sa = this.snap(a, maxSnap), sb = this.snap(b, maxSnap);
    if (!sa || !sb) return null;
    const lead = sa.d > 3 ? [a] : [];
    const tail = sb.d > 3 ? [b] : [];
    // Same segment: just walk along it.
    if (sa.e === sb.e) {
      return { coords: [...lead, sa.point, sb.point, ...tail], names: [this.wayNames[this.ew[sa.e]]].filter(Boolean) };
    }
    const T = -1; // virtual target id
    const g = new Map();
    const from = new Map();
    const open = new Heap();
    const goal = sb.point;
    const h = (i) => haversine([this.lng[i], this.lat[i]], goal);
    const segCost = (s, end) => {
      const n = end === 'u' ? this.eu[s.e] : this.ev[s.e];
      return { n, c: haversine(s.point, this.coord(n)) * this.ef[s.e] };
    };
    for (const end of ['u', 'v']) {
      const { n, c } = segCost(sa, end);
      if (c < (g.get(n) ?? Infinity)) {
        g.set(n, c);
        from.set(n, ['S', this.ew[sa.e]]);
        open.push(c + h(n), n);
      }
    }
    const targetEnds = new Map();
    for (const end of ['u', 'v']) {
      const { n, c } = segCost(sb, end);
      targetEnds.set(n, Math.min(c, targetEnds.get(n) ?? Infinity));
    }
    const closed = new Set();
    let found = false, iter = 0;
    while (open.size) {
      const u = open.pop();
      if (u === T) { found = true; break; }
      if (closed.has(u)) continue;
      closed.add(u);
      if (++iter > 500000) break;
      const gu = g.get(u);
      if (targetEnds.has(u)) {
        const nd = gu + targetEnds.get(u);
        if (nd < (g.get(T) ?? Infinity)) {
          g.set(T, nd);
          from.set(T, [u, this.ew[sb.e]]);
          open.push(nd, T);
        }
      }
      const e = this.adj[u];
      for (let k = 0; k < e.length; k += 3) {
        const v = e[k];
        if (closed.has(v)) continue;
        const nd = gu + e[k + 1];
        if (nd < (g.get(v) ?? Infinity)) {
          g.set(v, nd);
          from.set(v, [u, e[k + 2]]);
          open.push(nd + h(v), v);
        }
      }
    }
    if (!found) return null;
    const path = [sb.point];
    const names = [];
    let cur = T;
    for (;;) {
      const f = from.get(cur);
      const nm = this.wayNames[f[1]];
      if (nm && names[names.length - 1] !== nm) names.push(nm);
      if (f[0] === 'S') break;
      cur = f[0];
      path.push(this.coord(cur));
    }
    path.push(sa.point);
    path.reverse();
    names.reverse();
    return { coords: [...lead, ...path, ...tail], names };
  }
}
