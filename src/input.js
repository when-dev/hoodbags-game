// Keyboard input: maps physical keys to game actions and decides when an event is consumed.
// Pure (no DOM access beyond the event object) so it can be unit-tested in Node.
//
// Keys are matched by `event.code` (the physical key) first. `event.key` depends on the active
// keyboard layout: on a Ukrainian/Russian layout W/A/S/D report 'ц'/'ф'/'і'/'в', which is why
// WASD used to do nothing while the arrow keys (layout-independent names) worked.

export const KEY_ACTIONS = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
  KeyS: 'slide', ArrowDown: 'slide',
  KeyP: 'pause', Escape: 'pause',
};
// fallback for events without `code` (very old browsers, some synthetic events)
const KEY_FALLBACK = {
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
  w: 'jump', arrowup: 'jump', ' ': 'jump', spacebar: 'jump',
  s: 'slide', arrowdown: 'slide', p: 'pause', escape: 'pause', esc: 'pause',
};

export function actionFor(e) {
  if (e.code && KEY_ACTIONS[e.code]) return KEY_ACTIONS[e.code];
  if (typeof e.key === 'string') return KEY_FALLBACK[e.key.toLowerCase()] || null;
  return null;
}

export function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

const keyId = (e) => e.code || (typeof e.key === 'string' ? e.key.toLowerCase() : '');

// handlers: { left, right, jump, slide, pause }
// canAct(action): whether the current game state accepts that action (gameplay vs pause rules)
export class KeyboardInput {
  constructor(handlers, canAct) {
    this.handlers = handlers;
    this.canAct = canAct;
    this.held = new Set();
  }
  // returns true when the event was consumed (the caller then calls preventDefault)
  keydown(e) {
    if (isEditable(e.target)) return false; // typing a name must never steer Naz
    const action = actionFor(e);
    if (!action) return false;
    const id = keyId(e);
    // holding a key (OS auto-repeat) must not machine-gun actions, even where e.repeat is unset
    if (e.repeat || this.held.has(id)) return this.canAct(action);
    this.held.add(id);
    if (!this.canAct(action)) return false;
    this.handlers[action]();
    return true;
  }
  keyup(e) { this.held.delete(keyId(e)); }
  // window blur / tab hidden / pause / restart: forget held keys so nothing sticks
  clear() { this.held.clear(); }
}
