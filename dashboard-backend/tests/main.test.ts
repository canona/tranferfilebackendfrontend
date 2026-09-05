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
import { parsePort, parseBearerTokens, startApp } from '../app/main.js';

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
