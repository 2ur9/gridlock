// Run: npm test   (node --test)
import test from 'node:test';
import assert from 'node:assert/strict';

import { lapIsPlausible } from './api.js';
import { _test } from './rooms.js';

test('lapIsPlausible rejects impossibly fast laps and accepts sane ones', () => {
  assert.equal(lapIsPlausible('monza', 'f1', 20_000), false, '20s Monza lap is impossible');
  assert.equal(lapIsPlausible('monza', 'f1', 79_000), true, '1:19 Monza F1 is fine');
  assert.equal(lapIsPlausible('spa', 'gt', 40_000), false, '0:40 Spa GT is impossible');
  assert.equal(lapIsPlausible('spa', 'gt', 140_000), true);
  assert.equal(lapIsPlausible('monza', 'f1', Number.NaN), false);
  assert.equal(lapIsPlausible('monza', 'f1', 40 * 60_000), false, 'absurdly long is rejected');
});

test('room codes are 4 chars from the unambiguous alphabet and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const c = _test.makeCode();
    assert.match(c, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    assert.equal(seen.has(c), false, 'no collision within the live set');
    // note: makeCode only guarantees uniqueness against rooms currently in the Map,
    // so we don't add to `seen` beyond the format check across a large sample here.
    seen.add(c);
    if (seen.size > 400) break;
  }
});

test('sanitizeSettings clamps and defaults every field', () => {
  const s = _test.sanitizeSettings({ trackId: 'hacktrack', mode: 'rocket', laps: 999, aiCount: -4, aiDifficulty: 'god', weather: 'snow' });
  assert.equal(s.trackId, 'testoval');
  assert.equal(s.mode, 'gt');
  assert.equal(s.laps, 30);
  assert.equal(s.aiCount, 0);
  assert.equal(s.aiDifficulty, 'medium');
  assert.equal(s.weather, 'dry');

  const ok = _test.sanitizeSettings({ trackId: 'spa', mode: 'f1', laps: 5, aiCount: 7, aiDifficulty: 'pro', weather: 'wet' });
  assert.deepEqual(ok, { trackId: 'spa', mode: 'f1', laps: 5, aiCount: 7, aiDifficulty: 'pro', weather: 'wet' });
});
