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
    expect(store.getState()).toEqual({ channels: [], seenChannelIds: new Set() });
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
    const disconnect = connectUiWsClient(url, store);
    try {
      await waitUntil(() => store.getState().channels.length > 0 && store.getState().seenChannelIds.has('chan-1'));
      expect(store.getState().channels[0]?.channelId).toBe('chan-1');
      expect(store.getState().seenChannelIds.has('chan-1')).toBe(true);
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
    const disconnect = connectUiWsClient(url, store);
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
      disconnect = connectUiWsClient('khong-phai-url-hop-le', store);
    }).not.toThrow();
    expect(() => disconnect()).not.toThrow();
  });
});
