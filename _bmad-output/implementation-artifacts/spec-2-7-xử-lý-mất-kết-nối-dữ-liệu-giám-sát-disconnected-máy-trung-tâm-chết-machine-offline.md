---
title: 'Story 2.7: Xử lý mất kết nối dữ liệu giám sát (disconnected) & máy trung tâm chết (machine-offline)'
type: 'feature'
created: '2026-09-06'
status: 'done'
baseline_commit: '40f4e86368826c7d9796ae9c406e55886274db54'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi kênh WS UI (dashboard-frontend ↔ dashboard-backend, Story 2.3/2.6) đứt, `page.tsx` không có tín hiệu nào — lưới đứng yên âm thầm, đội trực không biết dữ liệu đã cũ. Riêng biệt: nếu 1 `ChannelActor` (= 1 máy trung tâm, quan hệ 1-1 theo `center_main.exe`) treo/chết nhưng kết nối WS tới backend chưa đứt, `channelState.ts` không có cách nào phát hiện — kênh đó kẹt vĩnh viễn ở trạng thái cũ (có thể `ok`) dù máy đã chết, vì không còn telemetry mới nào chạm tới `applyCandidate`.

**Approach:** Frontend (`uiWsClient.ts`) tự phát hiện `ws.onclose`/`onerror`, cập nhật `connectionStatus` vào `channelStore.ts`, tự reconnect (retry cố định); `page.tsx` hiện `ConnectionBanner` (mới) full-width + `grid-overlay` khi disconnected, tự ẩn khi reconnect — không cần reload. Backend: `channelState.ts` track `lastHeartbeatAt`/kênh qua heartbeat event (đã tới nhưng bị bỏ qua ở `wsTelemetryAdapter.ts`, event-driven per-`ChannelActor` mỗi 5s, độc lập `connection_state`); 1 timer chủ động (`checkHeartbeatTimeouts`, gọi mỗi 1s từ `main.ts`) phát `machine-offline` (subType mới, badge/label riêng, tái dùng style `critical`) khi im lặng ≥15s (3×5s), tự phục hồi khi heartbeat resume.

## Boundaries & Constraints

**Always:**
- `channel_id` CHÍNH LÀ định danh máy trung tâm (1-1, đã xác nhận) — heartbeat track thẳng theo `channelId`, KHÔNG thêm field `machineId`/registry mới.
- Backend: heartbeat qua `HeartbeatInboundPort` mới (mirror `TelemetryInboundPort`); `channelState.ts` thêm `lastHeartbeatAt`/`machineOfflineActive` vào `ChannelRecord` hiện có (Map theo `channelId`, KHÔNG Map riêng). `checkHeartbeatTimeouts()` public, gọi từ ngoài (real `setInterval` ở `main.ts` production, gọi trực tiếp ở test) — KHÔNG tự `setInterval` bên trong `channelState.ts` (giữ core thuần, dễ test bằng `FakeClock`).
- Timeout kích hoạt (`now - lastHeartbeatAt >= 15000`) publish `{channelId, displayState:'critical', subType:'machine-offline', timestamp}` qua `alertPort` — ĐỘC LẬP hoàn toàn `record.committed`/debounce 5s hiện có (Never mục dưới), không đổi `bitrateThreshold.ts`. Khi heartbeat resume sau khi đang `machineOfflineActive`: clear flag, re-publish `record.committed` hiện tại (nếu có) để badge trả về đúng trạng thái telemetry thật, không kẹt ở machine-offline.
- `AlertOutboundPort.ts`'s `ChannelStateChange.subType` mở rộng union thêm `'machine-offline'` (giữ nguyên `'config-or-security-suspected'`).
- Frontend: `channelStore.ts` thêm `connectionStatus: 'connected'|'disconnected'` (mặc định `'connected'`, lạc quan lúc mount) + `lastConnectedAt: string|null` (ISO, cập nhật mỗi lần `ws.onopen`) + `channelMachineOffline: ReadonlySet<string>`. `applyChannelDisplayStateChange(channelId, displayState, subType?)` (mở rộng tham số): `subType==='machine-offline'` → thêm channelId vào set; mọi giá trị khác (kể cả undefined) → gỡ khỏi set (đối xứng cơ chế phục hồi backend).
- `uiWsClient.ts`: `connectUiWsClient` tự reconnect khi `onclose`/`onerror` (retry cố định, ví dụ 2000ms — LAN-only, không cần backoff luỹ thừa), gọi `store.setConnectionStatus('disconnected')` ngay khi đứt, `'connected'` + refresh `lastConnectedAt` khi `onopen` (kể cả lần đầu). Hàm dọn dẹp trả về PHẢI chặn mọi lần reconnect còn treo sau khi gọi (cờ `disposed`).
- `ConnectionBanner.tsx` (mới): full-width, `position: fixed; top:0`, nền `state-critical`/chữ `on-state-critical` (đúng token DESIGN.md), hiện giờ `lastConnectedAt` dạng `HH:mm`; ẩn hoàn toàn khi `connectionStatus==='connected'`. `grid-overlay` (`color-mix(in srgb, surface-base 70%, transparent)`) phủ `channel-grid` khi disconnected — không tự nội suy/đổi số liệu bên dưới (dữ liệu tự đứng yên vì không còn message mới tới).
- `ChannelGridCell.tsx` thêm prop `subType?: 'machine-offline'`: khi `effectiveDisplayState==='critical'` và `subType==='machine-offline'`, badge dùng label riêng (khác `'✕ MẤT TÍN HIỆU'`) nhưng NGUYÊN style/token `critical` (viền/nền/màu chữ) — không thêm token màu mới (khớp "không phụ thuộc màu đơn lẻ" đã có).

**Never:** Đổi debounce 5s/`bitrateThreshold.ts`'s mapping ok/warning/critical. Track/hiển thị `machine-offline` cho `config-or-security-suspected` hay ngược lại (2 subType độc lập). Thêm field `machineId`/registry mới. Exponential backoff cho reconnect WS UI (LAN, giữ đơn giản). Render/xử lý subType `'config-or-security-suspected'` trên UI (vẫn treo Ask First từ Story 2.4/2.6, ngoài scope). Đổi giao thức WS telemetry↔transport-core hay bearer-token.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| WS UI đứt | `ws.onclose` fires | `connectionStatus='disconnected'`, banner+overlay hiện ngay, số liệu đứng yên | Tự reconnect retry cố định, không throw |
| WS UI phục hồi | reconnect thành công, `ws.onopen` | `connectionStatus='connected'`, banner/overlay ẩn ngay, `registry-snapshot` mới tới như connect thường | N/A |
| Heartbeat im lặng ≥15s/kênh | `lastHeartbeatAt` quá hạn, `checkHeartbeatTimeouts()` chạy | Publish `critical`+`machine-offline`; `ChannelGridCell` đổi badge label riêng, giữ style critical | Không throw, không chặn kênh khác |
| Heartbeat resume sau machine-offline | Heartbeat mới tới khi `machineOfflineActive=true` | Clear flag, re-publish `record.committed` hiện tại (badge trả về đúng trạng thái telemetry thật) | N/A |
| Heartbeat cho channel_id lạ | `channel_id` không có trong registry | Bỏ qua, log `channel_unregistered` (mirror telemetry) | Không throw |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/ports/HeartbeatInboundPort.ts` (MỚI) -- mirror `TelemetryInboundPort.ts`: `handleHeartbeat(channelId: string, timestamp: string): void`.
- `dashboard-backend/src/ports/AlertOutboundPort.ts:17` -- `subType` union thêm `'machine-offline'`.
- `dashboard-backend/src/core/channelState.ts:37-40,58` -- `ChannelRecord` thêm `lastHeartbeatAt?: number; machineOfflineActive?: boolean`; class implement thêm `HeartbeatInboundPort`; thêm `handleHeartbeat()`, `checkHeartbeatTimeouts()`, `export const HEARTBEAT_TIMEOUT_MS = 15000`.
- `dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts:41-50,242-248` -- `WsTelemetryAdapterOptions`/`MessageContext` thêm `heartbeatPort: HeartbeatInboundPort`; nhánh `eventType==='heartbeat'` forward `envelopeChannelId` + envelope timestamp qua port thay vì `return` im lặng.
- `dashboard-backend/app/main.ts:275-282,318-323` -- wire `channelStateService` làm `heartbeatPort`; thêm `setInterval(() => channelStateService.checkHeartbeatTimeouts(), 1000)`, `clearInterval` trong `stop()`.
- `dashboard-frontend/src/services/uiWsClient.ts:42-48,93-112,162-176` -- `sub_type`/`isValidSubType` mở rộng `'machine-offline'`; `applyUiWsMessage` truyền `parsed.sub_type`; `connectUiWsClient` thêm `onclose`/`onerror`/reconnect + cập nhật `connectionStatus`/`lastConnectedAt`.
- `dashboard-frontend/src/state/channelStore.ts:28-40,87-91` -- thêm field `connectionStatus`/`lastConnectedAt`/`channelMachineOffline`; `setConnectionStatus()`; mở rộng `applyChannelDisplayStateChange` nhận `subType?`.
- `dashboard-frontend/src/components/ChannelGridCell.tsx:40-44,122-137,255-262` -- prop `subType?`; badge label override khi `machine-offline`, giữ nguyên `CELL_STATE_CLASS`/`BADGE_CLASS.critical`.
- `dashboard-frontend/src/components/ChannelGrid.tsx:13-25,72-77` -- prop `channelMachineOffline: ReadonlySet<string>`, truyền `subType` xuống cell.
- `dashboard-frontend/src/components/ConnectionBanner.tsx` + `.module.css` (MỚI) -- banner + `grid-overlay`, đúng token DESIGN.md dòng 141-146/227.
- `dashboard-frontend/app/page.tsx:8-11,59-66` -- đọc `connectionStatus`/`lastConnectedAt`/`channelMachineOffline`; bọc `ChannelGrid` + `ConnectionBanner`.
- Tests: `wsTelemetryAdapter.test.ts`, `channelState.test.ts` (FakeClock cho timeout), `main.test.ts` (backend); `uiWsClient.test.ts` (fake timers cho reconnect), `channelStore.test.ts`, `ChannelGridCell.test.tsx`, `ChannelGrid.test.tsx`, `page.test.tsx` (frontend).

## Tasks & Acceptance

**Execution:**
- [x] `HeartbeatInboundPort.ts` -- port mới -- tách heartbeat khỏi telemetry, mirror pattern hexagonal hiện có.
- [x] `AlertOutboundPort.ts` -- mở rộng `subType` -- cho phép `machine-offline` đi qua wire.
- [x] `channelState.ts` -- `handleHeartbeat`/`checkHeartbeatTimeouts`/timeout constant -- lõi phát hiện máy chết, độc lập debounce telemetry.
- [x] `wsTelemetryAdapter.ts` -- forward `heartbeat` qua port mới -- ngừng bỏ qua im lặng.
- [x] `main.ts` -- wiring `heartbeatPort` + timer 1s + cleanup -- kích hoạt cơ chế trong production.
- [x] `uiWsClient.ts` -- reconnect + `connectionStatus`/`sub_type` mở rộng -- nền tảng cho banner + badge machine-offline.
- [x] `channelStore.ts` -- field/method mới -- state cho banner + machine-offline set.
- [x] `ChannelGridCell.tsx`/`ChannelGrid.tsx` -- prop `subType`/`channelMachineOffline` -- badge riêng cho máy chết.
- [x] `ConnectionBanner.tsx` + CSS -- component mới -- đúng DESIGN.md.
- [x] `page.tsx` -- wiring banner/overlay -- end-to-end UI.
- [x] Tests theo I/O matrix cả 2 phía.

**Acceptance Criteria:**
- Given WS UI mất kết nối, when `ws.onclose` fires, then banner+overlay hiện ngay, số liệu đứng yên, không polling; khi reconnect, banner biến mất ngay không cần reload.
- Given 1 kênh không gửi heartbeat ≥15s, when `checkHeartbeatTimeouts()` chạy, then kênh đó hiện badge/sub-type `machine-offline` riêng biệt (khác `✕ MẤT TÍN HIỆU` thường), style vẫn `critical`.
- Given kênh đang `machine-offline`, when heartbeat resume, then badge trả về đúng trạng thái telemetry hiện tại (không kẹt ở machine-offline).

### Review Findings

- [x] [Review][Defer] **[Đã user xác nhận chấp nhận rủi ro]** subType `machine-offline` đè `config-or-security-suspected` khi 1 kênh vừa `machineOfflineActive` vừa có candidate telemetry `REJECTED` cùng lúc — `applyCandidate()` (`dashboard-backend/src/core/channelState.ts:208-217`) ép cứng `subType:'machine-offline'` lên publish bất kể `candidate.subType` thực tế là gì, xoá mất tín hiệu `config-or-security-suspected` (AD-9, nghi vấn cấu hình/bảo mật) khỏi cả `alertPort`/audit log cho tới khi heartbeat resume. Về mặt câu chữ vi phạm Boundaries **Never**: "Track/hiển thị `machine-offline` cho `config-or-security-suspected` hay ngược lại (2 subType độc lập)" — 4/4 layer review (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) độc lập phát hiện cùng 1 điểm. **Quyết định (2026-09-07): giữ nguyên hành vi hiện tại — machine-offline luôn thắng khi trùng.** Lý do: ưu tiên hiển thị máy chết vì đây là mất giám sát hoàn toàn (mất tín hiệu từ toàn bộ kênh, không chỉ 1 khía cạnh), còn REJECTED vẫn có audit log riêng qua Story 2.1 patch — deferred, chấp nhận rủi ro.

- [x] [Review][Patch] `checkOneChannelHeartbeatTimeout()` kiểm tra `record.machineOfflineActive` (dòng 295, early-return) TRƯỚC khi kiểm tra kênh còn trong registry hay không (dòng 301-308) — ngược thứ tự với `handleHeartbeat()` (registry trước). Hệ quả: 1 kênh đã `machineOfflineActive=true` bị gỡ khỏi channel-registry (hot-reload) sau đó sẽ không bao giờ chạm nhánh log `channel_unregistered` mirror `handleHeartbeat` (không phát sinh publish sai, chỉ thiếu log). [`dashboard-backend/src/core/channelState.ts:293-308`] — **Đã vá**: đảo thứ tự check (registry trước `machineOfflineActive`), thêm test regression `channelState.test.ts`.

- [x] [Review][Patch] `uiWsClient.ts`'s `'error'` listener chỉ cập nhật `connectionStatus`, không tự gọi `scheduleReconnect()` — dựa hoàn toàn vào giả định WebSocket spec "`'close'` luôn fire ngay sau `'error'`". Giả định này đúng trong browser thật, nhưng không có timer dự phòng nếu 1 runtime/polyfill nào đó phá vỡ giả định — client sẽ kẹt `'disconnected'` vĩnh viễn không tự hồi phục. Fix cần thêm `scheduleReconnect()` vào nhánh `'error'` KÈM guard idempotent trong `scheduleReconnect()` (vd bỏ qua nếu `reconnectTimer` đã có) để tránh 2 timer chồng nhau khi cả `'error'` và `'close'` cùng fire. [`dashboard-frontend/src/services/uiWsClient.ts:226-232`] — **Đã vá**: thêm `scheduleReconnect()` vào nhánh `'error'` + guard idempotent trong `scheduleReconnect()`. Không thêm test mới riêng (test hiện có của file này chỉ dùng WS thật/timer thật, không có seam để bắn `'error'` độc lập `'close'` mà không lệch hẳn khỏi convention test hiện tại) — đã xác nhận qua suite hiện có (109/109 pass) + build sạch không hồi quy.

- [x] [Review][Defer] `this.channels` (backend, `channelState.ts`), `seenChannels`/`lastState` (`wsUiAdapter.ts`) không prune khi 1 channel_id bị gỡ khỏi channel-registry qua hot-reload — record cũ (kể cả `lastHeartbeatAt`/`machineOfflineActive` mới thêm ở Story 2.7) tồn tại vĩnh viễn. Pre-existing pattern từ Story 2.2/2.3/2.6 (đã tracked trong `deferred-work.md`), Story 2.7 chỉ mở rộng thêm field lên cùng record đã sẵn không được prune — deferred, pre-existing.

- [x] [Review][Defer] Không có test end-to-end (wiring `main.ts` thật + WS thật) cho chiều "heartbeat resume" — chỉ có E2E cho chiều "phát hiện machine-offline" (`main.test.ts:667`); chiều phục hồi chỉ unit-test trực tiếp `ChannelStateService`. [`dashboard-backend/tests/main.test.ts`] — deferred, pre-existing (cùng nhóm gap test-coverage đã ghi ở `deferred-work.md` cho story này).

- [x] [Review][Defer] Envelope `event_type=heartbeat` chỉ validate `typeof envelope.timestamp === 'string'`, không parse/validate định dạng ISO 8601 — 1 chuỗi bất kỳ vẫn lọt qua (chỉ ảnh hưởng log, core dùng Clock injectable không đọc field này). Cùng nhóm rủi ro validate-lỏng đã defer từ Story 2.1. [`dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts:110`] — deferred, pre-existing.

- [x] [Review][Defer] Badge `machine-offline` mới (`✕ TRUNG TÂM LỖI`) không có tooltip/aria-label riêng phân biệt với `✕ MẤT TÍN HIỆU` cho assistive tech — cùng nhóm accessibility đã lược khỏi pilot theo AD-19, hoàn thiện ở Epic 5 (đã defer tương tự ở Story 2.3/2.4/2.5). [`dashboard-frontend/src/components/ChannelGridCell.tsx`] — deferred, pre-existing.

- [x] [Review][Defer] Sau khi `dashboard-backend` RESTART tiến trình (không chỉ đứt mạng), toàn bộ state trong `ChannelStateService`/`wsUiAdapter.ts`'s `lastState` mất sạch, nhưng `channelStore.applyRegistrySnapshot()` (frontend) chỉ ghi đè `channels`, KHÔNG reset `channelDisplayStates`/`channelMachineOffline` — badge cũ có thể tồn đọng trên UI cho tới khi có event mới đúng kênh đó. [`dashboard-frontend/src/state/channelStore.ts:95-97`] — deferred, pre-existing (mirror hành vi `channelDisplayStates` đã có từ Story 2.6, không phải regression riêng của Story 2.7).

## Design Notes

`lastConnectedAt` chỉ cập nhật ở `onopen` (không mỗi message) — đơn giản hoá, vẫn đúng ngữ nghĩa "thời điểm cập nhật lần cuối" ở mức chấp nhận được cho banner.

`checkHeartbeatTimeouts()` KHÔNG tự quản lý timer nội bộ (khác `fileChannelRegistryAdapter.ts`'s `scheduleReload`) — giữ `src/core` thuần/dễ test (mirror triết lý `Clock` injectable), production tự gọi định kỳ từ composition root.

Reconnect `uiWsClient.ts`: retry cố định (không backoff) vì LAN nội bộ ổn định, khác hẳn SRT reconnect vô hạn có backoff của transport-core (Epic 1, môi trường mạng WAN không đáng tin).

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- expected: Vitest/node:test pass, cover heartbeat timeout + recovery.
- `cd dashboard-frontend && npm test` -- expected: Vitest pass, cover reconnect + banner + machine-offline badge.
- `cd dashboard-backend && npm run build && cd ../dashboard-frontend && npm run build` -- expected: build sạch cả 2 phía.

**Manual checks:**
- Tắt `dashboard-backend` khi `dashboard-frontend` đang mở -- xác nhận banner+overlay hiện ngay, bật lại backend -- banner tự ẩn không cần reload.
- Không gửi heartbeat cho 1 kênh test ≥15s (giữ nguyên telemetry) -- xác nhận badge đổi sang machine-offline; gửi lại heartbeat -- badge trả về đúng trạng thái cũ.

## Suggested Review Order

**Backend — phát hiện machine-offline qua heartbeat (đường mới)**

- Entry point: `HeartbeatInboundPort` mới, mirror `TelemetryInboundPort` — tách semantic "còn sống thô" khỏi telemetry cần debounce.
  [`HeartbeatInboundPort.ts:18`](../../dashboard-backend/src/ports/HeartbeatInboundPort.ts#L18)

- `handleHeartbeat` cập nhật `lastHeartbeatAt` + xử lý phục hồi khi kênh đang machine-offline.
  [`channelState.ts:225`](../../dashboard-backend/src/core/channelState.ts#L225)

- `checkOneChannelHeartbeatTimeout` — timer chủ động (không tự quản lý bên trong core), phát hiện im lặng ≥15s.
  [`channelState.ts:293`](../../dashboard-backend/src/core/channelState.ts#L293)

- `wsTelemetryAdapter.ts` forward `event_type=heartbeat` qua port mới thay vì bỏ qua im lặng như trước.
  [`wsTelemetryAdapter.ts:247`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L247)

**Backend — patch round: giữ nhất quán machine-offline khi telemetry vẫn chạy song song**

- `applyCandidate` ép `subType:'machine-offline'` lên publish nếu kênh đang `machineOfflineActive` — tránh telemetry bình thường âm thầm "giải phóng" badge phía frontend trong khi máy vẫn chưa gửi heartbeat lại.
  [`channelState.ts:212`](../../dashboard-backend/src/core/channelState.ts#L212)

- `AlertOutboundPort.ts`'s `subType` mở rộng thêm `'machine-offline'`, độc lập `'config-or-security-suspected'`.
  [`AlertOutboundPort.ts:22`](../../dashboard-backend/src/ports/AlertOutboundPort.ts#L22)

**Backend — composition root wiring**

- `main.ts` gắn `channelStateService` làm `heartbeatPort` + timer `setInterval` 1s gọi `checkHeartbeatTimeouts()`.
  [`main.ts:288`](../../dashboard-backend/app/main.ts#L288)

**Frontend — WS UI reconnect & connectionStatus**

- `connectUiWsClient`'s `connect()` — wire `onopen`/`onclose`/`onerror` + reconnect retry cố định.
  [`uiWsClient.ts:191`](../../dashboard-frontend/src/services/uiWsClient.ts#L191)

- Patch round: lỗi tạo `WebSocket` đồng bộ (URL sai) cũng phải báo `disconnected`, không chỉ retry im lặng.
  [`uiWsClient.ts:204`](../../dashboard-frontend/src/services/uiWsClient.ts#L204)

- `channelStore.ts`'s `setConnectionStatus` — state cho banner/overlay, kèm idempotent-guard cả 2 chiều.
  [`channelStore.ts:150`](../../dashboard-frontend/src/state/channelStore.ts#L150)

**Frontend — badge machine-offline & banner/overlay (UI)**

- `ChannelGridCell` — badge label riêng khi `critical`+`machine-offline`, giữ nguyên style/token `critical`.
  [`ChannelGridCell.tsx:165`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L165)

- `ConnectionBanner` — component mới, ẩn hoàn toàn khi connected, đúng token DESIGN.md.
  [`ConnectionBanner.tsx:30`](../../dashboard-frontend/src/components/ConnectionBanner.tsx#L30)

- `page.tsx` wiring banner + `grid-overlay` phủ lên `ChannelGrid`.
  [`page.tsx:68`](../../dashboard-frontend/app/page.tsx#L68)

**Peripherals — tests**

- Regression test: telemetry commit trong lúc machine-offline vẫn giữ đúng `subType`.
  [`channelState.test.ts:482`](../../dashboard-backend/tests/channelState.test.ts#L482)

- Test registry-removal giữa chừng không còn publish machine-offline cho kênh đã gỡ.
  [`channelState.test.ts:519`](../../dashboard-backend/tests/channelState.test.ts#L519)

- Test wiring thật `main.ts`'s heartbeat timer qua WS thật (FakeClock + WS UI client thật).
  [`main.test.ts:605`](../../dashboard-backend/tests/main.test.ts#L605)

- Test reconnect/connectionStatus phía `uiWsClient.ts` (đóng đột ngột, url sai, reconnect thành công).
  [`uiWsClient.test.ts:374`](../../dashboard-frontend/tests/uiWsClient.test.ts#L374)

