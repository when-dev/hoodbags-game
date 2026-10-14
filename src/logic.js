// Pure game logic (no Three.js / DOM) so it can be unit-tested with `node --test`.

// ------------------------------------------------------------------ coin audio combo
// Turns a stream of coin pickups into a small number of musical sound events.
// - a pickup within COMBO_WINDOW of the previous one extends the combo
// - sounds are rate-limited by COOLDOWN; pickups inside the cooldown are coalesced
// - every MILESTONE coins in one combo triggers a milestone sound (bypasses the cooldown)
export const COIN_AUDIO = { COOLDOWN: 0.13, COMBO_WINDOW: 0.75, MILESTONE: 10, MAX_STEP: 7 };

export class CoinCombo {
  constructor(opts = {}) {
    this.o = { ...COIN_AUDIO, ...opts };
    this.reset();
  }
  reset() {
    this.combo = 0;
    this.lastPickup = -Infinity;
    this.lastSound = -Infinity;
    this.coalesced = 0;
  }
  // returns null (coalesced) or { type: 'single' | 'combo' | 'milestone', step, combo, merged }
  pickup(now) {
    const o = this.o;
    if (now - this.lastPickup > o.COMBO_WINDOW) { this.combo = 0; this.coalesced = 0; }
    this.lastPickup = now;
    this.combo++;
    if (this.combo % o.MILESTONE === 0) {
      this.lastSound = now;
      const merged = this.coalesced; this.coalesced = 0;
      return { type: 'milestone', step: Math.min(this.combo - 1, o.MAX_STEP), combo: this.combo, merged };
    }
    if (now - this.lastSound < o.COOLDOWN) { this.coalesced++; return null; }
    this.lastSound = now;
    const merged = this.coalesced; this.coalesced = 0;
    return {
      type: this.combo === 1 ? 'single' : 'combo',
      // pitch climbs one scale step per *sound*, capped so it never gets shrill
      step: Math.min(this.combo - 1, o.MAX_STEP),
      combo: this.combo,
      merged,
    };
  }
}

// ------------------------------------------------------------------ obstacle row planner
// Lane plans are arrays of 3 entries: null or { type, len }.
// HARD obstacles (crash candles) can only be dodged by changing lanes; everything else can be
// jumped or slid. The planner guarantees that from EVERY lane the player could legally be in,
// at least one lane of the next row is reachable in time — so no sequence is ever unwinnable.
export const HARD = new Set(['crash', 'crashMoving']);
export const OBSTACLE_LEN = { fud: 0.4, bar: 0.4, airdrop: 1.2, rug: 3.4 };
export const LANE_TIME = 0.15;   // seconds to move one lane (2.4 units at 16 u/s)
export const REACTION = 0.4;     // seconds of reaction budget we always leave the player (tuned for humans)
export const MOVING_EXTRA = 15;  // a moving candle eats this much extra corridor (metres)

const hardAt = (row, l) => !!row[l] && HARD.has(row[l].type);
const lenAt = (row, l) => (row[l] ? row[l].len + (row[l].type === 'crashMoving' ? MOVING_EXTRA : 0) : 0);

// Can a player standing in lane `a` (after clearing `prev`) reach lane `b` before `next` arrives?
export function canReach(prev, next, a, b, gap, speed) {
  if (hardAt(next, b)) return false;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  // the corridor opens once every obstacle the player must pass beside/through has gone by
  let tail = 0;
  for (let l = lo; l <= hi; l++) if (l !== a || hardAt(prev, l)) tail = Math.max(tail, lenAt(prev, l));
  // a moving candle on the path arrives early and shortens the corridor
  let early = 0;
  for (let l = lo; l <= hi; l++) if (next[l] && next[l].type === 'crashMoving') early = MOVING_EXTRA;
  const corridor = gap - tail - early;
  const need = speed * (Math.abs(a - b) * LANE_TIME + (a === b ? 0 : REACTION));
  return corridor >= need;
}

// lanes the player may occupy while passing `row`
export const safeLanes = (row) => [0, 1, 2].filter((l) => !hardAt(row, l));

export function rowIsFair(prev, next, gap, speed) {
  const from = safeLanes(prev);
  if (!from.length) return false;
  return from.every((a) => [0, 1, 2].some((b) => canReach(prev, next, a, b, gap, speed)));
}

function pickWeighted(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[0][0];
}

// Build one obstacle row. Retries random candidates until the row is fair relative to `prev`,
// falling back to softer and emptier rows. Always returns a fair row.
export function planRow({ prev, pool, difficulty, gap, speed, rng = Math.random }) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const soften = attempt >= 12; // later attempts drop hard obstacles entirely
    const lanes = [0, 1, 2].sort(() => rng() - 0.5);
    const r = rng();
    let count = r < 0.55 - difficulty * 0.25 ? 1 : r < 0.9 - difficulty * 0.15 ? 2 : 3;
    if (attempt >= 18) count = 1;
    const row = [null, null, null];
    let hard = 0;
    for (let i = 0; i < count; i++) {
      let type = pickWeighted(pool, rng);
      if (HARD.has(type) && (soften || hard >= 2 || (count === 3 && hard >= 1))) type = rng() < 0.5 ? 'fud' : 'airdrop';
      // a moving candle must have an empty lane in front of it
      if (type === 'crashMoving' && (prev[lanes[i]] || hard > 0)) type = 'crash';
      if (HARD.has(type)) hard++;
      const len = HARD.has(type) ? [6, 9, 12][(rng() * 3) | 0] : OBSTACLE_LEN[type];
      row[lanes[i]] = { type, len };
    }
    if (rowIsFair(prev, row, gap, speed)) return row;
  }
  return [null, null, null];
}

// ------------------------------------------------------------------ coin patterns
// Returns coin positions (lane-space: { lane, dz, y }) for a row, dz measured from the row front
// toward the player (+) / away (-). Spacing never drops below COIN_SPACING.
export const COIN_SPACING = 3.2;

export function planCoins({ prev, row, prevCoinLane, rng = Math.random, speed }) {
  const free = [0, 1, 2].filter((l) => !row[l]);
  const roll = rng();
  // 1) a short trail in a free lane, preferring to continue the previous trail's lane so the
  //    player is never pulled across lanes just for coins. ~10% are longer "combo" trails.
  if (free.length && roll < 0.5) {
    const lane = free.includes(prevCoinLane) && rng() < 0.75 ? prevCoinLane : free[(rng() * free.length) | 0];
    const n = rng() < 0.1 ? 6 : 3 + ((rng() * 2) | 0);  // 3–4 coins, sometimes a 6-coin combo
    const coins = [];
    for (let i = 0; i < n; i++) coins.push({ lane, dz: 6 - i * COIN_SPACING, y: 0.9 });
    return { coins, lane, kind: n === 6 ? 'combo' : 'line' };
  }
  // 2) risk/reward: an arc over a jumpable obstacle, sized to the real jump at this speed
  const jumpable = [0, 1, 2].filter((l) => row[l] && ['fud', 'airdrop'].includes(row[l].type));
  if (jumpable.length && roll < 0.76) {
    const lane = jumpable.includes(prevCoinLane) ? prevCoinLane : jumpable[(rng() * jumpable.length) | 0];
    const air = 0.7 * speed;                         // horizontal metres covered by one jump
    const n = 5;
    const coins = [];
    const centre = -row[lane].len / 2;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      coins.push({ lane, dz: centre + air / 2 - t * air, y: 1.0 + Math.sin(t * Math.PI) * 1.5 });
    }
    return { coins, lane, kind: 'arc' };
  }
  // 3) slide reward under a liquidation line
  const bars = [0, 1, 2].filter((l) => row[l] && row[l].type === 'bar');
  if (bars.length && roll < 0.85) {
    const lane = bars[0];
    return { coins: [0, 1, 2].map((i) => ({ lane, dz: 3.2 - i * COIN_SPACING, y: 0.5 })), lane, kind: 'slide' };
  }
  return { coins: [], lane: prevCoinLane, kind: 'none' };
}
