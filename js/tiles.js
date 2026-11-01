// Tile sources, a cache-first fetch backed by Cache Storage, and the
// offline "download this area" logic. The service worker reads from the same
// cache, so anything stored here is also served when the page is offline.
import * as maplibregl from '../vendor/maplibre-gl.mjs';
import mlcontour from '../vendor/maplibre-contour.mjs';
import { tilesInBbox } from './geo.js';

export const TILE_CACHE = 'nst-tiles-v1';
export const PROTO = 'nst';

export const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
export const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
export const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_MAXZOOM = 13;
export const SAT_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg';
export const SAT_MAXZOOM = 14;
export const VECTOR_MAXZOOM = 14;

// North Shore mountains, Horseshoe Bay to Indian Arm.
export const NORTH_SHORE_BBOX = [-123.3, 49.3, -122.88, 49.47];

let cachePromise;
const openCache = () => (cachePromise ||= caches.open(TILE_CACHE));

export async function cachedFetch(url, { signal, networkFirst = false } = {}) {
  const cache = await openCache().catch(() => null);
  if (cache && !networkFirst) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  try {
    const res = await fetch(url, { signal, mode: 'cors' });
    if (res.ok && cache) cache.put(url, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    if (cache && networkFirst) {
      const hit = await cache.match(url);
      if (hit) return hit;
    }
    throw err;
  }
}

// nst://https://... -> cache-first fetch. Used for vector tiles and glyphs,
// so MapLibre never depends on the service worker intercepting worker fetches.
maplibregl.addProtocol(PROTO, async (params, abort) => {
  const url = params.url.slice(PROTO.length + 3);
  const res = await cachedFetch(url, { signal: abort.signal });
  if (res.status === 404 || res.status === 204) return { data: new ArrayBuffer(0) };
  if (!res.ok) throw new Error(`Tile ${res.status}`);
  if (params.type === 'json') return { data: await res.json() };
  return { data: await res.arrayBuffer() };
});

export const viaCache = (url) => `${PROTO}://${url}`;

// DEM tiles flow through maplibre-contour's manager (contours, hillshade,
// terrain and our elevation sampler share one decoded-tile cache). With
// worker:false its fetches run on the main thread, which the SW controls.
export const demSource = new mlcontour.DemSource({
  url: DEM_URL,
  encoding: 'terrarium',
  maxzoom: DEM_MAXZOOM,
  worker: false,
  cacheSize: 200,
  timeoutMs: 15000,
});
demSource.setupMaplibre(maplibregl);
// Route the DEM manager's tile fetches through our cache too (works offline
// even if the service worker is not controlling the page yet).
if (demSource.manager && 'getTile' in demSource.manager) {
  demSource.manager.getTile = async (url, abort) => {
    const res = await cachedFetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`Bad response: ${res.status} for ${url}`);
    return { data: await res.blob() };
  };
}

// Resolve the OpenFreeMap TileJSON (versioned tile URLs). Network first so we
// pick up new planet builds, fall back to the cached copy when offline.
let tileJsonPromise;
export function getTileJson() {
  tileJsonPromise ||= cachedFetch(OFM_TILEJSON, { networkFirst: true })
    .then((r) => r.json())
    .catch(() => null);
  return tileJsonPromise;
}

const fill = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);

// Build the list of URLs needed to use an area offline.
export async function planDownload(bbox, { satellite = false, maxVectorZoom = VECTOR_MAXZOOM } = {}) {
  const tj = await getTileJson();
  if (!tj) throw new Error('Could not reach the map tile server. Connect to the internet to download.');
  const vtpl = tj.tiles[0];
  const urls = [OFM_TILEJSON];
  for (let z = 0; z <= maxVectorZoom; z++) for (const [, x, y] of tilesInBbox(bbox, z)) urls.push(fill(vtpl, z, x, y));
  for (let z = 0; z <= DEM_MAXZOOM; z++) for (const [, x, y] of tilesInBbox(bbox, z)) urls.push(fill(DEM_URL, z, x, y));
  if (satellite) for (let z = 0; z <= SAT_MAXZOOM; z++) for (const [, x, y] of tilesInBbox(bbox, z)) urls.push(fill(SAT_URL, z, x, y));
  for (const f of FONTS) for (const r of GLYPH_RANGES) urls.push(GLYPHS.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r));
  return urls;
}

export async function download(urls, onProgress, signal) {
  const cache = await openCache();
  let done = 0, failed = 0, bytes = 0, skipped = 0;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const url = urls[i++];
      try {
        const hit = await cache.match(url);
        if (hit) {
          skipped++;
        } else {
          const res = await fetch(url, { mode: 'cors', signal });
          if (res.ok) {
            const blob = await res.clone().blob();
            bytes += blob.size;
            await cache.put(url, res);
          } else if (res.status !== 404) failed++;
        }
      } catch (e) {
        if (signal?.aborted) return;
        failed++;
      }
      done++;
      onProgress?.({ done, total: urls.length, failed, bytes, skipped });
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return { done, failed, bytes, skipped };
}

export async function cachedTileCount() {
  try {
    const cache = await openCache();
    return (await cache.keys()).length;
  } catch {
    return 0;
  }
}

export async function clearTiles() {
  cachePromise = null;
  await caches.delete(TILE_CACHE);
}
