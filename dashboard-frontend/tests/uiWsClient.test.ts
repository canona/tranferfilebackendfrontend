import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { applyUiWsMessage, connectUiWsClient } from '../src/services/uiWsClient';
import { createChannelStore } from '../src/state/channelStore';

describe('applyUiWsMessage', () => {
  it('registry-snapshot hợp lệ -> áp dụng vào store, map đúng snake_case -> camelCase', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'registry-snapshot',
        channels: [
          {
            channel_id: 'chan-1',
            station_name: 'Đài 1',
            contact_name: 'Nguyễn Văn A',
            contact_phone: '0900000001',
            grid_position: 0,
          },
          {
            channel_id: 'chan-2',
            station_name: 'Đài 2',
            contact_name: 'Trần Thị B',
            contact_phone: '0900000002',
            grid_position: 1,
          },
        ],
      })
    );

    const state = store.getState();
    expect(state.channels.length).toBe(2);
    expect(state.channels[0]).toEqual({
      channelId: 'chan-1',
      stationName: 'Đài 1',
      contactName: 'Nguyễn Văn A',
      contactPhone: '0900000001',
      gridPosition: 0,
    });
  });

  it('channel-seen hợp lệ -> đánh dấu channelId đã seen trong store', () => {
    const store = createChannelStore();
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-seen', channel_id: 'chan-1', timestamp: '2026-09-04T00:00:00.000Z' }));
    expect(store.getState().seenChannelIds.has('chan-1')).toBe(true);
  });

  it('registry-snapshot rồi replay nhiều channel-seen (client connect muộn) -> tất cả áp dụng đúng thứ tự', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'registry-snapshot',
        channels: [
          { channel_id: 'chan-1', station_name: 'Đài 1', contact_name: 'A', contact_phone: '090', grid_position: 0 },
          { channel_id: 'chan-2', station_name: 'Đài 2', contact_name: 'B', contact_phone: '091', grid_position: 1 },
        ],
      })
    );
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-seen', channel_id: 'chan-1', timestamp: '2026-09-04T00:00:00.000Z' }));
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-seen', channel_id: 'chan-2', timestamp: '2026-09-04T00:00:01.000Z' }));

    const state = store.getState();
    expect(state.channels.length).toBe(2);
    expect([...state.seenChannelIds].sort()).toEqual(['chan-1', 'chan-2']);
  });

  it('JSON hỏng -> bỏ qua âm thầm, KHÔNG throw, state giữ nguyên', () => {
    const store = createChannelStore();
    expect(() => applyUiWsMessage(store, '{not-valid-json')).not.toThrow();
    expect(store.getState()).toEqual({
      channels: [],
      seenChannelIds: new Set(),
      channelDisplayStates: new Map(),
      connectionStatus: 'connected',
      lastConnectedAt: null,
      channelMachineOffline: new Set(),
      channelSnapshots: new Map(),
      selectedChannelId: null,
      channelHistory: new Map(),
      channelAck: new Map(),
    });
  });

  it('type lạ (chưa định nghĩa) -> bỏ qua âm thầm, KHÔNG throw', () => {
    const store = createChannelStore();
    expect(() => applyUiWsMessage(store, JSON.stringify({ type: 'unknown-future-type', foo: 'bar' }))).not.toThrow();
    expect(store.getState().channels.length).toBe(0);
  });

  it('registry-snapshot với 1 channel thiếu field bắt buộc -> toàn bộ message bị coi là không hợp lệ, bỏ qua (không áp dụng 1 phần)', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'registry-snapshot',
        channels: [
          { channel_id: 'chan-1', station_name: 'Đài 1', contact_name: 'A', contact_phone: '090', grid_position: 0 },
          { channel_id: 'chan-2' /* thiếu station_name/contact_name/contact_phone/grid_position */ },
        ],
      })
    );
    expect(store.getState().channels.length).toBe(0);
  });

  it('channel-seen thiếu timestamp -> bỏ qua âm thầm, KHÔNG throw', () => {
    const store = createChannelStore();
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-seen', channel_id: 'chan-1' }));
    expect(store.getState().seenChannelIds.size).toBe(0);
  });

  // Code review [patch #5]: grid_position phải là số nguyên 0-19 - phòng thủ
  // lớp 2, nhất quán tinh thần channelState.ts validate lại connection_state.
  it('registry-snapshot với grid_position ngoài khoảng 0-19/không nguyên -> toàn bộ message bị coi không hợp lệ, bỏ qua', () => {
    const invalidGridPositions = [-1, 20, 1.5, Number.NaN];
    for (const gridPosition of invalidGridPositions) {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({
          type: 'registry-snapshot',
          channels: [
            { channel_id: 'chan-1', station_name: 'Đài 1', contact_name: 'A', contact_phone: '090', grid_position: gridPosition },
          ],
        })
      );
      expect(store.getState().channels.length).toBe(0);
    }
  });

  // Story 2.6: `channel-state-change` - I/O matrix.
  it('channel-state-change hợp lệ -> channelStore cập nhật channelDisplayStates', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({ type: 'channel-state-change', channel_id: 'chan-1', display_state: 'warning', timestamp: '2026-09-06T00:00:00.000Z' })
    );
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('warning');
  });

  it('channel-state-change với sub_type=config-or-security-suspected -> áp dụng đúng display_state (subType đó không dùng ở UI, chỉ mang qua wire)', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'channel-state-change',
        channel_id: 'chan-1',
        display_state: 'critical',
        sub_type: 'config-or-security-suspected',
        timestamp: '2026-09-06T00:00:00.000Z',
      })
    );
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('critical');
    expect(store.getState().channelMachineOffline.has('chan-1')).toBe(false);
  });

  // Story 2.7: sub_type='machine-offline' - CHỈ subType này thực sự được đọc
  // ở channelStore (channelMachineOffline set).
  it('channel-state-change với sub_type=machine-offline -> áp dụng đúng display_state VÀ thêm channelId vào channelMachineOffline', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'channel-state-change',
        channel_id: 'chan-1',
        display_state: 'critical',
        sub_type: 'machine-offline',
        timestamp: '2026-09-06T00:00:00.000Z',
      })
    );
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('critical');
    expect(store.getState().channelMachineOffline.has('chan-1')).toBe(true);
  });

  it('channel-state-change với sub_type lạ (không hợp lệ) -> toàn bộ message bị coi không hợp lệ, bỏ qua', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'channel-state-change',
        channel_id: 'chan-1',
        display_state: 'critical',
        sub_type: 'unknown-sub-type',
        timestamp: '2026-09-06T00:00:00.000Z',
      })
    );
    expect(store.getState().channelDisplayStates.size).toBe(0);
  });

  it('channel-state-change với display_state lạ ("unknown") -> bỏ qua âm thầm, KHÔNG cập nhật store', () => {
    const store = createChannelStore();
    expect(() =>
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-state-change', channel_id: 'chan-1', display_state: 'unknown', timestamp: '2026-09-06T00:00:00.000Z' })
      )
    ).not.toThrow();
    expect(store.getState().channelDisplayStates.size).toBe(0);
  });

  it('channel-state-change thiếu field bắt buộc (display_state) -> bỏ qua âm thầm', () => {
    const store = createChannelStore();
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-state-change', channel_id: 'chan-1', timestamp: '2026-09-06T00:00:00.000Z' }));
    expect(store.getState().channelDisplayStates.size).toBe(0);
  });

  it('channel-state-change gọi lại cho CÙNG channel_id với display_state KHÁC -> GHI ĐÈ (không idempotent-guard, khác channel-seen)', () => {
    const store = createChannelStore();
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-state-change', channel_id: 'chan-1', display_state: 'ok', timestamp: '2026-09-06T00:00:00.000Z' }));
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-state-change', channel_id: 'chan-1', display_state: 'critical', timestamp: '2026-09-06T00:00:05.000Z' }));
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('critical');
  });

  // Bổ sung video-preview thật (AD-22): channel-snapshot.
  it('channel-snapshot hợp lệ -> channelStore lưu đúng data-URI theo channel_id', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({ type: 'channel-snapshot', channel_id: 'chan-1', image_base64: 'ZmFrZS1qcGVn', timestamp: '2026-09-07T00:00:00.000Z' })
    );
    expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,ZmFrZS1qcGVn');
  });

  it('channel-snapshot thiếu/rỗng image_base64 -> bỏ qua âm thầm, KHÔNG cập nhật store', () => {
    const store = createChannelStore();
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-snapshot', channel_id: 'chan-1', timestamp: '2026-09-07T00:00:00.000Z' }));
    applyUiWsMessage(
      store,
      JSON.stringify({ type: 'channel-snapshot', channel_id: 'chan-1', image_base64: '', timestamp: '2026-09-07T00:00:00.000Z' })
    );
    expect(store.getState().channelSnapshots.size).toBe(0);
  });

  it('channel-snapshot thiếu channel_id -> bỏ qua âm thầm', () => {
    const store = createChannelStore();
    applyUiWsMessage(store, JSON.stringify({ type: 'channel-snapshot', image_base64: 'ZmFrZQ==', timestamp: '2026-09-07T00:00:00.000Z' }));
    expect(store.getState().channelSnapshots.size).toBe(0);
  });

  it('channel-snapshot gọi lại cho CÙNG channel_id với image_base64 KHÁC -> GHI ĐÈ (không idempotent-guard, mirror channel-state-change)', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({ type: 'channel-snapshot', channel_id: 'chan-1', image_base64: 'khung-1', timestamp: '2026-09-07T00:00:00.000Z' })
    );
    applyUiWsMessage(
      store,
      JSON.stringify({ type: 'channel-snapshot', channel_id: 'chan-1', image_base64: 'khung-2', timestamp: '2026-09-07T00:00:01.500Z' })
    );
    expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,khung-2');
  });

  it('registry-snapshot với grid_position hợp lệ ở biên (0 và 19) -> áp dụng bình thường', () => {
    const store = createChannelStore();
    applyUiWsMessage(
      store,
      JSON.stringify({
        type: 'registry-snapshot',
        channels: [
          { channel_id: 'chan-first', station_name: 'Đài đầu', contact_name: 'A', contact_phone: '090', grid_position: 0 },
          { channel_id: 'chan-last', station_name: 'Đài cuối', contact_name: 'B', contact_phone: '091', grid_position: 19 },
        ],
      })
    );
    expect(store.getState().channels.length).toBe(2);
  });

  // --- Story 3.2: channel-history-snapshot / channel-history-point ---

  describe('channel-history-snapshot', () => {
    it('state=loaded kèm points hợp lệ -> channelHistory cập nhật đúng, map snake_case -> camelCase', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({
          type: 'channel-history-snapshot',
          channel_id: 'chan-1',
          state: 'loaded',
          points: [
            { timestamp_ms: 1000, bitrate_pct: 55.5 },
            { timestamp_ms: 2000, bitrate_pct: 60 },
          ],
        })
      );
      expect(store.getState().channelHistory.get('chan-1')).toEqual({
        state: 'loaded',
        points: [
          { timestampMs: 1000, bitratePct: 55.5 },
          { timestampMs: 2000, bitratePct: 60 },
        ],
      });
    });

    it('state=no-history-data -> channelHistory ghi đúng nhánh no-history-data (KHÔNG phải mảng rỗng)', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-history-snapshot', channel_id: 'chan-1', state: 'no-history-data' })
      );
      expect(store.getState().channelHistory.get('chan-1')).toEqual({ state: 'no-history-data' });
    });

    it('state=loaded nhưng points KHÔNG phải mảng hợp lệ -> toàn bộ message bị coi không hợp lệ, bỏ qua', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-history-snapshot', channel_id: 'chan-1', state: 'loaded' })
      );
      expect(store.getState().channelHistory.size).toBe(0);
    });

    it('state lạ (không phải loaded/no-history-data, vd "loading") -> bỏ qua âm thầm (backend không bao giờ gửi nhánh này)', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-history-snapshot', channel_id: 'chan-1', state: 'loading' })
      );
      expect(store.getState().channelHistory.size).toBe(0);
    });

    it('thiếu channel_id -> bỏ qua âm thầm, KHÔNG throw', () => {
      const store = createChannelStore();
      expect(() =>
        applyUiWsMessage(store, JSON.stringify({ type: 'channel-history-snapshot', state: 'no-history-data' }))
      ).not.toThrow();
      expect(store.getState().channelHistory.size).toBe(0);
    });

    it('điểm trong points thiếu field (vd bitrate_pct) -> toàn bộ message bị coi không hợp lệ, bỏ qua', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({
          type: 'channel-history-snapshot',
          channel_id: 'chan-1',
          state: 'loaded',
          points: [{ timestamp_ms: 1000 }],
        })
      );
      expect(store.getState().channelHistory.size).toBe(0);
    });
  });

  describe('channel-history-point', () => {
    it('hợp lệ -> channelHistory chuyển sang loaded, append đúng điểm', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-history-point', channel_id: 'chan-1', bitrate_pct: 62.3, timestamp_ms: 5000 })
      );
      expect(store.getState().channelHistory.get('chan-1')).toEqual({
        state: 'loaded',
        points: [{ timestampMs: 5000, bitratePct: 62.3 }],
      });
    });

    it('gọi liên tiếp -> APPEND (không ghi đè), thứ tự đúng theo lần gọi', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-history-point', channel_id: 'chan-1', bitrate_pct: 50, timestamp_ms: 1000 })
      );
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-history-point', channel_id: 'chan-1', bitrate_pct: 55, timestamp_ms: 2000 })
      );
      const result = store.getState().channelHistory.get('chan-1');
      expect(result?.state).toBe('loaded');
      expect(result?.state === 'loaded' ? result.points : []).toEqual([
        { timestampMs: 1000, bitratePct: 50 },
        { timestampMs: 2000, bitratePct: 55 },
      ]);
    });

    it('thiếu field bắt buộc -> bỏ qua âm thầm, KHÔNG throw', () => {
      const store = createChannelStore();
      expect(() =>
        applyUiWsMessage(store, JSON.stringify({ type: 'channel-history-point', channel_id: 'chan-1' }))
      ).not.toThrow();
      expect(store.getState().channelHistory.size).toBe(0);
    });
  });

  describe('channel-ack-change (Story 3.3)', () => {
    it('acknowledged=true kèm ack_label -> channelAck ghi đúng label theo channelId', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-ack-change', channel_id: 'chan-1', acknowledged: true, ack_label: 'NV.A' })
      );
      expect(store.getState().channelAck.get('chan-1')).toBe('NV.A');
    });

    it('acknowledged=false -> gỡ entry khỏi channelAck (auto-clear)', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-ack-change', channel_id: 'chan-1', acknowledged: true, ack_label: 'NV.A' })
      );
      applyUiWsMessage(store, JSON.stringify({ type: 'channel-ack-change', channel_id: 'chan-1', acknowledged: false }));
      expect(store.getState().channelAck.has('chan-1')).toBe(false);
    });

    it('thiếu channel_id -> bỏ qua âm thầm, KHÔNG throw', () => {
      const store = createChannelStore();
      expect(() =>
        applyUiWsMessage(store, JSON.stringify({ type: 'channel-ack-change', acknowledged: true, ack_label: 'NV.A' }))
      ).not.toThrow();
      expect(store.getState().channelAck.size).toBe(0);
    });

    it('acknowledged không phải boolean -> toàn bộ message bị coi không hợp lệ, bỏ qua', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-ack-change', channel_id: 'chan-1', acknowledged: 'true', ack_label: 'NV.A' })
      );
      expect(store.getState().channelAck.size).toBe(0);
    });

    it('ack_label không phải string (khi có mặt) -> toàn bộ message bị coi không hợp lệ, bỏ qua', () => {
      const store = createChannelStore();
      applyUiWsMessage(
        store,
        JSON.stringify({ type: 'channel-ack-change', channel_id: 'chan-1', acknowledged: true, ack_label: 123 })
      );
      expect(store.getState().channelAck.size).toBe(0);
    });
  });
});

// Code review [patch #2]: `connectUiWsClient` (hàm thật mở WebSocket) chưa
// có test nào trước đây - dùng 1 WS server THẬT (thư viện `ws`, mirror phong
// cách `wsUiAdapter.test.ts` phía backend) làm "backend" giả lập, jsdom's
// global `WebSocket` (có sẵn, không cần polyfill) làm client thật.
describe('connectUiWsClient', () => {
  let servers: WebSocketServer[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) client.terminate();
            server.close(() => resolve());
          })
      )
    );
    servers = [];
  });

  async function startFakeBackend(): Promise<{ url: string; server: WebSocketServer }> {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return { url: `ws://127.0.0.1:${port}`, server };
  }

  function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil: timeout chờ điều kiện'));
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  it('connect thành công -> store cập nhật đúng khi server gửi registry-snapshot rồi channel-seen', async () => {
    const { url, server } = await startFakeBackend();
    server.on('connection', (ws) => {
      ws.send(
        JSON.stringify({
          type: 'registry-snapshot',
          channels: [
            { channel_id: 'chan-1', station_name: 'Đài 1', contact_name: 'A', contact_phone: '090', grid_position: 0 },
          ],
        })
      );
      ws.send(JSON.stringify({ type: 'channel-seen', channel_id: 'chan-1', timestamp: '2026-09-04T00:00:00.000Z' }));
    });

    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    try {
      await waitUntil(() => store.getState().channels.length > 0 && store.getState().seenChannelIds.has('chan-1'));
      expect(store.getState().channels[0]?.channelId).toBe('chan-1');
      expect(store.getState().seenChannelIds.has('chan-1')).toBe(true);
    } finally {
      disconnect();
    }
  });

  it('connect thành công -> store cập nhật channelDisplayStates khi server gửi channel-state-change', async () => {
    const { url, server } = await startFakeBackend();
    server.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'channel-state-change', channel_id: 'chan-1', display_state: 'warning', timestamp: '2026-09-06T00:00:00.000Z' }));
    });

    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    try {
      await waitUntil(() => store.getState().channelDisplayStates.get('chan-1') === 'warning');
      expect(store.getState().channelDisplayStates.get('chan-1')).toBe('warning');
    } finally {
      disconnect();
    }
  });

  it('connect thành công -> store cập nhật channelSnapshots khi server gửi channel-snapshot', async () => {
    const { url, server } = await startFakeBackend();
    server.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'channel-snapshot', channel_id: 'chan-1', image_base64: 'ZmFrZS1qcGVn', timestamp: '2026-09-07T00:00:00.000Z' }));
    });

    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    try {
      await waitUntil(() => store.getState().channelSnapshots.has('chan-1'));
      expect(store.getState().channelSnapshots.get('chan-1')).toBe('data:image/jpeg;base64,ZmFrZS1qcGVn');
    } finally {
      disconnect();
    }
  });

  it('gọi hàm disconnect trả về -> đóng socket THẬT (server nhận được sự kiện close)', async () => {
    const { url, server } = await startFakeBackend();
    const serverSawClose = new Promise<void>((resolve) => {
      server.on('connection', (ws) => {
        // Gửi 1 message ngay - dùng làm tín hiệu client-side đã thực sự
        // OPEN (readyState) trước khi test gọi disconnect(), tránh đóng
        // socket còn đang CONNECTING (hành vi hợp lệ nhưng không phải điều
        // test này muốn xác nhận).
        ws.send(JSON.stringify({ type: 'channel-seen', channel_id: 'chan-x', timestamp: '2026-09-04T00:00:00.000Z' }));
        ws.once('close', () => resolve());
      });
    });

    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    await waitUntil(() => store.getState().seenChannelIds.has('chan-x'));

    disconnect();

    await serverSawClose; // không timeout -> xác nhận socket THẬT sự đã đóng
  });

  // Code review [patch #1]: url sai định dạng -> new WebSocket(url) throw
  // đồng bộ - connectUiWsClient phải bọc lại, không được để lỗi thoát ra
  // ngoài (tránh crash trắng React tree khi gọi trong useEffect).
  it('url sai định dạng -> KHÔNG throw, trả về 1 disconnect no-op an toàn để gọi', () => {
    const store = createChannelStore();
    let disconnect: () => void = () => {};
    expect(() => {
      disconnect = connectUiWsClient('khong-phai-url-hop-le', store).close;
    }).not.toThrow();
    expect(() => disconnect()).not.toThrow();
  });

  // Code review [patch round 2]: `new WebSocket(url)` throw đồng bộ trước đây
  // KHÔNG cập nhật connectionStatus - 1 URL cấu hình sai vĩnh viễn (vd
  // NEXT_PUBLIC_DASHBOARD_UI_WS_URL lỗi lúc deploy) khiến connectionStatus kẹt
  // mãi ở 'connected' lạc quan mặc định dù không hề có kết nối nào thành công,
  // banner/grid-overlay không bao giờ hiện.
  it('url sai định dạng -> connectionStatus chuyển "disconnected" (mirror onclose/onerror)', () => {
    const store = createChannelStore();
    expect(store.getState().connectionStatus).toBe('connected'); // mặc định lạc quan lúc mount
    const disconnect = connectUiWsClient('khong-phai-url-hop-le', store).close;
    try {
      expect(store.getState().connectionStatus).toBe('disconnected');
    } finally {
      disconnect();
    }
  });

  // Story 2.7: connectionStatus/lastConnectedAt + reconnect (Boundaries: "tự
  // reconnect khi onclose/onerror, retry cố định vd 2000ms").
  it('connect thành công (onopen) -> connectionStatus="connected", lastConnectedAt được set (kể cả lần connect ĐẦU TIÊN)', async () => {
    const { url } = await startFakeBackend();
    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    try {
      await waitUntil(() => store.getState().lastConnectedAt !== null);
      expect(store.getState().connectionStatus).toBe('connected');
      expect(typeof store.getState().lastConnectedAt).toBe('string');
    } finally {
      disconnect();
    }
  });

  it('server đóng kết nối đột ngột (mirror backend chết) -> connectionStatus chuyển "disconnected" NGAY', async () => {
    const { url, server } = await startFakeBackend();
    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    try {
      await waitUntil(() => store.getState().lastConnectedAt !== null);

      // Đóng toàn bộ client đang mở phía server - mô phỏng backend chết/rớt
      // kết nối đột ngột (mirror wsTelemetryAdapter.test.ts's style).
      for (const client of server.clients) client.terminate();

      await waitUntil(() => store.getState().connectionStatus === 'disconnected');
      expect(store.getState().connectionStatus).toBe('disconnected');
    } finally {
      disconnect();
    }
  });

  it('sau khi disconnected, server mở lại (cùng port) -> tự động reconnect (retry cố định ~2000ms), connectionStatus trở lại "connected", registry-snapshot mới tới như connect thường', async () => {
    const first = await startFakeBackend();
    const port = new URL(first.url).port;

    const store = createChannelStore();
    const disconnect = connectUiWsClient(first.url, store).close;
    try {
      await waitUntil(() => store.getState().lastConnectedAt !== null);
      const firstConnectedAt = store.getState().lastConnectedAt;

      // "Backend chết": đóng hẳn server đầu tiên (không chỉ terminate client -
      // đóng cả port để mô phỏng đúng backend ngừng phục vụ hoàn toàn).
      for (const client of first.server.clients) client.terminate();
      await new Promise<void>((resolve) => first.server.close(() => resolve()));
      await waitUntil(() => store.getState().connectionStatus === 'disconnected');

      // "Backend phục hồi": mở lại 1 server MỚI đúng port cũ - client phải tự
      // reconnect (retry cố định RECONNECT_DELAY_MS, không cần gọi lại
      // connectUiWsClient/reload trang - AC "Given WS UI mất kết nối ...
      // khi reconnect, banner biến mất ngay không cần reload").
      const second = new WebSocketServer({ port: Number(port), host: '127.0.0.1' });
      servers.push(second);
      second.on('connection', (ws) => {
        ws.send(
          JSON.stringify({
            type: 'registry-snapshot',
            channels: [{ channel_id: 'chan-reconnected', station_name: 'Đài R', contact_name: 'A', contact_phone: '090', grid_position: 0 }],
          })
        );
      });
      await new Promise<void>((resolve) => second.once('listening', resolve));

      await waitUntil(() => store.getState().connectionStatus === 'connected', 5000);
      await waitUntil(() => store.getState().channels.some((c) => c.channelId === 'chan-reconnected'), 5000);

      expect(store.getState().connectionStatus).toBe('connected');
      expect(typeof store.getState().lastConnectedAt).toBe('string');
      expect(store.getState().lastConnectedAt).not.toBe(firstConnectedAt);
    } finally {
      disconnect();
    }
  }, 10000);

  it('disconnect() gọi trong lúc đang chờ reconnect timer -> huỷ timer, KHÔNG tự reconnect nữa (cờ disposed)', async () => {
    const { url, server } = await startFakeBackend();
    const port = new URL(url).port;

    const store = createChannelStore();
    const disconnect = connectUiWsClient(url, store).close;
    await waitUntil(() => store.getState().lastConnectedAt !== null);

    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await waitUntil(() => store.getState().connectionStatus === 'disconnected');

    // Gọi disconnect() NGAY (trong lúc chắc chắn còn đang chờ RECONNECT_DELAY_MS)
    // - cờ disposed phải chặn lần connect() tiếp theo.
    disconnect();

    // Mở lại server ở đúng port - nếu disposed KHÔNG hoạt động đúng, client cũ
    // (đã disconnect) vẫn sẽ reconnect và cập nhật store lại 'connected'.
    const revived = new WebSocketServer({ port: Number(port), host: '127.0.0.1' });
    servers.push(revived);
    await new Promise<void>((resolve) => revived.once('listening', resolve));

    // Đợi lâu hơn RECONNECT_DELAY_MS (2000ms) để chắc chắn không có reconnect
    // ngầm nào xảy ra sau khi đã disconnect() - store phải giữ nguyên
    // 'disconnected' (client cũ không còn hoạt động).
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(store.getState().connectionStatus).toBe('disconnected');
  }, 10000);

  // Story 3.3: `connectUiWsClient` giờ trả về `{ close, sendAckCommand }` -
  // `sendAckCommand` là cầu nối WS hai chiều ĐẦU TIÊN của dashboard-frontend
  // (AD-25). Test bằng 1 WS server THẬT (mirror mọi test khác ở describe này).
  describe('sendAckCommand (Story 3.3)', () => {
    it('gửi đúng envelope chung (schema_version=1, channel_id, timestamp ISO, event_type=ack-command, payload.operator_label)', async () => {
      const { url, server } = await startFakeBackend();
      const received: unknown[] = [];
      server.on('connection', (ws) => {
        ws.on('message', (data) => received.push(JSON.parse(data.toString())));
      });

      const store = createChannelStore();
      const client = connectUiWsClient(url, store);
      try {
        await waitUntil(() => server.clients.size > 0);
        client.sendAckCommand('chan-1', 'NV.A');

        await waitUntil(() => received.length > 0);
        const message = received[0] as Record<string, unknown>;
        expect(message.schema_version).toBe(1);
        expect(message.channel_id).toBe('chan-1');
        expect(message.event_type).toBe('ack-command');
        expect(typeof message.timestamp).toBe('string');
        expect(new Date(message.timestamp as string).toISOString()).toBe(message.timestamp);
        expect(message.payload).toEqual({ operator_label: 'NV.A' });
      } finally {
        client.close();
      }
    });

    it('gọi TRƯỚC khi socket kịp OPEN (vd ngay sau connectUiWsClient()) -> no-op an toàn, KHÔNG throw', () => {
      const store = createChannelStore();
      const client = connectUiWsClient('ws://127.0.0.1:1', store); // port không ai lắng nghe - socket không bao giờ OPEN
      try {
        expect(() => client.sendAckCommand('chan-1', 'NV.A')).not.toThrow();
      } finally {
        client.close();
      }
    });

    it('gọi sau khi close() -> no-op an toàn, KHÔNG throw', async () => {
      const { url } = await startFakeBackend();
      const store = createChannelStore();
      const client = connectUiWsClient(url, store);
      await waitUntil(() => store.getState().lastConnectedAt !== null);

      client.close();

      expect(() => client.sendAckCommand('chan-1', 'NV.A')).not.toThrow();
    });

    it('server (mọi client WS UI khác) nhận đúng channel-ack-change broadcast SAU KHI backend xử lý ack-command này - round-trip end-to-end qua applyUiWsMessage', async () => {
      const { url, server } = await startFakeBackend();
      server.on('connection', (ws) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as { channel_id: string; payload: { operator_label: string } };
          // Mirror hành vi thật của backend: nhận ack-command -> broadcast
          // channel-ack-change tới mọi client (kể cả chính client vừa gửi).
          ws.send(
            JSON.stringify({
              type: 'channel-ack-change',
              channel_id: parsed.channel_id,
              acknowledged: true,
              ack_label: parsed.payload.operator_label,
            })
          );
        });
      });

      const store = createChannelStore();
      const client = connectUiWsClient(url, store);
      try {
        await waitUntil(() => server.clients.size > 0);
        client.sendAckCommand('chan-1', 'NV.A');

        await waitUntil(() => store.getState().channelAck.get('chan-1') === 'NV.A');
        expect(store.getState().channelAck.get('chan-1')).toBe('NV.A');
      } finally {
        client.close();
      }
    });
  });
});
