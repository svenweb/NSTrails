// GPS tracking. Works with no network — only needs the device's GPS.
// Note: iOS suspends web apps when the screen locks, so we hold a screen
// wake lock while recording.
import * as store from './store.js';
import { haversine } from './geo.js';

export class Tracker extends EventTarget {
  constructor() {
    super();
    this.watchId = null;
    this.position = null; // last fix {lng, lat, acc, alt, heading, speed, t}
    this.recording = false;
    this.paused = false;
    this.track = null; // {id, name, start, points:[], dist, gain, movingTime}
    this.wakeLock = null;
    this._lastSave = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.recording) this.requestWakeLock();
    });
  }

  get watching() { return this.watchId != null; }

  startWatching() {
    if (this.watchId != null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onFix(pos),
      (err) => this.dispatchEvent(new CustomEvent('error', { detail: err })),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
    );
  }

  stopWatching() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  onFix(pos) {
    const c = pos.coords;
    const fix = {
      lng: c.longitude, lat: c.latitude, acc: c.accuracy,
      alt: c.altitude, heading: c.heading, speed: c.speed, t: pos.timestamp || Date.now(),
    };
    this.position = fix;
    if (this.recording && !this.paused) this.addPoint(fix);
    this.dispatchEvent(new CustomEvent('position', { detail: fix }));
  }

  addPoint(fix) {
    if (fix.acc > 40) return; // too inaccurate
    const pts = this.track.points;
    const last = pts[pts.length - 1];
    if (last) {
      const d = haversine([last.lng, last.lat], [fix.lng, fix.lat]);
      if (d < Math.max(3, fix.acc * 0.3)) return;
      const dt = (fix.t - last.t) / 1000;
      if (dt > 0 && d / dt > 12) return; // GPS jump (>43 km/h on foot)
      this.track.dist += d;
      if (dt > 0 && dt < 60) this.track.movingTime += dt;
      if (fix.alt != null && last.alt != null) {
        const da = fix.alt - this.track._refAlt;
        if (da > 4) { this.track.gain += da; this.track._refAlt = fix.alt; }
        else if (da < -4) this.track._refAlt = fix.alt;
      }
    } else if (fix.alt != null) this.track._refAlt = fix.alt;
    pts.push({ lng: +fix.lng.toFixed(6), lat: +fix.lat.toFixed(6), alt: fix.alt != null ? Math.round(fix.alt * 10) / 10 : null, t: fix.t });
    this.dispatchEvent(new CustomEvent('track', { detail: this.track }));
    if (Date.now() - this._lastSave > 10000) this.save();
  }

  async start(name) {
    this.track = { id: `t${Date.now()}`, name: name || `Track ${new Date().toLocaleString()}`, start: Date.now(), points: [], dist: 0, gain: 0, movingTime: 0, _refAlt: null };
    this.recording = true;
    this.paused = false;
    this.startWatching();
    await this.requestWakeLock();
    await store.saveSetting('activeTrack', this.track.id);
    this.save();
    this.dispatchEvent(new CustomEvent('state'));
  }

  pause() { this.paused = true; this.save(); this.dispatchEvent(new CustomEvent('state')); }
  resume() { this.paused = false; this.dispatchEvent(new CustomEvent('state')); }

  async stop() {
    this.recording = false;
    this.paused = false;
    await this.save();
    store.saveSetting('activeTrack', null);
    this.releaseWakeLock();
    const t = this.track;
    this.dispatchEvent(new CustomEvent('state'));
    return t;
  }

  async resumeActive() {
    const id = store.setting('activeTrack', null);
    if (!id) return false;
    const t = await store.get('tracks', id);
    if (!t) return false;
    this.track = t;
    this.recording = true;
    this.paused = true; // let the user explicitly resume after a reload
    this.startWatching();
    this.dispatchEvent(new CustomEvent('state'));
    this.dispatchEvent(new CustomEvent('track', { detail: t }));
    return true;
  }

  save() {
    if (!this.track) return;
    this._lastSave = Date.now();
    return store.put('tracks', this.track.id, this.track).catch(() => {});
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
      }
    } catch {}
  }
  releaseWakeLock() {
    try { this.wakeLock?.release(); } catch {}
    this.wakeLock = null;
  }
}
