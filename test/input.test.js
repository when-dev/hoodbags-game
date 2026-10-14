import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardInput, actionFor, isEditable } from '../src/input.js';

const ev = (code, key, extra = {}) => ({ code, key, repeat: false, target: { tagName: 'BODY' }, ...extra });

function rig(state = 'running') {
  const calls = [];
  const h = {};
  for (const a of ['left', 'right', 'jump', 'slide', 'pause']) h[a] = () => calls.push(a);
  const st = { state };
  const kb = new KeyboardInput(h, (a) => (a === 'pause' ? st.state === 'running' || st.state === 'paused' : st.state === 'running'));
  const press = (code, key, extra) => { const e = ev(code, key, extra); const used = kb.keydown(e); kb.keyup(e); return used; };
  return { kb, calls, st, press };
}

test('A / ArrowLeft move left, D / ArrowRight move right', () => {
  const { calls, press } = rig();
  press('KeyA', 'a'); press('ArrowLeft', 'ArrowLeft'); press('KeyD', 'd'); press('ArrowRight', 'ArrowRight');
  assert.deepEqual(calls, ['left', 'left', 'right', 'right']);
});

test('W / ArrowUp / Space jump, S / ArrowDown slide, P / Escape pause', () => {
  const { calls, press } = rig();
  for (const [c, k] of [['KeyW', 'w'], ['ArrowUp', 'ArrowUp'], ['Space', ' '], ['KeyS', 's'], ['ArrowDown', 'ArrowDown'], ['KeyP', 'p'], ['Escape', 'Escape']]) press(c, k);
  assert.deepEqual(calls, ['jump', 'jump', 'jump', 'slide', 'slide', 'pause', 'pause']);
});

test('root cause: WASD works on non-Latin layouts (physical key code wins over the typed character)', () => {
  const { calls, press } = rig();
  // Ukrainian layout: the physical W A S D keys type ц ф і в
  press('KeyW', 'ц'); press('KeyA', 'ф'); press('KeyS', 'і'); press('KeyD', 'в');
  assert.deepEqual(calls, ['jump', 'left', 'slide', 'right']);
  // the old e.key-based lookup would have ignored all four
  assert.equal(actionFor({ key: 'ф' }), null);
});

test('Caps Lock / Shift and events without a code still map via the key fallback', () => {
  assert.equal(actionFor({ key: 'A' }), 'left');
  assert.equal(actionFor({ key: 'D' }), 'right');
  assert.equal(actionFor({ key: ' ' }), 'jump');
  assert.equal(actionFor({ code: 'KeyQ', key: 'q' }), null);
});

test('typing in editable fields never triggers actions', () => {
  const { kb, calls } = rig();
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    assert.equal(kb.keydown(ev('KeyA', 'a', { target })), false);
  }
  assert.deepEqual(calls, []);
  assert.ok(isEditable({ tagName: 'INPUT' }) && !isEditable({ tagName: 'CANVAS' }) && !isEditable(null));
});

test('menus, countdown, game over: gameplay keys ignored and not consumed (no preventDefault)', () => {
  for (const state of ['menu', 'countdown', 'dead', 'dying', 'won', 'finale']) {
    const { calls, press } = rig(state);
    assert.equal(press('KeyA', 'a'), false, state);
    assert.equal(press('ArrowDown', 'ArrowDown'), false, state);
    assert.equal(press('Escape', 'Escape'), false, state);
    assert.deepEqual(calls, [], state);
  }
});

test('pause: gameplay keys ignored, pause key still resumes', () => {
  const { calls, press } = rig('paused');
  assert.equal(press('KeyD', 'd'), false);
  assert.equal(press('KeyP', 'p'), true);
  assert.deepEqual(calls, ['pause']);
});

test('held key / auto-repeat fires once; rapid separate presses all fire', () => {
  const { kb, calls } = rig();
  kb.keydown(ev('KeyD', 'd'));
  for (let i = 0; i < 10; i++) kb.keydown(ev('KeyD', 'd', { repeat: i % 2 === 0 })); // some OSes omit repeat
  assert.deepEqual(calls, ['right']);
  kb.keyup(ev('KeyD', 'd'));
  for (let i = 0; i < 3; i++) { kb.keydown(ev('KeyA', 'a')); kb.keyup(ev('KeyA', 'a')); }
  assert.deepEqual(calls, ['right', 'left', 'left', 'left']);
});

test('losing focus clears held keys (a key released outside the window cannot stick)', () => {
  const { kb, calls } = rig();
  kb.keydown(ev('KeyA', 'a'));
  assert.equal(kb.held.size, 1);
  kb.clear(); // window blur: the keyup never arrives
  assert.equal(kb.held.size, 0);
  kb.keydown(ev('KeyA', 'a'));
  assert.deepEqual(calls, ['left', 'left']);
});

test('held arrow keys stay consumed while running (no page scroll), released when not', () => {
  const { kb, st } = rig();
  assert.equal(kb.keydown(ev('ArrowDown', 'ArrowDown')), true);
  assert.equal(kb.keydown(ev('ArrowDown', 'ArrowDown', { repeat: true })), true);
  st.state = 'menu';
  assert.equal(kb.keydown(ev('ArrowDown', 'ArrowDown', { repeat: true })), false);
});
