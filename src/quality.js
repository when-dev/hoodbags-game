// Rendering quality levels + an adaptive controller. Quality only changes how the frame is
// drawn (resolution, bloom, decorative particle density). It never touches the simulation clock,
// collisions, obstacle generation or game rules.

export const LEVELS = ['performance', 'balanced', 'high'];

// maxPixels caps the drawing buffer so high-DPI screens don't render 4K+ buffers.
export const PRESETS = {
  high:        { pixelRatio: 1.75, touchPixelRatio: 1.5, maxPixels: 3.7e6, bloom: true,  particles: 1.0 },
  balanced:    { pixelRatio: 1.25, touchPixelRatio: 1.25, maxPixels: 2.2e6, bloom: true,  particles: 0.6 },
  performance: { pixelRatio: 1.0,  touchPixelRatio: 1.0, maxPixels: 1.3e6, bloom: false, particles: 0.35 },
};

// pixel ratio actually used for a viewport: preset cap, device cap, and the pixel budget
export function pixelRatioFor(level, { dpr, width, height, touch }) {
  const p = PRESETS[level];
  let r = Math.min(dpr || 1, touch ? p.touchPixelRatio : p.pixelRatio);
  const px = width * height;
  if (px * r * r > p.maxPixels) r = Math.sqrt(p.maxPixels / px);
  return Math.max(0.5, Math.floor(r * 100) / 100); // round down: never exceed the budget
}

export function defaultLevel({ touch }) { return touch ? 'balanced' : 'high'; }

// Watches frame intervals in fixed windows. Downgrades one level when two consecutive windows
// have a median above budget; upgrades back at most once per session after a long run of
// clearly healthy windows. Ignores windows that contain pauses (huge gaps).
export class AdaptiveQuality {
  constructor({ level = 'high', auto = true, budgetMs = 1000 / 50, windowMs = 3000 } = {}) {
    this.level = level; this.auto = auto; this.budget = budgetMs; this.windowMs = windowMs;
    this.samples = []; this.acc = 0; this.bad = 0; this.good = 0; this.upgrades = 0; this.lastChange = 0; this.clock = 0;
    this.floor = 'performance';
  }
  setManual(level) { this.level = level; this.auto = false; }
  setAuto(start) { this.auto = true; this.level = start; this.bad = this.good = 0; }
  // feed one frame interval (ms). Returns the new level when it changes, else null.
  sample(ms) {
    this.clock += ms;
    if (ms > 250) { this.samples.length = 0; this.acc = 0; return null; } // tab switch / pause gap
    this.samples.push(ms); this.acc += ms;
    if (this.acc < this.windowMs) return null;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.samples.length = 0; this.acc = 0;
    if (!this.auto) return null;
    const idx = LEVELS.indexOf(this.level);
    if (median > this.budget) { this.bad++; this.good = 0; } else { this.bad = 0; if (p90 < this.budget * 0.9) this.good++; else this.good = 0; }
    if (this.bad >= 2 && idx > 0) {
      this.level = LEVELS[idx - 1]; this.bad = 0; this.good = 0; this.lastChange = this.clock;
      return this.level;
    }
    if (this.good >= 7 && idx < LEVELS.length - 1 && this.upgrades < 1 && this.clock - this.lastChange > 20000 && this.lastChange > 0) {
      this.level = LEVELS[idx + 1]; this.upgrades++; this.good = 0; this.lastChange = this.clock;
      return this.level;
    }
    return null;
  }
}
