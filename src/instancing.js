// InstancePool: one InstancedMesh holding many copies of a shape. Instances are densely packed;
// removing one moves the last instance into its slot (O(1)), and the handle of the moved instance
// is updated. Matrices are written only on add/remove, never per frame, so static scenery costs
// one draw call per pool regardless of how many copies are alive.
import * as THREE from 'three';

const _o = new THREE.Object3D();
const _c = new THREE.Color();

export class InstancePool {
  constructor(geometry, material, capacity, { colors = false, name = '' } = {}) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    // the pools span the whole corridor and are always on screen; skip per-instance bounds work
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.handles = new Array(capacity);
    this.overflow = 0;
  }
  get count() { return this.mesh.count; }

  // position, euler rotation, scale; color is a hex or {r,g,b}; intensity scales the color (HDR ok)
  add(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color = null, intensity = 1) {
    if (this.mesh.count >= this.capacity) { this.overflow++; return null; }
    const slot = this.mesh.count++;
    _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.set(sx, sy, sz);
    _o.updateMatrix();
    this.mesh.setMatrixAt(slot, _o.matrix);
    if (this.mesh.instanceColor) {
      if (color === null) _c.setRGB(1, 1, 1); else if (typeof color === 'number') _c.setHex(color); else _c.copy(color);
      _c.multiplyScalar(intensity);
      this.mesh.setColorAt(slot, _c);
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    const h = { pool: this, slot };
    this.handles[slot] = h;
    return h;
  }

  // overwrite the transform of a live instance (used by animated instances such as coins)
  setMatrix(h, matrix) { if (h && h.slot >= 0) { this.mesh.setMatrixAt(h.slot, matrix); this.mesh.instanceMatrix.needsUpdate = true; } }

  remove(h) {
    if (!h || h.slot < 0 || h.pool !== this) return;
    const last = this.mesh.count - 1, slot = h.slot;
    if (slot !== last) {
      const im = this.mesh.instanceMatrix.array;
      im.copyWithin(slot * 16, last * 16, last * 16 + 16);
      if (this.mesh.instanceColor) { const ic = this.mesh.instanceColor.array; ic.copyWithin(slot * 3, last * 3, last * 3 + 3); this.mesh.instanceColor.needsUpdate = true; }
      const moved = this.handles[last];
      this.handles[slot] = moved; moved.slot = slot;
    }
    this.handles[last] = undefined;
    h.slot = -1;
    this.mesh.count = last;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.mesh.count; i++) { if (this.handles[i]) this.handles[i].slot = -1; this.handles[i] = undefined; }
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // bookkeeping check used by tests: every live slot has a handle that points back at it
  validate() {
    for (let i = 0; i < this.mesh.count; i++) if (!this.handles[i] || this.handles[i].slot !== i) return false;
    for (let i = this.mesh.count; i < this.capacity; i++) if (this.handles[i]) return false;
    return true;
  }
}

// A registry of pools sharing one parent (the scrolling world group).
export class PoolSet {
  constructor(parent) { this.parent = parent; this.pools = new Map(); }
  get(key, make) {
    let p = this.pools.get(key);
    if (!p) { p = make(); this.pools.set(key, p); this.parent.add(p.mesh); }
    return p;
  }
  clear() { for (const p of this.pools.values()) p.clear(); }
  stats() {
    let live = 0, pools = 0, overflow = 0;
    for (const p of this.pools.values()) { live += p.count; if (p.count) pools++; overflow += p.overflow; }
    return { pools: this.pools.size, drawnPools: pools, instances: live, overflow };
  }
}
