---
title: 'Story 3.2: Panel chi tiết kênh (detail-panel)'
type: 'feature'
created: '2026-09-12'
status: 'done'
baseline_commit: 'ee2288b6dbee26159e8e1f863ee1eac419250844'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Đội trực click vào 1 kênh trên lưới tổng quan hiện không có nơi nào xem bitrate hiện tại, lịch sử bitrate (đã có ở `HistoryPort`/Story 3.1 nhưng chưa expose), tên đài, đầu mối liên hệ — phải tra cứu nơi khác khi xử lý sự cố.

**Approach:** Backend broadcast lịch sử bitrate qua kênh WS UI hiện có (replay full snapshot lúc connect từ `HistoryPort.getHistory()`, broadcast từng điểm mới khi ghi) — KHÔNG thêm chiều giao tiếp ngược frontend→backend mới. Frontend thêm `detail-panel` overlay: click `channel-grid-cell` mở panel hiện bitrate hiện tại + biểu đồ SVG thuần lịch sử + tên đài/đầu mối liên hệ (đã có sẵn trong store từ Story 2.2), đóng bằng Esc/click-outside.

## Boundaries & Constraints

**Always:**
- WS UI chỉ server-push (mirror pattern hiện có, không phá "ack-command là ngoại lệ DUY NHẤT chiều ngược" của Epic 3): connect gửi `channel-history-snapshot`/kênh (từ `historyPort.getHistory()`, KHÔNG cache riêng trong adapter); mỗi mẫu ghi thành công broadcast `channel-history-point` tới mọi client.
- `uiPort.publishHistoryPoint(...)` chỉ gọi SAU KHI `historyPort.recordBitrate` thành công, trong CÙNG try/catch hiện có (`channelState.ts`) — record throw thì không publish.
- Tên đài/đầu mối liên hệ lấy từ `channels` đã có trong `channelStore` (Story 2.2/2.3) — không thêm field registry mới.
- Panel là overlay (không route), đóng bằng `Esc` (window keydown) hoặc click backdrop; không chặn thao tác lưới phía sau.
- 3 trạng thái đúng epics.md Story 3.2 AC: `loading` (skeleton, mặc định trước khi nhận snapshot/kênh), `loaded` (bitrate hiện tại + biểu đồ đường), `no-history-data` (bitrate hiện tại = "—" vì chưa từng có mẫu, vùng biểu đồ hiện thông báo thiếu dữ liệu — không phải mảng rỗng/biểu đồ trống).
- Test mirror pattern hiện có: Fake/Throwing port (backend), `data-testid` convention + vitest/testing-library (frontend).

**Ask First:**
- Cần cài thêm thư viện chart (recharts/chart.js/...) thay vì SVG thuần — hỏi trước.
- Cần đổi field/format wire của `BitrateHistoryPoint` hiện có (vd timestamp sang ISO) — hỏi trước.

**Never:**
- Không thêm message client→server mới trên WS UI.
- Không đổi mapping ok/warning/critical hay debounce 5s hiện có.
- Không tự prune ring buffer theo registry hot-reload (đã defer ở Story 3.1, ngoài scope).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mở panel trước khi nhận `channel-history-snapshot` | Vừa connect/vừa mở panel | `loading`: skeleton số liệu + biểu đồ | N/A |
| Đã nhận snapshot/point >=1 | `channelHistory` có `state: 'loaded'` | Bitrate hiện tại (mẫu mới nhất) + biểu đồ đường | N/A |
| Snapshot trả `no-history-data`, chưa có point nào | Kênh chưa từng có mẫu | Bitrate hiện tại hiện "—"; vùng biểu đồ hiện thông báo thiếu dữ liệu | N/A |
| `historyPort.getHistory()` throw hoặc trả `loading` lúc connect | Lỗi/nhánh không mong đợi ở `wsUiAdapter` | Gửi `no-history-data` + log cảnh báo | try/catch quanh vòng lặp gửi snapshot/kênh, không throw/crash |
| Esc hoặc click ra ngoài panel | Panel đang mở | Đóng panel, lưới phía sau giữ nguyên | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/ports/UiOutboundPort.ts:13-19` -- thêm `publishHistoryPoint(channelId, bitratePct, timestampMs)`, mirror `publishChannelSeen`.
- `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:33-38,199-241,261-313` -- thêm `historyPort: HistoryPort` vào `WsUiAdapterOptions`; connect handler gửi `channel-history-snapshot`/kênh (từ `historyPort.getHistory()`) ngay sau registry-snapshot (dòng 204); implement `publishHistoryPoint` broadcast `channel-history-point` (mirror `publishChannelSeen` dòng 269-276, KHÔNG cache Map mới, KHÔNG idempotent-guard).
- `dashboard-backend/src/core/channelState.ts:176-192` -- sau `historyPort.recordBitrate` thành công, gọi `this.uiPort.publishHistoryPoint(event.channelId, bitratePct, historyTimestampMs)` trong cùng try.
- `dashboard-backend/app/main.ts:304-314` -- truyền `historyPort: bitrateHistoryService` vào `startWsUiAdapter(...)`.
- `dashboard-backend/tests/channelState.test.ts` -- mở rộng `FakeUiPort`/`ThrowingUiPort` + test publishHistoryPoint (gọi đúng khi thành công, bỏ qua khi record throw).
- `dashboard-backend/tests/wsUiAdapter.test.ts` -- test replay `channel-history-snapshot`/kênh lúc connect + broadcast `channel-history-point`.
- `dashboard-backend/tests/main.test.ts` -- cập nhật wiring `historyPort` vào `startWsUiAdapter`.
- `dashboard-frontend/src/state/channelStore.ts:37-79` -- thêm `selectedChannelId: string | null`, `channelHistory: ReadonlyMap<string, HistoryState>`; methods `selectChannel`, `clearSelectedChannel`, `applyHistorySnapshot`, `applyHistoryPoint` (append + trim client-side theo cùng cửa sổ 15 phút).
- `dashboard-frontend/src/services/uiWsClient.ts:15-187` -- parse+validate `channel-history-snapshot`/`channel-history-point`, gọi store method tương ứng (mirror `isChannelStateChangeMessage` pattern).
- `dashboard-frontend/src/components/ChannelGridCell.tsx:129-166,181-201` -- thêm optional `onSelect?: (channelId: string) => void`, onClick gọi `onSelect?.(channelId)`.
- `dashboard-frontend/src/components/ChannelGrid.tsx` -- truyền `onSelect` xuống từng `ChannelGridCell`.
- `dashboard-frontend/src/components/DetailPanel.tsx` -- MỚI. Overlay đọc `selectedChannelId`/`channels`/`channelHistory` từ store; 3 trạng thái theo I/O matrix; Esc (window keydown) + click backdrop gọi `clearSelectedChannel`; biểu đồ SVG polyline thuần.
- `dashboard-frontend/src/components/DetailPanel.module.css` -- MỚI. Token: `--spacing-panel-padding`, `--radius-lg`, `--radius-pill`, `--font-heading-*`, `--font-body-*`, `--font-family-numeric`/`--font-numeric-*`.
- `dashboard-frontend/app/page.tsx` -- SỬA: render `<DetailPanel store={store} />`.
- `dashboard-frontend/tests/channelStore.test.ts`, `tests/uiWsClient.test.ts`, `tests/ChannelGridCell.test.tsx` -- SỬA: test phần mở rộng tương ứng.
- `dashboard-frontend/tests/DetailPanel.test.tsx` -- MỚI: test 3 trạng thái, Esc/click-outside, hiện đúng tên đài/đầu mối liên hệ.

## Tasks & Acceptance

**Execution:**
- [x] `UiOutboundPort.ts` -- thêm `publishHistoryPoint` -- hợp đồng port cho core gọi.
- [x] `wsUiAdapter.ts` -- nhận `historyPort`, replay snapshot lúc connect, broadcast point -- điểm wiring WS UI duy nhất.
- [x] `channelState.ts` -- gọi `publishHistoryPoint` sau `recordBitrate` thành công -- nguồn phát duy nhất.
- [x] `app/main.ts` -- wiring `historyPort` vào `startWsUiAdapter` -- production thực sự phát lịch sử.
- [x] `channelState.test.ts`, `wsUiAdapter.test.ts`, `main.test.ts` -- test backend theo I/O matrix.
- [x] `channelStore.ts` -- thêm `selectedChannelId`/`channelHistory` + methods -- state nền cho detail-panel.
- [x] `uiWsClient.ts` -- parse 2 message mới -- cầu nối WS→store.
- [x] `ChannelGridCell.tsx`, `ChannelGrid.tsx` -- thêm `onSelect` -- mở panel khi click.
- [x] `DetailPanel.tsx` + `.module.css` -- MỚI -- component chính của story.
- [x] `app/page.tsx` -- render `DetailPanel` -- lắp vào cây UI thật.
- [x] `channelStore.test.ts`, `uiWsClient.test.ts`, `ChannelGridCell.test.tsx`, `DetailPanel.test.tsx` -- test frontend theo I/O matrix.

**Acceptance Criteria:**
- Given tôi click vào 1 `channel-grid-cell` bất kỳ, when `detail-panel` mở, then panel mở tức thì (overlay, không điều hướng trang), không chặn thao tác trên lưới phía sau.
- Given detail-panel đang mở, when nhấn `Esc` hoặc click ra ngoài panel, then panel đóng, trạng thái lưới phía sau giữ nguyên.
- Given nhiều client dashboard-frontend đang mở, when 1 mẫu bitrate mới được ghi ở backend, then TẤT CẢ client nhận `channel-history-point` tương ứng (broadcast không riêng theo panel đang mở/đóng).
- Given client connect/reconnect WS UI, when nhận đủ sequence replay, then panel mở lần đầu cho 1 kênh đã có lịch sử hiện đúng ngay, không cần đợi mẫu mới.

### Review Findings

**Decision needed:** (đã resolve — xem Patch bên dưới)

**Patch:**
- [x] [Review][Patch] Thêm định danh phụ (`channel_id` hoặc `grid_position`) vào header `detail-panel` — `station_name` KHÔNG được validate unique ở registry (`fileChannelRegistryAdapter.ts` chỉ chặn trùng `channel_id`), nên 2 kênh có thể trùng tên đài; đội trực cần cách phân biệt đúng kênh đang xem (rủi ro liên hệ nhầm số khi xử lý sự cố). Quyết định (user): thêm định danh phụ vào header. [`DetailPanel.tsx:159-165`]
- [x] [Review][Patch] Cho phép click 1 `channel-grid-cell` KHÁC trong khi panel đang mở để chuyển thẳng sang kênh đó (không cần đóng panel trước) — backdrop full-viewport hiện nuốt mọi click, chỉ dùng để đóng. Quyết định (user): cho phép click sang cell khác đổi kênh trực tiếp. [`DetailPanel.tsx:96-125`, `DetailPanel.module.css:8-31`]
- [x] [Review][Patch] `.stationName`/`.contactName`/`.contactPhone` (`DetailPanel.module.css`) thiếu `overflow-wrap`/`word-break`, không nhất quán với convention ellipsis/nowrap đã có sẵn ở `ChannelGridCell.module.css`'s `.channelName` — tên đài/SĐT bất thường dài có thể tràn khỏi panel rộng cố định 380px. [`DetailPanel.module.css:37-58,124-149`]
- [x] [Review][Patch] Thiếu test tích hợp qua chuỗi click thật cho kịch bản CHUYỂN kênh khi panel đang mở (click cell A → click cell B trong khi panel A đang hiện) — hiện chỉ có test đổi `selectedChannelId` trực tiếp qua store (`channelStore.test.ts`), chưa xác nhận qua click thật rằng nội dung refresh đúng. [`DetailPanel.test.tsx`, `page.test.tsx`]

**Deferred (pre-existing, not caused by this change):**
- [x] [Review][Defer] `publishHistoryPoint`'s broadcast loop (`for (const client of wss.clients) { send(client, message); }`) không try/catch riêng từng client — 1 client throw có thể chặn broadcast tới các client còn lại trong CÙNG lần gọi. Pre-existing: y hệt pattern ở `publishChannelSeen`/`publishStateChange`/`publishSnapshot` (không mới ở story 3.2); thực tế `send()` không throw đồng bộ khi socket đã ở trạng thái OPEN (lỗi network của thư viện `ws` raise qua event `'error'` bất đồng bộ, không qua `.send()`). — deferred, pre-existing [`wsUiAdapter.ts:421-425`]
- [x] [Review][Defer] `DetailPanel`/`ChannelGridCell`/biểu đồ SVG chưa có focus trap, return-focus khi đóng, hay `aria-label`/text alternative mô tả đầy đủ hành vi click/xu hướng biểu đồ cho screen reader. `epic-3-context.md` dòng 25 đã chốt accessibility "hoàn thiện đầy đủ ở Epic 5", story 3.2 chỉ cần Tab + Enter/Space + Esc (đã có, đã test). — deferred, pre-existing [`DetailPanel.tsx`, `ChannelGridCell.tsx:194`]
- [x] [Review][Defer] 1 kênh MỚI được thêm vào registry (hot-reload) SAU khi client đã connect sẽ không bao giờ nhận `channel-history-snapshot` của kênh đó (chỉ gửi 1 lần lúc connect, dùng `registryPort.listEntries()` tại thời điểm đó) cho tới khi client tự reconnect — panel của kênh đó kẹt `loading` vô hạn nếu mở trước khi reconnect. Pre-existing: toàn bộ adapter (kể cả `registry-snapshot` chính nó) không có cơ chế push-on-registry-change nào, không riêng story 3.2. — deferred, pre-existing [`wsUiAdapter.ts:265-302`]

## Spec Change Log

- 2026-09-12: Implemented toàn bộ Tasks & Acceptance (backend: UiOutboundPort.publishHistoryPoint, wsUiAdapter channel-history-snapshot/channel-history-point, channelState.ts wiring, app/main.ts wiring; frontend: channelStore selectedChannelId/channelHistory + methods, uiWsClient parse 2 message mới, ChannelGridCell/ChannelGrid onSelect, DetailPanel.tsx + .module.css MỚI, app/page.tsx render DetailPanel). Backend 158/158 test pass (`npm run build && node --test`), frontend 170/170 test pass (`npm test`) + `next build` sạch. Không có điểm nào cần Ask First (không đổi wire format BitrateHistoryPoint, không thêm thư viện chart).
- 2026-09-12: Áp dụng 7 patch từ code review 3 lớp (blind-hunter/edge-case-hunter/verification-gap), toàn bộ thuộc loại "patch" (không đụng `<frozen-after-approval>`):
  1. `channelState.ts` — try/catch bọc `recordBitrate`+`publishHistoryPoint` giờ phân biệt đúng lệnh nào throw qua biến `step` (trước đây log cứng "recordBitrate throw" dù `publishHistoryPoint` mới là lệnh throw); thêm test `channelState.test.ts`.
  2. `DetailPanel.tsx` — biểu đồ SVG với đúng 1 điểm (`points.length===1`) giờ vẽ 1 `<circle>` marker thay vì để trống (trước đây trông giống hệt `no-history-data`); thêm test + class `.chartPointMarker`.
  3. `DetailPanel.tsx` — trục X polyline giờ tính theo `timestampMs` thực tế trong khoảng [min,max] (hàm `xForTimestamp`), KHÔNG còn theo chỉ số mảng (tránh méo xu hướng khi mẫu đến không đều nhịp); thêm test.
  4. `ChannelGridCell.tsx` — ô kênh giờ có `tabIndex={0}` + `onKeyDown` (Enter/Space, `preventDefault` cho Space) khi có `onSelect` — thao tác được bằng bàn phím; thêm 6 test.
  5. `ChannelGridCell.module.css` — thêm `cursor: pointer` cho `.cell` (không thêm hover/transition, giữ nguyên tắc "Phẳng, không animation" của Epic 2 context).
  6. `DetailPanel.tsx` — nhãn bitrate hiện tại giờ dùng chung guard NaN (`safeBitratePctForLabel`) với hàm vẽ chart (`clampForChart`), tránh hiện "NaN%".
  7. Verification-gap: thêm test tích hợp chuỗi thật click-to-open — `ChannelGrid.test.tsx` (onSelect forward xuống đúng cell) + `page.test.tsx` (click 1 `channel-grid-cell` thật trên `<Page/>` → `detail-panel` mở đúng nội dung kênh).
  Verify lại: backend `npm run build && node --test "dist/tests/**/*.test.js"` → 159/159 pass (1 test `installService.test.js` xác nhận flaky pre-existing không liên quan, không xuất hiện trong lần chạy cuối); frontend `npx tsc --noEmit` sạch, `npm test` → 180/180 pass (+10 test mới).

- 2026-09-12: Áp dụng 4 patch từ code review round 3 (2 mục decision-needed đã được user resolve thành patch + 2 patch thường):
  1. `DetailPanel.tsx`/`.module.css` — thêm `channel_id` dưới tên đài trong header (`.channelId`, `data-testid="detail-panel-channel-id"`) — `station_name` không được validate unique ở registry, đội trực cần định danh phụ để phân biệt khi trùng tên đài (quyết định user).
  2. `DetailPanel.tsx`/`.module.css` — cho phép click 1 `channel-grid-cell` KHÁC trong khi panel đang mở để chuyển thẳng sang kênh đó (quyết định user): thay backdrop-onClick bằng 1 listener capture-phase trên `window` (nhận diện qua `.closest('[data-channel-id]')`), `.backdrop` đổi `pointer-events: none` + `.panel` giữ `pointer-events: auto` để click xuyên xuống lưới phía sau.
  3. `DetailPanel.module.css` — thêm `overflow-wrap`/`word-break` cho `.stationName`/`.contactName`/`.contactPhone`, mirror convention overflow đã có ở `ChannelGridCell.module.css`.
  4. Thêm test tích hợp chuỗi click thật: chuyển kênh khi panel đang mở, và click nền trống đóng panel (`page.test.tsx`) + test hiện `channel_id` ở header (`DetailPanel.test.tsx`).
  Verify lại: frontend `npx tsc --noEmit` sạch, `npm test` → 183/183 pass (+3 test mới), `next build` sạch.

## Design Notes

- `historyPort` là nguồn sự thật DUY NHẤT lúc connect (query trực tiếp `getHistory()` mỗi kênh) — KHÔNG thêm cache Map mới trong `wsUiAdapter.ts` như `lastState`/`lastSnapshot` (khác 2 loại đó: point là tín hiệu rời rạc phát mọi lúc mọi client cùng nhận như nhau, không cần replay-từ-cache vì `historyPort` tự giữ đủ dữ liệu ~15 phút).
- "Bitrate hiện tại" = mẫu MỚI NHẤT client từng nhận (qua snapshot hoặc point), không phải trường riêng — placeholder "—" chỉ khi `channelHistory` của kênh đó ở đúng `no-history-data` (chưa từng nhận mẫu nào, kể cả từ snapshot).
- `loading` (mặc định trước khi nhận `channel-history-snapshot`) là trạng thái CHỈ tồn tại ở frontend trong khoảng ngắn ngay sau connect — backend không bao giờ tự sinh nhánh này (mirror Design Notes Story 3.1).

## Verification

**Commands:**
- `cd dashboard-backend && npm run build && node --test "dist/tests/**/*.test.js"` -- expected: toàn bộ test pass.
- `cd dashboard-frontend && npm test` -- expected: toàn bộ test pass, gồm `DetailPanel.test.tsx` mới.

**Manual checks (if no CLI):**
- Mở 2 tab dashboard-frontend, click 1 kênh ở cả 2 tab, xác nhận biểu đồ cùng cập nhật khi có telemetry mới (broadcast, không riêng theo panel).

## Suggested Review Order

**Broadcast lịch sử bitrate qua WS UI (backend, cơ chế cốt lõi)**

- Entry point: lúc connect, gửi `channel-history-snapshot`/kênh bằng cách query thẳng `historyPort.getHistory()` — không cache riêng, nguồn sự thật duy nhất.
  [`wsUiAdapter.ts:275`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L275)

- `historyPort` trở thành dependency bắt buộc của adapter (mirror `registryPort`) — điểm quyết định kiến trúc chính.
  [`wsUiAdapter.ts:43`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L43)

- `publishHistoryPoint` broadcast mỗi mẫu mới tới mọi client, không cache/không idempotent-guard — khác hẳn `publishChannelSeen`.
  [`wsUiAdapter.ts:421`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L421)

- Hợp đồng port mới mà core gọi vào.
  [`UiOutboundPort.ts:30`](../../dashboard-backend/src/ports/UiOutboundPort.ts#L30)

**Publish sau khi ghi ring buffer (backend)**

- `publishHistoryPoint` chỉ gọi SAU `recordBitrate` thành công, cùng try/catch — `step` phân biệt đúng lệnh nào throw khi log lỗi (patch round 2).
  [`channelState.ts:183`](../../dashboard-backend/src/core/channelState.ts#L183)

- Composition root: wiring `historyPort` thật vào cả `ChannelStateService` lẫn `startWsUiAdapter`.
  [`main.ts:287`](../../dashboard-backend/app/main.ts#L287)

**State + parsing lịch sử bitrate (frontend)**

- Discriminated union `HistoryState` (loading/loaded/no-history-data) — `loading` chỉ tồn tại phía frontend.
  [`channelStore.ts:49`](../../dashboard-frontend/src/state/channelStore.ts#L49)

- `applyHistoryPoint` append + trim client-side theo cùng cửa sổ retention với backend.
  [`channelStore.ts:283`](../../dashboard-frontend/src/state/channelStore.ts#L283)

- Parse 2 message mới từ WS, validate lớp 2 trước khi gọi store.
  [`uiWsClient.ts:175`](../../dashboard-frontend/src/services/uiWsClient.ts#L175)

**Mở panel bằng click (frontend)**

- `onClick`/`onKeyDown` (Enter/Space) trên ô kênh — mở đúng kênh, thao tác được bằng bàn phím (patch round 2).
  [`ChannelGridCell.tsx:198`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L198)

- `page.tsx` wiring `onSelect` → `store.selectChannel` và render `DetailPanel`.
  [`page.tsx:78`](../../dashboard-frontend/app/page.tsx#L78)

**DetailPanel — component chính (frontend, MỚI)**

- 3 trạng thái loading/loaded/no-history-data, Esc + click-backdrop đóng panel, click trong panel không lan ra ngoài.
  [`DetailPanel.tsx:76`](../../dashboard-frontend/src/components/DetailPanel.tsx#L76)

- Trục X biểu đồ tính theo `timestampMs` thực tế (không theo chỉ số mảng) — patch round 2, tránh méo xu hướng khi mẫu đến không đều nhịp.
  [`DetailPanel.tsx:49`](../../dashboard-frontend/src/components/DetailPanel.tsx#L49)

- Marker tròn cho trường hợp `loaded` chỉ có đúng 1 mẫu — polyline 1 điểm không vẽ gì, dễ nhầm với thiếu dữ liệu (patch round 2).
  [`DetailPanel.tsx:163`](../../dashboard-frontend/src/components/DetailPanel.tsx#L163)

**Peripherals**

- `cursor: pointer` báo hiệu ô kênh giờ click được (patch round 2).
  [`ChannelGridCell.module.css:31`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L31)

- Test tích hợp chuỗi thật click → mở panel (verification-gap patch) — bắt được nếu wiring `onSelect` bị bỏ sót trong tương lai.
  [`page.test.tsx:247`](../../dashboard-frontend/tests/page.test.tsx#L247)

- Test replay `channel-history-snapshot`/kênh lúc connect + broadcast `channel-history-point`.
  [`wsUiAdapter.test.ts:691`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L691)
