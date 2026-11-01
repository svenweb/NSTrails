# North Shore Trails

A small offline-capable web app (PWA) for planning, previewing in 3D, and tracking runs and hikes on Vancouver's North Shore mountains. Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages.

## Features
- **Plan by tapping trails.** Points snap onto OpenStreetMap trail lines and legs are routed along the trail network (in-browser A*, works offline).
- Distance, climb, descent, elevation profile (graded by steepness) and time estimates for hiking (Tobler) or running (your flat pace, adjusted for grade).
- **3D preview:** a chase camera flies along the route over the terrain.
- **Saved routes sync** between devices through `data/routes.json` in this repo.
- **Offline:** save the whole North Shore (or the current view or route area): map tiles, terrain and trail data. Then plan and track with GPS only.
- **Track** with GPS: moving time, distance, pace, climb, distance and climb left on your planned route, and an off-route warning. Export tracks to GPX.
- Popular North Shore hikes with links to VancouverTrails.com.

## Install on iPhone
Open the site in Safari → Share → **Add to Home Screen**. Launch it once while online.
iOS pauses web apps when the screen locks, so keep the app open while recording (the screen is kept awake).

## Sync setup (once per device)
Routes save to this device right away. To also see them on other devices:
1. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new
2. Repository access: *Only select repositories* → this repo.
3. Permissions → Repository → **Contents: Read and write**.
4. In the app: **Offline** tab → *Sync routes between devices* → paste and Connect.

On iPhone, the home-screen app has separate storage from Safari, so connect inside the app. Viewing synced routes needs no token. Because the repo is public, saved routes are publicly readable.

## Data sources
- Basemap: [OpenFreeMap](https://openfreemap.org) vector tiles, © OpenStreetMap contributors (ODbL)
- Trails: OpenStreetMap via the Overpass API
- Elevation / 3D terrain: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium)
- Satellite (optional): Sentinel-2 cloudless by EOX (CC BY-NC-SA 4.0)
- Libraries: MapLibre GL JS (BSD-3), maplibre-contour (BSD-3), vendored in `vendor/`

## Local development
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000. Bump `VERSION` in `sw.js` when shipping changes so installed apps update.
