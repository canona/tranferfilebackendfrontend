// Code review [test coverage]: `app/main.ts` (parsePort, parseBearerTokens)
// không có test nào trước đây dù đây chính là nơi code review vòng trước bắt
// lỗi (DASHBOARD_WS_PORT không validate, dẫn thẳng vào httpServer.listen()).
// 2 hàm đã được export riêng cho đúng mục đích test này (không cần start cả
// startApp()/mở cổng WS/đọc channel-registry file thật) - pattern này giữ
// nguyên 100% ở Story 2.2 (không đổi parsePort/parseBearerTokens).
//
// Story 2.2: thêm test cho field cấu hình `channelRegistryFilePath` của
// `startApp()` - khác parsePort/parseBearerTokens (hàm thuần không I/O),
// field này đi thẳng vào `FileChannelRegistryAdapter` (đọc file thật) nên
// test phải gọi `startApp()` thật (port 0 = OS tự cấp port trống, dừng ngay
// bằng `app.stop()`) với 1 file channel-registry hợp lệ ghi ra `mkdtempSync`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';
import { parsePort, parseBearerTokens, startApp, createCompositeAlertPort } from '../app/main.js';
import type { AlertOutboundPort, ChannelStateChange } from '../src/ports/AlertOutboundPort.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';
import type { Clock } from '../src/core/channelState.js';

// Story 2.7: mirror `channelState.test.ts`'s `FakeClock` - dùng để verify
// timer heartbeat THẬT của `main.ts` (setInterval 1000ms wall-clock) gọi
// đúng `checkHeartbeatTimeouts()` mà không phải chờ đủ 15000ms thật.
class FakeClock implements Clock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

// Code review [patch]: mirror `wsUiAdapter.test.ts`'s `waitUntil` - test
// integration mới (composite alertPort wiring thật) cần poll cho tới khi 1
// điều kiện async (message tới qua WS) trở thành true, thay vì `setTimeout`
// cố định dễ giòn/chậm.
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

function writeValidRegistryFile(): { dir: string; filePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'dashboard-backend-main-test-'));
  const filePath = path.join(dir, 'channel-registry.json');
  writeFileSync(
    filePath,
    JSON.stringify({
      'chan-1': {
        station_name: 'Đài 1',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0900000000',
        grid_position: 0,
        baseline_kbps: 4000,
      },
    }),
    'utf8'
  );
  return { dir, filePath };
}

// Chiếm 1 port bằng 1 TCP server khác (port 0 = để OS tự cấp - tránh chọn 1
// số cố định có thể trùng port khác đang mở trên máy CI/dev), GIỮ NGUYÊN
// liên tục cho tới khi test tự gọi `close()` - dùng để giả lập EADDRINUSE
// cho `startApp()`.
//
// Code review [patch #4 - sửa lại]: bản đầu tiên dùng pattern "bind port 0 để
// lấy 1 số port trống -> đóng ngay -> dùng lại đúng số đó cho startApp()" bị
// race thật trên máy Windows này - giữa lúc đóng và lúc `startApp()` thực sự
// bind lại, OS có thể cấp phát y hệt số port đó cho 1 request `listen(0)`
// khác đang chạy đồng thời trong CÙNG file test (`getFreePort()` gọi liên
// tiếp nhiều lần), gây EADDRINUSE giả ở ĐÚNG bước lẽ ra phải thành công, làm
// cả file test treo/fail sai. Sửa lại: giữ liên tục occupant server này mở
// suốt đời test (không bao giờ đóng-rồi-dùng-lại số port), loại bỏ hoàn toàn
// cửa sổ race.
function occupyEphemeralPort(host = '127.0.0.1'): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ server, port });
    });
  });
}

test('parsePort: số nguyên hợp lệ trong khoảng 0-65535 -> trả đúng số', () => {
  assert.equal(parsePort('8080'), 8080);
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('65535'), 65535);
});

test('parsePort: rỗng/toàn khoảng trắng -> throw rõ ràng (không âm thầm thành 0)', () => {
  assert.throws(() => parsePort(''), /rỗng/);
  assert.throws(() => parsePort('   '), /rỗng/);
});

test('parsePort: không phải số nguyên hợp lệ -> throw', () => {
  for (const bad of ['abc', '-1', '65536', '8080.5', 'NaN', 'Infinity']) {
    assert.throws(() => parsePort(bad), `parsePort("${bad}") phải throw`);
  }
});

test('parseBearerTokens: undefined/rỗng -> Set rỗng', () => {
  assert.equal(parseBearerTokens(undefined).size, 0);
  assert.equal(parseBearerTokens('').size, 0);
});

test('parseBearerTokens: danh sách cách nhau bởi dấu phẩy -> trim + bỏ token rỗng', () => {
  const tokens = parseBearerTokens(' tok-a ,tok-b,, tok-c');
  assert.deepEqual([...tokens].sort(), ['tok-a', 'tok-b', 'tok-c']);
});

test('startApp(): channelRegistryFilePath hợp lệ -> khởi động thành công, wiring registryPort vào ChannelStateService, stop() không throw', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dashboard-backend-main-test-'));
  const filePath = path.join(dir, 'channel-registry.json');
  writeFileSync(
    filePath,
    JSON.stringify({
      'chan-1': {
        station_name: 'Đài 1',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0900000000',
        grid_position: 0,
        baseline_kbps: 4000,
      },
    }),
    'utf8'
  );

  try {
    const app = await startApp({
      port: 0,
      host: '127.0.0.1',
      uiPort: 0,
      validBearerTokens: new Set(['test-token']),
      channelRegistryFilePath: filePath,
    });
    try {
      // Wiring đúng: chưa có telemetry nào -> chưa có display state đã chốt,
      // nhưng service phải tồn tại/khởi tạo được không throw (registryPort
      // được truyền đúng field name mới vào ChannelStateService).
      assert.equal(app.channelStateService.getDisplayState('chan-1'), undefined);
    } finally {
      await assert.doesNotReject(() => app.stop());
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startApp(): channelRegistryFilePath trỏ file không tồn tại -> throw rõ ràng, nêu path + gợi ý copy từ .example.json', async () => {
  const missingPath = path.join(tmpdir(), 'khong-ton-tai-channel-registry-' + Date.now() + '.json');
  await assert.rejects(
    () =>
      startApp({
        port: 0,
        host: '127.0.0.1',
        uiPort: 0,
        validBearerTokens: new Set(['test-token']),
        channelRegistryFilePath: missingPath,
      }),
    /channel-registry\.example\.json/
  );
});

// Code review [patch #4]: 2 nhánh cleanup MỚI của Story 2.3 (nếu bind cổng UI
// thất bại -> registryPort.stop() trước khi rethrow; nếu bind cổng telemetry
// thất bại SAU KHI ui đã bind thành công -> registryPort.stop() VÀ
// await ui.close() trước khi rethrow) chưa có test nào chạm tới trước đây.

test('startApp(): uiPort bị chiếm trước (EADDRINUSE) -> reject, VÀ registryPort.stop() đã thực sự chạy (thư mục tmp registry xoá được ngay, không bị khoá bởi watcher rò rỉ)', async () => {
  const { dir, filePath } = writeValidRegistryFile();
  const { server: blocker, port: occupiedUiPort } = await occupyEphemeralPort();

  try {
    await assert.rejects(() =>
      startApp({
        port: 0,
        host: '127.0.0.1',
        uiPort: occupiedUiPort,
        uiHost: '127.0.0.1',
        validBearerTokens: new Set(['test-token']),
        channelRegistryFilePath: filePath,
      })
    );

    // Trên Windows, 1 chokidar watcher còn treo (registryPort.stop() KHÔNG
    // được gọi) giữ file handle mở trên thư mục đang watch, khiến rmSync ở
    // đây throw EBUSY/EPERM ngay lập tức - đây là bằng chứng trực tiếp cleanup
    // đã thực sự chạy, không chỉ "không throw ra ngoài".
    assert.doesNotThrow(
      () => rmSync(dir, { recursive: true, force: true }),
      'registryPort.stop() phải đã chạy - thư mục tmp phải xoá được ngay, không bị khoá'
    );
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('startApp(): port telemetry bị chiếm trước SAU KHI uiPort đã bind thành công -> reject, VÀ registryPort.stop() đã thực sự chạy (nhánh cleanup CHỈ chạm tới khi ui đã bind OK rồi telemetry mới fail)', async () => {
  const { dir, filePath } = writeValidRegistryFile();
  const { server: blocker, port: occupiedTelemetryPort } = await occupyEphemeralPort();

  try {
    // uiPort: 0 (OS tự cấp tại thời điểm chạy) - ui PHẢI bind thành công ở
    // đây để test đúng nhánh "telemetry fail SAU KHI ui đã bind OK" (khác
    // nhánh test phía trên, nơi chính ui mới là bên fail). Không cần biết
    // uiPort thật là số nào - `await ui.close()` nằm trên đường đi bắt buộc
    // TRƯỚC khi `startApp()` reject (xem app/main.ts), nên nếu nó treo/lỗi,
    // chính assert.rejects() bên dưới sẽ treo/fail thay vì âm thầm lọt qua.
    await assert.rejects(() =>
      startApp({
        port: occupiedTelemetryPort,
        host: '127.0.0.1',
        uiPort: 0,
        uiHost: '127.0.0.1',
        validBearerTokens: new Set(['test-token']),
        channelRegistryFilePath: filePath,
      })
    );

    // registryPort.stop() phải đã chạy - cùng bằng chứng như test phía trên.
    assert.doesNotThrow(
      () => rmSync(dir, { recursive: true, force: true }),
      'registryPort.stop() phải đã chạy - thư mục tmp phải xoá được ngay, không bị khoá'
    );
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

// Code review [test coverage, vòng 2]: mọi test phía trên đều override
// `uiPort`/`uiHost` qua `config` - nhánh `config?.uiPort ?? (process.env.
// DASHBOARD_UI_WS_PORT !== undefined ? parsePort(...) : 8081)` và `uiHost =
// config?.uiHost ?? host` (dùng bởi `main()` production thật, gọi startApp()
// KHÔNG có config) chưa từng được test chạm tới - 1 regression ở đây (vd đọc
// nhầm biến env khác, hoặc luôn dùng default 8081 bỏ qua env) sẽ không làm
// fail bất kỳ test nào có sẵn.
function withEnvVar(name: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return fn().finally(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test('startApp(): DASHBOARD_UI_WS_PORT đọc từ env khi config không set uiPort', async () => {
  const { dir, filePath } = writeValidRegistryFile();
  try {
    await withEnvVar('DASHBOARD_UI_WS_PORT', '0', async () => {
      const app = await startApp({
        port: 0,
        host: '127.0.0.1',
        // uiPort KHÔNG set trong config - phải đọc process.env.DASHBOARD_UI_WS_PORT
        // ('0' = OS tự cấp port trống) qua đúng parsePort(), không phải default 8081.
        validBearerTokens: new Set(['test-token']),
        channelRegistryFilePath: filePath,
      });
      try {
        assert.equal(typeof app.ui.port, 'number');
        assert.ok(app.ui.port > 0, 'phải bind thành công tới 1 port do OS cấp, không phải NaN/0 âm thầm');
      } finally {
        await app.stop();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startApp(): DASHBOARD_UI_WS_PORT không hợp lệ trong env -> reject qua parsePort (không âm thầm bind cổng sai)', async () => {
  const { dir, filePath } = writeValidRegistryFile();
  try {
    await withEnvVar('DASHBOARD_UI_WS_PORT', 'không-phải-số', async () => {
      await assert.rejects(
        () =>
          startApp({
            port: 0,
            host: '127.0.0.1',
            validBearerTokens: new Set(['test-token']),
            channelRegistryFilePath: filePath,
          }),
        /DASHBOARD_UI_WS_PORT không hợp lệ/
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Story 2.6: `createCompositeAlertPort` (composite AlertOutboundPort tại
// composition root, fan-out log + WS UI) - test thuần, không cần start cả
// startApp()/chờ debounce 5s thật (mirror pattern parsePort/parseBearerTokens
// export riêng để test).
class FakeAlertPort implements AlertOutboundPort {
  changes: ChannelStateChange[] = [];
  publishStateChange(change: ChannelStateChange): void {
    this.changes.push(change);
  }
}

class ThrowingAlertPort implements AlertOutboundPort {
  publishStateChange(): void {
    throw new Error('nhánh này luôn throw');
  }
}

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

test('createCompositeAlertPort: publishStateChange gọi ĐỦ CẢ 2 nhánh với đúng change', () => {
  const logPort = new FakeAlertPort();
  const uiPort = new FakeAlertPort();
  const composite = createCompositeAlertPort([logPort, uiPort], new FakeLogger());

  const change: ChannelStateChange = { channelId: 'chan-1', displayState: 'warning', timestamp: '2026-09-06T00:00:00.000Z' };
  composite.publishStateChange(change);

  assert.deepEqual(logPort.changes, [change]);
  assert.deepEqual(uiPort.changes, [change]);
});

test('createCompositeAlertPort: 1 nhánh throw -> nhánh còn lại VẪN nhận change, lỗi được log, KHÔNG throw ra ngoài', () => {
  const uiPort = new FakeAlertPort();
  const logger = new FakeLogger();
  const composite = createCompositeAlertPort([new ThrowingAlertPort(), uiPort], logger);

  const change: ChannelStateChange = { channelId: 'chan-1', displayState: 'critical', timestamp: '2026-09-06T00:00:00.000Z' };
  assert.doesNotThrow(() => composite.publishStateChange(change));

  assert.deepEqual(uiPort.changes, [change], 'nhánh KHÔNG throw phải vẫn nhận đúng change dù nhánh kia throw TRƯỚC nó');
  assert.ok(logger.events.some((e) => e.event_type === 'alert_publish_error'), 'lỗi của nhánh throw phải được log lại');
});

test('createCompositeAlertPort: nhánh throw đứng SAU trong danh sách -> nhánh đứng trước vẫn đã nhận change trước đó (không rollback)', () => {
  const logPort = new FakeAlertPort();
  const logger = new FakeLogger();
  const composite = createCompositeAlertPort([logPort, new ThrowingAlertPort()], logger);

  const change: ChannelStateChange = { channelId: 'chan-1', displayState: 'ok', timestamp: '2026-09-06T00:00:00.000Z' };
  assert.doesNotThrow(() => composite.publishStateChange(change));

  assert.deepEqual(logPort.changes, [change]);
});

// Code review [patch #7]: CẢ 2 nhánh đều throw -> 2 lỗi phải được log RIÊNG
// BIỆT (mỗi nhánh 1 entry `alert_publish_error`, đúng port[index] của mình),
// và không có lỗi nào thoát ra ngoài publishStateChange().
test('createCompositeAlertPort: CẢ 2 port đều throw -> 2 lỗi được log riêng biệt, KHÔNG throw ra ngoài', () => {
  const logger = new FakeLogger();
  const composite = createCompositeAlertPort([new ThrowingAlertPort(), new ThrowingAlertPort()], logger);

  const change: ChannelStateChange = { channelId: 'chan-1', displayState: 'critical', timestamp: '2026-09-06T00:00:00.000Z' };
  assert.doesNotThrow(() => composite.publishStateChange(change));

  const errorEvents = logger.events.filter((e) => e.event_type === 'alert_publish_error');
  assert.equal(errorEvents.length, 2, 'mỗi port throw phải được log đúng 1 lần, không gộp/không mất');
  assert.ok(errorEvents.some((e) => e.reason?.includes('port[0]')));
  assert.ok(errorEvents.some((e) => e.reason?.includes('port[1]')));
});

// Code review [patch #8]: mảng ports RỖNG -> no-op, không throw, không log gì.
test('createCompositeAlertPort: ports rỗng ([]) -> publishStateChange no-op, KHÔNG throw, KHÔNG log', () => {
  const logger = new FakeLogger();
  const composite = createCompositeAlertPort([], logger);

  const change: ChannelStateChange = { channelId: 'chan-1', displayState: 'ok', timestamp: '2026-09-06T00:00:00.000Z' };
  assert.doesNotThrow(() => composite.publishStateChange(change));
  assert.equal(logger.events.length, 0);
});

// Code review [patch #6]: integration test THẬT - start `startApp()` không
// fake, verify đúng DÒNG WIRING `createCompositeAlertPort([logAlertPort, ui],
// logger)` tại composition root (không chỉ `createCompositeAlertPort` bằng
// fakes như các test phía trên - nếu dòng wiring thật này bị revert/đổi thứ
// tự tham số sai, mọi test hiện có vẫn pass mà không phát hiện được, đây là
// gap cần lấp). `debounceMs: 10` (override mới, patch #5) để không phải chờ
// 5s thật - gửi CÙNG 1 candidate 2 lần, cách nhau đủ lâu hơn debounceMs, để
// `channelState.ts` chốt candidate và gọi `alertPort.publishStateChange`.
//
// Code review [patch #9]: trước đây test này chỉ verify nhánh WS UI của
// composite (`ui`) qua client `ws` thật, KHÔNG verify nhánh `logAlertPort`
// (audit log, AC #3: "LogAlertAdapter vẫn ghi như trước") qua đúng dòng wiring
// thật `main.ts:263` - nếu dòng đó bị sửa nhầm bớt `logAlertPort` khỏi mảng,
// không test nào phát hiện được (mọi test khác dùng fakes, không chạm dòng
// wiring thật này). `logger` override mới (`startApp`'s config) cho phép bơm
// `FakeLogger` để quan sát trực tiếp `alert_state_change` do `LogAlertAdapter`
// ghi - đóng gap verification mà không đổi hành vi production (logger mặc
// định vẫn `defaultLogger()` khi omit).
test('startApp(): wiring thật composite alertPort -> backend chốt trạng thái mới qua telemetry WS thật -> WS UI client thật nhận đúng channel-state-change broadcast, ĐỒNG THỜI LogAlertAdapter vẫn ghi audit log (AC #3, không hồi quy Story 2.1)', async () => {
  const { dir, filePath } = writeValidRegistryFile(); // chan-1, baseline_kbps=4000, grid_position=0
  const logger = new FakeLogger();
  const app = await startApp({
    port: 0,
    host: '127.0.0.1',
    uiPort: 0,
    uiHost: '127.0.0.1',
    validBearerTokens: new Set(['test-token']),
    channelRegistryFilePath: filePath,
    debounceMs: 10,
    logger,
  });

  try {
    // WS UI client THẬT tới app.ui.port - nhận registry-snapshot/channel-seen/
    // channel-state-change (mirror connectUiWsClient phía frontend, nhưng ở
    // đây dùng thẳng thư viện `ws` như các test wsUiAdapter.test.ts khác).
    const uiWs = new WebSocket(`ws://127.0.0.1:${app.ui.port}`);
    const uiMessages: { type: string; channel_id?: string; display_state?: string }[] = [];
    uiWs.on('message', (data) => {
      uiMessages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      uiWs.once('open', resolve);
      uiWs.once('error', reject);
    });
    await waitUntil(() => uiMessages.some((m) => m.type === 'registry-snapshot'));

    // WS telemetry client THẬT tới app.ws.port (bearer token hợp lệ) - gửi
    // telemetry CONNECTED + bitrate_kbps=4000 (=100% của baseline 4000 ->
    // candidate 'ok') 2 LẦN, cách nhau > debounceMs (10ms), để applyCandidate()
    // chốt trạng thái (lần 1 chỉ set pending, lần 2 mới đủ ổn định để commit).
    const telemetryWs = new WebSocket(`ws://127.0.0.1:${app.ws.port}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await new Promise<void>((resolve, reject) => {
      telemetryWs.once('open', resolve);
      telemetryWs.once('error', reject);
    });

    const sendTelemetry = () =>
      telemetryWs.send(
        JSON.stringify({
          schema_version: 1,
          channel_id: 'chan-1',
          timestamp: new Date().toISOString(),
          event_type: 'telemetry',
          payload: { bitrate_kbps: 4000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [-20, -18] },
        })
      );

    sendTelemetry();
    await new Promise((resolve) => setTimeout(resolve, 50)); // > debounceMs=10ms
    sendTelemetry();

    await waitUntil(() => uiMessages.some((m) => m.type === 'channel-state-change'));
    const stateChange = uiMessages.find((m) => m.type === 'channel-state-change');
    assert.equal(stateChange?.channel_id, 'chan-1');
    assert.equal(stateChange?.display_state, 'ok');

    // Code review [patch #9]: nhánh `logAlertPort` của ĐÚNG composite thật ở
    // `main.ts:263` - nếu dòng wiring đó chỉ còn `[ui]` (bớt logAlertPort),
    // `channel-state-change` phía trên vẫn broadcast bình thường (giả finding
    // này pass) nhưng assertion dưới đây sẽ fail, đúng gap cần lấp.
    const auditEvent = logger.events.find((e) => e.event_type === 'alert_state_change');
    assert.ok(auditEvent, 'LogAlertAdapter phải nhận publishStateChange qua đúng dòng wiring composite thật, không chỉ nhánh WS UI');
    assert.equal(auditEvent?.channel_id, 'chan-1');
    assert.ok(auditEvent?.reason?.includes('display_state=ok'));

    telemetryWs.close();
    uiWs.close();
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Code review [patch #10]: `debounceMs`/`clock` (override test-only, patch #5)
// chỉ có comment khẳng định "KHÔNG đổi behavior mặc định production" khi
// omit, không có test nào bảo vệ khẳng định đó - nếu 1 refactor tương lai vô
// tình đổi `config?.debounceMs ?? ...` thành 1 giá trị mặc định khác 5000ms
// thật (hoặc luôn truyền 1 số nhỏ), test này phải fail. Không chờ đủ 5s thật -
// chỉ cần verify debounce KHÔNG NGẮN bất thường: gửi cùng 1 candidate 2 lần
// cách nhau rất ngắn (50ms, << 5000ms) rồi đợi thêm 1 khoảng ngắn (200ms) -
// nếu default vẫn đúng 5000ms, `channel-state-change` CHƯA thể xuất hiện.
test('startApp(): omit debounceMs/clock trong config -> vẫn dùng default debounceMs=5000ms thật (KHÔNG bị rút ngắn ngoài ý muốn)', async () => {
  const { dir, filePath } = writeValidRegistryFile();
  const app = await startApp({
    port: 0,
    host: '127.0.0.1',
    uiPort: 0,
    uiHost: '127.0.0.1',
    validBearerTokens: new Set(['test-token']),
    channelRegistryFilePath: filePath,
    // debounceMs/clock KHÔNG truyền - đúng kịch bản production thật.
  });

  try {
    const uiWs = new WebSocket(`ws://127.0.0.1:${app.ui.port}`);
    const uiMessages: { type: string }[] = [];
    uiWs.on('message', (data) => {
      uiMessages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      uiWs.once('open', resolve);
      uiWs.once('error', reject);
    });
    await waitUntil(() => uiMessages.some((m) => m.type === 'registry-snapshot'));

    const telemetryWs = new WebSocket(`ws://127.0.0.1:${app.ws.port}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await new Promise<void>((resolve, reject) => {
      telemetryWs.once('open', resolve);
      telemetryWs.once('error', reject);
    });

    const sendTelemetry = () =>
      telemetryWs.send(
        JSON.stringify({
          schema_version: 1,
          channel_id: 'chan-1',
          timestamp: new Date().toISOString(),
          event_type: 'telemetry',
          payload: { bitrate_kbps: 4000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [-20, -18] },
        })
      );

    sendTelemetry();
    await new Promise((resolve) => setTimeout(resolve, 50));
    sendTelemetry();
    await new Promise((resolve) => setTimeout(resolve, 200)); // << 5000ms mặc định thật

    assert.ok(
      !uiMessages.some((m) => m.type === 'channel-state-change'),
      'default debounceMs phải ~5000ms thật (không bị rút ngắn) - 250ms tổng cộng không đủ để commit'
    );

    telemetryWs.close();
    uiWs.close();
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startApp(): uiHost mặc định fallback về host khi config không set uiHost (không phải luôn 0.0.0.0)', async () => {
  const { dir, filePath } = writeValidRegistryFile();
  // 127.0.0.2 là 1 loopback alias hợp lệ (127.0.0.0/8), khác 127.0.0.1 - dùng
  // làm `host` để phân biệt thật: nếu uiHost fallback SAI (vd luôn '0.0.0.0'
  // hoặc undefined -> OS default), connect qua 127.0.0.1 vẫn sẽ thành công
  // (0.0.0.0 nhận mọi interface) NÊN không phân biệt được đúng/sai. Ở đây
  // dùng chính 127.0.0.2 để verify: nếu uiHost fallback ĐÚNG (bind CHÍNH XÁC
  // vào 127.0.0.2, không phải 0.0.0.0), verify bằng cách connect thành công
  // tới 127.0.0.2:port.
  try {
    const app = await startApp({
      port: 0,
      host: '127.0.0.2',
      uiPort: 0,
      // uiHost KHÔNG set - phải fallback đúng về host ('127.0.0.2').
      validBearerTokens: new Set(['test-token']),
      channelRegistryFilePath: filePath,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.2:${app.ui.port}`);
        ws.once('open', () => {
          ws.close();
          resolve();
        });
        ws.once('error', reject);
      });
    } finally {
      await app.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Story 2.7: wiring thật của `heartbeatPort`/timer `checkHeartbeatTimeouts()`
// tại composition root (Code Map: "main.ts:275-282,318-323 -- wire
// channelStateService làm heartbeatPort; thêm setInterval(...) 1000ms"). Dùng
// `FakeClock` (config override có sẵn) để không phải chờ đủ 15000ms thật -
// timer setInterval THẬT (1000ms wall-clock) vẫn tự chạy độc lập và gọi
// `checkHeartbeatTimeouts()` bằng đúng FakeClock này, nên chỉ cần advance()
// clock qua ngưỡng rồi đợi vài trăm ms/vài giây wall-clock cho tick kế tiếp.
test('startApp(): wiring thật heartbeatPort + timer 1000ms -> heartbeat WS thật im lặng đủ HEARTBEAT_TIMEOUT_MS (FakeClock) -> WS UI client thật nhận channel-state-change machine-offline', async () => {
  const { dir, filePath } = writeValidRegistryFile(); // chan-1, grid_position=0
  const clock = new FakeClock();
  const app = await startApp({
    port: 0,
    host: '127.0.0.1',
    uiPort: 0,
    uiHost: '127.0.0.1',
    validBearerTokens: new Set(['test-token']),
    channelRegistryFilePath: filePath,
    clock,
  });

  try {
    const uiWs = new WebSocket(`ws://127.0.0.1:${app.ui.port}`);
    const uiMessages: { type: string; channel_id?: string; display_state?: string; sub_type?: string }[] = [];
    uiWs.on('message', (data) => {
      uiMessages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      uiWs.once('open', resolve);
      uiWs.once('error', reject);
    });
    await waitUntil(() => uiMessages.some((m) => m.type === 'registry-snapshot'));

    const telemetryWs = new WebSocket(`ws://127.0.0.1:${app.ws.port}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await new Promise<void>((resolve, reject) => {
      telemetryWs.once('open', resolve);
      telemetryWs.once('error', reject);
    });

    telemetryWs.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-1',
        timestamp: new Date().toISOString(),
        event_type: 'heartbeat',
        payload: {},
      })
    );
    // Đợi ngắn để chắc chắn heartbeat đã được xử lý (lastHeartbeatAt ghi
    // nhận) TRƯỚC khi advance() clock - tránh race hiếm giữa gửi WS message
    // (async network) và bước advance() ngay sau đây.
    await new Promise((resolve) => setTimeout(resolve, 100));

    clock.advance(16000); // > HEARTBEAT_TIMEOUT_MS (15000)

    await waitUntil(
      () => uiMessages.some((m) => m.type === 'channel-state-change' && m.sub_type === 'machine-offline'),
      5000
    );
    const machineOfflineMsg = uiMessages.find(
      (m) => m.type === 'channel-state-change' && m.sub_type === 'machine-offline'
    );
    assert.equal(machineOfflineMsg?.channel_id, 'chan-1');
    assert.equal(machineOfflineMsg?.display_state, 'critical');

    telemetryWs.close();
    uiWs.close();
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Code review [verification gap]: `startApp()` tạo `bitrateHistoryService`
// thật và wiring vào `ChannelStateService` làm `historyPort`, nhưng object trả
// về trước đây không expose gì để test quan sát nó - 1 người lỡ tay thay
// `historyPort: bitrateHistoryService` bằng 1 stub rỗng vẫn compile sạch và
// mọi test khác trong file này vẫn xanh. Mirror ĐÚNG pattern của test
// 'startApp(): wiring thật composite alertPort -> ...' ở trên (dùng `startApp()`
// thật + gửi WS telemetry thật) - gửi telemetry hợp lệ cho 1 channel_id đã
// đăng ký rồi assert `app.bitrateHistoryService.getHistory(channelId)` trả về
// đúng điểm dữ liệu mong đợi.
test('startApp(): wiring thật bitrateHistoryService -> telemetry WS thật ghi vào ring buffer, app.bitrateHistoryService.getHistory() trả đúng điểm dữ liệu', async () => {
  const { dir, filePath } = writeValidRegistryFile(); // chan-1, baseline_kbps=4000, grid_position=0
  const app = await startApp({
    port: 0,
    host: '127.0.0.1',
    uiPort: 0,
    uiHost: '127.0.0.1',
    validBearerTokens: new Set(['test-token']),
    channelRegistryFilePath: filePath,
  });

  try {
    const uiWs = new WebSocket(`ws://127.0.0.1:${app.ui.port}`);
    const uiMessages: { type: string }[] = [];
    uiWs.on('message', (data) => {
      uiMessages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      uiWs.once('open', resolve);
      uiWs.once('error', reject);
    });
    await waitUntil(() => uiMessages.some((m) => m.type === 'registry-snapshot'));

    const telemetryWs = new WebSocket(`ws://127.0.0.1:${app.ws.port}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await new Promise<void>((resolve, reject) => {
      telemetryWs.once('open', resolve);
      telemetryWs.once('error', reject);
    });

    // bitrate_kbps=4000 / baseline_kbps=4000 -> bitrate_pct=100. `recordBitrate`
    // chạy NGAY mỗi telemetry hợp lệ, ĐỘC LẬP debounce - 1 lần gửi là đủ.
    telemetryWs.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-1',
        timestamp: new Date().toISOString(),
        event_type: 'telemetry',
        payload: { bitrate_kbps: 4000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [-20, -18] },
      })
    );

    await waitUntil(() => uiMessages.some((m) => m.type === 'channel-seen'));

    const result = app.bitrateHistoryService.getHistory('chan-1');
    assert.equal(
      result.state,
      'loaded',
      'nếu wiring bị thay bằng 1 stub rỗng, getHistory() vẫn trả no-history-data - test này phải fail'
    );
    if (result.state === 'loaded') {
      assert.ok(result.data.length >= 1);
      assert.equal(result.data[0]?.bitratePct, 100);
    }

    telemetryWs.close();
    uiWs.close();
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Story 3.2 (Code Map): `app/main.ts` phải truyền `historyPort: bitrateHistoryService`
// vào `startWsUiAdapter(...)` - test integration THẬT (mirror test phía trên)
// xác nhận WS UI client thật nhận đúng `channel-history-snapshot` phản ánh
// dữ liệu ĐÃ ghi vào ring buffer qua telemetry WS thật (nếu wiring bị lỡ tay
// bỏ `historyPort`, wsUiAdapter.ts sẽ throw ngay lúc khởi động vì field này
// bắt buộc trong `WsUiAdapterOptions` - nhưng test này còn xác nhận đúng
// NỘI DUNG dữ liệu trả về khớp ring buffer thật, không chỉ compile được).
test('startApp(): wiring thật historyPort vào startWsUiAdapter -> WS UI client thật nhận channel-history-snapshot state=loaded phản ánh đúng ring buffer sau telemetry', async () => {
  const { dir, filePath } = writeValidRegistryFile(); // chan-1, baseline_kbps=4000, grid_position=0
  const app = await startApp({
    port: 0,
    host: '127.0.0.1',
    uiPort: 0,
    uiHost: '127.0.0.1',
    validBearerTokens: new Set(['test-token']),
    channelRegistryFilePath: filePath,
  });

  try {
    const telemetryWs = new WebSocket(`ws://127.0.0.1:${app.ws.port}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await new Promise<void>((resolve, reject) => {
      telemetryWs.once('open', resolve);
      telemetryWs.once('error', reject);
    });

    // Ghi 1 mẫu vào ring buffer TRƯỚC KHI WS UI client connect - xác nhận
    // channel-history-snapshot lúc connect phản ánh đúng dữ liệu ĐÃ có (không
    // chỉ channel-history-point broadcast realtime sau đó).
    telemetryWs.send(
      JSON.stringify({
        schema_version: 1,
        channel_id: 'chan-1',
        timestamp: new Date().toISOString(),
        event_type: 'telemetry',
        payload: { bitrate_kbps: 4000, rtt_ms: 10, connection_state: 'CONNECTED', audio_level: [-20, -18] },
      })
    );
    await waitUntil(() => app.bitrateHistoryService.getHistory('chan-1').state === 'loaded');

    const uiWs = new WebSocket(`ws://127.0.0.1:${app.ui.port}`);
    const uiMessages: { type: string; channel_id?: string; state?: string; points?: unknown[] }[] = [];
    uiWs.on('message', (data) => {
      uiMessages.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      uiWs.once('open', resolve);
      uiWs.once('error', reject);
    });

    await waitUntil(() => uiMessages.some((m) => m.type === 'channel-history-snapshot'));
    const historySnapshot = uiMessages.find((m) => m.type === 'channel-history-snapshot');
    assert.equal(historySnapshot?.channel_id, 'chan-1');
    assert.equal(historySnapshot?.state, 'loaded');
    assert.equal((historySnapshot?.points as { bitrate_pct: number }[] | undefined)?.[0]?.bitrate_pct, 100);

    telemetryWs.close();
    uiWs.close();
  } finally {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
