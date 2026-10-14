// Runs the real HoodBags game loop in Node with a stub renderer and an autopilot, and reports
// CPU cost per frame (simulation + animation + scene update, measured), estimated draw calls /
// triangles (what three.js would submit after frustum culling) and object-count trends.
//
//   node tools/sim-harness.mjs [desktop|mobile] [seconds] [--json out.json]
//
// It does NOT measure GPU time, real FPS, bloom cost, browser layout or audio. Those need a real
// browser on real hardware.
import { installDom, stubRenderer } from './dom-stub.mjs';

const args = process.argv.slice(2);
const profile = args[0] === 'mobile' ? 'mobile' : 'desktop';
const seconds = Number(args[1]) || 120;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

installDom(profile === 'mobile' ? { touch: true, width: 390, height: 844, dpr: 3 } : { width: 1280, height: 720, dpr: 1 });
globalThis.__HB_RENDERER__ = stubRenderer;

// deterministic randomness so before/after runs see comparable worlds
let seed = 1234567;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

await import('../src/main.js');
await new Promise((r) => setTimeout(r, 50)); // boot() awaits fonts
const hb = globalThis.__hb;
const DT = 1 / 60;
let frameDt = DT;
hb.clock.getDelta = () => frameDt;

// autopilot: same policy as the old browser bot, but calls the input functions directly
function bot() {
  const G = hb.G; if (G.state !== 'running') return;
  const p = G.player, L = [-2.4, 0, 2.4];
  const z = (o) => (hb.sceneZ ? hb.sceneZ(o) : o.obj.position.z);
  const inLane = (l, z0, z1) => G.obstacles.filter((o) => !o.dead && o.lane === l && z(o) + o.hit.len / 2 > z0 && z(o) - o.hit.len / 2 < z1);
  const v = G.speed + 0.01;
  const hardAhead = (l, d) => inLane(l, -d, 1.2).some((o) => o.kind === 'crash');
  const busy = Math.abs(p.x - L[p.lane]) > 0.05;
  if (!busy && hardAhead(p.lane, v * 0.9)) {
    const opts = [0, 1, 2].filter((l) => l !== p.lane && !hardAhead(l, v * 1.1)).sort((a, b) => Math.abs(a - p.lane) - Math.abs(b - p.lane));
    for (const l of opts) {
      const mid = Math.abs(l - p.lane) === 2 ? 1 : l;
      if (inLane(mid, -1.5, 1.5).length === 0) { hb.input.laneMove(l < p.lane ? -1 : 1); return; }
    }
  }
  for (const o of inLane(p.lane, -v * 0.3, 0.2)) {
    if (o.kind === 'bar') { if (p.slide <= 0.15) hb.input.slide(); return; }
    if (['fud', 'airdrop', 'rug'].includes(o.kind) && !p.air) { hb.input.jump(); return; }
  }
}

function run(frames, { god = false, jitter = false } = {}) {
  const cpu = [];
  for (let i = 0; i < frames; i++) {
    if (god) hb.G.player.invuln = Math.max(hb.G.player.invuln, 0.05);
    bot();
    // jitter: alternate 1/144-ish and 1/45-ish frames to exercise the fixed-step accumulator
    frameDt = jitter ? (i % 3 ? 1 / 144 : 1 / 45) : DT;
    const t0 = performance.now();
    hb.tick();
    cpu.push(performance.now() - t0);
  }
  cpu.sort((a, b) => a - b);
  const avg = cpu.reduce((s, x) => s + x, 0) / cpu.length;
  return { cpuAvg: +avg.toFixed(3), cpuP95: +cpu[Math.floor(cpu.length * 0.95)].toFixed(3), cpuMax: +cpu[cpu.length - 1].toFixed(3) };
}

const snap = () => {
  const r = globalThis.__hb.perf;
  const c = hb.counts();
  return { calls: r.calls, tris: Math.round(r.tris), meshes: c.meshes, sprites: c.sprites, sceneChildren: c.sceneChildren, particles: c.particles, obstacles: c.obstacles, coins: c.coins, scenery: c.scenery };
};
const out = { profile, scenarios: {} };
const scenario = (name, frames, opts) => { const t = run(frames, opts); out.scenarios[name] = { ...t, ...snap() }; };

// warm-up (JIT) in the menu
run(120);
scenario('menu', 300);
hb.startRun('story', 0); hb.G.state = 'running';
run(60, { god: true });
scenario('gameplay_hood', 600, { god: true });
hb.startRun('story', 2); hb.G.state = 'running';
run(60, { god: true });
scenario('busy_bullcity', 600, { god: true });
hb.G.power.magnet = 30; hb.G.power.leverage = 30;
for (let z = -8; z > -100; z -= 3) for (let l = 0; l < 3; l++) hb.coin(l, 0.9, z);
scenario('particles_magnet', 240, { god: true });
hb.startRun('story', 0); hb.G.state = 'running'; hb.G.dist = 860;
scenario('district_transition', 300, { god: true });
scenario('jittery_frames', 600, { god: true, jitter: true });

// restart cycles
const before = snap();
for (let i = 0; i < 10; i++) { hb.startRun('story'); hb.G.state = 'running'; run(120, { god: true }); hb.die('crash'); run(100); }
out.restarts = { before, after: snap() };

// long endless run (fair autopilot, god mode so it keeps going), sampled every 20 s of game time
hb.startRun('endless'); hb.G.state = 'running';
out.endless = [];
for (let t = 20; t <= seconds; t += 20) {
  const r = run(20 * 60, { god: true });
  out.endless.push({ t, dist: Math.round(hb.G.dist), ...r, ...snap(), heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1) });
}

// a real (non-god) campaign attempt with the bot, to make sure gameplay still completes
hb.startRun('story', 0); hb.G.state = 'running';
let frames = 0;
while (['running', 'finale'].includes(hb.G.state) && frames < 60 * 400) { run(60); frames += 60; }
out.campaign = { state: hb.G.state, dist: Math.round(hb.G.dist), coins: hb.G.coins, death: hb.G.deathKind, seconds: Math.round(frames / 60) };

console.log(`profile: ${profile}`);
console.table(out.scenarios);
console.log('restarts before/after:', JSON.stringify(out.restarts));
console.table(out.endless);
console.log('campaign:', JSON.stringify(out.campaign));
if (jsonOut) (await import('fs')).writeFileSync(jsonOut, JSON.stringify(out, null, 1));
process.exit(0);
