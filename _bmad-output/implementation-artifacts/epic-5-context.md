# Epic 5 Context: Điều hướng bàn phím & khả năng tiếp cận đầy đủ

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Đảm bảo toàn bộ dashboard giám sát dùng được hoàn toàn bằng bàn phím và mọi tín hiệu trạng thái/cảnh báo không phụ thuộc riêng vào màu sắc, để đội trực thao tác được ngay cả khi không dùng chuột thuận tiện và người khiếm thị màu/ánh sáng phòng biến động vẫn đọc đúng trạng thái. Epic này là gate bắt buộc: các component liên quan (`channel-grid-cell`, `alert-badge`, `vu-meter`, `detail-panel`, `connection-banner`) đã build ở Epic 2/3 nhưng phần điều hướng bàn phím và xác thực accessibility AA đã bị lược bớt khỏi giai đoạn pilot 1 kênh — phải hoàn thiện đầy đủ ở epic này trước khi hệ thống được mở rộng từ pilot lên 20 kênh.

## Stories

- Story 5.1: Điều hướng đầy đủ bằng bàn phím
- Story 5.2: Xác thực & hoàn thiện accessibility không phụ thuộc màu đơn lẻ (AA)

## Requirements & Constraints

- Tab phải di chuyển focus qua toàn bộ 20 `channel-grid-cell` theo đúng thứ tự vị trí lưới (trái→phải, trên→dưới) — thứ tự tab phải khớp `grid_position` từ channel-registry, không khớp thứ tự event/mảng dữ liệu.
- `Enter`/`Space` mở `detail-panel` của ô đang focus; `Esc` đóng panel (bắt buộc, không chỉ click-outside).
- Nút "Xác nhận đã tiếp nhận" trong `detail-panel` phải nằm trong thứ tự Tab và kích hoạt được bằng `Enter`/`Space`.
- Viền focus phải rõ ràng, dùng token `focus-ring`, đạt tương phản ≥3:1 so với nền xung quanh (đã đo: 5.98:1 so với `surface-base`, 5.36:1 so với `surface-raised` — đạt ngưỡng thoải mái).
- Không nơi nào trên dashboard được truyền đạt trạng thái/cảnh báo chỉ bằng màu — mọi trạng thái phải kèm icon hoặc chữ.
- Chuẩn tương phản AA áp dụng toàn bộ token: chữ thường ≥4.5:1, đồ hoạ/border/focus-ring ≥3:1; riêng `on-state-critical` giữ nguyên 5.94:1 (đạt AA, cố ý không ép AAA để giữ độ bão hoà bắt mắt ngoại vi trong phòng trực tối 24/7).
- Không tải font ngoài (system-ui font stack) và không có animation/transition gây xao nhãng — áp dụng xuyên suốt, kể cả khi thêm focus-ring/indicator mới.
- `[ASSUMPTION cần xác nhận]` Kích thước chữ/icon (`channel-name`, `alert-badge`, `numeric`, và đặc biệt `ack-label` đang ở cỡ nhỏ nhất hệ thống) cần được đo/validate trên màn hình TV wall thật theo khoảng cách xem thực tế của phòng trực, điều chỉnh nếu cần — trước khi mở rộng lên 20 kênh.
- Epic này là điều kiện chặn rollout: mở rộng từ pilot 1 kênh lên 20 kênh chỉ được thực hiện sau khi FR-13/FR-14 hoàn thiện đầy đủ (cùng với RACI passphrase đã chứng thực) — không phải tính năng có thể trì hoãn tuỳ ý.

## Technical Decisions

- FR-13 (điều hướng bàn phím) không có Architecture Decision (AD) kiến trúc riêng — toàn bộ hành vi được governed trực tiếp bởi UX spine (EXPERIENCE.md), không cần thiết kế backend/domain mới.
- Component chịu ảnh hưởng đã tồn tại từ Epic 2/3: `channel-grid-cell` (Story 2.4), `alert-badge` (Story 2.4), `vu-meter` (Story 2.5), `detail-panel` (Story 3.2), nút ack (Story 3.3), `connection-banner` (Story 2.7) — epic 5 bổ sung hành vi/token lên các component này, không tạo component mới.
- Token màu liên quan đã có sẵn trong design tokens (dark-only), không cần thêm màu chromatic mới: `focus-ring` (= giá trị `accent`, `#2F8FFF`), `on-state-warning`, `on-state-critical`, `on-state-ok` (đã đo và điều chỉnh để đạt AA, không dùng thẳng `state-ok`/`state-warning`/`state-critical` làm màu chữ).
- Nguyên tắc "không phụ thuộc màu đơn lẻ" đã áp dụng một phần: `alert-badge` luôn có nền màu + chữ/icon; ack chỉ đổi border-style sang dashed (không đổi màu) — đây là pattern mẫu để mở rộng sang các chỗ còn thiếu (đặc biệt `vu-meter`, xem UX section).
- Toàn bộ frontend là React (dashboard-frontend), state trạng thái (ok/warning/critical) được tính sẵn ở backend và chỉ render thuần ở frontend — hành vi bàn phím/focus là thuần frontend, không cần thay đổi giao thức WebSocket hay envelope event.

## UX & Interaction Patterns

- Tương đương bàn phím đầy đủ cho mọi thao tác chuột hiện có: click ô ↔ Tab+Enter/Space; click-outside/Esc để đóng panel ↔ Esc bắt buộc.
- Vị trí cố định của lưới 20 ô cũng đóng vai trò accessibility về trí nhớ không gian — thứ tự Tab phải nhất quán với vị trí thị giác cố định đó, không được thay đổi theo trạng thái/cảnh báo.
- Gap đã ghi nhận từ review accessibility (cần xử lý trong Story 5.1/5.2):
  - `vu-meter` hiện chỉ dùng gradient màu (audio-normal→state-warning→state-critical) để báo mức âm — thiếu chỉ báo phi-màu phân biệt 3 mốc ngoài 2 vạch ngưỡng cố định (`warning-mark`, `peak-mark`) đã có; 2 vạch ngưỡng này phải luôn hiển thị bất kể trạng thái/màu hiện tại.
  - `alert-badge` ở trạng thái `ok` từng đo tương phản chữ chỉ ~3.68:1 (dưới AA) khi dùng thẳng `state-ok` — phải dùng token `on-state-ok` (đã đo 10.46:1) thay vì màu trạng thái trực tiếp.
  - `ack-label` dùng cỡ chữ nhỏ nhất hệ thống (`caption`, 12px) cho một tín hiệu vận hành quan trọng (chống gọi trùng đầu mối liên hệ) — cần rà soát lại có đủ phân biệt ở khoảng cách xem TV wall hay không, cùng đợt đo kích thước chữ ở Story 5.2.
  - Trước Story 5.1, đặc tả chỉ mô tả click để mở ô/đóng panel, không có cơ chế bàn phím tường minh — đây chính là khoảng trống Story 5.1 phải lấp đầy (thứ tự focus, phím mở ô, phím kích hoạt nút ack).
- Microcopy/voice-tone (badge, nút ack, số liệu) đã chuẩn hoá ở epic trước, không thuộc phạm vi thay đổi ở epic này.

## Cross-Story Dependencies

- Story 5.1 và 5.2 đều thao tác trên các component đã hoàn thiện chức năng ở Epic 2 (`channel-grid-cell`, `alert-badge`, `vu-meter`, `connection-banner`) và Epic 3 (`detail-panel`, nút ack) — không tạo mới, chỉ bổ sung hành vi bàn phím/token accessibility lên component có sẵn.
- Story 5.2 phụ thuộc kết quả tương phản đã đo sẵn ở design tokens (không cần đo lại từ đầu) nhưng phải bổ sung đo đạc còn thiếu (ack-label, kích thước chữ trên TV wall thật) trước khi coi là "đã xác thực".
- Việc mở rộng hệ thống từ pilot 1 kênh lên 20 kênh (ngoài phạm vi epic này) bị chặn cho tới khi cả Story 5.1 và 5.2 hoàn thành, cùng với điều kiện RACI passphrase (thuộc phạm vi vận hành/Epic 1, không phải epic 5).
