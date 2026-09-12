import { describe, it, expect } from 'vitest';
import { createChannelStore } from '../src/state/channelStore';

describe('ChannelStore', () => {
  it('trạng thái ban đầu: channels rỗng, seenChannelIds rỗng, channelDisplayStates rỗng', () => {
    const store = createChannelStore();
    const state = store.getState();
    expect(state.channels).toEqual([]);
    expect(state.seenChannelIds.size).toBe(0);
    expect(state.channelDisplayStates.size).toBe(0);
  });

  // Story 2.7 (Boundaries): "connectionStatus mặc định 'connected' (lạc quan
  // lúc mount), lastConnectedAt mặc định null, channelMachineOffline rỗng".
  it('trạng thái ban đầu: connectionStatus="connected" (lạc quan), lastConnectedAt=null, channelMachineOffline rỗng', () => {
    const store = createChannelStore();
    const state = store.getState();
    expect(state.connectionStatus).toBe('connected');
    expect(state.lastConnectedAt).toBeNull();
    expect(state.channelMachineOffline.size).toBe(0);
  });

  // Bổ sung video-preview thật (AD-22).
  it('trạng thái ban đầu: channelSnapshots rỗng', () => {
    const store = createChannelStore();
    expect(store.getState().channelSnapshots.size).toBe(0);
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

  // Story 2.6: `applyChannelDisplayStateChange` - ghi đè theo channelId, KHÔNG
  // idempotent-guard (Boundaries: "trạng thái đổi qua lại được").
  it('applyChannelDisplayStateChange: thêm mới channelDisplayStates cho 1 channelId', () => {
    const store = createChannelStore();
    store.applyChannelDisplayStateChange('chan-1', 'ok');
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('ok');
  });

  it('applyChannelDisplayStateChange gọi lại cho CÙNG channelId với giá trị KHÁC -> GHI ĐÈ (không giữ giá trị cũ)', () => {
    const store = createChannelStore();
    store.applyChannelDisplayStateChange('chan-1', 'ok');
    store.applyChannelDisplayStateChange('chan-1', 'critical');
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('critical');
  });

  it('applyChannelDisplayStateChange gọi lại với CÙNG giá trị -> vẫn setState (KHÔNG có idempotent-guard như applyChannelSeen)', () => {
    const store = createChannelStore();
    store.applyChannelDisplayStateChange('chan-1', 'ok');
    const stateAfterFirst = store.getState();
    store.applyChannelDisplayStateChange('chan-1', 'ok');
    const stateAfterSecond = store.getState();
    expect(stateAfterSecond).not.toBe(stateAfterFirst);
  });

  it('applyChannelDisplayStateChange không ảnh hưởng channelDisplayStates của các channelId khác', () => {
    const store = createChannelStore();
    store.applyChannelDisplayStateChange('chan-1', 'ok');
    store.applyChannelDisplayStateChange('chan-2', 'warning');
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('ok');
    expect(store.getState().channelDisplayStates.get('chan-2')).toBe('warning');
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

  // --- Story 2.7: setConnectionStatus + channelMachineOffline ---

  describe('setConnectionStatus', () => {
    it('"connected" kèm lastConnectedAt -> cập nhật cả 2 field', () => {
      const store = createChannelStore();
      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      const state = store.getState();
      expect(state.connectionStatus).toBe('connected');
      expect(state.lastConnectedAt).toBe('2026-09-06T08:15:00.000Z');
    });

    it('"disconnected" -> connectionStatus đổi, lastConnectedAt GIỮ NGUYÊN giá trị cũ (mốc lần connect gần nhất)', () => {
      const store = createChannelStore();
      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      store.setConnectionStatus('disconnected');
      const state = store.getState();
      expect(state.connectionStatus).toBe('disconnected');
      expect(state.lastConnectedAt).toBe('2026-09-06T08:15:00.000Z');
    });

    it('"connected" KHÔNG kèm lastConnectedAt (omit) -> giữ nguyên lastConnectedAt cũ', () => {
      const store = createChannelStore();
      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      store.setConnectionStatus('disconnected');
      store.setConnectionStatus('connected'); // reconnect nhưng không truyền lastConnectedAt
      expect(store.getState().lastConnectedAt).toBe('2026-09-06T08:15:00.000Z');
    });

    it('"disconnected" gọi lặp lại liên tiếp -> idempotent, KHÔNG setState lần 2 (tránh re-render thừa)', () => {
      const store = createChannelStore();
      store.setConnectionStatus('disconnected');
      const stateAfterFirst = store.getState();
      store.setConnectionStatus('disconnected');
      const stateAfterSecond = store.getState();
      expect(stateAfterSecond).toBe(stateAfterFirst);
    });

    it('subscribe: listener được gọi đúng khi connectionStatus đổi', () => {
      const store = createChannelStore();
      let callCount = 0;
      store.subscribe(() => {
        callCount++;
      });

      store.setConnectionStatus('disconnected');
      expect(callCount).toBe(1);

      store.setConnectionStatus('disconnected'); // lặp lại - không gọi listener
      expect(callCount).toBe(1);

      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      expect(callCount).toBe(2);
    });

    // Code review [patch round 2]: mirror idempotent-guard của nhánh
    // 'disconnected' ở trên - 'onopen' lặp lại (vd nhiều tick 'open' hiếm gặp)
    // không được setState/re-render thừa khi đã 'connected' VÀ lastConnectedAt
    // không đổi.
    it('"connected" gọi lặp lại với CÙNG lastConnectedAt khi ĐÃ "connected" -> idempotent, KHÔNG setState lần 2', () => {
      const store = createChannelStore();
      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      const stateAfterFirst = store.getState();
      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      const stateAfterSecond = store.getState();
      expect(stateAfterSecond).toBe(stateAfterFirst);
    });

    it('"connected" gọi lại với lastConnectedAt KHÁC khi ĐÃ "connected" -> vẫn setState (giá trị thật sự đổi)', () => {
      const store = createChannelStore();
      let callCount = 0;
      store.setConnectionStatus('connected', '2026-09-06T08:15:00.000Z');
      store.subscribe(() => {
        callCount++;
      });
      store.setConnectionStatus('connected', '2026-09-06T09:00:00.000Z');
      expect(callCount).toBe(1);
      expect(store.getState().lastConnectedAt).toBe('2026-09-06T09:00:00.000Z');
    });
  });

  // --- Story 2.7: applyChannelDisplayStateChange(channelId, displayState, subType) ---

  describe('applyChannelDisplayStateChange - subType/channelMachineOffline', () => {
    it('subType="machine-offline" -> thêm channelId vào channelMachineOffline, VẪN cập nhật channelDisplayStates bình thường', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      const state = store.getState();
      expect(state.channelDisplayStates.get('chan-1')).toBe('critical');
      expect(state.channelMachineOffline.has('chan-1')).toBe(true);
    });

    it('subType=undefined (mặc định, mirror telemetry bình thường) -> KHÔNG thêm vào channelMachineOffline', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'ok');
      expect(store.getState().channelMachineOffline.has('chan-1')).toBe(false);
    });

    it('subType="config-or-security-suspected" -> KHÔNG thêm vào channelMachineOffline (2 subType độc lập, Boundaries)', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'config-or-security-suspected');
      expect(store.getState().channelMachineOffline.has('chan-1')).toBe(false);
    });

    it('kênh đang machine-offline, gọi lại với subType=undefined (heartbeat resume) -> GỠ khỏi channelMachineOffline (đối xứng cơ chế phục hồi backend)', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      expect(store.getState().channelMachineOffline.has('chan-1')).toBe(true);

      store.applyChannelDisplayStateChange('chan-1', 'warning'); // resume, không subType
      const state = store.getState();
      expect(state.channelMachineOffline.has('chan-1')).toBe(false);
      expect(state.channelDisplayStates.get('chan-1')).toBe('warning');
    });

    it('kênh đang machine-offline, gọi lại với subType="config-or-security-suspected" -> VẪN gỡ khỏi channelMachineOffline (mọi giá trị khác machine-offline đều gỡ)', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'config-or-security-suspected');
      expect(store.getState().channelMachineOffline.has('chan-1')).toBe(false);
    });

    it('gọi lại với subType="machine-offline" khi ĐÃ có trong set -> idempotent (không tạo Set mới không cần thiết)', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      const setAfterFirst = store.getState().channelMachineOffline;
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      const setAfterSecond = store.getState().channelMachineOffline;
      expect(setAfterSecond).toBe(setAfterFirst);
    });

    it('channelMachineOffline độc lập per-channel: 2 kênh riêng biệt không ảnh hưởng lẫn nhau', () => {
      const store = createChannelStore();
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      store.applyChannelDisplayStateChange('chan-2', 'ok');

      const state = store.getState();
      expect(state.channelMachineOffline.has('chan-1')).toBe(true);
      expect(state.channelMachineOffline.has('chan-2')).toBe(false);
    });
  });

  // --- CAP-5 (spec-cap-5-xoa-cache-snapshot-khi-critical):
  // applyChannelDisplayStateChange xoá channelSnapshots khi displayState==='critical' ---

  describe('applyChannelDisplayStateChange - xoá channelSnapshots khi critical (CAP-5)', () => {
    it('có channelSnapshots entry, chuyển critical -> entry bị xoá', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-cu');
      expect(store.getState().channelSnapshots.has('chan-1')).toBe(true);

      store.applyChannelDisplayStateChange('chan-1', 'critical');
      expect(store.getState().channelSnapshots.has('chan-1')).toBe(false);
    });

    it('chuyển critical kèm subType="machine-offline" -> vẫn xoá channelSnapshots (check duy nhất displayState, không cần điều kiện riêng cho subType)', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-cu');
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      expect(store.getState().channelSnapshots.has('chan-1')).toBe(false);
    });

    it('KHÔNG có channelSnapshots entry, chuyển critical -> không throw, size không đổi', () => {
      const store = createChannelStore();
      expect(() => store.applyChannelDisplayStateChange('chan-1', 'critical')).not.toThrow();
      expect(store.getState().channelSnapshots.size).toBe(0);
    });

    it('chuyển ok/warning (không phải critical) -> KHÔNG xoá channelSnapshots hiện có', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-cu');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
      expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,khung-cu');
    });

    it('chỉ xoá đúng channelId chuyển critical, không ảnh hưởng snapshot của kênh khác', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-1');
      store.applyChannelSnapshot('chan-2', 'khung-2');
      store.applyChannelDisplayStateChange('chan-1', 'critical');
      const state = store.getState();
      expect(state.channelSnapshots.has('chan-1')).toBe(false);
      expect(state.channelSnapshots.get('chan-2')).toBe('data:image/jpeg;base64,khung-2');
    });

    it('round-trip: critical (entry đã xoá) -> phục hồi ok -> applyChannelSnapshot() MỚI tới -> cache được populate lại bình thường (CAP-5 không khoá vĩnh viễn snapshot của kênh)', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-cu');
      store.applyChannelDisplayStateChange('chan-1', 'critical');
      expect(store.getState().channelSnapshots.has('chan-1')).toBe(false);

      store.applyChannelDisplayStateChange('chan-1', 'ok');
      // Khung MỚI tới SAU KHI phục hồi - phải populate lại bình thường (mirror
      // hành vi ghi đè vô điều kiện hiện có của applyChannelSnapshot).
      store.applyChannelSnapshot('chan-1', 'khung-moi-sau-phuc-hoi');
      expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,khung-moi-sau-phuc-hoi');
    });
  });

  // --- Bổ sung video-preview thật (AD-22): applyChannelSnapshot ---

  describe('applyChannelSnapshot', () => {
    it('lưu đúng data-URI (data:image/jpeg;base64,...) theo channelId', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'ZmFrZS1qcGVn');
      expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,ZmFrZS1qcGVn');
    });

    it('gọi lại cho CÙNG channelId với imageBase64 KHÁC -> GHI ĐÈ (không idempotent-guard, mirror applyChannelDisplayStateChange)', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-1');
      store.applyChannelSnapshot('chan-1', 'khung-2');
      expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,khung-2');
    });

    it('không ảnh hưởng channelSnapshots của các channelId khác', () => {
      const store = createChannelStore();
      store.applyChannelSnapshot('chan-1', 'khung-1');
      store.applyChannelSnapshot('chan-2', 'khung-2');
      expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,khung-1');
      expect(store.getState().channelSnapshots.get('chan-2')).toBe('data:image/jpeg;base64,khung-2');
    });

    it('subscribe: listener được gọi mỗi lần applyChannelSnapshot (không idempotent-guard nên luôn setState)', () => {
      const store = createChannelStore();
      let callCount = 0;
      store.subscribe(() => {
        callCount++;
      });
      store.applyChannelSnapshot('chan-1', 'khung-1');
      expect(callCount).toBe(1);
      store.applyChannelSnapshot('chan-1', 'khung-1'); // cùng giá trị - vẫn setState (mirror applyChannelDisplayStateChange)
      expect(callCount).toBe(2);
    });
  });

  // --- Story 3.2: selectChannel/clearSelectedChannel + channelHistory ---

  describe('selectChannel / clearSelectedChannel', () => {
    it('trạng thái ban đầu: selectedChannelId=null (panel đóng)', () => {
      expect(createChannelStore().getState().selectedChannelId).toBeNull();
    });

    it('selectChannel: đặt selectedChannelId', () => {
      const store = createChannelStore();
      store.selectChannel('chan-1');
      expect(store.getState().selectedChannelId).toBe('chan-1');
    });

    it('selectChannel gọi lại với channelId KHÁC -> GHI ĐÈ (mở đúng kênh mới)', () => {
      const store = createChannelStore();
      store.selectChannel('chan-1');
      store.selectChannel('chan-2');
      expect(store.getState().selectedChannelId).toBe('chan-2');
    });

    it('selectChannel gọi lại với CÙNG channelId -> idempotent, KHÔNG setState lần 2', () => {
      const store = createChannelStore();
      store.selectChannel('chan-1');
      const stateAfterFirst = store.getState();
      store.selectChannel('chan-1');
      expect(store.getState()).toBe(stateAfterFirst);
    });

    it('clearSelectedChannel: đóng panel -> selectedChannelId=null', () => {
      const store = createChannelStore();
      store.selectChannel('chan-1');
      store.clearSelectedChannel();
      expect(store.getState().selectedChannelId).toBeNull();
    });

    it('clearSelectedChannel khi đã null -> idempotent, KHÔNG setState (tránh re-render thừa)', () => {
      const store = createChannelStore();
      const stateAfterFirst = store.getState();
      store.clearSelectedChannel();
      expect(store.getState()).toBe(stateAfterFirst);
    });

    it('clearSelectedChannel KHÔNG ảnh hưởng channels/channelDisplayStates - lưới phía sau giữ nguyên', () => {
      const store = createChannelStore();
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelDisplayStateChange('chan-1', 'critical');
      store.selectChannel('chan-1');
      store.clearSelectedChannel();
      expect(store.getState().channels.length).toBe(1);
      expect(store.getState().channelDisplayStates.get('chan-1')).toBe('critical');
    });
  });

  describe('applyHistorySnapshot / applyHistoryPoint', () => {
    it('trạng thái ban đầu: channelHistory rỗng (đọc qua .get() coi như "loading" ở nơi tiêu thụ)', () => {
      expect(createChannelStore().getState().channelHistory.size).toBe(0);
    });

    it('applyHistorySnapshot state=loaded -> ghi đúng points', () => {
      const store = createChannelStore();
      store.applyHistorySnapshot('chan-1', { state: 'loaded', points: [{ timestampMs: 1000, bitratePct: 80 }] });
      expect(store.getState().channelHistory.get('chan-1')).toEqual({
        state: 'loaded',
        points: [{ timestampMs: 1000, bitratePct: 80 }],
      });
    });

    it('applyHistorySnapshot state=no-history-data -> ghi đúng nhánh (không phải mảng rỗng)', () => {
      const store = createChannelStore();
      store.applyHistorySnapshot('chan-1', { state: 'no-history-data' });
      expect(store.getState().channelHistory.get('chan-1')).toEqual({ state: 'no-history-data' });
    });

    it('applyHistorySnapshot gọi lại -> GHI ĐÈ toàn bộ (mirror applyRegistrySnapshot, không merge)', () => {
      const store = createChannelStore();
      store.applyHistorySnapshot('chan-1', { state: 'loaded', points: [{ timestampMs: 1000, bitratePct: 80 }] });
      store.applyHistorySnapshot('chan-1', { state: 'no-history-data' });
      expect(store.getState().channelHistory.get('chan-1')).toEqual({ state: 'no-history-data' });
    });

    it('applyHistoryPoint trên kênh chưa có entry -> khởi tạo loaded với đúng 1 điểm', () => {
      const store = createChannelStore();
      store.applyHistoryPoint('chan-1', { timestampMs: 5000, bitratePct: 62.3 });
      expect(store.getState().channelHistory.get('chan-1')).toEqual({
        state: 'loaded',
        points: [{ timestampMs: 5000, bitratePct: 62.3 }],
      });
    });

    it('applyHistoryPoint trên kênh đang no-history-data -> chuyển sang loaded, bắt đầu từ điểm này', () => {
      const store = createChannelStore();
      store.applyHistorySnapshot('chan-1', { state: 'no-history-data' });
      store.applyHistoryPoint('chan-1', { timestampMs: 1000, bitratePct: 40 });
      expect(store.getState().channelHistory.get('chan-1')).toEqual({
        state: 'loaded',
        points: [{ timestampMs: 1000, bitratePct: 40 }],
      });
    });

    it('applyHistoryPoint trên kênh đang loaded -> APPEND vào cuối mảng hiện có', () => {
      const store = createChannelStore();
      store.applyHistorySnapshot('chan-1', { state: 'loaded', points: [{ timestampMs: 1000, bitratePct: 40 }] });
      store.applyHistoryPoint('chan-1', { timestampMs: 2000, bitratePct: 45 });
      expect(store.getState().channelHistory.get('chan-1')).toEqual({
        state: 'loaded',
        points: [
          { timestampMs: 1000, bitratePct: 40 },
          { timestampMs: 2000, bitratePct: 45 },
        ],
      });
    });

    it('applyHistoryPoint trim điểm cũ hơn cửa sổ retention 15 phút (mirror bitrateHistory.ts backend)', () => {
      const store = createChannelStore();
      const fifteenMinMs = 15 * 60 * 1000;
      store.applyHistorySnapshot('chan-1', {
        state: 'loaded',
        points: [
          { timestampMs: 0, bitratePct: 10 }, // sẽ bị trim
          { timestampMs: 1000, bitratePct: 20 }, // sẽ bị trim
        ],
      });
      // Điểm mới cách điểm timestampMs=0 đúng hơn 15 phút -> điểm đó bị trim;
      // điểm timestampMs=1000 vẫn còn trong cửa sổ (age < 15 phút).
      store.applyHistoryPoint('chan-1', { timestampMs: fifteenMinMs + 1, bitratePct: 90 });
      const result = store.getState().channelHistory.get('chan-1');
      expect(result?.state).toBe('loaded');
      const points = result?.state === 'loaded' ? result.points : [];
      expect(points.map((p) => p.timestampMs)).toEqual([1000, fifteenMinMs + 1]);
    });

    it('applyHistoryPoint không ảnh hưởng channelHistory của kênh khác', () => {
      const store = createChannelStore();
      store.applyHistoryPoint('chan-1', { timestampMs: 1000, bitratePct: 10 });
      store.applyHistoryPoint('chan-2', { timestampMs: 1000, bitratePct: 20 });
      const c1 = store.getState().channelHistory.get('chan-1');
      const c2 = store.getState().channelHistory.get('chan-2');
      expect(c1?.state === 'loaded' ? c1.points[0]?.bitratePct : undefined).toBe(10);
      expect(c2?.state === 'loaded' ? c2.points[0]?.bitratePct : undefined).toBe(20);
    });

    it('subscribe: listener được gọi mỗi lần applyHistoryPoint (không idempotent-guard)', () => {
      const store = createChannelStore();
      let callCount = 0;
      store.subscribe(() => {
        callCount++;
      });
      store.applyHistoryPoint('chan-1', { timestampMs: 1000, bitratePct: 10 });
      expect(callCount).toBe(1);
      store.applyHistoryPoint('chan-1', { timestampMs: 2000, bitratePct: 10 });
      expect(callCount).toBe(2);
    });
  });
});
