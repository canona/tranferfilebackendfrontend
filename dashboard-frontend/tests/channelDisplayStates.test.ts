import { describe, it, expect } from 'vitest';
import { buildChannelDisplayStatesFixture } from '../src/fixtures/channelDisplayStates';

// Code review [round 1, finding #3]: `buildChannelDisplayStatesFixture` chỉ
// được dùng gián tiếp qua `app/page.tsx`, chưa có test nào exercise trực tiếp
// hàm này. Verify: (a) mọi channelId luôn nhận đúng 1 trong 3 DisplayState;
// (b) kết quả gán theo ĐỊNH DANH channelId, KHÔNG theo vị trí/index trong
// mảng (khớp fix finding #1 - hash theo channelId, không theo index); (c)
// input rỗng trả về map rỗng, không crash.
describe('buildChannelDisplayStatesFixture', () => {
  it('mọi channelId nhận đúng 1 trong 3 giá trị DisplayState hợp lệ', () => {
    const channelIds = Array.from({ length: 20 }, (_, i) => `chan-${i}`);
    const result = buildChannelDisplayStatesFixture(channelIds);

    expect(result.size).toBe(20);
    for (const channelId of channelIds) {
      expect(['ok', 'warning', 'critical']).toContain(result.get(channelId));
    }
  });

  it('input rỗng -> map rỗng, không crash', () => {
    const result = buildChannelDisplayStatesFixture([]);
    expect(result.size).toBe(0);
  });

  it('cùng 1 channelId luôn ra cùng 1 kết quả bất kể vị trí trong mảng đầu vào (identity-based, không phải index-based)', () => {
    const ascending = ['chan-a', 'chan-b', 'chan-c'];
    const shuffled = ['chan-c', 'chan-a', 'chan-b'];

    const resultAscending = buildChannelDisplayStatesFixture(ascending);
    const resultShuffled = buildChannelDisplayStatesFixture(shuffled);

    for (const channelId of ascending) {
      expect(resultShuffled.get(channelId)).toBe(resultAscending.get(channelId));
    }
  });

  it('thêm 1 channelId mới vào mảng không làm đổi trạng thái của các channelId đã có (khác hành vi index-based cũ)', () => {
    const before = buildChannelDisplayStatesFixture(['chan-a', 'chan-b']);
    const after = buildChannelDisplayStatesFixture(['chan-new', 'chan-a', 'chan-b']);

    expect(after.get('chan-a')).toBe(before.get('chan-a'));
    expect(after.get('chan-b')).toBe(before.get('chan-b'));
  });
});
