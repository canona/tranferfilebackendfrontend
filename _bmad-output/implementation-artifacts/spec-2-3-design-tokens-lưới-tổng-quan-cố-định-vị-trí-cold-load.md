---
title: 'Story 2.3: Design tokens & lưới tổng quan cố định vị trí (cold-load)'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `dashboard-frontend/` chưa tồn tại. Backend chưa có đường đẩy dữ liệu ra browser (`AlertOutboundPort` chỉ có adapter log — Story 2.1) và `ChannelRegistryPort.getEntry()` chỉ tra được 1 kênh, không liệt kê được cả 20 kênh để dựng lưới cố định vị trí.

**Approach:** Dựng mới `dashboard-frontend/` (React 19.2 qua Next.js + TypeScript) render lưới 5×4 cố định theo `grid_position`. Thêm 1 WS server mới trong dashboard-backend (cổng riêng, KHÔNG auth — LAN-only theo ràng buộc kiến trúc) phát `registry-snapshot` lúc connect (toàn bộ 20 kênh) và tín hiệu `channel-seen` riêng biệt khỏi debounce 5s ngay khi có telemetry đầu tiên/kênh, để ô chuyển skeleton→loaded-neutral (chưa có màu trạng thái/badge — thuộc Story 2.4). Định nghĩa design tokens (dark-only) làm CSS custom properties đúng `DESIGN.md`.

## Boundaries & Constraints

**Always:**
- `ChannelRegistryPort` thêm method mới `listEntries(): ReadonlyArray<ChannelRegistryEntry & {channelId: string}>` — CHỈ thêm, không đổi signature/hành vi `getEntry()` hiện có.
- Port mới `UiOutboundPort` (1 method `publishChannelSeen(channelId: string, timestamp: string): void`) — tách biệt hoàn toàn `AlertOutboundPort` (tín hiệu "đã thấy kênh" thô, không phải trạng thái đã tính).
- `channelState.ts`: khi nhận telemetry cho `channel_id` CHƯA từng có record nội bộ → gọi `uiPort.publishChannelSeen` NGAY (không chờ debounce 5s); không đổi mapping/debounce hiện có.
- Adapter mới `wsUiAdapter.ts`: WS server cổng riêng (env `DASHBOARD_UI_WS_PORT`), không xác thực. Lúc client connect: gửi `registry-snapshot` (từ `listEntries()`) rồi replay `channel-seen` cho mọi kênh đã seen trước đó (Set nội bộ) — client connect muộn không bị kẹt skeleton.
- `main.ts`: khởi tạo/`start()`/`stop()` `WsUiAdapter` song song các adapter khác; wiring `uiPort` vào `ChannelStateService`.
- `dashboard-frontend/`: cấu trúc `src/{components,state,services}` đúng ARCHITECTURE-SPINE; Next.js App Router chỉ bọc ngoài 1 page duy nhất. Design tokens tại `src/styles/tokens.css`, copy đúng giá trị `DESIGN.md` (màu/typography/spacing/rounded), không tải font ngoài.
- `channel-grid-cell` suy `row/col` từ `grid_position` qua `Math.floor(pos/5)`/`pos%5`; luôn render đủ 20 ô đúng vị trí, không phụ thuộc thứ tự event.
- Test: backend dùng `node:test` (mirror convention); frontend dùng Vitest + `@testing-library/react` (công cụ test FE đầu tiên của repo).

**Ask First:** Nếu cấu trúc lưu trữ nội bộ hiện tại của `fileChannelRegistryAdapter.ts` không đủ để implement `listEntries()` chỉ bằng cách đọc thêm (cần đổi cấu trúc Map đang phục vụ) — HALT hỏi trước khi đổi, không tự tái cấu trúc.

**Never:** Đổi mapping trạng thái/alert-badge/VU-meter/thumbnail (Story 2.4/2.5). Thêm auth cho WS UI mới (đã chốt: không auth, LAN-only). Server-side data fetching/SSR cho dữ liệu kênh ở Next.js — toàn bộ qua WS client-side. Đổi `bitrateThreshold.ts` hay logic debounce (Story 2.1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| App vừa mở, WS UI connect | Client connect `DASHBOARD_UI_WS_PORT` | Nhận `registry-snapshot` ngay, render 20 ô skeleton đúng vị trí | N/A |
| Kênh đầu tiên gửi telemetry | Telemetry đến lần đầu/`channel_id` | Backend publish `channel-seen` ngay, không chờ 5s | N/A |
| Frontend connect muộn | Client connect sau khi backend đã seen 5/20 kênh | Replay `channel-seen` cho cả 5 kênh ngay sau `registry-snapshot` | N/A |
| WS UI client mất kết nối | Client disconnect/tab đóng | Adapter dọn khỏi danh sách broadcast | Log, không throw/crash |
| Telemetry với `channel_id` lạ | Không có trong registry | KHÔNG publish `channel-seen` | Giữ nguyên log `channel_unregistered` (Story 2.2) |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/ports/ChannelRegistryPort.ts` -- thêm `listEntries()`.
- `dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts` -- implement `listEntries()` từ Map nội bộ đang phục vụ.
- `dashboard-backend/src/ports/UiOutboundPort.ts` (MỚI) -- interface `publishChannelSeen`.
- `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts` (MỚI) -- WS server riêng, `registry-snapshot` + replay `channel-seen`, implement `UiOutboundPort`.
- `dashboard-backend/src/core/channelState.ts` (khu vực `handleTelemetry`) -- nhánh "first-seen" gọi `uiPort.publishChannelSeen`.
- `dashboard-backend/app/main.ts` -- env `DASHBOARD_UI_WS_PORT`, khởi tạo/`start()`/`stop()` `WsUiAdapter`, wiring.
- `dashboard-backend/tests/` -- test mới: `listEntries`, timing `channel-seen` (trước 5s), `wsUiAdapter` snapshot/replay.
- `dashboard-frontend/` (MỚI toàn bộ) -- Next.js+TS: `app/page.tsx`, `src/components/{ChannelGrid,ChannelGridCell}.tsx`, `src/state/channelStore.ts`, `src/services/uiWsClient.ts`, `src/styles/tokens.css`.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/ports/ChannelRegistryPort.ts`, `fileChannelRegistryAdapter.ts` -- thêm `listEntries()` -- nguồn dữ liệu duy nhất cho registry-snapshot.
- [x] `dashboard-backend/src/ports/UiOutboundPort.ts`, `src/adapters/outbound/wsUiAdapter.ts` -- WS server UI mới -- kênh vận chuyển tới frontend, tách khỏi WS máy trung tâm.
- [x] `dashboard-backend/src/core/channelState.ts` -- publish `channel-seen` first-seen, tách debounce -- khớp AC "~1-2 giây", không đổi mapping trạng thái.
- [x] `dashboard-backend/app/main.ts` -- wiring `WsUiAdapter` -- composition root hoàn chỉnh.
- [x] `dashboard-backend/tests/*.test.ts` -- cover I/O matrix -- verify không hồi quy Story 2.1/2.2.
- [x] `dashboard-frontend/` scaffold Next.js+TS, `tokens.css`, `ChannelGrid`/`ChannelGridCell`, `uiWsClient`, `channelStore` -- lõi của story.

**Acceptance Criteria:**
- Given dashboard-frontend kết nối WS tới dashboard-backend, when app vừa mở (cold-load), then toàn bộ 20 ô hiện skeleton; từng ô chuyển sang loaded-neutral ngay khi kênh đó có telemetry, không chờ đủ 20 kênh (~1-2 giây).
- Given `grid_position` trong channel-registry, when render lưới, then vị trí ô khớp đúng tuyệt đối, không lấy từ thứ tự event/telemetry, không kéo-thả/sắp xếp lại ở bất kỳ trạng thái nào.
- Given design tokens trong `DESIGN.md`, when áp dụng vào `dashboard-frontend`, then màu (dark-only)/typography (system-ui, không tải font ngoài)/spacing (bội số 4px + `cell-gap`)/rounded (`sm/md/lg/pill`) khớp đúng giá trị token.

### Review Findings

- [x] [Review][Patch] Trước khi `registry-snapshot` đầu tiên tới, lưới render 0 ô thay vì 20 ô skeleton — render sẵn 20 vị trí skeleton tổng quát (không cần định danh kênh, chỉ cần `gridPosition` 0-19 cố định) ngay lúc mount, trước khi có dữ liệu registry, để khớp đúng AC "app vừa mở (cold-load) → toàn bộ 20 ô hiện skeleton" (quyết định bởi user: patch ngay). [dashboard-frontend/src/state/channelStore.ts:38, dashboard-frontend/src/components/ChannelGrid.tsx:21, dashboard-frontend/app/page.tsx] — đã fix: `ChannelGrid.tsx` render 20 placeholder skeleton khi `channels.length===0`; `ChannelGridCell.tsx` xử lý `aria-label` khi `stationName` rỗng.
- [x] [Review][Patch] Không có test cho việc `startApp()` đọc `DASHBOARD_UI_WS_PORT`/`uiHost` (fallback về `host`) qua biến môi trường — mọi test trong `main.test.ts` đều override `uiPort`/`uiHost` qua `config`, nhánh env-var/fallback thật (dùng bởi `main()` production) không được test chạm tới, cùng lớp rủi ro mà code review trước đã bắt cho `DASHBOARD_WS_PORT`. [dashboard-backend/app/main.ts:93-95, dashboard-backend/tests/main.test.ts] — đã fix: thêm 3 test (env var đọc đúng/reject khi sai/`uiHost` fallback đúng qua verify connect thật tới `127.0.0.2`); nhân tiện phát hiện + sửa `parsePort()` hardcode sai tên biến trong thông báo lỗi (luôn nói "DASHBOARD_WS_PORT" kể cả khi validate `DASHBOARD_UI_WS_PORT`) — thêm tham số `varName`.
- [x] [Review][Patch] `loadAndValidate()` không strip BOM (`﻿`) trước khi `JSON.parse(raw)` — file `channel-registry.json` lưu bằng Notepad trên Windows (môi trường triển khai thực tế) sẽ có BOM và fail load với lỗi "không phải JSON hợp lệ" chung chung thay vì load đúng. [dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts:160-168] — đã fix: strip `﻿` trước `JSON.parse`.
- [x] [Review][Patch] Không có test cho trạng thái ban đầu thật của `ChannelGrid` (`channels=[]`, tức thời điểm trước khi `registry-snapshot` tới) — mọi test hiện có đều hard-code sẵn 20 (hoặc 2) kênh, chưa xác nhận trạng thái rỗng ban đầu render đúng/không crash. [dashboard-frontend/tests/ChannelGrid.test.tsx] — đã fix: thêm test verify 20 ô skeleton placeholder đúng vị trí 0-19 khi `channels=[]`.
- [x] [Review][Defer] Cả 2 WS server (telemetry + UI) mặc định bind `0.0.0.0` thay vì giới hạn theo interface LAN — WS UI không auth (đã chốt LAN-only) có thể lọt ra ngoài LAN dự kiến trên host dual-homed/VPN. [dashboard-backend/app/main.ts, dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts] — deferred, pre-existing pattern từ Story 2.1, không phải do thay đổi lần này.

**Re-xác nhận (không log lại):** 3 finding của vòng review này trùng với mục đã defer ở vòng review 2026-09-04 (xem `deferred-work.md`), vẫn còn mở, chưa fix — không tạo bản ghi mới: `connectUiWsClient` không reconnect/không có listener `close`/`error`; `wsUiAdapter` không rebroadcast `registry-snapshot` khi hot-reload; `findDuplicateTopLevelKey` so khớp text chưa decode escape.

### Review Findings — Round 2 (2026-09-06, review lại 6 file vừa patch)

- [x] [Review][Patch] Không có test hồi quy cho BOM-strip fix (round 1) — cả 3 layer review (Blind Hunter, Verification Gap, Acceptance Auditor) đều hội tụ vào cùng 1 gap này. [dashboard-backend/tests/fileChannelRegistryAdapter.test.ts] — đã fix: thêm 2 test (BOM lúc khởi động + BOM lúc reload), verify không rơi vào `registry_reload_error`.
- [x] [Review][Patch] Placeholder cell key theo `placeholder-${gridPosition}`, cell thật key theo `channelId` — key khác nhau hoàn toàn khiến React unmount/remount toàn bộ 20 node DOM đúng lúc `registry-snapshot` đầu tiên tới, có thể gây "flash" — vi phạm tinh thần epic-2-context.md "Không animation/transition gây xao nhãng khi đổi trạng thái trên lưới". [dashboard-frontend/src/components/ChannelGrid.tsx:49] — đã fix: đổi `key` sang `channel.gridPosition` (cố định 0-19, không đổi qua mọi trạng thái) cho cả 2 nhánh, giữ nguyên DOM node khi chuyển skeleton→loaded thật.
- [x] [Review][Defer] BOM-fix chỉ xử lý UTF-8 BOM (`﻿` sau decode `utf8`) — Notepad trên Windows còn có tùy chọn lưu UTF-16 ("Unicode"), decode bằng `utf8` sẽ ra mojibake thay vì BOM sạch, regex không khớp. [dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts:112] — deferred, fix đúng nghĩa cần đọc Buffer + sniff BOM byte trước khi chọn encoding decode (thay đổi lớn hơn phạm vi patch BOM hiện tại); Windows 10/11 Notepad hiện mặc định UTF-8, rủi ro thấp hơn giả định ban đầu.
- [x] [Review][Defer] `chokidar`'s `watcher.on('error', ...)` chỉ log `registry_watch_error`, không tự đóng+tái tạo lại watcher — nếu chokidar tự phát lỗi thật (hiếm hơn kịch bản atomic-rename mà chokidar đã giải quyết), hot-reload có thể "chết lặng" vĩnh viễn tới khi restart process. [dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts] — deferred, pre-existing từ Story 2.2 (không phải do patch round 2), cùng nhóm rủi ro với Ask First đã ghi ở Story 2.2.
- [x] [Review][Defer] `main.ts`: nhánh cleanup khi bind telemetry thất bại SAU KHI UI đã bind (`registryPort.stop(); await ui.close(); throw err;`) — nếu `ui.close()` tự reject, lỗi gốc `err` (nguyên nhân thật của bind fail) bị thay thế bởi lỗi cleanup không liên quan. [dashboard-backend/app/main.ts] — deferred, pre-existing từ round 1 (không phải do patch round 2, chỉ lộ ra khi review lại toàn bộ file).
- [x] [Review][Defer] `AppHandle.stop()` gọi `ui.close()`/`ws.close()` tuần tự không cô lập — nếu `ui.close()` treo/reject, `ws.close()` không bao giờ chạy, rò rỉ WS server telemetry lúc lẽ ra phải graceful shutdown. [dashboard-backend/app/main.ts] — deferred, pre-existing từ round 1.
- [x] [Review][Defer] 2 test EADDRINUSE trong `main.test.ts` verify cleanup qua side-effect Windows-specific (`rmSync` EBUSY/EPERM nếu watcher chưa đóng) không kèm OS-guard — trên non-Windows runner, assertion có thể pass bất kể cleanup có chạy hay không. [dashboard-backend/tests/main.test.ts] — deferred, pre-existing từ round 1; dịch vụ này chỉ triển khai trên Windows (Windows Service qua winsw), rủi ro portability thấp trong thực tế.
- [x] [Review][Defer] Kích thước lưới (20 ô / 5 cột / 0-19) được hard-code lặp lại độc lập ở 3 nơi không chia sẻ nguồn chân lý chung: `GRID_SIZE` (`ChannelGrid.tsx`), `GRID_COLUMNS` (`ChannelGridCell.tsx`), `GRID_POSITION_MIN/MAX` (backend `fileChannelRegistryAdapter.ts`). [dashboard-frontend/src/components/ChannelGrid.tsx, ChannelGridCell.tsx, dashboard-backend/.../fileChannelRegistryAdapter.ts] — deferred, cải tiến kiến trúc (cần module hằng số dùng chung xuyên frontend/backend), không blocking, kích thước lưới không đổi trong roadmap hiện tại (AD-19 mở rộng số kênh, không đổi 5x4).
- [x] [Review][Defer] 20 ô placeholder skeleton dùng chung 1 `aria-label="Đang tải kênh"` — không có cue vị trí/index phân biệt cho screen-reader; `ChannelGrid`'s `role="grid"` cũng thiếu `role="row"` trung gian theo đúng ARIA grid pattern. [dashboard-frontend/src/components/ChannelGrid.tsx, ChannelGridCell.tsx] — deferred, thuộc phạm vi FR-14/accessibility AA đầy đủ đã lược bớt khỏi pilot, hoàn thiện ở Epic 5 (epic-2-context.md).
- [x] [Review][Defer] `isNonEmptyString()` trim để validate nhưng lưu giá trị GỐC chưa trim (`station_name`/`contact_name`/`contact_phone`) — 1 giá trị có khoảng trắng đầu/cuối (vd `" Đài 1 "`) qua được validate nhưng khoảng trắng đó lộ ra tận UI/aria-label. [dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts] — deferred, pre-existing từ Story 2.2, cosmetic, cùng nhóm rủi ro thao tác con người khi điền registry thủ công đã ghi nhận trước đó.

**Dismissed (round 2, không phải lỗi thật):** `ChannelGridCell`'s aria-label nhánh `loaded===true` + `stationName` rỗng (latent, unreachable — placeholder không bao giờ được `seenChannelIds` đánh dấu `loaded`, backend luôn validate `station_name` non-empty cho channel thật); placeholder `channelId` trùng tên với 1 channel thật đặt tên literal `"placeholder-N"` (lý thuyết thuần, admin tự đặt tên registry); `findDuplicateTopLevelKey` không xét trùng field lồng bên trong 1 entry (đã defer từ vòng trước, re-surface không phải finding mới); "luôn render đủ 20 ô" (Boundaries) vs. test 2-kênh chỉ render 2 ô (đã xác nhận compliant từ round 1 — registry thật luôn đủ 20 entry đã validate, hành vi này chỉ phục vụ fixture dev/test); lo ngại `channelStore.ts`/`page.tsx` không nằm trong diff round 2 nên chưa verify EMPTY_STATE — đã tự xác nhận độc lập: `channelStore.ts:38` khởi tạo đúng `channels: []`, khớp giả định của `ChannelGrid.tsx`.

## Design Notes

**Vì sao `UiOutboundPort` tách khỏi `AlertOutboundPort`:** `channel-seen` là tín hiệu thô "đã nhận ≥1 event/kênh", phát ngay (~1s, khớp tần suất telemetry thật); `AlertOutboundPort.publishStateChange` chỉ phát sau debounce 5s và chỉ khi trạng thái thực sự đổi — dùng chung 1 port sẽ trộn 2 timing/semantic khác nhau, và cell "loaded" của Story 2.3 chưa cần biết `ok/warning/critical` (đó là Story 2.4).

**Next.js App Router vs cấu trúc `src/{components,state,services}` đã chốt ở ARCHITECTURE-SPINE:** giữ nguyên 3 thư mục đó bên trong `src/`, Next.js chỉ đóng vai trò build/dev-server + 1 `app/page.tsx` lắp ráp component — không tái cấu trúc theo file-based routing (không cần route nào khác ngoài 1 màn hình gốc).

## Verification

**Commands:**
- `cd dashboard-backend && npm run build && npm test` -- expected: build sạch, toàn bộ test cũ + mới pass.
- `cd dashboard-frontend && npm run build` -- expected: Next.js production build sạch.
- `cd dashboard-frontend && npm test` -- expected: Vitest pass (20 ô đúng vị trí, skeleton→loaded-neutral khi nhận `channel-seen`).

**Manual checks:**
- Chạy dashboard-backend + dashboard-frontend dev với `config/channel-registry.example.json`; xác nhận 20 ô đúng vị trí; giả lập telemetry 1 kênh, xác nhận ô đó rời skeleton trong ~1-2 giây mà không chờ 19 kênh còn lại.

## Suggested Review Order

**WS UI mới cho frontend (cổng riêng, không auth) — ranh giới kiến trúc cốt lõi của story**

- Entry point: WS server outbound MỚI, tách hoàn toàn khỏi WS máy trung tâm (auth/payload khác nhau).
  [`wsUiAdapter.ts:84`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L84)

- Root-cause fix (code review): `ws`'s auto error-listener re-emit không ai nghe → throw đồng bộ, Promise không bao giờ settle, process treo vĩnh viễn.
  [`wsUiAdapter.ts:102-125`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L102-L125)

- `registry-snapshot` + replay `channel-seen` ngay lúc connect — bootstrap toàn bộ cold-load cho client mới/muộn.
  [`wsUiAdapter.ts:127-137`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L127-L137)

- Lỗi khởi động chỉ reject qua `once`, lỗi runtime sau bind mới log thường trực (code review) — tránh log trùng.
  [`wsUiAdapter.ts:158-173`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L158-L173)

**Tín hiệu "channel-seen" tách khỏi debounce 5s**

- First-seen branch trong `handleTelemetry`: publish NGAY khi có telemetry đầu tiên/kênh, độc lập hoàn toàn debounce/mapping trạng thái đã có; bọc try/catch (code review) để lỗi `uiPort` không làm lỡ phần xử lý phía sau.
  [`channelState.ts:112-139`](../../dashboard-backend/src/core/channelState.ts#L112-L139)

**Registry listing cho frontend**

- `listEntries()` mới — nguồn dữ liệu DUY NHẤT cho `registry-snapshot`, không đổi `getEntry()` hiện có.
  [`ChannelRegistryPort.ts:37-43`](../../dashboard-backend/src/ports/ChannelRegistryPort.ts#L37-L43)

- Implement bằng cách đọc thêm từ Map nội bộ đang phục vụ — không cần đổi cấu trúc lưu trữ, không Ask First.
  [`fileChannelRegistryAdapter.ts:237-239`](../../dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts#L237-L239)

**Composition root (wiring)**

- WS UI khởi động TRƯỚC `ChannelStateService` (`uiPort` là dependency bắt buộc); dọn `registryPort` nếu bind UI thất bại.
  [`main.ts:185-191`](../../dashboard-backend/app/main.ts#L185-L191)

- Nếu bind telemetry thất bại SAU KHI UI đã bind OK — dọn cả `registryPort` lẫn `ui`, tránh rò rỉ khi `startApp()` được gọi lại trong-process.
  [`main.ts:211-217`](../../dashboard-backend/app/main.ts#L211-L217)

**Frontend: grid cố định vị trí + cold-load (dashboard-frontend/, hoàn toàn mới)**

- Entry point frontend: page gốc DUY NHẤT, kết nối WS client-side, không SSR/data fetching phía server.
  [`page.tsx:19-30`](../../dashboard-frontend/app/page.tsx#L19-L30)

- `connectUiWsClient`: bọc try/catch quanh `new WebSocket()` (code review) — URL cấu hình sai không crash trắng React tree.
  [`uiWsClient.ts:111-125`](../../dashboard-frontend/src/services/uiWsClient.ts#L111-L125)

- `applyUiWsMessage` — parser thuần, validate `grid_position` nguyên 0-19 (code review, phòng thủ lớp 2), bỏ qua âm thầm message hỏng/lạ.
  [`uiWsClient.ts:39-53`](../../dashboard-frontend/src/services/uiWsClient.ts#L39-L53)

- `gridPositionToRowCol` + đặt tường minh `gridRow`/`gridColumn` per-cell — vị trí tuyệt đối, không phụ thuộc thứ tự event/DOM.
  [`ChannelGridCell.tsx:18-23`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L18-L23)

- Design tokens dark-only copy nguyên văn `DESIGN.md` — nền tảng style dùng chung cho Story 2.4/2.5/2.7.
  [`tokens.css:10`](../../dashboard-frontend/src/styles/tokens.css#L10)

**Peripherals**

- Test WS UI mới: registry-snapshot, replay connect-muộn, idempotent, broadcast đa-client, disconnect cleanup.
  [`wsUiAdapter.test.ts:1`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L1)

- Test cleanup khi bind UI/telemetry xung đột cổng — bằng chứng `registryPort.stop()` thực sự chạy.
  [`main.test.ts:152`](../../dashboard-backend/tests/main.test.ts#L152)

- Test frontend: vị trí không phụ thuộc thứ tự mảng, skeleton→loaded-neutral độc lập theo từng kênh.
  [`ChannelGrid.test.tsx:32`](../../dashboard-frontend/tests/ChannelGrid.test.tsx#L32)

- `dashboard-frontend/README.md` (mới) — vận hành/env var `NEXT_PUBLIC_DASHBOARD_UI_WS_URL`.
  [`README.md:29`](../../dashboard-frontend/README.md#L29)
