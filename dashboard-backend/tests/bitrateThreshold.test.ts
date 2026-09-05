import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBitratePct, mapToDisplayState } from '../src/core/bitrateThreshold.js';

test('computeBitratePct: tính đúng tỉ lệ % bitrate_kbps/baseline_kbps', () => {
  assert.equal(computeBitratePct(3500, 5000), 70);
  assert.equal(computeBitratePct(5000, 5000), 100);
  assert.equal(computeBitratePct(0, 5000), 0);
});

test('computeBitratePct: guard baseline<=0/NaN -> 0% (không throw/NaN lan truyền)', () => {
  assert.equal(computeBitratePct(1000, 0), 0);
  assert.equal(computeBitratePct(1000, -5), 0);
  assert.equal(computeBitratePct(1000, Number.NaN), 0);
});

test('computeBitratePct: guard bitrate âm/NaN -> 0%', () => {
  assert.equal(computeBitratePct(-1, 5000), 0);
  assert.equal(computeBitratePct(Number.NaN, 5000), 0);
});

test('mapToDisplayState: CONNECTED + bitrate_pct>=70% -> ok', () => {
  assert.deepEqual(mapToDisplayState('CONNECTED', 70), { state: 'ok' });
  assert.deepEqual(mapToDisplayState('CONNECTED', 100), { state: 'ok' });
});

test('mapToDisplayState: CONNECTED + bitrate_pct<70% -> warning', () => {
  assert.deepEqual(mapToDisplayState('CONNECTED', 69.9), { state: 'warning' });
  assert.deepEqual(mapToDisplayState('CONNECTED', 0), { state: 'warning' });
});

test('mapToDisplayState: RECONNECTING -> critical (không sub-type)', () => {
  assert.deepEqual(mapToDisplayState('RECONNECTING', 100), { state: 'critical' });
});

test('mapToDisplayState: REJECTED -> critical kèm sub-type config-or-security-suspected', () => {
  assert.deepEqual(mapToDisplayState('REJECTED', 0), {
    state: 'critical',
    subType: 'config-or-security-suspected',
  });
});

test('mapToDisplayState: CONNECTING -> critical (đủ 4 giá trị connection_state đều map được)', () => {
  assert.deepEqual(mapToDisplayState('CONNECTING', 0), { state: 'critical' });
});
