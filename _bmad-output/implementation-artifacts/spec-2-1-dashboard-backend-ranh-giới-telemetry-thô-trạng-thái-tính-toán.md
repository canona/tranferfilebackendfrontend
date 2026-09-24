---
title: 'Story 2.1: Dashboard-backend — ranh giới telemetry thô → trạng thái tính toán'
type: 'feature'
created: '2026-09-03'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Transport-core (Story 1.8) đã phát telemetry thô (`telemetry`, `heartbeat`, `snapshot`, `handshake_reject`) qua WebSocket LAN có bearer-token, nhưng chưa có bên nhận nào tồn tại để tính trạng thái hiển thị (`ok`/`warning`/`critical`). Không có 1 nơi tính toán duy nhất, logic ngưỡng/debounce sẽ bị lặp lại và lệch nhau giữa các điểm triển khai sau này (frontend Epic 2-5, cảnh báo Epic 4).

**Approach:** Dựng mới `dashboard-backend/` (Node.js 24 + TypeScript, ESM) theo cấu trúc hexagonal `src/core|ports|adapters/{inbound,outbound}|logging` + `app/` bootstrap. Adapter inbound WS xác thực bearer-token/máy, parse envelope, lọc đúng tập `event_type` đóng, forward `telemetry` vào domain core thuần qua `TelemetryInboundPort`. Core tính `bitrate_pct` (bitrate_kbps / baseline kbps từ file baseline tạm — sẽ thay bằng channel-registry ở Story 2.2), debounce ≥5s, rồi map sang trạng thái hiển thị, publish qua `AlertOutboundPort` (adapter outbound tạm chỉ log — adapter thật là các story sau).

## Boundaries & Constraints

**Always:**
- `src/core` hoàn toàn thuần (không import `ws`/`fs`/network trực tiếp); test bằng fake `TelemetryInboundPort`/`AlertOutboundPort`/`BitrateBaselinePort`, không cần máy thật.
- Chỉ ingest `event_type=telemetry` để lấy `bitrate_kbps`/`rtt_ms`/`connection_state`/`audio_level`. Mọi `event_type` khác nằm ngoài tập đóng `{telemetry, snapshot, alert, ack-command, heartbeat, handshake_reject, handshake_success}` — bao gồm event `bitrate` riêng do ABR phát — bị bỏ qua âm thầm (log debug), không throw.
- Mapping trạng thái: `CONNECTED`+`bitrate_pct`≥70%→`ok`; `CONNECTED`+`bitrate_pct`<70%→`warning`; `RECONNECTING`→`critical`; `REJECTED`→`critical` kèm sub-type `"config-or-security-suspected"`. `bitrate_pct = bitrate_kbps hiện tại / baseline_kbps(channel_id)`.
- `baseline_kbps` tra qua `BitrateBaselinePort`; adapter thật đọc 1 file JSON `config/baseline.json` (tạo tại thời điểm deploy từ mẫu `config/baseline.example.json` đi kèm repo) dạng `{channel_id: baseline_kbps}` — tạm thời thay chỗ cho channel-registry (Story 2.2 sẽ thay adapter, không đổi port).
- Đổi trạng thái hiển thị của 1 kênh chỉ chốt sau khi trạng thái mới liên tục ổn định ≥5s tính theo per-channel; dùng clock injectable (không `Date.now()` trực tiếp trong core) để test được không cần chờ thật.
- Bearer-token xác thực mỗi kết nối WS/máy; sai token → reject handshake HTTP 401/403 rõ ràng (để `TelemetryWsClient` phía transport-core log đúng `ws_reject_auth`).
- Log structured JSON lines: kết nối xác thực thành công/reject, mỗi lần trạng thái hiển thị của 1 kênh đổi.
- TypeScript + ESM (`"type": "module"`) + npm; test bằng `node:test`/`node:assert` built-in, không thêm dependency test framework ngoài.
- Chạy dưới Windows Service (đăng ký qua SCM, auto-restart khi crash) trên 1 máy riêng, ngoài 40 máy transport-core.

**Ask First:**
- Nếu telemetry đến với `channel_id` không có trong file baseline — HALT, hỏi trước khi quyết định fallback (bỏ qua kênh/dùng baseline mặc định/khác).
- Nếu cơ chế đăng ký Windows Service in-process (native SCM qua thư viện npm) không khả dụng trên máy build/deploy thật — HALT, hỏi trước khi đổi sang cơ chế supervisor ngoài (NSSM/sc.exe).

**Never:** Implement channel-registry thật (Story 2.2), frontend/grid render (Story 2.3+), adapter outbound thật cho Telegram/Email/WS→React (stories sau) — chỉ cần adapter log tạm để wiring domain core hoàn chỉnh. Implement `AckCommandPort`/`HistoryPort` thật (Epic 3). Sửa transport-core.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bearer-token đúng | WS connect kèm header `Authorization: Bearer <token>` đúng/máy | Accept connection, bắt đầu nhận `telemetry` | N/A |
| Bearer-token sai/thiếu | WS connect kèm token sai hoặc không có header | Reject handshake, không tạo session | HTTP 401/403 + log `ws_reject_auth` |
| CONNECTED, bitrate_pct≥70%, ổn định ≥5s | `telemetry` liên tục cùng trạng thái | Display state → `ok` sau đúng 5s liên tục | N/A |
| Trạng thái dao động <5s | `bitrate_pct` nhấp nháy qua lại ngưỡng 70% trong <5s | Display state giữ nguyên giá trị cũ (chưa đủ debounce) | N/A |
| RECONNECTING | `connection_state=RECONNECTING` ổn định ≥5s | Display → `critical` | N/A |
| REJECTED | `connection_state=REJECTED` ổn định ≥5s | Display → `critical`, sub-type `config-or-security-suspected` | N/A |
| `channel_id` lạ (không có baseline) | `telemetry` với `channel_id` chưa có trong file baseline | Theo Ask First — không tự chọn fallback | Log lỗi rõ ràng, không throw crash process |
| `event_type` ngoài tập đóng (vd `bitrate` riêng của ABR) | Envelope hợp lệ nhưng `event_type` không thuộc tập đóng | Bị bỏ qua, không ảnh hưởng state | Log debug, không throw |

</frozen-after-approval>

## Code Map

- `transport-core/src/telemetry/TelemetryWsClient.h/.cpp`, `EventEnvelope.h` -- đã có, contract phía gửi, KHÔNG đổi.
- `transport-core/src/srt/ChannelActor.cpp:652-781` -- xác nhận field thật: `bitrate_kbps`(uint32), `rtt_ms`(double), `connection_state`, `audio_level:[L,R]`; tần suất telemetry ~1s, heartbeat 5s.
- `_bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md:96-100` (AD-11 debounce/ngưỡng/nguồn sự thật), `:150-154` (AD-20 hexagonal), `:202-206` (AD-27 Windows Service), `:220-224` (AD-30 logging), `:243` (tập đóng `event_type`), `:255-257` (stack Node 24/`ws`), `:296-304` (cấu trúc thư mục bắt buộc) -- ràng buộc kiến trúc.
- `dashboard-backend/package.json`, `tsconfig.json` (MỚI) -- TS + ESM, Node 24 engines, scripts `build`/`test`/`start`.
- `dashboard-backend/src/ports/TelemetryInboundPort.ts`, `AlertOutboundPort.ts`, `BitrateBaselinePort.ts` (MỚI) -- interface hexagonal.
- `dashboard-backend/src/core/channelState.ts` (MỚI) -- state machine `ok/warning/critical` + debounce 5s/kênh, clock injectable.
- `dashboard-backend/src/core/bitrateThreshold.ts` (MỚI) -- tính `bitrate_pct` từ `bitrate_kbps` + `BitrateBaselinePort`.
- `dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts` (MỚI) -- `ws` server, xác thực bearer-token, parse + lọc envelope, forward vào core.
- `dashboard-backend/src/adapters/outbound/logAlertAdapter.ts` (MỚI) -- `AlertOutboundPort` tạm, chỉ log.
- `dashboard-backend/src/adapters/outbound/fileBitrateBaselineAdapter.ts`, `config/baseline.example.json` (MỚI) -- đọc baseline tạm.
- `dashboard-backend/src/logging/logger.ts` (MỚI) -- structured JSON lines, mirror phong cách `Logger` 4-field của transport-core.
- `dashboard-backend/app/main.ts` (MỚI) -- wiring adapters↔core, đọc config bearer-token/máy + đường dẫn baseline, start WS server.
- `dashboard-backend/app/installService.ts` (MỚI) -- đăng ký/gỡ Windows Service qua SCM (xem Design Notes).
- `dashboard-backend/tests/channelState.test.ts`, `bitrateThreshold.test.ts` (MỚI) -- test core qua fake port.
- `dashboard-backend/tests/wsTelemetryAdapter.test.ts` (MỚI) -- test adapter qua `ws` client thật tới server local (mirror `test_telemetry_ws_client.cpp`).

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/package.json`, `tsconfig.json` -- khởi tạo project TS/ESM -- nền tảng build/test.
- [x] `dashboard-backend/src/ports/*.ts` -- định nghĩa 3 port -- tách domain khỏi I/O ngay từ đầu.
- [x] `dashboard-backend/src/core/channelState.ts`, `bitrateThreshold.ts` -- domain logic debounce + mapping + bitrate_pct -- lõi nghiệp vụ duy nhất.
- [x] `dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts` -- WS server + auth + lọc envelope -- nguồn dữ liệu thật.
- [x] `dashboard-backend/src/adapters/outbound/logAlertAdapter.ts`, `fileBitrateBaselineAdapter.ts`, `config/baseline.example.json` -- adapter tạm -- wiring hoàn chỉnh không cần chờ Story 2.2/Epic 4.
- [x] `dashboard-backend/src/logging/logger.ts` -- log JSON lines -- audit theo AD-30.
- [x] `dashboard-backend/app/main.ts`, `installService.ts` -- bootstrap + Windows Service -- chạy được như 1 service thật. `main.ts`: verify thật (build+test+smoke run WS end-to-end). `installService.ts`: ban đầu thử `os-service` (native SCM in-process) -- build thất bại thật trên Node 24 (log lỗi native compile), đúng điều kiện HALT của Boundaries -- đã hỏi và **người dùng quyết định chấp nhận wrapper ngoài**: chuyển sang `node-windows` (winsw.exe), giữ auto-restart qua cơ chế giám sát riêng của winsw (`wait`/`grow`/`maxRestarts`) thay vì SCM recovery action native. Đã verify: `Service` construct được đúng API (`svc.exists`, `install`/`uninstall`/`start` tồn tại), CLI load module sạch (`node dist/app/installService.js` không có lỗi import); **CHƯA** verify được install/uninstall thật + auto-restart-khi-crash thật (cần quyền admin trên máy Windows thật, môi trường build hiện tại chặn hành động sửa đổi hệ thống này -- xem Manual checks).
- [x] `dashboard-backend/tests/*.test.ts` -- test I/O matrix qua fake port + WS thật -- verify AC không cần 20 máy thật. 21/21 test pass (`npm test`).

**Acceptance Criteria:**
- [x] Given dashboard-backend đã nhận kết nối WS từ máy trung tâm đúng bearer-token, when nhận `telemetry`, then domain core tính debounce ≥5s trước khi đổi trạng thái hiển thị.
- [x] Given bearer-token sai, when máy trung tâm thử kết nối, then handshake bị reject HTTP 401/403, không tạo session.
- [x] Given domain core nhận đủ 4 giá trị `connection_state` khả dĩ, then mapping đúng `ok`/`warning`/`critical` (kèm sub-type cho `REJECTED`) theo đúng bảng đã định. (Mapping `CONNECTING` → `critical` đã được người dùng xác nhận, không còn là assumption.)
- [x] Given fake `TelemetryInboundPort`/`AlertOutboundPort`/`BitrateBaselinePort`, when chạy test core, then không cần 20+20 máy thật hay kết nối SRT thật.
- [x] Given dashboard-backend build xong, when cài làm Windows Service, then service tự khởi động lại khi crash (auto-restart qua SCM). Đạt theo quyết định đã duyệt (node-windows/winsw thay SCM recovery action native) -- code + API đã verify tĩnh; auto-restart-khi-crash THẬT chỉ verify được thủ công trên máy Windows admin thật (xem Manual checks), không tự động hoá được trong môi trường build/test hiện tại.

## Design Notes

**Windows Service [CẬP NHẬT - quyết định cuối]:** transport-core tự đăng ký SCM in-process bằng C++ Win32 API (`WindowsServiceHost.h`). Phía Node, đã thử tìm thư viện đăng ký SCM in-process tương đương trước (không qua wrapper ngoài) để giữ đúng tinh thần AD-27 "cùng cơ chế supervisor" -- thư viện duy nhất tìm được (`os-service`, native addon) build thất bại thật trên Node 24 (API V8 cũ đã bị xoá). Đây là điều kiện HALT của Boundaries; đã hỏi người dùng và **được duyệt tường minh dùng wrapper ngoài `node-windows`** (winsw.exe) thay cho cơ chế in-process. Auto-restart khi crash (AD-27) nay do winsw tự giám sát tiến trình con + tự restart (cấu hình `wait`/`grow`/`maxRestarts` trong `installService.ts`), không phải SCM's `SERVICE_CONFIG_FAILURE_ACTIONS` native -- vẫn đạt "không tự viết watchdog riêng" (watchdog là winsw.exe, một phần của thư viện npm đã cài, không phải code tự viết), chỉ khác cơ chế cụ thể so với "cùng hệt transport-core" ban đầu.

**Baseline tạm thời:** `BitrateBaselinePort` là điểm nối duy nhất sẽ đổi ở Story 2.2 — không để bất kỳ chỗ nào khác trong core/adapter inbound biết về nguồn baseline, để thay adapter không đụng domain core.

**Baseline file path [CẬP NHẬT - quyết định qua code review 2026-09-03]:** Boundaries ban đầu ghi cứng runtime đọc thẳng `config/baseline.example.json`. Implementation đổi default sang `config/baseline.json` (file thật, `.gitignore`, phải tự tạo từ mẫu `.example.json` lúc deploy) để tránh production âm thầm chạy với demo data khi quên set `DASHBOARD_BASELINE_FILE`. Đã hỏi người dùng qua code review — **được duyệt**: giữ nguyên hành vi code, cập nhật lại text Boundaries ở trên cho khớp (đã sửa).

**Ask First — `channel_id` lạ không có baseline [CẬP NHẬT - quyết định qua code review 2026-09-03]:** Code hiện xử lý bằng cách log `event_type=baseline_missing` rõ ràng rồi bỏ qua đúng lần telemetry đó (không throw, không tự tạo state cho kênh) — đây chính là 1 trong 3 lựa chọn ("bỏ qua kênh") mà Boundaries yêu cầu phải HALT hỏi trước khi chọn, nhưng chưa có bằng chứng đã hỏi trước khi code. Đã hỏi lại qua code review — **được duyệt tường minh**: giữ nguyên hành vi này làm chính sách chính thức cho Story 2.1 (channel-registry hot-reload ở Story 2.2 sẽ thay đổi cách phát hiện/khớp channel_id, không phải phạm vi renegotiate ở đây).

## Verification

**Commands:**
- `cd dashboard-backend && npm run build` -- expected: biên dịch TS sạch, không lỗi type. **Đã chạy thật: PASS** (không lỗi).
- `cd dashboard-backend && npm test` -- expected: toàn bộ test core (fake port) + test adapter (WS thật localhost) pass. **Đã chạy thật: PASS, 21/21 test** (`node --test "dist/tests/**/*.test.js"`).

**Manual checks (if no CLI):**
- Đăng ký Windows Service thủ công trên máy Windows thật (`npm run service:install` / `node dist/app/installService.js --install`, cần quyền admin), kill process, xác nhận winsw tự khởi động lại -- KHÔNG tự động hoá được trong CI/test (môi trường build hiện tại chặn hành động cài đặt service thật vì đây là thay đổi hệ thống). Đã verify tĩnh: `new Service({...})` construct đúng API, `node dist/app/installService.js` (không tham số) in đúng usage, không có lỗi resolve module `node-windows` -- xác nhận code sẵn sàng chạy, chỉ còn bước cài thật cần làm thủ công trên máy đích.
- Gỡ service thử (`node dist/app/installService.js --uninstall`) trên máy Windows thật để xác nhận uninstall cũng hoạt động, không để lại service "ma".

## Suggested Review Order

**Ranh giới telemetry -> trạng thái (domain core)**

- Entry point: điểm nối input (telemetry thô) với logic tính trạng thái hiển thị duy nhất của toàn hệ thống (AD-11).
  [`channelState.ts:65`](../../dashboard-backend/src/core/channelState.ts#L65)

- Guard 2 lớp: `connection_state` lạ (bypass validate ở adapter) bị log `connection_state_invalid` thay vì throw crash process.
  [`channelState.ts:74`](../../dashboard-backend/src/core/channelState.ts#L74)

- Debounce ≥5s + chốt trạng thái + publish đúng 1 lần/lần đổi thật sự.
  [`channelState.ts:105`](../../dashboard-backend/src/core/channelState.ts#L105)

- Mapping thuần: ngưỡng 70%, sub-type REJECTED, và nhánh `CONNECTING` đã xác nhận với người dùng.
  [`bitrateThreshold.ts:41`](../../dashboard-backend/src/core/bitrateThreshold.ts#L41)

- Exhaustiveness guard đổi từ `throw` sang trả `critical` an toàn (patch review vòng 1) -- phòng thủ lớp 1.
  [`bitrateThreshold.ts:51`](../../dashboard-backend/src/core/bitrateThreshold.ts#L51)

**Bearer-token + parse envelope (adapter inbound)**

- `rejectHandshake()`: fix crash-vector quan trọng nhất của review -- `socket.on('error')` no-op trước khi write/destroy, chặn 1 client ác ý crash cả tiến trình.
  [`wsTelemetryAdapter.ts:71`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L71)

- Validate payload chặt: `isFiniteNumber()` thay coercion `Number()` -- chặn `null`/`false`/`""`/mảng lọt qua như số hợp lệ.
  [`wsTelemetryAdapter.ts:196`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L196)

- `handleMessage()`: lọc đúng tập đóng `event_type`, chỉ forward `telemetry` hợp lệ vào core.
  [`wsTelemetryAdapter.ts:200`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L200)

- Server WS + `maxPayload` + đóng sạch client khi shutdown.
  [`wsTelemetryAdapter.ts:100`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L100)

**Bootstrap & vận hành (composition root)**

- Fix quan trọng thứ 2 của review: default baseline path đổi từ `.example.json` (demo) sang `baseline.json` thật, fail-fast rõ ràng nếu thiếu -- tránh production âm thầm không tính trạng thái cho kênh nào.
  [`main.ts:69`](../../dashboard-backend/app/main.ts#L69)

- `startApp()`: composition root nối ports/adapters/core, đọc config từ env.
  [`main.ts:50`](../../dashboard-backend/app/main.ts#L50)

- Shutdown an toàn: guard chống gọi lặp SIGINT/SIGTERM + timeout force-exit.
  [`main.ts:139`](../../dashboard-backend/app/main.ts#L139)

- Windows Service (`node-windows`/winsw, quyết định đã duyệt): lazy dynamic-import + kiểm tra build trước khi install.
  [`installService.ts:83`](../../dashboard-backend/app/installService.ts#L83)

**Test & peripherals**

- Test I/O matrix + 3 case bổ sung từ review (connection_state lạ, thiếu channel_id, payload rác).
  [`wsTelemetryAdapter.test.ts`](../../dashboard-backend/tests/wsTelemetryAdapter.test.ts)

- Test domain core qua fake port (debounce, mapping, per-channel).
  [`channelState.test.ts`](../../dashboard-backend/tests/channelState.test.ts)

- Test adapter baseline thật + adapter outbound log thật (2 file mới từ review, trước đây chưa có coverage).
  [`fileBitrateBaselineAdapter.test.ts`](../../dashboard-backend/tests/fileBitrateBaselineAdapter.test.ts), [`logAlertAdapter.test.ts`](../../dashboard-backend/tests/logAlertAdapter.test.ts)

- Cấu hình: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `config/baseline.example.json`.
  [`package.json`](../../dashboard-backend/package.json)

### Review Findings

**Decision needed:** (đã resolve — xem Design Notes)
- [x] [Review][Decision] Ask-First `channel_id` lạ không có baseline — **RESOLVED**: giữ hành vi hiện tại (log `baseline_missing`, bỏ qua) làm chính sách chính thức, đã được người dùng duyệt tường minh. Xem Design Notes "Ask First — `channel_id` lạ không có baseline". [`dashboard-backend/src/core/channelState.ts:84`](../../dashboard-backend/src/core/channelState.ts#L84)
- [x] [Review][Decision] Default `baselineFilePath` lệch text đóng băng — **RESOLVED**: giữ code, cập nhật text Boundaries cho khớp (đã sửa trong `<frozen-after-approval>`). Xem Design Notes "Baseline file path". [`dashboard-backend/app/main.ts:61-77`](../../dashboard-backend/app/main.ts#L61-L77)
- [x] [Review][Decision] SIGTERM dưới winsw chưa verify trên máy thật — **RESOLVED**: defer, xem mục Deferred bên dưới. [`dashboard-backend/app/main.ts:141`](../../dashboard-backend/app/main.ts#L141)

**Patch:** (đã áp dụng tất cả — build + 49/49 test pass)
- [x] [Review][Patch] Bổ sung comment ghi nhận quyết định đã duyệt (Ask-First channel_id lạ) ngay tại nhánh xử lý, mirror cách `installService.ts` đã ghi chú quyết định Windows Service. [`dashboard-backend/src/core/channelState.ts:84`](../../dashboard-backend/src/core/channelState.ts#L84)
- [x] [Review][Patch] `uninstallService()` không có timeout an toàn như `installService()` đã thêm cho đúng lỗi này (nhánh `node-windows` không emit event nào). Đã thêm timeout đối xứng qua `UninstallServiceDeps.timeoutMs`. [`dashboard-backend/app/installService.ts:174`](../../dashboard-backend/app/installService.ts#L174)
- [x] [Review][Patch] `parsePort()` chấp nhận `DASHBOARD_WS_PORT=""`/khoảng trắng như số `0` hợp lệ (tự hiểu "để OS tự cấp port"), che giấu khả năng biến môi trường bị set rỗng do lỗi cấu hình. Đã chặn rỗng/whitespace tường minh. [`dashboard-backend/app/main.ts:41`](../../dashboard-backend/app/main.ts#L41)
- [x] [Review][Patch] `DASHBOARD_BEARER_TOKENS` rỗng vẫn log `app_started` như thành công dù sẽ reject 100% kết nối — đã đổi sang fail-fast (throw) tại composition root. [`dashboard-backend/app/main.ts:103`](../../dashboard-backend/app/main.ts#L103)
- [x] [Review][Patch] `ctx.telemetryPort.handleTelemetry(event)` gọi trực tiếp không try/catch trong WS message handler — đã bọc try/catch, log `telemetry_handler_error`, connection vẫn sống. [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts:297`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L297)
- [x] [Review][Patch] `shutdown()` luôn `process.exit(0)` kể cả khi `app.stop()` reject — đã đổi sang `process.exit(1)` khi `stop()` reject. [`dashboard-backend/app/main.ts:187`](../../dashboard-backend/app/main.ts#L187)
- [x] [Review][Patch] Toàn bộ `app/` bootstrap layer không có test — đã export `parsePort`/`parseBearerTokens`, thêm DI (`InstallServiceDeps`/`UninstallServiceDeps`) cho `installService()`/`uninstallService()`, viết `tests/main.test.ts` (5 test) + `tests/installService.test.ts` (9 test, gồm regression test cho đúng bug patch #1). [`dashboard-backend/tests/main.test.ts`](../../dashboard-backend/tests/main.test.ts), [`dashboard-backend/tests/installService.test.ts`](../../dashboard-backend/tests/installService.test.ts)
- [x] [Review][Patch] `close()` chỉ terminate `wss.clients`, không tự đóng kết nối HTTP keep-alive thô trên `httpServer` — đã thêm `httpServer.closeAllConnections()`. [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts:174`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L174)
- [x] [Review][Patch] Guard `socket.on('error', noop)` trong `rejectHandshake()` chưa có test mô phỏng race client rớt kết nối giữa chừng — đã thêm test dùng raw TCP socket + `resetAndDestroy()`. [`dashboard-backend/tests/wsTelemetryAdapter.test.ts`](../../dashboard-backend/tests/wsTelemetryAdapter.test.ts)
- [x] [Review][Patch] `isDirectRun` bị lặp y hệt ở `main.ts` và `installService.ts` — đã tách helper dùng chung `isDirectRunEntrypoint()`. [`dashboard-backend/app/isDirectRun.ts`](../../dashboard-backend/app/isDirectRun.ts)

**Deferred:**
- [x] [Review][Defer] SIGTERM dưới `node-windows`/winsw chưa verify có thực sự gửi tín hiệu Node bắt được khi `net stop`/SCM dừng service hay không [`dashboard-backend/app/main.ts:141`] — deferred, cần máy Windows admin thật để verify (giống các item epic-1 retro cần hardware thật), theo dõi lại khi có môi trường deploy thật.
- [x] [Review][Defer] Không có WS ping/pong keep-alive để phát hiện kết nối "chết" nửa chừng [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts`] — deferred, thuộc scope Story 2.7 (disconnected/machine-offline).
- [x] [Review][Defer] `envelope.schema_version` nhận nhưng chưa validate/log khi lệch [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts`] — deferred, cải tiến observability ngoài AC của story này.
- [x] [Review][Defer] Adapter chỉ validate kiểu dữ liệu (không validate dấu/khoảng) cho `rtt_ms`/`bitrate_kbps`; range-guard nằm ở core thay vì adapter [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts`] — deferred, chưa gây sai lệch hành vi thật (`rtt_ms` hiện chưa được dùng ở đâu khác).
- [x] [Review][Defer] So sánh bearer-token không constant-time [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts`] — deferred, ưu tiên thấp do LAN/VPN nội bộ không expose internet.
- [x] [Review][Defer] Chưa có log rotation/size bound [`dashboard-backend/src/logging/logger.ts`] — deferred, thuộc cấu hình vận hành winsw, ngoài scope code story này.
