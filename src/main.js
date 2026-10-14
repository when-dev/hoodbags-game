import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  LANES, SPAWN_Z, DESPAWN_Z, GRAVITY, JUMP_V, SLIDE_TIME, STUMBLE_WINDOW,
  DISTRICTS, ENDLESS, POWERUPS, DEATH_LINES, EAZY_TIPS, LIQ_TAUNTS, EAZY_LANE_TIP, EAZY_BAD_TIP,
  EAZY_DEATH, DUMP_LINES, TUTORIAL,
} from './config.js';
import {
  createNaz, applyNazPose, createEazy, animateEazy, createLiq, animateLiq, coinGeometry, coinMaterial, createBag, createPowerup,
  createFud, createBar, createAirdrop, SCAM_MAT, createRug, createCrash, createIntelMarker, createGate, createBull,
} from './models.js';
import { skyTexture, skylineTexture } from './textures.js';
import { Effects, createTrail } from './effects.js';
import { planRow, planCoins, OBSTACLE_LEN } from './logic.js';
import { LaneMotion, Spring, FixedStepper, NazAnimator, approach, airdropState, airdropStep } from './anim.js';
import { InstancePool, PoolSet } from './instancing.js';
import { Scenery } from './scenery.js';
import { AdaptiveQuality, PRESETS, pixelRatioFor, defaultLevel } from './quality.js';
import { initAudio, sfx, coinPickup, resetCoinCombo, startMusic, stopMusic, setMusicLevel, toggleMute, isMuted, _debug as audioDebug } from './audio.js';
import * as ui from './ui.js';
import { KeyboardInput, SwipeInput, isEditable } from './input.js';
import { PerfMonitor } from './perf.js';

// ============================================================ renderer / scene
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// test hook: the Node sim harness (tools/sim-harness.mjs) injects a stub renderer; browsers never set it
const HEADLESS = !!globalThis.__HB_RENDERER__;
const renderer = HEADLESS ? globalThis.__HB_RENDERER__() : new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(DISTRICTS[0].fog, 55, 185);
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 3.6, 7.2);

// subtle image-based lighting so metals (gold chain, coins, the bull) have something to reflect
let envTex = null;
if (!HEADLESS) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
// only characters and gold get reflections; the streets keep their night contrast
function applyEnv(root, intensity = 0.3) {
  if (!envTex) return;
  root.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.isMeshStandardMaterial) { o.material.envMap = envTex; o.material.envMapIntensity = intensity; o.material.needsUpdate = true; } });
}
// lighting: 3 lights total, no shadow maps anywhere (the neon look doesn't need them)
scene.add(new THREE.HemisphereLight(0xc9b6ff, 0x221133, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 10, 8);
scene.add(sun);
const key = new THREE.DirectionalLight(0xffe2f4, 0.7); // soft key light on the characters from the camera side
key.position.set(-2, 4, 10);
scene.add(key);
scene.add(key.target);

// ---------------------------------------------------------------- quality
let composer = null, bloomOn = false;
function ensureComposer() {
  if (composer || HEADLESS) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.62));
  composer.addPass(new OutputPass());
}
let qualitySetting = 'auto';
try { qualitySetting = localStorage.getItem('hb_quality') || 'auto'; } catch {}
if (!['auto', 'high', 'balanced', 'performance'].includes(qualitySetting)) qualitySetting = 'auto';
const quality = new AdaptiveQuality({ level: qualitySetting === 'auto' ? defaultLevel({ touch: isTouch }) : qualitySetting, auto: qualitySetting === 'auto' });

function applyQuality() {
  const level = quality.level, preset = PRESETS[level];
  const ratio = pixelRatioFor(level, { dpr: devicePixelRatio, width: innerWidth, height: innerHeight, touch: isTouch });
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight);
  bloomOn = preset.bloom && !isTouch && !HEADLESS; // phones never pay for bloom
  if (bloomOn) { ensureComposer(); composer.setPixelRatio(ratio); composer.setSize(innerWidth, innerHeight); }
  fx.density = preset.particles;
  scenery.low = isTouch || level === 'performance';
  ui.setQualityLabel(qualitySetting === 'auto' ? `AUTO · ${level.toUpperCase()}` : level.toUpperCase());
}

let camBaseFov = 64;
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camBaseFov = camera.aspect < 0.8 ? 76 : 64; // keep all three lanes in frame on portrait phones
  camera.fov = camBaseFov;
  camera.updateProjectionMatrix();
  applyQuality();
}

// ground + distant skyline backdrop (not fogged, follows the camera sideways only)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x120a24, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.03, -100);
scene.add(ground);
const skyline = new THREE.Mesh(new THREE.PlaneGeometry(720, 360), new THREE.MeshBasicMaterial({ fog: false, depthWrite: false }));
skyline.position.set(0, 110, -330);
skyline.renderOrder = -1;
scene.add(skyline);

// ---------------------------------------------------------------- the scrolling world
// Everything that scrolls (road, scenery, obstacles, coins, pickups, gates) lives in `world` at a
// fixed local z. Only world.position.z moves (= distance travelled), so static scenery never
// needs per-frame updates and can be instanced. Scene z of a local z: local + G.dist.
const world = new THREE.Group();
scene.add(world);
const pools = new PoolSet(world);
const scenery = new Scenery(pools, { low: isTouch });
const coinPool = new InstancePool(coinGeometry(), coinMaterial(), 256, { name: 'coins' });
world.add(coinPool.mesh);

// ============================================================ actors + effects
const naz = createNaz();
scene.add(naz);
const trail = createTrail();
naz.add(trail);
const liq = createLiq();
liq.position.set(5, 2, 30);
scene.add(liq);
const eazy = createEazy();
eazy.position.set(-10, 1, -6);
scene.add(eazy);
const fx = new Effects(scene);
[naz, liq, eazy].forEach((c) => applyEnv(c));
const nazAnim = new NazAnimator();

// ============================================================ helpers
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LANE_NAMES = ['LEFT', 'MIDDLE', 'RIGHT'];
const SIDES = [-1, 1];

// clone-from-template cache so geometries/materials are shared between instances
const templates = new Map();
function fromTemplate(key, factory) {
  if (!templates.has(key)) templates.set(key, factory());
  const t = templates.get(key);
  return t.obj ? { ...t, obj: t.obj.clone(true) } : t.clone(true);
}

const STORY_TOTAL = DISTRICTS.reduce((s, d) => s + d.length, 0);
const BOUNDARIES = DISTRICTS.reduce((acc, d, i) => { acc.push((acc[i - 1] || 0) + d.length); return acc; }, []);
const FINALE_TIME = 3.4;

// ============================================================ game state
const G = {
  state: 'menu', mode: 'story', practice: false, runId: 0,
  dist: 0, startDist: 0, time: 0, runTime: 0, speed: 15, coins: 0,
  districtIdx: 0,
  player: { lane: 1, prevLane: 1, x: 0, prevX: 0, vx: 0, y: 0, vy: 0, ground: 0, slide: 0, jumpBuf: 0, invuln: 0, dead: false, air: false },
  liqChase: 0, heartbeat: 0,
  power: { shield: 0, magnet: 0, leverage: 0, intel: 0 },
  obstacles: [], coinsArr: [], pickups: [], scenery: [], roads: [], specials: [],
  rowCursor: 0, prevRow: [null, null, null], prevCoinLane: 1, tutIdx: 0,
  sceneryCursor: { L: 0, R: 0, lamp: 0, sign: 0 },
  tipTimer: 12, deathTimer: 0, deathKind: null, redAlert: 0,
  eazyT: 0, lastTip: null, finaleT: 0, confettiT: 0,
  spawnedGates: new Set(), hintsSeen: new Set(),
};
const lane = new LaneMotion(0); // authoritative lateral movement: collisions use lane.x
try { if (localStorage.getItem('hb_tut_done') === '1') ['jump', 'slide', 'right'].forEach((h) => G.hintsSeen.add(h)); } catch {}

const localZ = (sz) => sz - G.dist;

function districtIndexAt(d) {
  if (G.mode === 'endless') return Math.floor(Math.max(0, d) / 1000) % DISTRICTS.length;
  for (let i = 0; i < BOUNDARIES.length; i++) if (d < BOUNDARIES[i]) return i;
  return DISTRICTS.length - 1;
}
const districtAt = (d) => DISTRICTS[districtIndexAt(d)];

function speedAt(d) {
  if (G.mode === 'endless') return Math.min(ENDLESS.speedMax, ENDLESS.speedStart + d * ENDLESS.rampPerMeter);
  const i = districtIndexAt(d), di = DISTRICTS[i];
  return lerp(di.speed[0], di.speed[1], clamp((d - (BOUNDARIES[i - 1] || 0)) / di.length, 0, 1));
}

// ============================================================ road + scenery (instanced props)
const SEG_LEN = 20;
function buildRoad() {
  for (const r of G.roads) scenery.removeProp(r);
  G.roads = [];
  for (let z = DESPAWN_Z; z > SPAWN_Z - 50; z -= SEG_LEN) G.roads.push(scenery.road(districtAt(G.dist - z), localZ(z)));
}

function spawnScenery(dz) {
  const c = G.sceneryCursor;
  const far = SPAWN_Z - 15;
  for (let k = 0; k < 2; k++) {
    const side = k ? 'R' : 'L', s = SIDES[k];
    c[side] += dz;
    while (c[side] > far) {
      const p = scenery.building(districtAt(G.dist - c[side]), s, localZ(c[side]), Math.random);
      G.scenery.push(p);
      c[side] -= p.halfDepth * 2 + rand(0.6, 3);
    }
  }
  c.lamp += dz;
  while (c.lamp > far) {
    const theme = districtAt(G.dist - c.lamp), lz = localZ(c.lamp);
    for (const s of SIDES) G.scenery.push(theme.edge === 'trench' ? scenery.trenchWall(s, lz) : scenery.lamp(theme, s, lz));
    if (theme.id === 'bull') {
      const s = Math.random() < 0.5 ? -1 : 1;
      G.scenery.push(Math.random() < 0.5 ? scenery.greenCandle(s, lz - 9, Math.random) : scenery.coinPile(s, lz - 9));
    }
    c.lamp -= 18;
  }
  c.sign += dz;
  while (c.sign > far) {
    G.scenery.push(scenery.sign(districtAt(G.dist - c.sign), Math.random() < 0.5 ? -1 : 1, localZ(c.sign), Math.random, world));
    c.sign -= rand(26, 44);
  }
}

function addSpecial(obj, z, halfDepth) {
  obj.position.z = localZ(z);
  world.add(obj);
  G.specials.push({ obj, halfDepth });
}

// ============================================================ obstacles, coins, pickups
const scamMat = SCAM_MAT();
function makeObstacle(type, len) {
  if (type === 'fud') return fromTemplate('fud', createFud);
  if (type === 'bar') return fromTemplate('bar', createBar);
  if (type === 'airdrop') return fromTemplate('airdrop', createAirdrop);
  if (type === 'rug') return fromTemplate('rug', createRug);
  return fromTemplate(`crash${len}${type === 'crashMoving' ? 'm' : ''}`, () => createCrash(len, type === 'crashMoving'));
}
function addObstacle(type, laneIdx, z, len) {
  const o = makeObstacle(type, len);
  o.kind = type === 'crashMoving' ? 'crash' : type;
  o.moving = type === 'crashMoving';
  o.lane = laneIdx;
  o.dead = false; o.yOff = 0;
  o.obj.position.set(LANES[laneIdx], 0, localZ(z - o.hit.len / 2));
  if (type === 'airdrop') {
    o.crate = o.obj.children[0];
    o.chute = o.crate.getObjectByName('chute'); o.lines = o.crate.getObjectByName('lines');
    o.label = o.crate.getObjectByName('label'); o.bait = o.crate.getObjectByName('bait');
    o.drop = airdropState(); // descending → landing → landed
  }
  if (type === 'rug') o.rug = o.obj.getObjectByName('rug');
  if (o.moving) o.warn = o.obj.children.filter((c) => c.name === 'warn');
  o.marker = createIntelMarker();
  o.obj.add(o.marker);
  world.add(o.obj);
  G.obstacles.push(o);
  return o;
}
const obsZ = (o) => o.obj.position.z + G.dist;

// is (lane, y, scene z) free of every obstacle volume (with a margin)?
function spotClear(laneIdx, y, z, margin = 0.8) {
  for (const o of G.obstacles) {
    if (o.lane !== laneIdx) continue;
    const hl = o.hit.len / 2, oz = obsZ(o);
    if (z > oz + hl + margin || z < oz - hl - margin) continue;
    if (o.hit.pit) continue; // coins may float over pits (that's the bait)
    if (y < o.hit.yMax + 0.45 && y > o.hit.yMin - 0.45) return false;
  }
  for (const p of G.pickups) if (Math.abs(p.position.x - LANES[laneIdx]) < 1 && Math.abs(p.position.z + G.dist - z) < 2.5) return false;
  return true;
}

const spawnStats = { coins: 0, rows: 0, obstacles: 0, hard: 0 };
// coins are plain records drawn by one InstancedMesh (1 draw call for all of them)
function addCoin(x, y, z) {
  const c = { x, y, z: localZ(z), ry: Math.random() * 6, magnet: false, h: null };
  c.h = coinPool.add(x, y, c.z, 0, c.ry, 0);
  if (!c.h) return;
  spawnStats.coins++;
  G.coinsArr.push(c);
}

function addPickup(kind, laneIdx, z, y = 1.2) {
  const p = kind === 'bag' ? fromTemplate('bag', createBag) : fromTemplate('pu-' + kind, () => createPowerup(kind, POWERUPS[kind].color));
  p.position.set(LANES[laneIdx], y, localZ(z));
  p.userData.kind = kind;
  p.userData.baseY = y;
  p.userData.core = p.children[0];
  world.add(p);
  G.pickups.push(p);
}

function spawnRow(z, gap) {
  const rowDist = G.dist - z;
  const di = districtIndexAt(rowDist);
  const d = DISTRICTS[di];
  const speed = speedAt(rowDist) + 1;

  // story: breathing room around each district gate and the finish
  if (G.mode === 'story') {
    for (const b of BOUNDARIES) {
      if (rowDist > b - 30 && rowDist < b + 50) {
        if (rowDist < b) for (let i = 0; i < 4; i++) addCoin(LANES[1], 0.9, z - i * 3.2);
        G.prevRow = [null, null, null]; G.prevCoinLane = 1;
        return;
      }
    }
  }

  let row;
  if (G.mode === 'story' && G.startDist === 0 && G.tutIdx < TUTORIAL.length) {
    const t = TUTORIAL[G.tutIdx++];
    row = t.lanes.map((type) => (type ? { type, len: type === 'crash' ? 6 : OBSTACLE_LEN[type], hint: t.hint } : null));
  } else {
    const prog = G.mode === 'endless' ? clamp(rowDist / 3000, 0, 1) : clamp((rowDist - (BOUNDARIES[di - 1] || 0)) / d.length, 0, 1);
    const difficulty = G.mode === 'endless' ? 0.3 + prog * 0.7 : di * 0.33 + prog * 0.3;
    row = planRow({ prev: G.prevRow, pool: d.pool, difficulty, gap, speed });
  }
  spawnStats.rows++;
  for (let l = 0; l < 3; l++) {
    const r = row[l];
    if (!r) continue;
    spawnStats.obstacles++; if (r.type.startsWith('crash')) spawnStats.hard++;
    addObstacle(r.type, l, z, r.len).hint = r.hint;
  }

  // coins: designed patterns, validated against obstacles
  const plan = planCoins({ prev: G.prevRow, row, prevCoinLane: G.prevCoinLane, speed });
  for (const c of plan.coins) {
    const cz = z + c.dz;
    if (spotClear(c.lane, c.y, cz)) addCoin(LANES[c.lane], c.y, cz);
  }
  G.prevCoinLane = plan.lane;

  // power-ups (rare) and $HB bags (rarer, placed on top of a crate = risk/reward)
  const free = [0, 1, 2].filter((l) => !row[l] && l !== plan.lane);
  const runDist = rowDist - G.startDist;
  if (runDist > 150 && free.length && Math.random() < 0.06) {
    const l = pick(free);
    if (spotClear(l, 1.2, z - 6)) addPickup(pick(Object.keys(POWERUPS)), l, z - 6);
  } else if (runDist > 250 && Math.random() < 0.05) {
    const crateLane = [0, 1, 2].find((l) => row[l] && row[l].type === 'airdrop');
    if (crateLane !== undefined) addPickup('bag', crateLane, z - row[crateLane].len / 2, 1.15);
  }
  G.prevRow = row;
}

function spawnSpecials() {
  if (G.mode !== 'story') return;
  for (let i = 0; i < BOUNDARIES.length; i++) {
    const z = -(BOUNDARIES[i] - G.dist);
    if (z > SPAWN_Z - 30 && !G.spawnedGates.has(i)) {
      G.spawnedGates.add(i);
      const last = i === BOUNDARIES.length - 1;
      addSpecial(fromTemplate('gate-' + i, () => createGate(gateTitle(i), last ? 0xffd23c : DISTRICTS[i + 1].neon[0])), z, 1);
      if (last) addSpecial(fromTemplate('bull', makeBull), z - 38, 6);
    }
  }
}
const gateTitle = (i) => (i === BOUNDARIES.length - 1 ? 'FINISH · GOLDEN BULL' : `${DISTRICTS[i + 1].name} →`);
const makeBull = () => { const bull = createBull(); applyEnv(bull, 1); return bull; };

// ============================================================ run lifecycle
function clearWorld() {
  for (const o of G.obstacles) world.remove(o.obj);
  for (const p of G.pickups) world.remove(p);
  for (const s of G.specials) world.remove(s.obj);
  for (const p of G.scenery) scenery.removeProp(p);
  for (const r of G.roads) scenery.removeProp(r);
  pools.clear();
  coinPool.clear();
  G.obstacles = []; G.coinsArr = []; G.pickups = []; G.scenery = []; G.roads = []; G.specials = [];
  fx.clear();
}

function resetRun(mode, startDistrict = 0) {
  clearWorld();
  G.mode = mode;
  G.practice = startDistrict > 0;
  G.startDist = mode === 'story' ? (BOUNDARIES[startDistrict - 1] || 0) : 0;
  G.dist = G.startDist; G.runTime = 0; G.coins = 0;
  G.districtIdx = districtIndexAt(G.dist);
  G.speed = speedAt(G.dist);
  Object.assign(G.player, { lane: 1, prevLane: 1, x: 0, prevX: 0, vx: 0, y: 0, vy: 0, ground: 0, slide: 0, jumpBuf: 0, invuln: 0, dead: false, air: false });
  lane.snap(0);
  G.liqChase = 0; G.heartbeat = 0;
  for (const k in G.power) G.power[k] = 0;
  G.rowCursor = -45; G.prevRow = [null, null, null]; G.prevCoinLane = 1; G.tutIdx = 0;
  G.sceneryCursor = { L: DESPAWN_Z + 6, R: DESPAWN_Z + 6, lamp: DESPAWN_Z, sign: -10 };
  G.spawnedGates = new Set(BOUNDARIES.map((b, i) => (b <= G.dist ? i : -1)));
  G.tipTimer = mode === 'story' && startDistrict === 0 ? 30 : 18;
  G.deathTimer = 0; G.deathKind = null; G.redAlert = 0;
  G.eazyT = 0; G.lastTip = null; G.finaleT = 0;
  naz.rotation.set(0, 0, 0); naz.position.set(0, 0, 0);
  naz.visible = true;
  naz.userData.shield.visible = false;
  liqRig.reset(5, 2, 30); liqPressure = 0;
  eazyRig.reset(-10, 1, -6); eazyTalk = 0;
  stepper.reset();
  resetCoinCombo();
  applyTheme(DISTRICTS[G.districtIdx], true);
  buildRoad();
  spawnScenery(0);
  world.position.z = G.dist;
  ui.resetHud(G.mode, BOUNDARIES, STORY_TOTAL);
}

let themeFrom = new THREE.Color(), themeTo = new THREE.Color(), themeT = 1;
const baseFog = new THREE.Color();
const _col = new THREE.Color();
function applyTheme(d, instant = false) {
  themeFrom.copy(baseFog.getHex() ? baseFog : scene.fog.color);
  themeTo.set(d.fog);
  themeT = instant ? 1 : 0;
  if (instant) baseFog.copy(themeTo);
  const top = '#' + _col.set(d.sky).getHexString();
  const bottom = '#' + _col.set(d.fog).getHexString();
  scene.background = skyTexture(top, bottom);
  const bld = '#' + _col.set(d.building[0]).multiplyScalar(0.55).getHexString();
  skyline.material.map = skylineTexture(d.id, top, bottom, bld, d.windows, d.skyline);
  skyline.material.needsUpdate = true;
  ground.material.color.set(d.sky).multiplyScalar(0.6);
}

let cancelCountdown = null;
function startRun(mode, startDistrict = 0) {
  initAudio();
  keyboard.clear();
  // the name field or a focused menu button must not keep the keyboard: hand it to the game
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === 'function') active.blur();
  cancelCountdown?.();
  const run = ++G.runId;
  resetRun(mode, startDistrict);
  ui.showScreen(null);
  ui.showHud(true);
  G.state = 'countdown';
  stopMusic();
  startMusic(G.districtIdx);
  cancelCountdown = ui.countdown(() => {
    if (run !== G.runId) return;
    G.state = 'running';
    if (document.hidden) { togglePause(true); return; }
    const d = DISTRICTS[G.districtIdx];
    if (mode === 'story') {
      ui.banner(`DISTRICT ${G.districtIdx + 1} / 3`, d.name, d.tagline);
      say('eazy', d.eazyIntro, 3200);
    } else {
      ui.banner('ENDLESS', 'BULL RUN', 'How far can you ride it?');
      say('eazy', 'Bull Run. Skill only. Top of the board gets the glory.', 3000);
    }
  });
}

// run-scoped timeout: never fires into a later run
function later(ms, fn) { const run = G.runId; setTimeout(() => { if (run === G.runId && G.state === 'running') fn(); }, ms); }

function say(who, text, ms) {
  ui.say(who, text, ms);
  if (who === 'eazy') G.eazyT = ms / 1000;
}

function enterDistrict(i) {
  const d = DISTRICTS[i];
  G.districtIdx = i;
  applyTheme(d);
  setMusicLevel(Math.min(i, 2));
  sfx.district();
  ui.districtFlash(d.neon[0]);
  camKick(0, 0.6); // a gentle FOV breath through the gate
  if (G.mode === 'story') {
    ui.banner(`DISTRICT ${i + 1} / 3`, d.name, d.tagline);
    say('eazy', d.eazyIntro, 3000);
    if (d.liqIntro) later(3400, () => say('liq', d.liqIntro, 2600));
  } else {
    ui.banner(`LAP ${Math.floor(G.dist / 1000) + 1}`, d.name, `Speed ×${(G.speed / ENDLESS.speedStart).toFixed(1)}`);
  }
}

function die(kind) {
  if (G.player.dead || G.state !== 'running') return;
  G.player.dead = true;
  G.deathKind = kind;
  G.state = 'dying';
  G.deathTimer = 1.3;
  camKick(1.2);
  nazAnim.hit(1);
  sfx.die();
  ui.flash('#ff2d55');
}

function finishDeath() {
  G.state = 'dead';
  stopMusic();
  const score = calcScore();
  const [title, sub] = DEATH_LINES[G.deathKind] || DEATH_LINES.crash;
  const dist = Math.floor(G.dist - G.startDist);
  const best = G.practice ? false : ui.saveScore(G.mode, score, G.coins, dist);
  const badTip = G.lastTip && G.lastTip.wrong && G.time - G.lastTip.at < 8;
  ui.gameOver({
    title, sub, score, coins: G.coins, dist, best,
    img: G.deathKind === 'liq' ? 'liq' : 'eazy',
    eazy: (badTip ? `“${pick(EAZY_BAD_TIP)}”` : pick(EAZY_DEATH)) + ' — Eazy',
    checkpoint: G.mode === 'story' && G.districtIdx > 0 ? { idx: G.districtIdx, name: DISTRICTS[G.districtIdx].name } : null,
    practice: G.practice,
  });
}

function startFinale() {
  G.state = 'finale';
  G.finaleT = 0;
  G.finaleSpeed = G.speed;
  G.liqChase = 0;
  for (const o of G.obstacles) { o.dead = true; if (obsZ(o) > -70) o.obj.visible = false; }
  stopMusic();
  sfx.win();
  ui.showHud(false);
  ui.banner('YOU MADE IT', 'BULL CITY', 'The golden bull is yours.');
  ui.say('liq', 'This isn’t over, Naz…', 2400);
}

function win() {
  G.state = 'won';
  const score = calcScore();
  const dist = Math.floor(G.dist - G.startDist);
  const best = G.practice ? false : ui.saveScore('story', score, G.coins, dist);
  ui.victory({ score, coins: G.coins, time: G.runTime, practice: G.practice, best });
}

const calcScore = () => Math.floor(G.dist - G.startDist) + G.coins * 10;

// ============================================================ input
function laneMove(dir) {
  if (G.state !== 'running') return;
  const p = G.player;
  const nl = clamp(p.lane + dir, 0, 2);
  if (nl === p.lane) { camKick(0.15); return; } // nudging the wall: no penalty
  p.prevLane = p.lane;
  p.lane = nl;
  lane.setTarget(LANES[nl]);
  sfx.lane();
}
function jump() {
  if (G.state !== 'running') return;
  G.player.jumpBuf = 0.16; // buffered: pressing slightly before landing still jumps
}
function slide() {
  if (G.state !== 'running') return;
  const p = G.player;
  if (p.y > p.ground + 0.05) p.vy = Math.min(p.vy, -24); // slam down
  p.slide = SLIDE_TIME;
  p.jumpBuf = 0;
  sfx.slide();
}

// Keyboard: one set of listeners for the whole session (restarts never add more). Mapping and
// consume/ignore decisions live in src/input.js; game-state rules live here.
const keyboard = new KeyboardInput(
  { left: () => laneMove(-1), right: () => laneMove(1), jump, slide, pause: () => togglePause() },
  (action) => (action === 'pause' ? G.state === 'running' || G.state === 'paused' : G.state === 'running'),
);
addEventListener('keydown', (e) => {
  if (isEditable(e.target)) { if (e.key === 'Enter') e.target.blur(); return; }
  if (keyboard.keydown(e)) e.preventDefault(); // only block scrolling when the game used the key
});
addEventListener('keyup', (e) => keyboard.keyup(e));
addEventListener('blur', () => keyboard.clear());

// swipes: one action per finger contact (see SwipeInput in src/input.js)
const canvas = renderer.domElement;
const swipe = new SwipeInput(
  { left: () => laneMove(-1), right: () => laneMove(1), jump, slide },
  () => G.state === 'running',
);
addEventListener('touchstart', (e) => {
  if (G.state !== 'running') return;
  const t = e.changedTouches[0];
  swipe.start(t.identifier, t.clientX, t.clientY);
}, { passive: true });
addEventListener('touchmove', (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) { const t = e.changedTouches[i]; swipe.move(t.identifier, t.clientX, t.clientY); }
}, { passive: true });
addEventListener('touchend', () => swipe.end());
addEventListener('touchcancel', () => swipe.end());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function togglePause(force) {
  keyboard.clear();
  if (G.state === 'running' && force !== false) { G.state = 'paused'; ui.showScreen('pause'); stopMusic(); }
  else if (G.state === 'paused' && force !== true) { ui.showScreen(null); G.state = 'running'; startMusic(G.districtIdx); clock.getDelta(); stepper.reset(); }
}
// hidden tab: pause; on return the clock delta is discarded so nothing "catches up"
document.addEventListener('visibilitychange', () => { keyboard.clear(); if (document.hidden) togglePause(true); else { clock.getDelta(); stepper.reset(); } });

// ============================================================ gameplay
function stumble() {
  const p = G.player;
  if (p.invuln > 0) return;
  sfx.stumble();
  camKick(0.7);
  nazAnim.hit(p.x < LANES[p.lane] ? -1 : 1);
  p.invuln = 0.6;
  ui.flash('#2f7dff');
  if (G.liqChase > 0) { die('liq'); return; }
  G.liqChase = STUMBLE_WINDOW;
  if (G.lastTip && G.lastTip.wrong && G.time - G.lastTip.at < 6) say('eazy', pick(EAZY_BAD_TIP), 2200);
  else ui.say('liq', pick(LIQ_TAUNTS), 2200);
}

function hit(o) {
  const p = G.player;
  if (p.invuln > 0) return;
  if (G.power.shield > 0) {
    G.power.shield = 0;
    p.invuln = 1;
    o.obj.visible = false; o.dead = true;
    sfx.shieldPop();
    camKick(0.6);
    nazAnim.hit(1);
    fx.ring(p.x, p.y + 1, 0, 0x29e6ff, 0.45);
    fx.spark(p.x, p.y + 1.2, -0.5, { color: 0x29e6ff, count: 8, speed: 4, essential: true });
    ui.flash('#29e6ff');
    say('eazy', 'DIAMOND HANDS! Told you, bro.', 1800);
    return;
  }
  die(o.kind);
}

function collect(kind, x, y, z) {
  if (kind === 'bag') {
    G.coins += 10 * (G.power.leverage > 0 ? 2 : 1);
    sfx.bag();
    fx.spark(x, y, z, { count: 10, speed: 3.5, size: 0.7 });
    ui.bumpCoins(true);
    nazAnim.collect();
    return;
  }
  G.power[kind] = POWERUPS[kind].time;
  sfx.power();
  nazAnim.power();
  camKick(0, 1);
  fx.ring(G.player.x, G.player.y + 0.6, 0, POWERUPS[kind].color);
  fx.spark(x, y, z, { color: POWERUPS[kind].color, count: 8, speed: 3 });
  ui.flash('#' + POWERUPS[kind].color.toString(16).padStart(6, '0'), 0.35);
  if (kind === 'intel') say('eazy', 'Alpha leak: green arrows = trouble.', 2400);
}

const BASE_H = 1.75, SLIDE_H = 0.75, PW = 0.4;

function updatePlayer(dt) {
  const p = G.player;
  p.prevX = p.x;
  p.x = lane.step(dt);
  p.vx = lane.v;

  // ground height: you can land on top of crates / barriers
  let ground = 0;
  for (const o of G.obstacles) {
    if (o.dead || o.hit.pit || o.kind === 'bar' || o.kind === 'crash') continue;
    const oz = obsZ(o), hl = o.hit.len / 2;
    if (Math.abs(p.x - o.obj.position.x) < o.hit.hw + PW * 0.5 && oz - hl < 0.3 && oz + hl > -0.3) {
      const top = o.yOff + o.hit.yMax;
      if (p.y >= top - 0.15) ground = Math.max(ground, top);
    }
  }
  p.ground = ground;

  if (p.jumpBuf > 0) {
    p.jumpBuf -= dt;
    if (p.y <= p.ground + 0.02) { p.vy = JUMP_V; p.slide = 0; p.jumpBuf = 0; sfx.jump(); nazAnim.takeoff(); }
  }
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y <= p.ground) {
    if (p.air && p.vy < -6) {
      sfx.land(); nazAnim.land(p.vy); camKick(Math.min(0.5, -p.vy * 0.025));
      fx.spark(p.x, p.ground + 0.2, 0.3, { color: 0x29e6ff, count: 4, speed: 2.2 });
    }
    p.y = p.ground; p.vy = 0;
  }
  p.air = p.y > p.ground + 0.05;
  if (p.slide > 0) p.slide -= dt;
  if (p.invuln > 0) p.invuln -= dt;
}

function updateObstacles(dt, dz) {
  const p = G.player;
  const h = p.slide > 0 ? SLIDE_H : BASE_H;
  for (let i = G.obstacles.length - 1; i >= 0; i--) {
    const o = G.obstacles[i];
    const pos = o.obj.position;
    const prevZ = pos.z + G.dist - dz; // scene z before this step
    if (o.moving && prevZ > -45) {
      if (!o.activated) {
        o.activated = true;
        sfx.dump();
        G.redAlert = 1;
        if (Math.random() < 0.5) say('eazy', pick(DUMP_LINES), 1600);
      }
      pos.z += 8 * dt; // the DUMP candle slides toward you on top of the scroll
    }
    const z = pos.z + G.dist;
    o.marker.visible = G.power.intel > 0 && z < -4;
    if (o.marker.visible) o.marker.position.y = 4.4 + Math.sin(G.time * 8) * 0.25;
    if (o.warn) { const on = Math.sin(G.time * 18) > 0; o.warn[0].visible = on; o.warn[1].visible = !on; }

    // tutorial prompts the first time each move is needed
    if (o.hint && !G.hintsSeen.has(o.hint) && z > -26 && G.state === 'running') {
      G.hintsSeen.add(o.hint);
      ui.hint(o.hint, isTouch);
      if (G.hintsSeen.size >= 3) { try { localStorage.setItem('hb_tut_done', '1'); } catch {} }
    }

    // per-type animation
    if (o.crate) {
      const st = airdropStep(o.drop, z, dt);
      o.crate.position.y = st.y;
      o.yOff = st.y; // collision height: identical to the old fall curve, 0 once landed
      if (st.phase === 'descending') {
        o.crate.rotation.z = Math.sin(G.time * 3 + i) * 0.1; // hanging sway
      } else {
        o.crate.rotation.z = approach(o.crate.rotation.z, 0, 14, dt); // settle level, no snap
        if (o.chute.visible) {
          // canopy deflates and drops onto the crate, ropes go slack, crate squashes a touch
          const c = st.collapse;
          o.chute.scale.set(1 + 0.35 * c, 0.75 * (1 - c) + 0.02, 1 + 0.35 * c);
          o.chute.position.y = 3.15 - 2.0 * c;
          o.lines.scale.y = Math.max(0.02, 1 - c);
          o.crate.scale.y = 1 - 0.07 * st.settle; // visual only: the hitbox is untouched
          if (st.phase === 'landed') { o.chute.visible = false; o.lines.visible = false; o.crate.scale.y = 1; }
        }
      }
      if (st.y < 2.5 && !o.revealed) { o.revealed = true; o.label.material = scamMat; o.bait.visible = false; }
    } else if (o.rug && z > -20) {
      o.rug.position.x += dt * 15;
      o.rug.position.y += dt * 4;
      o.rug.rotation.z -= dt * 2.4;
      o.pulled = true;
      if (o.rug.position.y > 6) o.rug.visible = false;
    }

    if (z - o.hit.len / 2 > DESPAWN_Z) { world.remove(o.obj); G.obstacles.splice(i, 1); continue; }
    if (o.dead || p.dead || G.state !== 'running') continue;

    // --- collision (player sits at scene z = 0; uses the authoritative lane position p.x)
    const hl = o.hit.len / 2;
    if (!(z - hl < 0.3 && z + hl > -0.3)) continue;
    const reach = o.hit.hw + PW;
    if (Math.abs(p.x - pos.x) >= reach) continue;

    if (o.hit.pit) {
      // only fatal once the rug is gone and you're actually over the hole
      if (o.pulled && p.y <= 0.02 && Math.abs(p.x - pos.x) < o.hit.hw && p.invuln <= 0) {
        if (G.power.shield > 0) {
          G.power.shield = 0; p.invuln = 1; p.vy = JUMP_V; p.y = 0.05; nazAnim.takeoff();
          sfx.shieldPop(); ui.flash('#29e6ff'); say('eazy', 'Diamond hands saved you from the rug!', 1800);
        } else die('rug');
      }
      continue;
    }
    const yMin = o.yOff + o.hit.yMin, yMax = o.yOff + o.hit.yMax;
    if (!(p.y < yMax - 0.05 && p.y + h > yMin)) continue;
    const prevZOver = prevZ - hl < 0.3 && prevZ + hl > -0.3;
    const prevXOver = Math.abs(p.prevX - pos.x) < reach;
    // only clipped the edge while changing lanes? forgiving: treat it as a side bump
    const edgeClip = lane.moving || Math.abs(p.prevX - p.x) > 1e-4 ? Math.abs(p.x - pos.x) > reach - 0.45 : false;
    if ((prevZOver && !prevXOver) || edgeClip) {
      // side bump: bounce back toward the previous lane, Liq closes in
      p.lane = p.prevLane;
      lane.bounce(p.prevX, LANES[p.prevLane]);
      p.x = p.prevX;
      stumble();
    } else {
      hit(o);
    }
  }
}

function updateCoins(dt) {
  const p = G.player;
  const magnet = G.power.magnet > 0;
  for (let i = G.coinsArr.length - 1; i >= 0; i--) {
    const c = G.coinsArr[i];
    let z = c.z + G.dist;
    if (magnet && !p.dead && z > -24 && z < 2) c.magnet = true;
    if (c.magnet) {
      const k = Math.min(1, dt * 10);
      c.x = lerp(c.x, p.x, k); c.y = lerp(c.y, p.y + 1, k); z = lerp(z, 0, k);
      c.z = z - G.dist;
    }
    const got = !p.dead && Math.abs(c.x - p.x) < 0.85 && Math.abs(z) < 0.8 && Math.abs(c.y - (p.y + 0.9)) < 1.2;
    if (got || z > DESPAWN_Z) {
      if (got) {
        G.coins += G.power.leverage > 0 ? 2 : 1;
        const e = coinPickup(G.time);
        fx.spark(c.x, c.y, z, { count: e && e.type === 'milestone' ? 8 : 2, size: 0.45, speed: 2 });
        if (e && e.type === 'milestone') { ui.combo(e.combo); fx.ring(p.x, p.y + 0.9, 0, 0xffd23c, 0.35); }
        nazAnim.collect();
        ui.bumpCoins();
      }
      coinPool.remove(c.h);
      G.coinsArr.splice(i, 1);
    }
  }
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const pu = G.pickups[i];
    const z = pu.position.z + G.dist;
    const got = !p.dead && Math.abs(pu.position.x - p.x) < 0.95 && Math.abs(z) < 0.9 && Math.abs(pu.position.y - (p.y + 0.9)) < 1.3;
    if (got || z > DESPAWN_Z) {
      if (got) collect(pu.userData.kind, pu.position.x, pu.position.y, z);
      world.remove(pu); G.pickups.splice(i, 1);
    }
  }
}

function updateScenery() {
  const gone = DESPAWN_Z + 10;
  for (let i = G.scenery.length - 1; i >= 0; i--) {
    const p = G.scenery[i];
    if (p.z - p.halfDepth + G.dist > gone) { scenery.removeProp(p); G.scenery[i] = G.scenery[G.scenery.length - 1]; G.scenery.pop(); }
  }
  for (let i = G.specials.length - 1; i >= 0; i--) {
    const s = G.specials[i];
    if (s.obj.position.z - s.halfDepth + G.dist > gone) { world.remove(s.obj); G.specials.splice(i, 1); }
  }
  // road segments recycle to the far end
  for (let i = 0; i < G.roads.length; i++) {
    const r = G.roads[i];
    if (r.z - SEG_LEN / 2 + G.dist > DESPAWN_Z) {
      const z = r.z - SEG_LEN * G.roads.length;
      scenery.removeProp(r);
      G.roads[i] = scenery.road(districtAt(-z), z);
    }
  }
}

// ============================================================ per-frame visuals
// Rendering extrapolates the last simulated state by the leftover accumulator time, so motion is
// smooth at any refresh rate. Collisions always use the simulated state.
const vis = { x: 0, y: 0 };
const nazIn = { dt: 0, time: 0, vx: 0, air: false, vy: 0, slide: false, speed: 0, mode: 'ride', leanScale: 1 };

function updateNaz(dt) {
  const p = G.player;
  naz.position.x = vis.x;
  const celebrate = G.state === 'finale' || G.state === 'won';
  const showcase = G.state === 'menu';
  nazIn.dt = dt; nazIn.time = G.time; nazIn.vx = G.state === 'running' ? p.vx : 0; nazIn.air = p.air; nazIn.vy = p.vy;
  nazIn.slide = p.slide > 0 && !p.air; nazIn.speed = G.state === 'running' ? G.speed : 6;
  nazIn.mode = showcase ? 'idle' : celebrate ? 'victory' : 'ride';
  nazIn.leanScale = reduceMotion ? 0.5 : 1;
  applyNazPose(naz, nazAnim.update(nazIn));
  if (p.dead) {
    // death: the rig keeps flailing (hit layer), the root tumbles
    if (G.deathKind === 'rug') { naz.position.y -= dt * 6; naz.rotation.x -= dt * 2.5; }
    else if (G.deathKind === 'liq') { naz.rotation.z += dt * 2; naz.position.y = approach(naz.position.y, 0.3, 3, dt); }
    else { naz.rotation.x = approach(naz.rotation.x, 1.2, 6, dt); naz.position.y = approach(naz.position.y, 0.2, 6, dt); }
    naz.visible = true;
    return;
  }
  naz.position.y = celebrate ? Math.abs(Math.sin(G.time * 5)) * 0.35 : vis.y;
  // turn to face the camera in the menu and at the finish
  const ry = showcase || celebrate ? Math.atan2(-(camera.position.x - vis.x), -camera.position.z) + (showcase ? 0.45 : 0.2) : 0;
  naz.rotation.y = approach(naz.rotation.y, ry, 5, dt);
  naz.rotation.x = 0; naz.rotation.z = 0;
  const sh = naz.userData.shield;
  sh.visible = G.power.shield > 0;
  if (sh.visible) sh.material.opacity = 0.12 + Math.sin(G.time * 6) * 0.04 + (G.power.shield < 3 && Math.sin(G.time * 20) > 0 ? 0.08 : 0);
  naz.visible = p.invuln > 0 && G.state === 'running' ? Math.sin(G.time * 40) > -0.4 : true;
  // trail: length follows speed (+ a stretch while banking), colour follows the active power-up
  const tl = G.state === 'running' ? 1.2 + G.speed * 0.1 + Math.abs(p.vx) * 0.04 : celebrate ? 0.2 : 0.6;
  trail.scale.z = approach(trail.scale.z, tl, 6, dt);
  trail.visible = !celebrate && !showcase;
  trail.userData.mat.color.setHex(G.power.leverage > 0 ? 0xffd23c : G.power.magnet > 0 ? 0xff4fd8 : G.power.shield > 0 ? 0x9ff6ff : 0x29e6ff);
}

// spring-driven follower used for Liq and Eazy (organic swoops with slight overshoot)
function rig(freq, damping) {
  const s = { x: new Spring(freq, damping), y: new Spring(freq, damping), z: new Spring(freq, damping) };
  s.reset = (x, y, z) => { s.x.set(x); s.y.set(y); s.z.set(z); };
  s.step = (obj, dt, tx, ty, tz) => { obj.position.set(s.x.step(dt, tx), s.y.step(dt, ty), s.z.step(dt, tz)); };
  return s;
}
const liqRig = rig(0.9, 0.75);
const eazyRig = rig(1.1, 0.62);
let liqPressure = 0, eazyTalk = 0;

function updateLiq(dt) {
  liqPressure = approach(liqPressure, G.liqChase / STUMBLE_WINDOW, 4, dt);
  const pr = Math.min(1, liqPressure * 1.5);
  // flanks Naz on the right, closer the more pressure there is; lunges when he's about to strike
  const lunge = Math.pow(Math.max(0, Math.sin(G.time * 2.4)), 6) * 1.6 * pr;
  let tx = vis.x * 0.4 + 4.3 - lunge * 0.4, ty = 2.6 + Math.sin(G.time * (2 + pr * 3)) * 0.2, tz = lerp(24, -1.5, pr) - lunge;
  if (G.player.dead && G.deathKind === 'liq') { tx = vis.x + 0.8; ty = 1.6; tz = 1.0; }
  if (G.state === 'finale' || G.state === 'won') { tx = 10; ty = 9; tz = -40; }
  if (G.state === 'menu') tz = 30;
  liqRig.step(liq, dt, tx, ty, tz);
  // always face the camera (3/4) so his face, not his back, sells the threat
  liq.rotation.y = approach(liq.rotation.y, Math.atan2(-(camera.position.x - liq.position.x), -(camera.position.z - liq.position.z)) - 0.3, 4, dt);
  animateLiq(liq, G.time, liqPressure);
  liq.visible = liq.position.z < 22;
}

function updateEazy(dt) {
  const show = G.eazyT > 0 || G.state === 'won' || G.state === 'finale';
  if (G.eazyT > 0) G.eazyT -= dt;
  eazyTalk = approach(eazyTalk, G.eazyT > 0 ? 1 : 0, 6, dt);
  let tx = show ? -3.4 : -11, ty = 1.5, tz = -6;
  if (G.state === 'finale' || G.state === 'won') { tx = -2.6; ty = 0.6; tz = -3.5; }
  eazyRig.step(eazy, dt, tx, ty, tz);
  // models face -z: turn toward the camera with a slight 3/4 angle
  eazy.rotation.y = Math.atan2(-(camera.position.x - eazy.position.x), -(camera.position.z - eazy.position.z)) + 0.35;
  eazy.visible = eazy.position.x > -10;
  if (eazy.visible) animateEazy(eazy, G.time, eazyTalk, eazyRig.x.vel);
}

// ---------------------------------------------------------------- camera rig
// Springs instead of random shake: impact is a short damped bob, lane changes get a small lead
// and roll, the FOV breathes with speed. prefers-reduced-motion disables kicks, roll and FOV
// breathing.
const cam = { x: new Spring(2.6, 0.95), y: new Spring(2.2, 1), impact: new Spring(6, 0.35), fov: new Spring(1.5, 1), roll: 0 };
const camLook = new THREE.Vector3(0, 1.3, -8);
const _pos = new THREE.Vector3(), _look = new THREE.Vector3();
function camKick(strength, fovKick = 0) {
  if (reduceMotion) return;
  if (strength) cam.impact.impulse(-strength * 2.2);
  if (fovKick) cam.fov.impulse(fovKick * 75); // ≈3° peak for a power-up
}
function updateCamera(dt) {
  const p = G.player;
  const followPlayer = G.state === 'running' || G.state === 'dying' || G.state === 'countdown' || G.state === 'paused' || G.state === 'dead';
  let k = 2.2;
  if (G.state === 'menu') {
    const portrait = camera.aspect < 0.8;
    _pos.set(portrait ? 0 : 1.1, portrait ? 2.0 : 1.7, portrait ? -5.4 : -4.4);
    _look.set(portrait ? 0 : 1.75, portrait ? 1.5 : 1.3, 0);
  } else if (G.state === 'finale' || G.state === 'won') {
    _pos.set(vis.x + 4.2, 2.0, 2.6);
    _look.set(vis.x - 1.2, 2.3, -8);
  } else {
    // anticipation: lean the framing a little toward the lane being moved into
    const lead = (lane.target - vis.x) * 0.18;
    _pos.set(vis.x * 0.55 + lead, 3.5 + vis.y * 0.35, 7.2);
    _look.set(vis.x * 0.6 + lead * 1.4, 1.3 + vis.y * 0.25, -8);
    k = 6;
  }
  const imp = cam.impact.step(dt, 0);
  if (followPlayer && G.state !== 'countdown') {
    camera.position.x = cam.x.step(dt, _pos.x);
    camera.position.y = cam.y.step(dt, _pos.y) + imp * 4; // death ≈ 0.28 m dip, stumble ≈ 0.16 m
  } else {
    camera.position.x = approach(camera.position.x, _pos.x, k, dt); cam.x.set(camera.position.x);
    camera.position.y = approach(camera.position.y, _pos.y, k * 0.7, dt); cam.y.set(camera.position.y);
  }
  camera.position.z = approach(camera.position.z, _pos.z, k * 0.7, dt);
  camLook.set(approach(camLook.x, _look.x, k, dt), approach(camLook.y, _look.y, k, dt), approach(camLook.z, _look.z, k, dt));
  camera.lookAt(camLook);
  // small roll into lane changes (applied after lookAt)
  cam.roll = approach(cam.roll, reduceMotion || G.state !== 'running' ? 0 : -p.vx * 0.0016, 10, dt);
  camera.rotateZ(cam.roll + imp * 0.5); // hard impacts add a brief, damped roll
  // FOV: base + gentle speed breathing + kicks
  const breathe = reduceMotion || G.state !== 'running' ? 0 : clamp((G.speed - 15) / 15, 0, 1) * 3;
  const fov = camBaseFov + breathe + (reduceMotion ? 0 : cam.fov.step(dt, 0));
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  key.position.set(camera.position.x - 1.5, camera.position.y + 3, camera.position.z + Math.sign(camera.position.z || 1) * 2);
  key.target.position.set(vis.x, 1, 0);
  skyline.position.x = camera.position.x * 0.9;
}

// ============================================================ simulation step (fixed 60 Hz)
const STEP = 1 / 60;
const stepper = new FixedStepper(STEP, 0.1, 6);

function simulate(dt) {
  if (G.state === 'running') {
    G.speed = speedAt(G.dist);
    const dz = G.speed * dt;
    G.dist += dz;
    G.runTime += dt;

    const di = districtIndexAt(G.dist);
    if (di !== G.districtIdx) enterDistrict(di);
    if (G.mode === 'story' && G.dist >= STORY_TOTAL) { startFinale(); return; }

    G.rowCursor += dz;
    for (;;) {
      const d = districtAt(G.dist - G.rowCursor);
      const prog = G.mode === 'endless' ? clamp(G.dist / 3000, 0, 1) : 0.5;
      const sp = speedAt(G.dist - G.rowCursor);
      const gap = lerp(d.rowGap[0], d.rowGap[1], prog) * (sp / 18) * 0.85;
      if (G.rowCursor - gap < SPAWN_Z) break;
      G.rowCursor -= gap;
      spawnRow(G.rowCursor, gap);
    }
    spawnScenery(dz);
    spawnSpecials();

    updatePlayer(dt);
    updateObstacles(dt, dz);
    updateCoins(dt);
    updateScenery();

    for (const k in G.power) {
      if (G.power[k] > 0) { G.power[k] = Math.max(0, G.power[k] - dt); if (G.power[k] === 0) sfx.powerEnd(); }
    }
    if (G.liqChase > 0) {
      G.liqChase = Math.max(0, G.liqChase - dt);
      G.heartbeat -= dt;
      if (G.heartbeat <= 0) { sfx.heartbeat(); G.heartbeat = 0.65; }
    }

    // Eazy chimes in, sometimes with a lane call (right most of the time)
    G.tipTimer -= dt;
    if (G.tipTimer <= 0) { G.tipTimer = rand(26, 38); eazyTip(); }
  } else if (G.state === 'finale') {
    G.finaleT += dt;
    G.speed = Math.max(0, G.finaleSpeed * (1 - G.finaleT / 1.6));
    const dz = G.speed * dt;
    G.dist += dz;
    updateObstacles(dt, dz);
    updateCoins(dt);
    updateScenery();
    G.player.vy -= GRAVITY * dt; G.player.y = Math.max(0, G.player.y + G.player.vy * dt);
    if (G.finaleT >= FINALE_TIME) win();
  }
}

function eazyTip() {
  let z0 = -Infinity;
  for (const o of G.obstacles) { const z = obsZ(o); if (!o.dead && z < -40 && z > -75 && z > z0) z0 = z; }
  if (z0 > -Infinity && Math.random() < 0.5) {
    const blocked = [false, false, false];
    for (const o of G.obstacles) if (!o.dead && Math.abs(obsZ(o) - z0) < 2) blocked[o.lane] = true;
    const free = [0, 1, 2].filter((l) => !blocked[l]);
    const bl = [0, 1, 2].filter((l) => blocked[l]);
    if (free.length && bl.length) {
      const right = Math.random() < EAZY_LANE_TIP.chance;
      say('eazy', pick(EAZY_LANE_TIP.lines).replace('{lane}', LANE_NAMES[right ? pick(free) : pick(bl)]), 2600);
      G.lastTip = { wrong: !right, at: G.time };
      return;
    }
  }
  say('eazy', pick(EAZY_TIPS), 2600);
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
function updateCoinVisuals(dt) {
  for (const c of G.coinsArr) {
    c.ry += dt * 3.5;
    _q.setFromEuler(_e.set(0, c.ry, 0));
    coinPool.setMatrix(c.h, _m4.compose(_v.set(c.x, c.y, c.z), _q, _one));
  }
  for (let i = 0; i < G.pickups.length; i++) {
    const pu = G.pickups[i];
    pu.userData.core.rotation.y += dt * 2.5;
    pu.position.y = pu.userData.baseY + Math.sin(G.time * 4 + i) * 0.15;
  }
}

const hud = { score: 0, dist: 0, coins: 0, district: '', endless: false, progress: 0, power: G.power, liq: 0 };
function frameVisuals(dt) {
  if (G.redAlert > 0) G.redAlert = Math.max(0, G.redAlert - dt * 0.7);
  if (G.state === 'dying') {
    G.deathTimer -= dt;
    if (G.deathTimer <= 0) finishDeath();
  }
  if (G.state === 'finale' || G.state === 'won') {
    G.confettiT -= dt;
    if (G.confettiT <= 0) { G.confettiT = 0.35; fx.confetti(G.player.x - 1, 2, -6, 10); }
  }
  // render-time extrapolation by the leftover accumulator time
  const scrolling = G.state === 'running' || G.state === 'finale';
  const tau = scrolling ? stepper.alpha * STEP : 0;
  const p = G.player;
  vis.x = p.x + (G.state === 'running' ? p.vx * tau : 0);
  vis.y = p.air ? Math.max(p.ground, p.y + p.vy * tau - 0.5 * GRAVITY * tau * tau) : p.y;
  world.position.z = G.dist + G.speed * tau;

  updateNaz(dt);
  updateLiq(dt);
  updateEazy(dt);
  updateCamera(dt);
  updateCoinVisuals(dt);
  fx.update(dt, G.state === 'running' ? G.speed * dt : 0, camera);

  // fog: district fade + red tint during market dumps
  if (themeT < 1) themeT = Math.min(1, themeT + dt * 0.8);
  baseFog.lerpColors(themeFrom, themeTo, themeT);
  scene.fog.color.copy(baseFog).lerp(redFog, G.redAlert * 0.45);
  ui.redAlert(G.redAlert);

  if (G.state === 'running') {
    hud.score = calcScore(); hud.dist = Math.floor(G.dist - G.startDist); hud.coins = G.coins;
    hud.endless = G.mode === 'endless';
    hud.district = hud.endless ? districtAt(G.dist).name : DISTRICTS[G.districtIdx].name;
    hud.progress = hud.endless ? (G.speed - ENDLESS.speedStart) / (ENDLESS.speedMax - ENDLESS.speedStart) : G.dist / STORY_TOTAL;
    hud.liq = G.liqChase / STUMBLE_WINDOW;
    ui.updateHud(hud);
  }
}
const redFog = new THREE.Color(0x5a0614);

// ============================================================ loop
const clock = new THREE.Clock();
renderer.info.autoReset = false; // count draw calls across all post-processing passes
const perf = new PerfMonitor();
let lastFrame = 0;
function frame() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.1);
  const t0 = performance.now();
  G.time += dt;
  stepper.advance(raw, simulate);
  frameVisuals(dt);
  const t1 = performance.now();
  renderer.info.reset();
  if (bloomOn && composer) composer.render(); else renderer.render(scene, camera);
  perf.record(t0, t1 - t0, performance.now() - t1, renderer.info);
  // adaptive quality watches real frame intervals during gameplay only
  if (lastFrame && G.state === 'running' && !HEADLESS) { if (quality.sample(t0 - lastFrame)) applyQuality(); }
  lastFrame = t0;
  if (!HEADLESS) requestAnimationFrame(frame);
}

// ============================================================ prewarm
// Build every template, compile every shader and upload every texture before the first run, so
// no district change, first DUMP candle or first power-up hitches mid-run.
function prewarm() {
  const tmp = new THREE.Group();
  scene.add(tmp);
  for (const t of ['fud', 'bar', 'airdrop', 'rug']) tmp.add(makeObstacle(t).obj);
  for (const len of [6, 9, 12]) { tmp.add(makeObstacle('crash', len).obj); tmp.add(makeObstacle('crashMoving', len).obj); }
  for (const k of Object.keys(POWERUPS)) tmp.add(fromTemplate('pu-' + k, () => createPowerup(k, POWERUPS[k].color)));
  tmp.add(fromTemplate('bag', createBag));
  tmp.add(createIntelMarker());
  BOUNDARIES.forEach((b, i) => tmp.add(fromTemplate('gate-' + i, () => createGate(gateTitle(i), i === BOUNDARIES.length - 1 ? 0xffd23c : DISTRICTS[i + 1].neon[0]))));
  tmp.add(fromTemplate('bull', makeBull));
  tmp.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scamMat));
  const props = [];
  for (const d of DISTRICTS) {
    for (let i = 0; i < 12; i++) props.push(scenery.building(d, i % 2 ? 1 : -1, -2000, Math.random));
    props.push(scenery.lamp(d, 1, -2000), scenery.trenchWall(1, -2000), scenery.greenCandle(1, -2000, Math.random), scenery.coinPile(1, -2000), scenery.road(d, -2000));
    for (let i = 0; i < d.signs.length * 2; i++) props.push(scenery.sign(d, 1, -2000, Math.random, tmp));
    applyTheme(d, true);
  }
  if (!HEADLESS) {
    renderer.compile(scene, camera);
    scene.traverse((o) => { const m = o.material; if (m && !Array.isArray(m)) for (const t of [m.map, m.emissiveMap]) if (t) renderer.initTexture(t); });
  }
  for (const p of props) scenery.removeProp(p);
  scene.remove(tmp);
}

// ============================================================ UI wiring + boot
function toMenu() {
  cancelCountdown?.();
  G.runId++;
  stopMusic();
  resetRun('story');
  G.state = 'menu';
  ui.showHud(false);
  ui.showScreen('menu');
}

function cycleQuality() {
  const order = ['auto', 'high', 'balanced', 'performance'];
  qualitySetting = order[(order.indexOf(qualitySetting) + 1) % order.length];
  try { localStorage.setItem('hb_quality', qualitySetting); } catch {}
  if (qualitySetting === 'auto') quality.setAuto(defaultLevel({ touch: isTouch })); else quality.setManual(qualitySetting);
  applyQuality();
}

async function boot() {
  // canvas textures draw with Anton; make sure it is loaded first (but never block for long)
  try { await Promise.race([document.fonts.load('64px Anton'), new Promise((r) => setTimeout(r, 1500))]); } catch {}
  ui.init({
    onStory: () => startRun('story'),
    onEndless: () => startRun('endless'),
    onRetry: () => startRun(G.mode),
    onCheckpoint: () => startRun('story', G.districtIdx),
    onResume: () => togglePause(false),
    onQuit: () => toMenu(),
    onMute: () => toggleMute(),
    onPause: () => togglePause(),
    onQuality: () => cycleQuality(),
    muted: isMuted(),
  });
  addEventListener('resize', onResize);
  onResize();
  prewarm();
  resetRun('story');
  G.state = 'menu';
  camera.position.set(1.1, 1.7, -4.4);
  frame();
  document.body.classList.add('ready');
}
boot();

// debug hooks for the browser console and the Node sim harness (tools/sim-harness.mjs)
window.__hb = {
  G, startRun, die, toMenu, camera, clock, tick: frame, sceneZ: obsZ,
  input: { laneMove, jump, slide, togglePause }, keyboard,
  spawn: (type, l, z, len = 8) => addObstacle(type, l, z, len),
  coin: (l, y, z) => addCoin(LANES[l], y, z),
  pickup: (kind, l, z) => addPickup(kind, l, z),
  scene, world, pools, coinPool, fx, quality, stepper, nazAnim, lane,
  counts: () => {
    let meshes = 0, sprites = 0;
    scene.traverse((o) => { if (o.isMesh) meshes++; if (o.isSprite) sprites++; });
    return { meshes, sprites, particles: fx.active(), geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : 0, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1, obstacles: G.obstacles.length, coins: G.coinsArr.length, scenery: G.scenery.length, sceneChildren: scene.children.length, worldChildren: world.children.length, ...pools.stats() };
  },
  info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, objs: scene.children.length, audio: { voices: audioDebug.voices, music: audioDebug.musicRunning, state: audioDebug.state, coin: audioDebug.stats } }),
  spawned: () => spawnStats,
  audio: audioDebug, coinSound: (t) => coinPickup(t), sfx,
  perf,
};
