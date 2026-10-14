// Lightweight pooled effects: coin sparkles, pickup rings, confetti, hoverboard trail.
// Sparks are one InstancedMesh of camera-facing quads (1 draw call for all of them); only live
// particles are written each frame. Nothing is allocated per frame.
import * as THREE from 'three';
import { sparkleTexture, trailTexture } from './textures.js';

export const MAX_SPARKS = 64;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.density = 1; // set from the quality preset (decorative particle budget)
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_SPARKS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // particle state in flat typed arrays
    this.n = 0;
    const F = () => new Float32Array(MAX_SPARKS);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.max = F(); this.size = F(); this.grav = F();
    this.col = new Uint32Array(MAX_SPARKS); this.drift = new Uint8Array(MAX_SPARKS);

    this.rings = [];
    const rgeo = new THREE.TorusGeometry(1, 0.05, 6, 40);
    rgeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(rgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      r.visible = false;
      r.userData = { life: 0, max: 0.5 };
      scene.add(r);
      this.rings.push(r);
    }
  }

  active() { return this.n + this.rings.filter((r) => r.visible).length; }

  spark(x, y, z, { color = 0xffd86b, count = 3, speed = 2.5, size = 0.55, life = 0.35, grav = 0, drift = true, essential = false } = {}) {
    const k = essential ? count : Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < k; i++) {
      if (this.n >= MAX_SPARKS) return; // hard cap: drop decorative extras, never grow
      const j = this.n++;
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.8;
      this.px[j] = x; this.py[j] = y; this.pz[j] = z;
      this.vx[j] = Math.cos(a) * speed * Math.cos(e); this.vy[j] = Math.sin(e) * speed + speed * 0.4; this.vz[j] = Math.sin(a) * speed * Math.cos(e) * 0.5;
      this.max[j] = life; this.life[j] = life * (0.8 + Math.random() * 0.4);
      this.size[j] = size * (0.7 + Math.random() * 0.6); this.grav[j] = grav; this.col[j] = color; this.drift[j] = drift ? 1 : 0;
    }
  }

  ring(x, y, z, color, max = 0.5) {
    const r = this.rings.find((q) => !q.visible) || this.rings[0];
    r.position.set(x, y, z);
    r.material.color.setHex(color);
    r.userData.life = r.userData.max = max;
    r.visible = true;
  }

  confetti(x, y, z, count = 30) {
    const k = Math.max(4, Math.round(count * this.density));
    for (let i = 0; i < k; i++) {
      this.spark(x + (Math.random() - 0.5) * 8, y + 3 + Math.random() * 4, z + (Math.random() - 0.5) * 6,
        { color: Math.random() < 0.7 ? 0xffd23c : 0xff4fd8, count: 1, speed: 0.6, size: 0.7, life: 1.8, grav: -4, essential: true });
    }
  }

  // dz: world scroll this frame (sparks drift back a little so they read as left behind)
  update(dt, dz, camera) {
    for (let j = 0; j < this.n; j++) {
      this.life[j] -= dt;
      if (this.life[j] <= 0) {
        // swap-remove keeps the live set packed at the front
        const l = --this.n;
        if (j !== l) {
          this.px[j] = this.px[l]; this.py[j] = this.py[l]; this.pz[j] = this.pz[l]; this.vx[j] = this.vx[l]; this.vy[j] = this.vy[l]; this.vz[j] = this.vz[l];
          this.life[j] = this.life[l]; this.max[j] = this.max[l]; this.size[j] = this.size[l]; this.grav[j] = this.grav[l]; this.col[j] = this.col[l]; this.drift[j] = this.drift[l];
        }
        j--;
        continue;
      }
      this.vy[j] += this.grav[j] * dt;
      this.px[j] += this.vx[j] * dt; this.py[j] += this.vy[j] * dt;
      this.pz[j] += this.vz[j] * dt + (this.drift[j] ? dz * 0.3 : 0);
    }
    if (camera) _q.copy(camera.quaternion);
    for (let j = 0; j < this.n; j++) {
      const t = this.life[j] / this.max[j];
      const sz = this.size[j] * (0.4 + t * 0.6);
      _m.compose(_p.set(this.px[j], this.py[j], this.pz[j]), _q, _s.set(sz, sz, sz));
      this.mesh.setMatrixAt(j, _m);
      // additive blending: fading the colour is the same as fading alpha
      _c.setHex(this.col[j]).multiplyScalar(Math.min(1, t * 1.6));
      this.mesh.setColorAt(j, _c);
    }
    this.mesh.count = this.n;
    if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }

    for (const r of this.rings) {
      if (!r.visible) continue;
      const u = r.userData;
      u.life -= dt;
      if (u.life <= 0) { r.visible = false; continue; }
      const t = 1 - u.life / u.max;
      r.scale.setScalar(0.6 + t * 2.4);
      r.material.opacity = 1 - t;
    }
  }

  clear() {
    this.n = 0; this.mesh.count = 0;
    for (const r of this.rings) r.visible = false;
  }
}

// Two thruster ribbons behind the hoverboard merged into ONE mesh; length follows speed,
// colour follows power-ups.
export function createTrail() {
  const ribbon = (x) => { const g = new THREE.PlaneGeometry(0.16, 1); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2); g.translate(x, 0, 0); return g; };
  const a = ribbon(-0.22), b = ribbon(0.22);
  const geo = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const A = a.attributes[name].array, B = b.attributes[name].array;
    const arr = new Float32Array(A.length + B.length); arr.set(A); arr.set(B, A.length);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const off = a.attributes.position.count;
  geo.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + off)]);
  a.dispose(); b.dispose();
  const m = new THREE.MeshBasicMaterial({ map: trailTexture(), color: 0x29e6ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(0, 0.2, 1.1);
  mesh.userData.mat = m;
  return mesh;
}
