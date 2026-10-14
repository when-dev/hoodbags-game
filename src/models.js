// Procedural stylized models. No external 3D assets: characters are built from shaped geometry
// (lathe profiles, bent tubes, rounded boxes) + painted canvas textures, with a shared rim-lit
// material so Naz, Eazy and Liq read as one consistent cast against the neon world.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  coinTexture, labelTexture, glowTexture, raccoonFaceTexture, fabricTexture,
  pinstripeTexture, patchTexture, bandanaTexture, hazardTexture, crateTexture, rugTexture, pitTexture,
} from './textures.js';

// ---------------------------------------------------------------- materials
// cache key that never serialises textures (JSON.stringify would call Texture.toJSON, which in
// a browser encodes the whole canvas as a data URL)
const keyOf = (color, o) => color + '|' + Object.keys(o).sort().map((k) => k + ':' + (o[k] && o[k].isTexture ? o[k].uuid : o[k])).join(',');
const matCache = new Map();
export function mat(color, o = {}) {
  const key = keyOf(color, o);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o }));
  return matCache.get(key);
}
const neon = (c, i = 2) => mat(c, { emissive: c, emissiveIntensity: i, roughness: 0.3 });

// Character material: standard PBR + soft lavender fresnel rim so silhouettes pop on dark streets.
const charCache = new Map();
export function charMat(color, o = {}) {
  const key = keyOf(color, o);
  if (charCache.has(key)) return charCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', `
      float rimF = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
      gl_FragColor.rgb += vec3(0.62, 0.55, 1.0) * pow(rimF, 3.0) * 0.4;
      #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'hb-rim';
  charCache.set(key, m);
  return m;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}
function glowSprite(color, sx, sy = sx, opacity = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(sx, sy, 1);
  return s;
}

// Bend a geometry built along +Y into an arc in the YZ plane (used for tails).
function bend(geo, length, angle) {
  const p = geo.attributes.position;
  const R = length / angle;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = (y / length) * angle;
    p.setXYZ(i, x, (R - z) * Math.sin(a), R - (R - z) * Math.cos(a));
  }
  geo.computeVertexNormals();
  return geo;
}

// Merge every static mesh in a group into one mesh per material: big draw-call saver for scenery.
export function bake(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const keep = [];
  group.traverse((o) => {
    if (o === group) return;
    if (o.isMesh && !Array.isArray(o.material)) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.clearGroups();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(g);
    } else if (o.isSprite || o.isMesh) {
      keep.push(o);
    }
  });
  const out = new THREE.Group();
  out.position.copy(group.position); out.rotation.copy(group.rotation); out.scale.copy(group.scale);
  out.userData = { ...group.userData };
  for (const [m, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (merged) out.add(new THREE.Mesh(merged, m));
  }
  for (const o of keep) {
    o.updateMatrixWorld(true);
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const c = o.clone();
    local.decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  return out;
}

// Merge the static meshes directly under each node of an animated rig. Joints stay separate
// groups so procedural animation still works. Untextured standard materials that only differ in
// colour are folded into ONE vertex-coloured material per joint (colour baked into the vertices),
// so a joint made of fur + white + dark parts costs one draw call instead of three.
const vcCache = new Map();
// roughness / metalness are quantised to 0.25 steps so near-identical parts share a bucket
const q4 = (v) => Math.round(v * 4) / 4;
function vcMaterial(m) {
  const r = q4(m.roughness), mt = q4(m.metalness);
  const key = [r, mt, m.emissive.getHex(), m.emissiveIntensity, m.side, m.transparent, m.opacity].join('|');
  if (!vcCache.has(key)) vcCache.set(key, charMat(0xffffff, { vertexColors: true, roughness: r, metalness: mt, emissive: m.emissive.getHex(), emissiveIntensity: m.emissiveIntensity, side: m.side, transparent: m.transparent, opacity: m.opacity }));
  return vcCache.get(key);
}
const foldable = (m) => m.isMeshStandardMaterial && !m.map && !m.emissiveMap;
// Re-parent the contents of construction-only groups (and meshes that carry child meshes) into
// their parent, so they can merge with it. Nodes in `keep` (animated joints) and named nodes stay.
function flattenStatic(root, keep) {
  const post = [];
  root.traverse((n) => post.push(n));
  for (let i = post.length - 1; i >= 0; i--) {
    const n = post[i];
    if (n === root || keep.has(n) || n.name || n.isSprite || !n.parent || !n.children.length) continue;
    n.updateMatrix();
    for (const c of [...n.children]) {
      c.updateMatrix();
      c.matrix.premultiply(n.matrix);
      c.matrix.decompose(c.position, c.quaternion, c.scale);
      n.parent.add(c);
    }
    if (!n.isMesh) n.parent.remove(n);
  }
}
export function mergeRig(root, keep = null) {
  if (keep) flattenStatic(root, keep);
  root.traverse((node) => {
    if (node.isMesh || node.isSprite) return;
    const buckets = new Map();
    for (const c of node.children) {
      if (!c.isMesh || c.name || c.children.length || Array.isArray(c.material)) continue;
      const key = foldable(c.material) ? 'vc:' + vcMaterial(c.material).uuid : c.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { mat: foldable(c.material) ? vcMaterial(c.material) : c.material, vc: foldable(c.material), list: [] });
      buckets.get(key).list.push(c);
    }
    for (const { mat: m, vc, list } of buckets.values()) {
      if (list.length < 2 && !(vc && list.length === 1)) continue;
      const geos = list.map((c) => {
        c.updateMatrix();
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        const n = g.attributes.position.count;
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
        if (vc) {
          // bake the material colour into vertex colours (multiplying any existing ones)
          const col = c.material.color, src = g.attributes.color, out = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            out[i * 3] = col.r * (src ? src.getX(i) : 1); out[i * 3 + 1] = col.g * (src ? src.getY(i) : 1); out[i * 3 + 2] = col.b * (src ? src.getZ(i) : 1);
          }
          g.setAttribute('color', new THREE.Float32BufferAttribute(out, 3));
        } else if (g.attributes.color) g.deleteAttribute('color');
        g.clearGroups();
        return g.applyMatrix4(c.matrix);
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      list.forEach((c) => node.remove(c));
      node.add(new THREE.Mesh(merged, m));
    }
  });
  return root;
}

// ================================================================ NAZ
// Raccoon in a grey hoodie, ripped black jeans, purple high-tops, gold $HB chain and a backpack
// stuffed with coins, riding a hoverboard (deck p.1 / p.4 / p.5). Built as a simple rig so it can
// be animated procedurally: rider > hips > legs/torso > arms/head, tail on the hips.
export function createNaz() {
  const root = new THREE.Group();
  const fur = charMat(0x8f8f9c), furDark = charMat(0x2a2a33), white = charMat(0xf2f0ec);
  const hoodieTex = fabricTexture('#c4c3cc', 'hoodie');
  const hoodie = charMat(0xffffff, { map: hoodieTex, roughness: 0.95 });
  const hoodieDark = charMat(0x9d9ca8, { roughness: 0.95 });
  const denim = charMat(0x1f2130, { map: fabricTexture('#2a2c3e', 'denim'), roughness: 0.9 });
  const shoe = charMat(0x6c3cf0, { roughness: 0.45 }), shoeAcc = charMat(0x29d3e6, { roughness: 0.45 });
  const gold = charMat(0xffc21a, { metalness: 0.9, roughness: 0.25, emissive: 0x4a3000, emissiveIntensity: 0.6 });
  const bagMat = charMat(0x17171e, { roughness: 0.75 });

  // ---------------- hoverboard
  const board = new THREE.Group();
  const shape = new THREE.Shape();
  const bw = 0.36, bl = 0.9, r = 0.3;
  shape.moveTo(-bw, -bl + r); shape.lineTo(-bw, bl - r); shape.quadraticCurveTo(-bw, bl, 0, bl);
  shape.quadraticCurveTo(bw, bl, bw, bl - r); shape.lineTo(bw, -bl + r); shape.quadraticCurveTo(bw, -bl, 0, -bl);
  shape.quadraticCurveTo(-bw, -bl, -bw, -bl + r);
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 10 });
  deckGeo.rotateX(Math.PI / 2); deckGeo.translate(0, 0.05, 0);
  board.add(mesh(deckGeo, charMat(0x6a2bd9, { metalness: 0.5, roughness: 0.3 })));
  const grip = mesh(new THREE.PlaneGeometry(0.62, 1.5), charMat(0x121216, { roughness: 1 }), 0, 0.085, 0);
  grip.rotation.x = -Math.PI / 2;
  board.add(grip);
  // gold $HB inlay on the tail end (visible to the camera)
  const inlay = mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.6, roughness: 0.3 }), 0, 0.087, 0.62);
  inlay.rotation.x = -Math.PI / 2;
  board.add(inlay);
  // neon rim + underglow + rear thrusters
  const rim = mesh(new THREE.BoxGeometry(0.76, 0.03, 1.72), neon(0x29e6ff, 3), 0, -0.02, 0);
  board.add(rim);
  for (const s of [-1, 1]) {
    const pod = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 12), charMat(0x2a2a36, { metalness: 0.7, roughness: 0.3 }), s * 0.2, -0.04, 0.82);
    pod.rotation.x = Math.PI / 2;
    board.add(pod);
    const flame = mesh(new THREE.ConeGeometry(0.06, 0.35, 10), new THREE.MeshBasicMaterial({ color: 0x7ff3ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), s * 0.2, -0.04, 1.08);
    flame.rotation.x = Math.PI / 2;
    flame.name = 'flame';
    board.add(flame);
  }
  const under = glowSprite(0x29e6ff, 1.9, 1.1, 0.8);
  under.position.y = -0.25;
  board.add(under);
  board.position.y = 0.22;
  root.add(board);

  // ---------------- rider rig
  const rider = new THREE.Group();
  rider.position.y = 0.32;
  root.add(rider);
  const hips = new THREE.Group();
  hips.position.y = 0.62;
  rider.add(hips);

  // legs: hip pivot > thigh > knee pivot > shin > sneaker
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.13, 0, 0);
    hip.add(mesh(new THREE.CapsuleGeometry(0.085, 0.2, 4, 10), denim, 0, -0.15, 0));
    // ripped knee
    const rip = mesh(new THREE.CircleGeometry(0.035, 8), charMat(0xb8b4c8), 0, -0.27, -0.083);
    rip.rotation.y = Math.PI;
    hip.add(rip);
    const knee = new THREE.Group(); knee.position.y = -0.3;
    knee.add(mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 10), denim, 0, -0.13, 0));
    const foot = new THREE.Group(); foot.position.y = -0.3;
    const sneaker = mesh(new RoundedBoxGeometry(0.17, 0.13, 0.3, 2, 0.05), shoe, 0, 0.0, -0.04);
    foot.add(sneaker);
    foot.add(mesh(new RoundedBoxGeometry(0.18, 0.05, 0.32, 2, 0.02), white, 0, -0.07, -0.04));
    foot.add(mesh(new THREE.BoxGeometry(0.175, 0.04, 0.12), shoeAcc, 0, 0.02, 0.06));
    foot.add(mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.09, 12), shoe, 0, 0.08, 0.02)); // high-top collar
    knee.add(foot);
    hip.add(knee);
    hips.add(hip);
    legs.push({ hip, knee, foot });
  }

  // red bandana hanging from the back pocket (reads from the chase camera)
  const bandGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.08, 0, 0), new THREE.Vector3(0.08, 0, 0), new THREE.Vector3(0.0, -0.2, 0)]);
  bandGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  bandGeo.computeVertexNormals();
  const bandana = mesh(bandGeo, charMat(0xffffff, { map: bandanaTexture(), side: THREE.DoubleSide }), 0.12, -0.02, 0.13);
  hips.add(bandana);

  // torso: lathe hoodie profile (hem → chest → shoulders → neck)
  const torso = new THREE.Group();
  hips.add(torso);
  const prof = [[0.0, -0.02], [0.25, -0.02], [0.27, 0.04], [0.27, 0.18], [0.29, 0.32], [0.27, 0.42], [0.2, 0.5], [0.1, 0.54], [0.0, 0.55]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const torsoGeo = new THREE.LatheGeometry(prof, 24);
  torsoGeo.scale(1, 1, 0.78);
  torso.add(mesh(torsoGeo, hoodie));
  torso.add(mesh(new THREE.TorusGeometry(0.26, 0.03, 8, 24).scale(1, 0.78, 1).rotateX(Math.PI / 2), hoodieDark, 0, 0.0, 0)); // ribbed hem
  // kangaroo pocket + drawstrings (front)
  torso.add(mesh(new RoundedBoxGeometry(0.3, 0.13, 0.04, 2, 0.02), hoodieDark, 0, 0.1, -0.205));
  for (const s of [-1, 1]) torso.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16), white, s * 0.05, 0.38, -0.2));
  // hood bunched behind the neck
  torso.add(mesh(new THREE.TorusGeometry(0.15, 0.075, 10, 20).scale(1.25, 1, 0.9).rotateX(Math.PI / 2.3), hoodie, 0, 0.52, 0.04));
  // gold chain + $HB pendant
  torso.add(mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 24).rotateX(Math.PI / 2.6), gold, 0, 0.47, -0.04));
  const pendant = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.7, roughness: 0.3 }), 0, 0.33, -0.225);
  torso.add(pendant);

  // backpack full of $HB — the camera's main view of Naz
  const pack = new THREE.Group();
  pack.add(mesh(new RoundedBoxGeometry(0.46, 0.5, 0.26, 3, 0.08), bagMat));
  pack.add(mesh(new RoundedBoxGeometry(0.34, 0.2, 0.08, 2, 0.04), charMat(0x23232c), 0, -0.1, 0.14));
  for (const s of [-1, 1]) pack.add(mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), charMat(0x101014), s * 0.15, 0.02, -0.14));
  const coinGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.022, 14);
  const coinGold = charMat(0xffc21a, { metalness: 0.85, roughness: 0.25, emissive: 0x6b4300, emissiveIntensity: 0.7 });
  const spill = [[-0.12, 0.26, 0.02, 0.5], [0.0, 0.29, -0.02, -0.3], [0.13, 0.25, 0.03, 0.8], [-0.05, 0.32, 0.05, 1.3], [0.08, 0.31, -0.06, -1], [-0.16, 0.22, -0.05, 0.2], [0.04, 0.35, 0.0, 0.4]];
  for (const [x, y, z, a] of spill) { const c = mesh(coinGeo, coinGold, x, y, z); c.rotation.set(a, a * 0.7, a * 0.3); pack.add(c); }
  // patches facing the camera
  const patchGeo = new THREE.CircleGeometry(0.07, 20);
  const p1 = mesh(patchGeo, charMat(0xffffff, { map: patchTexture('$HB', '#ffc21a', '#5a3300') }), 0, -0.09, 0.185);
  const p2 = mesh(patchGeo, charMat(0xffffff, { map: patchTexture('HOOD', '#ff4fd8', '#ffffff') }), -0.14, 0.12, 0.133);
  const p3 = mesh(patchGeo, charMat(0xffffff, { map: patchTexture('GM', '#29e6ff', '#14002a') }), 0.14, 0.12, 0.133);
  pack.add(p1, p2, p3);
  pack.position.set(0, 0.25, 0.27);
  torso.add(pack);

  // arms: shoulder pivot > sleeve > elbow pivot > forearm > paw
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.29, 0.42, 0);
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.075, 0.17, 4, 10), hoodie, 0, -0.12, 0));
    const elbow = new THREE.Group(); elbow.position.y = -0.24;
    elbow.add(mesh(new THREE.CapsuleGeometry(0.068, 0.14, 4, 10), hoodie, 0, -0.09, 0));
    elbow.add(mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 14).rotateX(Math.PI / 2), hoodieDark, 0, -0.19, 0));
    const paw = mesh(new THREE.SphereGeometry(0.065, 12, 10), furDark, 0, -0.24, 0);
    paw.scale.set(1, 1.15, 0.9);
    elbow.add(paw);
    shoulder.add(elbow);
    torso.add(shoulder);
    arms.push({ shoulder, elbow });
  }

  // head
  const neck = new THREE.Group(); neck.position.y = 0.56;
  torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.24;
  neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.3, 32, 24), charMat(0xffffff, { map: raccoonFaceTexture(), roughness: 0.9 }));
  skull.scale.set(1.05, 0.95, 1);
  head.add(skull);
  // snout + nose
  const snout = mesh(new THREE.SphereGeometry(0.13, 18, 14), white, 0, -0.08, -0.24);
  snout.scale.set(1.0, 0.75, 1.1);
  head.add(snout);
  head.add(mesh(new THREE.SphereGeometry(0.045, 12, 10), charMat(0x111114, { roughness: 0.2 }), 0, -0.04, -0.375));
  // smile
  head.add(mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI * 0.8).rotateZ(Math.PI * 1.1), furDark, 0.0, -0.12, -0.345));
  // cheek ruffs: the raccoon silhouette from behind
  for (const s of [-1, 1]) {
    const cheek = mesh(new THREE.SphereGeometry(0.12, 14, 10), fur, s * 0.27, -0.08, -0.02);
    cheek.scale.set(1.1, 0.7, 0.9);
    cheek.rotation.z = s * 0.5;
    head.add(cheek);
    const tuft = mesh(new THREE.ConeGeometry(0.06, 0.16, 8), white, s * 0.37, -0.12, -0.05);
    tuft.rotation.z = s * 2.1;
    head.add(tuft);
  }
  // eyes: big amber, glossy
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const yaw = s * 0.36, pitch = 0.07;
    eye.position.set(Math.sin(yaw) * 0.275, Math.sin(pitch) * 0.3, -Math.cos(yaw) * 0.275);
    eye.lookAt(eye.position.clone().multiplyScalar(3));
    const sclera = mesh(new THREE.SphereGeometry(0.068, 16, 12), charMat(0xfdfcf7, { roughness: 0.2 }));
    sclera.scale.z = 0.55;
    eye.add(sclera);
    eye.add(mesh(new THREE.CircleGeometry(0.045, 16), charMat(0xc98a2b, { roughness: 0.3 }), 0, 0, 0.039));
    eye.add(mesh(new THREE.CircleGeometry(0.025, 14), charMat(0x0b0b0e, { roughness: 0.1 }), 0, 0, 0.0395));
    eye.add(mesh(new THREE.CircleGeometry(0.011, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0.015, 0.016, 0.04));
    head.add(eye);
  }
  // ears with white rims
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.2, 0.22, 0.02);
    ear.rotation.z = -s * 0.35;
    const rimE = mesh(new THREE.SphereGeometry(0.12, 14, 10), white); rimE.scale.set(0.95, 1.2, 0.35);
    const outer = mesh(new THREE.SphereGeometry(0.105, 14, 10), fur, 0, -0.01, 0.01); outer.scale.set(0.95, 1.2, 0.38);
    const inner = mesh(new THREE.SphereGeometry(0.07, 12, 8), charMat(0x3a2a33), 0, -0.02, -0.025); inner.scale.set(0.9, 1.1, 0.3);
    ear.add(rimE, outer, inner);
    head.add(ear);
  }

  // ringed tail: fluffy lathe profile, banded, bent into a curve
  const tailLen = 0.95;
  const tprof = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const rad = t === 1 ? 0.0 : 0.075 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.1 + (t < 0.95 ? 0 : -0.05);
    tprof.push(new THREE.Vector2(Math.max(0.001, rad), t * tailLen));
  }
  const tailGeo = new THREE.LatheGeometry(tprof, 18);
  // banding via vertex colours (grey / black rings, dark tip)
  const col = [], tp = tailGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const t = tp.getY(i) / tailLen;
    const dark = t > 0.88 || Math.floor(t * 9) % 2 === 1;
    const c = new THREE.Color(dark ? 0x23232b : 0x9a9aa6);
    col.push(c.r, c.g, c.b);
  }
  tailGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bend(tailGeo, tailLen, -1.1);
  const tailMat = charMat(0xffffff, { vertexColors: true, roughness: 1 });
  const tail = new THREE.Group();
  const tailMesh = mesh(tailGeo, tailMat);
  tailMesh.rotation.x = Math.PI / 2 - 0.35; // base points backward, curling up
  tail.add(tailMesh);
  tail.position.set(0.04, 0.02, 0.17);
  tail.rotation.y = 0.35;
  hips.add(tail);

  // diamond-hands bubble
  const shield = mesh(new THREE.SphereGeometry(1.15, 24, 16), new THREE.MeshBasicMaterial({ color: 0x29e6ff, transparent: true, opacity: 0.16, depthWrite: false }), 0, 1.0, 0);
  shield.visible = false;
  root.add(shield);

  bandana.name = 'bandana';
  mergeRig(root, new Set([board, rider, hips, torso, pack, neck, head, tail, shield, ...legs.flatMap((l) => [l.hip, l.knee, l.foot]), ...arms.flatMap((a) => [a.shoulder, a.elbow])]));
  root.scale.setScalar(1.08);
  root.userData = { board, rider, hips, torso, legs, arms, head, neck, tail, pack, bandana, shield, flames: board.children.filter((c) => c.name === 'flame') };
  return root;
}

// Apply a pose computed by NazAnimator (src/anim.js) to the rig. Pure assignment: all timing,
// blending and easing lives in the animator so it can be unit-tested.
export function applyNazPose(naz, P) {
  const u = naz.userData;
  u.rider.position.y = P.riderY; u.rider.rotation.z = P.riderZ;
  u.hips.position.y = P.hipsY;
  u.torso.rotation.set(P.torsoX, P.torsoY, P.torsoZ);
  u.neck.rotation.set(P.neckX, P.neckY, P.neckZ);
  const [L, R] = u.legs;
  L.hip.rotation.x = P.lHipX; L.hip.rotation.z = P.lHipZ; L.knee.rotation.x = P.lKneeX; L.foot.rotation.x = P.lFootX;
  R.hip.rotation.x = P.rHipX; R.hip.rotation.z = P.rHipZ; R.knee.rotation.x = P.rKneeX; R.foot.rotation.x = P.rFootX;
  const [la, ra] = u.arms;
  la.shoulder.rotation.x = P.lShX; la.shoulder.rotation.z = P.lShZ; la.elbow.rotation.x = P.lElX;
  ra.shoulder.rotation.x = P.rShX; ra.shoulder.rotation.z = P.rShZ; ra.elbow.rotation.x = P.rElX;
  u.tail.rotation.x = P.tailX; u.tail.rotation.y = P.tailY;
  u.pack.scale.setScalar(P.packScale);
  u.bandana.rotation.x = P.bandanaX;
  u.board.position.y = P.boardY;
  u.board.rotation.set(P.boardX, P.boardYaw, P.boardZ);
  for (const f of u.flames) f.scale.y = P.flame;
}

// ================================================================ EAZY
// Monkey with a purple bucket hat, teal jacket, purple shorts, gold chain and a phone full of
// "alpha". Rides a hover-disc alongside Naz whenever he talks (deck p.1 / p.4).
export function createEazy() {
  const root = new THREE.Group();
  const fur = charMat(0x7a4a2a), face = charMat(0xe8b48a), purple = charMat(0x6b2fd6, { roughness: 0.8 });
  const teal = charMat(0x22c7d6, { roughness: 0.75 }), whiteC = charMat(0xf4f2ee), gold = charMat(0xffc21a, { metalness: 0.9, roughness: 0.25, emissive: 0x4a3000, emissiveIntensity: 0.6 });

  const disc = new THREE.Group();
  disc.add(mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.12, 28), charMat(0x2a1d4a, { metalness: 0.6, roughness: 0.3 })));
  disc.add(mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 32).rotateX(Math.PI / 2), neon(0xff4fd8, 3), 0, -0.04, 0));
  const g = glowSprite(0xff4fd8, 1.6, 0.9, 0.7); g.position.y = -0.25; disc.add(g);
  root.add(disc);

  const body = new THREE.Group(); body.position.y = 0.06;
  root.add(body);
  // legs: purple shorts, white high socks, chunky white sneakers
  for (const s of [-1, 1]) {
    body.add(mesh(new THREE.CapsuleGeometry(0.1, 0.12, 4, 10), purple, s * 0.12, 0.5, 0));
    body.add(mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), whiteC, s * 0.12, 0.25, 0));
    body.add(mesh(new RoundedBoxGeometry(0.17, 0.12, 0.28, 2, 0.05), whiteC, s * 0.12, 0.07, -0.04));
  }
  // torso: white tee + open teal jacket
  const tee = mesh(new THREE.CapsuleGeometry(0.2, 0.22, 6, 16), whiteC, 0, 0.82, 0);
  tee.scale.z = 0.8;
  body.add(tee);
  for (const s of [-1, 1]) {
    const flap = mesh(new THREE.CapsuleGeometry(0.13, 0.26, 4, 12), teal, s * 0.12, 0.82, 0.02);
    flap.scale.set(1, 1, 0.95);
    body.add(flap);
  }
  body.add(mesh(new THREE.TorusGeometry(0.12, 0.016, 6, 20).rotateX(Math.PI / 2.4), gold, 0, 1.0, -0.06));
  // arms: one thumbs-up, one holding a phone
  const armL = new THREE.Group(); armL.position.set(-0.27, 0.98, 0);
  armL.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), teal, 0, -0.18, 0));
  const phone = mesh(new RoundedBoxGeometry(0.1, 0.17, 0.02, 2, 0.01), charMat(0x111111), 0, -0.4, -0.06);
  phone.add(mesh(new THREE.PlaneGeometry(0.08, 0.14), new THREE.MeshBasicMaterial({ map: labelTexture('📈', '#0b3', '#fff', 64, 96, 50) }), 0, 0, 0.012));
  armL.add(phone);
  armL.rotation.set(-0.9, 0, 0.2);
  body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.27, 0.98, 0);
  armR.add(mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), teal, 0, -0.18, 0));
  const fist = mesh(new THREE.SphereGeometry(0.07, 10, 8), fur, 0, -0.38, 0); armR.add(fist);
  armR.add(mesh(new THREE.CapsuleGeometry(0.025, 0.07, 3, 6), fur, 0, -0.3, -0.05));
  armR.rotation.set(-2.2, 0, -0.3);
  body.add(armR);
  // head
  const head = new THREE.Group(); head.position.y = 1.32;
  body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.25, 24, 18), fur));
  const mask = mesh(new THREE.SphereGeometry(0.2, 20, 16), face, 0, -0.03, -0.1); mask.scale.set(1.1, 1, 0.9); head.add(mask);
  const muzzle = mesh(new THREE.SphereGeometry(0.13, 16, 12), face, 0, -0.11, -0.2); muzzle.scale.set(1.2, 0.8, 0.9); head.add(muzzle);
  head.add(mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI).rotateZ(Math.PI), charMat(0x3a1a10), 0.02, -0.12, -0.31)); // grin
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.075, 12, 10), face, s * 0.26, 0.0, 0.0)); // ears
    // half-lidded "trust me" eyes
    const eye = mesh(new THREE.SphereGeometry(0.05, 12, 10), charMat(0xffffff), s * 0.08, 0.05, -0.27);
    eye.add(mesh(new THREE.SphereGeometry(0.026, 8, 6), charMat(0x221108), 0, -0.005, -0.035));
    const lid = mesh(new THREE.SphereGeometry(0.053, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), face, 0, 0, 0);
    lid.rotation.x = 0.35;
    eye.add(lid);
    head.add(eye);
  }
  // pink bubblegum bubble
  const gum = mesh(new THREE.SphereGeometry(0.07, 12, 10), charMat(0xff7ad9, { roughness: 0.2 }), 0.05, -0.15, -0.35);
  gum.name = 'gum';
  head.add(gum);
  // purple bucket hat + sunglasses on the brim
  head.add(mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.16, 20), purple, 0, 0.2, 0));
  head.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24), purple, 0, 0.12, 0));
  for (const s of [-1, 1]) head.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 14).rotateX(Math.PI / 2.4), charMat(0x0a1a2a, { metalness: 0.8, roughness: 0.1 }), s * 0.08, 0.22, -0.2));

  mergeRig(root, new Set([body, head, armR, disc]));
  root.userData = { body, head, armR, gum, disc };
  root.scale.setScalar(1.05);
  return root;
}

// talk: 0..1 while delivering a line; vx: sideways velocity of the fly-in (banks the disc)
export function animateEazy(e, t, talk = 0, vx = 0) {
  const u = e.userData;
  u.body.position.y = 0.06 + Math.sin(t * 3) * 0.03 + Math.abs(Math.sin(t * 8)) * 0.03 * talk;
  u.head.rotation.x = Math.sin(t * 8) * 0.12 * talk;                 // nodding while he talks
  u.head.rotation.z = Math.sin(t * 2.2) * 0.12;
  u.head.rotation.y = Math.sin(t * 1.3) * 0.2;
  u.armR.rotation.x = -2.2 + Math.sin(t * 6) * 0.15 - talk * Math.max(0, Math.sin(t * 5)) * 0.4; // thumb pump
  u.gum.scale.setScalar(0.6 + (Math.sin(t * 2.5) * 0.5 + 0.5) * 0.9 * (1 - talk * 0.7));
  u.disc.rotation.y = t * 2;
  e.rotation.z = Math.max(-0.35, Math.min(0.35, -vx * 0.04));          // banks into the fly-in
}

// ================================================================ LIQ
// The whale: portly, purple pinstripe suit, red tie, angry brow, spout. Pressure has a face.
export function createLiq() {
  const root = new THREE.Group();
  const blue = charMat(0x2f7dff, { roughness: 0.35 }), belly = charMat(0xe8f2ff, { roughness: 0.5 });
  const suit = charMat(0xffffff, { map: pinstripeTexture(), roughness: 0.75 });
  // body: upright teardrop lathe
  const prof = [[0, -0.95], [0.55, -0.9], [0.95, -0.55], [1.12, 0.0], [1.08, 0.45], [0.9, 0.9], [0.55, 1.18], [0, 1.27]].map(([x, y]) => new THREE.Vector2(x, y));
  const bodyGeo = new THREE.LatheGeometry(prof, 32); bodyGeo.scale(1.1, 1, 1);
  root.add(mesh(bodyGeo, blue));
  // suit jacket: shell around the lower half, open at the front
  const sprof = [[0.62, -0.92], [1.02, -0.55], [1.18, 0.0], [1.13, 0.32]].map(([x, y]) => new THREE.Vector2(x, y));
  const jacketGeo = new THREE.LatheGeometry(sprof, 32, Math.PI * 0.62 - Math.PI / 2 + Math.PI, Math.PI * 1.76);
  jacketGeo.scale(1.1, 1, 1);
  root.add(mesh(jacketGeo, suit));
  // shirt + tie + belly
  const shirt = mesh(new THREE.SphereGeometry(0.62, 20, 16), belly, 0, -0.15, -0.7); shirt.scale.set(0.9, 1.2, 0.6); root.add(shirt);
  const tie = mesh(new THREE.ConeGeometry(0.14, 0.7, 4), charMat(0xd8143a, { roughness: 0.4 }), 0, -0.05, -1.08); tie.rotation.x = Math.PI - 0.15; root.add(tie);
  root.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.1), charMat(0xd8143a), 0, 0.3, -1.05));
  // gold pocket square + watch chain
  root.add(mesh(new THREE.BoxGeometry(0.16, 0.08, 0.05), charMat(0xffc21a, { metalness: 0.9, roughness: 0.2 }), 0.6, 0.15, -0.92));
  // face: big glossy eyes, heavy angry brows, smug grin
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.17, 16, 12), charMat(0xffffff, { roughness: 0.2 }), s * 0.42, 0.58, -0.92);
    eye.scale.z = 0.6;
    const pupil = mesh(new THREE.SphereGeometry(0.075, 12, 10), charMat(0x0b0b10, { emissive: 0xff1030, emissiveIntensity: 0 }), -s * 0.02, -0.02, -0.12);
    eye.add(pupil); eyes.push(pupil);
    const lid = mesh(new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), blue); lid.rotation.x = -0.5 + 0; lid.rotation.z = s * 0.35; eye.add(lid);
    root.add(eye);
    const brow = mesh(new RoundedBoxGeometry(0.4, 0.08, 0.1, 2, 0.03), charMat(0x0d2a6b), s * 0.42, 0.8, -0.98); brow.rotation.z = s * 0.38; root.add(brow);
    const fin = mesh(new THREE.SphereGeometry(0.38, 14, 10), blue, s * 1.25, -0.25, -0.1); fin.scale.set(0.35, 1, 0.7); fin.rotation.z = s * 0.7; root.add(fin);
    // sleeve on the fin
    const sleeve = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.35, 14), suit, s * 1.12, 0.05, -0.1); sleeve.rotation.z = s * 0.7; root.add(sleeve);
  }
  const grin = mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 20, Math.PI * 0.75), charMat(0x0d2a6b), 0.08, 0.22, -1.02); grin.rotation.z = Math.PI * 1.12; root.add(grin);
  // tail fluke behind
  for (const s of [-1, 1]) { const f = mesh(new THREE.SphereGeometry(0.4, 12, 8), blue, s * 0.35, -0.75, 1.05); f.scale.set(1, 0.18, 0.55); f.rotation.y = s * 0.5; root.add(f); }
  // spout
  const spout = new THREE.Group(); spout.position.y = 1.3;
  for (let i = 0; i < 3; i++) { const d = mesh(new THREE.SphereGeometry(0.09 - i * 0.02, 8, 6), charMat(0xbfe8ff, { transparent: true, opacity: 0.8 }), (i - 1) * 0.12, 0.2 + i * 0.12, 0); spout.add(d); }
  root.add(spout);
  // menace aura
  const aura = glowSprite(0x2f6dff, 5.5, 5.5, 0.35); aura.position.z = 0.4; root.add(aura);
  eyes.forEach((e) => (e.name = 'pupil'));
  mergeRig(root, new Set([spout]));
  root.userData = { spout, eyes, aura };
  root.scale.setScalar(0.9);
  return root;
}

// pressure 0..1: posture, bob tempo, eye glow and aura escalate together
export function animateLiq(liq, t, pressure) {
  const u = liq.userData;
  const tempo = 2 + pressure * 4;
  u.spout.scale.y = 1 + Math.sin(t * (10 + pressure * 10)) * 0.3;
  u.spout.position.y = 1.3 + Math.abs(Math.sin(t * 6)) * 0.1;
  for (const p of u.eyes) p.material.emissiveIntensity = pressure * 2.5;
  u.aura.material.opacity = 0.18 + pressure * (0.4 + Math.sin(t * tempo * 2) * 0.12);
  u.aura.material.color.setHex(pressure > 0.5 ? 0xff2050 : 0x2f6dff);
  liq.rotation.x = -pressure * 0.32 + Math.sin(t * tempo) * 0.04;     // leans in, hunting
  liq.rotation.z = Math.sin(t * tempo * 0.5) * (0.06 + pressure * 0.08);
}

// ================================================================ COINS / PICKUPS
export function coinGeometry() { if (!coinGeo) createCoin(); return coinGeo; }
export function coinMaterial() { if (!coinMats) createCoin(); return coinMats; }
let coinGeo, coinMats;
export function createCoin() {
  if (!coinGeo) {
    coinGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.09, 24);
    coinGeo.rotateX(Math.PI / 2);
    coinGeo.clearGroups(); // one material, one draw call per coin
    coinMats = new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.55, roughness: 0.3, emissive: 0x6b4300, emissiveIntensity: 0.55 });
  }
  return new THREE.Mesh(coinGeo, coinMats);
}

// High-value "$HB bag": rare combo reward worth 10 coins
export function createBag() {
  const g = new THREE.Group();
  const sack = mesh(new THREE.SphereGeometry(0.42, 18, 14), charMat(0x6b4a2a, { roughness: 0.9 }), 0, 0.35, 0);
  sack.scale.set(1, 1.1, 0.9);
  g.add(sack);
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.2, 12), charMat(0x6b4a2a), 0, 0.82, 0));
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 14).rotateX(Math.PI / 2), charMat(0xffc21a, { metalness: 0.8 }), 0, 0.75, 0));
  const lbl = mesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.5, roughness: 0.3 }), 0, 0.35, 0.38);
  g.add(lbl);
  const halo = glowSprite(0xffc21a, 2.4, 2.4, 0.7); halo.position.y = 0.45; g.add(halo);
  return g;
}

const puGeo = {};
export function createPowerup(kind, color) {
  const g = new THREE.Group();
  let core;
  if (kind === 'shield') {
    core = mesh(puGeo.oct ||= new THREE.OctahedronGeometry(0.5), neon(color, 1.5));
    core.scale.y = 1.4;
  } else if (kind === 'magnet') {
    core = new THREE.Group();
    const arc = mesh(puGeo.torus ||= new THREE.TorusGeometry(0.4, 0.13, 8, 16, Math.PI), neon(color, 1.5));
    arc.rotation.z = Math.PI;
    core.add(arc);
    for (const s of [-1, 1]) core.add(mesh(puGeo.tip ||= new THREE.BoxGeometry(0.26, 0.25, 0.26), mat(0xffffff), s * 0.4, 0.12, 0));
  } else if (kind === 'leverage') {
    core = mesh(puGeo.plane ||= new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshBasicMaterial({ map: labelTexture('2X', '#ffd23c', '#2a1036', 256, 160, 130), side: THREE.DoubleSide }));
  } else {
    core = mesh(puGeo.sphere ||= new THREE.SphereGeometry(0.45, 14, 10), neon(color, 1.2));
    core.add(mesh(puGeo.pupil ||= new THREE.SphereGeometry(0.2, 10, 8), mat(0x111111), 0, 0, 0.33));
  }
  g.add(core);
  const halo = glowSprite(color, 2.2, 2.2, 0.6);
  g.add(halo);
  return g; // core = children[0] (object refs must not live in userData: clone() JSON-copies it)
}

// ================================================================ OBSTACLES
// Each returns { obj, hit: { yMin, yMax, len, hw } }. hw = half width of the collision box,
// matched to the visible object.

export function createFud() {
  // low striped barrier — JUMP
  const g = new THREE.Group();
  const board = mesh(new RoundedBoxGeometry(2.0, 0.5, 0.2, 2, 0.05), new THREE.MeshStandardMaterial({ map: hazardTexture('FUD'), roughness: 0.5, emissive: 0x220008 }), 0, 0.58, 0);
  g.add(board);
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), mat(0xcccccc, { metalness: 0.6 }), s * 0.85, 0.42, 0));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), mat(0x333333), s * 0.85, 0.03, 0));
    g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), neon(0xffa000, 3), s * 0.85, 0.92, 0));
  }
  return { obj: bake(g), hit: { yMin: 0, yMax: 0.86, len: 0.4, hw: 1.0 } };
}

export function createBar() {
  // overhead laser "liquidation line" — SLIDE
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), mat(0x2a2a3a, { metalness: 0.6, roughness: 0.3 }), s * 1.05, 1.3, 0));
    g.add(mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), neon(0xff4fd8, 2), s * 1.05, 1.3, 0));
  }
  g.add(mesh(new THREE.BoxGeometry(2.1, 0.07, 0.07), neon(0xff2d8a, 4), 0, 1.3, 0)); // the laser
  g.add(mesh(new THREE.BoxGeometry(2.1, 0.035, 0.035), neon(0xff2d8a, 4), 0, 1.55, 0));
  const sign = mesh(new RoundedBoxGeometry(2.1, 0.62, 0.12, 2, 0.04), new THREE.MeshStandardMaterial({ map: labelTexture('LIQUIDATION LINE\n▼ SLIDE ▼', '#14002a', '#ff4fd8', 512, 150, 56), emissive: 0xffffff, emissiveIntensity: 0.35, emissiveMap: labelTexture('LIQUIDATION LINE\n▼ SLIDE ▼', '#14002a', '#ff4fd8', 512, 150, 56) }), 0, 2.1, 0);
  g.add(sign);
  const glow = glowSprite(0xff2d8a, 3.2, 0.9, 0.55); glow.position.y = 1.3; g.add(glow);
  return { obj: bake(g), hit: { yMin: 1.12, yMax: 2.5, len: 0.4, hw: 1.05 } };
}

export function createAirdrop() {
  // "FREE $HB" crate on a parachute… it's a scam (label flips on landing). JUMP or dodge.
  const g = new THREE.Group();
  const crate = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ map: crateTexture('', ''), roughness: 0.8 });
  const free = new THREE.MeshStandardMaterial({ map: crateTexture('FREE\n$HB', '#ffd23c'), roughness: 0.6, emissive: 0x332200, emissiveIntensity: 0.6 });
  const box = mesh(new RoundedBoxGeometry(1.35, 1.0, 1.15, 2, 0.06), side, 0, 0.5, 0);
  crate.add(box);
  // label panel on the face that comes at the player
  const panel = mesh(new THREE.PlaneGeometry(1.2, 0.88), free, 0, 0.5, 0.58);
  panel.name = 'label';
  crate.add(panel);
  // striped parachute
  const chuteGeo = new THREE.SphereGeometry(1.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.3);
  const chute = mesh(chuteGeo, mat(0xff4fd8, { side: THREE.DoubleSide, emissive: 0x551144, roughness: 0.7, flatShading: true }), 0, 3.15, 0);
  chute.scale.y = 0.75;
  chute.name = 'chute';
  crate.add(chute);
  const lines = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const line = mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.3), mat(0xffffff), sx * 0.6, 2.05, sz * 0.5);
    line.rotation.z = -sx * 0.2; line.rotation.x = sz * 0.17;
    lines.add(line);
  }
  const ropes = bake(lines);
  ropes.name = 'lines'; // parachute-only parts: 'chute' + 'lines' (hidden after landing)
  crate.add(ropes);
  const sparkle = glowSprite(0xffd23c, 2.6, 2.6, 0.5); sparkle.position.y = 0.5; sparkle.name = 'bait';
  crate.add(sparkle);
  g.add(crate);
  return { obj: g, hit: { yMin: 0, yMax: 1.0, len: 1.15, hw: 0.72 } };
}
export const SCAM_MAT = () => new THREE.MeshStandardMaterial({ map: crateTexture('SCAM\n☠', '#ff2d55'), roughness: 0.6, emissive: 0x330008, emissiveIntensity: 0.8 });

export function createRug() {
  // A nice rug across the lane. As you approach it's yanked away, revealing a pit. JUMP or switch.
  const g = new THREE.Group();
  const len = 3.4, w = 2.0, depth = 2.2;
  // pit: open box with inner walls that glow red at the lip (static, baked into one group)
  const pitG = new THREE.Group();
  pitG.add(mesh(new THREE.BoxGeometry(w, depth, len, 1, 1, 1), new THREE.MeshBasicMaterial({ map: pitTexture(), side: THREE.BackSide }), 0, -depth / 2 + 0.005, 0));
  const floor = mesh(new THREE.PlaneGeometry(w, len), new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, -depth + 0.02, 0);
  floor.rotation.x = -Math.PI / 2;
  pitG.add(floor);
  for (const z of [-1, 1]) pitG.add(mesh(new THREE.BoxGeometry(w + 0.1, 0.03, 0.12), neon(0xff2d55, 2.5), 0, 0.02, z * (len / 2 + 0.05)));
  for (const x of [-1, 1]) pitG.add(mesh(new THREE.BoxGeometry(0.06, 0.03, len), neon(0xff2d55, 1.5), x * (w / 2 + 0.03), 0.02, 0));
  g.add(bake(pitG));
  // the rug itself (animated as one piece when it gets pulled)
  const rugG = new THREE.Group();
  rugG.add(mesh(new THREE.BoxGeometry(w + 0.1, 0.04, len + 0.1), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.95 }), 0, 0.04, 0));
  const tassel = new THREE.BoxGeometry(0.035, 0.02, 0.22);
  for (let i = -5; i <= 5; i++) {
    rugG.add(mesh(tassel, mat(0xffd23c), i * 0.18, 0.04, len / 2 + 0.16));
    rugG.add(mesh(tassel, mat(0xffd23c), i * 0.18, 0.04, -len / 2 - 0.16));
  }
  const rug = bake(rugG);
  rug.name = 'rug';
  g.add(rug);
  return { obj: g, hit: { pit: true, yMin: -1, yMax: 0.12, len, hw: 0.85 } };
}

export function createCrash(length, moving = false) {
  // giant red candlestick — dodge only. Moving ones are "DUMP" candles that slide toward you.
  const g = new THREE.Group();
  const red = mat(0xe0193a, { emissive: 0x7a0012, emissiveIntensity: 1.1, roughness: 0.35 });
  g.add(mesh(new RoundedBoxGeometry(1.85, 3.0, length, 2, 0.12), red, 0, 1.85, 0));
  // dark edge trims so the candle reads as a 3D bar against red-lit streets
  for (const y of [0.37, 3.33]) g.add(mesh(new THREE.BoxGeometry(1.9, 0.08, length + 0.02), mat(0x5a0010), 0, y, 0));
  // wicks
  g.add(mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), mat(0xff6680, { emissive: 0xff2244, emissiveIntensity: 1 }), 0, 3.9, length / 2 - 0.6));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.4, 0.16), mat(0xff6680, { emissive: 0xff2244, emissiveIntensity: 1 }), 0, 0.2, length / 2 - 0.6));
  const label = moving ? 'DUMP' : '-69%';
  g.add(mesh(new THREE.PlaneGeometry(1.7, 0.95), new THREE.MeshBasicMaterial({ map: labelTexture(label, '#e0193a', '#fff', 256, 140, 100) }), 0, 2.15, length / 2 + 0.01));
  g.add(mesh(new THREE.BoxGeometry(1.9, 0.12, 0.05), neon(0xffffff, 2), 0, 0.55, length / 2 + 0.02));
  const hit = { yMin: 0, yMax: 3.4, len: length, hw: 0.93 };
  const body = bake(g);
  if (!moving) return { obj: body, hit };
  // DUMP candle: blinking warning lights (animated, kept separate) + a red glow on the road ahead
  for (const s of [-1, 1]) {
    const light = mesh(new THREE.SphereGeometry(0.14, 10, 8), neon(0xffb000, 4), s * 0.7, 3.45, length / 2 - 0.2);
    light.name = 'warn';
    body.add(light);
  }
  const floorGlow = mesh(new THREE.PlaneGeometry(1.9, 6), new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.03, length / 2 + 3);
  floorGlow.rotation.x = -Math.PI / 2;
  body.add(floorGlow);
  return { obj: body, hit };
}

const markerGeo = new THREE.ConeGeometry(0.3, 0.6, 4);
markerGeo.rotateX(Math.PI);
export function createIntelMarker() {
  const m = mesh(markerGeo, neon(0x7dff5a, 3), 0, 4.4, 0);
  m.visible = false;
  return m;
}

// ================================================================ SCENERY
// Street scenery is instanced: see src/scenery.js. Gates and the golden bull are one-offs.
export function createGate(title, color) {
  const g = new THREE.Group();
  const hex = '#' + color.toString(16).padStart(6, '0');
  for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.6, 7, 0.6), neon(color, 1.5), s * 4.2, 3.5, 0));
  const face = new THREE.MeshBasicMaterial({ map: labelTexture(title, '#0d0620', hex, 1024, 200, 120) });
  g.add(mesh(new THREE.BoxGeometry(9, 1.8, 0.3), mat(0x111111), 0, 7, 0));
  g.add(mesh(new THREE.PlaneGeometry(9, 1.8), face, 0, 7, 0.16));
  return g;
}

// The golden bull at the end of Bull City (deck p.5 key art)
export function createBull() {
  const g = new THREE.Group();
  const gold = mat(0xffc21a, { metalness: 0.55, roughness: 0.3, emissive: 0x8a5800, emissiveIntensity: 0.9 });
  g.add(mesh(new THREE.CylinderGeometry(4, 4.6, 2, 32), mat(0x2a1d3a, { metalness: 0.4 }), 0, 1, 0));
  g.add(mesh(new THREE.TorusGeometry(4.3, 0.12, 8, 48).rotateX(Math.PI / 2), neon(0xffd23c, 2.5), 0, 2, 0));
  const torso = mesh(new THREE.SphereGeometry(2, 24, 16), gold, 0, 4.6, 0.4); torso.scale.set(0.9, 0.75, 1.7); g.add(torso);
  const chest = mesh(new THREE.SphereGeometry(1.9, 20, 14), gold, 0, 5.0, -1.8); chest.scale.set(1, 0.95, 0.9); g.add(chest);
  const head = mesh(new THREE.SphereGeometry(1.1, 18, 14), gold, 0, 5.2, -3.6); head.scale.set(0.95, 0.9, 1.25); head.rotation.x = 0.4; g.add(head);
  const snout = mesh(new THREE.SphereGeometry(0.7, 14, 10), gold, 0, 4.6, -4.5); snout.scale.set(1.1, 0.8, 0.9); g.add(snout);
  for (const s of [-1, 1]) {
    const horn = mesh(new THREE.ConeGeometry(0.3, 2.0, 12), gold, s * 1.25, 6.2, -3.6);
    horn.rotation.z = -s * 1.0; horn.rotation.x = -0.4;
    g.add(horn);
    for (const z of [-1.8, 2.0]) g.add(mesh(new THREE.CylinderGeometry(0.42, 0.34, 2.6, 12), gold, s * 0.95, 2.6, z));
    g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(0x220000, { emissive: 0xff2200, emissiveIntensity: 1.5 }), s * 0.55, 5.45, -4.3));
  }
  const tail = mesh(new THREE.CylinderGeometry(0.08, 0.14, 2.4), gold, 0, 4.6, 3.6); tail.rotation.x = -0.9; g.add(tail);
  const glow = glowSprite(0xffc21a, 24, 16, 0.55); glow.position.y = 5; g.add(glow);
  return g;
}
