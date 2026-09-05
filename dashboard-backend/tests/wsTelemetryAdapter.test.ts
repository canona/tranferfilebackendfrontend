// Mirror test_telemetry_ws_client.cpp (transport-core): kiểm tra
// wsTelemetryAdapter qua 1 WS server THẬT chạy local (127.0.0.1, port 0 -
// OS tự cấp port trống) + 1 WS client THẬT (thư viện `ws`) - không cần 20
// máy trung tâm thật hay dashboard-backend thật ở đầu kia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import { startWsTelemetryAdapter, type WsTelemetryAdapterHandle } from '../src/adapters/inbound/wsTelemetryAdapter.js';
import type { TelemetryInboundPort, TelemetryEvent } from '../src/ports/TelemetryInboundPort.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';

class FakeTelemetryPort implements TelemetryInboundPort {
  events: TelemetryEvent[] = [];
  handleTelemetry(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

// Code review [test coverage]: `handleTelemetry()` throw không được test -
// port này ném lỗi (bug tương lai ở core) để xác nhận adapter bắt lại đúng
// (log `telemetry_handler_error`, KHÔNG crash, connection vẫn sống).
class ThrowingTelemetryPort implements TelemetryInboundPort {
  handleTelemetry(): void {
    throw new Error('lỗi giả lập từ core');
  }
}

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
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

async function startTestServer(validBearerTokens: ReadonlySet<string>) {
  const telemetryPort = new FakeTelemetryPort();
  const logger = new FakeLogger();
  const handle: WsTelemetryAdapterHandle = await startWsTelemetryAdapter({
    port: 0,
    host: '127.0.0.1',
    validBearerTokens,
    telemetryPort,
    logger,
  });
  return { telemetryPort, logger, handle };
}

test('Bearer-token đúng -> accept connection, telemetry hợp lệ được forward vào core', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-ws-test',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 3500, rtt_ms: 20.5, connection_state: 'CONNECTED', audio_level: [-20, -18] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    assert.equal(telemetryPort.events.length, 1);
    assert.equal(telemetryPort.events[0]?.channelId, 'chan-ws-test');
    assert.equal(telemetryPort.events[0]?.bitrateKbps, 3500);
    assert.equal(telemetryPort.events[0]?.rttMs, 20.5);
    assert.equal(telemetryPort.events[0]?.connectionState, 'CONNECTED');
    assert.deepEqual(telemetryPort.events[0]?.audioLevel, [-20, -18]);
    assert.ok(logger.events.some((e) => e.event_type === 'ws_accept'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('Bearer-token sai -> reject handshake HTTP 401/403, không tạo session, log ws_reject_auth', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });

    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res: IncomingMessage) => resolve(res.statusCode ?? 0));
      ws.once('open', () => reject(new Error('không được kết nối thành công với token sai')));
      ws.on('error', () => {
        /* 'unexpected-response' đã đủ để assert - tránh unhandled 'error' làm crash test */
      });
    });

    assert.ok(statusCode === 401 || statusCode === 403, `expected 401/403, got ${statusCode}`);
    assert.equal(telemetryPort.events.length, 0);
    assert.ok(logger.events.some((e) => e.event_type === 'ws_reject_auth'));
  } finally {
    await handle.close();
  }
});

test('Bearer-token thiếu -> reject handshake HTTP 401/403', async () => {
  const { handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`);

    const statusCode = await new Promise<number>((resolve, reject) => {
      ws.once('unexpected-response', (_req, res: IncomingMessage) => resolve(res.statusCode ?? 0));
      ws.once('open', () => reject(new Error('không được kết nối thành công khi thiếu token')));
      ws.on('error', () => {});
    });

    assert.ok(statusCode === 401 || statusCode === 403, `expected 401/403, got ${statusCode}`);
  } finally {
    await handle.close();
  }
});

test('event_type ngoài tập đóng (vd "bitrate" của ABR) bị bỏ qua, không throw, không ảnh hưởng state', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-abr',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'bitrate', // event ABR riêng, ngoài tập đóng
        payload: { level: 2 },
      })
    );
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-abr',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    // Chỉ đúng 1 event (telemetry) được forward - "bitrate" bị bỏ qua âm thầm,
    // không throw (connection vẫn sống để nhận message tiếp theo).
    assert.equal(telemetryPort.events.length, 1);
    assert.ok(logger.events.some((e) => e.event_type === 'event_type_ignored'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('event_type khác trong tập đóng nhưng không phải telemetry (vd heartbeat) bị bỏ qua có chủ đích, không throw', async () => {
  const { telemetryPort, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-hb',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'heartbeat',
        payload: {},
      })
    );
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-hb',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 500, rtt_ms: 5, connection_state: 'CONNECTED', audio_level: [-1, -1] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    assert.equal(telemetryPort.events.length, 1);
    assert.equal(telemetryPort.events[0]?.channelId, 'chan-hb');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('connection_state ngoài tập đóng (vd "UNKNOWN") -> không forward, log telemetry_payload_invalid, connection vẫn sống', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-unknown-state',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'UNKNOWN', audio_level: [0, 0] },
      })
    );
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-unknown-state',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    assert.equal(telemetryPort.events.length, 1, 'chỉ đúng telemetry hợp lệ được forward');
    assert.equal(telemetryPort.events[0]?.connectionState, 'CONNECTED');
    assert.ok(logger.events.some((e) => e.event_type === 'telemetry_payload_invalid'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('telemetry thiếu channel_id -> không forward, log envelope_invalid, connection vẫn sống', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        schema_version: 1,
        // channel_id cố ý thiếu
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-has-id',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    assert.equal(telemetryPort.events.length, 1);
    assert.equal(telemetryPort.events[0]?.channelId, 'chan-has-id');
    assert.ok(logger.events.some((e) => e.event_type === 'envelope_invalid'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('bitrate_kbps/rtt_ms/audio_level dạng rác (null/false/""/mảng) -> không forward, log telemetry_payload_invalid, connection vẫn sống', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const garbagePayloads = [
      { bitrate_kbps: null, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      { bitrate_kbps: 1000, rtt_ms: false, connection_state: 'CONNECTED', audio_level: [0, 0] },
      { bitrate_kbps: '', rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [[1], 0] },
      { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: null },
    ];
    for (const [i, payload] of garbagePayloads.entries()) {
      ws.send(
        JSON.stringify({
          schema_version: 1,
          channel_id: `chan-garbage-${i}`,
          timestamp: '2026-09-03T00:00:00.000Z',
          event_type: 'telemetry',
          payload,
        })
      );
    }
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-garbage-followup',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    // Không 1 payload rác nào trong 5 cái ở trên được forward - chỉ đúng 1
    // telemetry hợp lệ gửi sau cùng lọt qua.
    assert.equal(telemetryPort.events.length, 1);
    assert.equal(telemetryPort.events[0]?.channelId, 'chan-garbage-followup');
    const invalidLogsCount = logger.events.filter((e) => e.event_type === 'telemetry_payload_invalid').length;
    assert.equal(invalidLogsCount, garbagePayloads.length, 'mỗi payload rác phải có đúng 1 dòng log telemetry_payload_invalid');

    ws.close();
  } finally {
    await handle.close();
  }
});

test('Envelope không phải JSON hợp lệ -> log lỗi, không throw, connection vẫn sống', async () => {
  const { telemetryPort, logger, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send('{not-valid-json');
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-bad-json',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 100, rtt_ms: 1, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );

    await waitUntil(() => telemetryPort.events.length > 0);
    assert.equal(telemetryPort.events.length, 1);
    assert.ok(logger.events.some((e) => e.event_type === 'envelope_parse_error'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('handleTelemetry() throw (bug giả lập ở core) -> log telemetry_handler_error, KHÔNG crash, connection vẫn sống', async () => {
  const telemetryPort = new ThrowingTelemetryPort();
  const logger = new FakeLogger();
  const handle = await startWsTelemetryAdapter({
    port: 0,
    host: '127.0.0.1',
    validBearerTokens: new Set(['test-bearer-token']),
    telemetryPort,
    logger,
  });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-throw',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );

    await waitUntil(() => logger.events.some((e) => e.event_type === 'telemetry_handler_error'));
    const errEvent = logger.events.find((e) => e.event_type === 'telemetry_handler_error');
    assert.equal(errEvent?.channel_id, 'chan-throw');
    assert.match(errEvent?.reason ?? '', /lỗi giả lập từ core/);

    // Connection vẫn sống sau exception - gửi tiếp 1 message khác vẫn được
    // xử lý (dù cùng throw), không bị đóng/crash.
    ws.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-throw-2',
        timestamp: '2026-09-03T00:00:00.000Z',
        event_type: 'telemetry',
        payload: { bitrate_kbps: 1000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [0, 0] },
      })
    );
    await waitUntil(() => logger.events.some((e) => e.channel_id === 'chan-throw-2'));

    ws.close();
  } finally {
    await handle.close();
  }
});

test('client rớt kết nối đột ngột đúng lúc server đang reject handshake (bearer sai) -> không crash process, vẫn phục vụ kết nối sau', async () => {
  const { telemetryPort, handle } = await startTestServer(new Set(['test-bearer-token']));
  try {
    // Kết nối TCP thô gửi request upgrade với bearer sai, rồi HUỶ kết nối
    // ngay lập tức - mô phỏng đúng race mà no-op `socket.on('error')` trong
    // `rejectHandshake()` được thêm để chặn (server ghi/destroy 1 socket mà
    // client đã reset trước đó -> 'error' phải có người bắt, nếu không sẽ
    // uncaught exception, crash cả tiến trình).
    const raw = net.connect(handle.port, '127.0.0.1');
    await new Promise<void>((resolve) => raw.on('connect', () => resolve()));
    raw.write(
      'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${handle.port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        'Authorization: Bearer wrong-token\r\n' +
        '\r\n'
    );
    // resetAndDestroy() gửi RST ngay lập tức thay vì đóng TCP gọn (FIN) - mô
    // phỏng đúng kịch bản "client rớt mạng" thay vì "client đóng lịch sự".
    raw.resetAndDestroy();
    await new Promise<void>((resolve) => raw.on('close', () => resolve()));

    // Cho server 1 khoảng ngắn để xử lý xong upgrade handler (rejectHandshake).
    // Nếu process crash vì unhandled 'error' ở đây, toàn bộ test process sẽ
    // chết trước khi chạy tới assert bên dưới - đó chính là tín hiệu fail
    // mạnh nhất cho regression này.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Server vẫn sống: 1 kết nối WS hợp lệ tiếp theo vẫn thành công.
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`, {
      headers: { Authorization: 'Bearer test-bearer-token' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.close();
    assert.equal(telemetryPort.events.length, 0);
  } finally {
    await handle.close();
  }
});
