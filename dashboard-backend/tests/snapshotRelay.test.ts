// Bổ sung video-preview thật (AD-22): unit test bằng fake (mirror
// channelState.test.ts's style cho handleHeartbeat's registry check) - không
// cần WS thật (khác wsTelemetryAdapter.test.ts/wsUiAdapter.test.ts, vốn test
// qua kết nối WS thật vì đó là ranh giới adapter<->mạng).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotRelayService } from '../src/core/snapshotRelay.js';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../src/ports/ChannelRegistryPort.js';
import type { SnapshotOutboundPort } from '../src/ports/SnapshotOutboundPort.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';

class FakeRegistryPort implements ChannelRegistryPort {
  constructor(private readonly registeredChannelIds: readonly string[]) {}
  getEntry(channelId: string): ChannelRegistryEntry | undefined {
    if (!this.registeredChannelIds.includes(channelId)) return undefined;
    return {
      stationName: `Station ${channelId}`,
      contactName: 'Fake Contact',
      contactPhone: '0000000000',
      gridPosition: 0,
      baselineKbps: 4000,
    };
  }
  listEntries(): ReadonlyArray<ChannelRegistryEntry & { channelId: string }> {
    return this.registeredChannelIds.map((channelId) => ({ channelId, ...this.getEntry(channelId)! }));
  }
}

class FakeSnapshotOutboundPort implements SnapshotOutboundPort {
  calls: { channelId: string; imageBase64: string; timestamp: string }[] = [];
  publishSnapshot(channelId: string, imageBase64: string, timestamp: string): void {
    this.calls.push({ channelId, imageBase64, timestamp });
  }
}

class ThrowingSnapshotOutboundPort implements SnapshotOutboundPort {
  publishSnapshot(): void {
    throw new Error('lỗi giả lập từ snapshotOutboundPort');
  }
}

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

function makeService(registeredChannelIds: readonly string[]) {
  const registryPort = new FakeRegistryPort(registeredChannelIds);
  const snapshotOutboundPort = new FakeSnapshotOutboundPort();
  const logger = new FakeLogger();
  const service = new SnapshotRelayService({ registryPort, snapshotOutboundPort, logger });
  return { registryPort, snapshotOutboundPort, logger, service };
}

test('channel_id đã đăng ký -> forward NGUYÊN VĂN qua SnapshotOutboundPort, không debounce/mapping', () => {
  const { snapshotOutboundPort, service } = makeService(['chan-1']);

  service.handleSnapshot('chan-1', 'ZmFrZS1qcGVn', '2026-09-07T00:00:00.000Z');

  assert.equal(snapshotOutboundPort.calls.length, 1);
  assert.deepEqual(snapshotOutboundPort.calls[0], {
    channelId: 'chan-1',
    imageBase64: 'ZmFrZS1qcGVn',
    timestamp: '2026-09-07T00:00:00.000Z',
  });
});

test('channel_id lạ không có trong registry -> log channel_unregistered, KHÔNG forward, không throw', () => {
  const { snapshotOutboundPort, logger, service } = makeService([]); // registry rỗng

  assert.doesNotThrow(() => service.handleSnapshot('unknown-chan', 'ZmFrZQ==', '2026-09-07T00:00:00.000Z'));
  assert.equal(snapshotOutboundPort.calls.length, 0);
  assert.ok(
    logger.events.some((e) => e.event_type === 'channel_unregistered' && e.channel_id === 'unknown-chan'),
    'phải log 1 event_type=channel_unregistered rõ ràng'
  );
});

test('gọi liên tiếp nhiều snapshot cho CÙNG channel_id -> forward MỖI LẦN, không có idempotent-guard/debounce (AD-22: transport-core tự kiểm soát nhịp)', () => {
  const { snapshotOutboundPort, service } = makeService(['chan-1']);

  service.handleSnapshot('chan-1', 'khung-1', '2026-09-07T00:00:00.000Z');
  service.handleSnapshot('chan-1', 'khung-2', '2026-09-07T00:00:01.500Z');

  assert.equal(snapshotOutboundPort.calls.length, 2);
  assert.equal(snapshotOutboundPort.calls[0]?.imageBase64, 'khung-1');
  assert.equal(snapshotOutboundPort.calls[1]?.imageBase64, 'khung-2');
});

test('snapshotOutboundPort.publishSnapshot() throw (bug tương lai ở wsUiAdapter.ts) -> log snapshot_publish_error, KHÔNG throw ra ngoài', () => {
  const registryPort = new FakeRegistryPort(['chan-1']);
  const snapshotOutboundPort = new ThrowingSnapshotOutboundPort();
  const logger = new FakeLogger();
  const service = new SnapshotRelayService({ registryPort, snapshotOutboundPort, logger });

  assert.doesNotThrow(() => service.handleSnapshot('chan-1', 'ZmFrZQ==', '2026-09-07T00:00:00.000Z'));
  assert.ok(
    logger.events.some((e) => e.event_type === 'snapshot_publish_error' && e.channel_id === 'chan-1'),
    'phải log snapshot_publish_error, không để exception thoát ra ngoài (tránh crash message handler của wsTelemetryAdapter.ts)'
  );
});
