import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelStateService, type Clock } from '../src/core/channelState.js';
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
