---
title: 'Story 2.6: Cập nhật trạng thái kênh event-driven qua WebSocket'
type: 'feature'
created: '2026-09-06'
status: 'done'
baseline_commit: 'ca68eea960bb205daa5b00308e345658c95b637a'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelGridCell` hiện lấy `displayState` từ fixture giả lập (`buildChannelDisplayStatesFixture`, Story 2.4) thay vì dữ liệu thật — dù backend (`ChannelStateService`) đã tính đúng ok/warning/critical sau debounce ≥5s, giá trị này chưa từng tới được frontend qua kênh nào (`LogAlertAdapter` hiện chỉ ghi log audit).

**Approach:** Thêm message mới `channel-state-change` vào kênh WS UI hiện có (`wsUiAdapter.ts`/`uiWsClient.ts`, Story 2.3) để broadcast `ChannelStateChange` đã chốt tới mọi frontend đang mở — kèm replay trạng thái mới nhất/kênh cho client connect muộn (mirror pattern `channel-seen`) — song song giữ nguyên audit log hiện có; frontend lưu vào `channelStore.ts`, `page.tsx` đọc thẳng từ store thay fixture.

## Boundaries & Constraints

**Always:**
- Message `channel-state-change` chỉ phát khi debounce ≥5s đã chốt xong (cơ chế có sẵn, `channelState.ts` gọi `alertPort.publishStateChange` — KHÔNG sửa `applyCandidate`/debounce/mapping). Toàn bộ qua event stream, không polling.
- Envelope theo đúng pattern snake_case hiện có của kênh này (`{type, channel_id, ...}`), KHÔNG dùng envelope đóng `schema_version`/`event_type` của transport-core (nhất quán với `registry-snapshot`/`channel-seen` đã có, lý do đã ghi rõ trong comment 2 file `wsUiAdapter.ts`/`uiWsClient.ts`): `{ type: 'channel-state-change', channel_id, display_state, sub_type?, timestamp }`.
- `wsUiAdapter.ts` PHẢI replay `channel-state-change` mới nhất/kênh cho client connect muộn (giữ 1 `Map<channelId, ChannelStateChange>` nội bộ, mirror pattern `seenChannels`) — nếu không, frontend reload sẽ kẹt vĩnh viễn ở `loaded-neutral` cho các kênh đã chốt trạng thái từ trước (backend chỉ phát lại khi trạng thái ĐỔI, không phát lặp khi ổn định).
- Giữ nguyên `LogAlertAdapter` (audit log hiện có) — broadcast WS là THÊM, không thay thế. Fan-out tại composition root (`main.ts`) qua 1 object nhỏ implement `AlertOutboundPort` gọi cả 2 (log + WS adapter mới); lỗi ở 1 nhánh không được chặn nhánh còn lại (try/catch độc lập mỗi nhánh).
- `channelStore.ts` thêm field `channelDisplayStates: ReadonlyMap<string, DisplayState>` (import type từ `ChannelGridCell.tsx`, đúng type đã dùng ở `page.tsx`/`ChannelGrid.tsx`) + method áp dụng ghi đè theo `channelId` (KHÔNG idempotent-guard như `channel-seen` — trạng thái đổi qua lại được).
- `page.tsx` bỏ hẳn `buildChannelDisplayStatesFixture`, đọc thẳng `state.channelDisplayStates`. Xoá `fixtures/channelDisplayStates.ts` + test tương ứng (dead code sau story này).
- Type-guard frontend validate `display_state` đúng 1 trong 3 literal (`ok`/`warning`/`critical`) — phòng thủ lớp 2 (mirror `isValidGridPosition`); giá trị lạ/field thiếu bị bỏ qua âm thầm, không throw, không đóng kết nối WS (cùng tinh thần message type lạ hiện có).
- Test mirror convention hiện có: Vitest cả 2 phía; backend dùng `ws` thật (client `WebSocket` kết nối `WsUiAdapterHandle` thật, mirror `wsUiAdapter.test.ts`); frontend dùng `WebSocketServer` giả làm fake backend (mirror `uiWsClient.test.ts`).

**Ask First:** Nếu phát hiện cần gộp `AlertOutboundPort`/`UiOutboundPort` thành 1 interface để wiring gọn hơn — 2 port đang tách biệt CÓ CHỦ ĐÍCH (comment `UiOutboundPort.ts`: 2 timing/semantic khác nhau, `channel-seen` phát ngay không qua debounce) — HALT hỏi trước khi tự gộp.

**Never:** Đổi mapping tính toán ok/warning/critical hay debounce 5s/cooldown (Story 2.1). Render/xử lý `subType` (`config-or-security-suspected`) trên UI (badge/microcopy riêng) — vẫn là quyết định "Ask First" treo từ Story 2.4, chỉ mang `sub_type` qua wire (dữ liệu, không dùng ở store/UI) để tránh phải sửa lại envelope khi 2.4's Ask First được giải quyết. Thêm authentication cho WS UI (đã chốt LAN-only, Story 2.3). Đổi `audioLevel`/thumbnail/color-bars (Story 2.5) hay props `ChannelGrid.tsx`/`ChannelGridCell.tsx` (đã sẵn sàng đúng type `DisplayState`). Đổi giao thức WS telemetry backend↔transport-core (`wsTelemetryAdapter.ts`) hay ack-command (AD-25, Epic 3+).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backend chốt trạng thái mới | `ChannelStateService` debounce ≥5s chốt candidate mới | Broadcast `channel-state-change` tới mọi client WS UI đang mở, đồng thời `LogAlertAdapter` vẫn ghi audit log như cũ | N/A |
| Frontend nhận message hợp lệ | `{type:'channel-state-change', channel_id, display_state:'warning', timestamp}` | `channelStore` cập nhật `channelDisplayStates`, `ChannelGridCell` tương ứng re-render ngay, không polling | N/A |
| `display_state` lạ/hỏng | `display_state:'unknown'` hoặc thiếu field | Bỏ qua âm thầm, không cập nhật store | Không throw/crash, WS không đóng |
| Frontend connect muộn | Client mới connect, 1 số kênh đã có trạng thái chốt từ trước | Sau `registry-snapshot`+`channel-seen` replay, nhận thêm `channel-state-change` replay cho mọi kênh đã chốt — ô hiện đúng màu ngay, không chờ backend đổi trạng thái lần nữa | N/A |
| JSON hỏng / type lạ khác | raw không parse được hoặc `type` không nhận diện | Bỏ qua, kết nối WS không bị đóng (hành vi hiện có, không đổi) | Không throw |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:38-41,55-64,84-91,127-137` -- `WsUiAdapterHandle` implement thêm `AlertOutboundPort` (import từ `../../ports/AlertOutboundPort.js`); thêm `ChannelStateChangeMessage`; thêm `Map<string, ChannelStateChange>` (`lastState`, mirror `seenChannels` dòng 91) để replay lúc connect (mirror dòng 135-137); `publishStateChange()` broadcast tới `wss.clients` (mirror `publishChannelSeen` dòng 184-191).
- `dashboard-backend/app/main.ts:187,202` -- thay `alertPort` truyền vào `ChannelStateService` bằng 1 object composite implement `AlertOutboundPort` tại composition root: gọi cả `LogAlertAdapter` hiện có (giữ dòng 187) lẫn `ui.publishStateChange` (adapter mới), mỗi nhánh try/catch độc lập.
- `dashboard-backend/src/ports/AlertOutboundPort.ts` -- tham chiếu (không sửa): `ChannelStateChange`/`DisplayState` đã đúng shape cần broadcast.
- `dashboard-frontend/src/services/uiWsClient.ts:22-31,55-65,82-98` -- thêm `ChannelStateChangeMessage` (`type:'channel-state-change', channel_id, display_state, sub_type?, timestamp`) + `isValidDisplayState`/`isChannelStateChangeMessage` (mirror `isValidGridPosition`/`isRegistrySnapshotMessage` dòng 39-59); thêm nhánh trong `applyUiWsMessage` (sau dòng 96) gọi `store.applyChannelDisplayStateChange(...)`.
- `dashboard-frontend/src/state/channelStore.ts:27-34,38,61-72` -- thêm field `channelDisplayStates: ReadonlyMap<string, DisplayState>` vào `ChannelStoreState` (import type từ `../components/ChannelGridCell`), cập nhật `EMPTY_STATE`; thêm method `applyChannelDisplayStateChange(channelId, displayState)` (ghi đè, mirror style `applyChannelSeen`/`applyRegistrySnapshot` nhưng KHÔNG guard idempotent).
- `dashboard-frontend/app/page.tsx:12,36-43,69-74` -- xoá import `buildChannelDisplayStatesFixture` + khối `useMemo` fixture; dùng thẳng `state.channelDisplayStates` khi truyền xuống `<ChannelGrid>`.
- Xoá: `dashboard-frontend/src/fixtures/channelDisplayStates.ts`, `dashboard-frontend/tests/channelDisplayStates.test.ts` (dead code sau story này).
- Tests: `dashboard-backend/tests/wsUiAdapter.test.ts` (thêm case broadcast + replay connect muộn, mirror case `channel-seen` hiện có), `dashboard-backend/tests/main.test.ts` (thêm case composite alertPort gọi cả 2 nhánh); `dashboard-frontend/tests/uiWsClient.test.ts` (thêm case `channel-state-change` hợp lệ/`display_state` lạ/thiếu field, mirror case `channel-seen`), `dashboard-frontend/tests/channelStore.test.ts` (thêm case `applyChannelDisplayStateChange` ghi đè), `dashboard-frontend/tests/page.test.tsx` (cập nhật: bỏ assertion dựa fixture, thêm case đọc từ store).

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts` -- thêm `publishStateChange` (implement `AlertOutboundPort`) + Map replay `lastState` -- lõi broadcast + đảm bảo client connect muộn không kẹt loaded-neutral.
- [x] `dashboard-backend/app/main.ts` -- composite `alertPort` fan-out log + WS tại composition root -- giữ audit log hiện có, không phá interface `ChannelStateService`.
- [x] `dashboard-frontend/src/services/uiWsClient.ts` -- type-guard + xử lý `channel-state-change` -- nhận đúng, bỏ qua an toàn giá trị lạ.
- [x] `dashboard-frontend/src/state/channelStore.ts` -- field + method `channelDisplayStates`/`applyChannelDisplayStateChange` -- nguồn dữ liệu thật thay fixture.
- [x] `dashboard-frontend/app/page.tsx` -- đọc `state.channelDisplayStates`, bỏ fixture -- wiring event-driven end-to-end.
- [x] Xoá `fixtures/channelDisplayStates.ts` + test tương ứng -- dọn dead code.
- [x] Tests backend + frontend theo I/O matrix (broadcast, replay connect muộn, giá trị lạ, composite fan-out) -- verify không hồi quy Story 2.1-2.5.

**Acceptance Criteria:**
- Given backend đã chốt trạng thái mới của 1 kênh (debounce ≥5s), when backend đẩy qua WS, then frontend cập nhật store và re-render đúng ô đó ngay, không polling.
- Given frontend connect muộn (sau khi 1 số kênh đã có trạng thái chốt trước đó), when connect, then các ô đó hiện đúng màu ngay từ replay, không chờ đổi trạng thái lần nữa.
- Given `LogAlertAdapter` vẫn nhận `publishStateChange`, when trạng thái đổi, then audit log vẫn ghi như trước (không hồi quy Story 2.1).

### Review Findings

- [x] [Review][Patch] Comment cũ còn trỏ tới `channelDisplayStates.ts` đã bị xoá trong chính diff này (`page.tsx`'s "không dùng chung ... với channelDisplayStates ở trên" tham chiếu 1 biến local đã xoá; `ChannelGridCell.tsx`/`hashString.ts` nói "như channelDisplayStates.ts") — dọn lại cho khớp thực tế sau khi file đã bị xoá. [dashboard-frontend/app/page.tsx:36] — Fixed: cập nhật comment ở cả 3 file, không còn trỏ tới file đã xoá.
- [x] [Review][Patch] Frontend `ChannelStateChangeMessage.sub_type` khai `string` chung chung thay vì mirror literal `'config-or-security-suspected'` như backend (`AlertOutboundPort.ts`), và `isChannelStateChangeMessage` chỉ validate `typeof === 'string'` (không check đúng literal); comment cũng thiếu giải thích ngữ nghĩa REJECTED-only mà backend đã ghi rõ. [dashboard-frontend/src/services/uiWsClient.ts:39] — Fixed: type + `isValidSubType()` literal, comment mirror backend.
- [x] [Review][Patch] Test integration thật (`main.test.ts:375`, wiring `createCompositeAlertPort([logAlertPort, ui], logger)` tại `main.ts:263`) chỉ assert WS UI client nhận `channel-state-change`, không xác nhận `LogAlertAdapter` cũng nhận qua đúng dòng wiring thật (AC #3: "audit log vẫn ghi như trước") — nếu dòng này bị sửa nhầm bớt `logAlertPort`, không test nào phát hiện được. [dashboard-backend/app/main.ts:263] — Fixed: thêm `config.logger` override + assertion `alert_state_change` trong test integration thật.
- [x] [Review][Patch] Không có test khẳng định `startApp()` dùng đúng default `debounceMs=5000`/`clock=systemClock` khi `config.debounceMs`/`config.clock` bị omit — chỉ có comment khẳng định hành vi này, không có test bảo vệ. [dashboard-backend/app/main.ts:79] — Fixed: thêm test integration verify debounce KHÔNG bị rút ngắn khi omit config.
- [x] [Review][Patch] Thiếu test `publishStateChange` gửi tới client có socket đã đóng — `send()` guard `readyState !== OPEN` dùng chung cho cả 3 loại message nhưng chưa case nào exercise qua `channel-state-change`. [dashboard-backend/tests/wsUiAdapter.test.ts:457] — Fixed: thêm test mirror case `publishChannelSeen` tương đương.
- [x] [Review][Defer] `channelStore.ts`/`uiWsClient.ts` import `DisplayState` từ file component `ChannelGridCell.tsx` (state/service layer phụ thuộc ngược vào UI component) [dashboard-frontend/src/state/channelStore.ts:16] — deferred, pre-existing (spec Code Map tự chỉ định đúng import này, pattern có từ Story 2.4, Story 2.6 chỉ mở rộng thêm 1 nơi dùng)
- [x] [Review][Defer] `lastState` (`wsUiAdapter.ts`, mới ở Story 2.6) không dọn entry khi channel bị gỡ khỏi registry — đã ghi nhận sẵn ở `deferred-work.md` (mirror `seenChannels`, pre-existing từ Story 2.3) [dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:133] — deferred, pre-existing
- [x] [Review][Defer] Log lỗi fan-out trong `createCompositeAlertPort` chỉ định danh nhánh lỗi bằng index số (`port[0]`/`port[1]`), không tên adapter — gây khó chẩn đoán hơn cần thiết khi tra log production. [dashboard-backend/app/main.ts:61] — deferred, cải thiện observability, không ảnh hưởng hành vi đúng/sai
- [x] [Review][Defer] Không có metric/counter riêng cho `alert_publish_error`, chỉ log — không thể alert/dashboard khi 1 nhánh fan-out lỗi lặp lại liên tục. [dashboard-backend/app/main.ts:39] — deferred, ngoài scope story, không có yêu cầu spec

## Design Notes

`lastState` (backend) và `seenChannels` (đã có) là 2 Map độc lập, không gộp — khác semantic (`seenChannels` chỉ ghi 1 lần/kênh, `lastState` ghi đè mỗi lần đổi). Thứ tự replay lúc connect: `registry-snapshot` → `channel-seen` (đã có) → `channel-state-change` (mới) — không đổi 2 bước đầu, chỉ nối thêm bước 3.

Composite `alertPort` ở `main.ts` không cần 1 port/type mới riêng (`CompositeAlertOutboundPort`) — 1 object literal implement `AlertOutboundPort` ngay tại composition root là đủ cho đúng 2 consumer, tránh over-abstract cho use-case chưa cần tái sử dụng nơi khác.

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- expected: Vitest pass, cover broadcast/replay/composite fan-out.
- `cd dashboard-frontend && npm test` -- expected: Vitest pass, cover `channel-state-change` I/O matrix.
- `cd dashboard-backend && npm run build && cd ../dashboard-frontend && npm run build` -- expected: build sạch cả 2 phía.

**Manual checks:**
- Chạy `dashboard-backend` + `dashboard-frontend` (`npm run dev`) với ≥2 tab frontend mở song song; đợi 1 kênh đổi trạng thái (hoặc giả lập qua test harness) — xác nhận CẢ 2 tab cùng re-render gần như đồng thời, không cần reload. Mở tab thứ 3 sau khi trạng thái đã ổn định — xác nhận ô hiện đúng màu ngay lúc mở, không chờ đổi trạng thái tiếp theo.

## Suggested Review Order

**Broadcast + replay cho client connect muộn (backend)**

- Entry point: `WsUiAdapterHandle` implement thêm `AlertOutboundPort` — cùng 1 adapter giờ phát cả `channel-seen` lẫn `channel-state-change`.
  [`wsUiAdapter.ts:44`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L44)

- `lastState` Map độc lập `seenChannels` — ghi đè mỗi lần đổi (không idempotent-guard), giữ trạng thái mới nhất/kênh để replay.
  [`wsUiAdapter.ts:133`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L133)

- Replay `channel-state-change` NGAY SAU `channel-seen` lúc client connect — client connect muộn thấy đúng màu ngay, không chờ đổi trạng thái lần nữa.
  [`wsUiAdapter.ts:184`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L184)

- `publishStateChange` — ghi `lastState` + broadcast tới `wss.clients`, không idempotent-guard (trạng thái đổi qua lại được).
  [`wsUiAdapter.ts:248`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L248)

**Composition-root wiring (fan-out log + WS)**

- `createCompositeAlertPort` — fan-out 1 `ChannelStateChange` tới cả `LogAlertAdapter` (audit log, giữ nguyên) lẫn `WsUiAdapter` (broadcast mới), cô lập lỗi từng nhánh (kể cả lỗi của chính `logger.log`).
  [`main.ts:90`](../../dashboard-backend/app/main.ts#L90)

- Wiring thật tại composition root — thay `LogAlertAdapter` đơn lẻ bằng composite, không đổi interface `ChannelStateService`.
  [`main.ts:263`](../../dashboard-backend/app/main.ts#L263)

- `debounceMs`/`clock` override mới trong config `startApp()` — chỉ phục vụ test integration nhanh, không đổi default production.
  [`main.ts:146`](../../dashboard-backend/app/main.ts#L146)

**Frontend nhận & lưu trạng thái thật (thay fixture)**

- `isChannelStateChangeMessage` type-guard — validate `display_state` đúng 1 trong 3 literal, bỏ qua âm thầm giá trị lạ.
  [`uiWsClient.ts:90`](../../dashboard-frontend/src/services/uiWsClient.ts#L90)

- Nhánh xử lý `channel-state-change` trong `applyUiWsMessage` — gọi thẳng `store.applyChannelDisplayStateChange`.
  [`uiWsClient.ts:132`](../../dashboard-frontend/src/services/uiWsClient.ts#L132)

- `applyChannelDisplayStateChange` — ghi đè theo `channelId`, không guard idempotent (khác `applyChannelSeen`).
  [`channelStore.ts:87`](../../dashboard-frontend/src/state/channelStore.ts#L87)

- `page.tsx` đọc thẳng `state.channelDisplayStates` từ store — bỏ hẳn fixture `buildChannelDisplayStatesFixture` (Story 2.4).
  [`page.tsx:62`](../../dashboard-frontend/app/page.tsx#L62)

**Peripherals — tests**

- Integration test THẬT qua `startApp()` — verify đúng dòng wiring composite alertPort qua telemetry WS + WS UI client thật, không chỉ fake.
  [`main.test.ts:392`](../../dashboard-backend/tests/main.test.ts#L392)

- `createCompositeAlertPort` — cả 2 nhánh throw (log riêng biệt) + mảng `ports` rỗng (no-op).
  [`main.test.ts:323`](../../dashboard-backend/tests/main.test.ts#L323)

- `publishStateChange`/replay connect muộn — broadcast envelope, `sub_type` có/không, ghi đè giá trị khác nhau, thứ tự replay sau `channel-seen`.
  [`wsUiAdapter.test.ts:252`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L252)

- I/O matrix `channel-state-change` phía frontend — hợp lệ, `sub_type`, giá trị lạ, thiếu field, ghi đè.
  [`uiWsClient.test.ts:122`](../../dashboard-frontend/tests/uiWsClient.test.ts#L122)

- `applyChannelDisplayStateChange` — thêm mới, ghi đè, không ảnh hưởng channel khác.
  [`channelStore.test.ts:68`](../../dashboard-frontend/tests/channelStore.test.ts#L68)

- `page.tsx` đọc store thật thay fixture — cell tương ứng hiện đúng `displayState`, kênh chưa có event thì không có attribute.
  [`page.test.tsx:40`](../../dashboard-frontend/tests/page.test.tsx#L40)
