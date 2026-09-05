// Code review [test coverage]: `installService()`/`uninstallService()` chưa
// từng có test nào trước đây dù đây chính là nơi code review vòng trước bắt
// đúng 1 bug nghiêm trọng (patch #1: resolve sớm trước khi "NET START" thật
// sự thành công) - không có test nào sẽ chặn được regression nếu bug đó lặp
// lại. Test bằng 1 `Service` giả (EventEmitter, không đụng `node-windows`/
// SCM thật) qua `InstallServiceDeps`/`UninstallServiceDeps` injectable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Service as NodeWindowsService } from 'node-windows';
import { installService, uninstallService, type InstallServiceDeps, type UninstallServiceDeps } from '../app/installService.js';

// Timeout nhỏ cho test "không emit gì cả" - không cần chờ đúng 30s thật.
const SHORT_TIMEOUT_MS = 50;

class FakeService extends EventEmitter {
  installCalls = 0;
  uninstallCalls = 0;
  startCalls = 0;

  constructor(
    _config: unknown,
    private readonly behavior: {
      onInstall?: (svc: FakeService) => void;
      onUninstall?: (svc: FakeService) => void;
      onStart?: (svc: FakeService) => void;
    } = {}
  ) {
    super();
  }

  install(): void {
    this.installCalls++;
    this.behavior.onInstall?.(this);
  }
  uninstall(): void {
    this.uninstallCalls++;
    this.behavior.onUninstall?.(this);
  }
  start(): void {
    this.startCalls++;
    this.behavior.onStart?.(this);
  }
  stop(): void {}
  restart(): void {}
}

function makeInstallDeps(
  behavior: ConstructorParameters<typeof FakeService>[1],
  overrides: Partial<InstallServiceDeps> = {}
): InstallServiceDeps & { getFake: () => FakeService | undefined } {
  let fake: FakeService | undefined;
  const ServiceCtor = function (this: FakeService, config: unknown) {
    fake = new FakeService(config, behavior);
    return fake;
  } as unknown as typeof NodeWindowsService;

  return {
    loadService: async () => ({ Service: ServiceCtor }),
    assertBuilt: () => {},
    startTimeoutMs: SHORT_TIMEOUT_MS,
    ...overrides,
    getFake: () => fake,
  };
}

function makeUninstallDeps(
  behavior: ConstructorParameters<typeof FakeService>[1],
  overrides: Partial<UninstallServiceDeps> = {}
): UninstallServiceDeps {
  const ServiceCtor = function (this: FakeService, config: unknown) {
    return new FakeService(config, behavior);
  } as unknown as typeof NodeWindowsService;

  return {
    loadService: async () => ({ Service: ServiceCtor }),
    timeoutMs: SHORT_TIMEOUT_MS,
    ...overrides,
  };
}

test('installService: "install" rồi "start" -> resolve (đúng thứ tự, không resolve sớm khi mới "install")', async () => {
  let startEmittedBeforeResolve = false;
  const deps = makeInstallDeps({
    onInstall: (svc) => {
      // installService.ts's `svc.on('install', () => svc.start())` chỉ được
      // gắn SAU khi install() được gọi trong hàm đó - emit bất đồng bộ để
      // chắc chắn listener đã kịp gắn (mirror node-windows: 'install' luôn
      // fire bất đồng bộ, không bao giờ đồng bộ trong install()).
      setImmediate(() => svc.emit('install'));
    },
    onStart: (svc) => {
      setImmediate(() => {
        startEmittedBeforeResolve = true;
        svc.emit('start');
      });
    },
  });

  await installService(deps);
  assert.equal(startEmittedBeforeResolve, true, 'phải đợi sự kiện "start" thật sự fire trước khi resolve');
  assert.equal(deps.getFake()?.startCalls, 1, 'svc.start() phải được gọi sau khi "install" fire');
});

test('installService [regression patch #1]: "install" fire nhưng "start" KHÔNG BAO GIỜ fire -> timeout reject, KHÔNG resolve sớm', async () => {
  const deps = makeInstallDeps({
    onInstall: (svc) => setImmediate(() => svc.emit('install')),
    onStart: () => {
      // Cố ý không emit gì cả - mirror đúng nhánh lỗi thật của node-windows
      // mà patch #1 mô tả (chỉ log, không emit 'start' lẫn 'error').
    },
  });

  await assert.rejects(() => installService(deps), /không xác nhận sự kiện "start"/);
});

test('installService: "alreadyinstalled" -> resolve ngay, không cần "start"', async () => {
  const deps = makeInstallDeps({
    onInstall: (svc) => svc.emit('alreadyinstalled'),
  });
  await installService(deps);
});

test('installService: "error" trong lúc install -> reject với đúng lỗi đó', async () => {
  const boom = new Error('boom-install');
  const deps = makeInstallDeps({
    onInstall: (svc) => svc.emit('error', boom),
  });
  await assert.rejects(() => installService(deps), /boom-install/);
});

test('installService: assertBuilt() throw -> reject NGAY, không gọi loadService()/Service thật', async () => {
  let loadServiceCalled = false;
  const deps = makeInstallDeps(
    {},
    {
      assertBuilt: () => {
        throw new Error('main.js CHƯA được build');
      },
      loadService: async () => {
        loadServiceCalled = true;
        throw new Error('không được gọi tới đây');
      },
    }
  );

  await assert.rejects(() => installService(deps), /CHƯA được build/);
  assert.equal(loadServiceCalled, false, 'assertBuilt() throw phải chặn trước khi loadService() được gọi');
});

test('uninstallService: "uninstall" -> resolve', async () => {
  const deps = makeUninstallDeps({
    onUninstall: (svc) => svc.emit('uninstall'),
  });
  await uninstallService(deps);
});

test('uninstallService: "alreadyuninstalled" -> resolve', async () => {
  const deps = makeUninstallDeps({
    onUninstall: (svc) => svc.emit('alreadyuninstalled'),
  });
  await uninstallService(deps);
});

test('uninstallService: "error" -> reject với đúng lỗi', async () => {
  const boom = new Error('boom-uninstall');
  const deps = makeUninstallDeps({
    onUninstall: (svc) => svc.emit('error', boom),
  });
  await assert.rejects(() => uninstallService(deps), /boom-uninstall/);
});

test('uninstallService [patch mở rộng]: không emit gì cả -> timeout reject thay vì treo vô thời hạn', async () => {
  const deps = makeUninstallDeps({
    onUninstall: () => {
      // cố ý không emit gì - trước patch này, uninstallService() sẽ treo mãi.
    },
  });
  await assert.rejects(() => uninstallService(deps), /không xác nhận sự kiện "uninstall"/);
});
