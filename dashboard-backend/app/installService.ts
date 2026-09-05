// Story 2.1 Design Notes ("Windows Service"): transport-core tự đăng ký SCM
// in-process bằng C++ Win32 API (WindowsServiceHost.h). Ban đầu story này đã
// thử tìm 1 thư viện npm tương đương làm y hệt vậy TRONG-PROCESS (gọi thẳng
// CreateService()/StartServiceCtrlDispatcher() từ chính tiến trình node.exe,
// không qua 1 wrapper .exe ngoài) - thư viện duy nhất tìm được (`os-service`,
// native addon qua node-gyp/NAN) BUILD THẤT BẠI trên Node 24 (nan.h gọi các
// API V8 đã bị xoá/đổi chữ ký - hàng chục lỗi C2440/C2955/C2039, xem lịch sử
// git của file này/báo cáo story để có log lỗi đầy đủ). Đây đúng là điều
// kiện HALT mà Boundaries mô tả ("nếu cơ chế in-process không khả dụng trên
// máy build/deploy thật").
//
// *** QUYẾT ĐỊNH CỦA NGƯỜI DÙNG (đã duyệt tường minh, không còn là HALT) ***
// Người dùng đã chấp nhận dùng wrapper ngoài: chuyển sang `node-windows`
// (gói chính thức, còn bảo trì, dùng winsw.exe làm wrapper) thay vì cố tìm
// tiếp 1 cơ chế in-process khác hay tự vá `os-service`. Khác với `winser`
// (chạy trên NSSM) - lựa chọn ngoài duy nhất Boundaries liệt kê tên - hay tự
// gọi `sc.exe create` trỏ thẳng `node.exe` (KHÔNG hoạt động thật, vì node.exe
// không tự implement service control handler protocol nên SCM sẽ time-out
// chờ "running" mãi) - `node-windows` là thư viện npm chuyên dụng cho đúng
// bài toán "chạy Node.js script như 1 Windows Service thật" (đăng ký qua
// SCM thật, hiện trong `services.msc`, `net start`/`net stop` dùng được bình
// thường), chỉ khác `os-service` ở chỗ winsw.exe là process con host node.exe
// thay vì chính node.exe gọi StartServiceCtrlDispatcher.
//
// Auto-restart khi crash (AD-27): `node-windows`/winsw tự giám sát tiến
// trình con và tự restart theo cấu hình (wait/grow/maxRestarts bên dưới) -
// đây LÀ cơ chế "auto-restart qua supervisor, không tự viết watchdog riêng"
// mà Design Notes yêu cầu, chỉ khác `os-service` ở việc watchdog là
// winsw.exe (1 phần của thư viện npm đã cài) thay vì Windows SCM's
// SERVICE_CONFIG_FAILURE_ACTIONS - không còn cần gọi `sc.exe failure` như
// bản os-service trước đây.
//
// Code review [patch #3]: `node-windows` được khai báo trong
// `optionalDependencies` (package.json) + chỉ được import THẬT (dynamic
// import) BÊN TRONG installService()/uninstallService() - mirror đúng thiết
// kế lazy-load ban đầu của `os-service`. Lý do: `installService.ts` là 1
// entrypoint CLI độc lập, không ai khác import nó (app/main.ts không phụ
// thuộc file này) - nhưng nếu 1 ngày `node-windows` (hay bản thay thế sau
// này) lại gặp đúng kiểu lỗi cross-platform-install-breakage như `os-service`
// đã gặp, 1 static import ở đầu file sẽ khiến MỌI lệnh CLI của file này (kể
// cả `node installService.js` không tham số, chỉ để in usage) crash ngay từ
// dòng import - kể cả khi người dùng chỉ đang chạy `npm run build`/`npm test`
// ở máy không phải Windows. Import type-only (`import type ... from
// 'node-windows'`) vẫn để ở đầu file - bị erase hoàn toàn lúc biên dịch, chỉ
// cần `@types/node-windows` (devDependency, luôn cài được, không có bước
// biên dịch native nào) để type-check, không đụng gì tới package runtime.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Service as NodeWindowsService, ServiceConfig } from 'node-windows';

const SERVICE_NAME = 'DashboardBackend';
const SERVICE_DESCRIPTION =
  'VTCDigital Dashboard Backend - tính trạng thái hiển thị (ok/warning/critical) từ telemetry thô transport-core (Story 2.1).';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// Cùng thư mục dist/app với installService.js sau biên dịch - main.js đã tự
// start khi được chạy trực tiếp (xem "isDirectRun" ở cuối main.ts), nên
// winsw chỉ cần spawn đúng file này, không cần 1 chế độ "--run" riêng như
// os-service yêu cầu trước đây.
const mainScriptPath = path.resolve(currentDir, 'main.js');

// Code review [patch #3]: dynamic import LAZY - chỉ chạm tới package thật
// khi thực sự cần install/uninstall, không phải lúc module này được load.
async function loadNodeWindows(): Promise<{ Service: typeof NodeWindowsService }> {
  try {
    return await import('node-windows');
  } catch (err) {
    throw new Error(
      `Không load được thư viện 'node-windows' (Windows Service wrapper qua winsw.exe). ` +
        `Gói này nằm trong optionalDependencies - cài lại bằng 'npm install node-windows' ` +
        `trên máy Windows thật trước khi chạy --install/--uninstall. Lỗi gốc: ${(err as Error).message}`
    );
  }
}

// Code review [patch #2]: trước đây không kiểm tra `mainScriptPath` tồn tại
// trước khi svc.install() - nếu ai đó chạy `service:install` trước khi
// `npm run build`, winsw sẽ được đăng ký trỏ tới 1 file KHÔNG TỒN TẠI, và
// service sẽ restart-loop vô ích (winsw start -> node báo lỗi file not found
// -> winsw restart -> lặp lại) mà không có gợi ý rõ ràng đây là do build
// chưa chạy.
function assertMainScriptBuilt(): void {
  if (!existsSync(mainScriptPath)) {
    throw new Error(
      `Không tìm thấy "${mainScriptPath}" - project có vẻ CHƯA được build. ` +
        `Chạy 'npm run build' trước khi 'npm run service:install'.`
    );
  }
}

function buildServiceConfig(): ServiceConfig {
  return {
    name: SERVICE_NAME,
    description: SERVICE_DESCRIPTION,
    script: mainScriptPath,
    // AD-27 "auto-restart khi crash" - winsw tự tăng dần thời gian chờ giữa
    // các lần restart (1.25^n lần `wait` giây) để không dồn dập, nhưng không
    // bao giờ "bỏ cuộc" hẳn (maxRetries để mặc định = unlimited) vì đây là
    // service giám sát 24/7 - mất giám sát vĩnh viễn tệ hơn việc restart-loop
    // 1 script lỗi.
    wait: 2,
    grow: 0.5,
    // Trần số lần restart trong 1 cửa sổ 60s (theo tài liệu node-windows) -
    // chặn restart-loop điên cuồng nếu script có lỗi nghiêm trọng, không
    // chặn khả năng phục hồi lâu dài.
    maxRestarts: 10,
  };
}

// Code review [test coverage]: `installService()`/`uninstallService()` gọi
// thẳng `loadNodeWindows()`/`assertMainScriptBuilt()` module-scope trước đây,
// khiến 2 hàm này KHÔNG thể unit-test được (đụng `node-windows`/filesystem
// thật). Tách phụ thuộc ra 1 deps-object injectable (cùng tinh thần ports/
// adapters của `src/core` - Boundaries: test bằng fake, không cần máy thật) -
// test dùng 1 `Service` giả (EventEmitter) + fake `assertBuilt`/`timeoutMs`
// nhỏ, không đụng `node-windows`/`dist/app/main.js` thật.
export interface InstallServiceDeps {
  loadService: () => Promise<{ Service: typeof NodeWindowsService }>;
  assertBuilt: () => void;
  startTimeoutMs: number;
}

export interface UninstallServiceDeps {
  loadService: () => Promise<{ Service: typeof NodeWindowsService }>;
  timeoutMs: number;
}

const START_TIMEOUT_MS = 30000;
// Code review [patch #1 mở rộng]: `uninstallService()` trước đây không có
// timeout an toàn nào, khác `installService()` (đã thêm timeout đúng vì
// `node-windows` có nhánh lỗi chỉ log mà không emit 'error' lẫn sự kiện
// thành công). Cùng lớp rủi ro áp dụng cho uninstall - thêm timeout đối xứng.
const UNINSTALL_TIMEOUT_MS = 30000;

const defaultInstallDeps: InstallServiceDeps = {
  loadService: loadNodeWindows,
  assertBuilt: assertMainScriptBuilt,
  startTimeoutMs: START_TIMEOUT_MS,
};

const defaultUninstallDeps: UninstallServiceDeps = {
  loadService: loadNodeWindows,
  timeoutMs: UNINSTALL_TIMEOUT_MS,
};

export async function installService(deps: InstallServiceDeps = defaultInstallDeps): Promise<void> {
  deps.assertBuilt();
  const { Service } = await deps.loadService();
  const svc = new Service(buildServiceConfig());

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    // Code review [patch #1]: trước đây `svc.on('install', () => { svc.start();
    // resolve(); })` coi "đã GỌI install() xong" là "đã CHẠY thành công" -
    // resolve() ngay lập tức mà không đợi `NET START` thật sự thành công.
    // node-windows's Service.start() có emit sự kiện 'start' khi `NET START`
    // trả về exit code 0 (xem node_modules/node-windows/lib/daemon.js) - chỉ
    // resolve() sau sự kiện đó. Kèm timeout an toàn: 1 vài nhánh lỗi bên
    // trong start() của node-windows chỉ log mà KHÔNG emit gì cả (không
    // 'start' cũng không 'error') - không có timeout, Promise này sẽ treo vô
    // thời hạn.
    const startTimeout = setTimeout(() => {
      settleReject(
        new Error(
          `Timeout: service "${SERVICE_NAME}" không xác nhận sự kiện "start" trong ` +
            `${deps.startTimeoutMs}ms sau khi install. Kiểm tra Event Log (Windows) hoặc chạy ` +
            `'net start "${SERVICE_NAME}"' thủ công để xem lỗi chi tiết.`
        )
      );
    }, deps.startTimeoutMs);

    svc.on('alreadyinstalled', () => {
      console.log(`Service "${SERVICE_NAME}" đã được đăng ký từ trước - bỏ qua install.`);
      clearTimeout(startTimeout);
      settleResolve();
    });
    svc.on('invalidinstallation', () => {
      clearTimeout(startTimeout);
      settleReject(new Error(`Phát hiện 1 installation cũ thiếu file cần thiết cho service "${SERVICE_NAME}".`));
    });
    svc.on('error', (err: unknown) => {
      clearTimeout(startTimeout);
      settleReject(err);
    });
    svc.on('install', () => {
      console.log(`Đã đăng ký Windows Service "${SERVICE_NAME}" - đang start...`);
      svc.start();
    });
    svc.on('start', () => {
      console.log(`Service "${SERVICE_NAME}" đã start thành công (auto-restart qua winsw khi crash).`);
      clearTimeout(startTimeout);
      settleResolve();
    });
    svc.install();
  });
}

export async function uninstallService(deps: UninstallServiceDeps = defaultUninstallDeps): Promise<void> {
  const { Service } = await deps.loadService();
  const svc = new Service(buildServiceConfig());

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    // Code review [patch #1 mở rộng]: cùng lý do timeout của installService()
    // - 1 vài nhánh lỗi của node-windows chỉ log mà không emit sự kiện nào cả.
    const uninstallTimeout = setTimeout(() => {
      settleReject(
        new Error(
          `Timeout: service "${SERVICE_NAME}" không xác nhận sự kiện "uninstall" trong ` +
            `${deps.timeoutMs}ms. Kiểm tra Event Log (Windows) hoặc chạy ` +
            `'sc delete "${SERVICE_NAME}"' thủ công để xem lỗi chi tiết.`
        )
      );
    }, deps.timeoutMs);

    svc.on('alreadyuninstalled', () => {
      console.log(`Service "${SERVICE_NAME}" không tồn tại - bỏ qua uninstall.`);
      clearTimeout(uninstallTimeout);
      settleResolve();
    });
    svc.on('error', (err: unknown) => {
      clearTimeout(uninstallTimeout);
      settleReject(err);
    });
    svc.on('uninstall', () => {
      console.log(`Đã gỡ Windows Service "${SERVICE_NAME}".`);
      clearTimeout(uninstallTimeout);
      settleResolve();
    });
    svc.uninstall();
  });
}

function printUsage(): void {
  console.log('Usage: node installService.js --install|--uninstall');
}

// Code review [DRY]: `isDirectRun` bị lặp y hệt ở `main.ts` - dùng chung 1
// helper (`isDirectRunEntrypoint`) để tránh 2 bản có thể lệch nhau theo thời
// gian.
import { isDirectRunEntrypoint } from './isDirectRun.js';

if (isDirectRunEntrypoint(import.meta.url)) {
  const cmd = process.argv[2];
  const onError = (err: unknown): void => {
    console.error(err);
    process.exit(1);
  };

  if (cmd === '--install') {
    installService().catch(onError);
  } else if (cmd === '--uninstall') {
    uninstallService().catch(onError);
  } else {
    printUsage();
    process.exit(1);
  }
}
