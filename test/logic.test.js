import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoinCombo, COIN_AUDIO, planRow, rowIsFair, safeLanes, canReach, planCoins, COIN_SPACING, HARD } from '../src/logic.js';
import { DISTRICTS } from '../src/config.js';

// deterministic RNG so failures are reproducible
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('coin combo: a dense trail produces far fewer sound events than coins', () => {
  const c = new CoinCombo();
  let events = 0, t = 0;
  for (let i = 0; i < 40; i++) { if (c.pickup(t)) events++; t += 0.06; } // magnet-speed pickups
  assert.ok(events <= 40 * 0.06 / COIN_AUDIO.COOLDOWN + 4, `too many events: ${events}`);
  assert.ok(events >= 5, 'still audible feedback');
});

test('coin combo: consecutive sound events are never closer than the cooldown (except milestones)', () => {
  const c = new CoinCombo();
  let last = -Infinity, t = 0;
  for (let i = 0; i < 200; i++) {
    t += 0.03 + (i % 7) * 0.02;
    const e = c.pickup(t);
    if (e && e.type !== 'milestone') { assert.ok(t - last >= COIN_AUDIO.COOLDOWN - 1e-9); last = t; }
    if (e && e.type === 'milestone') last = t;
  }
});

test('coin combo: pitch step rises then caps, resets after a pause', () => {
  const c = new CoinCombo();
  const steps = [];
  for (let i = 0; i < 30; i++) { const e = c.pickup(i * 0.2); if (e) steps.push(e.step); }
  assert.equal(steps[0], 0);
  assert.ok(Math.max(...steps) <= COIN_AUDIO.MAX_STEP);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1]);
  const after = c.pickup(100);
  assert.equal(after.type, 'single');
  assert.equal(after.step, 0);
});

test('coin combo: milestone every 10 coins of a combo', () => {
  const c = new CoinCombo();
  const types = [];
  for (let i = 0; i < 20; i++) types.push(c.pickup(i * 0.2)?.type);
  assert.equal(types[9], 'milestone');
  assert.equal(types[19], 'milestone');
  assert.equal(types[0], 'single');
});

test('row planner: never more than 2 candles, always a safe lane', () => {
  const rng = mulberry32(1);
  let prev = [null, null, null];
  for (let i = 0; i < 20000; i++) {
    const d = DISTRICTS[i % 3];
    const row = planRow({ prev, pool: d.pool, difficulty: (i % 100) / 100, gap: 18, speed: 28, rng });
    assert.ok(safeLanes(row).length >= 1);
    assert.ok(row.filter((x) => x && HARD.has(x.type)).length <= 2);
    prev = row;
  }
});

test('row planner: every generated sequence is winnable (DP over reachable lanes)', () => {
  for (const [speed, gap] of [[15, 18.4], [23, 17], [28, 19.8], [34, 22]]) {
    const rng = mulberry32(speed * 7);
    let prev = [null, null, null];
    let reachable = new Set([0, 1, 2]);
    for (let i = 0; i < 5000; i++) {
      const d = DISTRICTS[2];
      const row = planRow({ prev, pool: d.pool, difficulty: 1, gap, speed, rng });
      assert.ok(rowIsFair(prev, row, gap, speed));
      // every lane we could be in must lead somewhere
      const next = new Set();
      for (const a of reachable) {
        const outs = [0, 1, 2].filter((b) => canReach(prev, row, a, b, gap, speed));
        assert.ok(outs.length > 0, `dead end at row ${i} speed ${speed}`);
        outs.forEach((b) => next.add(b));
      }
      reachable = next;
      prev = row;
    }
  }
});

test('row planner: a long candle blocks a fast lane change into its lane', () => {
  const prev = [{ type: 'crash', len: 12 }, null, null];
  const next = [null, { type: 'crash', len: 6 }, { type: 'crash', len: 6 }];
  // the only open lane next is 0, but lane 0 is occupied by a 12m candle -> not enough corridor at speed 28
  assert.equal(rowIsFair(prev, next, 18, 28), false);
});

test('coin planner: spacing and no coins on hard obstacles', () => {
  const rng = mulberry32(9);
  let prev = [null, null, null], lane = 1;
  for (let i = 0; i < 3000; i++) {
    const row = planRow({ prev, pool: DISTRICTS[1].pool, difficulty: 0.6, gap: 18, speed: 22, rng });
    const plan = planCoins({ prev, row, prevCoinLane: lane, rng, speed: 22 });
    for (const c of plan.coins) assert.ok(!(row[c.lane] && HARD.has(row[c.lane].type)), 'coin on a candle');
    const byLane = {};
    for (const c of plan.coins) (byLane[c.lane] ||= []).push(c.dz);
    for (const zs of Object.values(byLane)) {
      zs.sort((a, b) => a - b);
      for (let k = 1; k < zs.length; k++) assert.ok(zs[k] - zs[k - 1] >= COIN_SPACING * 0.9 || plan.kind === 'arc');
    }
    assert.ok(plan.coins.length <= 6);
    lane = plan.lane; prev = row;
  }
});
