// Pure animation + timing math (no Three.js, no DOM) so it can be unit-tested with node:test.
//
// - LaneMotion: gameplay lane movement. Cubic Hermite ease-in/out with velocity continuity, so
//   rapid re-targeting never snaps. Collision uses this exact position, so what you see is what
//   collides.
// - Spring: damped spring for secondary motion (tail follow-through, board bank, camera).
// - FixedStepper: bounded fixed-timestep accumulator + interpolation factor.
// - NazAnimator: layered procedural pose for Naz (ride / air / slide / victory / idle blended by
//   smoothed weights, plus springs and short event envelopes for takeoff, landing, hits,
//   pickups and power-ups).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent exponential approach
export const approach = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);

export const LANE_WIDTH = 2.4;
export const LANE_TIME = 0.15; // seconds per lane: same total time as the old linear move (fairness unchanged)

export class LaneMotion {
  constructor(x = 0) { this.snap(x); }
  snap(x) { this.x = x; this.v = 0; this.x0 = x; this.v0 = 0; this.x1 = x; this.t = 0; this.dur = 0; }
  get target() { return this.x1; }
  get moving() { return this.t < this.dur; }
  setTarget(x1) {
    if (x1 === this.x1 && this.moving) return;
    // reversing against current momentum: the board brakes hard (keep 30% of the velocity)
    const reversing = this.v * (x1 - this.x) < 0;
    this.x0 = this.x; this.v0 = reversing ? this.v * 0.3 : this.v; this.x1 = x1; this.t = 0;
    const dist = Math.abs(x1 - this.x);
    const against = reversing ? Math.abs(this.v0) * 0.004 : 0;
    this.dur = dist < 1e-6 && Math.abs(this.v) < 1e-6 ? 0 : Math.max(0.08, (LANE_TIME * dist) / LANE_WIDTH + against);
  }
  // knocked back toward `x1` (side bump): keep a bit of reversed momentum
  bounce(xNow, x1) {
    this.x = xNow; this.v = -this.v * 0.25;
    this.setTarget(x1);
  }
  step(dt) {
    if (!this.moving) { this.x = this.x1; this.v = 0; return this.x; }
    this.t = Math.min(this.dur, this.t + dt);
    const T = this.dur, s = this.t / T, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2;
    const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s;
    this.x = h00 * this.x0 + h10 * T * this.v0 + h01 * this.x1;
    this.v = (d00 * this.x0 + d10 * T * this.v0 + d01 * this.x1) / T;
    if (this.t >= T) { this.x = this.x1; this.v = 0; }
    return this.x;
  }
}

export class Spring {
  // freq in Hz, damping ratio (1 = critical, <1 = slight overshoot)
  constructor(freq = 4, damping = 0.8, value = 0) { this.w = 2 * Math.PI * freq; this.z = damping; this.value = value; this.vel = 0; this.target = value; }
  impulse(v) { this.vel += v; }
  set(v) { this.value = v; this.vel = 0; this.target = v; }
  step(dt, target = this.target) {
    this.target = target;
    // semi-implicit Euler, substepped so large frame times stay stable
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (this.w * this.w * (this.target - this.value) - 2 * this.z * this.w * this.vel) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

// Fixed 60 Hz simulation with a bounded catch-up. `frameDt` is clamped (a resumed tab cannot
// unleash seconds of simulation), steps per frame are capped, and `alpha` is the fraction of a
// step that has elapsed since the last simulated state (for render extrapolation).
export class FixedStepper {
  constructor(step = 1 / 60, maxFrame = 0.1, maxSteps = 6) { this.step = step; this.maxFrame = maxFrame; this.maxSteps = maxSteps; this.acc = 0; this.alpha = 0; }
  reset() { this.acc = 0; this.alpha = 0; }
  advance(frameDt, simulate) {
    this.acc += clamp(frameDt, 0, this.maxFrame);
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) { simulate(this.step); this.acc -= this.step; n++; }
    if (this.acc >= this.step) this.acc = 0; // dropped time: never spiral
    this.alpha = this.acc / this.step;
    return n;
  }
}

// ------------------------------------------------------------------ airdrop lifecycle
// descending → landing → landed. While descending the crate height follows the original fall
// curve (so collision timing is unchanged). On touchdown the canopy collapses over
// AIRDROP.collapse seconds (with a short crate settle), then the parachute is gone for good.
export const AIRDROP = { landZ: -18, fallRate: 0.28, collapse: 0.35 };
export function airdropState() { return { phase: 'descending', t: 0, y: Infinity, collapse: 0, settle: 0 }; }
export function airdropStep(st, sceneZ, dt) {
  if (st.phase === 'descending') {
    st.y = Math.max(0, (AIRDROP.landZ - sceneZ) * AIRDROP.fallRate); // = max(0, (-z - 18) * 0.28), unchanged
    if (st.y <= 0) { st.phase = 'landing'; st.t = 0; }
  }
  if (st.phase === 'landing') {
    st.t += dt;
    if (st.t >= AIRDROP.collapse) st.phase = 'landed';
  }
  if (st.phase !== 'descending') st.y = 0;
  st.collapse = st.phase === 'descending' ? 0 : st.phase === 'landed' ? 1 : st.t / AIRDROP.collapse;
  // crate settle: a quick, small squash in the first 40% of the collapse
  st.settle = st.phase === 'landing' ? Math.sin(Math.min(1, st.collapse / 0.4) * Math.PI) : 0;
  return st;
}

// ------------------------------------------------------------------ lane-change lean
// Amplitudes (radians) for the lean into a lane change. `lean` is a spring that follows the
// lateral velocity of LaneMotion (-1 = full speed left, +1 = full speed right), so the pose is
// driven by the real lane change, eases in/out with it and reverses smoothly mid-move.
export const LANE_LEAN = {
  vMax: 16,        // lateral speed (u/s) that counts as full lean
  rider: 0.16,     // whole body rolls into the move
  torso: 0.07,     // shoulders add a little more
  yaw: 0.2,        // body turns toward the new lane
  neckYaw: 0.25,   // head looks where he's going
  neckRoll: 0.1,   // head counter-rolls to stay level-ish
  armOut: 0.5,     // outside arm rises for balance
  armIn: 0.15,     // inside arm drops in
  armFwd: 0.2,
  elbowOut: 0.25,  // outside elbow opens
  tail: 0.85,      // tail swings out the other way (spring = delayed follow-through)
  bank: 0.32,      // board banks into the move
  boardYaw: 0.08,  // board carves its nose into the turn
};
// How much of the lane lean the current base layer allows: jumps, slides, idle and victory keep
// priority over the riding lean.
export const leanAuthority = (w) => (1 - Math.max(w.idle, w.victory)) * (1 - 0.55 * w.air) * (1 - 0.65 * w.slide);

// ------------------------------------------------------------------ Naz pose
// Leg geometry (must match models.js): thigh pivot→knee 0.3, knee→ankle 0.3.
// Sign convention (character faces −z): +hipX swings the thigh forward, −kneeX folds the shin back,
// footX = −(hipX + kneeX) keeps the sole flat on the deck.
const THIGH = 0.3, SHIN = 0.3;
const legLen = (hipX, kneeX) => THIGH * Math.cos(hipX) + SHIN * Math.cos(hipX + kneeX);
// in the neutral riding pose the soles sit this far above the board's origin
const BOARD_TO_FOOT = 0.113;
const RIDER_Y = 0.32;

const CHANNELS = ['riderY', 'riderZ', 'hipsY', 'torsoX', 'torsoZ', 'torsoY', 'neckX', 'neckY', 'neckZ',
  'lHipX', 'lKneeX', 'lFootX', 'lHipZ', 'rHipX', 'rKneeX', 'rFootX', 'rHipZ',
  'lShX', 'lShZ', 'lElX', 'rShX', 'rShZ', 'rElX', 'tailX', 'tailY'];

function zeroPose() { const p = {}; for (const c of CHANNELS) p[c] = 0; return p; }
function blendInto(out, a, w) { if (w <= 0) return; for (const c of CHANNELS) out[c] += (a[c] - out[c]) * w; }

export class NazAnimator {
  constructor() {
    this.w = { air: 0, slide: 0, victory: 0, idle: 0 };
    this.lean = new Spring(4, 0.8);        // body lean follows lane velocity (~50 ms to respond, no flick on reversal)
    this.bank = new Spring(3.8, 0.6);      // board banks a touch later and overshoots slightly
    this.armLean = new Spring(2.8, 0.75);  // arms trail the body lean (secondary motion)
    this.tailYaw = new Spring(2.2, 0.45);  // tail: slow, loose follow-through
    this.tailPitch = new Spring(2.6, 0.5);
    this.squash = new Spring(7, 0.45);     // + = compressed (takeoff / landing)
    this.pitch = new Spring(5, 0.6);       // board nose pitch
    this.hitT = 0; this.hitDir = 1;
    this.collectT = 0; this.powerT = 0; this.boostT = 0; this.boost = 0;
    this._r = zeroPose(); this._a = zeroPose(); this._s = zeroPose(); this._v = zeroPose(); this._i = zeroPose();
    this.pose = { ...zeroPose(), boardY: 0.22, boardX: 0, boardZ: 0, boardYaw: 0, packScale: 1, bandanaX: 0.3, flame: 1 };
  }
  takeoff() { this.squash.impulse(5.5); this.pitch.impulse(2.2); this.boostT = 0.35; }
  land(impactVy) { const k = clamp(-impactVy / 12, 0.2, 1.2); this.squash.impulse(6 * k); this.pitch.impulse(-1.6 * k); }
  hit(dir = 1) { this.hitT = 0.55; this.hitDir = dir || 1; this.squash.impulse(3); }
  collect() { this.collectT = 1; }
  power() { this.powerT = 1; this.squash.impulse(3); }

  // s: { time, dt, vx, air, vy, slide, speed, mode: 'ride'|'idle'|'victory', leanScale? }
  // vx is LaneMotion's lateral velocity (u/s); leanScale < 1 tones the lean down (reduced motion)
  update(s) {
    const dt = s.dt, t = s.time, P = this.pose;
    const w = this.w;
    w.air = approach(w.air, s.air ? 1 : 0, s.air ? 16 : 22, dt);
    w.slide = approach(w.slide, s.slide ? 1 : 0, 14, dt); // ~70 ms to 63%: quick but never a one-frame snap
    w.victory = approach(w.victory, s.mode === 'victory' ? 1 : 0, 6, dt);
    w.idle = approach(w.idle, s.mode === 'idle' ? 1 : 0, 6, dt);
    const L = LANE_LEAN, vn = clamp((s.vx || 0) / L.vMax, -1, 1);
    const lean = this.lean.step(dt, vn);
    const bank = this.bank.step(dt, -vn * L.bank);
    const sq = this.squash.step(dt, 0);
    const spd = clamp((s.speed || 0) / 30, 0, 1);
    this.hitT = Math.max(0, this.hitT - dt);
    this.collectT = Math.max(0, this.collectT - dt * 5);
    this.powerT = Math.max(0, this.powerT - dt / 0.6);
    this.boostT = Math.max(0, this.boostT - dt);
    this.boost = approach(this.boost, this.boostT > 0 ? 1 : 0, 14, dt);

    // ---- ride: balanced, alive, small amplitudes
    const R = this._r, om = 7 + spd * 4, b = Math.sin(t * om), b2 = Math.sin(t * om * 0.5 + 1.3);
    R.riderY = RIDER_Y; R.riderZ = b2 * 0.015;
    R.hipsY = 0.6 + b * 0.012;
    R.torsoX = -0.1 - spd * 0.08 + Math.sin(t * om + 0.6) * 0.015; R.torsoZ = b2 * 0.02; R.torsoY = Math.sin(t * 0.9) * 0.04;
    R.neckX = 0.06 - R.torsoX * 0.5; R.neckY = 0; R.neckZ = 0;
    R.lHipX = 0.2 + b * 0.02; R.lKneeX = -0.42 - b * 0.03; R.lFootX = 0.22; R.lHipZ = -0.06;
    R.rHipX = 0.2 - b * 0.02; R.rKneeX = -0.42 + b * 0.03; R.rFootX = 0.22; R.rHipZ = 0.06;
    R.lShX = 0.15 + Math.sin(t * 3.1) * 0.06; R.lShZ = -0.38; R.lElX = -0.42;
    R.rShX = 0.15 + Math.sin(t * 3.1 + 2) * 0.06; R.rShZ = 0.38; R.rElX = -0.42;
    R.tailX = Math.sin(t * om + 1) * 0.05; R.tailY = 0.35 + Math.sin(t * 4.4) * 0.22;

    // ---- air: ollie tuck, arms out for balance (board follows the feet)
    const A = this._a; Object.assign(A, R);
    A.hipsY = 0.62; A.torsoX = -0.24; A.neckX = 0.14;
    A.lHipX = A.rHipX = 0.8; A.lKneeX = A.rKneeX = -1.35; A.lFootX = A.rFootX = 0.5; A.lHipZ = -0.12; A.rHipZ = 0.12;
    A.lShX = -0.55; A.lShZ = -0.95; A.lElX = -0.25; A.rShX = -0.55; A.rShZ = 0.95; A.rElX = -0.25;
    A.tailX = -0.3; A.tailY = 0.35;

    // ---- slide: low tuck; head stays under the 1.12 m liquidation line (see test/anim.test.js)
    const S = this._s; Object.assign(S, R);
    S.riderY = 0.16; S.hipsY = 0.29; S.torsoX = -1.35; S.torsoZ = 0; S.neckX = 0.5;
    S.lHipX = S.rHipX = 1.3; S.lKneeX = S.rKneeX = -2.3; S.lFootX = S.rFootX = 0.95; S.lHipZ = -0.18; S.rHipZ = 0.18;
    S.lShX = 0.95; S.lShZ = -0.45; S.lElX = -0.25; S.rShX = 0.95; S.rShZ = 0.45; S.rElX = -0.25;
    S.tailX = -0.45; S.tailY = 0.25;

    // ---- victory: fists up, bouncing
    const V = this._v; Object.assign(V, R);
    const pump = Math.sin(t * 9);
    V.hipsY = 0.62 + Math.abs(pump) * 0.03; V.torsoX = 0.12; V.neckX = -0.25;
    V.lShX = -2.7 + pump * 0.25; V.lShZ = -0.3; V.lElX = -0.35; V.rShX = -2.7 - pump * 0.25; V.rShZ = 0.3; V.rElX = -0.35;
    V.tailY = 0.35 + Math.sin(t * 12) * 0.5; V.tailX = -0.25;

    // ---- idle (menu): weight shift, hand on hip, wave, curious head
    const I = this._i; Object.assign(I, R);
    const shift = Math.sin(t * 1.4);
    I.riderZ = shift * 0.04; I.hipsY = 0.61; I.torsoZ = -shift * 0.05; I.torsoY = 0.1;
    I.neckY = Math.sin(t * 0.8) * 0.3; I.neckZ = Math.sin(t * 1.1 + 1) * 0.12; I.neckX = -0.05;
    I.lShX = 0.2; I.lShZ = -0.75; I.lElX = -1.7;
    I.rShX = -2.5; I.rShZ = 0.55 + Math.sin(t * 7) * 0.35; I.rElX = -0.45 + Math.sin(t * 7 + 0.5) * 0.2;
    I.tailY = 0.35 + Math.sin(t * 3) * 0.45;

    // ---- blend layers
    const O = P;
    for (const c of CHANNELS) O[c] = R[c];
    blendInto(O, A, w.air);
    blendInto(O, S, w.slide);
    blendInto(O, I, w.idle);
    blendInto(O, V, w.victory);

    // ---- additive layers: lean into lane changes, squash, hit, pickups
    // Signs (character faces −z, +x = right): +riderZ / +torsoZ tilt the top toward −x (left),
    // +torsoY / +neckY turn toward −x, +shoulderZ raises the right arm / lowers the left.
    const ride = 1 - Math.max(w.idle, w.victory);
    const m = leanAuthority(w) * (s.leanScale ?? 1);
    O.riderZ += -lean * L.rider * m;
    O.torsoZ += -lean * L.torso * m;
    O.torsoY += -lean * L.yaw * m;
    O.neckY += -lean * L.neckYaw * m;
    O.neckZ += lean * L.neckRoll * m;
    // balance: the outside arm rises and opens, the inside arm drops in, both reach forward a bit
    const armLean = this.armLean.step(dt, lean);
    const outR = Math.max(0, -armLean), outL = Math.max(0, armLean); // moving left → right arm is outside
    O.rShZ += (outR * L.armOut - outL * L.armIn) * m;
    O.lShZ -= (outL * L.armOut - outR * L.armIn) * m;
    O.rElX += outR * L.elbowOut * m; O.lElX += outL * L.elbowOut * m;
    O.lShX += Math.abs(armLean) * L.armFwd * m; O.rShX += Math.abs(armLean) * L.armFwd * m;

    O.hipsY -= sq * 0.1;
    O.lKneeX -= sq * 0.45; O.rKneeX -= sq * 0.45; O.lHipX += sq * 0.22; O.rHipX += sq * 0.22;
    O.lFootX += sq * 0.22; O.rFootX += sq * 0.22;
    O.torsoX -= sq * 0.18;
    O.lShZ -= sq * 0.25; O.rShZ += sq * 0.25;

    if (this.hitT > 0) {
      const e = this.hitT / 0.55, env = Math.sin(e * Math.PI) * e; // fast attack, eased recovery
      O.riderZ += this.hitDir * env * 0.35;
      O.torsoX += env * 0.35;
      O.neckX -= env * 0.3;
      O.lShX -= env * 1.1; O.rShX -= env * 1.1; O.lShZ -= env * 0.8; O.rShZ += env * 0.8;
    }
    const c = this.collectT;
    O.neckX -= c * 0.1; O.torsoX -= c * 0.05;
    const pw = this.powerT;
    O.lShX -= Math.sin(pw * Math.PI) * 1.4; O.rShX -= Math.sin(pw * Math.PI) * 1.4;

    // tail: delayed follow-through of lean and vertical motion
    O.tailY += this.tailYaw.step(dt, -lean * L.tail * (s.leanScale ?? 1)) * ride;
    O.tailX += this.tailPitch.step(dt, clamp(-(s.vy || 0) * 0.03, -0.35, 0.35));

    // ---- board: stays under the feet, banks, pitches through jumps
    const foot = O.riderY + O.hipsY - (legLen(O.lHipX, O.lKneeX) + legLen(O.rHipX, O.rKneeX)) / 2;
    const hover = Math.sin(t * 3.6) * 0.022 * (1 - w.slide * 0.6);
    O.riderY += hover;
    P.boardY = foot - BOARD_TO_FOOT + hover;
    const airPitch = clamp((s.vy || 0) * 0.022, -0.22, 0.22) * w.air;
    P.boardX = this.pitch.step(dt, airPitch + w.slide * 0.08) + Math.sin(t * om * 0.5) * 0.012 * (1 - w.air);
    P.boardZ = bank * ride * (1 - 0.3 * w.slide) * (s.leanScale ?? 1) + b2 * 0.02 + (this.hitT > 0 ? Math.sin(t * 28) * 0.12 * (this.hitT / 0.55) : 0);
    // power-up: one quick 360 spin of the board (eased); otherwise the nose carves into the move
    const sp = 1 - pw; P.boardYaw = (pw > 0 ? (sp * sp * (3 - 2 * sp)) * Math.PI * 2 : 0) - lean * L.boardYaw * m;
    P.packScale = 1 + c * 0.14 + Math.max(0, sq) * 0.04;
    P.bandanaX = 0.3 + Math.sin(t * 13) * 0.18 * (0.4 + spd) + lean * 0.2;
    // thruster: speed + takeoff boost + deterministic flicker (no per-frame random)
    P.flame = 0.65 + spd * 0.6 + this.boost * 0.6 + (Math.sin(t * 37) + Math.sin(t * 23.3)) * 0.06;
    return P;
  }
}

// Height of Naz's head top above his feet's ground for a pose (root scale 1.08 applied).
// Mirrors the rig in models.js; used by tests to prove the slide clears the liquidation line.
export function headTopY(P, rootScale = 1.08) {
  const hips = P.riderY + P.hipsY;
  const torsoTop = 0.56 * Math.cos(P.torsoX);
  const headCenter = 0.24 * Math.cos(P.torsoX + P.neckX);
  return (hips + torsoTop + headCenter + 0.29) * rootScale;
}
