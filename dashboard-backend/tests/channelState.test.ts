import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelStateService, HEARTBEAT_TIMEOUT_MS, type Clock } from '../src/core/channelState.js';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../src/ports/ChannelRegistryPort.js';
import type { AlertOutboundPort, ChannelStateChange } from '../src/ports/AlertOutboundPort.js';
import type { UiOutboundPort } from '../src/ports/UiOutboundPort.js';
import type { HistoryPort } from '../src/ports/HistoryPort.js';
import type { TelemetryEvent } from '../src/ports/TelemetryInboundPort.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';

// --- Fakes (Boundaries: "test bằng fake TelemetryInboundPort/
// AlertOutboundPort/ChannelRegistryPort, không cần máy thật") ---

class FakeClock implements Clock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

// Story 2.2: `FakeBaselinePort` (chỉ baseline_kbps) -> `FakeRegistryPort`
// (record đầy đủ, khớp `ChannelRegistryPort` mới) - test ở file này chỉ quan
// tâm `baselineKbps`, các field metadata khác điền giá trị placeholder cố
// định vì không ảnh hưởng logic debounce/threshold đang test.
class FakeRegistryPort implements ChannelRegistryPort {
  constructor(private readonly baselines: Record<string, number>) {}
  getEntry(channelId: string): ChannelRegistryEntry | undefined {
    const baselineKbps = this.baselines[channelId];
    if (baselineKbps === undefined) return undefined;
    return {
      stationName: `Station ${channelId}`,
      contactName: 'Fake Contact',
      contactPhone: '0000000000',
      gridPosition: 0,
      baselineKbps,
    };
  }
  // Story 2.3: `listEntries()` không dùng tới ở test file này (channelState
  // không gọi method này) - implement tối thiểu để thoả interface.
  listEntries(): ReadonlyArray<ChannelRegistryEntry & { channelId: string }> {
    return Object.keys(this.baselines)
      .map((channelId) => {
        const entry = this.getEntry(channelId);
        return entry ? { channelId, ...entry } : undefined;
      })
      .filter((e): e is ChannelRegistryEntry & { channelId: string } => e !== undefined);
  }
}

class FakeAlertPort implements AlertOutboundPort {
  changes: ChannelStateChange[] = [];
  publishStateChange(change: ChannelStateChange): void {
    this.changes.push(change);
  }
}

// Story 2.3: fake `UiOutboundPort` (Boundaries "src/core hoàn toàn thuần" -
// test được bằng fake, không cần WsUiAdapter/WS thật).
// Story 3.2: mở rộng thêm `publishHistoryPoint` (mirror `seenCalls`).
// Story 3.3: mở rộng thêm `publishAckChange` (mirror `historyPointCalls`).
class FakeUiPort implements UiOutboundPort {
  seenCalls: { channelId: string; timestamp: string }[] = [];
  historyPointCalls: { channelId: string; bitratePct: number; timestampMs: number }[] = [];
  ackChangeCalls: { channelId: string; acknowledged: boolean; ackLabel: string | undefined }[] = [];
  publishChannelSeen(channelId: string, timestamp: string): void {
    this.seenCalls.push({ channelId, timestamp });
  }
  publishHistoryPoint(channelId: string, bitratePct: number, timestampMs: number): void {
    this.historyPointCalls.push({ channelId, bitratePct, timestampMs });
  }
  publishAckChange(channelId: string, acknowledged: boolean, ackLabel: string | undefined): void {
    this.ackChangeCalls.push({ channelId, acknowledged, ackLabel });
  }
}

// Code review [patch #3]: xác nhận `uiPort.publishChannelSeen` throw KHÔNG
// làm lỡ phần debounce/state phía sau của chính telemetry event đó.
class ThrowingUiPort implements UiOutboundPort {
  publishChannelSeen(): void {
    throw new Error('lỗi giả lập từ uiPort');
  }
  publishHistoryPoint(): void {
    throw new Error('lỗi giả lập từ uiPort');
  }
  publishAckChange(): void {
    throw new Error('lỗi giả lập từ uiPort');
  }
}

// Code review round 2 [patch #1]: `publishChannelSeen` KHÔNG throw (không liên
// quan nhánh đang test) - CHỈ `publishHistoryPoint` throw, để phân biệt với
// `ThrowingUiPort` ở trên (throw cả 2 method). Dùng để xác nhận log lỗi phải
// nêu đúng "publishHistoryPoint throw" khi chính `recordBitrate` đã ghi thành
// công trước đó.
class ThrowingPublishHistoryPointUiPort implements UiOutboundPort {
  seenCalls: { channelId: string; timestamp: string }[] = [];
  publishChannelSeen(channelId: string, timestamp: string): void {
    this.seenCalls.push({ channelId, timestamp });
  }
  publishHistoryPoint(): void {
    throw new Error('lỗi giả lập từ uiPort.publishHistoryPoint');
  }
  publishAckChange(): void {
    // Không dùng ở test file này (không liên quan nhánh publishHistoryPoint).
  }
}

// Story 3.1: fake `HistoryPort` (Boundaries "src/core hoàn toàn thuần" - test
// được bằng fake, không cần `BitrateHistoryService`/ring buffer thật).
class FakeHistoryPort implements HistoryPort {
  recordCalls: { channelId: string; bitratePct: number; timestampMs: number }[] = [];
  recordBitrate(channelId: string, bitratePct: number, timestampMs: number): void {
    this.recordCalls.push({ channelId, bitratePct, timestampMs });
  }
  getHistory(): ReturnType<HistoryPort['getHistory']> {
    return { state: 'no-history-data' };
  }
}

// Story 3.1: xác nhận `historyPort.recordBitrate` throw KHÔNG làm lỡ phần
// debounce/state phía sau của chính telemetry event đó (mirror `ThrowingUiPort`).
class ThrowingHistoryPort implements HistoryPort {
  recordBitrate(): void {
    throw new Error('lỗi giả lập từ historyPort');
  }
  getHistory(): ReturnType<HistoryPort['getHistory']> {
    return { state: 'no-history-data' };
  }
}

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

function makeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    channelId: 'chan-1',
    timestamp: '2026-09-03T00:00:00.000Z',
    bitrateKbps: 4000,
    rttMs: 20,
    connectionState: 'CONNECTED',
    audioLevel: [-20, -20],
    ...overrides,
  };
}

function makeService(baselines: Record<string, number>) {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort(baselines);
  const alert = new FakeAlertPort();
  const ui = new FakeUiPort();
  const historyPort = new FakeHistoryPort();
  const logger = new FakeLogger();
  const service = new ChannelStateService({
    registryPort: registry,
    alertPort: alert,
    uiPort: ui,
    historyPort,
    logger,
    clock,
  });
  return { clock, alert, ui, historyPort, logger, service };
}

test('CONNECTED + bitrate_pct>=70% ổn định đúng 5s -> chốt ok, publish 1 lần', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent()); // t=0, bắt đầu pending
  assert.equal(service.getDisplayState('chan-1'), undefined);

  clock.advance(2000);
  service.handleTelemetry(makeEvent()); // t=2000, <5s -> chưa chốt
  assert.equal(service.getDisplayState('chan-1'), undefined);

  clock.advance(3000); // t=5000, đúng ngưỡng debounce
  service.handleTelemetry(makeEvent());
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
  assert.equal(alert.changes.length, 1);
  assert.equal(alert.changes[0]?.displayState, 'ok');
  assert.equal(alert.changes[0]?.subType, undefined);

  // Telemetry tiếp theo vẫn "ok" -> không publish lặp lại.
  clock.advance(1000);
  service.handleTelemetry(makeEvent());
  assert.equal(alert.changes.length, 1);
});

test('CONNECTED + bitrate_pct<70% ổn định >=5s -> chốt warning', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 })); // 50%
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));

  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' });
  assert.equal(alert.changes.length, 1);
  assert.equal(alert.changes[0]?.displayState, 'warning');
});

test('trạng thái dao động quanh ngưỡng 70% trong <5s -> giữ nguyên giá trị đã chốt', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 1000 });

  // Chốt "ok" trước (100%).
  service.handleTelemetry(makeEvent({ bitrateKbps: 1000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 1000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
  const changesAfterCommit = alert.changes.length;

  // Dao động qua lại ngưỡng 70%, mỗi lần đổi <5s.
  clock.advance(1000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 500 })); // 50% -> warning candidate mới, reset pending
  clock.advance(1000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 1000 })); // 100% -> ok candidate mới, reset pending
  clock.advance(1000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 500 })); // warning lần nữa, vẫn <5s kể từ lần đổi trước

  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' }, 'phải giữ nguyên giá trị cũ (chưa đủ debounce)');
  assert.equal(alert.changes.length, changesAfterCommit, 'không được publish thêm khi chưa đủ 5s ổn định');
});

// Story 4.4: `previousDisplayState` = `previous?.state` (candidate ĐÃ CHỐT
// trước lần commit này) trên `ChannelStateChange` phát qua `applyCandidate`.
test('applyCandidate: lần chốt ĐẦU TIÊN/kênh -> previousDisplayState undefined (chưa từng có previous)', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));

  assert.equal(alert.changes.length, 1);
  assert.equal(alert.changes[0]?.displayState, 'ok');
  assert.equal(alert.changes[0]?.previousDisplayState, undefined, 'chưa từng có committed trước đó');
});

test('applyCandidate: chốt sang state MỚI (đã có previous) -> previousDisplayState đúng giá trị committed cũ', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  // Chốt "ok" trước.
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  assert.equal(alert.changes.at(-1)?.previousDisplayState, undefined);

  // Chuyển sang "warning".
  clock.advance(1000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));

  assert.equal(alert.changes.at(-1)?.displayState, 'warning');
  assert.equal(alert.changes.at(-1)?.previousDisplayState, 'ok', 'previousDisplayState phải là committed cũ (ok)');
});

test('applyCandidate: telemetry tự phục hồi về "ok" (đã từng critical) -> previousDisplayState="critical" trên change publish', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ connectionState: 'RECONNECTING', bitrateKbps: 0 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ connectionState: 'RECONNECTING', bitrateKbps: 0 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'critical' });

  clock.advance(1000);
  service.handleTelemetry(makeEvent({ connectionState: 'CONNECTED', bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ connectionState: 'CONNECTED', bitrateKbps: 4000 }));

  const lastChange = alert.changes.at(-1);
  assert.equal(lastChange?.displayState, 'ok');
  assert.equal(lastChange?.previousDisplayState, 'critical');
});

test('RECONNECTING ổn định >=5s -> chốt critical (không sub-type)', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ connectionState: 'RECONNECTING', bitrateKbps: 0 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ connectionState: 'RECONNECTING', bitrateKbps: 0 }));

  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'critical' });
  assert.equal(alert.changes[0]?.subType, undefined);
});

test('REJECTED ổn định >=5s -> chốt critical kèm sub-type config-or-security-suspected', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ connectionState: 'REJECTED', bitrateKbps: 0 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ connectionState: 'REJECTED', bitrateKbps: 0 }));

  assert.deepEqual(service.getDisplayState('chan-1'), {
    state: 'critical',
    subType: 'config-or-security-suspected',
  });
  assert.equal(alert.changes[0]?.subType, 'config-or-security-suspected');
});

test('channel_id lạ không có trong registry -> log channel_unregistered, không đổi state, không throw, không publish', () => {
  const { alert, ui, logger, service } = makeService({}); // registry rỗng

  assert.doesNotThrow(() => service.handleTelemetry(makeEvent({ channelId: 'unknown-chan' })));
  assert.equal(service.getDisplayState('unknown-chan'), undefined);
  assert.equal(alert.changes.length, 0);
  assert.equal(ui.seenCalls.length, 0, 'I/O matrix: channel_id lạ -> KHÔNG publish channel-seen');
  assert.ok(
    logger.events.some((e) => e.event_type === 'channel_unregistered' && e.channel_id === 'unknown-chan'),
    'phải log 1 event_type=channel_unregistered rõ ràng'
  );
});

// --- Story 2.3: `uiPort.publishChannelSeen` first-seen (I/O matrix "Kênh đầu
// tiên gửi telemetry -> Backend publish channel-seen ngay, không chờ 5s") ---

test('telemetry đầu tiên của 1 channel_id đã đăng ký -> publishChannelSeen NGAY, trước khi đủ 5s debounce', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent()); // t=0, telemetry đầu tiên

  assert.equal(ui.seenCalls.length, 1, 'phải publish ngay lần telemetry đầu tiên, không chờ debounce');
  assert.equal(ui.seenCalls[0]?.channelId, 'chan-1');
  // Chưa đủ 5s -> display state vẫn chưa chốt, nhưng channel-seen đã publish.
  assert.equal(service.getDisplayState('chan-1'), undefined);
  void clock;
});

test('telemetry lặp lại cho cùng 1 channel_id -> publishChannelSeen CHỈ gọi đúng 1 lần (lần đầu)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent());
  clock.advance(1000);
  service.handleTelemetry(makeEvent());
  clock.advance(5000);
  service.handleTelemetry(makeEvent()); // đã chốt state ở lần này

  assert.equal(ui.seenCalls.length, 1, 'không được publish lặp lại cho telemetry sau lần đầu tiên');
});

test('publishChannelSeen dùng timestamp từ Clock injectable (không phải Date.now() trực tiếp)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  clock.advance(123456);
  service.handleTelemetry(makeEvent());

  assert.equal(ui.seenCalls[0]?.timestamp, new Date(123456).toISOString());
});

test('mỗi kênh publishChannelSeen độc lập (per-channel, không ảnh hưởng lẫn nhau)', () => {
  const { ui, service } = makeService({ 'chan-1': 4000, 'chan-2': 4000 });

  service.handleTelemetry(makeEvent({ channelId: 'chan-1' }));
  assert.deepEqual(
    ui.seenCalls.map((c) => c.channelId),
    ['chan-1']
  );

  service.handleTelemetry(makeEvent({ channelId: 'chan-2' }));
  assert.deepEqual(
    ui.seenCalls.map((c) => c.channelId),
    ['chan-1', 'chan-2']
  );

  // Lặp lại chan-1 -> không publish thêm.
  service.handleTelemetry(makeEvent({ channelId: 'chan-1' }));
  assert.deepEqual(
    ui.seenCalls.map((c) => c.channelId),
    ['chan-1', 'chan-2']
  );
});

test('uiPort.publishChannelSeen throw (bug giả lập ở adapter) -> log ui_publish_error, KHÔNG throw ra ngoài handleTelemetry, debounce/state của CHÍNH event đó vẫn xử lý bình thường', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000 });
  const alert = new FakeAlertPort();
  const uiPort = new ThrowingUiPort();
  const logger = new FakeLogger();
  const historyPort = new FakeHistoryPort();
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort, historyPort, logger, clock });

  // handleTelemetry() KHÔNG được throw ra ngoài dù uiPort.publishChannelSeen throw.
  assert.doesNotThrow(() => service.handleTelemetry(makeEvent()));

  assert.ok(
    logger.events.some((e) => e.event_type === 'ui_publish_error' && e.channel_id === 'chan-1'),
    'phải log 1 event_type=ui_publish_error rõ ràng'
  );

  // Phần debounce/state phía sau của CHÍNH telemetry event đó vẫn phải chạy
  // bình thường (pending candidate được ghi nhận) - không bị lỡ vì exception.
  clock.advance(5000);
  service.handleTelemetry(makeEvent());
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
  assert.equal(alert.changes.length, 1);
});

test('mỗi kênh có debounce/state độc lập (per-channel)', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000, 'chan-2': 4000 });

  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 })); // ok candidate
  service.handleTelemetry(makeEvent({ channelId: 'chan-2', connectionState: 'RECONNECTING', bitrateKbps: 0 }));

  clock.advance(5000);
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  service.handleTelemetry(makeEvent({ channelId: 'chan-2', connectionState: 'RECONNECTING', bitrateKbps: 0 }));

  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
  assert.deepEqual(service.getDisplayState('chan-2'), { state: 'critical' });
  assert.equal(alert.changes.length, 2);
});

// --- Story 2.7: handleHeartbeat/checkHeartbeatTimeouts ---

test('heartbeat cho channel_id lạ -> log channel_unregistered, không throw, không publish', () => {
  const { alert, logger, service } = makeService({}); // registry rỗng

  assert.doesNotThrow(() => service.handleHeartbeat('unknown-chan', '2026-09-06T00:00:00.000Z'));
  assert.equal(alert.changes.length, 0);
  assert.ok(
    logger.events.some((e) => e.event_type === 'channel_unregistered' && e.channel_id === 'unknown-chan'),
    'phải mirror channel_unregistered của handleTelemetry cho heartbeat'
  );
});

test('checkHeartbeatTimeouts(): kênh chưa từng heartbeat -> không đánh giá, không publish (tránh báo động giả)', () => {
  const { alert, service } = makeService({ 'chan-1': 4000 });

  assert.doesNotThrow(() => service.checkHeartbeatTimeouts());
  assert.equal(alert.changes.length, 0);
});

test('checkHeartbeatTimeouts(): heartbeat vừa nhận, chưa quá HEARTBEAT_TIMEOUT_MS -> không publish machine-offline', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS - 1);
  service.checkHeartbeatTimeouts();

  assert.equal(alert.changes.length, 0);
});

test('checkHeartbeatTimeouts(): im lặng heartbeat đúng HEARTBEAT_TIMEOUT_MS -> publish critical+machine-offline đúng 1 lần, ĐỘC LẬP record.committed', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();

  assert.equal(alert.changes.length, 1);
  assert.equal(alert.changes[0]?.channelId, 'chan-1');
  assert.equal(alert.changes[0]?.displayState, 'critical');
  assert.equal(alert.changes[0]?.subType, 'machine-offline');
  assert.equal(alert.changes[0]?.timestamp, new Date(clock.now()).toISOString());

  // Gọi lại checkHeartbeatTimeouts() nhiều lần nữa (mirror `setInterval` mỗi
  // 1s thật) - KHÔNG được publish lặp lại khi machineOfflineActive đã true.
  clock.advance(1000);
  service.checkHeartbeatTimeouts();
  clock.advance(1000);
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.length, 1, 'không publish lặp lại khi đã machineOfflineActive');
});

test('machine-offline ĐỘC LẬP hoàn toàn record.committed đã chốt (không đọc/so displayState telemetry hiện tại)', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  // Chốt "ok" trước qua telemetry bình thường.
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });

  // Heartbeat riêng biệt bắt đầu, rồi im lặng >=15s.
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();

  const machineOfflineChange = alert.changes.at(-1);
  assert.equal(machineOfflineChange?.displayState, 'critical');
  assert.equal(machineOfflineChange?.subType, 'machine-offline');
  // `getDisplayState()` (committed telemetry) KHÔNG bị machine-offline ghi đè -
  // vẫn đúng 'ok' (Boundaries: "ĐỘC LẬP hoàn toàn record.committed").
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
});

test('heartbeat resume sau machine-offline -> clear flag, re-publish record.committed hiện tại', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  // Chốt "warning" qua telemetry.
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 2000 })); // 50%
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 2000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' });
  const changesBeforeOffline = alert.changes.length;

  // Heartbeat im lặng -> machine-offline.
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.length, changesBeforeOffline + 1);
  assert.equal(alert.changes.at(-1)?.subType, 'machine-offline');

  // Heartbeat resume.
  clock.advance(1000);
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:16.000Z');

  const lastChange = alert.changes.at(-1);
  assert.equal(lastChange?.channelId, 'chan-1');
  assert.equal(lastChange?.displayState, 'warning', 're-publish đúng trạng thái telemetry thật (record.committed)');
  assert.equal(lastChange?.subType, undefined);
  assert.equal(lastChange?.timestamp, new Date(clock.now()).toISOString());

  // checkHeartbeatTimeouts() sau khi resume -> không còn machineOfflineActive,
  // không publish thêm (chưa lại quá hạn).
  const changesAfterResume = alert.changes.length;
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.length, changesAfterResume);
});

// Story 4.4: khi resume trả `record.committed.state === 'ok'`, `handleHeartbeat`
// phải gán `previousDisplayState: 'critical'` CỐ ĐỊNH trên `change` publish -
// KHÔNG đọc giá trị telemetry nội bộ trước đó (`checkOneChannelHeartbeatTimeout`
// luôn công bố machine-offline là `critical`, nên "trạng thái mà đội trực/lãnh
// đạo đã thực sự nhận cảnh báo" luôn là `critical`, bất kể `record.committed`).
test('heartbeat resume sau machine-offline, record.committed.state==="ok" -> change publish gắn previousDisplayState:"critical" CỐ ĐỊNH', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  // Chốt "ok" qua telemetry TRƯỚC KHI machine-offline xảy ra (đúng kịch bản
  // I/O matrix: telemetry đã hồi phục về ok trong lúc heartbeat vẫn im lặng).
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.at(-1)?.subType, 'machine-offline');

  // Heartbeat resume - `record.committed.state` đã là 'ok'.
  clock.advance(1000);
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:16.000Z');

  const lastChange = alert.changes.at(-1);
  assert.equal(lastChange?.displayState, 'ok');
  assert.equal(lastChange?.previousDisplayState, 'critical', 'CỐ ĐỊNH critical, không phải giá trị telemetry nội bộ nào khác');
  assert.equal(lastChange?.subType, undefined, 'record.committed không mang subType machine-offline - guard subType ở adapter sẽ pass');
});

test('heartbeat resume sau machine-offline nhưng CHƯA từng có record.committed (chưa đủ 5s telemetry) -> clear flag, KHÔNG re-publish (không có gì để trả về)', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.length, 1);
  assert.equal(alert.changes[0]?.subType, 'machine-offline');

  clock.advance(1000);
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:16.000Z');

  // Không publish thêm - record.committed vẫn undefined (chưa từng có
  // telemetry nào chốt xong debounce 5s cho kênh này).
  assert.equal(alert.changes.length, 1);
});

test('machine-offline độc lập per-channel: 1 kênh timeout không ảnh hưởng kênh khác vẫn heartbeat đều đặn', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000, 'chan-2': 4000 });

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  service.handleHeartbeat('chan-2', '2026-09-06T00:00:00.000Z');

  clock.advance(HEARTBEAT_TIMEOUT_MS);
  // chan-2 vẫn heartbeat đều - reset lastHeartbeatAt của riêng nó NGAY TRƯỚC
  // khi checkHeartbeatTimeouts() chạy.
  service.handleHeartbeat('chan-2', '2026-09-06T00:00:15.000Z');
  service.checkHeartbeatTimeouts();

  assert.equal(alert.changes.length, 1, 'chỉ chan-1 (thực sự im lặng) mới publish machine-offline');
  assert.equal(alert.changes[0]?.channelId, 'chan-1');
});

test('checkHeartbeatTimeouts(): 1 kênh throw khi publish (bug giả lập alertPort) -> log lỗi, KHÔNG throw ra ngoài, KHÔNG chặn kênh khác', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000, 'chan-2': 4000 });
  const ui = new FakeUiPort();
  const logger = new FakeLogger();

  const publishedForChan2: ChannelStateChange[] = [];
  const partiallyThrowingAlertPort: AlertOutboundPort = {
    publishStateChange(change: ChannelStateChange): void {
      if (change.channelId === 'chan-1') {
        throw new Error('lỗi giả lập chỉ cho chan-1');
      }
      publishedForChan2.push(change);
    },
  };

  const historyPort = new FakeHistoryPort();
  const service = new ChannelStateService({
    registryPort: registry,
    alertPort: partiallyThrowingAlertPort,
    uiPort: ui,
    historyPort,
    logger,
    clock,
  });

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  service.handleHeartbeat('chan-2', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);

  assert.doesNotThrow(() => service.checkHeartbeatTimeouts());

  // chan-2 vẫn phải nhận publishStateChange dù chan-1 throw TRƯỚC/SAU nó
  // trong cùng vòng lặp Map (Map giữ thứ tự insertion: chan-1 rồi chan-2).
  assert.equal(publishedForChan2.length, 1);
  assert.equal(publishedForChan2[0]?.channelId, 'chan-2');
  assert.ok(
    logger.events.some((e) => e.event_type === 'heartbeat_timeout_check_error' && e.channel_id === 'chan-1'),
    'lỗi của chan-1 phải được log lại rõ ràng'
  );
});

// --- Story 3.1: historyPort wiring (ghi ring buffer NGAY mỗi telemetry hợp
// lệ, ĐỘC LẬP debounce 5s) ---

test('telemetry hợp lệ cho channel_id đã đăng ký -> historyPort.recordBitrate gọi đúng channelId/bitratePct(đã tính)/timestampMs(từ Clock)', () => {
  const { clock, historyPort, service } = makeService({ 'chan-1': 4000 });

  clock.advance(999);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 })); // 100%

  assert.equal(historyPort.recordCalls.length, 1);
  assert.equal(historyPort.recordCalls[0]?.channelId, 'chan-1');
  assert.equal(historyPort.recordCalls[0]?.bitratePct, 100);
  assert.equal(historyPort.recordCalls[0]?.timestampMs, clock.now());
});

test('historyPort.recordBitrate gọi cho MỌI telemetry hợp lệ (không chỉ lần đầu/kênh) - khác uiPort.publishChannelSeen', () => {
  const { clock, historyPort, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent());
  clock.advance(1000);
  service.handleTelemetry(makeEvent());
  clock.advance(1000);
  service.handleTelemetry(makeEvent());

  assert.equal(historyPort.recordCalls.length, 3, 'phải ghi mỗi lần telemetry, không chỉ lần đầu');
});

test('telemetry cho channel_id chưa đăng ký -> historyPort.recordBitrate KHÔNG được gọi (mirror policy channel_unregistered)', () => {
  const { historyPort, service } = makeService({}); // registry rỗng

  service.handleTelemetry(makeEvent({ channelId: 'unknown-chan' }));

  assert.equal(historyPort.recordCalls.length, 0);
});

test('historyPort.recordBitrate throw (bug giả lập ở adapter) -> log history_record_error, KHÔNG throw ra ngoài handleTelemetry, debounce/state của CHÍNH event đó vẫn xử lý bình thường', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000 });
  const alert = new FakeAlertPort();
  const ui = new FakeUiPort();
  const historyPort = new ThrowingHistoryPort();
  const logger = new FakeLogger();
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort: ui, historyPort, logger, clock });

  clock.advance(999);
  // handleTelemetry() KHÔNG được throw ra ngoài dù historyPort.recordBitrate throw.
  assert.doesNotThrow(() => service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }))); // 100%

  const errorEvent = logger.events.find((e) => e.event_type === 'history_record_error' && e.channel_id === 'chan-1');
  assert.ok(errorEvent, 'phải log 1 event_type=history_record_error rõ ràng');
  // Code review [patch]: `reason` phải kèm cả bitrate_pct/timestamp_ms của mẫu
  // đã cố ghi (không chỉ message lỗi) - khó chẩn đoán mẫu nào bị mất nếu thiếu.
  assert.ok(
    errorEvent?.reason?.includes('bitrate_pct=100.0%'),
    `reason phải kèm bitrate_pct đã cố ghi, nhận: ${errorEvent?.reason}`
  );
  assert.ok(
    errorEvent?.reason?.includes(`timestamp_ms=${clock.now()}`),
    `reason phải kèm timestamp_ms đã cố ghi (dùng lại đúng giá trị truyền vào recordBitrate, không gọi lại clock.now()), nhận: ${errorEvent?.reason}`
  );

  // Phần debounce/state phía sau của CHÍNH telemetry event đó vẫn phải chạy
  // bình thường (pending candidate được ghi nhận) - không bị lỡ vì exception.
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
  assert.equal(alert.changes.length, 1);
});

// Code review [patch]: `err instanceof Error ? err.message : String(err)`
// (mirror `createCompositeAlertPort` ở `app/main.ts`) - historyPort throw ra 1
// giá trị KHÔNG phải `Error` (vd string thô) vẫn phải hiện đúng nội dung, KHÔNG
// hiện "undefined".
test('historyPort.recordBitrate throw 1 giá trị không phải Error (vd string) -> reason vẫn hiện đúng nội dung, không phải "undefined"', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000 });
  const alert = new FakeAlertPort();
  const ui = new FakeUiPort();
  const logger = new FakeLogger();
  const historyPort: HistoryPort = {
    recordBitrate(): void {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'lỗi giả lập không phải Error';
    },
    getHistory(): ReturnType<HistoryPort['getHistory']> {
      return { state: 'no-history-data' };
    },
  };
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort: ui, historyPort, logger, clock });

  assert.doesNotThrow(() => service.handleTelemetry(makeEvent()));

  const errorEvent = logger.events.find((e) => e.event_type === 'history_record_error' && e.channel_id === 'chan-1');
  assert.ok(errorEvent);
  assert.ok(errorEvent?.reason?.includes('lỗi giả lập không phải Error'));
  assert.ok(!errorEvent?.reason?.includes('undefined'));
});

// --- Story 3.2: uiPort.publishHistoryPoint gọi SAU KHI historyPort.recordBitrate
// thành công, trong CÙNG try/catch (Boundaries) ---

test('telemetry hợp lệ, recordBitrate thành công -> publishHistoryPoint gọi đúng 1 lần với ĐÚNG channelId/bitratePct/timestampMs đã ghi', () => {
  const { clock, ui, historyPort, service } = makeService({ 'chan-1': 4000 });

  clock.advance(777);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 })); // 100%

  assert.equal(ui.historyPointCalls.length, 1);
  assert.equal(ui.historyPointCalls[0]?.channelId, 'chan-1');
  assert.equal(ui.historyPointCalls[0]?.bitratePct, 100);
  assert.equal(ui.historyPointCalls[0]?.timestampMs, clock.now());
  // Đúng giá trị đã truyền cho recordBitrate (không tính/đọc lại clock riêng).
  assert.equal(ui.historyPointCalls[0]?.bitratePct, historyPort.recordCalls[0]?.bitratePct);
  assert.equal(ui.historyPointCalls[0]?.timestampMs, historyPort.recordCalls[0]?.timestampMs);
});

test('historyPort.recordBitrate throw -> uiPort.publishHistoryPoint KHÔNG được gọi (record thất bại thì không publish)', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000 });
  const alert = new FakeAlertPort();
  const ui = new FakeUiPort();
  const historyPort = new ThrowingHistoryPort();
  const logger = new FakeLogger();
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort: ui, historyPort, logger, clock });

  assert.doesNotThrow(() => service.handleTelemetry(makeEvent({ bitrateKbps: 4000 })));

  assert.equal(ui.historyPointCalls.length, 0, 'recordBitrate throw -> publishHistoryPoint không được gọi');
});

test('historyPort.recordBitrate gọi cho MỌI telemetry hợp lệ -> publishHistoryPoint cũng gọi đúng số lần tương ứng (mirror recordCalls)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent());
  clock.advance(1000);
  service.handleTelemetry(makeEvent());
  clock.advance(1000);
  service.handleTelemetry(makeEvent());

  assert.equal(ui.historyPointCalls.length, 3);
});

// Code review round 2 [patch #1]: `recordBitrate` thành công (ring buffer đã
// ghi) NHƯNG chính `uiPort.publishHistoryPoint` mới throw -> log lỗi phải nêu
// đúng "publishHistoryPoint throw", KHÔNG được báo sai là "recordBitrate
// throw" (2 lệnh chung 1 try/catch, dễ log nhầm nguồn gốc lỗi khi debug thật).
test('recordBitrate thành công NHƯNG uiPort.publishHistoryPoint throw -> log nêu đúng "publishHistoryPoint throw" (không phải "recordBitrate throw"), không làm lỡ applyCandidate/debounce phía sau', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000 });
  const alert = new FakeAlertPort();
  const ui = new ThrowingPublishHistoryPointUiPort();
  const historyPort = new FakeHistoryPort();
  const logger = new FakeLogger();
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort: ui, historyPort, logger, clock });

  clock.advance(555);
  assert.doesNotThrow(() => service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }))); // 100%

  // recordBitrate PHẢI đã ghi thành công vào ring buffer (không bị ảnh hưởng
  // bởi publishHistoryPoint throw ngay sau đó).
  assert.equal(historyPort.recordCalls.length, 1);
  assert.equal(historyPort.recordCalls[0]?.bitratePct, 100);

  const errorEvent = logger.events.find((e) => e.event_type === 'history_record_error' && e.channel_id === 'chan-1');
  assert.ok(errorEvent, 'phải log 1 event_type=history_record_error');
  assert.ok(
    errorEvent?.reason?.includes('uiPort.publishHistoryPoint throw'),
    `reason phải nêu đúng "uiPort.publishHistoryPoint throw", nhận: ${errorEvent?.reason}`
  );
  assert.ok(
    !errorEvent?.reason?.includes('historyPort.recordBitrate throw'),
    `reason KHÔNG được báo sai "historyPort.recordBitrate throw" vì recordBitrate đã thành công, nhận: ${errorEvent?.reason}`
  );

  // Phần debounce/state phía sau của CHÍNH telemetry event đó vẫn phải chạy
  // bình thường (pending candidate được ghi nhận) - không bị lỡ vì exception.
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });
  assert.equal(alert.changes.length, 1);
});

// --- Code review [patch] round 1: applyCandidate không được âm thầm "giải
// phóng" cờ machine-offline qua 1 commit telemetry bình thường ---

test('kênh đang machine-offline, telemetry commit trạng thái mới -> publish VẪN kèm subType machine-offline (không âm thầm "phục hồi"), record.committed vẫn đúng candidate telemetry thật', () => {
  const { clock, alert, service } = makeService({ 'chan-1': 4000 });

  // Chốt "ok" trước qua telemetry bình thường.
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });

  // Heartbeat im lặng -> machine-offline (backend's machineOfflineActive=true,
  // KHÔNG có heartbeat resume nào xảy ra sau đây).
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.at(-1)?.subType, 'machine-offline');

  // Telemetry vẫn tới bình thường (kênh telemetry ĐỘC LẬP heartbeat) - candidate
  // đổi ok -> warning qua debounce 5s như thường lệ.
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 2000 })); // 50%
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ channelId: 'chan-1', bitrateKbps: 2000 }));

  const lastChange = alert.changes.at(-1);
  assert.equal(
    lastChange?.subType,
    'machine-offline',
    'publish từ applyCandidate KHÔNG được để trống/override subType machine-offline khi machineOfflineActive vẫn true - nếu không frontend sẽ hiểu nhầm là đã "phục hồi" dù chưa có heartbeat resume nào'
  );
  assert.equal(lastChange?.displayState, 'warning', 'displayState vẫn phản ánh đúng candidate telemetry mới');
  // `record.committed` (getDisplayState) KHÔNG bị machine-offline ghi đè - vẫn
  // đúng candidate telemetry thật (mirror test "ĐỘC LẬP hoàn toàn" ở trên).
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' });
});

// --- Code review [patch] round 1: checkOneChannelHeartbeatTimeout phải bỏ
// qua kênh đã bị gỡ khỏi channel-registry (mirror handleHeartbeat) ---

test('checkHeartbeatTimeouts(): kênh bị gỡ khỏi channel-registry SAU khi đã có lastHeartbeatAt -> không publish machine-offline, log channel_unregistered', () => {
  const baselines: Record<string, number> = { 'chan-1': 4000 };
  const { clock, alert, logger, service } = makeService(baselines);

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  // Hot-reload channel-registry (Story 2.2) gỡ chan-1 khỏi danh sách.
  delete baselines['chan-1'];

  clock.advance(HEARTBEAT_TIMEOUT_MS);
  assert.doesNotThrow(() => service.checkHeartbeatTimeouts());

  assert.equal(alert.changes.length, 0, 'không publish machine-offline cho channel_id không còn trong registry');
  assert.ok(
    logger.events.some((e) => e.event_type === 'channel_unregistered' && e.channel_id === 'chan-1'),
    'phải log channel_unregistered mirror handleHeartbeat'
  );
});

// --- Code review [patch] round 2 (/bmad-code-review): checkOneChannelHeartbeatTimeout
// phải check registry TRƯỚC machineOfflineActive (thứ tự cũ bị đảo, khiến 1
// kênh ĐÃ machine-offline rồi mới bị gỡ khỏi registry không bao giờ log
// channel_unregistered qua nhánh này) ---

test('checkHeartbeatTimeouts(): kênh ĐÃ machineOfflineActive rồi mới bị gỡ khỏi channel-registry -> vẫn log channel_unregistered ở lượt gọi kế tiếp (không im lặng)', () => {
  const baselines: Record<string, number> = { 'chan-1': 4000 };
  const { clock, alert, logger, service } = makeService(baselines);

  // Kênh im lặng heartbeat -> machine-offline trước.
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();
  assert.equal(alert.changes.length, 1);
  assert.equal(alert.changes[0]?.subType, 'machine-offline');

  // Hot-reload channel-registry gỡ chan-1 khỏi danh sách SAU KHI đã offline.
  delete baselines['chan-1'];
  logger.events.length = 0; // reset để chỉ xét log của lượt gọi tiếp theo

  clock.advance(1000);
  assert.doesNotThrow(() => service.checkHeartbeatTimeouts());

  assert.equal(alert.changes.length, 1, 'không publish thêm cho channel_id không còn trong registry');
  assert.ok(
    logger.events.some((e) => e.event_type === 'channel_unregistered' && e.channel_id === 'chan-1'),
    'phải log channel_unregistered dù kênh đã machineOfflineActive từ trước (registry check phải chạy TRƯỚC early-return của machineOfflineActive)'
  );
});

// --- Story 3.3: handleAckCommand + auto-clear ở ĐỦ 3 điểm commit ---

test('handleAckCommand: channel_id hợp lệ trong registry -> publishAckChange(true, operatorLabel), log ack_command_applied', () => {
  const { ui, logger, service } = makeService({ 'chan-1': 4000 });

  service.handleAckCommand('chan-1', 'NV.A', 123456);

  assert.equal(ui.ackChangeCalls.length, 1);
  assert.deepEqual(ui.ackChangeCalls[0], { channelId: 'chan-1', acknowledged: true, ackLabel: 'NV.A' });
  const auditEvent = logger.events.find((e) => e.event_type === 'ack_command_applied' && e.channel_id === 'chan-1');
  assert.ok(auditEvent, 'phải log 1 event_type=ack_command_applied');
  assert.ok(auditEvent?.reason?.includes('NV.A'), 'reason phải chứa operator_label');
});

test('handleAckCommand: channel_id KHÔNG có trong registry -> bỏ qua, log channel_unregistered, KHÔNG publish', () => {
  const { ui, logger, service } = makeService({}); // registry rỗng

  assert.doesNotThrow(() => service.handleAckCommand('unknown-chan', 'NV.A', 123456));

  assert.equal(ui.ackChangeCalls.length, 0);
  assert.ok(
    logger.events.some((e) => e.event_type === 'channel_unregistered' && e.channel_id === 'unknown-chan'),
    'phải log channel_unregistered mirror handleHeartbeat/handleTelemetry'
  );
});

test('handleAckCommand: KHÔNG kiểm tra kênh đang warning/critical hay không (chỉ validate registry, đúng phạm vi AD-25) - ack áp dụng được cả khi kênh chưa từng chốt trạng thái nào', () => {
  const { ui, service } = makeService({ 'chan-1': 4000 }); // chưa handleTelemetry lần nào

  assert.doesNotThrow(() => service.handleAckCommand('chan-1', 'NV.B', 0));
  assert.equal(ui.ackChangeCalls.length, 1);
  assert.equal(ui.ackChangeCalls[0]?.acknowledged, true);
});

test('handleAckCommand: uiPort.publishAckChange throw -> log ui_publish_error, KHÔNG throw ra ngoài, ack vẫn đã lưu (state không bị mất)', () => {
  const clock = new FakeClock();
  const registry = new FakeRegistryPort({ 'chan-1': 4000 });
  const alert = new FakeAlertPort();
  const ui = new ThrowingUiPort();
  const historyPort = new FakeHistoryPort();
  const logger = new FakeLogger();
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort: ui, historyPort, logger, clock });

  assert.doesNotThrow(() => service.handleAckCommand('chan-1', 'NV.C', 999));

  assert.ok(
    logger.events.some((e) => e.event_type === 'ui_publish_error' && e.channel_id === 'chan-1'),
    'phải log 1 event_type=ui_publish_error rõ ràng'
  );
  assert.ok(
    logger.events.some((e) => e.event_type === 'ack_command_applied' && e.channel_id === 'chan-1'),
    'audit log vẫn phải ghi dù publishAckChange throw (state đã lưu thành công trước đó)'
  );
});

test('applyCandidate: kênh đang acknowledged=true, commit candidate MỚI khác candidate đã ack (vd ok->warning) -> auto-clear, publishAckChange(false, undefined)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  // Chốt "ok" trước.
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });

  service.handleAckCommand('chan-1', 'NV.A', 0);
  assert.equal(ui.ackChangeCalls.at(-1)?.acknowledged, true);

  // Commit candidate MỚI (ok -> warning).
  clock.advance(1000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 })); // 50%
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' });

  const lastAckChange = ui.ackChangeCalls.at(-1);
  assert.deepEqual(lastAckChange, { channelId: 'chan-1', acknowledged: false, ackLabel: undefined });
});

test('applyCandidate: kênh đang acknowledged=true, commit candidate MỚI là "ok" (phục hồi) -> auto-clear vẫn áp dụng (I/O matrix: phục hồi ok CŨNG xoá ack)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 })); // 50% -> warning
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' });

  service.handleAckCommand('chan-1', 'NV.A', 0);

  clock.advance(1000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 })); // 100% -> ok
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'ok' });

  assert.deepEqual(ui.ackChangeCalls.at(-1), { channelId: 'chan-1', acknowledged: false, ackLabel: undefined });
});

test('applyCandidate: kênh CHƯA từng ack -> commit candidate mới KHÔNG gọi publishAckChange (no-op, không log/publish thừa)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 4000 }));

  assert.equal(ui.ackChangeCalls.length, 0, 'kênh chưa từng ack -> không có lý do gì để publishAckChange');
});

test('checkOneChannelHeartbeatTimeout: kênh đang acknowledged=true, im lặng heartbeat -> kích hoạt machine-offline VÀ auto-clear ack, publishAckChange(false, undefined)', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 })); // warning
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));

  service.handleAckCommand('chan-1', 'NV.A', 0);
  assert.equal(ui.ackChangeCalls.at(-1)?.acknowledged, true);

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();

  assert.deepEqual(ui.ackChangeCalls.at(-1), { channelId: 'chan-1', acknowledged: false, ackLabel: undefined });
});

test('handleHeartbeat (nhánh recovery machine-offline): kênh đang acknowledged=true khi máy trung tâm phục hồi -> auto-clear ack dù record.committed không đổi giá trị', () => {
  const { clock, ui, service } = makeService({ 'chan-1': 4000 });

  // Chốt "warning" qua telemetry TRƯỚC KHI machine-offline xảy ra.
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' });

  // Máy trung tâm im lặng -> machine-offline (auto-clear ở điểm này không áp
  // dụng vì CHƯA có ack nào - ack được thực hiện SAU KHI đã machine-offline,
  // đúng kịch bản thật: đội trực thấy critical/machine-offline rồi mới ack).
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();

  service.handleAckCommand('chan-1', 'NV.A', 0);
  assert.equal(ui.ackChangeCalls.at(-1)?.acknowledged, true);

  // Máy trung tâm phục hồi - record.committed VẪN là 'warning' (không đổi giá
  // trị), nhưng hiển thị UI đổi từ critical/machine-offline về lại 'warning'
  // thật -> đây VẪN là 1 lần "chuyển cảnh báo" theo góc nhìn người xem, ack
  // phải tự xoá (review round 1 [patch]).
  clock.advance(1000);
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:16.000Z');

  assert.deepEqual(ui.ackChangeCalls.at(-1), { channelId: 'chan-1', acknowledged: false, ackLabel: undefined });
  assert.deepEqual(service.getDisplayState('chan-1'), { state: 'warning' }, 'record.committed không đổi giá trị');
});

test('handleHeartbeat (nhánh recovery): kênh KHÔNG acknowledged -> resume vẫn hoạt động bình thường (re-publish committed), KHÔNG gọi publishAckChange thừa', () => {
  const { clock, ui, alert, service } = makeService({ 'chan-1': 4000 });

  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));
  clock.advance(5000);
  service.handleTelemetry(makeEvent({ bitrateKbps: 2000 }));

  service.handleHeartbeat('chan-1', '2026-09-06T00:00:00.000Z');
  clock.advance(HEARTBEAT_TIMEOUT_MS);
  service.checkHeartbeatTimeouts();

  clock.advance(1000);
  service.handleHeartbeat('chan-1', '2026-09-06T00:00:16.000Z');

  assert.equal(ui.ackChangeCalls.length, 0, 'kênh chưa từng ack -> không publishAckChange nào ở nhánh recovery');
  assert.equal(alert.changes.at(-1)?.displayState, 'warning', 're-publish committed vẫn hoạt động bình thường');
});
