import { describe, it, expect } from 'vitest';
import { createChannelStore } from '../src/state/channelStore';

describe('ChannelStore', () => {
  it('trạng thái ban đầu: channels rỗng, seenChannelIds rỗng', () => {
    const store = createChannelStore();
    const state = store.getState();
    expect(state.channels).toEqual([]);
    expect(state.seenChannelIds.size).toBe(0);
  });

  it('applyRegistrySnapshot: ghi đè toàn bộ channels, giữ nguyên seenChannelIds hiện có', () => {
    const store = createChannelStore();
    store.applyChannelSeen('chan-1');
    store.applyRegistrySnapshot([
      { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '0900000001', gridPosition: 0 },
      { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'B', contactPhone: '0900000002', gridPosition: 1 },
    ]);

    const state = store.getState();
    expect(state.channels.length).toBe(2);
    expect(state.channels[0]?.channelId).toBe('chan-1');
    expect(state.seenChannelIds.has('chan-1')).toBe(true);
  });

  it('applyRegistrySnapshot gọi lần 2 -> GHI ĐÈ hoàn toàn danh sách cũ (không merge)', () => {
    const store = createChannelStore();
    store.applyRegistrySnapshot([
      { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '0900000001', gridPosition: 0 },
    ]);
    store.applyRegistrySnapshot([
      { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'B', contactPhone: '0900000002', gridPosition: 1 },
    ]);

    const state = store.getState();
    expect(state.channels.length).toBe(1);
    expect(state.channels[0]?.channelId).toBe('chan-2');
  });

  it('applyChannelSeen: thêm channelId vào seenChannelIds', () => {
    const store = createChannelStore();
    store.applyChannelSeen('chan-1');
    expect(store.getState().seenChannelIds.has('chan-1')).toBe(true);
    expect(store.getState().seenChannelIds.has('chan-2')).toBe(false);
  });

  it('applyChannelSeen gọi lặp lại cho cùng channelId -> idempotent, KHÔNG tạo Set mới (tránh re-render thừa)', () => {
    const store = createChannelStore();
    store.applyChannelSeen('chan-1');
    const stateAfterFirst = store.getState();
    store.applyChannelSeen('chan-1');
    const stateAfterSecond = store.getState();

    expect(stateAfterSecond).toBe(stateAfterFirst); // cùng tham chiếu object - không setState() lần 2
    expect(stateAfterSecond.seenChannelIds.size).toBe(1);
  });

  it('applyChannelSeen KHÔNG bao giờ gỡ bỏ channelId đã seen (chỉ cộng thêm)', () => {
    const store = createChannelStore();
    store.applyChannelSeen('chan-1');
    store.applyChannelSeen('chan-2');
    expect([...store.getState().seenChannelIds].sort()).toEqual(['chan-1', 'chan-2']);
  });

  it('subscribe: listener được gọi khi state đổi, không gọi khi applyChannelSeen idempotent', () => {
    const store = createChannelStore();
    let callCount = 0;
    const unsubscribe = store.subscribe(() => {
      callCount++;
    });

    store.applyChannelSeen('chan-1');
    expect(callCount).toBe(1);

    store.applyChannelSeen('chan-1'); // lặp lại - không gọi listener
    expect(callCount).toBe(1);

    store.applyRegistrySnapshot([]);
    expect(callCount).toBe(2);

    unsubscribe();
    store.applyChannelSeen('chan-2'); // sau unsubscribe - không được gọi listener nữa
    expect(callCount).toBe(2);
  });
});
