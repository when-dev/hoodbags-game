// Runs the real src/main.js game loop in Node with DOM/renderer stubs (tools/dom-stub.mjs).
// This covers gameplay state, animation hooks, spawning and lifecycle. It does NOT cover WebGL
// output, CSS, audio output or real input devices.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubRenderer } from '../tools/dom-stub.mjs';

const LANES = [-2.4, 0, 2.4];
let hb;
const DT = 1 / 60;
let frameDt = DT;
const tick = (n = 1, god = false) => { for (let i = 0; i < n; i++) { if (god) hb.G.player.invuln = Math.max(hb.G.player.invuln, 0.05); hb.tick(); } };
const run = (mode = 'story', d = 0) => { hb.startRun(mode, d); hb.G.state = 'running'; frameDt = DT; };
const clearAhead = () => { for (const o of [...hb.G.obstacles]) { o.dead = true; o.obj.visible = false; } };

before(async () => {
  installDom();
  globalThis.__HB_RENDERER__ = stubRenderer;
  const warn = console.warn; console.warn = () => {}; // three.js warns about canvas-less textures in Node
  await import('../src/main.js');
  await new Promise((r) => setTimeout(r, 30));
  console.warn = warn;
  hb = globalThis.__hb;
  hb.clock.getDelta = () => frameDt;
});

test('boots into the menu with consistent pools', () => {
  tick(30);
  assert.equal(hb.G.state, 'menu');
  for (const p of hb.pools.pools.values()) assert.ok(p.validate());
});

test('lane change: same 9-step duration as before, lands exactly on the lane', () => {
  run(); clearAhead();
  hb.input.laneMove(1);
  let steps = 0;
  while (hb.G.player.x !== LANES[2] && steps < 30) { tick(1, true); steps++; }
  assert.ok(steps <= 10, `took ${steps} frames`);
  assert.equal(hb.G.player.lane, 2);
});

test('rapid alternating lane changes stay on the road and settle on the chosen lane', () => {
  run(); clearAhead();
  for (let i = 0; i < 120; i++) {
    if (i % 2 === 0) hb.input.laneMove(i % 8 < 4 ? 1 : -1);
    tick(1, true);
    const p = hb.G.player;
    assert.ok(p.x > -2.9 && p.x < 2.9 && Number.isFinite(p.x), `x=${p.x}`);
    assert.ok(p.lane >= 0 && p.lane <= 2);
  }
  tick(30, true);
  assert.equal(hb.G.player.x, LANES[hb.G.player.lane]);
});

test('jump and slide during a lane change resolve cleanly', () => {
  run(); clearAhead();
  hb.input.laneMove(-1); tick(2, true); hb.input.jump();
  tick(3, true);
  assert.ok(hb.G.player.air, 'jumped mid lane change');
  tick(60, true);
  assert.ok(!hb.G.player.air && hb.G.player.y === 0, 'landed');
  assert.equal(hb.G.player.x, LANES[0]);
  hb.input.slide(); tick(2, true); hb.input.laneMove(1);
  tick(10, true);
  assert.ok(hb.G.player.slide > 0, 'slide continues through the lane change');
  tick(45, true);
  assert.ok(hb.G.player.slide <= 0, 'slide ends on its own timer');
  tick(20, true);
  assert.ok(hb.nazAnim.w.slide < 0.1, 'animation left the slide pose');
});

test('side bump: bounces back to the previous lane, Liq starts chasing, run continues', () => {
  run(); clearAhead(); tick(5);
  hb.spawn('crash', 2, 6, 12); // a long candle right beside the player in the right lane
  hb.input.laneMove(1);
  tick(40);
  assert.equal(hb.G.state, 'running');
  assert.ok(hb.G.liqChase > 0, 'Liq is on the tail');
  assert.equal(hb.G.player.lane, 1);
  assert.equal(hb.G.player.x, LANES[1]);
  assert.ok(hb.nazAnim.hitT >= 0);
});

test('power-up activates, animates and expires', () => {
  run(); clearAhead(); tick(5);
  hb.pickup('magnet', 1, -4);
  tick(30, true);
  assert.ok(hb.G.power.magnet > 0);
  hb.G.power.magnet = 0.1;
  tick(20, true);
  assert.equal(hb.G.power.magnet, 0);
  assert.equal(hb.nazAnim.powerT, 0, 'celebration layer finished');
});

test('pause freezes the world; resuming after a long gap does not fast-forward', () => {
  run(); tick(30, true);
  hb.input.togglePause();
  assert.equal(hb.G.state, 'paused');
  const d0 = hb.G.dist;
  frameDt = 5; tick(3); // 15 s of "paused" frames
  assert.equal(hb.G.dist, d0);
  hb.input.togglePause();
  frameDt = 5; tick(1); // first frame after a long stall
  frameDt = DT;
  const maxAdvance = 6 * DT * hb.G.speed + 1e-6;
  assert.ok(hb.G.dist - d0 <= maxAdvance, `advanced ${hb.G.dist - d0} m in one frame`);
});

test('death and restart: no objects from the old run survive, pools stay consistent', () => {
  run(); tick(400, true);
  hb.die('crash');
  tick(120);
  assert.equal(hb.G.state, 'dead');
  const worldBefore = hb.world.children.length;
  for (let i = 0; i < 5; i++) { run(); tick(200, true); hb.die('rug'); tick(100); }
  run(); tick(1);
  assert.ok(hb.G.obstacles.every((o) => o.obj.parent === hb.world));
  assert.ok(hb.world.children.length <= worldBefore + 5, `world grew ${worldBefore} -> ${hb.world.children.length}`);
  for (const p of hb.pools.pools.values()) assert.ok(p.validate());
  assert.equal(hb.coinPool.count, hb.G.coinsArr.length);
  assert.equal(hb.fx.n, 0);
});

test('campaign finale triggers and reaches the victory state', () => {
  run('story', 2); tick(5, true);
  hb.G.dist = 3300 - 5;
  tick(60, true);
  assert.equal(hb.G.state, 'finale');
  tick(60 * 4, true);
  assert.equal(hb.G.state, 'won');
});

test('long endless session: object counts stay bounded', () => {
  run('endless');
  const samples = [];
  for (let k = 0; k < 6; k++) {
    tick(60 * 30, true); // 30 s chunks
    samples.push({ world: hb.world.children.length, obstacles: hb.G.obstacles.length, coins: hb.G.coinsArr.length, scenery: hb.G.scenery.length, inst: hb.pools.stats().instances, overflow: hb.pools.stats().overflow, particles: hb.fx.n });
  }
  for (const s of samples) {
    assert.ok(s.world < 140 && s.obstacles < 40 && s.coins < 80 && s.scenery < 120 && s.inst < 900, JSON.stringify(s));
    assert.equal(s.overflow, 0);
  }
  assert.equal(hb.coinPool.count, hb.G.coinsArr.length);
  // later samples are not systematically larger than earlier ones
  assert.ok(samples[5].world <= samples[0].world + 15 && samples[5].inst <= samples[0].inst + 120, JSON.stringify(samples));
});

// ------------------------------------------------------------------ keyboard through the real listeners
// Dispatches events at the same window-level listeners the browser would call.
const key = (code, k, type = 'keydown', extra = {}) => {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code, key: k, repeat: false, ...extra });
  dispatchEvent(e);
  return e.defaultPrevented;
};
const tap = (code, k) => { const used = key(code, k); key(code, k, 'keyup'); return used; };
const settle = () => tick(20, true);

test('keyboard: A/ArrowLeft and D/ArrowRight change lanes through the real listener', () => {
  run(); clearAhead();
  assert.equal(tap('KeyA', 'a'), true, 'consumed (preventDefault)'); settle();
  assert.equal(hb.G.player.lane, 0);
  tap('ArrowRight', 'ArrowRight'); settle();
  assert.equal(hb.G.player.lane, 1);
  tap('KeyD', 'd'); settle();
  assert.equal(hb.G.player.lane, 2);
  tap('ArrowLeft', 'ArrowLeft'); settle();
  assert.equal(hb.G.player.lane, 1);
  assert.equal(hb.G.player.x, LANES[1]);
});

test('keyboard: WASD works on a Ukrainian layout (the original bug)', () => {
  run(); clearAhead();
  tap('KeyA', 'ф'); settle();
  assert.equal(hb.G.player.lane, 0);
  tap('KeyD', 'в'); settle();
  assert.equal(hb.G.player.lane, 1);
  tap('KeyW', 'ц'); tick(3, true);
  assert.ok(hb.G.player.air, 'W jumps');
  tick(60, true);
  tap('KeyS', 'і'); tick(1, true);
  assert.ok(hb.G.player.slide > 0, 'S slides');
});

test('keyboard: W/ArrowUp/Space jump, S/ArrowDown slide', () => {
  for (const [c, k] of [['KeyW', 'w'], ['ArrowUp', 'ArrowUp'], ['Space', ' ']]) {
    run(); clearAhead(); tap(c, k); tick(3, true);
    assert.ok(hb.G.player.air, `${c} jumps`);
  }
  for (const [c, k] of [['KeyS', 's'], ['ArrowDown', 'ArrowDown']]) {
    run(); clearAhead(); tap(c, k); tick(1, true);
    assert.ok(hb.G.player.slide > 0, `${c} slides`);
  }
});

test('keyboard: a held key moves one lane only; the next real press moves again', () => {
  run(); clearAhead();
  key('KeyD', 'd'); for (let i = 0; i < 8; i++) { key('KeyD', 'd', 'keydown', { repeat: i % 2 === 0 }); tick(2, true); }
  settle();
  assert.equal(hb.G.player.lane, 2);
  key('KeyD', 'd', 'keyup');
  tap('KeyA', 'a'); settle();
  assert.equal(hb.G.player.lane, 1);
});

test('keyboard: ignored (and not consumed) in menu, countdown, pause and game over', () => {
  hb.toMenu();
  assert.equal(tap('KeyA', 'a'), false);
  assert.equal(hb.G.player.lane, 1);
  hb.startRun('story'); // countdown
  assert.equal(hb.G.state, 'countdown');
  assert.equal(tap('KeyD', 'd'), false);
  hb.G.state = 'running';
  tap('KeyP', 'p');
  assert.equal(hb.G.state, 'paused');
  assert.equal(tap('KeyA', 'a'), false);
  assert.equal(hb.G.player.lane, 1);
  tap('Escape', 'Escape');
  assert.equal(hb.G.state, 'running');
  hb.die('crash'); tick(120);
  assert.equal(hb.G.state, 'dead');
  assert.equal(tap('KeyD', 'd'), false);
  assert.equal(hb.G.player.lane, 1);
});

test('keyboard: window blur, pause and restart clear held keys', () => {
  run(); clearAhead();
  key('KeyD', 'd');
  assert.equal(hb.keyboard.held.size, 1);
  dispatchEvent(new Event('blur'));
  assert.equal(hb.keyboard.held.size, 0);
  key('KeyA', 'a');
  hb.input.togglePause();
  assert.equal(hb.keyboard.held.size, 0);
  hb.input.togglePause();
  key('KeyA', 'a');
  run();
  assert.equal(hb.keyboard.held.size, 0);
});

test('keyboard: repeated restarts never duplicate listeners or actions', () => {
  for (let i = 0; i < 6; i++) { run(); tick(5, true); }
  clearAhead();
  tap('KeyD', 'd'); settle();
  assert.equal(hb.G.player.lane, 2, 'one press = exactly one lane');
});

test('touch: swipes still steer (left, up, and a chained drag)', () => {
  const touch = (type, x, y) => { const e = new Event(type); e.changedTouches = [{ identifier: 4, clientX: x, clientY: y }]; dispatchEvent(e); };
  run(); clearAhead();
  touch('touchstart', 200, 500); touch('touchmove', 140, 500); touch('touchend', 140, 500); settle();
  assert.equal(hb.G.player.lane, 0);
  touch('touchstart', 200, 500); touch('touchmove', 200, 440); touch('touchend', 200, 440); tick(3, true);
  assert.ok(hb.G.player.air);
  tick(60, true);
  touch('touchstart', 100, 500); touch('touchmove', 160, 500); touch('touchmove', 220, 500); touch('touchend', 220, 500); settle();
  assert.equal(hb.G.player.lane, 2, 'one drag, two swipes');
});

// ------------------------------------------------------------------ airdrop parachute lifecycle
function spawnCrate(laneIdx, z) {
  const o = hb.spawn('airdrop', laneIdx, z);
  return { o, localZ: o.obj.position.z };
}

test('airdrop: descending crate keeps its parachute, landed crate loses it but stays put', () => {
  run(); clearAhead(); tick(2, true);
  const { o, localZ } = spawnCrate(2, -90);
  tick(1, true);
  assert.equal(o.drop.phase, 'descending');
  assert.ok(o.crate.position.y > 1 && o.chute.visible && o.lines.visible, 'parachute attached while falling');
  assert.equal(o.chute.scale.y, 0.75, 'canopy fully open');
  let guard = 0;
  while (o.drop.phase === 'descending' && guard++ < 600) { tick(1, true); if (o.drop.phase === 'descending') assert.ok(o.chute.visible); }
  assert.equal(o.drop.phase, 'landing');
  assert.ok(o.chute.visible, 'collapse animation plays before removal');
  while (o.drop.phase !== 'landed' && guard++ < 900) tick(1, true);
  tick(1, true);
  assert.equal(o.chute.visible, false, 'canopy gone');
  assert.equal(o.lines.visible, false, 'ropes gone');
  assert.equal(o.obj.visible, true, 'crate still there');
  assert.equal(o.obj.parent, hb.world);
  assert.equal(o.crate.position.y, 0);
  assert.equal(o.crate.scale.y, 1, 'settle squash finished');
  assert.ok(Math.abs(o.crate.rotation.z) < 0.02, 'sway settled level');
  assert.equal(o.obj.position.x, LANES[2]);
  assert.equal(o.obj.position.z, localZ, 'did not move in the world');
  assert.deepEqual(o.hit, { yMin: 0, yMax: 1.0, len: 1.15, hw: 0.72 }, 'hitbox untouched');
  assert.equal(o.yOff, 0);
  tick(30, true);
  assert.equal(o.chute.visible, false, 'stays gone (no re-trigger)');
});

test('airdrop: a landed crate still blocks the lane (collision intact)', () => {
  run(); clearAhead(); tick(2, true);
  spawnCrate(1, -60);
  let guard = 0;
  while (hb.G.state === 'running' && guard++ < 600) tick(1); // no god mode, player stays in lane 1
  assert.equal(hb.G.state, 'dying');
  assert.equal(hb.G.deathKind, 'airdrop');
});

test('airdrop: a crate can still be jumped onto after landing (ground height intact)', () => {
  run(); clearAhead(); tick(2, true);
  const { o } = spawnCrate(1, -40);
  let guard = 0;
  while (hb.sceneZ(o) < -3.5 && guard++ < 600) tick(1);
  hb.input.jump();
  let stoodOn = false;
  for (let i = 0; i < 60 && hb.G.state === 'running'; i++) { tick(1); if (hb.G.player.ground > 0.9) stoodOn = true; }
  assert.equal(hb.G.state, 'running', 'cleared the crate');
  assert.ok(stoodOn, 'landed on top of the crate');
});

test('airdrop: diamond hands destroys the crate together with any parachute', () => {
  run(); clearAhead(); tick(2, true);
  hb.G.power.shield = 10;
  const { o } = spawnCrate(1, -60);
  let guard = 0;
  while (!o.dead && guard++ < 600) tick(1);
  assert.equal(hb.G.state, 'running');
  assert.equal(o.obj.visible, false, 'crate and parachute hidden together');
});

test('airdrop: despawn and restart leave no orphaned parachutes', () => {
  const chutes = () => { let n = 0; hb.world.traverse((c) => { if (c.name === 'chute') n++; }); return n; };
  run(); clearAhead(); tick(2, true);
  const { o } = spawnCrate(0, -40);
  let guard = 0;
  while (hb.G.obstacles.includes(o) && guard++ < 900) tick(1, true);
  assert.equal(o.obj.parent, null, 'despawned crate removed with its parachute');
  const mid = spawnCrate(2, -120).o; // restart while one is still falling
  tick(5, true);
  assert.equal(mid.drop.phase, 'descending');
  run();
  assert.equal(mid.obj.parent, null);
  tick(2, true);
  const live = hb.G.obstacles.filter((x) => x.kind === 'airdrop').length;
  assert.equal(chutes(), live, 'every parachute in the world belongs to a live crate');
});
