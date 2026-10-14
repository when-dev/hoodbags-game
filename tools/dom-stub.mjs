// Minimal DOM / browser stubs so src/main.js can run its real game loop in Node (no WebGL, no
// browser). Used by tools/sim-harness.mjs and test/sim.test.js. This exercises gameplay, animation,
// spawning and lifecycle code; it does NOT exercise WebGL rendering, CSS, audio output or input
// devices.
import * as THREE from 'three';

class ClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  toggle(c, on) { const v = on === undefined ? !this.s.has(c) : on; v ? this.s.add(c) : this.s.delete(c); return v; }
  contains(c) { return this.s.has(c); }
}

class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id;
    this.classList = new ClassList();
    this.style = { setProperty() {} };
    this.dataset = {};
    this.children = [];
    this.textContent = ''; this.innerHTML = ''; this.value = ''; this.src = '';
    this.width = 0; this.height = 0;
  }
  addEventListener() {} removeEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  animate() { return { cancel() {} }; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 40 }; }
  closest() { return null; }
  focus() {} blur() {}
  get offsetWidth() { return 0; }
  getContext(kind) { return kind === '2d' ? ctx2d() : null; }
}

function ctx2d() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export function installDom({ touch = false, width = 1280, height = 720, dpr = 1 } = {}) {
  const els = new Map();
  const byId = (id) => { if (!els.has(id)) els.set(id, new FakeElement('div', id)); return els.get(id); };
  const target = new EventTarget();
  const g = globalThis;
  g.window = g;
  g.addEventListener = target.addEventListener.bind(target);
  g.removeEventListener = target.removeEventListener.bind(target);
  g.dispatchEvent = target.dispatchEvent.bind(target);
  g.innerWidth = width; g.innerHeight = height; g.devicePixelRatio = dpr;
  g.matchMedia = (q) => ({ matches: q.includes('coarse') ? touch : false, addEventListener() {} });
  g.location = { search: '' };
  const store = new Map();
  g.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  g.requestAnimationFrame = () => 0;
  const docTarget = new EventTarget();
  g.document = {
    hidden: false,
    body: new FakeElement('body'),
    fonts: { load: () => Promise.resolve() },
    getElementById: byId,
    querySelector: (sel) => byId('q:' + sel),
    querySelectorAll: () => [],
    createElement: (tag) => new FakeElement(tag),
    addEventListener: docTarget.addEventListener.bind(docTarget),
    dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
  };
  return { els, byId };
}

// Stub renderer: counts what three.js WebGLRenderer would draw (visible + inside the frustum),
// so draw-call and triangle numbers are estimates of the real renderer's object list.
export function stubRenderer() {
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [], autoReset: true, reset() { info.render.calls = 0; info.render.triangles = 0; } };
  const tris = (geo, n = 1) => ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * n;
  const r = {
    domElement: new FakeElement('canvas'),
    info, toneMapping: 0, toneMappingExposure: 1, outputColorSpace: 'srgb',
    pixelRatio: 1, width: 0, height: 0,
    setPixelRatio(p) { r.pixelRatio = p; }, getPixelRatio() { return r.pixelRatio; },
    setSize(w, h) { r.width = w; r.height = h; },
    getDrawingBufferSize(v) { return v.set(r.width * r.pixelRatio, r.height * r.pixelRatio); },
    render(scene, camera) {
      camera.updateMatrixWorld();
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(m);
      scene.updateMatrixWorld();
      const geos = new Set();
      scene.traverseVisible((o) => {
        if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
        if (o.isInstancedMesh && o.count === 0) return;
        if (o.frustumCulled && !o.isInstancedMesh) {
          if (o.isSprite) { sphere.set(o.getWorldPosition(new THREE.Vector3()), Math.max(o.scale.x, o.scale.y)); }
          else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); }
          if (!frustum.intersectsSphere(sphere)) return;
        }
        const calls = Array.isArray(o.material) ? Math.max(1, o.geometry.groups.length) : 1;
        info.render.calls += calls;
        if (o.geometry) { geos.add(o.geometry); info.render.triangles += o.isSprite ? 2 : tris(o.geometry, o.isInstancedMesh ? o.count : 1); }
      });
      info.memory.geometries = geos.size;
    },
    compile() {}, dispose() {},
  };
  return r;
}
