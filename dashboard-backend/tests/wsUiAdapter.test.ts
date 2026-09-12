// Story 2.3: `wsUiAdapter` qua 1 WS server THẬT chạy local (127.0.0.1, port 0
// - OS tự cấp port trống) + 1 WS client THẬT (thư viện `ws`) - không cần
// dashboard-frontend/Next.js thật ở đầu kia (mirror phong cách
// wsTelemetryAdapter.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startWsUiAdapter, type WsUiAdapterHandle } from '../src/adapters/outbound/wsUiAdapter.js';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../src/ports/ChannelRegistryPort.js';
import type { HistoryPort, HistoryQueryResult } from '../src/ports/HistoryPort.js';
import type { AckCommandPort } from '../src/ports/AckCommandPort.js';
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

// Story 3.2: fake `HistoryPort` (Boundaries "adapter query trực tiếp
// getHistory(), KHÔNG cache riêng" - test bằng fake, không cần
// BitrateHistoryService thật). Cấu hình sẵn kết quả/kênh + có thể tuỳ biến
// throw để test I/O matrix "getHistory() throw lúc connect".
class FakeHistoryPort implements HistoryPort {
  constructor(private readonly results: Record<string, HistoryQueryResult | (() => HistoryQueryResult)> = {}) {}
  recordBitrate(): void {
    // Không dùng ở test file này (adapter chỉ ĐỌC qua getHistory(), không ghi).
  }
  getHistory(channelId: string): HistoryQueryResult {
    const result = this.results[channelId];
    if (result === undefined) return { state: 'no-history-data' };
    if (typeof result === 'function') return result();
    return result;
  }
}

// Story 3.3: fake `AckCommandPort` (Boundaries "adapter chỉ parse/validate
// hình dạng, forward vào port" - test được bằng fake, không cần
// `ChannelStateService` thật).
class FakeAckCommandPort implements AckCommandPort {
  calls: { channelId: string; operatorLabel: string; timestampMs: number }[] = [];
  handleAckCommand(channelId: string, operatorLabel: string, timestampMs: number): void {
    this.calls.push({ channelId, operatorLabel, timestampMs });
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

async function startTestServer(
  entries: (ChannelRegistryEntry & { channelId: string })[],
  historyPort: HistoryPort = new FakeHistoryPort(),
  ackCommandPort: AckCommandPort = new FakeAckCommandPort()
) {
  const registryPort = new FakeRegistryPort(entries);
  const logger = new FakeLogger();
  const handle: WsUiAdapterHandle = await startWsUiAdapter({
    port: 0,
    host: '127.0.0.1',
    registryPort,
    historyPort,
    ackCommandPort,
    logger,
  });
  return { registryPort, logger, handle };
}

// Code review [race]: server gửi `registry-snapshot` (+ replay `channel-seen`
// nếu có) NGAY trong handler 'connection' (Boundaries) - nếu test attach
// listener 'message' SAU KHI await xong 'open' (2 tick riêng biệt), message
// đã tới + được `ws` (thư viện) parse/emit trước khi listener kịp gắn sẽ bị
// mất VĨNH VIỄN (EventEmitter không queue lại cho listener gắn muộn). Phải
// gắn 'message' NGAY lúc tạo socket (đồng bộ, trước khi 'open' có cơ hội
// fire) để không bỏ lỡ bất kỳ message nào server gửi ngay sau handshake.
//
// Story 3.2: `historySnapshotMessages` tách RIÊNG khỏi `messages` chính -
// adapter giờ luôn gửi 1 `channel-history-snapshot`/kênh đăng ký NGAY SAU
// registry-snapshot lúc connect (Code Map), ĐỘC LẬP số lượng kênh của từng
// test (mirror `FakeHistoryPort` mặc định trả 'no-history-data' cho mọi
// kênh không cấu hình riêng). Tách 2 luồng để KHÔNG phải sửa lại toàn bộ các
// test index-based (messages[0]/messages[1]/...) đã có từ Story 2.3-2.7 -
// các test đó không quan tâm channel-history-snapshot, chỉ các test Story 3.2
// mới (bên dưới) mới đọc `historySnapshotMessages`.
async function openClientWithMessages(
  port: number
): Promise<{ ws: WebSocket; messages: unknown[]; historySnapshotMessages: unknown[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: unknown[] = [];
  const historySnapshotMessages: unknown[] = [];
  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString()) as { type: string };
    if (parsed.type === 'channel-history-snapshot') {
      historySnapshotMessages.push(parsed);
    } else {
      messages.push(parsed);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, messages, historySnapshotMessages };
}

// Story 3.2: helper RIÊNG cho các test cần kiểm tra ĐÚNG THỨ TỰ tuyệt đối
// giữa các loại message replay lúc connect (registry-snapshot ->
// channel-history-snapshot -> channel-seen -> channel-state-change ->
// channel-snapshot) - KHÔNG tách history-snapshot ra như
// `openClientWithMessages` (helper đó cố ý tách để không phải sửa lại các
// test index-based có từ trước, nhưng vì vậy không dùng được để test thứ tự).
async function openClientAllMessages(port: number): Promise<{ ws: WebSocket; messages: unknown[] }> {
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

// Story 2.6: `publishStateChange` (AlertOutboundPort) - broadcast tới mọi
// client đang mở NGAY khi backend chốt trạng thái mới (mirror
// `publishChannelSeen` case ở trên).
test('publishStateChange -> broadcast channel-state-change tới mọi client đang mở, đúng snake_case envelope', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0); // chờ registry-snapshot trước

    handle.publishStateChange({
      channelId: 'chan-0',
      displayState: 'warning',
      timestamp: '2026-09-06T00:00:00.000Z',
    });

    await waitUntil(() => messages.length > 1);
    assert.deepEqual(messages[1], {
      type: 'channel-state-change',
      channel_id: 'chan-0',
      display_state: 'warning',
      timestamp: '2026-09-06T00:00:00.000Z',
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishStateChange kèm subType -> broadcast kèm sub_type; publishStateChange KHÔNG subType -> KHÔNG có field sub_type', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0);

    handle.publishStateChange({
      channelId: 'chan-0',
      displayState: 'critical',
      subType: 'config-or-security-suspected',
      timestamp: '2026-09-06T00:00:00.000Z',
    });
    handle.publishStateChange({
      channelId: 'chan-1',
      displayState: 'critical',
      timestamp: '2026-09-06T00:00:01.000Z',
    });

    await waitUntil(() => messages.length > 2);
    assert.equal((messages[1] as { sub_type?: string }).sub_type, 'config-or-security-suspected');
    assert.ok(!('sub_type' in (messages[2] as object)), 'KHÔNG có field sub_type khi ChannelStateChange không có subType');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishStateChange gọi 2 lần cho CÙNG channel_id với display_state KHÁC nhau -> broadcast CẢ 2 lần (KHÔNG idempotent-guard, khác publishChannelSeen)', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0);

    handle.publishStateChange({ channelId: 'chan-0', displayState: 'ok', timestamp: '2026-09-06T00:00:00.000Z' });
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'critical', timestamp: '2026-09-06T00:00:05.000Z' });

    await waitUntil(() => messages.length > 2);
    assert.equal((messages[1] as { display_state: string }).display_state, 'ok');
    assert.equal((messages[2] as { display_state: string }).display_state, 'critical');

    ws.close();
  } finally {
    await handle.close();
  }
});

// --- CAP-5 (spec-cap-5-xoa-cache-snapshot-khi-critical): publishStateChange
// xoá lastSnapshot khi displayState==='critical' ---

test('publishStateChange(critical) xoá cache snapshot của đúng channel_id -> client connect SAU ĐÓ không replay channel-snapshot cho kênh này, kể cả khi kênh phục hồi ok TRƯỚC khung mới', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    // chan-0 có cache snapshot; chan-1 vẫn còn cache (không được ảnh hưởng).
    handle.publishSnapshot('chan-0', 'khung-cu-chan-0', '2026-09-08T00:00:00.000Z');
    handle.publishSnapshot('chan-1', 'khung-chan-1', '2026-09-08T00:00:00.000Z');

    handle.publishStateChange({ channelId: 'chan-0', displayState: 'critical', timestamp: '2026-09-08T00:00:01.000Z' });
    // Phục hồi ok NGAY SAU (trước khi có khung snapshot mới từ transport-core)
    // - cache đã bị xoá ở bước critical, không được replay ảnh cũ.
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'ok', timestamp: '2026-09-08T00:00:02.000Z' });

    const { ws, messages } = await openClientWithMessages(handle.port);
    // registry-snapshot(1) + channel-state-change replay CHỈ cho chan-0 (1,
    // lastState ghi đè, chan-1 không có state) + channel-snapshot replay CHỈ
    // cho chan-1 (1, cache chan-0 đã bị xoá). Mọi message replay được gửi
    // ĐỒNG BỘ trong handler 'connection' (vòng for lặp qua các Map) - khi
    // waitUntil dưới đây thoả, không còn message nào tới muộn nữa, không cần
    // sleep thêm.
    await waitUntil(() => messages.length >= 3);

    const snapshotMessages = messages.filter(
      (m) => (m as { type: string }).type === 'channel-snapshot'
    ) as { channel_id: string; image_base64: string }[];
    assert.deepEqual(snapshotMessages.map((m) => m.channel_id), ['chan-1']);
    assert.equal(snapshotMessages[0]?.image_base64, 'khung-chan-1');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishStateChange(critical) KÈM subType="machine-offline" -> VẪN xoá cache snapshot (check duy nhất displayState, không cần điều kiện riêng cho subType, mirror channelStore.test.ts phía frontend)', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    handle.publishSnapshot('chan-0', 'khung-cu', '2026-09-08T00:00:00.000Z');

    handle.publishStateChange({
      channelId: 'chan-0',
      displayState: 'critical',
      subType: 'machine-offline',
      timestamp: '2026-09-08T00:00:01.000Z',
    });

    const { ws, messages } = await openClientWithMessages(handle.port);
    // registry-snapshot(1) + channel-state-change replay (1) - KHÔNG có
    // channel-snapshot nào được replay (cache đã bị xoá dù có subType).
    await waitUntil(() => messages.length >= 2);
    assert.ok(
      messages.every((m) => (m as { type: string }).type !== 'channel-snapshot'),
      'cache snapshot phải bị xoá dù displayState=critical kèm subType=machine-offline'
    );

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishStateChange(critical) cho channel_id KHÔNG có cache snapshot -> không throw, no-op', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    assert.doesNotThrow(() =>
      handle.publishStateChange({ channelId: 'chan-0', displayState: 'critical', timestamp: '2026-09-08T00:00:00.000Z' })
    );
  } finally {
    await handle.close();
  }
});

test('round-trip: critical (cache đã xoá) -> phục hồi ok -> publishSnapshot() MỚI tới -> cache được populate lại bình thường, replay đúng cho client connect sau đó (CAP-5 không khoá vĩnh viễn snapshot của kênh)', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    handle.publishSnapshot('chan-0', 'khung-cu', '2026-09-08T00:00:00.000Z');
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'critical', timestamp: '2026-09-08T00:00:01.000Z' });
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'ok', timestamp: '2026-09-08T00:00:02.000Z' });
    // Khung MỚI từ transport-core tới SAU KHI phục hồi - phải populate lại
    // lastSnapshot bình thường (mirror hành vi ghi đè vô điều kiện hiện có).
    handle.publishSnapshot('chan-0', 'khung-moi-sau-phuc-hoi', '2026-09-08T00:00:03.000Z');

    const { ws, messages } = await openClientWithMessages(handle.port);
    // registry-snapshot(1) + channel-state-change replay (1) + channel-snapshot
    // replay đúng khung MỚI nhất sau phục hồi (1).
    await waitUntil(() => messages.length >= 3);

    const snapshotMessages = messages.filter(
      (m) => (m as { type: string }).type === 'channel-snapshot'
    ) as { channel_id: string; image_base64: string }[];
    assert.deepEqual(snapshotMessages.map((m) => m.channel_id), ['chan-0']);
    assert.equal(snapshotMessages[0]?.image_base64, 'khung-moi-sau-phuc-hoi');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('frontend connect MUỘN (sau khi backend đã chốt trạng thái vài kênh) -> replay channel-state-change mới nhất/kênh, NGAY SAU registry-snapshot + channel-seen replay', async () => {
  const { handle } = await startTestServer(makeEntries(5));
  try {
    // Backend đã seen + chốt trạng thái cho chan-0/chan-2 TRƯỚC KHI có client
    // nào connect - chan-0 đổi trạng thái 2 lần, chỉ giá trị MỚI NHẤT được
    // replay (ghi đè, mirror Design Notes).
    handle.publishChannelSeen('chan-0', '2026-09-06T00:00:00.000Z');
    handle.publishChannelSeen('chan-2', '2026-09-06T00:00:00.000Z');
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'ok', timestamp: '2026-09-06T00:00:01.000Z' });
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'warning', timestamp: '2026-09-06T00:00:06.000Z' });
    handle.publishStateChange({ channelId: 'chan-2', displayState: 'critical', timestamp: '2026-09-06T00:00:02.000Z' });

    const { ws, messages } = await openClientWithMessages(handle.port);

    // registry-snapshot(1) + channel-seen(2) + channel-state-change(2).
    await waitUntil(() => messages.length >= 5);
    assert.equal((messages[0] as { type: string }).type, 'registry-snapshot');
    const seenReplayed = messages.slice(1, 3) as { type: string }[];
    assert.ok(seenReplayed.every((m) => m.type === 'channel-seen'), 'channel-seen replay PHẢI đứng ngay sau registry-snapshot');
    const stateReplayed = messages.slice(3) as { type: string; channel_id: string; display_state: string }[];
    assert.ok(stateReplayed.every((m) => m.type === 'channel-state-change'));
    assert.deepEqual(
      stateReplayed.map((m) => m.channel_id).sort(),
      ['chan-0', 'chan-2']
    );
    assert.equal(
      stateReplayed.find((m) => m.channel_id === 'chan-0')?.display_state,
      'warning',
      'chan-0 phải replay giá trị MỚI NHẤT (warning), không phải giá trị đầu tiên (ok)'
    );
    assert.equal(stateReplayed.find((m) => m.channel_id === 'chan-2')?.display_state, 'critical');

    ws.close();
  } finally {
    await handle.close();
  }
});

// Code review [patch #11]: mirror case "WS UI client mất kết nối" (dòng
// ~218) cho `publishStateChange` - `send()` (dùng chung cho cả 3 loại
// message) chỉ gửi khi `ws.readyState === OPEN` (Boundaries), nhưng trước đây
// chưa có case nào exercise guard này qua đúng message `channel-state-change`
// mới của Story 2.6 - 1 client đã đóng vẫn còn trong `wss.clients` trong 1
// khoảng ngắn TRƯỚC KHI 'close' event của server kịp fire/dọn.
// --- Bổ sung video-preview thật (AD-22): publishSnapshot (SnapshotOutboundPort) ---

test('publishSnapshot -> broadcast channel-snapshot tới mọi client đang mở, đúng snake_case envelope', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0); // chờ registry-snapshot trước

    handle.publishSnapshot('chan-0', 'ZmFrZS1qcGVn', '2026-09-07T00:00:00.000Z');

    await waitUntil(() => messages.length > 1);
    assert.deepEqual(messages[1], {
      type: 'channel-snapshot',
      channel_id: 'chan-0',
      image_base64: 'ZmFrZS1qcGVn',
      timestamp: '2026-09-07T00:00:00.000Z',
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishSnapshot broadcast tới TẤT CẢ client đang mở kết nối cùng lúc', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws: wsA, messages: messagesA } = await openClientWithMessages(handle.port);
    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesA.length > 0 && messagesB.length > 0);

    handle.publishSnapshot('chan-1', 'ZmFrZQ==', '2026-09-07T00:00:00.000Z');

    await waitUntil(() => messagesA.length > 1 && messagesB.length > 1);
    assert.equal((messagesA[1] as { channel_id: string }).channel_id, 'chan-1');
    assert.equal((messagesB[1] as { channel_id: string }).channel_id, 'chan-1');

    wsA.close();
    wsB.close();
  } finally {
    await handle.close();
  }
});

test('publishSnapshot gọi 2 lần cho CÙNG channel_id -> broadcast CẢ 2 lần (KHÔNG idempotent-guard, mirror publishStateChange)', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0);

    handle.publishSnapshot('chan-0', 'khung-1', '2026-09-07T00:00:00.000Z');
    handle.publishSnapshot('chan-0', 'khung-2', '2026-09-07T00:00:01.500Z');

    await waitUntil(() => messages.length > 2);
    assert.equal((messages[1] as { image_base64: string }).image_base64, 'khung-1');
    assert.equal((messages[2] as { image_base64: string }).image_base64, 'khung-2');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('frontend connect MUỘN (sau khi backend đã publish snapshot vài kênh) -> replay khung MỚI NHẤT/kênh, NGAY SAU channel-state-change replay (bước 4)', async () => {
  const { handle } = await startTestServer(makeEntries(5));
  try {
    // Backend đã seen + chốt trạng thái + có snapshot cho chan-0/chan-2
    // TRƯỚC KHI có client nào connect - chan-0 có 2 khung, chỉ khung MỚI
    // NHẤT được replay (ghi đè, mirror channel-state-change replay).
    handle.publishChannelSeen('chan-0', '2026-09-07T00:00:00.000Z');
    handle.publishChannelSeen('chan-2', '2026-09-07T00:00:00.000Z');
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'ok', timestamp: '2026-09-07T00:00:01.000Z' });
    handle.publishStateChange({ channelId: 'chan-2', displayState: 'ok', timestamp: '2026-09-07T00:00:01.000Z' });
    handle.publishSnapshot('chan-0', 'khung-cu', '2026-09-07T00:00:02.000Z');
    handle.publishSnapshot('chan-0', 'khung-moi-nhat', '2026-09-07T00:00:03.500Z');
    handle.publishSnapshot('chan-2', 'khung-chan-2', '2026-09-07T00:00:02.000Z');

    const { ws, messages } = await openClientWithMessages(handle.port);

    // registry-snapshot(1) + channel-seen(2) + channel-state-change(2) + channel-snapshot(2).
    await waitUntil(() => messages.length >= 7);
    assert.equal((messages[0] as { type: string }).type, 'registry-snapshot');
    const snapshotReplayed = messages.slice(5) as { type: string; channel_id: string; image_base64: string }[];
    assert.ok(
      snapshotReplayed.every((m) => m.type === 'channel-snapshot'),
      'channel-snapshot replay PHẢI đứng SAU cùng, sau channel-state-change replay'
    );
    assert.deepEqual(
      snapshotReplayed.map((m) => m.channel_id).sort(),
      ['chan-0', 'chan-2']
    );
    assert.equal(
      snapshotReplayed.find((m) => m.channel_id === 'chan-0')?.image_base64,
      'khung-moi-nhat',
      'chan-0 phải replay khung MỚI NHẤT, không phải khung đầu tiên'
    );

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishSnapshot sau khi 1 client đã đóng kết nối -> KHÔNG throw, client khác vẫn nhận đúng broadcast', async () => {
  const { logger, handle } = await startTestServer(makeEntries(2));
  try {
    const wsA = await openClient(handle.port);
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_connect'));

    wsA.close();
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_disconnect'));

    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesB.length > 0); // chờ registry-snapshot trước

    assert.doesNotThrow(() => handle.publishSnapshot('chan-0', 'ZmFrZQ==', '2026-09-07T00:00:00.000Z'));

    await waitUntil(() => messagesB.length > 1);
    assert.deepEqual(messagesB[1], {
      type: 'channel-snapshot',
      channel_id: 'chan-0',
      image_base64: 'ZmFrZQ==',
      timestamp: '2026-09-07T00:00:00.000Z',
    });

    wsB.close();
  } finally {
    await handle.close();
  }
});

test('publishStateChange sau khi 1 client đã đóng kết nối -> KHÔNG throw, client khác vẫn nhận đúng broadcast', async () => {
  const { logger, handle } = await startTestServer(makeEntries(2));
  try {
    const wsA = await openClient(handle.port);
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_connect'));

    wsA.close();
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_disconnect'));

    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesB.length > 0); // chờ registry-snapshot trước

    assert.doesNotThrow(() =>
      handle.publishStateChange({ channelId: 'chan-0', displayState: 'critical', timestamp: '2026-09-06T00:00:00.000Z' })
    );

    await waitUntil(() => messagesB.length > 1);
    assert.deepEqual(messagesB[1], {
      type: 'channel-state-change',
      channel_id: 'chan-0',
      display_state: 'critical',
      timestamp: '2026-09-06T00:00:00.000Z',
    });

    wsB.close();
  } finally {
    await handle.close();
  }
});

// --- Story 3.2: channel-history-snapshot lúc connect + channel-history-point
// broadcast (UiOutboundPort.publishHistoryPoint) ---

test('client connect -> nhận đúng 1 channel-history-snapshot/kênh, NGAY SAU registry-snapshot, đúng snake_case envelope', async () => {
  const historyPort = new FakeHistoryPort({
    'chan-0': { state: 'loaded', data: [{ timestampMs: 1000, bitratePct: 55.5 }] },
  });
  const { handle } = await startTestServer(makeEntries(2), historyPort);
  try {
    const { ws, historySnapshotMessages } = await openClientWithMessages(handle.port);

    await waitUntil(() => historySnapshotMessages.length >= 2);
    const byChannel = new Map((historySnapshotMessages as { channel_id: string }[]).map((m) => [m.channel_id, m]));
    assert.deepEqual(byChannel.get('chan-0'), {
      type: 'channel-history-snapshot',
      channel_id: 'chan-0',
      state: 'loaded',
      points: [{ timestamp_ms: 1000, bitrate_pct: 55.5 }],
    });
    assert.deepEqual(byChannel.get('chan-1'), {
      type: 'channel-history-snapshot',
      channel_id: 'chan-1',
      state: 'no-history-data',
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('thứ tự replay lúc connect: registry-snapshot -> channel-history-snapshot/kênh -> channel-seen -> channel-state-change -> channel-snapshot', async () => {
  const historyPort = new FakeHistoryPort({ 'chan-0': { state: 'loaded', data: [{ timestampMs: 500, bitratePct: 80 }] } });
  const { handle } = await startTestServer(makeEntries(2), historyPort);
  try {
    handle.publishChannelSeen('chan-0', '2026-09-09T00:00:00.000Z');
    handle.publishStateChange({ channelId: 'chan-0', displayState: 'ok', timestamp: '2026-09-09T00:00:01.000Z' });
    handle.publishSnapshot('chan-0', 'ZmFrZQ==', '2026-09-09T00:00:02.000Z');

    const { ws, messages } = await openClientAllMessages(handle.port);
    // registry-snapshot(1) + channel-history-snapshot(2, 1/kênh) +
    // channel-seen(1) + channel-state-change(1) + channel-snapshot(1) = 6.
    await waitUntil(() => messages.length >= 6);

    const types = (messages as { type: string }[]).map((m) => m.type);
    assert.deepEqual(types, [
      'registry-snapshot',
      'channel-history-snapshot',
      'channel-history-snapshot',
      'channel-seen',
      'channel-state-change',
      'channel-snapshot',
    ]);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('historyPort.getHistory() throw lúc connect -> gửi channel-history-snapshot state=no-history-data cho kênh đó, log cảnh báo, KHÔNG throw/crash, các kênh khác không bị ảnh hưởng', async () => {
  const historyPort = new FakeHistoryPort({
    'chan-0': () => {
      throw new Error('lỗi giả lập getHistory');
    },
    'chan-1': { state: 'loaded', data: [{ timestampMs: 1, bitratePct: 10 }] },
  });
  const { logger, handle } = await startTestServer(makeEntries(2), historyPort);
  try {
    const { ws, historySnapshotMessages } = await openClientWithMessages(handle.port);

    await waitUntil(() => historySnapshotMessages.length >= 2);
    const byChannel = new Map((historySnapshotMessages as { channel_id: string; state: string }[]).map((m) => [m.channel_id, m]));
    assert.equal(byChannel.get('chan-0')?.state, 'no-history-data');
    assert.equal(byChannel.get('chan-1')?.state, 'loaded');
    assert.ok(
      logger.events.some((e) => e.event_type === 'history_snapshot_query_error' && e.channel_id === 'chan-0'),
      'phải log cảnh báo rõ ràng khi historyPort.getHistory() throw'
    );

    ws.close();
  } finally {
    await handle.close();
  }
});

test("historyPort.getHistory() trả 'loading' lúc connect (nhánh không mong đợi) -> gửi no-history-data thay thế, log cảnh báo", async () => {
  const historyPort = new FakeHistoryPort({ 'chan-0': { state: 'loading' } });
  const { logger, handle } = await startTestServer(makeEntries(1), historyPort);
  try {
    const { ws, historySnapshotMessages } = await openClientWithMessages(handle.port);

    await waitUntil(() => historySnapshotMessages.length >= 1);
    assert.deepEqual(historySnapshotMessages[0], {
      type: 'channel-history-snapshot',
      channel_id: 'chan-0',
      state: 'no-history-data',
    });
    assert.ok(logger.events.some((e) => e.event_type === 'history_snapshot_query_error' && e.channel_id === 'chan-0'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishHistoryPoint -> broadcast channel-history-point tới mọi client đang mở, đúng snake_case envelope, KHÔNG idempotent-guard', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    const { ws: wsA, messages: messagesA } = await openClientWithMessages(handle.port);
    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesA.length > 0 && messagesB.length > 0); // chờ registry-snapshot trước

    handle.publishHistoryPoint('chan-0', 62.3, 1234567);
    handle.publishHistoryPoint('chan-0', 63.1, 1234568); // gọi 2 lần liên tiếp - CẢ 2 đều phải broadcast

    await waitUntil(() => messagesA.length > 2 && messagesB.length > 2);
    assert.deepEqual(messagesA[1], { type: 'channel-history-point', channel_id: 'chan-0', bitrate_pct: 62.3, timestamp_ms: 1234567 });
    assert.deepEqual(messagesA[2], { type: 'channel-history-point', channel_id: 'chan-0', bitrate_pct: 63.1, timestamp_ms: 1234568 });
    assert.deepEqual(messagesB[1], messagesA[1]);
    assert.deepEqual(messagesB[2], messagesA[2]);

    wsA.close();
    wsB.close();
  } finally {
    await handle.close();
  }
});

test('publishHistoryPoint sau khi 1 client đã đóng kết nối -> KHÔNG throw, client khác vẫn nhận đúng broadcast', async () => {
  const { logger, handle } = await startTestServer(makeEntries(1));
  try {
    const wsA = await openClient(handle.port);
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_connect'));

    wsA.close();
    await waitUntil(() => logger.events.some((e) => e.event_type === 'ui_ws_disconnect'));

    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesB.length > 0);

    assert.doesNotThrow(() => handle.publishHistoryPoint('chan-0', 40, 999));

    await waitUntil(() => messagesB.length > 1);
    assert.deepEqual(messagesB[1], { type: 'channel-history-point', channel_id: 'chan-0', bitrate_pct: 40, timestamp_ms: 999 });

    wsB.close();
  } finally {
    await handle.close();
  }
});

// --- Story 3.3: ack-command (inbound, client->backend) + publishAckChange
// (outbound) + replay-on-connect ---

test('publishAckChange(true, label) -> broadcast channel-ack-change tới mọi client đang mở, đúng snake_case envelope', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0); // chờ registry-snapshot trước

    handle.publishAckChange('chan-0', true, 'NV.A');

    await waitUntil(() => messages.length > 1);
    assert.deepEqual(messages[1], {
      type: 'channel-ack-change',
      channel_id: 'chan-0',
      acknowledged: true,
      ack_label: 'NV.A',
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishAckChange(false, undefined) -> broadcast channel-ack-change KHÔNG có field ack_label', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0);

    handle.publishAckChange('chan-0', false, undefined);

    await waitUntil(() => messages.length > 1);
    assert.deepEqual(messages[1], { type: 'channel-ack-change', channel_id: 'chan-0', acknowledged: false });
    assert.ok(!('ack_label' in (messages[1] as object)), 'KHÔNG được gửi ack_label khi acknowledged=false');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishAckChange broadcast tới TẤT CẢ client đang mở kết nối cùng lúc', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    const { ws: wsA, messages: messagesA } = await openClientWithMessages(handle.port);
    const { ws: wsB, messages: messagesB } = await openClientWithMessages(handle.port);
    await waitUntil(() => messagesA.length > 0 && messagesB.length > 0);

    handle.publishAckChange('chan-1', true, 'NV.B');

    await waitUntil(() => messagesA.length > 1 && messagesB.length > 1);
    assert.equal((messagesA[1] as { channel_id: string }).channel_id, 'chan-1');
    assert.equal((messagesB[1] as { channel_id: string }).channel_id, 'chan-1');

    wsA.close();
    wsB.close();
  } finally {
    await handle.close();
  }
});

test('client gửi ack-command hợp lệ -> forward vào ackCommandPort với ĐÚNG channelId, operatorLabel ĐÃ trim()', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-0',
        timestamp: '2026-09-12T00:00:00.000Z',
        event_type: 'ack-command',
        payload: { operator_label: '  NV.A  ' },
      })
    );

    await waitUntil(() => ackCommandPort.calls.length > 0);
    assert.equal(ackCommandPort.calls[0]?.channelId, 'chan-0');
    assert.equal(ackCommandPort.calls[0]?.operatorLabel, 'NV.A', 'operatorLabel phải ĐÃ trim() trước khi forward');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ackCommandPort.handleAckCommand -> publishAckChange -> client (kể cả CHÍNH client vừa gửi ack-command) nhận channel-ack-change', async () => {
  // FakeAckCommandPort ở test này gọi thẳng handle.publishAckChange (mirror
  // hành vi thật của ChannelStateService.handleAckCommand) để xác nhận round-
  // trip end-to-end qua đúng 1 kết nối WS thật.
  let handleRef: WsUiAdapterHandle | undefined;
  const ackCommandPort: AckCommandPort = {
    handleAckCommand(channelId: string, operatorLabel: string): void {
      handleRef?.publishAckChange(channelId, true, operatorLabel);
    },
  };
  const { handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  handleRef = handle;
  try {
    const { ws, messages } = await openClientWithMessages(handle.port);
    await waitUntil(() => messages.length > 0); // registry-snapshot

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-0',
        timestamp: '2026-09-12T00:00:00.000Z',
        event_type: 'ack-command',
        payload: { operator_label: 'NV.A' },
      })
    );

    await waitUntil(() => messages.length > 1);
    assert.deepEqual(messages[1], {
      type: 'channel-ack-change',
      channel_id: 'chan-0',
      acknowledged: true,
      ack_label: 'NV.A',
    });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ack-command envelope hỏng (JSON lỗi) -> bỏ qua, log envelope_parse_error, KHÔNG throw/crash, KHÔNG forward vào ackCommandPort', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send('{not-valid-json');

    await waitUntil(() => logger.events.some((e) => e.event_type === 'envelope_parse_error'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ackCommandPort.calls.length, 0);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ack-command envelope event_type khác -> bỏ qua âm thầm, log event_type_ignored, KHÔNG forward', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send(
      JSON.stringify({ schema_version: 1, channel_id: 'chan-0', timestamp: '2026-09-12T00:00:00.000Z', event_type: 'telemetry', payload: {} })
    );

    await waitUntil(() => logger.events.some((e) => e.event_type === 'event_type_ignored'));
    assert.equal(ackCommandPort.calls.length, 0);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ack-command envelope thiếu channel_id -> bỏ qua, log envelope_invalid, KHÔNG forward', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send(
      JSON.stringify({ schema_version: 1, timestamp: '2026-09-12T00:00:00.000Z', event_type: 'ack-command', payload: { operator_label: 'NV.A' } })
    );

    await waitUntil(() => logger.events.some((e) => e.event_type === 'envelope_invalid'));
    assert.equal(ackCommandPort.calls.length, 0);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ack-command envelope thiếu payload.operator_label -> bỏ qua, log envelope_invalid, KHÔNG forward', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send(JSON.stringify({ schema_version: 1, channel_id: 'chan-0', timestamp: '2026-09-12T00:00:00.000Z', event_type: 'ack-command', payload: {} }));

    await waitUntil(() => logger.events.some((e) => e.event_type === 'envelope_invalid'));
    assert.equal(ackCommandPort.calls.length, 0);

    ws.close();
  } finally {
    await handle.close();
  }
});

// Code review [patch, round 2]: `operatorLabel` rỗng/toàn khoảng trắng sau
// trim() phải bị reject ở ĐÚNG lớp validate này (mirror nhánh >64 ký tự) - dù
// `DetailPanel.tsx` đã disable nút gửi cho trường hợp này, 1 client WS UI KHÁC
// (không phải dashboard-frontend) có thể gửi thẳng qua kênh WS.
test('ack-command envelope với payload.operator_label TOÀN khoảng trắng (rỗng sau trim) -> bỏ qua, log envelope_invalid, KHÔNG forward', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-0',
        timestamp: '2026-09-12T00:00:00.000Z',
        event_type: 'ack-command',
        payload: { operator_label: '   ' },
      })
    );

    await waitUntil(() => logger.events.some((e) => e.event_type === 'envelope_invalid'));
    assert.equal(ackCommandPort.calls.length, 0);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ack-command envelope với payload.operator_label vượt quá 64 ký tự -> bỏ qua, log envelope_invalid, KHÔNG forward', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);
    const tooLong = 'A'.repeat(65);

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-0',
        timestamp: '2026-09-12T00:00:00.000Z',
        event_type: 'ack-command',
        payload: { operator_label: tooLong },
      })
    );

    await waitUntil(() => logger.events.some((e) => e.event_type === 'envelope_invalid'));
    assert.equal(ackCommandPort.calls.length, 0);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ack-command envelope với payload.operator_label ĐÚNG 64 ký tự (biên) -> forward bình thường (KHÔNG bị reject)', async () => {
  const ackCommandPort = new FakeAckCommandPort();
  const { handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);
    const exactly64 = 'A'.repeat(64);

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-0',
        timestamp: '2026-09-12T00:00:00.000Z',
        event_type: 'ack-command',
        payload: { operator_label: exactly64 },
      })
    );

    await waitUntil(() => ackCommandPort.calls.length > 0);
    assert.equal(ackCommandPort.calls[0]?.operatorLabel.length, 64);

    ws.close();
  } finally {
    await handle.close();
  }
});

test('ackCommandPort.handleAckCommand throw (bug giả lập ở core) -> log ack_command_handler_error, KHÔNG throw/crash', async () => {
  const ackCommandPort: AckCommandPort = {
    handleAckCommand(): void {
      throw new Error('lỗi giả lập từ ackCommandPort');
    },
  };
  const { logger, handle } = await startTestServer(makeEntries(1), new FakeHistoryPort(), ackCommandPort);
  try {
    const ws = await openClient(handle.port);

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-0',
        timestamp: '2026-09-12T00:00:00.000Z',
        event_type: 'ack-command',
        payload: { operator_label: 'NV.A' },
      })
    );

    await waitUntil(() => logger.events.some((e) => e.event_type === 'ack_command_handler_error'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('client connect MUỘN (sau khi backend đã publishAckChange(true, label) cho 1 kênh) -> replay channel-ack-change NGAY SAU channel-snapshot replay (bước cuối)', async () => {
  const { handle } = await startTestServer(makeEntries(2));
  try {
    handle.publishAckChange('chan-0', true, 'NV.A');

    const { ws, messages } = await openClientAllMessages(handle.port);
    // registry-snapshot(1) + channel-history-snapshot(2, 1/kênh) + channel-ack-change(1).
    await waitUntil(() => messages.length >= 4);

    const types = (messages as { type: string }[]).map((m) => m.type);
    assert.deepEqual(types, ['registry-snapshot', 'channel-history-snapshot', 'channel-history-snapshot', 'channel-ack-change']);
    assert.deepEqual(messages[3], { type: 'channel-ack-change', channel_id: 'chan-0', acknowledged: true, ack_label: 'NV.A' });

    ws.close();
  } finally {
    await handle.close();
  }
});

test('client connect MUỘN, kênh chưa từng ack -> KHÔNG replay channel-ack-change nào', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    const { ws, messages } = await openClientAllMessages(handle.port);
    await waitUntil(() => messages.length >= 2); // registry-snapshot + channel-history-snapshot

    await new Promise((resolve) => setTimeout(resolve, 50)); // đảm bảo không có message trễ
    assert.ok(
      messages.every((m) => (m as { type: string }).type !== 'channel-ack-change'),
      'không có ack nào từng xảy ra -> không replay gì'
    );

    ws.close();
  } finally {
    await handle.close();
  }
});

test('client connect MUỘN, kênh đã ack RỒI TỰ XOÁ (acknowledged=false) -> KHÔNG replay channel-ack-change (I/O matrix: entry false không có gì để replay)', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    handle.publishAckChange('chan-0', true, 'NV.A');
    handle.publishAckChange('chan-0', false, undefined);

    const { ws, messages } = await openClientAllMessages(handle.port);
    await waitUntil(() => messages.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(
      messages.every((m) => (m as { type: string }).type !== 'channel-ack-change'),
      'entry acknowledged=false không được replay'
    );

    ws.close();
  } finally {
    await handle.close();
  }
});

test('publishAckChange gọi lại (đổi label khác, vẫn acknowledged=true) -> replay đúng label MỚI NHẤT cho client connect sau đó', async () => {
  const { handle } = await startTestServer(makeEntries(1));
  try {
    handle.publishAckChange('chan-0', true, 'NV.A');
    handle.publishAckChange('chan-0', true, 'NV.B'); // ghi đè, mirror lastState/lastSnapshot

    const { ws, messages } = await openClientAllMessages(handle.port);
    // registry-snapshot(1) + channel-history-snapshot(1, makeEntries(1)) +
    // channel-ack-change(1, ghi đè - chỉ giá trị MỚI NHẤT được replay) = 3.
    await waitUntil(() => messages.length >= 3);

    const ackMessages = messages.filter((m) => (m as { type: string }).type === 'channel-ack-change');
    assert.equal(ackMessages.length, 1);
    assert.equal((ackMessages[0] as { ack_label: string }).ack_label, 'NV.B');

    ws.close();
  } finally {
    await handle.close();
  }
});
