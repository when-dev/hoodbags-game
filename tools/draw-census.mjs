// Breaks the estimated draw calls down by owner (characters, obstacles, scenery pools, ...).
// node tools/draw-census.mjs
import { installDom, stubRenderer } from './dom-stub.mjs';
installDom();
globalThis.__HB_RENDERER__ = stubRenderer;
await import('../src/main.js');
await new Promise((r) => setTimeout(r, 50));
const hb = globalThis.__hb;
hb.clock.getDelta = () => 1 / 60;
const count = (o) => { let n = 0; o.traverseVisible((c) => { if ((c.isMesh || c.isSprite) && !(c.isInstancedMesh && c.count === 0)) n += Array.isArray(c.material) ? c.geometry.groups.length : 1; }); return n; };
hb.startRun('story', 1); hb.G.state = 'running';
for (let i = 0; i < 600; i++) { hb.G.player.invuln = 1; hb.tick(); }
hb.G.liqChase = 6; hb.G.eazyT = 3;
for (let i = 0; i < 120; i++) { hb.G.player.invuln = 1; hb.tick(); }
const rows = [];
for (const c of hb.scene.children) {
  if (c === hb.world) continue;
  rows.push({ owner: c.name || c.type + (c.isInstancedMesh ? '(inst)' : ''), drawables: count(c), visible: c.visible });
}
const w = { obstacles: 0, pickups: 0, pools: 0, other: 0 };
for (const c of hb.world.children) {
  const n = count(c);
  if (hb.G.obstacles.some((o) => o.obj === c)) w.obstacles += n;
  else if (hb.G.pickups.includes(c)) w.pickups += n;
  else if (c.isInstancedMesh) w.pools += n;
  else w.other += n;
}
console.table(rows.filter((r) => r.drawables));
console.log('world:', w, 'obstacles:', hb.G.obstacles.length);
console.log('naz', count(hb.scene.children.find((c) => c.userData && c.userData.board)));
process.exit(0);
