// Story 2.5: `computeAudioLevelFixture` - hàm thuần dao động dBFS. Design
// Notes: "nhận elapsedSeconds làm tham số (không tự đọc Date.now() bên
// trong) để hàm thuần túy, test được bằng giá trị cố định". Boundaries:
// "clamp [-60,0], không Math.random thật".

import { describe, it, expect } from 'vitest';
import { computeAudioLevelFixture } from '../src/fixtures/channelAudioLevels';

describe('computeAudioLevelFixture', () => {
  it('cùng (channelId, elapsedSeconds) luôn ra đúng 1 kết quả (hàm thuần, deterministic)', () => {
    const first = computeAudioLevelFixture('chan-1', 12.5);
    const second = computeAudioLevelFixture('chan-1', 12.5);
    expect(second).toEqual(first);
  });

  it('luôn trả về tuple [L, R] trong khoảng [-60, 0] dBFS bất kể elapsedSeconds', () => {
    const elapsedSecondsSamples = [0, 0.3, 1, 5.5, 100, 100000, -3];
    const channelIds = ['chan-a', 'chan-b', 'chan-c'];

    for (const channelId of channelIds) {
      for (const elapsedSeconds of elapsedSecondsSamples) {
        const [left, right] = computeAudioLevelFixture(channelId, elapsedSeconds);
        expect(left).toBeGreaterThanOrEqual(-60);
        expect(left).toBeLessThanOrEqual(0);
        expect(right).toBeGreaterThanOrEqual(-60);
        expect(right).toBeLessThanOrEqual(0);
        expect(Number.isNaN(left)).toBe(false);
        expect(Number.isNaN(right)).toBe(false);
      }
    }
  });

  it('giá trị dao động theo elapsedSeconds (giả lập real-time, KHÔNG đứng yên)', () => {
    const atZero = computeAudioLevelFixture('chan-1', 0);
    const atOne = computeAudioLevelFixture('chan-1', 1);
    expect(atOne).not.toEqual(atZero);
  });

  it('2 channelId khác nhau nhận baseline/pha khác nhau tại cùng elapsedSeconds (không trùng lặp máy móc)', () => {
    const a = computeAudioLevelFixture('chan-a', 3);
    const b = computeAudioLevelFixture('chan-b', 3);
    expect(a).not.toEqual(b);
  });

  it('kênh trái/phải (L/R) không hoàn toàn giống hệt nhau tại đa số thời điểm (lệch pha)', () => {
    const [left, right] = computeAudioLevelFixture('chan-1', 3);
    expect(left).not.toBe(right);
  });
});
