import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelStateService, HEARTBEAT_TIMEOUT_MS, type Clock } from '../src/core/channelState.js';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../src/ports/ChannelRegistryPort.js';
import type { AlertOutboundPort, ChannelStateChange } from '../src/ports/AlertOutboundPort.js';
import type { UiOutboundPort } from '../src/ports/UiOutboundPort.js';
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
class FakeUiPort implements UiOutboundPort {
  seenCalls: { channelId: string; timestamp: string }[] = [];
  publishChannelSeen(channelId: string, timestamp: string): void {
    this.seenCalls.push({ channelId, timestamp });
  }
}

// Code review [patch #3]: xác nhận `uiPort.publishChannelSeen` throw KHÔNG
// làm lỡ phần debounce/state phía sau của chính telemetry event đó.
class ThrowingUiPort implements UiOutboundPort {
  publishChannelSeen(): void {
    throw new Error('lỗi giả lập từ uiPort');
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
  const logger = new FakeLogger();
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort: ui, logger, clock });
  return { clock, alert, ui, logger, service };
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
  const service = new ChannelStateService({ registryPort: registry, alertPort: alert, uiPort, logger, clock });

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

  const service = new ChannelStateService({
    registryPort: registry,
    alertPort: partiallyThrowingAlertPort,
    uiPort: ui,
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
