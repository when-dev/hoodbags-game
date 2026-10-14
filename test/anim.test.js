import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LaneMotion, LANE_TIME, LANE_WIDTH, Spring, FixedStepper, NazAnimator, headTopY } from '../src/anim.js';

const LANES = [-2.4, 0, 2.4];

function runLane(m, seconds, dt = 1 / 60, onStep) {
  const xs = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) { m.step(dt); xs.push(m.x); onStep?.(m); }
  return xs;
}

test('lane change: arrives exactly at the lane in the same time as the old linear move', () => {
  const m = new LaneMotion(0);
  m.setTarget(LANES[2]);
  let steps = 0;
  while (m.moving) { m.step(1 / 60); steps++; }
  assert.equal(m.x, LANES[2]);
  assert.equal(m.v, 0);
  // old movement: 2.4 units at 16 u/s = 0.15 s = 9 steps
  assert.ok(Math.abs(steps / 60 - LANE_TIME) <= 1 / 60 + 1e-9, `took ${steps} steps`);
});

test('lane change: eases in and out, monotonic, no overshoot', () => {
  const m = new LaneMotion(0);
  m.setTarget(2.4);
  const xs = runLane(m, 0.2);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 1e-9);
  assert.ok(Math.max(...xs) <= 2.4 + 1e-9);
  // slow start and slow finish: first and last step cover less than the middle steps
  const d = xs.map((x, i) => x - (i ? xs[i - 1] : 0)).filter((v) => v > 1e-9);
  assert.ok(d[0] < Math.max(...d) && d[d.length - 1] < Math.max(...d));
});

test('lane change: a second press mid-move continues smoothly (velocity continuity)', () => {
  const m = new LaneMotion(-2.4);
  m.setTarget(0);
  runLane(m, 0.06);
  const vBefore = m.v;
  m.setTarget(2.4);
  m.step(1e-4);
  assert.ok(Math.abs(m.v - vBefore) < 1.5, `velocity jumped ${vBefore} -> ${m.v}`);
  const xs = runLane(m, 0.4);
  assert.ok(Math.max(...xs) <= 2.4 + 1e-6, 'same-direction retarget must not overshoot');
  assert.equal(m.x, 2.4);
});

test('lane change: reversing mid-move has bounded excursion and settles', () => {
  const m = new LaneMotion(0);
  m.setTarget(2.4);
  runLane(m, 0.07);
  const at = m.x;
  m.setTarget(0);
  const xs = runLane(m, 0.4);
  assert.ok(Math.max(...xs) - at < 0.35, `overshoot ${Math.max(...xs) - at}`);
  assert.equal(m.x, 0);
});

test('lane change: mashing left/right never escapes the road or produces NaN', () => {
  const m = new LaneMotion(0);
  let lane = 1;
  for (let i = 0; i < 400; i++) {
    if (i % 3 === 0) { lane = Math.max(0, Math.min(2, lane + (i % 7 < 3 ? -1 : 1))); m.setTarget(LANES[lane]); }
    m.step(1 / 60);
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.v));
    assert.ok(m.x > -2.4 - 0.4 && m.x < 2.4 + 0.4, `x=${m.x}`);
  }
});

test('lane change: frame-rate independent end state (30/60/144 Hz)', () => {
  for (const hz of [30, 60, 144]) {
    const m = new LaneMotion(0); m.setTarget(-2.4);
    runLane(m, 0.3, 1 / hz);
    assert.equal(m.x, -2.4);
  }
});

test('lane bounce (side bump) returns to the previous lane', () => {
  const m = new LaneMotion(0); m.setTarget(2.4); runLane(m, 0.05);
  m.bounce(m.x, 0);
  runLane(m, 0.4);
  assert.equal(m.x, 0);
});

test('spring: converges and stays stable with large dt', () => {
  const s = new Spring(5, 0.6);
  for (let i = 0; i < 300; i++) s.step(1 / 60, 1);
  assert.ok(Math.abs(s.value - 1) < 1e-3);
  const s2 = new Spring(7, 0.45); s2.impulse(50);
  for (let i = 0; i < 50; i++) { s2.step(0.1, 0); assert.ok(Number.isFinite(s2.value)); }
  assert.ok(Math.abs(s2.value) < 0.01);
});

test('fixed stepper: one step per 60 Hz frame, bounded catch-up after a suspended tab', () => {
  const fs = new FixedStepper(1 / 60, 0.1, 6);
  let sims = 0;
  for (let i = 0; i < 120; i++) sims += fs.advance(1 / 60, () => {});
  assert.ok(Math.abs(sims - 120) <= 1);
  const n = fs.advance(5.0, () => {}); // tab was hidden for 5 s
  assert.ok(n <= 6, `simulated ${n} steps after resume`);
  assert.ok(fs.alpha >= 0 && fs.alpha < 1);
});

test('fixed stepper: 144 Hz frames simulate real time and alpha interpolates', () => {
  const fs = new FixedStepper(1 / 60);
  let sims = 0; const alphas = new Set();
  for (let i = 0; i < 144; i++) { sims += fs.advance(1 / 144, () => {}); alphas.add(fs.alpha.toFixed(2)); }
  assert.ok(Math.abs(sims - 60) <= 1, `sims ${sims}`);
  assert.ok(alphas.size > 3, 'alpha varies between frames');
});

// ------------------------------------------------------------------ Naz animator
function drive(anim, seq, hz = 60) {
  const dt = 1 / hz; let t = 0; const frames = [];
  for (const [secs, input, event] of seq) {
    if (event) event(anim);
    for (let f = 0; f < secs * hz; f++) { t += dt; frames.push({ ...anim.update({ dt, time: t, speed: 20, vx: 0, vy: 0, air: false, slide: false, mode: 'ride', ...input(t) }) }); }
  }
  return frames;
}

const SEQ = [
  [0.5, () => ({})],
  [0.08, () => ({ vx: 20 })],                                      // lane change right
  [0.08, () => ({ vx: -20 })],                                     // immediate reversal
  [0.3, () => ({})],
  [0.35, () => ({ air: true, vy: 8 }), (a) => a.takeoff()],        // jump up
  [0.35, () => ({ air: true, vy: -8 })],                           // fall
  [0.3, () => ({}), (a) => a.land(-10)],                           // land
  [0.65, () => ({ slide: true })],                                 // slide
  [0.1, () => ({ slide: true, vx: 18 })],                          // lane change during slide
  [0.4, () => ({})],                                               // slide ends
  [0.6, () => ({}), (a) => a.hit(1)],                              // stumble
  [0.6, () => ({}), (a) => a.power()],                             // power-up
  [0.3, () => ({}), (a) => a.collect()],
  [1.0, () => ({ mode: 'victory' })],
  [1.0, () => ({ mode: 'idle' })],
];

test('naz pose: every channel is continuous across all state transitions (no snapping)', () => {
  for (const hz of [60, 144]) {
    const frames = drive(new NazAnimator(), SEQ, hz);
    const maxStep = { 60: 0.42, 144: 0.2 }[hz]; // rad (or m) per frame
    for (let i = 1; i < frames.length; i++) {
      for (const k of Object.keys(frames[i])) {
        let d = Math.abs(frames[i][k] - frames[i - 1][k]);
        if (k === 'boardYaw') d = Math.min(d, Math.abs(d - 2 * Math.PI)); // a full spin wraps to 0
        assert.ok(Number.isFinite(frames[i][k]), `${k} NaN`);
        assert.ok(d <= maxStep, `${k} jumped ${d.toFixed(3)} at frame ${i} (${hz} Hz)`);
      }
    }
  }
});

test('naz pose: slide keeps the head under the 1.12 m liquidation line', () => {
  const a = new NazAnimator();
  let p;
  for (let i = 0; i < 30; i++) p = a.update({ dt: 1 / 60, time: i / 60, speed: 25, vx: 0, vy: 0, air: false, slide: true, mode: 'ride' });
  assert.ok(headTopY(p) < 1.12, `head at ${headTopY(p).toFixed(3)}`);
  // and he is clearly taller when riding normally
  for (let i = 0; i < 60; i++) p = a.update({ dt: 1 / 60, time: 1 + i / 60, speed: 25, vx: 0, vy: 0, air: false, slide: false, mode: 'ride' });
  assert.ok(headTopY(p) > 1.6);
});

test('naz pose: hit, slide and power layers recover to the riding pose', () => {
  const a = new NazAnimator();
  const ride = drive(a, [[1, () => ({})]]).at(-1);
  a.hit(-1); a.power();
  const after = drive(a, [[0.2, () => ({ slide: true })], [1.2, () => ({})]]).at(-1);
  for (const k of ['riderZ', 'torsoX', 'lShX', 'rShX', 'hipsY', 'boardYaw']) {
    assert.ok(Math.abs(after[k] - ride[k]) < 0.08, `${k} did not recover: ${after[k]} vs ${ride[k]}`);
  }
});

test('naz pose: the board stays under the feet in every layer', () => {
  const a = new NazAnimator();
  const frames = drive(a, SEQ);
  for (const f of frames) {
    assert.ok(f.boardY > 0.0 && f.boardY < 0.6, `board at ${f.boardY}`);
  }
});

// ------------------------------------------------------------------ lane-change lean
import { LANE_LEAN, leanAuthority, airdropState, airdropStep, AIRDROP } from '../src/anim.js';

// Drive the animator from a real LaneMotion and return per-frame poses. `script(i, lm)` may
// retarget the lane. The same seedless time stream is used for every run, so subtracting a run
// with no lateral movement isolates the lane-change contribution.
function laneRun({ frames = 120, hz = 60, script = () => {}, input = () => ({}), startX = 0 } = {}) {
  const a = new NazAnimator(), lm = new LaneMotion(startX), dt = 1 / hz, out = [];
  for (let i = 0; i < frames; i++) {
    script(i, lm);
    lm.step(dt);
    out.push({ ...a.update({ dt, time: i * dt, speed: 20, vx: lm.v, vy: 0, air: false, slide: false, mode: 'ride', ...input(i) }), x: lm.x });
  }
  return out;
}
const base = laneRun({ frames: 400 });
const delta = (run, i, k) => run[i][k] - base[i][k];
const LEAN_KEYS = ['riderZ', 'torsoZ', 'torsoY', 'neckY', 'lShZ', 'rShZ', 'boardZ', 'boardYaw', 'tailY'];

test('lane lean: moving left leans, turns and banks left; outside (right) arm rises; tail swings right', () => {
  const L = laneRun({ script: (i, lm) => { if (i === 10) lm.setTarget(-2.4); } });
  const i = 18; // mid lane change
  assert.ok(delta(L, i, 'riderZ') > 0.05, 'body rolls left (+z)');
  assert.ok(delta(L, i, 'torsoZ') > 0, 'shoulders follow');
  assert.ok(delta(L, i, 'torsoY') > 0.03, 'body turns into the move');
  assert.ok(delta(L, i, 'neckY') > 0, 'head looks into the move');
  assert.ok(delta(L, i, 'boardZ') > 0.05, 'board banks left');
  assert.ok(delta(L, i, 'rShZ') > 0.05, 'outside arm rises');
  assert.ok(delta(L, i, 'lShZ') > 0, 'inside arm drops in');
  // tail is a delayed follow-through: it is still building when the body lean already peaked
  const tailPeak = L.reduce((b, f, j) => (Math.abs(delta(L, j, 'tailY')) > Math.abs(delta(L, b, 'tailY')) ? j : b), 0);
  const leanPeak = L.reduce((b, f, j) => (Math.abs(delta(L, j, 'riderZ')) > Math.abs(delta(L, b, 'riderZ')) ? j : b), 0);
  assert.ok(delta(L, tailPeak, 'tailY') > 0 && tailPeak > leanPeak, `tail peak ${tailPeak} vs lean peak ${leanPeak}`);
});

test('lane lean: moving right is the exact mirror of moving left', () => {
  const L = laneRun({ script: (i, lm) => { if (i === 10) lm.setTarget(-2.4); } });
  const R = laneRun({ script: (i, lm) => { if (i === 10) lm.setTarget(2.4); } });
  for (let i = 0; i < L.length; i++) {
    for (const k of ['riderZ', 'torsoZ', 'torsoY', 'neckY', 'boardZ', 'boardYaw', 'tailY']) {
      assert.ok(Math.abs(delta(L, i, k) + delta(R, i, k)) < 1e-9, `${k} not mirrored at ${i}`);
    }
    // arms swap roles: left arm going right mirrors the right arm going left
    assert.ok(Math.abs(delta(L, i, 'rShZ') + delta(R, i, 'lShZ')) < 1e-9);
  }
});

test('lane lean: everything returns to the riding pose after the lane change', () => {
  const L = laneRun({ frames: 240, script: (i, lm) => { if (i === 10) lm.setTarget(-2.4); } });
  for (const k of LEAN_KEYS) assert.ok(Math.abs(delta(L, 239, k)) < 0.01, `${k} stuck at ${delta(L, 239, k)}`);
  assert.equal(L[239].x, -2.4);
});

test('lane lean: reversing mid-move flips the lean and bank smoothly', () => {
  const run = laneRun({ frames: 150, script: (i, lm) => { if (i === 10) lm.setTarget(-2.4); if (i === 15) lm.setTarget(0); } });
  const leanLeft = Math.max(...run.slice(10, 20).map((_, j) => delta(run, 10 + j, 'riderZ')));
  const leanRight = Math.min(...run.slice(15, 60).map((_, j) => delta(run, 15 + j, 'riderZ')));
  assert.ok(leanLeft > 0 && leanRight < 0, `left ${leanLeft} then right ${leanRight}`);
  for (let i = 1; i < run.length; i++) for (const k of LEAN_KEYS) {
    assert.ok(Math.abs(run[i][k] - run[i - 1][k]) < 0.12, `${k} snapped at frame ${i}`);
  }
});

test('lane lean: a second press mid-move (two lanes) keeps every joint continuous', () => {
  const run = laneRun({ frames: 120, startX: 2.4, script: (i, lm) => { if (i === 10) lm.setTarget(0); if (i === 14) lm.setTarget(-2.4); } });
  for (let i = 1; i < run.length; i++) for (const k of Object.keys(run[i])) {
    if (k === 'x') continue;
    assert.ok(Math.abs(run[i][k] - run[i - 1][k]) < 0.15, `${k} snapped at ${i}`);
  }
  assert.equal(run.at(-1).x, -2.4);
});

test('lane lean: jumping and sliding keep priority over the riding lean', () => {
  const lane = (i, lm) => { if (i === 10) lm.setTarget(-2.4); };
  const ride = laneRun({ script: lane });
  const air = laneRun({ script: lane, input: () => ({ air: true, vy: 4 }) });
  const airBase = laneRun({ input: () => ({ air: true, vy: 4 }) });
  const slide = laneRun({ script: lane, input: () => ({ slide: true }) });
  const slideBase = laneRun({ input: () => ({ slide: true }) });
  const i = 18;
  const rideLean = delta(ride, i, 'riderZ');
  assert.ok(air[i].riderZ - airBase[i].riderZ < rideLean * 0.6, 'air lean is reduced');
  assert.ok(slide[i].riderZ - slideBase[i].riderZ < rideLean * 0.5, 'slide lean is reduced');
  assert.ok(air[i].riderZ - airBase[i].riderZ > 0, 'but still leans the right way');
  // the base pose itself still wins: tucked legs in the air, deep crouch in the slide
  assert.ok(air[i].lKneeX < -1.0 && slide[i].lKneeX < -1.8);
  assert.equal(leanAuthority({ air: 0, slide: 0, idle: 1, victory: 0 }), 0);
});

test('lane lean: slide + lane change still clears the 1.12 m laser; board stays under the feet', () => {
  const run = laneRun({ frames: 90, script: (i, lm) => { if (i === 30) lm.setTarget(2.4); }, input: () => ({ slide: true }) });
  for (let i = 30; i < run.length; i++) {
    assert.ok(headTopY(run[i]) < 1.12, `head ${headTopY(run[i]).toFixed(3)} at ${i}`);
    assert.ok(run[i].boardY > 0 && run[i].boardY < 0.4);
  }
});

test('knees never bend backwards in any layer (thigh forward, shin back)', () => {
  const frames = [...drive(new NazAnimator(), SEQ), ...laneRun({ script: (i, lm) => { if (i % 20 === 5) lm.setTarget([-2.4, 0, 2.4][(i / 20) % 3 | 0]); } })];
  for (const f of frames) {
    for (const s of ['l', 'r']) {
      assert.ok(f[s + 'HipX'] > -0.05, `${s} thigh swung back: ${f[s + 'HipX']}`);
      assert.ok(f[s + 'KneeX'] < 0.05, `${s} knee bent backwards: ${f[s + 'KneeX']}`);
    }
  }
});

test('long random session: every pose channel stays finite and bounded', () => {
  const a = new NazAnimator(), lm = new LaneMotion(0);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let air = false, airT = 0, slideT = 0;
  for (let i = 0; i < 60 * 600; i++) { // 10 minutes at 60 Hz
    const r = rnd();
    if (r < 0.02) lm.setTarget([-2.4, 0, 2.4][(rnd() * 3) | 0]);
    else if (r < 0.025 && !air) { air = true; airT = 0.7; a.takeoff(); }
    else if (r < 0.03) slideT = 0.65;
    else if (r < 0.031) a.hit(rnd() < 0.5 ? -1 : 1);
    else if (r < 0.032) a.power();
    if (air && (airT -= 1 / 60) <= 0) { air = false; a.land(-10); }
    slideT = Math.max(0, slideT - 1 / 60);
    lm.step(1 / 60);
    const p = a.update({ dt: 1 / 60, time: i / 60, speed: 25, vx: lm.v, vy: air ? 10.5 - (0.7 - airT) * 30 : 0, air, slide: slideT > 0 && !air, mode: 'ride' });
    for (const k in p) {
      assert.ok(Number.isFinite(p[k]), `${k} = ${p[k]} at frame ${i}`);
      if (k !== 'boardYaw') assert.ok(Math.abs(p[k]) < 4, `${k} = ${p[k]} at frame ${i}`);
    }
  }
});

// ------------------------------------------------------------------ airdrop lifecycle
test('airdrop: descends on the original curve, lands, collapses, then stays landed', () => {
  const st = airdropState();
  airdropStep(st, -80, 1 / 60);
  assert.equal(st.phase, 'descending');
  assert.ok(Math.abs(st.y - (80 - 18) * 0.28) < 1e-9, 'same fall curve as before (collision timing unchanged)');
  assert.equal(st.collapse, 0);
  let z = -30;
  while (st.phase === 'descending') { z += 0.4; airdropStep(st, z, 1 / 60); }
  assert.equal(st.phase, 'landing');
  assert.equal(st.y, 0);
  let frames = 0;
  while (st.phase === 'landing') { z += 0.4; airdropStep(st, z, 1 / 60); frames++; }
  assert.equal(st.phase, 'landed');
  assert.ok(Math.abs(frames / 60 - AIRDROP.collapse) <= 1 / 60 + 1e-9);
  assert.equal(st.collapse, 1);
  for (let i = 0; i < 100; i++) { airdropStep(st, z + i, 1 / 60); assert.equal(st.phase, 'landed'); assert.equal(st.y, 0); }
});

test('airdrop: the parachute never collapses while the crate is still in the air', () => {
  const st = airdropState();
  for (let z = -150; z < 10; z += 0.3) {
    airdropStep(st, z, 1 / 60);
    if (st.y > 0) assert.equal(st.collapse, 0);
    assert.ok(st.collapse >= 0 && st.collapse <= 1 && st.settle >= 0 && st.settle <= 1);
  }
});
