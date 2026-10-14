// Instanced street scenery. Every prop is a set of instances in shared pools (one draw call per
// pool) instead of its own meshes. Props are static in the scrolling world group, so their
// matrices are written once at spawn and removed at despawn; nothing updates per frame.
//
// Look matches the previous per-object scenery: buildings with lit windows, neon trims and
// shopfronts, street lamps, Trenches sandbag walls, Bull City candles and coin piles, signs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstancePool } from './instancing.js';
import { windowsTexture, glowTexture, storefrontTexture, hazardTexture, signTexture, roadTexture, sidewalkTexture } from './textures.js';

const SHOPS = ['BODEGA', '24/7', 'CRYPTO ATM', 'PAWN', 'TATTOO', 'KICKS', 'WINGS', 'BARBER'];

// ---------------------------------------------------------------- shared geometry
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  crown: new THREE.CylinderGeometry(0.35, 0.5, 1, 4),
  sphere: new THREE.SphereGeometry(0.5, 10, 8),
  plane: new THREE.PlaneGeometry(1, 1),
};
G.flat = G.plane.clone().rotateX(-Math.PI / 2); // ground-facing quad

function mergedTransformed(parts) {
  const geos = parts.map(([geo, x, y, z, rx, ry, rz, sx, sy, sz]) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return out;
}

// sandbag wall (3 staggered rows) and barbed-wire coils, each merged into a single geometry
function sandbagGeo() {
  const bag = new THREE.CapsuleGeometry(0.22, 0.5, 3, 6).rotateX(Math.PI / 2);
  const parts = [];
  let r = 1;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) parts.push([bag, (rnd() - 0.5) * 0.15, 0.2 + row * 0.36, -4 + i * 0.95 + (row % 2) * 0.45, 0, 0, 0, 1.5, 0.8, 1]);
  return mergedTransformed(parts);
}
function coilGeo() {
  const coil = new THREE.TorusGeometry(0.28, 0.02, 4, 10);
  const parts = [];
  for (let i = 0; i < 7; i++) parts.push([coil, 0, 1.4, -3.6 + i * 1.2, 0, Math.PI / 2, 0, 1, 1, 1]);
  return mergedTransformed(parts);
}
function coinPileGeo() {
  const c = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 12);
  const parts = [];
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const rad = rnd() * 1.1, a = rnd() * Math.PI * 2;
    parts.push([c, Math.cos(a) * rad, 0.05 + (1.1 - rad) * 0.5 * rnd(), Math.sin(a) * rad, rnd() * 0.6, 0, rnd() * 0.6, 1, 1, 1]);
  }
  return mergedTransformed(parts);
}

// ---------------------------------------------------------------- materials
// Building bodies: windows come from the emissive map, but UVs are computed from each instance's
// scale and position so one material serves buildings of every size (no per-building texture).
const buildingMats = new Map();
function buildingMaterial(theme) {
  if (buildingMats.has(theme.id)) return buildingMats.get(theme.id);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.65, roughness: 0.85, emissiveMap: windowsTexture(theme.id + '-inst', theme.windows, theme.windowDensity) });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHbWin;\nvarying float vHbMask;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 hbOrigin = vec3(instanceMatrix[3]);
        vec3 hbScaled = mat3(instanceMatrix) * position;
      #else
        vec3 hbOrigin = vec3(0.0); vec3 hbScaled = position;
      #endif
      float hbH = hbScaled.y + hbOrigin.y;
      float hbU = abs(objectNormal.x) > 0.5 ? hbScaled.z : hbScaled.x;
      vHbWin = vec2(hbU / 1.6 + fract(hbOrigin.z * 0.137) * 7.0, hbH / 3.2);
      vHbMask = (objectNormal.y > 0.5 || hbH < 2.9) ? 0.0 : 1.0;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHbWin;\nvarying float vHbMask;')
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
        totalEmissiveRadiance *= texture2D( emissiveMap, vHbWin ).rgb * vHbMask;
      #endif`);
  };
  m.customProgramCacheKey = () => 'hb-building';
  buildingMats.set(theme.id, m);
  return m;
}

const MAT = {};
function mats() {
  if (MAT.neon) return MAT;
  MAT.neon = new THREE.MeshBasicMaterial({ color: 0xffffff });                 // instance colour > 1 = glow
  MAT.dark = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4 });
  MAT.gold = new THREE.MeshStandardMaterial({ color: 0xffc21a, metalness: 0.55, roughness: 0.3, emissive: 0x8a5800, emissiveIntensity: 0.8 });
  MAT.glow = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  MAT.bag = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 1 });
  MAT.wire = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8, roughness: 0.4 });
  return MAT;
}

// ---------------------------------------------------------------- the scenery system
export class Scenery {
  constructor(pools, { low = false } = {}) {
    this.pools = pools;
    this.low = low;
    this.shared = { sandbag: null, coil: null, pile: null };
    this.signMats = new Map();
  }
  pool(key, geo, mat, cap, colors = true) { return this.pools.get(key, () => new InstancePool(geo, mat, cap, { colors, name: key })); }
  neon() { return this.pool('neon', G.box, mats().neon, 1024); }
  neonSphere() { return this.pool('neonSphere', G.sphere, mats().neon, 128); }
  dark() { return this.pool('dark', G.box, mats().dark, 512); }
  darkCyl() { return this.pool('darkCyl', G.cyl, mats().dark, 512); }
  glow() { return this.pool('glow', G.plane, mats().glow, 256); }

  // a prop is just the handles it owns + plain meshes (signs); removed together
  prop(zLocal, halfDepth) { return { z: zLocal, halfDepth, handles: [], meshes: [] }; }
  removeProp(p) {
    for (const h of p.handles) if (h) h.pool.remove(h);
    for (const m of p.meshes) m.parent?.remove(m);
    p.handles.length = 0; p.meshes.length = 0;
  }

  building(theme, side, z, rnd) {
    const H = theme.heights || [10, 26];
    const w = 6 + rnd() * 5, d = 7 + rnd() * 6, h = H[0] + rnd() * (H[1] - H[0]);
    const x = side * (7.2 + w / 2 + rnd() * 1.5);
    const p = this.prop(z - d / 2, d / 2);
    const zc = p.z, hs = p.handles;
    const body = this.pools.get('bld-' + theme.id, () => new InstancePool(G.box, buildingMaterial(theme), 160, { colors: true, name: 'bld-' + theme.id }));
    hs.push(body.add(x, h / 2, zc, 0, 0, 0, w, h, d, theme.building[(rnd() * theme.building.length) | 0]));
    const n = theme.neon[(rnd() * theme.neon.length) | 0];
    hs.push(this.neon().add(x, h, zc, 0, 0, 0, w + 0.1, 0.22, d + 0.1, n, 2.2));
    const roadFace = x - side * (w / 2);
    if (theme.id === 'bull' && rnd() < 0.5) {
      hs.push(this.pool('crown', G.crown, mats().gold, 128, false).add(x, h + 1.5, zc, 0, Math.PI / 4, 0, w * 0.7, 3, w * 0.7));
    } else if (!this.low && rnd() < 0.5) {
      hs.push(this.darkCyl().add(x + (rnd() - 0.5) * w * 0.5, h + 1.4, zc + (rnd() - 0.5) * d * 0.4, 0, 0, 0, 1.6, 1.6, 1.6, 0x3a2a24));
      hs.push(this.dark().add(x + w * 0.3, h + 1.5, zc, 0, 0, 0, 0.1, 3, 0.1, 0x555566));
    }
    // street level: Hood storefronts, Trenches shutters, Bull City lobbies
    const shopKey = theme.id === 'hood' ? SHOPS[(rnd() * SHOPS.length) | 0] : theme.id;
    const shopW = Math.min(d - 1, 6);
    hs.push(this.shop(theme, shopKey, n).add(roadFace - side * 0.02, 1.4, zc, 0, -side * Math.PI / 2, 0, shopW, 2.6, 1));
    if (theme.id !== 'trenches') hs.push(this.neon().add(roadFace - side * 0.5, 2.85, zc, 0, 0, side * 0.25, 1.1, 0.12, shopW + 0.4, n, 0.8));
    if (!this.low && rnd() < 0.5) hs.push(this.neon().add(roadFace, h * 0.5 + 1.5, zc - d / 2, 0, 0, 0, 0.2, h * 0.7, 0.2, theme.neon[(rnd() * theme.neon.length) | 0], 2));
    return p;
  }
  shop(theme, key, neonColor) {
    const id = 'shop-' + theme.id + '-' + key;
    return this.pools.get(id, () => {
      const tex = theme.id === 'hood' ? storefrontTexture(key, '#' + neonColor.toString(16).padStart(6, '0'))
        : theme.id === 'trenches' ? hazardTexture('', '#3a2a1a', '#5a4a2a') : storefrontTexture('$HB', '#ffd23c');
      const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: theme.id === 'trenches' ? 0.15 : 0.9 });
      return new InstancePool(G.plane, m, 96, { name: id });
    });
  }

  lamp(theme, side, z) {
    const p = this.prop(z, 0.5), hs = p.handles, x = side * 4.6, c = theme.neon[0];
    hs.push(this.darkCyl().add(x, 2.25, z, 0, 0, 0, 0.17, 4.5, 0.17, 0x333344));
    hs.push(this.dark().add(x - side * 0.6, 4.5, z, 0, 0, 0, 1.2, 0.08, 0.08, 0x333344));
    hs.push(this.neon().add(x - side * 1.1, 4.42, z, 0, 0, 0, 0.5, 0.12, 0.3, c, 3));
    hs.push(this.glow().add(x - side * 1.1, 4.3, z, 0, 0, 0, 2.5, 2.5, 1, c, 0.55));
    return p;
  }

  trenchWall(side, z) {
    const p = this.prop(z, 4.5), hs = p.handles, x = side * 4.6;
    this.shared.sandbag ||= sandbagGeo();
    this.shared.coil ||= coilGeo();
    hs.push(this.pool('sandbag', this.shared.sandbag, mats().bag, 64, false).add(x, 0, z));
    hs.push(this.pool('coil', this.shared.coil, mats().wire, 64, false).add(x, 0, z));
    hs.push(this.darkCyl().add(x, 1.6, z, 0, 0, 0, 0.1, 2.2, 0.1, 0x333333));
    hs.push(this.neonSphere().add(x, 2.75, z, 0, 0, 0, 0.28, 0.28, 0.28, 0xff2d2d, 4));
    hs.push(this.glow().add(x, 2.75, z, 0, 0, 0, 3, 3, 1, 0xff2d2d, 0.7));
    return p;
  }

  greenCandle(side, z, rnd) {
    const p = this.prop(z, 1), h = 3 + rnd() * 8, x = side * (6.6 + rnd() * 0.6);
    p.handles.push(this.neon().add(x, h / 2 + 2, z, 0, 0, 0, 1.2, h, 1.2, 0x18d16a, 1.1));
    p.handles.push(this.neon().add(x, h / 2 + 2, z, 0, 0, 0, 0.15, h + 3, 0.15, 0x7dffb0, 1.4));
    return p;
  }

  coinPile(side, z) {
    const p = this.prop(z, 1.2);
    this.shared.pile ||= coinPileGeo();
    p.handles.push(this.pool('pile', this.shared.pile, mats().gold, 48, false).add(side * 5.6, 0, z));
    return p;
  }

  sign(theme, side, z, rnd, parent) {
    const p = this.prop(z, 0.5);
    const text = theme.signs[(rnd() * theme.signs.length) | 0];
    const color = theme.neon[(rnd() * theme.neon.length) | 0];
    const y = 4.5 + rnd() * 2.5, x = side * 6.3;
    const key = text + color;
    if (!this.signMats.has(key)) this.signMats.set(key, new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true }));
    this.signGeo ||= new THREE.PlaneGeometry(3.4, 1.7);
    const board = new THREE.Mesh(this.signGeo, this.signMats.get(key));
    board.position.set(x, y, z); board.rotation.y = -side * 0.55;
    board.matrixAutoUpdate = false; board.updateMatrix();
    parent.add(board);
    p.meshes.push(board);
    p.handles.push(this.darkCyl().add(x, y / 2 - 0.4, z + 0.05, 0, 0, 0, 0.14, y, 0.14, 0x222233));
    return p;
  }

  // one 20 m road segment: asphalt, two sidewalks, two curbs
  road(theme, z) {
    const p = this.prop(z, 10), hs = p.handles;
    const roadPool = this.pools.get('road-' + theme.id, () => {
      const t = roadTexture(theme.road).clone(); t.needsUpdate = true; t.repeat.set(1, 2);
      return new InstancePool(G.flat, new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.2 }), 24, { name: 'road-' + theme.id });
    });
    const walkPool = this.pools.get('walk-' + theme.id, () => {
      const walkCol = { hood: '#2a2238', trenches: '#24221a', bull: '#3a2c1a' }[theme.id];
      const wt = sidewalkTexture(walkCol, theme.road.edge).clone(); wt.needsUpdate = true; wt.repeat.set(1.5, 5);
      return new InstancePool(G.flat, new THREE.MeshStandardMaterial({ map: wt, roughness: 0.9 }), 48, { name: 'walk-' + theme.id });
    });
    hs.push(roadPool.add(0, 0, z, 0, 0, 0, 7.6, 1, 20));
    for (const s of [-1, 1]) {
      hs.push(walkPool.add(s * 5.9, 0.12, z, 0, s > 0 ? Math.PI : 0, 0, 4.2, 1, 20));
      hs.push(this.dark().add(s * 3.9, 0.06, z, 0, 0, 0, 0.2, 0.14, 20, 0x15111f));
    }
    return p;
  }

  clear() { this.pools.clear(); }
}

export { SHOPS };
