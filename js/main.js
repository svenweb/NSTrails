import * as maplibregl from '../vendor/maplibre-gl.mjs';
import { getTileJson, planDownload, download, cachedTileCount, clearTiles, NORTH_SHORE_BBOX } from './tiles.js';
import { buildStyle } from './style.js';
import { profile as buildProfile, estimateTime } from './elevation.js';
import { fetchNetwork, loadNetwork, trailsGeoJSON, trailIndex, Router } from './trails.js';
import { HIKES } from './hikes.js';
import { ProfileChart } from './profile.js';
import { Tracker } from './tracker.js';
import { Flyover } from './flyover.js';
import { routeToGpx, trackToGpx, parseGpx, downloadFile } from './gpx.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { cumulative, pointAt, nearestOnLine, bboxOf, fmtDist, fmtDuration, fmtClock, fmtPace } from './geo.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let flying = false;

// ================================================================ helpers
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const geo = (coords) => ({ type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] });
const pt = (c) => ({ type: 'FeatureCollection', features: c ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }] : [] });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (text, onclick, cls = '') => Object.assign(document.createElement('button'), { textContent: text, onclick, className: cls });
const isDesktop = () => innerWidth >= 860;

// ================================================================ service worker / network
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
navigator.storage?.persist?.().catch(() => {});
function updateNet() {
  $('#net-status').hidden = navigator.onLine;
}
addEventListener('online', () => { updateNet(); syncRoutes(); });
addEventListener('offline', updateNet);
updateNet();

// ================================================================ map
const savedView = store.setting('view', null);
const tileJson = await getTileJson();
if (!tileJson) toast('No map tiles yet — connect once, or save the area for offline use.', 5000);

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(tileJson),
  center: savedView?.center || [-123.09, 49.385],
  zoom: savedView?.zoom ?? 11.6,
  maxPitch: 85,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.on('moveend', () => store.saveSetting('view', { center: map.getCenter().toArray(), zoom: map.getZoom() }));
map.on('rotate', () => ($('#compass').style.transform = `rotate(${-map.getBearing()}deg)`));
await new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');

// ================================================================ layers & 3D
let terrainOn = store.setting('terrain', false);
function setTerrain(on, animate = true) {
  terrainOn = on;
  store.saveSetting('terrain', on);
  $('#btn-3d').classList.toggle('on', on);
  if (on) {
    map.setTerrain({ source: 'dem', exaggeration: 1.3 });
    try {
      map.setSky({ 'sky-color': '#7fb2e5', 'horizon-color': '#dbe9f4', 'fog-color': '#eef2f3', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.5, 'atmosphere-blend': 0.6 });
    } catch {}
    if (animate && map.getPitch() < 30) map.easeTo({ pitch: 62, duration: 900 });
  } else {
    map.setTerrain(null);
    if (animate) map.easeTo({ pitch: 0, duration: 600 });
  }
}
setTerrain(terrainOn, false);
$('#btn-3d').onclick = () => setTerrain(!terrainOn);
$('#btn-north').onclick = () => map.easeTo({ bearing: 0, pitch: terrainOn ? map.getPitch() : 0 });

const layerPrefs = store.setting('layers', { sat: false, contour: true, hillshade: true, trails: true });
const LAYER_GROUPS = { sat: ['sat'], contour: ['contour', 'contour-label'], hillshade: ['hillshade'], trails: ['trails', 'trails-hit', 'trail-label'] };
function applyLayers() {
  for (const [k, ids] of Object.entries(LAYER_GROUPS))
    for (const id of ids) map.setLayoutProperty(id, 'visibility', layerPrefs[k] ? 'visible' : 'none');
  map.setPaintProperty('hillshade', 'hillshade-exaggeration', layerPrefs.sat ? 0.15 : 0.4);
}
$$('#layers-panel input[data-layer]').forEach((cb) => {
  cb.checked = !!layerPrefs[cb.dataset.layer];
  cb.onchange = () => {
    layerPrefs[cb.dataset.layer] = cb.checked;
    store.saveSetting('layers', layerPrefs);
    applyLayers();
  };
});
applyLayers();
$('#btn-layers').onclick = (e) => {
  e.stopPropagation();
  $('#layers-panel').hidden = !$('#layers-panel').hidden;
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('#layers-panel, #btn-layers')) $('#layers-panel').hidden = true;
  if (!e.target.closest('#more-menu, #btn-more')) $('#more-menu').hidden = true;
  if (!e.target.closest('.search')) $('#search-results').hidden = true;
});

// ================================================================ bottom sheet & tabs
const sheet = $('#sheet');
function setSheet(size) {
  sheet.dataset.size = size;
  document.body.dataset.sheet = size;
  setTimeout(() => map.resize(), 260);
}
setSheet('half');
{
  const handle = $('#sheet-handle');
  let startY = 0, startH = 0, moved = false, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    startH = sheet.getBoundingClientRect().height;
    moved = false;
    dragging = true;
    sheet.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    sheet.style.height = `${Math.max(90, Math.min(innerHeight - 80, startH + dy))}px`;
  });
  handle.addEventListener('pointerup', () => {
    dragging = false;
    sheet.classList.remove('dragging');
    const h = sheet.getBoundingClientRect().height;
    sheet.style.height = '';
    if (!moved) return setSheet(sheet.dataset.size === 'min' ? 'half' : sheet.dataset.size === 'half' ? 'full' : 'min');
    const r = h / innerHeight;
    setSheet(r < 0.3 ? 'min' : r < 0.7 ? 'half' : 'full');
  });
}
let currentTab = 'plan';
function showTab(name) {
  currentTab = name;
  $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
  if (sheet.dataset.size === 'min') setSheet('half');
  if (name === 'plan') chart.draw();
  if (name === 'offline') refreshCacheStatus();
  if (name !== 'plan') setAdding(false);
}
$$('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ================================================================ trail network
let router = null;
let index = [];
async function useNetwork(net) {
  if (!net) return;
  map.getSource('trails').setData(trailsGeoJSON(net));
  map.setLayoutProperty('osm-paths', 'visibility', 'none');
  router = new Router(net);
  index = trailIndex(net);
  $('#trails-status').textContent = `Trail data: ${index.length} named trails, updated ${new Date(net.fetched).toLocaleDateString()}.`;
  if (waypoints.length > 1) { legs = []; recompute(); }
}
async function downloadTrails() {
  $('#btn-trails').disabled = true;
  try {
    const net = await fetchNetwork(NORTH_SHORE_BBOX, (s) => ($('#trails-status').textContent = s));
    await useNetwork(net);
  } catch (e) {
    $('#trails-status').textContent = `Couldn't load trail data (${e.message}). It will retry next time you're online.`;
  } finally {
    $('#btn-trails').disabled = false;
  }
}
$('#btn-trails').onclick = downloadTrails;

// Trail info popup (when not adding points)
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' });
const SAC = { hiking: 'Easy (T1)', mountain_hiking: 'Moderate (T2)', demanding_mountain_hiking: 'Difficult (T3)', alpine_hiking: 'Alpine (T4)', demanding_alpine_hiking: 'Alpine (T5)', difficult_alpine_hiking: 'Alpine (T6)' };
map.on('click', 'trails-hit', (e) => {
  if (adding || flying) return;
  const f = e.features[0];
  const p = f.properties;
  const bits = [SAC[p.sac], p.hw, p.mtb ? `MTB ${p.mtb}` : '', p.surface].filter(Boolean).join(' · ');
  const div = document.createElement('div');
  div.innerHTML = `<b>${esc(p.name || 'Unnamed trail')}</b><br><small>${esc(bits)}</small><br>`;
  div.appendChild(button(waypoints.length ? '＋ Add to route' : '＋ Start route here', () => {
    popup.remove();
    showTab('plan');
    addPoint([e.lngLat.lng, e.lngLat.lat]);
    setAdding(true);
  }, 'btn small primary'));
  popup.setLngLat(e.lngLat).setDOMContent(div).addTo(map);
  map.getSource('hover').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: f.geometry }] });
});
popup.on('close', () => map.getSource('hover').setData(geo([])));
map.on('mouseenter', 'trails-hit', () => { if (!adding) map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'trails-hit', () => { if (!adding) map.getCanvas().style.cursor = ''; });

// ================================================================ route planning
let waypoints = [];
let legs = [];
let routeCoords = [];
let routeCum = new Float64Array(1);
let routeProfile = null;
let routeId = null; // id of the saved route being edited, if any
let dirty = false;
let adding = false;
let markers = [];
const history = [];

const chart = new ProfileChart($('#profile'), (d) => {
  if (d == null || routeCoords.length < 2) return hoverMarker.remove();
  hoverMarker.setLngLat(pointAt(routeCoords, routeCum, d)).addTo(map);
});
const hoverEl = Object.assign(document.createElement('div'), { className: 'fly-marker' });
const hoverMarker = new maplibregl.Marker({ element: hoverEl });

const snapOn = () => $('#snap').checked;
const routeNameVal = () => $('#route-name').value.trim();

function snapshot() {
  history.push(JSON.stringify({ waypoints, name: $('#route-name').value }));
  if (history.length > 60) history.shift();
}
function undo() {
  const prev = history.pop();
  if (!prev) return toast('Nothing to undo', 1200);
  const s = JSON.parse(prev);
  waypoints = s.waypoints;
  $('#route-name').value = s.name;
  dirty = true;
  recompute();
}

function setAdding(on) {
  adding = on;
  $('#btn-add').setAttribute('aria-pressed', on);
  $('#btn-add').textContent = on ? '✓ Adding points' : '＋ Add points';
  $('#add-banner').hidden = !on;
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  if (on) popup.remove();
  else map.getSource('snap-preview').setData(pt(null));
  updateBanner();
}
function updateBanner() {
  const n = waypoints.length;
  const what = snapOn() ? 'a trail' : 'the map';
  $('#add-banner-text').textContent = n === 0 ? `Tap ${what} where you start` : n === 1 ? `Now tap ${what} where you want to go` : `Tap ${what} to keep going`;
}

// Snap tolerance in metres for a ~28px finger tap at the current zoom.
function tapTolerance(lat) {
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  return Math.max(15, Math.min(500, mpp * 28));
}
function snapPoint(p) {
  if (!snapOn() || !router) return p;
  return router.snap(p, tapTolerance(p[1]))?.point || null;
}

function addPoint(p) {
  const s = snapPoint(p);
  if (!s) {
    toast(router ? 'No trail there — tap on a trail line (or turn off “Follow trails” in ⋯)' : 'Trail data still loading…', 2600);
    return;
  }
  snapshot();
  waypoints.push(s);
  dirty = true;
  showPlanEdit();
  recompute();
}

map.on('click', (e) => {
  if (!adding || flying) return;
  if (e.originalEvent?.target?.closest?.('.wp')) return;
  addPoint([e.lngLat.lng, e.lngLat.lat]);
});
// Desktop: preview where a click will snap to.
map.on('mousemove', (e) => {
  if (!adding) return;
  const s = snapPoint([e.lngLat.lng, e.lngLat.lat]);
  map.getSource('snap-preview').setData(pt(s));
  map.getCanvas().style.cursor = s ? 'crosshair' : 'not-allowed';
});

let editing = false;
function showPlanEdit() {
  const has = editing || waypoints.length > 0 || routeId;
  $('#plan-empty').hidden = !!has;
  $('#plan-edit').hidden = !has;
}
$('#btn-new').onclick = () => {
  newRoute();
  editing = true;
  showPlanEdit();
  setAdding(true);
  if (!isDesktop()) setSheet('min');
};
$('#link-hikes').onclick = (e) => { e.preventDefault(); showTab('routes'); };
$('#btn-add').onclick = () => {
  setAdding(!adding);
  if (adding && !isDesktop()) setSheet('min');
};
$('#banner-done').onclick = () => { setAdding(false); setSheet('half'); };
$('#banner-undo').onclick = undo;
$('#btn-undo').onclick = undo;
$('#btn-outback').onclick = () => {
  if (waypoints.length < 2) return toast('Add at least two points first');
  snapshot();
  waypoints = [...waypoints, ...waypoints.slice(0, -1).reverse()];
  dirty = true;
  recompute();
  toast('Return leg added');
};
$('#btn-more').onclick = (e) => { e.stopPropagation(); $('#more-menu').hidden = !$('#more-menu').hidden; };
$('#snap').onchange = () => { legs = []; recompute(); updateBanner(); };
$('#more-menu').onclick = (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  $('#more-menu').hidden = true;
  if (act === 'import') return $('#gpx-file').click();
  if (act === 'export') {
    if (routeCoords.length < 2) return toast('Nothing to export yet');
    const name = routeNameVal() || 'Route';
    return downloadFile(`${name.replace(/[^\w-]+/g, '_')}.gpx`, routeToGpx(name, routeProfile?.coords || routeCoords, routeProfile?.ele));
  }
  if (act === 'clear') {
    if (dirty && waypoints.length > 1 && !confirm('Discard this route? Unsaved changes will be lost.')) return;
    newRoute();
    editing = false;
    setAdding(false);
    return showPlanEdit();
  }
  if (waypoints.length < 2) return;
  snapshot();
  if (act === 'reverse') waypoints.reverse();
  if (act === 'loop') waypoints.push(waypoints[0]);
  dirty = true;
  recompute();
};
$('#gpx-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const { name, coords } = parseGpx(await file.text());
  if (coords.length < 2) return toast('No track found in that file');
  newRoute();
  const step = Math.max(1, Math.floor(coords.length / 80));
  waypoints = coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
  $('#route-name').value = name;
  $('#snap').checked = false; // keep the imported line exactly
  dirty = true;
  showPlanEdit();
  await recompute();
  fitRoute();
  toast(`Imported “${name}”`);
};
$('#route-name').addEventListener('input', () => { dirty = true; updateSaveStatus(); });

function newRoute() {
  snapshot();
  waypoints = [];
  legs = [];
  routeId = null;
  dirty = false;
  $('#route-name').value = '';
  $('#snap').checked = true;
  showTab('plan');
  showPlanEdit();
  recompute();
}

function legFor(a, b) {
  const snap = snapOn() && !!router;
  const key = `${a}|${b}|${snap}`;
  const hit = legs.find((l) => l.key === key);
  if (hit) return hit;
  const r = snap ? router.route(a, b) : null;
  return { key, coords: r?.coords || [a, b], names: r?.names || [], snapped: !!r };
}

let seq = 0;
async function recompute() {
  const my = ++seq;
  const nl = [];
  for (let i = 1; i < waypoints.length; i++) nl.push(legFor(waypoints[i - 1], waypoints[i]));
  legs = nl;
  routeCoords = waypoints.length === 1 ? [waypoints[0]] : [];
  for (const l of legs) routeCoords.push(...(routeCoords.length ? l.coords.slice(1) : l.coords));
  routeCum = cumulative(routeCoords);
  map.getSource('route').setData(geo(routeCoords));
  renderMarkers();
  updateBanner();
  showPlanEdit();
  const names = [...new Set(legs.flatMap((l) => l.names))];
  let via = names.length ? `Via ${names.slice(0, 10).join(' → ')}${names.length > 10 ? ' …' : ''}` : '';
  if (snapOn() && legs.some((l) => !l.snapped)) via += `${via ? ' · ' : ''}${router ? 'Some legs aren’t connected by trails (shown straight)' : 'Trail data loading — legs shown straight'}`;
  $('#route-via').textContent = via;
  const has = routeCoords.length > 1;
  for (const id of ['#btn-fly', '#btn-save', '#btn-dl-route', '#btn-outback']) $(id).disabled = !has;
  $('#st-dist').textContent = has ? fmtDist(routeCum[routeCum.length - 1]) : '–';
  routeProfile = has ? await buildProfile(routeCoords) : null;
  if (my !== seq) return;
  chart.set(routeProfile);
  updateStats();
  updateFollow();
  updateSaveStatus();
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers = waypoints.map((p, i) => {
    const el = document.createElement('div');
    const last = i === waypoints.length - 1 && i > 0;
    const loopEnd = last && waypoints[0][0] === p[0] && waypoints[0][1] === p[1];
    el.className = `wp ${i === 0 ? 'start' : last ? 'end' : ''}`;
    el.textContent = i === 0 ? 'S' : last ? (loopEnd ? '⟳' : 'F') : '';
    el.title = 'Drag to move · tap to remove';
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
    m.on('dragstart', snapshot);
    m.on('dragend', () => {
      const ll = m.getLngLat();
      const s = snapPoint([ll.lng, ll.lat]);
      if (!s) {
        history.pop();
        m.setLngLat(waypoints[i]);
        return toast('Drop the point on a trail');
      }
      waypoints[i] = s;
      dirty = true;
      recompute();
    });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const div = document.createElement('div');
      div.innerHTML = `<b>${i === 0 ? 'Start' : last ? 'Finish' : `Point ${i + 1}`}</b><br><small>Drag the point to move it.</small><br>`;
      const pop = new maplibregl.Popup({ offset: 14, closeButton: false });
      div.appendChild(button('Remove point', () => {
        snapshot();
        waypoints.splice(i, 1);
        dirty = true;
        pop.remove();
        recompute();
      }, 'btn small danger'));
      pop.setLngLat(waypoints[i]).setDOMContent(div).addTo(map);
    });
    return m;
  });
}

// ---- time estimate settings
function paceSettings() {
  const [m, s] = $('#run-pace').value.split(':').map(Number);
  return { flatPace: (m || 6) * 60 + (s || 0), hikeFactor: parseFloat($('#hike-factor').value) };
}
let paceMode = store.setting('paceMode', 'hike');
$('#run-pace').value = store.setting('runPace', '6:00');
$('#hike-factor').value = store.setting('hikeFactor', '1');
function syncPaceUI() {
  $$('.seg2 button').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === paceMode));
  $$('#pace-row label[data-for]').forEach((l) => (l.hidden = l.dataset.for !== paceMode));
  const hf = $('#hike-factor').selectedOptions[0]?.textContent.toLowerCase();
  $('#pace-summary').textContent = paceMode === 'run' ? `running ${$('#run-pace').value}/km` : `${hf} hiking`;
  $('#st-time-label').textContent = paceMode === 'run' ? 'Run time' : 'Hike time';
}
$$('.seg2 button').forEach((b) => (b.onclick = () => { paceMode = b.dataset.mode; store.saveSetting('paceMode', paceMode); syncPaceUI(); updateStats(); }));
for (const id of ['#run-pace', '#hike-factor'])
  $(id).addEventListener('change', () => {
    store.saveSetting('runPace', $('#run-pace').value);
    store.saveSetting('hikeFactor', $('#hike-factor').value);
    syncPaceUI();
    updateStats();
  });
$('#btn-pace').onclick = () => {
  const open = $('#pace-row').hidden;
  $('#pace-row').hidden = !open;
  $('#btn-pace').setAttribute('aria-expanded', open);
};
syncPaceUI();

const routeTime = (p) => estimateTime(p, paceMode, paceSettings());
function updateStats() {
  const p = routeProfile;
  $('#st-gain').textContent = p ? `${Math.round(p.gain)} m` : '–';
  $('#st-time').textContent = p ? fmtDuration(routeTime(p)) : '–';
  $('#st-loss').textContent = p ? `↓ ${Math.round(p.loss)} m descent` : '↓ –';
  $('#st-range').textContent = p ? `${Math.round(p.min)}–${Math.round(p.max)} m elevation` : '–';
  $('#st-loss').hidden = $('#st-range').hidden = !p;
  $('.substats').classList.toggle('bare', !p);
}

function fitRoute() {
  if (routeCoords.length < 2) return;
  const b = bboxOf(routeCoords);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
    padding: isDesktop() ? { top: 80, bottom: 40, left: 430, right: 70 } : { top: 80, bottom: innerHeight * 0.5 + 40, left: 40, right: 70 },
    duration: 800,
    maxZoom: 15.5,
  });
}

// ================================================================ saved routes (+ sync)
function updateSaveStatus(msg) {
  const el = $('#save-status');
  if (msg) return (el.textContent = msg);
  if (!routeId) el.textContent = waypoints.length > 1 ? 'Not saved yet.' : '';
  else el.textContent = dirty ? 'Unsaved changes.' : 'Saved.';
}

const toRemote = (r) => ({ id: r.id, name: r.name, waypoints: r.waypoints.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]), snap: r.snap, created: r.created, updated: r.updated, dist: Math.round(r.dist), gain: Math.round(r.gain), time: Math.round(r.time || 0) });

$('#btn-save').onclick = async () => {
  let name = routeNameVal();
  if (!name) {
    name = `Route ${new Date().toLocaleDateString()}`;
    $('#route-name').value = name;
  }
  const id = routeId || `r${Date.now().toString(36)}`;
  const prev = routeId ? await store.get('routes', id) : null;
  const r = {
    id, name, waypoints, snap: snapOn(),
    created: prev?.created || Date.now(), updated: Date.now(),
    dist: routeCum[routeCum.length - 1], gain: routeProfile?.gain || 0, time: routeProfile ? routeTime(routeProfile) : 0,
    synced: false,
  };
  await store.put('routes', id, r);
  routeId = id;
  dirty = false;
  renderSavedRoutes();
  if (sync.getToken() && navigator.onLine) {
    updateSaveStatus('Saving to all your devices…');
    try {
      await sync.update((list) => [...list.filter((x) => x.id !== id), toRemote(r)], `Save route: ${name}`);
      await store.put('routes', id, { ...r, synced: true });
      updateSaveStatus('Saved · synced to your other devices.');
      renderSavedRoutes();
    } catch (e) {
      updateSaveStatus(`Saved on this device. Sync failed: ${e.message}`);
    }
  } else {
    updateSaveStatus(sync.getToken() ? 'Saved on this device — will sync when back online.' : 'Saved on this device. Set up sync (Offline tab) to see it on your other devices.');
  }
  toast('Route saved');
};

async function renderSavedRoutes() {
  const items = (await store.all('routes')).map((x) => x.value).filter((r) => !r.pendingDelete).sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  const ul = $('#saved-routes');
  ul.innerHTML = items.length ? '' : '<li class="empty">No saved routes yet. Plan one and tap Save.</li>';
  for (const r of items) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="grow"><b>${esc(r.name)}</b><small>${fmtDist(r.dist)} · ↑${Math.round(r.gain || 0)} m${r.time ? ` · ${fmtDuration(r.time)}` : ''}${r.synced ? '' : ' · <span title="Only on this device">this device</span>'}</small></div>`;
    li.querySelector('.grow').onclick = () => openRoute(r);
    li.append(
      button('Open', () => openRoute(r)),
      button('✕', () => deleteRoute(r), 'icon')
    );
    li.lastChild.title = 'Delete';
    li.lastChild.setAttribute('aria-label', `Delete ${r.name}`);
    ul.appendChild(li);
  }
}
async function openRoute(r) {
  if (dirty && waypoints.length > 1 && !confirm('Discard unsaved changes to the current route?')) return;
  snapshot();
  waypoints = r.waypoints.map((p) => [...p]);
  routeId = r.id;
  $('#route-name').value = r.name;
  $('#snap').checked = r.snap !== false;
  legs = [];
  showTab('plan');
  await recompute();
  dirty = false;
  updateSaveStatus();
  fitRoute();
}
async function deleteRoute(r) {
  if (!confirm(`Delete “${r.name}”${r.synced ? ' from all your devices' : ''}?`)) return;
  if (r.synced) {
    if (sync.getToken() && navigator.onLine) {
      try {
        await sync.update((list) => list.filter((x) => x.id !== r.id), `Delete route: ${r.name}`);
        await store.del('routes', r.id);
      } catch (e) {
        await store.put('routes', r.id, { ...r, pendingDelete: true });
        toast(`Deleted here; will remove from other devices later (${e.message})`, 4000);
      }
    } else {
      await store.put('routes', r.id, { ...r, pendingDelete: true });
    }
  } else await store.del('routes', r.id);
  if (routeId === r.id) { routeId = null; dirty = true; updateSaveStatus(); }
  renderSavedRoutes();
}

// Merge routes from GitHub with this device; push anything pending.
let syncing = false;
async function syncRoutes() {
  if (syncing || !navigator.onLine) return renderSyncLine();
  syncing = true;
  $('#sync-line').textContent = 'Checking for routes from your other devices…';
  try {
    const remote = await sync.pull();
    const local = new Map((await store.all('routes')).map((x) => [x.key, x.value]));
    const remoteIds = new Set(remote.routes.map((r) => r.id));
    for (const r of remote.routes) {
      const l = local.get(r.id);
      if (l?.pendingDelete) continue;
      if (!l || l.synced || (r.updated || 0) >= (l.updated || 0)) await store.put('routes', r.id, { ...r, synced: true });
    }
    for (const l of local.values()) if (l.synced && !l.pendingDelete && !remoteIds.has(l.id) && remote.source === 'github') await store.del('routes', l.id);
    const pending = [...local.values()].filter((l) => !l.synced || l.pendingDelete);
    if (pending.length && sync.getToken()) {
      await sync.update((list) => {
        let out = list.filter((x) => !pending.some((p) => p.id === x.id));
        for (const p of pending) if (!p.pendingDelete) out.push(toRemote(p));
        return out;
      }, `Sync ${pending.length} route change(s)`);
      for (const p of pending) p.pendingDelete ? await store.del('routes', p.id) : await store.put('routes', p.id, { ...p, synced: true });
    }
    store.saveSetting('lastSync', Date.now());
  } catch (e) {
    console.warn('sync', e);
    $('#sync-line').textContent = `Couldn't reach GitHub (${e.message}). Showing routes saved on this device.`;
    syncing = false;
    return renderSavedRoutes();
  }
  syncing = false;
  renderSyncLine();
  renderSavedRoutes();
}
function renderSyncLine() {
  const last = store.setting('lastSync', 0);
  const connected = !!sync.getToken();
  $('#sync-line').textContent = connected
    ? `Synced with your other devices${last ? ` · ${new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.`
    : 'Viewing routes from GitHub. To save routes from this device to your other devices, connect sync in the Offline tab.';
  $('#sync-state').textContent = connected ? `✓ This device is connected to ${sync.REPO.owner}/${sync.REPO.repo}.` : 'Not connected on this device.';
  $('#sync-setup').hidden = connected;
  $('#btn-disconnect').hidden = !connected;
}
$('#sync-repo').textContent = `${sync.REPO.owner}/${sync.REPO.repo}`;
$('#btn-sync').onclick = syncRoutes;
$('#btn-token').onclick = async () => {
  const t = $('#sync-token').value.trim();
  if (!t) return toast('Paste your token first');
  $('#btn-token').disabled = true;
  try {
    const res = await sync.checkToken(t);
    if (!res.ok) return toast(res.msg, 5000);
    sync.setToken(t);
    $('#sync-token').value = '';
    toast('Sync connected');
    await syncRoutes();
  } catch (e) {
    toast(`Couldn't check token: ${e.message}`, 4000);
  } finally {
    $('#btn-token').disabled = false;
  }
};
$('#btn-disconnect').onclick = () => {
  if (!confirm('Disconnect sync on this device? Your routes stay on GitHub.')) return;
  sync.setToken('');
  renderSyncLine();
};

// ================================================================ popular hikes
const areas = ['All', ...new Set(HIKES.map((h) => h.area))];
let areaFilter = 'All';
function renderHikes() {
  const chips = $('#hike-filters');
  chips.innerHTML = '';
  for (const a of areas) chips.appendChild(button(a, () => { areaFilter = a; renderHikes(); }, a === areaFilter ? 'on' : ''));
  const ul = $('#hike-list');
  ul.innerHTML = '';
  for (const h of HIKES.filter((h) => areaFilter === 'All' || h.area === areaFilter)) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="row"><h5>${esc(h.name)}</h5><span class="diff ${h.difficulty}">${h.difficulty}</span></div>
      <div class="meta">${h.km} km${h.oneWay ? ' one-way' : ''} · ↑${h.gain} m · ${h.hours} h · ${esc(h.season)}</div>
      <p>${esc(h.note)}</p>
      <div class="btns"></div>`;
    li.querySelector('.btns').append(button('Plan this', () => planHike(h), 'btn small primary'));
    li.querySelector('.btns').insertAdjacentHTML('beforeend', `<a href="${h.link}" target="_blank" rel="noopener">Details on VancouverTrails ↗</a>`);
    ul.appendChild(li);
  }
}
async function planHike(h) {
  if (dirty && waypoints.length > 1 && !confirm('Discard unsaved changes to the current route?')) return;
  newRoute();
  waypoints = h.wp.map((p) => (router?.snap(p, 400)?.point) || p);
  if (h.outAndBack) waypoints = [...waypoints, ...waypoints.slice(0, -1).reverse()];
  $('#route-name').value = h.name;
  dirty = true;
  if (!router) toast('Trail data still loading — the route will follow trails once it’s ready', 4000);
  showPlanEdit();
  await recompute();
  fitRoute();
}

// ================================================================ search
let nominatimTimer;
$('#search').addEventListener('input', () => {
  const q = $('#search').value.trim().toLowerCase();
  const ul = $('#search-results');
  if (q.length < 2) return (ul.hidden = true);
  const results = [];
  for (const h of HIKES) if (h.name.toLowerCase().includes(q)) results.push({ label: h.name, kind: 'popular hike', go: () => planHike(h) });
  for (const t of index) {
    if (results.length > 14) break;
    if (t.name.toLowerCase().includes(q)) results.push({ label: t.name, kind: 'trail', go: () => map.fitBounds([[t.bbox[0], t.bbox[1]], [t.bbox[2], t.bbox[3]]], { padding: 80, maxZoom: 16 }) });
  }
  const seen = new Set();
  for (const f of map.querySourceFeatures('ofm', { sourceLayer: 'mountain_peak' })) {
    const n = f.properties.name;
    if (!n || seen.has(n) || !n.toLowerCase().includes(q)) continue;
    seen.add(n);
    results.push({ label: n, kind: f.properties.ele ? `peak · ${f.properties.ele} m` : 'peak', go: () => map.flyTo({ center: f.geometry.coordinates, zoom: 14.5 }) });
  }
  renderResults(results, q);
  clearTimeout(nominatimTimer);
  if (navigator.onLine)
    nominatimTimer = setTimeout(async () => {
      try {
        const [w, s, e, n] = NORTH_SHORE_BBOX;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&viewbox=${w - 0.2},${n + 0.1},${e + 0.2},${s - 0.1}&bounded=1&q=${encodeURIComponent(q)}`;
        const res = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
        if ($('#search').value.trim().toLowerCase() !== q) return;
        for (const r of res) results.push({ label: r.name || r.display_name.split(',')[0], kind: (r.type || 'place').replace(/_/g, ' '), go: () => map.flyTo({ center: [+r.lon, +r.lat], zoom: 15 }) });
        renderResults(results, q);
      } catch {}
    }, 450);
});
function renderResults(results, q) {
  const ul = $('#search-results');
  ul.innerHTML = '';
  ul.hidden = false;
  if (!results.length) {
    ul.innerHTML = `<li class="none">No matches for “${esc(q)}”${navigator.onLine ? '' : ' (offline: searching trails only)'}</li>`;
    return;
  }
  for (const r of results.slice(0, 20)) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(r.label)}</span><small>${esc(r.kind)}</small>`;
    li.onclick = () => { ul.hidden = true; $('#search').blur(); r.go(); };
    ul.appendChild(li);
  }
}
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#search-results li:not(.none)')?.click(); });

// ================================================================ keyboard shortcuts (desktop)
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Escape') { if (flying) $('#fly-exit').click(); else setAdding(false); }
  else if (e.key === 'a' && currentTab === 'plan') { showPlanEdit(); setAdding(!adding); }
});

// ================================================================ GPS & tracking
const tracker = new Tracker();
const meEl = Object.assign(document.createElement('div'), { className: 'me' });
meEl.innerHTML = '<div class="acc"></div><div class="cone"></div><div class="core"></div>';
const meMarker = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map' });
let locateMode = 0; // 0 off · 1 showing · 2 following

function sizeAccuracy() {
  const p = tracker.position;
  if (!p) return;
  const mpp = (40075016.686 * Math.cos((p.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const px = Math.min(400, (p.acc / mpp) * 2);
  const acc = meEl.querySelector('.acc');
  acc.style.width = acc.style.height = `${px}px`;
}
map.on('zoom', sizeAccuracy);
tracker.addEventListener('position', (e) => {
  const p = e.detail;
  meMarker.setLngLat([p.lng, p.lat]).addTo(map);
  sizeAccuracy();
  const cone = meEl.querySelector('.cone');
  const showCone = p.heading != null && !isNaN(p.heading) && (p.speed ?? 0) > 0.4;
  cone.style.display = showCone ? 'block' : 'none';
  if (showCone) cone.style.transform = `rotate(${p.heading}deg)`;
  $('#gps-dot').className = `dot ${p.acc < 15 ? 'good' : p.acc < 40 ? 'fair' : 'poor'}`;
  $('#gps-status').textContent = `GPS accuracy ±${Math.round(p.acc)} m`;
  $('#tk-alt').textContent = p.alt != null ? `${Math.round(p.alt)} m` : '–';
  $('#tk-speed').textContent = p.speed > 0.3 ? fmtPace(1000 / p.speed) : '–';
  if (!flying && (locateMode === 2 || (tracker.recording && !tracker.paused && $('#follow-me').checked)))
    map.easeTo({ center: [p.lng, p.lat], duration: 600, ...(map.getZoom() < 14 ? { zoom: 15 } : {}) });
  updateFollow();
});
tracker.addEventListener('error', (e) => {
  const err = e.detail;
  $('#gps-status').textContent = err.code === 1 ? 'Location is blocked. iPhone: Settings › Privacy › Location Services › Safari Websites → While Using.' : `GPS problem: ${err.message}`;
  $('#gps-dot').className = 'dot poor';
  if (err.code === 1) toast('Location permission is off', 3000);
});
function setLocateMode(m) {
  locateMode = m;
  $('#btn-locate').classList.toggle('on', m === 1);
  $('#btn-locate').classList.toggle('follow', m === 2);
  $('#btn-locate').title = ['My location', 'Follow me', 'Turn off location'][m];
}
$('#btn-locate').onclick = () => {
  if (locateMode === 0) {
    tracker.startWatching();
    setLocateMode(1);
    const go = (p) => map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(14, map.getZoom()) });
    if (tracker.position) go(tracker.position);
    else {
      toast('Finding you…', 1500);
      tracker.addEventListener('position', (e) => go(e.detail), { once: true });
    }
  } else if (locateMode === 1) {
    setLocateMode(2);
    toast('Following your location', 1200);
  } else {
    setLocateMode(0);
    if (!tracker.recording) { tracker.stopWatching(); meMarker.remove(); }
  }
};
map.on('dragstart', () => { if (locateMode === 2) setLocateMode(1); });

function renderTrackStats(t) {
  if (!t) return;
  $('#tk-time').textContent = fmtClock(t.movingTime);
  $('#tk-dist').textContent = fmtDist(t.dist);
  $('#tk-pace').textContent = t.dist > 50 ? fmtPace(t.movingTime / (t.dist / 1000)) : '–';
  $('#tk-gain').textContent = `${Math.round(t.gain)} m`;
  map.getSource('track').setData(geo(t.points.map((p) => [p.lng, p.lat])));
}
tracker.addEventListener('track', (e) => renderTrackStats(e.detail));
tracker.addEventListener('state', () => {
  const rec = tracker.recording;
  $('#btn-rec').hidden = rec;
  $('#btn-pause').hidden = !rec;
  $('#btn-stop').hidden = !rec;
  $('#btn-pause').textContent = tracker.paused ? '▶ Resume' : '❚❚ Pause';
});
$('#btn-rec').onclick = async () => {
  await tracker.start(routeNameVal() ? `${routeNameVal()} · ${new Date().toLocaleDateString()}` : undefined);
  toast('Recording — keep the app open');
};
$('#btn-pause').onclick = () => (tracker.paused ? tracker.resume() : tracker.pause());
$('#btn-stop').onclick = async () => {
  if (!confirm('Finish and save this track?')) return;
  const t = await tracker.stop();
  toast(`Track saved · ${fmtDist(t.dist)}`);
  renderSavedTracks();
};

function updateFollow() {
  const box = $('#follow-box');
  const p = tracker.position;
  if (!p || routeCoords.length < 2 || !routeProfile) return (box.hidden = true);
  box.hidden = false;
  const near = nearestOnLine(routeCoords, routeCum, [p.lng, p.lat]);
  const total = routeCum[routeCum.length - 1];
  $('#fl-left').textContent = fmtDist(total - near.along);
  const { dist, ele } = routeProfile;
  let climb = 0;
  const k = dist.findIndex((d) => d > near.along);
  for (let i = Math.max(1, k); i < dist.length; i++) if (ele[i] > ele[i - 1]) climb += ele[i] - ele[i - 1];
  $('#fl-climb').textContent = `${Math.round(climb)} m`;
  const rest = k > 0 ? { dist: dist.slice(k - 1), ele: ele.slice(k - 1) } : routeProfile;
  $('#fl-eta').textContent = fmtDuration(routeTime(rest));
  const off = near.dist > Math.max(40, p.acc * 1.5);
  $('#fl-off').hidden = !off;
  $('#fl-offd').textContent = fmtDist(near.dist);
  chart.setMarker(near.along);
}

async function renderSavedTracks() {
  const items = (await store.all('tracks')).filter((t) => !(tracker.recording && t.key === tracker.track?.id)).sort((a, b) => b.value.start - a.value.start);
  const ul = $('#saved-tracks');
  ul.innerHTML = items.length ? '' : '<li class="empty">No tracks yet.</li>';
  for (const { key, value: t } of items) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="grow"><b>${esc(t.name)}</b><small>${new Date(t.start).toLocaleDateString()} · ${fmtDist(t.dist)} · ${fmtClock(t.movingTime)} · ↑${Math.round(t.gain)} m</small></div>`;
    li.append(
      button('Show', () => {
        const coords = t.points.map((p) => [p.lng, p.lat]);
        map.getSource('track').setData(geo(coords));
        if (coords.length > 1) {
          const b = bboxOf(coords);
          map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 16 });
        }
      }),
      button('GPX', () => downloadFile(`${t.name.replace(/[^\w-]+/g, '_')}.gpx`, trackToGpx(t.name, t.points))),
      button('✕', async () => {
        if (!confirm(`Delete “${t.name}”?`)) return;
        await store.del('tracks', key);
        renderSavedTracks();
      }, 'icon')
    );
    ul.appendChild(li);
  }
}

// ================================================================ 3D preview
const flyEl = Object.assign(document.createElement('div'), { className: 'fly-marker' });
const flyMarker = new maplibregl.Marker({ element: flyEl });
let preFly = null;
const flyover = new Flyover(map, {
  onProgress: (d, p) => {
    flyMarker.setLngLat(p).addTo(map);
    map.getSource('route-progress').setData(geo(routeProfile.coords.filter((_, i) => routeProfile.dist[i] <= d).concat([p])));
    $('#fly-seek').value = Math.round((d / flyover.total) * 1000);
    const i = Math.min(routeProfile.ele.length - 1, Math.round((d / flyover.total) * (routeProfile.ele.length - 1)));
    $('#fly-info').textContent = `${fmtDist(d)} of ${fmtDist(flyover.total)} · ${Math.round(routeProfile.ele[i])} m elevation`;
  },
  onEnd: (finished) => {
    if (finished) $('#fly-pause').textContent = '↺';
    else exitFly();
  },
});
function exitFly() {
  flying = false;
  document.body.classList.remove('flying');
  $('#fly-bar').hidden = true;
  flyMarker.remove();
  map.getSource('route-progress').setData(geo([]));
  setTerrain(preFly.terrain, false);
  map.flyTo({ ...preFly.camera, duration: 1200 });
}
const flyDuration = () => Math.min(120, Math.max(30, routeCum[routeCum.length - 1] / 120));
$('#btn-fly').onclick = async () => {
  if (!routeProfile) return;
  flying = true;
  preFly = { terrain: terrainOn, camera: { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } };
  setAdding(false);
  popup.remove();
  document.body.classList.add('flying');
  $('#fly-bar').hidden = false;
  $('#fly-pause').textContent = '❚❚';
  $('#fly-info').textContent = 'Loading terrain…';
  map.setTerrain({ source: 'dem', exaggeration: 1.4 });
  map.flyTo({ center: routeProfile.coords[0], zoom: 14.5, pitch: 65, duration: 1800 });
  await new Promise((r) => map.once('moveend', r));
  if (!flying) return;
  flyover.speed = parseFloat($('#fly-speed').value);
  flyover.start(routeProfile, { duration: flyDuration() });
};
$('#fly-pause').onclick = () => {
  if (!flyover.running) {
    flyover.start(routeProfile, { duration: flyDuration() });
    $('#fly-pause').textContent = '❚❚';
    return;
  }
  flyover.togglePause();
  $('#fly-pause').textContent = flyover.paused ? '▶' : '❚❚';
};
$('#fly-seek').oninput = (e) => flyover.running && flyover.seek((e.target.value / 1000) * flyover.total);
$('#fly-speed').onchange = (e) => (flyover.speed = parseFloat(e.target.value));
$('#fly-exit').onclick = () => (flyover.running ? flyover.stop() : exitFly());

// ================================================================ offline downloads
let dlAbort = null;
async function refreshCacheStatus() {
  const n = await cachedTileCount();
  let s = n ? `${n.toLocaleString()} map tiles saved on this device` : 'No map area saved yet.';
  try {
    const est = await navigator.storage.estimate();
    if (n) s += ` (${(est.usage / 1048576).toFixed(0)} MB).`;
  } catch {}
  $('#cache-status').textContent = s;
}
async function startDownload(bbox, label) {
  if (!navigator.onLine) return toast('You’re offline — connect to save an area');
  const prog = $('#dl-progress');
  try {
    if (!router) await downloadTrails();
    const urls = await planDownload(bbox, { satellite: $('#dl-sat').checked });
    if (urls.length > 6000 && !confirm(`${label} is large (${urls.length.toLocaleString()} tiles). Continue?`)) return;
    dlAbort = new AbortController();
    prog.hidden = false;
    $$('[data-area], #btn-dl-route').forEach((b) => (b.disabled = true));
    const res = await download(urls, ({ done, total, failed, bytes }) => {
      prog.querySelector('.bar span').style.width = `${(done / total) * 100}%`;
      prog.querySelector('p').textContent = `Saving ${label}: ${Math.round((done / total) * 100)}% · ${(bytes / 1048576).toFixed(1)} MB${failed ? ` · ${failed} failed` : ''}`;
    }, dlAbort.signal);
    const msg = dlAbort.signal.aborted ? 'Cancelled' : res.failed ? `Saved, but ${res.failed} tiles failed — tap again to retry` : `✓ ${label} saved for offline use`;
    prog.querySelector('p').textContent = msg;
    toast(msg, 4000);
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    $$('[data-area], #btn-dl-route').forEach((b) => (b.disabled = false));
    $('#btn-dl-route').disabled = routeCoords.length < 2;
    dlAbort = null;
    refreshCacheStatus();
  }
}
$$('[data-area]').forEach((b) =>
  (b.onclick = () => {
    if (b.dataset.area === 'northshore') return startDownload(NORTH_SHORE_BBOX, 'North Shore');
    const bb = map.getBounds();
    startDownload([bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()], 'Current view');
  })
);
$('#btn-dl-route').onclick = () => {
  showTab('offline');
  startDownload(bboxOf(routeCoords, 0.02), 'Route area');
};
$('#btn-dl-cancel').onclick = () => dlAbort?.abort();
$('#btn-clear-cache').onclick = async () => {
  if (!confirm('Delete saved map tiles? Routes, tracks and trail data are kept.')) return;
  await clearTiles();
  refreshCacheStatus();
};

// ================================================================ startup
showPlanEdit();
recompute();
renderHikes();
renderSyncLine();
renderSavedRoutes().then(syncRoutes);
renderSavedTracks();
loadNetwork().then((net) => (net ? useNetwork(net) : navigator.onLine && downloadTrails()));
if (await tracker.resumeActive()) {
  toast('Unfinished recording found — tap Resume to continue', 5000);
  showTab('track');
}
window.__app = { map, get router() { return router; }, get waypoints() { return waypoints; }, planHike, addPoint, HIKES };
