// Procedural audio for HoodBags. One coherent palette: soft bell chimes in C major pentatonic,
// warm low thumps, filtered noise for motion. Everything runs through:
//   voices -> sfx bus (lowpass) ┐
//   music  -> music bus ────────┴-> compressor/limiter -> master -> speakers
import { CoinCombo } from './logic.js';

let ctx = null, master, sfxBus, musicBus, noiseBuf;
let muted = false;
let activeVoices = 0;
const MAX_VOICES = 14;

try { muted = localStorage.getItem('hb_muted') === '1'; } catch {}

const MASTER_VOL = 0.75;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_VOL;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 6;
  comp.attack.value = 0.003; comp.release.value = 0.2;
  comp.connect(master); master.connect(ctx.destination);

  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
  const tame = ctx.createBiquadFilter(); tame.type = 'lowpass'; tame.frequency.value = 7000; tame.Q.value = 0.5;
  sfxBus.connect(tame); tame.connect(comp);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.26;
  musicBus.connect(comp);

  // one shared noise buffer instead of allocating per hit
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// resume on the first user gesture (browsers block audio before that)
for (const ev of ['pointerdown', 'keydown', 'touchend']) {
  addEventListener(ev, () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { passive: true });
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('hb_muted', muted ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, ctx.currentTime, 0.02);
  return muted;
}

const ready = () => ctx && ctx.state === 'running' && !muted;

// ---------------------------------------------------------------- voice helpers
function claim(dur) {
  if (activeVoices >= MAX_VOICES) return false;
  activeVoices++;
  setTimeout(() => activeVoices--, (dur + 0.05) * 1000);
  return true;
}

function tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0, attack = 0.004, detune = 0, dest = sfxBus, essential = false } = {}) {
  if (!ready()) return;
  if (!essential && !claim(dur)) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.2, at = 0, type = 'highpass', freq = 1000, to = 0, q = 0.7, dest = sfxBus, time } = {}) {
  if (!ctx || !noiseBuf) return;
  if (dest === sfxBus && (!ready() || !claim(dur))) return;
  const t = time ?? ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  s.loopStart = 0; s.loop = dur > 0.9;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

// bell-ish chime: sine fundamental + soft octave partial
function chime(freq, vol, at = 0, dur = 0.22) {
  const det = (Math.random() - 0.5) * 10;       // ±5 cents
  tone(freq, dur, { vol, at, detune: det });
  tone(freq * 2, dur * 0.6, { vol: vol * 0.28, at, detune: det, type: 'triangle' });
}

// C major pentatonic, C5..D6 — capped well below shrill territory
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];

// ---------------------------------------------------------------- coins
const combo = new CoinCombo();
const stats = { pickups: 0, sounds: 0, milestones: 0, minGap: Infinity, last: -Infinity };
export function coinPickup(now) {
  stats.pickups++;
  const e = combo.pickup(now);
  if (!e) return null;
  stats.sounds++;
  if (e.type === 'milestone') stats.milestones++;
  else { stats.minGap = Math.min(stats.minGap, now - stats.last); stats.last = now; }
  // gentle volume taper on long combos so a streak never gets louder or more grating
  const v = 0.085 * (0.92 + Math.random() * 0.16) * Math.max(0.72, 1 - e.combo * 0.015);
  if (e.type === 'single') {
    chime(SCALE[0], v);
  } else if (e.type === 'combo') {
    // merged pickups get a touch more body, never more volume spikes
    chime(SCALE[e.step], v * (e.merged ? 1.08 : 1));
  } else {
    // milestone: quick rising triad + soft "cash" thump
    const base = Math.min(e.step, 4);
    [0, 2, 4].forEach((k, i) => chime(SCALE[base + k] || SCALE[SCALE.length - 1], 0.075, i * 0.055, 0.3));
    tone(130.8, 0.18, { vol: 0.16, type: 'sine', slide: -40 });
  }
  return e;
}
export function resetCoinCombo() { combo.reset(); }

// ---------------------------------------------------------------- other sfx
export const sfx = {
  jump: () => { noise(0.18, { vol: 0.06, type: 'bandpass', freq: 600, to: 2400, q: 1.2 }); tone(220, 0.16, { vol: 0.07, slide: 160 }); },
  slide: () => noise(0.3, { vol: 0.07, type: 'lowpass', freq: 2500, to: 400 }),
  lane: () => noise(0.09, { vol: 0.045, type: 'bandpass', freq: 1800, to: 900, q: 1.5 }),
  land: () => tone(90, 0.08, { vol: 0.08, slide: -20 }),
  bag: () => { [0, 2, 4, 7].forEach((k, i) => chime(SCALE[Math.min(k, 7)], 0.07, i * 0.045, 0.35)); tone(98, 0.25, { vol: 0.18 }); },
  power: () => {
    noise(0.35, { vol: 0.07, type: 'bandpass', freq: 400, to: 4000, q: 1 });
    [261.6, 329.6, 392.0, 523.3].forEach((f, i) => tone(f, 0.45, { vol: 0.06, type: 'triangle', at: 0.04 + i * 0.04, essential: true }));
  },
  powerEnd: () => tone(523, 0.25, { vol: 0.05, type: 'triangle', slide: -200 }),
  shieldPop: () => { noise(0.3, { vol: 0.12, type: 'highpass', freq: 2500 }); chime(1046.5, 0.08, 0, 0.4); tone(392, 0.3, { vol: 0.1, slide: -150, essential: true }); },
  stumble: () => {
    tone(110, 0.3, { vol: 0.25, type: 'sine', slide: -50, essential: true });
    tone(233, 0.25, { vol: 0.07, type: 'sawtooth', slide: -110, essential: true });
    noise(0.12, { vol: 0.1, type: 'lowpass', freq: 900 });
  },
  heartbeat: () => { tone(62, 0.14, { vol: 0.22, essential: true }); tone(58, 0.14, { vol: 0.16, at: 0.16, essential: true }); },
  dump: () => { tone(620, 0.7, { vol: 0.06, type: 'triangle', slide: -500 }); tone(310, 0.7, { vol: 0.05, type: 'sine', slide: -240 }); },
  die: () => {
    tone(196, 0.9, { vol: 0.14, type: 'triangle', slide: -150, essential: true });
    tone(70, 0.6, { vol: 0.3, slide: -30, essential: true });
    noise(0.5, { vol: 0.12, type: 'lowpass', freq: 1800, to: 200 });
  },
  district: () => {
    [392, 523.3, 659.3, 784].forEach((f, i) => tone(f, 0.3, { vol: 0.06, type: 'square', at: i * 0.09, essential: true }));
    chime(1046.5, 0.07, 0.36, 0.6);
    noise(0.6, { vol: 0.05, type: 'highpass', freq: 6000, at: 0.36 });
  },
  win: () => {
    const seq = [523.3, 659.3, 784, 1046.5, 784, 1046.5, 1318.5];
    seq.forEach((f, i) => tone(f, 0.32, { vol: 0.06, type: 'square', at: i * 0.12, essential: true }));
    [261.6, 329.6, 392, 523.3].forEach((f) => tone(f, 1.4, { vol: 0.05, type: 'triangle', at: 0.85, essential: true }));
    noise(1.0, { vol: 0.06, type: 'highpass', freq: 5000, at: 0.85 });
  },
  ui: () => tone(660, 0.06, { vol: 0.05, type: 'triangle' }),
};

// ---------------------------------------------------------------- music
// 16-step loop: 808-ish bass, hats, clap; lead stabs join in later districts.
const BASS = [36, 0, 0, 36, 0, 0, 39, 0, 36, 0, 0, 43, 0, 41, 0, 39];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
let musicTimer = null, step = 0, nextTime = 0, bpm = 140, musicLevel = 0;

function schedule() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + 0.12) {
    const s = step % 16;
    if (BASS[s]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(midi(BASS[s] + 12) * 1.5, nextTime);
      o.frequency.exponentialRampToValueAtTime(midi(BASS[s]), nextTime + 0.05);
      g.gain.setValueAtTime(0.85, nextTime); g.gain.exponentialRampToValueAtTime(0.001, nextTime + 0.35);
      o.connect(g); g.connect(musicBus); o.start(nextTime); o.stop(nextTime + 0.4);
    }
    if (s % 2 === 0 || (musicLevel > 1 && s >= 12)) noise(0.035, { vol: 0.09, type: 'highpass', freq: 7000, dest: musicBus, time: nextTime });
    if (s === 4 || s === 12) noise(0.16, { vol: 0.28, type: 'bandpass', freq: 1500, q: 0.8, dest: musicBus, time: nextTime });
    if (musicLevel > 0 && (s === 0 || s === 6 || s === 10)) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = midi(BASS[s] ? BASS[s] + 36 : 79);
      g.gain.setValueAtTime(0.09, nextTime); g.gain.exponentialRampToValueAtTime(0.001, nextTime + 0.18);
      o.connect(g); g.connect(musicBus); o.start(nextTime); o.stop(nextTime + 0.2);
    }
    nextTime += 60 / bpm / 4;
    step++;
  }
}

export function startMusic(level = 0) {
  if (!ctx) return;
  setMusicLevel(level);
  if (musicTimer) return; // never two schedulers
  nextTime = ctx.currentTime + 0.05; step = 0;
  musicTimer = setInterval(schedule, 25);
}
export function setMusicLevel(level) { musicLevel = level; bpm = 140 + level * 6; }
export function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

// test hook
export const _debug = { stats, get ctx() { return ctx; }, get master() { return master; }, get voices() { return activeVoices; }, get musicRunning() { return !!musicTimer; }, get state() { return ctx?.state; } };
