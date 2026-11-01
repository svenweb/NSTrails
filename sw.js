// Service worker: app shell offline + cache-first map tiles.
const VERSION = 'v1';
const SHELL = `nst-shell-${VERSION}`;
const TILES = 'nst-tiles-v1'; // shared with js/tiles.js
const SHELL_FILES = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/maplibre-gl.mjs',
  './vendor/maplibre-gl-worker.mjs',
  './vendor/maplibre-gl.css',
  './vendor/maplibre-contour.mjs',
  './js/main.js',
  './js/tiles.js',
  './js/style.js',
  './js/geo.js',
  './js/store.js',
  './js/elevation.js',
  './js/trails.js',
  './js/hikes.js',
  './js/profile.js',
  './js/tracker.js',
  './js/flyover.js',
  './js/gpx.js',
  './js/sync.js',
  './data/routes.json',
];
const TILE_HOSTS = ['tiles.openfreemap.org', 's3.amazonaws.com', 'tiles.maps.eox.at'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nst-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (TILE_HOSTS.includes(url.hostname)) {
    // The OpenFreeMap TileJSON changes when a new planet build ships: network first.
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname === '/planet') {
      e.respondWith(
        fetch(req).then((res) => {
          if (res.ok) caches.open(TILES).then((c) => c.put(req.url, res.clone()));
          return res.clone();
        }).catch(() => caches.match(req.url, { cacheName: TILES }).then((r) => r || Response.error()))
      );
      return;
    }
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req.url);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req.url, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Stale-while-revalidate for the app shell, so updates arrive on next launch.
    e.respondWith(
      caches.open(SHELL).then(async (c) => {
        const hit = await c.match(req, { ignoreSearch: true });
        const net = fetch(req).then((res) => {
          if (res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => null);
        if (hit) {
          e.waitUntil(net);
          return hit;
        }
        const res = await net;
        if (res) return res;
        if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
        return Response.error();
      })
    );
  }
});
