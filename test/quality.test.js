import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality, pixelRatioFor, PRESETS } from '../src/quality.js';

test('pixel ratio respects device, preset and pixel budget', () => {
  // ordinary 1080p laptop at DPR 1: native resolution
  assert.equal(pixelRatioFor('high', { dpr: 1, width: 1920, height: 1080, touch: false }), 1);
  // 4K-ish laptop at DPR 2: capped by the pixel budget, not rendered at 2x
  const r = pixelRatioFor('high', { dpr: 2, width: 1920, height: 1080, touch: false });
  assert.ok(1920 * 1080 * r * r <= PRESETS.high.maxPixels + 1);
  // phone at DPR 3 never renders at 3x
  assert.ok(pixelRatioFor('high', { dpr: 3, width: 390, height: 844, touch: true }) <= 1.5);
  assert.ok(pixelRatioFor('performance', { dpr: 3, width: 390, height: 844, touch: true }) <= 1.0);
});

const feed = (q, ms, seconds) => { let changed = null; for (let t = 0; t < seconds * 1000; t += ms) { const r = q.sample(ms); if (r) changed = r; } return changed; };

test('adaptive quality: steps down only after sustained slow frames', () => {
  const q = new AdaptiveQuality({ level: 'high' });
  assert.equal(feed(q, 25, 3), null, 'one slow window is not enough');
  assert.equal(feed(q, 25, 3.1), 'balanced');
  assert.equal(feed(q, 25, 6.2), 'performance');
  assert.equal(feed(q, 25, 10), null, 'never below the lowest level');
});

test('adaptive quality: ignores single spikes and pause gaps', () => {
  const q = new AdaptiveQuality({ level: 'high' });
  for (let i = 0; i < 40; i++) { feed(q, 16.7, 0.5); q.sample(120); } // occasional hitches
  q.sample(5000); // tab was hidden
  assert.equal(q.level, 'high');
});

test('adaptive quality: hysteresis, at most one upgrade per session', () => {
  const q = new AdaptiveQuality({ level: 'high' });
  feed(q, 25, 6.5);
  assert.equal(q.level, 'balanced');
  feed(q, 12, 30);
  assert.equal(q.level, 'high', 'recovers once things are clearly healthy');
  feed(q, 25, 6.5);
  assert.equal(q.level, 'balanced');
  feed(q, 12, 60);
  assert.equal(q.level, 'balanced', 'does not flap back up a second time');
});

test('adaptive quality: manual selection is never overridden', () => {
  const q = new AdaptiveQuality({ level: 'high' });
  q.setManual('high');
  feed(q, 40, 20);
  assert.equal(q.level, 'high');
});
