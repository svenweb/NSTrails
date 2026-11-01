// 3D fly-through: a chase camera that follows the route over the terrain.
import * as maplibregl from '../vendor/maplibre-gl.mjs';
import { bearing, destination, pointAt } from './geo.js';

export class Flyover {
  constructor(map, { onProgress, onEnd } = {}) {
    this.map = map;
    this.onProgress = onProgress;
    this.onEnd = onEnd;
    this.running = false;
    this.d = 0;
    this.speed = 1;
    this.exaggeration = 1.4;
  }

  start(prof, { duration = 60 } = {}) {
    this.prof = prof;
    this.cum = Float64Array.from(prof.dist);
    this.total = prof.dist[prof.dist.length - 1];
    // Aim for ~duration seconds at 1x, but never faster than ~200 m/s or slower than 15 m/s.
    this.mps = Math.max(15, Math.min(200, this.total / duration));
    this.d = 0;
    this.brg = bearing(prof.coords[0], pointAt(prof.coords, this.cum, Math.min(this.total, 300)));
    this.prevTerrain = this.map.getTerrain();
    this.map.setTerrain({ source: 'dem', exaggeration: this.exaggeration });
    this.running = true;
    this.paused = false;
    this.last = performance.now();
    this.loop();
  }

  togglePause() {
    this.paused = !this.paused;
    this.last = performance.now();
    if (!this.paused) this.loop();
  }

  seek(d) {
    this.d = Math.max(0, Math.min(this.total, d));
    if (this.paused) this.frame(0);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.onEnd?.();
  }

  eleAt(d) {
    const { dist, ele } = this.prof;
    const i = Math.min(dist.length - 1, Math.max(0, Math.round((d / this.total) * (dist.length - 1))));
    return ele[i];
  }

  loop() {
    if (!this.running || this.paused) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt);
    if (this.d >= this.total) {
      this.running = false;
      this.onEnd?.(true);
      return;
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }

  frame(dt) {
    this.d = Math.min(this.total, this.d + dt * this.mps * this.speed);
    const { coords } = this.prof;
    const target = pointAt(coords, this.cum, this.d);
    // Look ahead to smooth out switchbacks.
    const ahead = pointAt(coords, this.cum, Math.min(this.total, this.d + 250));
    const behind = pointAt(coords, this.cum, Math.max(0, this.d - 50));
    const want = this.d + 250 <= this.total ? bearing(target, ahead) : bearing(behind, target);
    let diff = ((want - this.brg + 540) % 360) - 180;
    this.brg = (this.brg + diff * Math.min(1, dt * 1.6) + 360) % 360;

    const ex = this.exaggeration;
    const targetAlt = this.eleAt(this.d) * ex;
    // Portrait screens have a narrow horizontal field of view: pull back further.
    const c = this.map.getCanvas();
    const aspect = Math.max(1, c.clientHeight / Math.max(1, c.clientWidth));
    const back = 950 * Math.sqrt(aspect) * (this.zoomOut || 1);
    const cam = destination(target, back, this.brg + 180);
    const ground = this.map.queryTerrainElevation(cam) ?? targetAlt;
    const camAlt = Math.max(targetAlt + back * 0.48, ground + 150);
    try {
      const opts = this.map.calculateCameraOptionsFromTo(new maplibregl.LngLat(cam[0], cam[1]), camAlt, new maplibregl.LngLat(target[0], target[1]), targetAlt);
      this.map.jumpTo(opts);
    } catch {
      this.map.jumpTo({ center: target, bearing: this.brg, pitch: 70, zoom: 15 });
    }
    this.onProgress?.(this.d, target);
  }
}
