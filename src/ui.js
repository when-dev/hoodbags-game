// DOM overlays: HUD, menus, dialogs, local leaderboard.
import { POWERUPS } from './config.js';

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'howto', 'board', 'pause', 'gameover', 'victory'];
let handlers = {};
let backTo = 'menu';

function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
}

export function playerName() {
  return ($('nameInput').value.trim() || 'anon').slice(0, 16);
}

export function init(h) {
  handlers = h;
  $('nameInput').value = store('hb_name') || '';
  $('nameInput').addEventListener('change', () => store('hb_name', playerName()));
  $('playStory').onclick = () => { store('hb_name', playerName()); h.onStory(); };
  $('playEndless').onclick = () => { store('hb_name', playerName()); h.onEndless(); };
  $('openHow').onclick = () => { backTo = 'menu'; showScreen('howto'); };
  $('openBoard').onclick = () => { backTo = 'menu'; renderBoard('endless'); showScreen('board'); };
  document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => showScreen(backTo)));
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => renderBoard(t.dataset.mode)));
  $('resumeBtn').onclick = h.onResume;
  $('quitBtn').onclick = h.onQuit;
  $('retryBtn').onclick = h.onRetry;
  $('checkpointBtn').onclick = h.onCheckpoint;
  $('menuBtn').onclick = h.onQuit;
  $('winEndless').onclick = h.onEndless;
  $('winRetry').onclick = h.onStory;
  $('winMenu').onclick = h.onQuit;
  $('pauseBtn').onclick = h.onPause;
  $('muteBtn').textContent = h.muted ? '🔇' : '🔊';
  $('muteBtn').onclick = () => { $('muteBtn').textContent = h.onMute() ? '🔇' : '🔊'; };
  for (const id of ['qualityBtn', 'qualityBtnPause']) { const b = $(id); if (b) b.onclick = h.onQuality; }
  refreshBest();
}

export function showScreen(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  if (id === 'menu') refreshBest();
}
export function showHud(on) {
  $('hud').classList.toggle('hidden', !on);
  if (!on) {
    $('liqWarn').classList.remove('on');
    ['hint', 'combo', 'countdown'].forEach((id) => $(id).classList.add('hidden'));
    redAlert(0);
  }
}

// The HUD runs every frame: cache element refs, compare raw numbers before formatting, and keep
// one persistent chip per power-up instead of rebuilding innerHTML.
let lastHud = {};
const el = {};
const chips = {};
function hudEls() {
  if (el.score) return;
  for (const id of ['score', 'dist', 'coins', 'districtName', 'progressFill', 'liqWarn', 'liqChip', 'liqBar', 'powerups']) el[id] = $(id);
  for (const k of Object.keys(POWERUPS)) {
    const p = POWERUPS[k];
    const chip = document.createElement('div');
    chip.className = 'pu hidden';
    chip.style.setProperty('--c', '#' + p.color.toString(16).padStart(6, '0'));
    chip.innerHTML = `${p.icon} ${p.label}<span class="bar"><i></i></span>`;
    el.powerups.appendChild(chip);
    chips[k] = { chip, bar: chip.querySelector('i'), on: false, w: -1 };
  }
}
export function resetHud(mode, boundaries, total) {
  hudEls();
  lastHud = {};
  const prog = document.querySelector('.progress');
  prog.classList.toggle('endless', mode === 'endless');
  const ticks = prog.querySelectorAll('.ticks i');
  ticks.forEach((t, i) => (t.style.left = (boundaries[i] / total) * 100 + '%'));
  for (const c of Object.values(chips)) { c.on = false; c.w = -1; c.chip.classList.add('hidden'); }
  el.liqWarn.classList.remove('on');
  el.liqChip.classList.add('hidden');
  $('dialog').classList.add('hidden');
  $('banner').classList.add('hidden');
}

function setNum(id, v) {
  if (lastHud[id] === v) return;
  lastHud[id] = v;
  el[id].textContent = v.toLocaleString();
}

export function updateHud(s) {
  hudEls();
  setNum('score', s.score);
  setNum('dist', s.dist);
  setNum('coins', s.coins);
  const district = s.endless ? 'BULL RUN · ' + s.district : s.district;
  if (lastHud.district !== district) { lastHud.district = district; el.districtName.textContent = district; }
  const pct = Math.round(Math.min(100, s.progress * 100) * 4) / 4; // quarter-percent steps
  if (lastHud.pct !== pct) { lastHud.pct = pct; el.progressFill.style.width = pct + '%'; }
  const liqOn = s.liq > 0;
  if (lastHud.liq !== liqOn) { lastHud.liq = liqOn; el.liqWarn.classList.toggle('on', liqOn); el.liqChip.classList.toggle('hidden', !liqOn); }
  if (liqOn) { const w = Math.round(s.liq * 100); if (lastHud.liqW !== w) { lastHud.liqW = w; el.liqBar.style.width = w + '%'; } }
  for (const k in chips) {
    const c = chips[k], v = s.power[k];
    const on = v > 0;
    if (on !== c.on) { c.on = on; c.chip.classList.toggle('hidden', !on); }
    if (on) { const w = Math.round((v / POWERUPS[k].time) * 100); if (w !== c.w) { c.w = w; c.bar.style.width = w + '%'; } }
  }
}

export function setQualityLabel(text) {
  for (const id of ['qualityBtn', 'qualityBtnPause']) { const b = $(id); if (b) b.textContent = '⚙ GRAPHICS: ' + text; }
}

let lastBump = 0;
export function bumpCoins(big = false) {
  const now = performance.now();
  if (!big && now - lastBump < 120) return; // don't restart the animation on every coin
  lastBump = now;
  document.querySelector('.coins').animate([{ transform: `scale(${big ? 1.35 : 1.12})` }, { transform: 'scale(1)' }], { duration: big ? 300 : 160 });
}

export function combo(n) {
  const el = $('combo');
  el.textContent = `×${n} COMBO`;
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}

const HINTS = {
  jump: ['↑', 'JUMP', 'SWIPE UP'],
  slide: ['↓', 'SLIDE', 'SWIPE DOWN'],
  right: ['→', 'SWITCH LANE', 'SWIPE RIGHT'],
};
let hintTimer;
export function hint(type, touch) {
  const [arrow, word, swipe] = HINTS[type];
  const el = $('hint');
  el.innerHTML = `<span class="arrow">${arrow}</span><span>${touch ? swipe : word}</span>${touch ? '' : `<small>${type === 'jump' ? '↑ / W / SPACE' : type === 'slide' ? '↓ / S' : '→ / D'}</small>`}`;
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.add('hidden'), 1500);
}

let lastRed = -1;
export function redAlert(level) {
  const v = Math.round(level * 20) / 20;
  if (v === lastRed) return;
  lastRed = v;
  $('redAlert').style.opacity = v * 0.9;
}

export function districtFlash(color) {
  const el = $('wipe');
  el.style.setProperty('--c', '#' + color.toString(16).padStart(6, '0'));
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}

let dialogTimer;
export function say(who, text, ms = 3000) {
  const d = $('dialog');
  d.classList.toggle('liq', who === 'liq');
  $('dialogImg').src = `/assets/${who}.jpg`;
  $('dialogName').textContent = who === 'liq' ? 'LIQ' : 'EAZY';
  $('dialogText').textContent = text;
  d.classList.remove('hidden');
  d.style.animation = 'none'; void d.offsetWidth; d.style.animation = '';
  clearTimeout(dialogTimer);
  dialogTimer = setTimeout(() => d.classList.add('hidden'), ms);
}

let bannerTimer;
export function banner(kicker, title, sub) {
  const b = $('banner');
  $('bannerKicker').textContent = kicker;
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;
  b.classList.remove('hidden');
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), 3200);
}

// returns a cancel function so a restart never leaves a stale countdown running
export function countdown(done) {
  const el = $('countdown');
  const seq = ['3', '2', '1', 'GO!'];
  el.classList.remove('hidden');
  let i = 0, timer = null, cancelled = false;
  const tick = () => {
    if (cancelled) return;
    if (i >= seq.length) { el.classList.add('hidden'); return; }
    el.textContent = seq[i];
    el.animate([{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 250 });
    if (seq[i] === 'GO!') done();
    i++;
    timer = setTimeout(tick, i === seq.length ? 450 : 480);
  };
  tick();
  return () => { cancelled = true; clearTimeout(timer); el.classList.add('hidden'); };
}

// edge-only colour flash (never a full white screen)
export function flash(color = '#ffffff', strength = 0.8) {
  const f = $('flash');
  f.style.setProperty('--c', color);
  f.style.transition = 'none'; f.style.opacity = String(strength);
  requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity .4s'; f.style.opacity = '0'; }));
}

// ---------- results
export function gameOver(r) {
  $('overImg').src = `/assets/${r.img}.jpg`;
  $('overTitle').textContent = r.title;
  $('overSub').textContent = r.sub;
  $('overScore').textContent = r.score.toLocaleString();
  $('overCoins').textContent = r.coins.toLocaleString();
  $('overDist').textContent = r.dist.toLocaleString() + 'm';
  $('overBest').classList.toggle('hidden', !r.best);
  $('overEazy').textContent = r.practice ? 'Practice run — not ranked.' : r.eazy;
  const cp = $('checkpointBtn');
  cp.classList.toggle('hidden', !r.checkpoint);
  if (r.checkpoint) cp.innerHTML = `CONTINUE FROM ${r.checkpoint.name} <small>practice · unranked</small>`;
  showHud(false);
  showScreen('gameover');
}

export function victory(r) {
  $('winScore').textContent = r.score.toLocaleString();
  $('winCoins').textContent = r.coins.toLocaleString();
  $('winTime').textContent = Math.round(r.time) + 's';
  $('winBest').classList.toggle('hidden', !r.best);
  document.querySelector('#victory .eazy-line').textContent = r.practice ? 'Practice run — start from The Hood to get on the board.' : '“Told you, bro. Trust me.” — Eazy';
  showHud(false);
  showScreen('victory');
}

// ---------- local leaderboard
export function saveScore(mode, score, coins, dist) {
  const key = 'hb_board_' + mode;
  const list = store(key) || [];
  const prevBest = list[0]?.score || 0;
  const entry = { name: playerName(), score, coins, dist, at: Date.now() };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  store(key, list.slice(0, 10));
  store('hb_last', entry.at);
  return score > prevBest;
}

function renderBoard(mode) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  const list = store('hb_board_' + mode) || [];
  const last = store('hb_last');
  const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  $('boardList').innerHTML = list.length
    ? list.map((e) => `<li class="${e.at === last ? 'me' : ''}"><span class="n">${esc(e.name)}</span><span class="c">${e.coins} $HB · ${e.dist}m</span><span class="s">${e.score.toLocaleString()}</span></li>`).join('')
    : '<li class="empty">No runs yet. Be the first degen on the board.</li>';
}

function refreshBest() {
  const best = Math.max((store('hb_board_endless') || [])[0]?.score || 0, (store('hb_board_story') || [])[0]?.score || 0);
  $('bestScore').textContent = best.toLocaleString();
}
