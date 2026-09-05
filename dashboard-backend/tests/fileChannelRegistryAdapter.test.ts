// Story 2.2: `FileChannelRegistryAdapter` là adapter đọc channel-registry
// THẬT DUY NHẤT chạy production (thay `FileBitrateBaselineAdapter` của Story
// 2.1) - test qua 1 file JSON thật ghi ra `node:os.tmpdir()` (mirror
// `fileBitrateBaselineAdapter.test.ts` cũ), dọn dẹp sau mỗi test.
//
// Boundaries: "test hot-reload ... trigger reload qua gọi trực tiếp method
// internal thay vì chờ debounce thật (tránh flaky theo thời gian)" - các test
// reload thành công/thất bại gọi thẳng `adapter.reload()`, không qua
// `start()`/watcher/debounce timer thật. Debounce coalescing (I/O matrix
// "nhiều fs event dồn dập -> chỉ 1 lần reload thực sự") vẫn được test qua
// `start()` thật, nhưng dùng `debounceMs` nhỏ (option test-only) để không
// phải chờ >=300ms thật.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { FileChannelRegistryAdapter } from '../src/adapters/outbound/fileChannelRegistryAdapter.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    station_name: 'Đài Thí Nghiệm 01',
    contact_name: 'Nguyễn Văn A',
    contact_phone: '0900000001',
    grid_position: 0,
    baseline_kbps: 4000,
    ...overrides,
  };
}

function writeTempRegistryFile(content: string): { filePath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'dashboard-backend-registry-test-'));
  const filePath = path.join(dir, 'channel-registry.json');
  writeFileSync(filePath, content, 'utf8');
  return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- Khởi động: load + validate ---

test('file registry hợp lệ -> getEntry trả đúng record đầy đủ (camelCase) theo từng channel_id', () => {
  const { filePath, cleanup } = writeTempRegistryFile(
    JSON.stringify({
      'chan-a': validEntry({ grid_position: 0, baseline_kbps: 4000 }),
      'chan-b': validEntry({ station_name: 'Đài B', grid_position: 1, baseline_kbps: 3500.5 }),
    })
  );
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    assert.deepEqual(adapter.getEntry('chan-a'), {
      stationName: 'Đài Thí Nghiệm 01',
      contactName: 'Nguyễn Văn A',
      contactPhone: '0900000001',
      gridPosition: 0,
      baselineKbps: 4000,
    });
    assert.equal(adapter.getEntry('chan-b')?.stationName, 'Đài B');
    assert.equal(adapter.getEntry('chan-b')?.baselineKbps, 3500.5);
  } finally {
    cleanup();
  }
});

// Story 2.3: `listEntries()` - nguồn dữ liệu DUY NHẤT cho `registry-snapshot`.
test('listEntries(): trả về TOÀN BỘ kênh trong registry, mỗi entry kèm channelId', () => {
  const { filePath, cleanup } = writeTempRegistryFile(
    JSON.stringify({
      'chan-a': validEntry({ grid_position: 0 }),
      'chan-b': validEntry({ station_name: 'Đài B', grid_position: 1 }),
    })
  );
  try {
    const adapter = new FileChannelRegistryAdapter(filePath, new FakeLogger());
    const entries = adapter.listEntries();
    assert.equal(entries.length, 2);
    const byId = new Map(entries.map((e) => [e.channelId, e]));
    assert.deepEqual(byId.get('chan-a'), {
      channelId: 'chan-a',
      stationName: 'Đài Thí Nghiệm 01',
      contactName: 'Nguyễn Văn A',
      contactPhone: '0900000001',
      gridPosition: 0,
      baselineKbps: 4000,
    });
    assert.equal(byId.get('chan-b')?.stationName, 'Đài B');
  } finally {
    cleanup();
  }
});

test('listEntries(): sau reload() thành công -> phản ánh đúng nội dung mới (hoán đổi Map)', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const adapter = new FileChannelRegistryAdapter(filePath, new FakeLogger());
    assert.equal(adapter.listEntries().length, 1);

    writeFileSync(
      filePath,
      JSON.stringify({
        'chan-a': validEntry({ grid_position: 0 }),
        'chan-b': validEntry({ grid_position: 1 }),
      }),
      'utf8'
    );
    adapter.reload();

    assert.equal(adapter.listEntries().length, 2);
  } finally {
    cleanup();
  }
});

test('channel_id không có trong file -> getEntry trả undefined (không throw, không fallback)', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry() }));
  try {
    const adapter = new FileChannelRegistryAdapter(filePath, new FakeLogger());
    assert.equal(adapter.getEntry('chan-khong-ton-tai'), undefined);
  } finally {
    cleanup();
  }
});

test('file không phải JSON hợp lệ -> throw ngay lúc khởi tạo', () => {
  const { filePath, cleanup } = writeTempRegistryFile('{not-valid-json');
  try {
    assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /không phải JSON hợp lệ/);
  } finally {
    cleanup();
  }
});

test('JSON hợp lệ nhưng không phải object (vd mảng) -> throw', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify([1, 2, 3]));
  try {
    assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /phải là 1 JSON object/);
  } finally {
    cleanup();
  }
});

test('file registry rỗng ({}, 0 kênh) -> throw ngay lúc khởi tạo (AC#1: phải có >=1 kênh hợp lệ)', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({}));
  try {
    assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /không có kênh nào/);
  } finally {
    cleanup();
  }
});

test('entry không phải object -> throw, nêu rõ channel_id sai', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': 'khong-phai-object' }));
  try {
    assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /chan-a/);
  } finally {
    cleanup();
  }
});

test('thiếu/rỗng 1 trong 3 field string (station_name/contact_name/contact_phone) -> throw', () => {
  const casesInvalid = [
    validEntry({ station_name: '' }),
    validEntry({ station_name: undefined }),
    validEntry({ contact_name: '' }),
    validEntry({ contact_phone: '' }),
    validEntry({ contact_phone: 123 }),
  ];
  for (const invalid of casesInvalid) {
    const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': invalid }));
    try {
      assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /chan-a/);
    } finally {
      cleanup();
    }
  }
});

test('grid_position không hợp lệ (ngoài 0-19, không nguyên, thiếu) -> throw', () => {
  const casesInvalid = [
    validEntry({ grid_position: -1 }),
    validEntry({ grid_position: 20 }),
    validEntry({ grid_position: 1.5 }),
    validEntry({ grid_position: '0' }),
    validEntry({ grid_position: undefined }),
  ];
  for (const invalid of casesInvalid) {
    const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': invalid }));
    try {
      assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /grid_position/);
    } finally {
      cleanup();
    }
  }
});

test('grid_position trùng giữa 2 kênh trong cùng file -> throw (toàn bộ file bị từ chối)', () => {
  const { filePath, cleanup } = writeTempRegistryFile(
    JSON.stringify({
      'chan-a': validEntry({ grid_position: 5 }),
      'chan-b': validEntry({ grid_position: 5 }),
    })
  );
  try {
    assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /trùng/);
  } finally {
    cleanup();
  }
});

test('baseline_kbps không phải số dương -> throw, nêu rõ channel_id sai', () => {
  const casesInvalid = [
    validEntry({ baseline_kbps: 'khong-phai-so' }),
    validEntry({ baseline_kbps: 0 }),
    validEntry({ baseline_kbps: -100 }),
    validEntry({ baseline_kbps: null }),
  ];
  for (const invalid of casesInvalid) {
    const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': invalid }));
    try {
      assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /chan-a/);
    } finally {
      cleanup();
    }
  }
});

test('file không tồn tại -> throw (ENOENT lan lên rõ ràng, không nuốt lỗi)', () => {
  assert.throws(
    () => new FileChannelRegistryAdapter(path.join(tmpdir(), 'khong-ton-tai-' + Date.now() + '.json'), new FakeLogger())
  );
});

// Code review [patch, vòng 2]: file lưu bằng Notepad trên Windows (môi
// trường triển khai thực tế) thường có BOM UTF-8 (`﻿`) ở đầu file -
// trước patch, `JSON.parse` throw ngay dù nội dung JSON phía sau hợp lệ.
// Verify cả 2 đường load dùng chung `loadAndValidate()`: khởi động (constructor)
// và reload() (hot-reload).
test('file registry có BOM UTF-8 ở đầu -> vẫn load được bình thường lúc khởi động (Notepad trên Windows)', () => {
  const { filePath, cleanup } = writeTempRegistryFile('﻿' + JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const adapter = new FileChannelRegistryAdapter(filePath, new FakeLogger());
    assert.deepEqual(adapter.getEntry('chan-a'), {
      stationName: 'Đài Thí Nghiệm 01',
      contactName: 'Nguyễn Văn A',
      contactPhone: '0900000001',
      gridPosition: 0,
      baselineKbps: 4000,
    });
  } finally {
    cleanup();
  }
});

test('reload(): file mới có BOM UTF-8 ở đầu -> vẫn reload thành công, không rơi vào registry_reload_error', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    writeFileSync(filePath, '﻿' + JSON.stringify({ 'chan-a': validEntry({ grid_position: 0, station_name: 'Đài Sau Reload' }) }), 'utf8');
    adapter.reload();
    assert.equal(adapter.getEntry('chan-a')?.stationName, 'Đài Sau Reload');
    assert.ok(
      logger.events.some((e) => e.event_type === 'registry_reload_success'),
      'phải log registry_reload_success, không phải registry_reload_error'
    );
  } finally {
    cleanup();
  }
});

// --- Hot-reload (gọi trực tiếp reload(), không chờ debounce thật) ---

test('reload(): nội dung mới hợp lệ -> hoán đổi Map, getEntry phản ánh dữ liệu mới, log registry_reload_success', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    assert.equal(adapter.getEntry('chan-b'), undefined);

    writeFileSync(
      filePath,
      JSON.stringify({
        'chan-a': validEntry({ grid_position: 0 }),
        'chan-b': validEntry({ station_name: 'Đài B mới', grid_position: 1 }),
      }),
      'utf8'
    );
    adapter.reload();

    assert.equal(adapter.getEntry('chan-b')?.stationName, 'Đài B mới');
    const successEvents = logger.events.filter((e) => e.event_type === 'registry_reload_success');
    assert.equal(successEvents.length, 1);
    assert.equal(successEvents[0]?.channel_id, '');
    assert.equal(successEvents[0]?.reason, '2');
  } finally {
    cleanup();
  }
});

test('reload(): nội dung mới lỗi (JSON hỏng) -> GIỮ NGUYÊN registry cũ, log registry_reload_error, không throw', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    const before = adapter.getEntry('chan-a');

    writeFileSync(filePath, '{not-valid-json', 'utf8');
    assert.doesNotThrow(() => adapter.reload());

    assert.deepEqual(adapter.getEntry('chan-a'), before, 'registry cũ phải giữ nguyên nguyên vẹn');
    const errorEvents = logger.events.filter((e) => e.event_type === 'registry_reload_error');
    assert.equal(errorEvents.length, 1);
    assert.equal(errorEvents[0]?.channel_id, '');
    assert.ok(errorEvents[0]?.reason?.includes(filePath), 'reason phải nêu rõ đường dẫn file');
  } finally {
    cleanup();
  }
});

test('reload(): nội dung mới thiếu field/trùng grid_position -> GIỮ NGUYÊN registry cũ, log registry_reload_error', () => {
  const { filePath, cleanup } = writeTempRegistryFile(
    JSON.stringify({
      'chan-a': validEntry({ grid_position: 0 }),
      'chan-b': validEntry({ grid_position: 1 }),
    })
  );
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    const beforeA = adapter.getEntry('chan-a');
    const beforeB = adapter.getEntry('chan-b');

    // grid_position trùng nhau ở nội dung mới -> phải bị từ chối toàn bộ.
    writeFileSync(
      filePath,
      JSON.stringify({
        'chan-a': validEntry({ grid_position: 5 }),
        'chan-b': validEntry({ grid_position: 5 }),
      }),
      'utf8'
    );
    adapter.reload();

    assert.deepEqual(adapter.getEntry('chan-a'), beforeA);
    assert.deepEqual(adapter.getEntry('chan-b'), beforeB);
    assert.equal(logger.events.filter((e) => e.event_type === 'registry_reload_error').length, 1);
    assert.equal(logger.events.filter((e) => e.event_type === 'registry_reload_success').length, 0);
  } finally {
    cleanup();
  }
});

test('reload(): nội dung mới rỗng ({}, 0 kênh) -> GIỮ NGUYÊN registry cũ, log registry_reload_error, không throw', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    const before = adapter.getEntry('chan-a');

    writeFileSync(filePath, JSON.stringify({}), 'utf8');
    assert.doesNotThrow(() => adapter.reload());

    assert.deepEqual(adapter.getEntry('chan-a'), before, 'registry cũ (>=1 kênh) phải giữ nguyên, không bị xoá sạch');
    const errorEvents = logger.events.filter((e) => e.event_type === 'registry_reload_error');
    assert.equal(errorEvents.length, 1);
    assert.ok(errorEvents[0]?.reason?.includes('không có kênh nào'));
    assert.equal(logger.events.filter((e) => e.event_type === 'registry_reload_success').length, 0);
  } finally {
    cleanup();
  }
});

test('reload(): file bị xoá hẳn giữa lúc đang chạy (ENOENT) -> GIỮ NGUYÊN registry cũ, log registry_reload_error, không throw', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    const before = adapter.getEntry('chan-a');

    rmSync(filePath);
    assert.doesNotThrow(() => adapter.reload());

    assert.deepEqual(adapter.getEntry('chan-a'), before, 'registry cũ phải giữ nguyên khi file bị xoá');
    const errorEvents = logger.events.filter((e) => e.event_type === 'registry_reload_error');
    assert.equal(errorEvents.length, 1);
    assert.equal(logger.events.filter((e) => e.event_type === 'registry_reload_success').length, 0);
  } finally {
    cleanup();
  }
});

// Code review [patch]: channel_id trùng lặp trong JSON bị JSON.parse âm thầm
// ghi đè - phải bị từ chối tường minh (findDuplicateTopLevelKey).
test('channel_id trùng lặp trong cùng file (JSON.parse âm thầm ghi đè) -> throw, nêu rõ channel_id trùng', () => {
  const { filePath, cleanup } = writeTempRegistryFile(
    '{"chan-a": ' + JSON.stringify(validEntry({ grid_position: 0 })) + ', "chan-a": ' + JSON.stringify(validEntry({ grid_position: 1 })) + '}'
  );
  try {
    assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /chan-a.*xuất hiện nhiều hơn 1 lần/);
  } finally {
    cleanup();
  }
});

// Code review [patch]: chuỗi toàn khoảng trắng không còn được coi là
// "non-empty" hợp lệ.
test('station_name/contact_name/contact_phone toàn khoảng trắng -> throw (không còn coi là non-empty hợp lệ)', () => {
  const casesInvalid = [
    validEntry({ station_name: '   ' }),
    validEntry({ contact_name: '   ' }),
    validEntry({ contact_phone: '   ' }),
  ];
  for (const invalid of casesInvalid) {
    const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': invalid }));
    try {
      assert.throws(() => new FileChannelRegistryAdapter(filePath, new FakeLogger()), /chan-a/);
    } finally {
      cleanup();
    }
  }
});

test('reload() nhiều lần liên tiếp, lần cuối hợp lệ -> chỉ giữ kết quả lần reload hợp lệ gần nhất, mỗi lần đều log đúng loại event', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);

    writeFileSync(filePath, '{broken', 'utf8');
    adapter.reload(); // lỗi -> giữ nguyên

    writeFileSync(filePath, JSON.stringify({ 'chan-a': validEntry({ station_name: 'Đài mới', grid_position: 0 }) }), 'utf8');
    adapter.reload(); // hợp lệ -> áp dụng

    assert.equal(adapter.getEntry('chan-a')?.stationName, 'Đài mới');
    assert.equal(logger.events.filter((e) => e.event_type === 'registry_reload_error').length, 1);
    assert.equal(logger.events.filter((e) => e.event_type === 'registry_reload_success').length, 1);
  } finally {
    cleanup();
  }
});

// --- Debounce coalescing (I/O matrix: "nhiều fs event dồn dập -> chỉ 1 lần
// reload thực sự áp dụng") - dùng start() thật + debounceMs nhỏ (test-only)
// để không phải chờ >=300ms production. ---

test('start(): nhiều lần ghi file dồn dập trong khoảng debounce -> chỉ 1 lần reload thực sự áp dụng', async () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger, { debounceMs: 50 });
    adapter.start();
    try {
      // 3 lần ghi liên tiếp, mỗi lần cách nhau ít hơn debounceMs - editor/`fs`
      // thật cũng có thể bắn nhiều fs event cho 1 lần lưu tương tự.
      writeFileSync(filePath, JSON.stringify({ 'chan-a': validEntry({ station_name: 'v1', grid_position: 0 }) }), 'utf8');
      await sleep(10);
      writeFileSync(filePath, JSON.stringify({ 'chan-a': validEntry({ station_name: 'v2', grid_position: 0 }) }), 'utf8');
      await sleep(10);
      writeFileSync(filePath, JSON.stringify({ 'chan-a': validEntry({ station_name: 'v3-final', grid_position: 0 }) }), 'utf8');

      // Chờ qua debounceMs + buffer để reload thực sự chạy (polling, không
      // sleep cố định 1 lần, để giảm flaky trên máy chậm).
      const deadline = Date.now() + 2000;
      while (
        logger.events.filter((e) => e.event_type === 'registry_reload_success').length === 0 &&
        Date.now() < deadline
      ) {
        await sleep(20);
      }
      // Buffer thêm 1 chu kỳ debounce để chắc chắn không còn reload nào khác
      // đang chờ coalesce phía sau.
      await sleep(100);

      assert.equal(
        logger.events.filter((e) => e.event_type === 'registry_reload_success').length,
        1,
        'chỉ đúng 1 lần reload thành công được áp dụng dù có nhiều fs event dồn dập'
      );
      assert.equal(adapter.getEntry('chan-a')?.stationName, 'v3-final');
    } finally {
      adapter.stop();
    }
  } finally {
    cleanup();
  }
});

// FSWatcher là EventEmitter - phát trực tiếp 'error' trên watcher thật (thay
// vì cố kích hoạt lỗi hệ thống thật, không đáng tin cậy/không cross-platform
// trong test) để xác nhận handler đã gắn trong start() hoạt động đúng, không
// phụ thuộc OS có thật sự bắn 'error' trong CI hay không.
test('start(): watcher phát "error" (lỗi hệ thống) -> log registry_watch_error, không throw ra ngoài, registry giữ nguyên', () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger);
    adapter.start();
    try {
      const watcher = (adapter as unknown as { watcher?: NodeJS.EventEmitter }).watcher;
      assert.ok(watcher, 'watcher phải tồn tại sau start()');
      assert.doesNotThrow(() => watcher!.emit('error', new Error('EPERM giả lập')));

      const watchErrorEvents = logger.events.filter((e) => e.event_type === 'registry_watch_error');
      assert.equal(watchErrorEvents.length, 1);
      assert.equal(watchErrorEvents[0]?.channel_id, '');
      assert.ok(watchErrorEvents[0]?.reason?.includes('EPERM giả lập'));
      assert.equal(adapter.getEntry('chan-a')?.gridPosition, 0, 'registry đang phục vụ không bị ảnh hưởng bởi lỗi watcher');
    } finally {
      adapter.stop();
    }
  } finally {
    cleanup();
  }
});

test('stop(): đóng watcher -> ghi file sau đó không còn kích hoạt reload nào nữa', async () => {
  const { filePath, cleanup } = writeTempRegistryFile(JSON.stringify({ 'chan-a': validEntry({ grid_position: 0 }) }));
  try {
    const logger = new FakeLogger();
    const adapter = new FileChannelRegistryAdapter(filePath, logger, { debounceMs: 30 });
    adapter.start();
    adapter.stop();

    writeFileSync(filePath, JSON.stringify({ 'chan-a': validEntry({ station_name: 'sau khi stop', grid_position: 0 }) }), 'utf8');
    await sleep(200);

    assert.equal(logger.events.filter((e) => e.event_type.startsWith('registry_reload')).length, 0);
    assert.equal(adapter.getEntry('chan-a')?.stationName, 'Đài Thí Nghiệm 01', 'không được reload sau stop()');
  } finally {
    cleanup();
  }
});
