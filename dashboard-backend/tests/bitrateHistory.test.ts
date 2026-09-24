import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BitrateHistoryService, HISTORY_RETENTION_MS } from '../src/core/bitrateHistory.js';
import type { Clock } from '../src/core/channelState.js';

// Mirror `FakeClock` ở `tests/channelState.test.ts:13-21` (Code Map: "copy
// pattern").
class FakeClock implements Clock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

test('kênh mới, chưa từng có telemetry -> getHistory trả no-history-data (KHÔNG phải mảng rỗng/giá trị 0)', () => {
  const service = new BitrateHistoryService();

  assert.deepEqual(service.getHistory('chan-x'), { state: 'no-history-data' });
});

test('đã có >=1 mẫu -> getHistory trả loaded kèm mảng mẫu theo thứ tự thời gian tăng dần', () => {
  const clock = new FakeClock();
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, clock.now()); // t=0
  clock.advance(5000);
  service.recordBitrate('chan-1', 80, clock.now()); // t=5s
  clock.advance(5000);
  service.recordBitrate('chan-1', 70, clock.now()); // t=10s

  const result = service.getHistory('chan-1');
  assert.equal(result.state, 'loaded');
  assert.deepEqual(
    result.state === 'loaded' ? result.data : undefined,
    [
      { timestampMs: 0, bitratePct: 90 },
      { timestampMs: 5000, bitratePct: 80 },
      { timestampMs: 10000, bitratePct: 70 },
    ]
  );
});

test('mẫu cũ hơn 15 phút bị loại khỏi kết quả getHistory sau khi ghi mẫu mới cho đúng kênh đó', () => {
  const clock = new FakeClock();
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, clock.now()); // t=0
  clock.advance(16 * 60 * 1000); // t=16'
  service.recordBitrate('chan-1', 80, clock.now());

  const result = service.getHistory('chan-1');
  assert.equal(result.state, 'loaded');
  assert.deepEqual(
    result.state === 'loaded' ? result.data.map((p) => p.timestampMs) : undefined,
    [16 * 60 * 1000],
    'mẫu t=0 phải bị trim - chỉ còn mẫu t=16 phút'
  );
});

test('mẫu đúng tuổi retention (age === HISTORY_RETENTION_MS) vẫn được giữ - chỉ trim mẫu CŨ HƠN 15 phút, không phải >=15 phút', () => {
  const clock = new FakeClock();
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, clock.now()); // t=0
  clock.advance(HISTORY_RETENTION_MS); // t=đúng 15'
  service.recordBitrate('chan-1', 80, clock.now());

  const result = service.getHistory('chan-1');
  assert.equal(result.state, 'loaded');
  assert.deepEqual(
    result.state === 'loaded' ? result.data.map((p) => p.timestampMs) : undefined,
    [0, HISTORY_RETENTION_MS]
  );
});

test('recordBitrate ghi bitratePct (không phải bitrateKbps thô) - giá trị lưu nguyên đúng tham số truyền vào', () => {
  const clock = new FakeClock();
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 62.5, clock.now());

  const result = service.getHistory('chan-1');
  assert.equal(result.state, 'loaded');
  assert.equal(result.state === 'loaded' ? result.data[0]?.bitratePct : undefined, 62.5);
});

test('mỗi kênh độc lập (per-channel) - ghi/trim kênh này không ảnh hưởng kênh khác', () => {
  const clock = new FakeClock();
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, clock.now());
  service.recordBitrate('chan-2', 50, clock.now());

  clock.advance(16 * 60 * 1000);
  service.recordBitrate('chan-1', 80, clock.now()); // chỉ trim/ghi thêm cho chan-1

  const chan1 = service.getHistory('chan-1');
  const chan2 = service.getHistory('chan-2');
  assert.equal(chan1.state, 'loaded');
  assert.deepEqual(chan1.state === 'loaded' ? chan1.data.map((p) => p.timestampMs) : undefined, [16 * 60 * 1000]);
  // chan-2 chưa ghi thêm mẫu nào -> mẫu cũ t=0 KHÔNG bị trim (Boundaries/Never:
  // "chỉ bị trim khi có mẫu mới ghi vào đúng kênh đó").
  assert.equal(chan2.state, 'loaded');
  assert.deepEqual(chan2.state === 'loaded' ? chan2.data.map((p) => p.timestampMs) : undefined, [0]);
});

test('constructor không tham số (không có clock nào - dead code đã bị xoá) - không throw, ghi/đọc bình thường', () => {
  const service = new BitrateHistoryService();

  assert.doesNotThrow(() => service.recordBitrate('chan-1', 100, Date.now()));
  assert.equal(service.getHistory('chan-1').state, 'loaded');
});

// Code review [patch]: `getHistory()` trước đây trả CHÍNH mảng nội bộ trong
// `Map` - `recordBitrate()` kế tiếp cho cùng channelId `.push()` vào CHÍNH
// mảng đó, âm thầm phình to `data` mà 1 caller đã giữ lại từ 1 lần gọi trước,
// phá vỡ ngữ nghĩa snapshot-tại-thời-điểm-gọi mà kiểu `readonly
// BitrateHistoryPoint[]` ngụ ý. `getHistory()` giờ trả bản sao nông.
test('getHistory() trả bản sao (snapshot) - recordBitrate() sau đó KHÔNG làm phình to mảng data đã lấy trước đó', () => {
  const clock = new FakeClock();
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, clock.now()); // t=0

  const result = service.getHistory('chan-1');
  assert.equal(result.state, 'loaded');
  const data = result.state === 'loaded' ? result.data : undefined;
  assert.ok(data);
  const lengthAtSnapshot = data!.length;

  clock.advance(1000);
  service.recordBitrate('chan-1', 80, clock.now()); // ghi thêm 1 mẫu mới, cùng kênh

  assert.equal(data!.length, lengthAtSnapshot, 'mảng data lấy trước đó phải giữ nguyên độ dài tại thời điểm snapshot');
});

// --- spec-epic2-item-10-12: pruneChannel() - dọn ring buffer khi 1 channel_id
// bị gỡ khỏi channel-registry (hot-reload). ---

test('pruneChannel(): kênh đã có mẫu -> getHistory trả no-history-data sau khi prune', () => {
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, 0);
  assert.equal(service.getHistory('chan-1').state, 'loaded');

  service.pruneChannel('chan-1');

  assert.deepEqual(service.getHistory('chan-1'), { state: 'no-history-data' });
});

test('pruneChannel(): kênh chưa từng có mẫu -> no-op, không throw', () => {
  const service = new BitrateHistoryService();

  assert.doesNotThrow(() => service.pruneChannel('chan-khong-ton-tai'));
});

test('pruneChannel(): 1 kênh bị prune KHÔNG ảnh hưởng ring buffer của kênh khác', () => {
  const service = new BitrateHistoryService();

  service.recordBitrate('chan-1', 90, 0);
  service.recordBitrate('chan-2', 50, 0);

  service.pruneChannel('chan-1');

  assert.deepEqual(service.getHistory('chan-1'), { state: 'no-history-data' });
  assert.equal(service.getHistory('chan-2').state, 'loaded');
});
