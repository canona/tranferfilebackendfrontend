---
title: 'Story 5.1: Điều hướng đầy đủ bằng bàn phím'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '41056f561a1d4afbb7f1bc1e091d6da15f7b5226'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Lưới 20 `channel-grid-cell` và `detail-panel` đã có `tabIndex`/Enter/Space/Esc rời rạc, nhưng thứ tự Tab thực tế theo DOM order của mảng `channels` (từ `registry-snapshot`), KHÔNG đảm bảo khớp `gridPosition`; ô kênh chưa có viền focus; và panel chưa quản lý focus khi mở/đóng — nên "điều hướng đầy đủ bằng bàn phím" chưa thực dụng được.

**Approach:** Sắp `displayChannels` theo `gridPosition` tăng dần trước khi render (DOM order = thứ tự Tab yêu cầu); thêm CSS `:focus-visible` cho `.cell` dùng token `--color-focus-ring` có sẵn (mirror pattern `ackInput`/`ackButton`); thêm focus management tối thiểu cho `detail-panel` (chuyển focus vào panel khi mở, trả về phần tử trước đó khi đóng), không đổi hành vi Esc/click-outside/ack đã có.

## Boundaries & Constraints

**Always:**
- DOM order của 20 `channel-grid-cell` phải khớp `gridPosition` tăng dần (0→19), bất kể thứ tự phần tử trong mảng `channels` nhận từ `registry-snapshot`.
- `.cell` phải có outline `focus-visible` dùng `var(--color-focus-ring)`, cùng pattern với `ackInput`/`ackButton` hiện có.
- Khi `detail-panel` chuyển từ đóng→mở, focus phải chuyển vào bên trong panel (chính phần tử dialog); khi đóng, focus trả về phần tử đã có focus ngay trước lúc mở (nếu phần tử đó còn trong DOM).
- Giữ nguyên hành vi hiện có: Esc đóng panel, click-outside/chuyển kênh khác, ack button native `<button>` đã tự hoạt động Enter/Space qua `disabled` — không sửa các phần này, chỉ bổ sung test.

**Ask First:** Nếu khi test thủ công phát hiện dữ liệu `registry-snapshot` thật có `gridPosition` trùng lặp hoặc không phủ đủ 0-19 — HALT, hỏi người dùng trước khi thêm validate (ngoài phạm vi story, AD-26 giả định `gridPosition` hợp lệ/duy nhất).

**Never:** Không xây roving-tabindex/`aria-activedescendant`; không thêm Tab-trap ngăn Tab thoát khỏi panel khi đang mở (không thuộc AC); không thêm dependency mới (vd `@testing-library/user-event`) — test thứ tự Tab bằng assert DOM order/`data-grid-position`, không mô phỏng phím Tab thật; không đổi giao thức WebSocket/backend hay tạo component mới.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Registry chưa sort | `channels` từ snapshot có thứ tự `gridPosition` bất kỳ (vd đảo ngược) | DOM render tăng dần theo `gridPosition`, Tab đi đúng trái→phải/trên→dưới | N/A |
| Mở panel bằng bàn phím | Cell đang focus, nhấn Enter/Space | `onSelect` mở panel; ngay sau mở, focus chuyển vào phần tử dialog của panel | N/A |
| Đóng panel, cell nguồn vẫn còn | Đang trong panel, nhấn Esc | Panel đóng; focus trả về đúng cell đã mở nó | N/A |
| Đóng panel, cell nguồn đã rời DOM | Cell đã mở panel không còn tồn tại lúc đóng (hiếm) | Panel đóng bình thường, không throw | Focus rơi về mặc định của trình duyệt (`document.body`), không bắt buộc phải re-focus |

</frozen-after-approval>

## Code Map

- `dashboard-frontend/src/components/ChannelGrid.tsx:78-104` -- `displayChannels.map(...)` render theo thứ tự mảng `channels`; cần sort theo `gridPosition` trước khi map (giữ nguyên `key`, style, props khác).
- `dashboard-frontend/src/components/ChannelGridCell.tsx:198-240` -- `.cell` đã có `tabIndex={onSelect ? 0 : undefined}` (215) và `onKeyDown` Enter/Space (216-227); chỉ thiếu CSS focus-visible, không sửa TSX.
- `dashboard-frontend/src/components/ChannelGridCell.module.css` -- nơi thêm rule `.cell:focus-visible`, mirror `DetailPanel.module.css:209-212,235-238`.
- `dashboard-frontend/src/components/DetailPanel.tsx:85-146` -- `panelRef` (89) hiện chỉ dùng để `.contains()` (133), chưa `.focus()`; Esc handler có sẵn (104-113); click-outside/chuyển kênh capture-phase có sẵn (128-144). Thêm `tabIndex={-1}` cho `.panel` div (169-177) + `useEffect` focus khi `isOpen` true, lưu/trả `document.activeElement` trước đó.
- `dashboard-frontend/src/components/DetailPanel.tsx:284-297` -- ack button, native, đã hoạt động Enter/Space qua `disabled` (292) — không sửa.
- `dashboard-frontend/src/styles/tokens.css:25` -- `--color-focus-ring: #2f8fff`.
- `dashboard-frontend/src/state/channelStore.ts:170-171` -- `applyRegistrySnapshot` lưu `channels` nguyên trạng từ backend, không sort — xác nhận nguồn thứ tự không đảm bảo theo `gridPosition`.
- `dashboard-frontend/tests/ChannelGrid.test.tsx`, `tests/DetailPanel.test.tsx`, `tests/ChannelGridCell.test.tsx` -- pattern RTL/Vitest có sẵn (`fireEvent.keyDown`, `act`) để mở rộng test mới.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-frontend/src/components/ChannelGrid.tsx` -- sort bản sao `displayChannels` theo `gridPosition` tăng dần trước `.map()` -- đảm bảo DOM order = thứ tự Tab yêu cầu, độc lập thứ tự mảng `channels` gốc.
- [x] `dashboard-frontend/src/components/ChannelGridCell.module.css` -- thêm `.cell:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: ...; }` -- viền focus rõ ràng cho ô kênh (hiện chưa có bất kỳ rule focus nào).
- [x] `dashboard-frontend/src/components/DetailPanel.tsx` -- thêm `tabIndex={-1}` trên `.panel` div; `useEffect` khi `isOpen` chuyển `false→true`: lưu `document.activeElement` vào ref, gọi `panelRef.current?.focus()`; khi chuyển `true→false`: gọi `.focus()` lại trên phần tử đã lưu nếu còn `isConnected` -- hoàn thiện luồng mở/đóng panel thực dụng bằng bàn phím.
- [x] `dashboard-frontend/tests/ChannelGrid.test.tsx` -- test DOM order (`data-grid-position` các cell theo thứ tự xuất hiện) tăng dần đúng dù truyền `channels` với thứ tự `gridPosition` đảo ngược.
- [x] `dashboard-frontend/tests/DetailPanel.test.tsx` -- test: mở panel (qua `store.selectChannel`) thì `document.activeElement` là phần tử panel; đóng bằng Esc thì focus trả về phần tử đã focus trước đó (dùng 1 nút/input giả lập ngoài panel để `.focus()` trước khi mở).

**Acceptance Criteria:**
- Given lưới 20 ô đã render với `channels` bất kỳ thứ tự, when duyệt DOM theo thứ tự xuất hiện, then `data-grid-position` tăng dần liên tục 0→19.
- Given một `channel-grid-cell` đang focus, when nhấn Enter hoặc Space, then `detail-panel` mở và nhận focus ngay.
- Given `detail-panel` đang mở do focus từ 1 cell cụ thể, when nhấn Esc, then panel đóng và focus trả lại đúng cell đó.
- Given `detail-panel` đang ở trạng thái hiện ack input/button (`warning`/`critical`), when Tab tới nút "Xác nhận đã tiếp nhận" và nhấn Enter/Space, then hành vi ack kích hoạt như khi click (không hồi quy so với hiện tại).

### Review Findings

- [x] [Review][Decision] AC4 (nút ack Enter/Space) không có test tự động — Spec's Acceptance Criteria #4 yêu cầu verify "Enter/Space kích hoạt ack như click", nhưng Tasks list không có task nào cho AC này và test hiện có (`tests/DetailPanel.test.tsx` ack-button, dòng ~401/417) chỉ dùng `fireEvent.click`, không có `fireEvent.keyDown`. Vướng: cách duy nhất mô phỏng đúng hành vi native-button-Enter/Space trong jsdom là `@testing-library/user-event`, nhưng spec's Never cấm thêm dependency này. **Quyết định (2026-09-23, người dùng xác nhận):** chấp nhận xác thực thủ công, không thêm test tự động, không nới Never — đã bổ sung bước manual check tương ứng vào mục Verification.

- [x] [Review][Defer] `.panel` không có CSS `:focus-visible` khi nhận focus lập trình lúc mở bằng bàn phím [dashboard-frontend/src/components/DetailPanel.module.css:27] — deferred, ngoài phạm vi AC (Boundaries chỉ yêu cầu outline cho `.cell`), overlay/backdrop đã tạo độ nổi bật thị giác riêng khi mở.

- [x] [Review][Defer] `useMemo` gọi lại `placeholderChannels()` tạo mảng mới mỗi render trong khoảng ngắn trước khi có `registry-snapshot` đầu tiên (`channels.length===0`) [dashboard-frontend/src/components/ChannelGrid.tsx:96] — deferred, chỉ ảnh hưởng cửa sổ tải rất ngắn, không phải lỗi hành vi.

- [x] [Review][Defer] `aria-modal="true"` trên `.panel` mâu thuẫn ngữ nghĩa ARIA với chủ trương "không Tab-trap" của Story 5.1 [dashboard-frontend/src/components/DetailPanel.tsx:203] — deferred, pre-existing từ Story 3.2, không thuộc diff này.

- [x] [Review][Defer] `previouslyFocusedElementRef` không kiểm tra phần tử có bị disabled/ẩn trước khi `.focus()` lại [dashboard-frontend/src/components/DetailPanel.tsx:169] — deferred, hiện chưa có đường dẫn thực tế nào trong app khiến cell nguồn bị disabled/ẩn trong lúc panel mở.

- [x] [Review][Defer] (đã ghi nhận ở lần review trước) Focus trả về đúng cell đã MỞ panel lần đầu, không phải cell đang xem gần nhất khi chuyển kênh giữa lúc panel mở — 4 layer review lần này xác nhận lại độc lập cùng phát hiện, không có thông tin mới. Xem `deferred-work.md`'s mục "Deferred from: code review of spec-5-1..." (2026-09-23) để biết quyết định cần chờ.

**Vòng review thứ 2 (2026-09-23, 4 layer: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor) — chỉ finding MỚI, không lặp lại các mục đã ghi ở trên:**

- [x] [Review][Patch] Thiếu test cho `useMemo` dependency `[channels]` khi registry-snapshot cập nhật lại (rerender với `channels` thứ 2 khác thứ tự) — mọi test hiện có chỉ render 1 lần rồi assert ngay, không bắt được regression nếu dependency array bị làm sai (vd đổi thành `[]`/`[channels.length]`, đúng cái mà comment trong code đã cảnh báo là lựa chọn sai dễ mắc) [`ChannelGrid.tsx:96-99`] — đã thêm test `rerender` trong `tests/ChannelGrid.test.tsx`, 260/260 test pass.
- [x] [Review][Patch] Thiếu test focus-restore qua đường đóng click-outside (`handlePointerDownCapture`) — chỉ có test cho đường Esc, dù effect focus-restore áp dụng chung cho mọi cách đóng panel [`DetailPanel.tsx:158`] — đã thêm test trong `tests/DetailPanel.test.tsx`.
- [x] [Review][Patch] Thiếu test bảo vệ hành vi "chuyển sang kênh khác trong lúc panel đang mở không re-trigger effect mở/cướp lại focus" — hành vi đã được quyết định tường minh (code review round 3, comment tại chỗ) nhưng không có test nào chặn regression nếu ai đó vô tình đổi dependency sang `selectedChannelId` [`DetailPanel.tsx:158`] — đã thêm test trong `tests/DetailPanel.test.tsx`.
- [x] [Review][Defer] Focus-restore qua click CHUỘT (khác đường Enter/Space) có thể không hoạt động trên Safari — `channel-grid-cell` là `<div tabIndex=0>` (non-form element); Safari lịch sử không tự đưa focus vào phần tử non-form khi click chuột, nên `document.activeElement` lúc panel mở có thể không phải cell vừa click, khiến bước LƯU (không phải bước trả lại) sai ngay từ đầu. Đường bàn phím Enter/Space không bị ảnh hưởng (đã verify `onKeyDown` chỉ fire khi cell đã có focus) [`ChannelGridCell.tsx:199-215`, `DetailPanel.tsx:158`] — deferred, ngoài phạm vi AC (AC mô tả luồng bàn phím, không phải click chuột); khác góc với finding "disabled/hidden check" đã ghi ở vòng trước.

*Dismissed (đã kiểm chứng, không phải lỗi thật):* gridPosition trùng/ngoài 0-19 không được validate ở frontend — backend `fileChannelRegistryAdapter.ts:160-179` đã enforce integer/unique/0-19, và spec's Boundaries (AD-26 + "Ask First") loại trừ tường minh việc thêm validate ở story này. `useMemo` phụ thuộc reference ổn định của `channels` — đã verify `channelStore.ts`'s các `applyX` khác đều spread `...this.state` không đụng `channels`, chỉ `applyRegistrySnapshot` mới đổi reference, nên memo hoạt động đúng như thiết kế.

## Spec Change Log

## Verification

**Commands:**
- `cd dashboard-frontend && npm test` -- expected: toàn bộ test hiện có + test mới (tab-order, focus mở/đóng panel) pass.

**Manual checks (if no CLI):**
- Chạy `npm run dev`, mở dashboard trên trình duyệt thật: nhấn Tab liên tục từ đầu trang, xác nhận focus đi qua 20 ô theo đúng thứ tự trái→phải/trên→dưới, viền focus xanh (`#2F8FFF`) hiện rõ; Enter mở panel và focus chuyển ngay vào panel; Esc đóng panel và focus quay lại đúng ô.
- **[Review][Decision đã chốt]** AC4: mở panel của 1 kênh đang `warning`/`critical`, Tab tới nút "Xác nhận đã tiếp nhận", nhấn Enter hoặc Space — xác nhận hành vi ack kích hoạt giống hệt khi click (native `<button>`, không có test tự động do spec's Never cấm thêm `@testing-library/user-event` — cách duy nhất mô phỏng đúng Enter/Space→click trên button trong jsdom).

## Suggested Review Order

**Thứ tự Tab qua lưới 20 ô**

- Điểm vào chính: sort 1 bản sao `displayChannels` theo `gridPosition` trước khi render, tách biệt hoàn toàn khỏi thứ tự mảng `channels` gốc từ registry-snapshot.
  [`ChannelGrid.tsx:96`](../../dashboard-frontend/src/components/ChannelGrid.tsx#L96)

- Bọc `useMemo` (patch code review) để không sort lại mỗi khi WebSocket đẩy audioLevels/displayStates/snapshots mới, không liên quan `channels`.
  [`ChannelGrid.tsx:89`](../../dashboard-frontend/src/components/ChannelGrid.tsx#L89)

**Quản lý focus khi mở/đóng detail-panel**

- `tabIndex={-1}` cho phép `.focus()` chương trình vào panel mà không đưa panel vào thứ tự Tab tự nhiên (không tạo Tab-trap).
  [`DetailPanel.tsx:211`](../../dashboard-frontend/src/components/DetailPanel.tsx#L211)

- Effect theo `isOpen`: lưu phần tử đang focus trước khi mở, focus vào panel; khi đóng, trả focus về phần tử đã lưu nếu còn trong DOM.
  [`DetailPanel.tsx:158`](../../dashboard-frontend/src/components/DetailPanel.tsx#L158)

**Viền focus cho ô kênh**

- Rule `.cell:focus-visible` mirror pattern `ackInput`/`ackButton` đã có, dùng token `--color-focus-ring` sẵn có.
  [`ChannelGridCell.module.css:42`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L42)

**Test**

- Xác nhận DOM order (`data-grid-position`) tăng dần 0-19 dù mảng `channels` truyền vào đảo ngược.
  [`ChannelGrid.test.tsx:323`](../../dashboard-frontend/tests/ChannelGrid.test.tsx#L323)

- Xác nhận mở panel chuyển focus vào panel; đóng bằng Esc trả focus đúng chỗ; cell nguồn rời DOM thì không throw và focus rơi về `document.body`.
  [`DetailPanel.test.tsx:238`](../../dashboard-frontend/tests/DetailPanel.test.tsx#L238)
