// Story 2.3: `wsUiAdapter` qua 1 WS server THẬT chạy local (127.0.0.1, port 0
// - OS tự cấp port trống) + 1 WS client THẬT (thư viện `ws`) - không cần
// dashboard-frontend/Next.js thật ở đầu kia (mirror phong cách
// wsTelemetryAdapter.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startWsUiAdapter, type WsUiAdapterHandle } from '../src/adapters/outbound/wsUiAdapter.js';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../src/ports/ChannelRegistryPort.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';

class FakeRegistryPort implements ChannelRegistryPort {
  constructor(private readonly entries: (ChannelRegistryEntry & { channelId: string })[]) {}
  getEntry(channelId: string): ChannelRegistryEntry | undefined {
    return this.entries.find((e) => e.channelId === channelId);
  }
  listEntries(): ReadonlyArray<ChannelRegistryEntry & { channelId: string }> {
    return this.entries;
  }
}

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

function makeEntries(count: number): (ChannelRegistryEntry & { channelId: string })[] {
  return Array.from({ length: count }, (_, i) => ({
    channelId: `chan-${i}`,
    stationName: `Đài ${i}`,
    contactName: `Người ${i}`,
    contactPhone: `090000000${i}`,
    gridPosition: i,
    baselineKbps: 4000,
  }));
}

function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitUntil: timeout chờ điều kiện'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function startTestServer(entries: (ChannelRegistryEntry & { channelId: string })[]) {
  const registryPort = new FakeRegistryPort(entries);
  const logger = new FakeLogger();
  const handle: WsUiAdapterHandle = await startWsUiAdapter({ port: 0, host: '127.0.0.1', registryPort, logger });
  return { registryPort, logger, handle };
}

// Code review [race]: server gửi `registry-snapshot` (+ replay `channel-seen`
// nếu có) NGAY trong handler 'connection' (Boundaries) - nếu test attach
// listener 'message' SAU KHI await xong 'open' (2 tick riêng biệt), message
// đã tới + được `ws` (thư viện) parse/emit trước khi listener kịp gắn sẽ bị
// mất VĨNH VIỄN (EventEmitter không queue lại cho listener gắn muộn). Phải
// gắn 'message' NGAY lúc tạo socket (đồng bộ, trước khi 'open' có cơ hội
// fire) để không bỏ lỡ bất kỳ message nào server gửi ngay sau handshake.
async function openClientWithMessages(port: number): Promise<{ ws: WebSocket; messages: unknown[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: unknown[] = [];
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, messages };
}

async function openClient(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

test('connect KHÔNG kèm Authorization header -> vẫn accept (LAN-only, không auth theo Boundaries)', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const ws = await openClient(handle.port);
    ws.close();
  } finally {
    await handle.close();
  }
});

test('client connect -> nhận registry-snapshot NGAY, đủ toàn bộ kênh từ listEntries()', async () => {
  const entries = makeEntries(20);
  const { handle } = await startTestServer(entries);
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);

    await waitUntil(() => messages.length > 0);
    const snapshot = messages[0] as { type: string; channels: unknown[] };
    assert.equal(snapshot.type, 'registry-snapshot');
    assert.equal(snapshot.channels.length, 20);
    assert.deepEqual(snapshot.channels[0], {
      channel_id: 'chan-0',
      station_name: 'Đài 0',
      contact_name: 'Người 0',
      contact_phone: '0900000000',
      grid_position: 0,
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('kênh đầu tiên gửi telemetry (publishChannelSeen) -> mọi client đang mở nhận channel-seen ngay, không chờ 5s', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0); // chờ registry-snapshot trước

    handle.publishChannelSeen('chan-0', '2026-09-04T00:00:00.000Z');

    await waitUntil(() => messages.length > 1);
    assert.deepEqual(messages[1], {
      type: 'channel-seen',
      channel_id: 'chan-0',
      timestamp: '2026-09-04T00:00:00.000Z',
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('frontend connect MUỘN (sau khi backend đã seen vài kênh) -> replay channel-seen cho đủ các kênh đó NGAY SAU registry-snapshot', async () => {
  const { handle } = await startTestServer(makeEntries(5));
  try {
    // Backend đã "seen" chan-0/chan-2 TRƯỚC KHI có client nào connect.
    handle.publishChannelSeen('chan-0', '2026-09-04T00:00:00.000Z');
    handle.publishChannelSeen('chan-2', '2026-09-04T00:00:01.000Z');

    const { ws, messages } = await openClientWithMessages(handle.port);

    await waitUntil(() => messages.length >= 3);
    const snapshot = messages[0] as { type: string };
    assert.equal(snapshot.type, 'registry-snapshot');
    const replayed = messages.slice(1) as { type: string; channel_id: string; timestamp: string }[];
    assert.deepEqual(
      replayed.map((m) => m.channel_id).sort(),
      ['chan-0', 'chan-2']
    );
    assert.ok(replayed.every((m) => m.type === 'channel-seen'));
    assert.equal(replayed.find((m) => m.channel_id === 'chan-0')?.timestamp, '2026-09-04T00:00:00.000Z');
    assert.equal(replayed.find((m) => m.channel_id === 'chan-2')?.timestamp, '2026-09-04T00:00:01.000Z');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishChannelSeen gọi lặp lại cho cùng 1 channel_id -> chỉ broadcast/replay đúng 1 lần (idempotent)', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0);

    handle.publishChannelSeen('chan-0', '2026-09-04T00:00:00.000Z');
    handle.publishChannelSeen('chan-0', '2026-09-04T00:00:05.000Z'); // lặp lại - phải bị bỏ qua

    await waitUntil(() => messages.length > 1);
    await new Promise((resolve) => setTimeout(resolve, 100)); // đảm bảo không có broadcast thứ 2 tới muộn

    const seenMessages = messages.slice(1);
    assert.equal(seenMessages.length, 1, 'chỉ đúng 1 lần channel-seen được broadcast cho 1 channel_id');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishChannelSeen broadcast tới TẤT CẢ client đang mở kết nối cùng lúc', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws: wsA, messages: messagesA } = await openClientWithMessages(handle.port);
    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesA.length > 0 && messagesB.length > 0);

    handle.publishChannelSeen('chan-1', '2026-09-04T00:00:00.000Z');

    await waitUntil(() => messagesA.length > 1 && messagesB.length > 1);
    assert.equal((messagesA[1] as { channel_id: string }).channel_id, 'chan-1');
    assert.equal((messagesB[1] as { channel_id: string }).channel_id, 'chan-1');

    wsA.close();
    wsB.close();
  } finally {
    await handle.close();
  }
});

test('WS UI client mất kết nối/tab đóng -> log ui_ws_disconnect, KHÔNG throw/crash, server vẫn phục vụ client khác', async () => {
  const { logger, handle } = await startTestServer(makeEntries(2));
  try {
    const wsA = await openClient(handle.port);
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_connect'));

    wsA.close();
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_disconnect'));

    // Server vẫn sống - client khác vẫn connect + nhận snapshot bình thường.
    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesB.length > 0);
    assert.equal((messagesB[0] as { type: string }).type, 'registry-snapshot');

    // publishChannelSeen sau khi wsA đã đóng không được throw (client cũ đã
    // tự dọn khỏi wss.clients).
    assert.doesNotThrow(() => handle.publishChannelSeen('chan-0', '2026-09-04T00:00:00.000Z'));

    wsB.close();
  } finally {
    await handle.close();
  }
});

test('close(): đóng server + mọi client đang mở, không throw', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  const ws = await openClient(handle.port);
  await assert.doesNotReject(() => handle.close());
  ws.close();
});
