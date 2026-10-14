import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstancePool, PoolSet } from '../src/instancing.js';

const pool = (cap = 64, colors = true) => new InstancePool(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), cap, { colors });

test('instance pool: add/remove keeps handles consistent (random churn)', () => {
  const p = pool(64);
  const live = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5000; i++) {
    if (live.length && (rnd() < 0.45 || live.length >= 64)) {
      const h = live.splice((rnd() * live.length) | 0, 1)[0];
      p.remove(h);
      assert.equal(h.slot, -1);
    } else {
      const h = p.add(i, 0, 0, 0, 0, 0, 1, 1, 1, 0xff0000);
      live.push(h);
    }
    assert.equal(p.count, live.length);
    assert.ok(p.validate(), `bookkeeping broken at step ${i}`);
  }
});

test('instance pool: removing moves the last instance matrix into the freed slot', () => {
  const p = pool(8);
  const a = p.add(1, 0, 0), b = p.add(2, 0, 0), c = p.add(3, 0, 0);
  p.remove(a);
  const m = new THREE.Matrix4();
  p.mesh.getMatrixAt(c.slot, m);
  assert.equal(c.slot, 0);
  assert.equal(new THREE.Vector3().setFromMatrixPosition(m).x, 3);
  assert.equal(b.slot, 1);
});

test('instance pool: double remove and foreign handles are ignored; overflow is counted, not thrown', () => {
  const p = pool(2), q = pool(2);
  const a = p.add(0, 0, 0);
  p.remove(a); p.remove(a);
  assert.equal(p.count, 0);
  const b = q.add(0, 0, 0);
  p.remove(b);
  assert.equal(q.count, 1);
  p.add(0, 0, 0); p.add(0, 0, 0);
  assert.equal(p.add(0, 0, 0), null);
  assert.equal(p.overflow, 1);
});

test('instance pool: HDR colour intensity is stored (neon glow > 1)', () => {
  const p = pool(4);
  const h = p.add(0, 0, 0, 0, 0, 0, 1, 1, 1, 0xff0000, 2.5);
  const c = new THREE.Color();
  p.mesh.getColorAt(h.slot, c);
  assert.ok(Math.abs(c.r - 2.5) < 1e-6);
});

test('pool set: clear() empties every pool and invalidates handles', () => {
  const set = new PoolSet(new THREE.Group());
  const p1 = set.get('a', () => pool(8)), p2 = set.get('b', () => pool(8));
  assert.equal(set.get('a', () => { throw new Error('should be cached'); }), p1);
  const hs = [p1.add(0, 0, 0), p2.add(0, 0, 0), p2.add(0, 0, 0)];
  set.clear();
  assert.ok(hs.every((h) => h.slot === -1));
  assert.deepEqual(set.stats(), { pools: 2, drawnPools: 0, instances: 0, overflow: 0 });
});
