---
title: 'Story 2.2: Channel-registry hot-reload — nguồn liệt kê kênh & vị trí lưới chính thức'
type: 'feature'
created: '2026-09-03'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `BitrateBaselinePort` (Story 2.1) chỉ tra được `baseline_kbps` từ 1 file phẳng `{channel_id: number}`, đọc 1 lần lúc khởi động — không có nguồn dữ liệu cho `station_name`/`contact_name`/`contact_phone`/`grid_position` (cần cho Epic 2-3), và thêm/sửa 1 kênh bắt buộc restart process, gián đoạn 19 kênh khác đang giám sát tốt (vi phạm AD-24/AD-26).

**Approach:** Thay `BitrateBaselinePort` bằng `ChannelRegistryPort` (đúng tên trong ARCHITECTURE-SPINE `ports/`) — 1 file JSON gộp DUY NHẤT `channel_id → {station_name, contact_name, contact_phone, grid_position, baseline_kbps}`, adapter mới `FileChannelRegistryAdapter` fail-fast lúc khởi động (như adapter cũ) nhưng có thêm `start()`/`stop()` để watch file bằng `fs.watch` built-in (không thêm dependency), debounce ghi-nhiều-lần, validate toàn bộ nội dung mới trước khi hoán đổi nguyên tử `Map` đang phục vụ — file lỗi thì giữ nguyên registry cũ, chỉ log, không throw/crash. Registry trở thành nguồn xác thực `channel_id` hợp lệ DUY NHẤT: `channel_id` không có trong registry bị coi là chưa đăng ký (khác `baseline_missing` cũ).

## Boundaries & Constraints

**Always:**
- `ChannelRegistryPort.getEntry(channelId): ChannelRegistryEntry | undefined` — 1 method, trả record đầy đủ (bao gồm `baselineKbps`); không method riêng cho baseline.
- File JSON `channel_id → {station_name, contact_name, contact_phone, grid_position, baseline_kbps}` (snake_case trong JSON, camelCase trong TS type) thay thế hoàn toàn `config/baseline.json`; `config/channel-registry.example.json` là mẫu ship kèm repo, file thật `config/channel-registry.json` `.gitignore`.
- Validate mỗi entry lúc load (khởi động lẫn reload): 4 field string non-empty; `grid_position` số nguyên 0-19, KHÔNG trùng giữa các kênh trong cùng file; `baseline_kbps` số hữu hạn > 0. Toàn bộ file bị từ chối nếu ≥1 entry sai (không load một phần).
- Lúc khởi động: lỗi đọc/parse/validate → throw rõ ràng tại composition root (fail-fast, giữ đúng hành vi Story 2.1). Sau khi đã chạy (reload do file đổi): lỗi → GIỮ NGUYÊN Map đang phục vụ, log `event_type=registry_reload_error` (channel_id rỗng, `reason` mô tả lỗi + đường dẫn), KHÔNG throw, KHÔNG crash process.
- Reload thành công → hoán đổi tham chiếu `Map` mới (không mutate Map cũ) rồi mới log `event_type=registry_reload_success` (channel_id rỗng, `reason` = số kênh trong registry mới) — đảm bảo lookup đang chạy song song không bao giờ thấy Map nửa-vời.
- Debounce watcher (≥300ms) coalesce nhiều fs event của cùng 1 lần lưu file (editor/`fs` có thể bắn nhiều event liên tiếp).
- `channelState.ts`: `channel_id` không có trong registry → log `event_type=channel_unregistered` (thay `baseline_missing`), bỏ qua đúng lần telemetry đó, không throw, không tạo/đổi state kênh — logic debounce/mapping trạng thái khác giữ nguyên 100% (không đổi `bitrateThreshold.ts`).
- `main.ts`: đổi biến môi trường `DASHBOARD_BASELINE_FILE` → `DASHBOARD_CHANNEL_REGISTRY_FILE`, default trỏ `config/channel-registry.json`; gọi `stop()` của registry watcher trong `AppHandle.stop()` (cùng chỗ đang `ws.close()`).
- Test bằng `node:test` + fake port, mirror convention `channelState.test.ts`; test hot-reload ghi file thật vào `mkdtempSync(tmpdir())` (như `fileBitrateBaselineAdapter.test.ts`), trigger reload qua gọi trực tiếp method internal thay vì chờ debounce thật (tránh flaky theo thời gian).

**Ask First:**
- Nếu `fs.watch` (native) không tin cậy trên Windows Service thật (theo tài liệu Node biết trước: có thể miss event khi editor replace-file bằng rename thay vì ghi trực tiếp) — nếu phát hiện bằng chứng cụ thể lúc code/test cho thấy native `fs.watch` không đáp ứng được, HALT hỏi trước khi thêm dependency `chokidar`, không tự quyết đổi.

**Never:** Đổi `bitrateThreshold.ts`/mapping trạng thái debounce (Story 2.1, giữ nguyên). Expose registry qua WebSocket/API cho frontend (Story 2.3+ tự tiêu thụ `ChannelRegistryPort` khi cần). Đổi cơ chế cấp passphrase/DPAPI (AD-7). Đổi `wsTelemetryAdapter.ts` (không biết registry, đúng ranh giới hexagonal).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Khởi động, file hợp lệ ≥1 kênh | `channel-registry.json` đúng format | `ChannelRegistryPort` nạp đúng ánh xạ, service start | N/A |
| Khởi động, file thiếu/hỏng | File không tồn tại/JSON lỗi/entry sai | Composition root throw, process không start | Lỗi rõ ràng nêu path + gợi ý copy từ `.example.json` |
| Sửa file khi đang chạy (thêm/sửa 1 kênh, hợp lệ) | Ghi đè file với nội dung mới hợp lệ | Áp dụng ngay, không restart, các kênh khác không gián đoạn | Log `registry_reload_success` |
| Sửa file khi đang chạy, nội dung mới lỗi (JSON hỏng/thiếu field/trùng `grid_position`) | Ghi đè file với nội dung invalid | Giữ nguyên registry cũ, các kênh đang chạy không đổi | Log `registry_reload_error`, không crash |
| Telemetry đến với `channel_id` không có trong registry | `telemetry` event, `channel_id` lạ | Bỏ qua đúng lần telemetry đó, không tạo state | Log `channel_unregistered`, không throw |
| Nhiều fs event dồn dập cho 1 lần lưu | Editor ghi file qua 2-3 thao tác I/O | Chỉ 1 lần reload thực sự áp dụng (debounce) | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/ports/BitrateBaselinePort.ts` -- XOÁ, thay bằng `ChannelRegistryPort.ts` (interface 1 method `getEntry`).
- `dashboard-backend/src/adapters/outbound/fileBitrateBaselineAdapter.ts` -- XOÁ, thay bằng `fileChannelRegistryAdapter.ts` (validate + `start()`/`stop()` watch + hoán đổi Map nguyên tử).
- `dashboard-backend/config/baseline.example.json` -- XOÁ, thay bằng `config/channel-registry.example.json`.
- `dashboard-backend/src/core/channelState.ts:9,38,50,58,83-104` -- đổi field/type `baselinePort`→`registryPort: ChannelRegistryPort`; dòng 83-104 đổi `getBaselineKbps()`→`getEntry()`, `undefined`→log `channel_unregistered` thay `baseline_missing`, lấy `baselineKbps` từ `entry.baselineKbps` trước khi gọi `computeBitratePct` (dòng 106, không đổi).
- `dashboard-backend/app/main.ts:70,77-93,114-127,142-146` -- đổi config field `baselineFilePath`→`channelRegistryFilePath`, env `DASHBOARD_BASELINE_FILE`→`DASHBOARD_CHANNEL_REGISTRY_FILE`, khởi tạo `FileChannelRegistryAdapter` + gọi `start()`, wiring `registryPort` vào `ChannelStateService` (dòng 127), thêm `registryPort.stop()` vào `stop()` (dòng 142-146) song song `ws.close()`.
- `dashboard-backend/src/logging/logger.ts` -- KHÔNG đổi type (`LogEvent` đã đủ 4 field); dùng `channel_id: ''` cho 2 `event_type` mới (`registry_reload_success`/`registry_reload_error`), mirror cách `app_started`/`app_stopping` đang làm (main.ts:137,143).
- `dashboard-backend/README.md` -- cập nhật mục biến môi trường + hướng dẫn tạo `config/channel-registry.json` (thay hoàn toàn mục baseline cũ).
- `dashboard-backend/tests/fileBitrateBaselineAdapter.test.ts` -- XOÁ, thay bằng `fileChannelRegistryAdapter.test.ts` (validate lúc load + hot-reload thành công/thất bại, dùng `mkdtempSync`).
- `dashboard-backend/tests/channelState.test.ts` -- sửa `FakeBaselinePort`→`FakeRegistryPort` implement `ChannelRegistryPort`, thêm case `channel_unregistered`.
- `dashboard-backend/tests/main.test.ts` -- thêm case cấu hình `channelRegistryFilePath`, giữ pattern hiện có (`parsePort`/`parseBearerTokens` không đổi).

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/ports/ChannelRegistryPort.ts` -- định nghĩa `ChannelRegistryEntry`/`ChannelRegistryPort`, xoá `BitrateBaselinePort.ts` -- port đúng tên kiến trúc (AD-24), 1 nguồn sự thật cho cả metadata lẫn baseline.
- [x] `dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts`, `config/channel-registry.example.json` -- adapter thật: load fail-fast lúc khởi động, `start()` watch (`fs.watch` + debounce ≥300ms) hoán đổi Map nguyên tử khi hợp lệ/giữ nguyên khi lỗi, `stop()` đóng watcher -- lõi của story.
- [x] `dashboard-backend/src/core/channelState.ts` -- đổi wiring sang `ChannelRegistryPort`, đổi `baseline_missing`→`channel_unregistered` -- khớp quyết định "registry là nguồn xác thực channel_id duy nhất".
- [x] `dashboard-backend/app/main.ts` -- đổi env var, khởi tạo + `start()`/`stop()` adapter mới, wiring -- composition root khớp port mới.
- [x] `dashboard-backend/README.md` -- viết lại mục cấu hình channel-registry -- vận hành theo đúng file/env mới.
- [x] `dashboard-backend/tests/fileChannelRegistryAdapter.test.ts` -- test I/O matrix (load hợp lệ/lỗi, reload hợp lệ/lỗi, debounce) -- verify hot-reload không cần chạy dịch vụ thật.
- [x] `dashboard-backend/tests/channelState.test.ts`, `tests/main.test.ts` -- cập nhật fake + case mới -- giữ coverage không hồi quy Story 2.1.

**Acceptance Criteria:**
- Given `config/channel-registry.json` tồn tại với ≥1 kênh hợp lệ, when dashboard-backend khởi động, then nạp đúng ánh xạ đầy đủ 5 field/kênh; registry là nguồn liệt kê `channel_id` hợp lệ DUY NHẤT.
- Given service đang chạy ổn định với N kênh, when file registry được sửa (thêm/sửa 1 kênh, nội dung hợp lệ), then áp dụng ngay không restart process, các kênh khác không bị gián đoạn/mất state đang debounce.
- Given file registry bị ghi đè bằng nội dung lỗi, when watcher phát hiện thay đổi, then registry cũ được giữ nguyên, service tiếp tục chạy bình thường, không crash.
- Given telemetry đến với `channel_id` không có trong registry, when `channelState.ts` xử lý, then log `channel_unregistered` và bỏ qua, không throw.

### Review Findings

**Code review vòng 2 — 2026-09-03** (review theo snapshot nội dung file, không phải diff — không có Git repo trong project). 4 layer: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor.

- [x] [Review][Decision→Patch] ~~`fs.watch` không tự phục hồi sau khi "chết"~~ — Ask First của spec (dòng 33, 95), bị defer 1 lần ở review vòng 1 thay vì HALT; **người dùng đã quyết định ở review vòng 2 (2026-09-03): chuyển sang `chokidar`** (option 1/4 được chọn) thay vì `fs.watch` built-in. **Đã áp dụng:** thêm dependency `chokidar@^4.0.3`, `start()`/`stop()` dùng `chokidar.watch(filePath, { ignoreInitial: true })` thay `node:fs.watch`, giữ nguyên 100% debounce/scheduleReload/reload tự viết + `'error'` handler (log `registry_watch_error`). [`fileChannelRegistryAdapter.ts:232-262`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L232-L262)
- [x] [Review][Patch] `startApp()` rò rỉ `FSWatcher`/debounce timer của `registryPort` nếu `startWsTelemetryAdapter()` reject (vd `EADDRINUSE`) SAU KHI `registryPort.start()` đã chạy thành công. **Đã áp dụng:** bọc `startWsTelemetryAdapter()` trong try/catch, gọi `registryPort.stop()` rồi rethrow lúc lỗi. [`main.ts:153-166`](../../dashboard-backend/app/main.ts#L153-L166) — *chưa có regression test riêng cho fix này (cần seam inject `Logger` test-only vào `startApp()`, cùng giới hạn đã ghi ở `deferred-work.md` dòng 62-63 cho AC#2).*
- [x] [Review][Patch] `channel_id` trùng lặp trong file JSON bị `JSON.parse` âm thầm ghi đè. **Đã áp dụng:** `findDuplicateTopLevelKey()` scan raw text (bracket-depth aware, chỉ xét key top-level) trước khi build registry, throw rõ ràng nếu phát hiện trùng. Test mới: `channel_id trùng lặp trong cùng file...`. [`fileChannelRegistryAdapter.ts:62-98`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L62-L98)
- [x] [Review][Patch] `isNonEmptyString()` chấp nhận chuỗi toàn khoảng trắng. **Đã áp dụng:** `value.trim().length > 0`. Test mới: `station_name/contact_name/contact_phone toàn khoảng trắng...`. [`fileChannelRegistryAdapter.ts:55-59`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L55-L59)
- [x] [Review][Patch] README không liệt kê `event_type=registry_watch_error`. **Đã áp dụng:** thêm 1 câu mô tả sự kiện này vào mục Hot-reload; đồng thời cập nhật mô tả watcher từ `fs.watch` sang `chokidar`. [`README.md`](../../dashboard-backend/README.md)
- [x] [Review][Patch] `DASHBOARD_CHANNEL_REGISTRY_FILE=""` không bị chặn tường minh. **Đã áp dụng:** guard rỗng/toàn khoảng trắng trước `??`, throw lỗi cấu hình rõ ràng cùng phong cách `parsePort()`. [`main.ts:82-95`](../../dashboard-backend/app/main.ts#L82-L95)
- [x] [Review][Patch] Thiếu test ENOENT lúc `reload()`. **Đã áp dụng:** test mới `reload(): file bị xoá hẳn giữa lúc đang chạy (ENOENT)...`. [`fileChannelRegistryAdapter.test.ts`](../../dashboard-backend/tests/fileChannelRegistryAdapter.test.ts)

**Verify sau khi áp patch:** `npm run build` sạch, `npm test` — **67/67 test pass** (64 cũ + 3 test mới: ENOENT-on-reload, duplicate channel_id, whitespace-only string).
- [x] [Review][Defer] `channel_id` bị xoá khỏi registry qua hot-reload trong khi đang có `committed` display state trong `ChannelStateService.channels` — không có cơ chế dọn dẹp, trạng thái cũ (vd "critical") bị giữ vĩnh viễn cho 1 kênh không còn đăng ký; `channels` Map không bao giờ prune, tích rác không giới hạn theo mỗi lần đổi registry. Rủi ro thấp ở quy mô hiện tại (~20 kênh, sửa registry không thường xuyên), Epic 2-3 (grid render theo registry) không lộ trạng thái orphan này ra UI — nhưng là hành vi mới do hot-reload (Story 2.2) tạo ra, chưa có ở Story 2.1. [`channelState.ts:53-107`](../../dashboard-backend/src/core/channelState.ts#L53-L107) — deferred, xem `deferred-work.md`.
- [x] [Review][Defer] AC#2 (reload trong khi service đang debounce không mất state) chỉ được đảm bảo bằng thiết kế, chưa có test tích hợp `startApp()` xuyên suốt hot-reload↔`ChannelStateService` xác nhận trực tiếp — đã tự nhận diện và defer sẵn ở Spec Change Log/`deferred-work.md` (dòng 62-63) trước khi review này chạy, không có phát hiện mới. [`deferred-work.md`](deferred-work.md) — deferred, pre-existing.

Dismissed as noise/false-positive/handled-elsewhere (11): thiếu test `main.ts` cho Story 2.2 (false positive — `main.test.ts` có, chỉ bị bỏ sót khỏi snapshot review ban đầu); comment `grid_position` "row-major 5x4" (Design Notes dòng 93 xác nhận đây là quyết định trong phạm vi story, không phải Ask First); giới hạn độ dài/định dạng `station_name`/`contact_name`/`contact_phone` (ngoài scope spec — chỉ yêu cầu string non-empty); `debounceMs` option không validate (chỉ dùng nội bộ cho test, không expose qua config/env); `stop()` huỷ debounce timer đang chờ không log (đúng thiết kế lúc shutdown); `reload()` là method public (đúng theo Boundaries — chủ ý làm test seam); log `registry_reload_success` chỉ có count không có path (cosmetic); `loadAndValidate()` đọc file đồng bộ chặn event loop (không đáng kể ở quy mô file nhỏ hiện tại); `baseline_kbps` không giới hạn trên (đã tracked sẵn ở `deferred-work.md` dòng 53-54, không có thông tin mới); 2 finding của Acceptance Auditor về `main.test.ts`/`.gitignore` "thiếu" (false positive, cả 2 file đều tồn tại và đáp ứng đúng yêu cầu — do snapshot review ban đầu bỏ sót).

## Spec Change Log

- **2026-09-03 — Code review vòng 1 (patch, không đổi frozen intent):**
  - Finding: `FileChannelRegistryAdapter.start()` không gắn handler cho event `'error'` của `FSWatcher` → có thể unhandled exception, crash process (vi phạm Boundaries "KHÔNG throw, KHÔNG crash process"). Sửa: gắn `watcher.on('error', ...)`, log `registry_watch_error`, không throw.
  - Finding: `loadAndValidate()` chấp nhận registry rỗng (`{}`, 0 kênh) là hợp lệ, lệch AC#1 ("tồn tại với ≥1 kênh"). Sửa: throw khi `registry.size === 0`, áp dụng cho cả lúc khởi động (fail-fast) lẫn reload (bị `reload()` catch, giữ registry cũ, log `registry_reload_error`).
  - Finding: `main.ts` gọi `registryPort.start()` không bọc try/catch, race hiếm (file bị xoá giữa constructor và `start()`) sẽ throw thô. Sửa: bọc try/catch, thông báo lỗi rõ ràng mirror style catch block phía trên.
  - Đã verify: build sạch, 64/64 test pass (3 test mới cho 2 finding đầu). KEEP: toàn bộ thiết kế port/adapter/wiring gốc giữ nguyên, không đổi frozen intent.
  - Các finding còn lại (rủi ro `fs.watch` với atomic-rename, thiếu upper-bound `baseline_kbps`, `getEntry()` không freeze, case-sensitivity `channel_id`, thiếu test tích hợp `startApp()`, thiếu test `start()` gọi 2 lần) → deferred, xem `deferred-work.md`.

- **2026-09-03 — Code review vòng 2 (patch + 1 Ask First được giải quyết, không đổi frozen intent):**
  - **Ask First được giải quyết (không còn tự quyết/defer):** rủi ro `fs.watch` atomic-rename bị defer ở vòng 1 nay được 2 layer review độc lập xác nhận lại đúng bằng chứng cụ thể (watcher không re-arm sau `'error'`, đọc trực tiếp code, không cần thực nghiệm) — đây chính là điều kiện Ask First của Boundaries/Design Notes. **HALT hỏi người dùng** (đúng quy trình, không tự quyết) — người dùng chọn thêm dependency `chokidar`. Đã thêm `chokidar@^4.0.3`, thay `node:fs.watch` bằng `chokidar.watch(filePath, { ignoreInitial: true })` trong `start()`/`stop()`, giữ nguyên 100% debounce/reload/error-handling tự viết.
  - Finding: `startApp()` rò rỉ `registryPort`'s watcher/debounce timer nếu bind WS thất bại sau khi `registryPort.start()` đã chạy. Sửa: bọc `startWsTelemetryAdapter()` trong try/catch, `registryPort.stop()` rồi rethrow.
  - Finding: `channel_id` trùng lặp trong JSON bị `JSON.parse` âm thầm ghi đè. Sửa: scan raw text phát hiện key top-level trùng, throw rõ ràng.
  - Finding: `isNonEmptyString()` chấp nhận chuỗi toàn khoảng trắng. Sửa: `trim()` trước khi check.
  - Finding: README thiếu mô tả `registry_watch_error`. Sửa: bổ sung + cập nhật mô tả watcher sang `chokidar`.
  - Finding: `DASHBOARD_CHANNEL_REGISTRY_FILE=""` không bị chặn tường minh. Sửa: guard rỗng/khoảng trắng cùng phong cách `parsePort()`.
  - Đã verify: build sạch, **67/67 test pass** (64 cũ + 3 test mới: ENOENT-on-reload, duplicate channel_id, whitespace-only string). KEEP: toàn bộ thiết kế port/adapter/wiring gốc giữ nguyên, không đổi frozen intent (chỉ đổi cơ chế watch bên trong adapter theo quyết định người dùng).
  - Defer mới: xoá `channel_id` khỏi registry khi kênh đang có `committed` display state → `ChannelStateService.channels` không prune (xem `deferred-work.md`). AC#2 integration-test gap đã tracked sẵn từ vòng 1, không có phát hiện mới.

## Design Notes

**Tại sao gộp baseline_kbps vào registry (không giữ 2 file):** đã hỏi người dùng trước khi lập spec — người dùng chọn gộp 1 file duy nhất, khớp đúng note trong Design Notes Story 2.1 ("`BitrateBaselinePort` là điểm nối duy nhất sẽ đổi ở Story 2.2"). Tên port đổi thành `ChannelRegistryPort` (không giữ tên `BitrateBaselinePort`) vì đây là tên chính thức trong ARCHITECTURE-SPINE `ports/` — `BitrateBaselinePort` chỉ là interface tạm của riêng Story 2.1, không xuất hiện trong danh sách port kiến trúc.

**`grid_position` là số nguyên 0-19 (row-major, 5 cột × 4 hàng), không phải `{row, col}`:** kiến trúc/epics không chốt định dạng cụ thể — đây là quyết định kỹ thuật trong phạm vi story này (không thuộc diện Ask First), chọn số nguyên đơn giản nhất để Story 2.3 (grid render) tự `Math.floor(pos/5)`/`pos%5`. Gắn cờ ở đây để reviewer/PM xác nhận lại nếu Story 2.3 cần định dạng khác.

**`fs.watch` built-in thay vì `chokidar`:** ~~package.json hiện chỉ có dependency `ws`; giữ tinh thần tối giản dependency. `fs.watch` có nhược điểm biết trước trên 1 số OS/editor (rename-based save có thể không bắn event) — nếu gặp bằng chứng cụ thể lúc code, đây là điều kiện Ask First đã ghi ở Boundaries, không tự đổi sang `chokidar`.~~ **[CẬP NHẬT — code review vòng 2, 2026-09-03]:** bằng chứng cụ thể đã xuất hiện (2 layer review độc lập, đọc trực tiếp code: atomic-rename mất tracking không log + watcher không re-arm sau `'error'`) — đúng điều kiện Ask First. Đã HALT hỏi người dùng thay vì tự quyết; người dùng chọn thêm `chokidar@^4.0.3`. `start()`/`stop()` nay dùng `chokidar.watch(filePath, { ignoreInitial: true })`, debounce/reload/error-handling tự viết giữ nguyên 100%. Xem Spec Change Log.

## Verification

**Commands:**
- `cd dashboard-backend && npm run build` -- expected: biên dịch TS sạch, không lỗi type (kể cả sau khi xoá `BitrateBaselinePort`/`fileBitrateBaselineAdapter`, không còn import chết). **Đã chạy thật: PASS.**
- `cd dashboard-backend && npm test` -- expected: toàn bộ test (kể cả test hot-reload mới) pass, không hồi quy `channelState`/`main`/`wsTelemetryAdapter`. **Đã chạy thật: PASS, 64/64 test (vòng 1); PASS, 67/67 test sau code review vòng 2 (thêm 3 test: ENOENT-on-reload, duplicate channel_id, whitespace-only string).**

## Suggested Review Order

**Ranh giới channel_id hợp lệ (registry là nguồn xác thực duy nhất)**

- Entry point: nơi chuyển từ "tra baseline" sang "xác thực channel_id qua registry" — quyết định người dùng đã duyệt trước khi lập spec.
  [`channelState.ts:87`](../../dashboard-backend/src/core/channelState.ts#L87)

- `channel_unregistered` thay `baseline_missing` — channel_id không có trong registry bị coi là chưa đăng ký, không phải "thiếu baseline".
  [`channelState.ts:88`](../../dashboard-backend/src/core/channelState.ts#L88)

- Hợp đồng port: `getEntry()` trả record đầy đủ (metadata + baseline), `undefined` = chưa đăng ký, không fallback ngầm.
  [`ChannelRegistryPort.ts:29`](../../dashboard-backend/src/ports/ChannelRegistryPort.ts#L29)

**Validate toàn file, fail-fast (an toàn dữ liệu)**

- Guard registry rỗng (0 kênh) — patch review vòng 1, chặn 1 lần lưu file lỗi âm thầm xoá sạch giám sát 20 kênh.
  [`fileChannelRegistryAdapter.ts:144`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L144)

- `loadAndValidate()`: validate toàn bộ entry (4 field string, grid_position 0-19, baseline_kbps>0), từ chối cả file nếu ≥1 entry sai.
  [`fileChannelRegistryAdapter.ts:56`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L56)

- Trùng `grid_position` giữa 2 kênh trong cùng file — throw rõ ràng, không load một phần.
  [`fileChannelRegistryAdapter.ts:109`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L109)

**Hot-reload không crash, không mất dữ liệu đang phục vụ**

- `reload()`: validate xong mới hoán đổi tham chiếu Map — lookup song song không bao giờ thấy Map nửa-vời.
  [`fileChannelRegistryAdapter.ts:220`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L220)

- Watcher `'error'` handler — patch review vòng 1, chặn unhandled exception crash cả tiến trình khi watcher gặp lỗi hệ thống.
  [`fileChannelRegistryAdapter.ts:187`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L187)

- Debounce coalesce nhiều fs event của cùng 1 lần lưu file trước khi thực sự reload.
  [`fileChannelRegistryAdapter.ts:205`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L205)

**Composition root (wiring)**

- `start()` sau khi load lần đầu thành công — bọc try/catch (patch review vòng 1) cho lỗi khởi động rõ ràng thay vì raw stack trace.
  [`main.ts:142`](../../dashboard-backend/app/main.ts#L142)

- Đường dẫn config đổi từ `DASHBOARD_BASELINE_FILE` sang `DASHBOARD_CHANNEL_REGISTRY_FILE`, wiring `registryPort` vào `ChannelStateService`.
  [`main.ts:82`](../../dashboard-backend/app/main.ts#L82)

- `stop()` dừng watcher song song `ws.close()` khi shutdown.
  [`main.ts:168`](../../dashboard-backend/app/main.ts#L168)

**Test & peripherals**

- Test hot-reload: load hợp lệ/lỗi, reload thành công/thất bại, debounce coalescing, watcher error, registry rỗng.
  [`fileChannelRegistryAdapter.test.ts`](../../dashboard-backend/tests/fileChannelRegistryAdapter.test.ts)

- Test core: `channel_unregistered` thay `baseline_missing`, `FakeRegistryPort` mới.
  [`channelState.test.ts:158`](../../dashboard-backend/tests/channelState.test.ts#L158)

- Test wiring `startApp()` qua `channelRegistryFilePath`.
  [`main.test.ts:48`](../../dashboard-backend/tests/main.test.ts#L48)

- Cấu hình: mẫu registry mới, `.gitignore`, `README.md` (env var + hướng dẫn tạo `channel-registry.json`).
  [`channel-registry.example.json`](../../dashboard-backend/config/channel-registry.example.json)

