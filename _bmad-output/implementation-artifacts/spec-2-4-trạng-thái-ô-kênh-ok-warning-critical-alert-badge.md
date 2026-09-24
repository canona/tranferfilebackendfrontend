---
title: 'Story 2.4: Trạng thái ô kênh (ok/warning/critical) & alert-badge'
type: 'feature'
created: '2026-09-06'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelGridCell` (Story 2.3) chỉ có 2 trạng thái thị giác skeleton/loaded-neutral; chưa phân biệt `ok`/`warning`/`critical` và không có `alert-badge` — đội trực không thể phân biệt mức độ nghiêm trọng chỉ bằng một cái liếc mắt.

**Approach:** Thêm prop `displayState: 'ok'|'warning'|'critical'` cho `ChannelGridCell` (đổi viền/nền theo token, render `alert-badge` text) và prop map trạng thái theo `channelId` cho `ChannelGrid`. Quyết định của người dùng: Story này CHỈ làm UI thuần, dữ liệu trạng thái đến từ fixture giả lập — KHÔNG nối WebSocket/`channelStore` thật (đó là Story 2.6).

## Boundaries & Constraints

**Always:**
- Định nghĩa type `DisplayState = 'ok' | 'warning' | 'critical'` trong `ChannelGridCell.tsx`, export để `ChannelGrid.tsx` và fixture dùng chung — khớp đúng 3 giá trị của backend `AlertOutboundPort.ts` (không tự đặt tên khác) để Story 2.6 tái sử dụng.
- `displayState` chỉ có hiệu lực khi `loaded=true`; không đổi ý nghĩa/behavior hiện có của prop `loaded` (skeleton vs loaded-neutral, Story 2.3).
- `alert-badge` luôn render đồng thời nền màu VÀ text, đúng literal DESIGN.md: `OK` (ok), `⚠ ABR` (warning), `✕ MẤT TÍN HIỆU` (critical) — dùng ký tự Unicode có sẵn trong string, không thêm icon-lib.
- Màu ô theo đúng token DESIGN.md: `ok` = border `border` + background `surface-raised`; `warning` = border `state-warning` + background `color-mix(state-warning 14%, surface-raised)`; `critical` = border `state-critical` + background `color-mix(state-critical 18%, surface-raised)`. Badge dùng cặp `on-state-*` cho text (không dùng thẳng `state-*`).
- Không animation/transition khi đổi trạng thái.
- `ChannelGrid` nhận prop mới `channelDisplayStates: ReadonlyMap<string, DisplayState>`, truyền đúng giá trị xuống từng `ChannelGridCell` theo `channelId`; vị trí ô không đổi theo trạng thái.
- Dữ liệu trạng thái nguồn từ fixture module MỚI (`dashboard-frontend/src/fixtures/channelDisplayStates.ts`) dùng ở `app/page.tsx` — không đọc/sửa `uiWsClient.ts` hay `channelStore.ts`.
- Test mirror convention hiện có: Vitest + Testing Library, assert qua `data-*`/`getByText`, không assert tên class CSS Module trực tiếp.

**Ask First:** Nếu cần badge/microcopy riêng cho backend `subType: 'config-or-security-suspected'` (khác `✕ MẤT TÍN HIỆU` thường) — DESIGN.md hiện chỉ có 1 nhãn critical duy nhất — HALT hỏi trước khi tự đặt nhãn mới.

**Never:** Nối WebSocket/`channelStore` thật cho `displayState` (Story 2.6). Trạng thái `acknowledged` (Epic 3). VU-meter/thumbnail/color-bars theo trạng thái (Story 2.5). Đổi mapping tính toán ok/warning/critical ở backend (Story 2.1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ô loaded, state=ok | `loaded=true, displayState='ok'` | Border `border`/bg `surface-raised`; badge nền pha loãng `state-ok` + text `OK` màu `on-state-ok` | N/A |
| Ô loaded, state=warning | `loaded=true, displayState='warning'` | Border/bg color-mix warning; badge nền đặc `state-warning` + text `⚠ ABR` màu `on-state-warning` | N/A |
| Ô loaded, state=critical | `loaded=true, displayState='critical'` | Border/bg color-mix critical; badge nền đặc `state-critical` + text `✕ MẤT TÍN HIỆU` màu `on-state-critical` | N/A |
| Ô còn skeleton | `loaded=false`, `displayState` bất kỳ | Giữ nguyên skeleton hiện có (Story 2.3), KHÔNG render badge | N/A |
| `displayState` thiếu khi đã loaded | `loaded=true, displayState=undefined` | Fallback style loaded-neutral hiện có (Story 2.3), không render badge | Không crash |

</frozen-after-approval>

## Code Map

- `dashboard-frontend/src/components/ChannelGridCell.tsx:25-58` -- thêm prop `displayState?: DisplayState` (export type), render `alert-badge`, cập nhật `data-display-state`.
- `dashboard-frontend/src/components/ChannelGridCell.module.css` -- thêm class `ok`/`warning`/`critical` (color-mix theo DESIGN.md) + class badge (`radius-sm`, `label-caps`).
- `dashboard-frontend/src/components/ChannelGrid.tsx:13-62` -- thêm prop `channelDisplayStates: ReadonlyMap<string, DisplayState>`, truyền xuống từng cell theo `channelId`.
- `dashboard-frontend/src/fixtures/channelDisplayStates.ts` (MỚI) -- fixture giả lập 20 kênh trộn ok/warning/critical dùng cho `app/page.tsx`.
- `dashboard-frontend/app/page.tsx` -- import fixture, truyền `channelDisplayStates` xuống `ChannelGrid`.
- `dashboard-frontend/tests/ChannelGridCell.test.tsx`, `dashboard-frontend/tests/ChannelGrid.test.tsx` -- test 3 trạng thái mới + case thiếu `displayState`.
- Tham chiếu (không sửa): `dashboard-backend/src/ports/AlertOutboundPort.ts:9` (nguồn 3 giá trị `DisplayState`), `dashboard-frontend/src/styles/tokens.css:18-23,47-49,60-63` (token màu/typography/radius đã sẵn).

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-frontend/src/components/ChannelGridCell.tsx` -- thêm prop `displayState`, render alert-badge -- lõi hiển thị trạng thái của story.
- [x] `dashboard-frontend/src/components/ChannelGridCell.module.css` -- style 3 trạng thái + badge theo token -- khớp đúng giá trị DESIGN.md.
- [x] `dashboard-frontend/src/components/ChannelGrid.tsx` -- prop `channelDisplayStates`, truyền xuống cell -- vị trí ô cố định, không phụ thuộc thứ tự.
- [x] `dashboard-frontend/src/fixtures/channelDisplayStates.ts` -- fixture giả lập -- cấp dữ liệu demo vì chưa nối WS thật (Story 2.6 sau).
- [x] `dashboard-frontend/app/page.tsx` -- wiring fixture vào `ChannelGrid` -- app chạy demo được ngay.
- [x] `dashboard-frontend/tests/ChannelGridCell.test.tsx`, `ChannelGrid.test.tsx` -- cover I/O matrix -- verify không hồi quy Story 2.3 (skeleton/loaded-neutral).

**Acceptance Criteria:**
- Given ô đã loaded và có `displayState`, when render, then viền/nền đổi đúng token tương ứng, không sắp xếp lại vị trí ô.
- Given bất kỳ trạng thái nào, when render `alert-badge`, then luôn hiện đồng thời nền màu VÀ text (`OK`/`⚠ ABR`/`✕ MẤT TÍN HIỆU`), dùng đúng cặp màu `on-state-*`.
- Given đổi `displayState` giữa các trạng thái, when re-render, then không có animation/transition.

### Review Findings

- [x] [Review][Patch] Comment sai vị trí tham chiếu số đo AA — trỏ "tokens.css comment" nhưng số đo 3.68:1/10.46:1 thực tế nằm ở `DESIGN.md`, `tokens.css` không có comment nào [`ChannelGridCell.module.css:98-99`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L98-L99) — đã sửa comment trỏ đúng `DESIGN.md`.
- [x] [Review][Defer] Đường dây `page.tsx` (useMemo tính fixture từ `state.channels`) không có test end-to-end nào — đổi dependency array thành `[]`, hoặc gõ nhầm `channel.channelId` thành field string khác (vd `channel.stationName`) đều compile sạch và không có test nào fail [`page.tsx:34-43`](../../dashboard-frontend/app/page.tsx#L34-L43) — deferred, trùng mục đã defer trước đó ("page.tsx chưa từng có test nào", xem `deferred-work.md` dòng 133-135)
- [x] [Review][Defer] Badge/trạng thái không lộ ra `aria-label`/`aria-live` cho screen reader — `aria-label` của cell chỉ chứa `stationName`, không có `OK`/`⚠ ABR`/`✕ MẤT TÍN HIỆU`; kênh chuyển `critical` im lặng với assistive tech [`ChannelGridCell.tsx:102`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L102) — deferred, pre-existing (FR-14 accessibility AA đã bị `epic-2-context.md` lược bớt tới Epic 5 một cách tường minh)

## Design Notes

`displayState` tách hoàn toàn khỏi `loaded` (Story 2.3): `loaded` quyết định skeleton vs. có dữ liệu; `displayState` chỉ là lớp màu/badge phủ lên khi đã loaded — giữ đúng ranh giới 2 story, tránh Story 2.4 phải đụng lại logic `seenChannelIds`/cold-load của 2.3.

## Verification

**Commands:**
- `cd dashboard-frontend && npm test` -- expected: Vitest pass, cover đủ 3 trạng thái + case thiếu `displayState`.
- `cd dashboard-frontend && npm run build` -- expected: Next.js production build sạch.

**Manual checks:**
- Chạy `npm run dev`, xác nhận 20 ô hiện đúng màu/badge trộn ok/warning/critical theo fixture, đối chiếu trực quan với DESIGN.md (màu, tương phản chữ badge đọc rõ).

## Suggested Review Order

**Alert-badge & màu trạng thái ô (`ChannelGridCell`) — lõi hiển thị của story**

- Entry point: `displayState` chỉ có hiệu lực khi đã `loaded` — tách hoàn toàn khỏi skeleton/loaded-neutral của Story 2.3.
  [`ChannelGridCell.tsx:82`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L82)

- `DisplayState` re-export tại frontend, khớp nguyên văn 3 giá trị backend `AlertOutboundPort.ts` để Story 2.6 tái sử dụng.
  [`ChannelGridCell.tsx:27`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L27)

- Badge luôn render đồng thời nền màu + text literal DESIGN.md (`OK`/`⚠ ABR`/`✕ MẤT TÍN HIỆU`), không bao giờ chỉ 1 khối màu trơn.
  [`ChannelGridCell.tsx:111`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L111)

- Code review (round 1): `data-display-state` bỏ `?? undefined` dư thừa (đã có kiểu `DisplayState | undefined`).
  [`ChannelGridCell.tsx:108`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L108)

- 3 trạng thái màu ô + badge theo đúng color-mix/token DESIGN.md, không tự đặt tỉ lệ mới.
  [`ChannelGridCell.module.css:44`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L44)

- Code review (round 1, finding #2): `.badge` thêm `max-width`/`overflow`/`text-overflow: ellipsis` — nhãn dài `✕ MẤT TÍN HIỆU` không tràn ra ngoài ô hẹp.
  [`ChannelGridCell.module.css:76`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L76)

**Fixture giả lập trạng thái (thay thế tạm cho WS thật của Story 2.6)**

- Code review (round 1, finding #1): gán trạng thái theo hash của chính `channelId` (identity-based), KHÔNG theo vị trí/index trong mảng — tránh badge đổi màu khi registry chỉ đổi thứ tự, không đổi trạng thái thật.
  [`channelDisplayStates.ts:34`](../../dashboard-frontend/src/fixtures/channelDisplayStates.ts#L34)

- Hash chuỗi thuần, deterministic theo nội dung `channelId`, không cần chống collision mật mã học (chỉ phục vụ demo/fixture).
  [`channelDisplayStates.ts:26`](../../dashboard-frontend/src/fixtures/channelDisplayStates.ts#L26)

**Wiring qua `ChannelGrid`/`page.tsx`**

- `ChannelGrid` nhận map trạng thái theo `channelId`, truyền xuống đúng ô — vị trí ô không đổi theo trạng thái.
  [`ChannelGrid.tsx:66`](../../dashboard-frontend/src/components/ChannelGrid.tsx#L66)

- `page.tsx` tính fixture từ chính `state.channels` hiện có (KHÔNG đọc `uiWsClient`/`channelStore` cho phần trạng thái) — đúng boundary "chỉ làm UI thuần" đã chốt.
  [`page.tsx:34`](../../dashboard-frontend/app/page.tsx#L34)

**Peripherals**

- Code review (round 1, finding #3): test mới riêng cho `buildChannelDisplayStatesFixture` — verify identity-based (không phải index-based) + input rỗng không crash.
  [`channelDisplayStates.test.ts:10`](../../dashboard-frontend/tests/channelDisplayStates.test.ts#L10)

- Test 3 trạng thái + case skeleton/thiếu `displayState` của `ChannelGridCell`, cover đủ I/O matrix.
  [`ChannelGridCell.test.tsx:46`](../../dashboard-frontend/tests/ChannelGridCell.test.tsx#L46)

- Test `ChannelGrid` truyền đúng `channelDisplayStates` xuống từng cell theo `channelId`.
  [`ChannelGrid.test.tsx:100`](../../dashboard-frontend/tests/ChannelGrid.test.tsx#L100)
