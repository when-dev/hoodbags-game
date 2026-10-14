// Development performance instrumentation. Zero UI unless the page is opened with `?perf`.
// Collects per-frame interval, simulation time and render-submission time in a ring buffer.
// Note: render time here is CPU-side submission (WebGL is async); GPU cost shows up in the
// frame interval when vsync/frame caps are disabled.
const N = 600;

export class PerfMonitor {
  constructor() {
    this.interval = new Float32Array(N);
    this.sim = new Float32Array(N);
    this.render = new Float32Array(N);
    this.i = 0; this.n = 0;
    this.last = 0;
    this.calls = 0; this.tris = 0;
    this.overlay = null;
    if (typeof location !== 'undefined' && /[?&]perf\b/.test(location.search)) {
      this.overlay = document.createElement('pre');
      this.overlay.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:6px 8px;font:11px/1.3 monospace;color:#9f9;background:rgba(0,0,0,.7);pointer-events:none;border-radius:6px';
      document.body.appendChild(this.overlay);
    }
  }
  record(now, simMs, renderMs, info) {
    if (this.last) {
      this.interval[this.i] = now - this.last;
      this.sim[this.i] = simMs;
      this.render[this.i] = renderMs;
      this.i = (this.i + 1) % N;
      this.n = Math.min(N, this.n + 1);
    }
    this.last = now;
    this.calls = info.render.calls; this.tris = info.render.triangles;
    if (this.overlay && this.i % 30 === 0) this.overlay.textContent = this.text();
  }
  reset() { this.i = 0; this.n = 0; this.last = 0; }
  stats() {
    const pick = (arr) => Array.from(arr.subarray(0, this.n)).sort((a, b) => a - b);
    const iv = pick(this.interval), sm = pick(this.sim), rd = pick(this.render);
    const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
    const r = (x) => Math.round(x * 100) / 100;
    return {
      frames: this.n,
      frameAvg: r(avg(iv)), frameP50: r(pct(iv, 0.5)), frameP95: r(pct(iv, 0.95)), frameP99: r(pct(iv, 0.99)),
      fps: r(1000 / (avg(iv) || 1)),
      simAvg: r(avg(sm)), simP95: r(pct(sm, 0.95)),
      renderAvg: r(avg(rd)), renderP95: r(pct(rd, 0.95)),
      calls: this.calls, tris: this.tris,
    };
  }
  text() {
    const s = this.stats();
    return `fps ${s.fps}  frame avg ${s.frameAvg} p95 ${s.frameP95}ms\nsim ${s.simAvg}ms  render ${s.renderAvg}ms\ncalls ${s.calls}  tris ${s.tris}`;
  }
}
