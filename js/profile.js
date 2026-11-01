// Elevation profile chart drawn on a canvas. Calls onHover(distance|null).
import { fmtDist } from './geo.js';

export class ProfileChart {
  constructor(canvas, onHover) {
    this.c = canvas;
    this.onHover = onHover;
    this.prof = null;
    this.marker = null;
    this.track = null;
    const move = (e) => {
      if (!this.prof) return;
      const r = this.c.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const d = this.xToDist(x);
      this.marker = d;
      this.draw();
      this.onHover?.(d);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => { this.marker = null; this.draw(); this.onHover?.(null); });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  set(prof) { this.prof = prof; this.draw(); }
  setMarker(d) { this.marker = d; this.draw(); }
  pad() { return { l: 38, r: 8, t: 8, b: 18 }; }
  xToDist(x) {
    const p = this.pad();
    const w = this.c.clientWidth - p.l - p.r;
    const total = this.prof.dist[this.prof.dist.length - 1];
    return Math.max(0, Math.min(total, ((x - p.l) / w) * total));
  }
  draw() {
    const c = this.c, dpr = devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue('--muted').trim() || '#666';
    const accent = css.getPropertyValue('--accent').trim() || '#e4572e';
    if (!this.prof) {
      g.fillStyle = fg; g.font = '12px system-ui'; g.textAlign = 'center';
      g.fillText('Add at least two points to see the elevation profile', W / 2, H / 2);
      return;
    }
    const { dist, ele } = this.prof;
    const p = this.pad();
    const total = dist[dist.length - 1] || 1;
    let lo = Math.min(...ele), hi = Math.max(...ele);
    const span = Math.max(50, hi - lo);
    lo = Math.floor((lo - span * 0.08) / 10) * 10;
    hi = Math.ceil((hi + span * 0.08) / 10) * 10;
    const X = (d) => p.l + (d / total) * (W - p.l - p.r);
    const Y = (e) => p.t + (1 - (e - lo) / (hi - lo)) * (H - p.t - p.b);

    // grid
    g.strokeStyle = 'rgba(128,128,128,0.18)'; g.fillStyle = fg; g.font = '10px system-ui'; g.lineWidth = 1;
    const step = niceStep((hi - lo) / 4);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) {
      g.beginPath(); g.moveTo(p.l, Y(e)); g.lineTo(W - p.r, Y(e)); g.stroke();
      g.fillText(`${e}`, p.l - 4, Y(e));
    }
    const dstep = niceStep(total / 5);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let d = 0; d <= total; d += dstep) g.fillText(fmtDist(d), X(d), H - p.b + 4);

    // area, coloured by grade
    for (let i = 1; i < dist.length; i++) {
      const gr = (ele[i] - ele[i - 1]) / Math.max(1, dist[i] - dist[i - 1]);
      g.fillStyle = gradeColor(gr);
      g.beginPath();
      g.moveTo(X(dist[i - 1]), H - p.b); g.lineTo(X(dist[i - 1]), Y(ele[i - 1]));
      g.lineTo(X(dist[i]), Y(ele[i])); g.lineTo(X(dist[i]), H - p.b); g.closePath(); g.fill();
    }
    g.strokeStyle = accent; g.lineWidth = 1.6; g.beginPath();
    dist.forEach((d, i) => (i ? g.lineTo(X(d), Y(ele[i])) : g.moveTo(X(d), Y(ele[i]))));
    g.stroke();

    if (this.marker != null) {
      const i = Math.min(dist.length - 1, Math.round((this.marker / total) * (dist.length - 1)));
      const x = X(this.marker), y = Y(ele[i]);
      g.strokeStyle = fg; g.lineWidth = 1; g.beginPath(); g.moveTo(x, p.t); g.lineTo(x, H - p.b); g.stroke();
      g.fillStyle = accent; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      const j = Math.max(1, i);
      const gr = ((ele[j] - ele[j - 1]) / Math.max(1, dist[j] - dist[j - 1])) * 100;
      const label = `${fmtDist(this.marker)} · ${Math.round(ele[i])} m · ${gr >= 0 ? '+' : ''}${gr.toFixed(0)}%`;
      g.font = '600 11px system-ui';
      const tw = g.measureText(label).width + 10;
      const bx = Math.min(W - p.r - tw, Math.max(p.l, x - tw / 2));
      g.fillStyle = 'rgba(20,20,20,0.82)'; g.fillRect(bx, p.t, tw, 18);
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, bx + 5, p.t + 9);
    }
  }
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  const n = x / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}
function gradeColor(g) {
  const a = Math.abs(g);
  if (a < 0.05) return 'rgba(76,175,80,0.35)';
  if (a < 0.12) return 'rgba(255,193,7,0.4)';
  if (a < 0.25) return 'rgba(255,112,67,0.45)';
  return 'rgba(198,40,40,0.5)';
}
