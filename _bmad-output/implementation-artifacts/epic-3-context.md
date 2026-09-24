# Epic 3 Context: Panel chi tiết kênh & xác nhận tiếp nhận cảnh báo (Ack)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Cho phép đội trực click vào một kênh trên lưới tổng quan để xem chi tiết tình trạng (bitrate hiện tại, biểu đồ lịch sử, tên đài, đầu mối liên hệ xử lý sự cố), và xác nhận đã tiếp nhận cảnh báo (Ack) để tránh nhiều người gọi trùng cùng một đầu mối khi xử lý sự cố. Đây là lớp thông tin hành động (actionable info) trên nền dữ liệu trạng thái đã có từ Epic 2.

## Stories

- Story 3.1: Ring buffer lịch sử bitrate & HistoryPort tri-state
- Story 3.2: Panel chi tiết kênh (detail-panel)
- Story 3.3: Xác nhận tiếp nhận cảnh báo (Ack)

## Requirements & Constraints

- Lịch sử bitrate lưu trong ring buffer in-memory ~10-15 phút gần nhất/kênh — không dùng time-series DB cho MVP#1.
- Truy vấn lịch sử phải phân biệt tường minh 3 trạng thái: `loading` (đang tải), `loaded` (đã có dữ liệu), `no-history-data` (kênh mới/chưa đủ dữ liệu) — không được biểu diễn `no-history-data` bằng mảng rỗng hoặc giá trị 0, để tránh hiểu nhầm bitrate=0 là sự cố.
- Đầu mối liên hệ (tên đài, tên + SĐT) lấy từ `channel-registry` (nguồn chính thức duy nhất, xây ở Epic 2), không phải trường riêng của Epic 3.
- Panel chi tiết mở tức thì dạng overlay, không điều hướng trang, không chặn thao tác trên lưới phía sau; đóng bằng click ra ngoài hoặc phím `Esc`.
- Nút "Xác nhận đã tiếp nhận" chỉ tồn tại trong detail-panel — không có ack nhanh trên lưới tổng quan (buộc người ack phải thấy đủ thông tin trước khi xác nhận).
- Ack chỉ gắn nhãn (`ack-label`), tuyệt đối không đổi màu nền/viền gốc, không đổi badge, không xoá cảnh báo — sự cố chưa hết chỉ vì có người nhận.
- `ack-label` tự biến mất khi kênh phục hồi về `ok`, hoặc khi chuyển sang trạng thái cảnh báo mới (ví dụ warning→critical) — không phải khi thực hiện ack.
- Microcopy: nút ack ghi đúng "Xác nhận đã tiếp nhận" (không dùng "OK"/"Đồng ý" — trùng nhãn trạng thái `OK`, gây nhầm); nhãn ack dạng "✓ Đã nhận: {tên viết tắt}"; số liệu bitrate trình bày trần trụi (vd "Bitrate: 62%"), không diễn giải cảm tính.
- Accessibility (hoàn thiện đầy đủ ở Epic 5, nhưng cần tương thích ngay từ Epic 3): nút ack phải nằm trong thứ tự Tab và kích hoạt được bằng Enter/Space; Esc đóng panel là bắt buộc, không chỉ click-outside.

## Technical Decisions

- Backend sở hữu ack-state: frontend gửi `ack-command` (đúng envelope chung: `schema_version`, `channel_id`, `timestamp`, `event_type=ack-command`, `payload.operator_label`) qua WebSocket hiện có — đây là ngoại lệ DUY NHẤT cho chiều giao tiếp ngược (frontend→backend), chỉ giữa frontend↔backend, không đụng transport-core.
- Backend lưu `acknowledged` + `ack_label` như một phần channel state (mở rộng domain core đã có ở Epic 2), tự xoá khi kênh phục hồi `ok` hoặc chuyển cảnh báo mới.
- Định danh operator: nhập tay tên viết tắt khi ack, không cần hệ thống đăng nhập/tài khoản cho MVP#1 (giả định team nhỏ/tin cậy nội bộ — có thể cần audit chặt hơn khi vận hành thực tế).
- `HistoryPort` là 1 trong các port của hexagonal core dashboard-backend (cùng nhóm với `TelemetryInboundPort`, `AlertOutboundPort`, `ChannelRegistryPort`, `AckCommandPort`), trả discriminated result tường minh (state + data), test được độc lập bằng fake port, không cần kết nối SRT/telemetry thật.
- Ack-command đi qua `AckCommandPort` riêng ở tầng adapter inbound.
- Log audit: ack-command phải được ghi vào structured JSON-lines log cục bộ (cùng cơ chế đã dùng cho handshake/state-actor/heartbeat).
- Component frontend liên quan: `detail-panel`, `ack-label` (đặt trong thư mục `components/` chung với các component Epic 2).
- Design tokens áp dụng: `panel-padding` (đệm trong detail-panel), `rounded.lg` (14px, cho detail-panel), `rounded.pill` (10px, cho ack-label), typography `heading` (tên đài), `body` (nội dung panel, tên/SĐT liên hệ, ack-label — nâng lên 14px thay vì caption 12px vì đây là tín hiệu chống-gọi-trùng), `numeric` monospace (bitrate hiện tại + biểu đồ lịch sử).

## UX & Interaction Patterns

- Trạng thái `loading`: skeleton/placeholder cho vùng số liệu và biểu đồ, không bao giờ hiện trắng/trống.
- Trạng thái `loaded`: bitrate hiện tại (numeric), biểu đồ đường lịch sử bitrate, tên đài, tên + SĐT đầu mối liên hệ.
- Trạng thái `no-history-data`: vẫn hiện bitrate hiện tại; vùng biểu đồ hiện thông báo thiếu dữ liệu thay vì biểu đồ rỗng.
- `acknowledged` là cờ độc lập chồng lên trạng thái `warning`/`critical` hiện có: chỉ đổi kiểu viền sang nét đứt (dashed) và thêm `ack-label` bên dưới ô kênh trên lưới; màu nền/viền gốc giữ nguyên.
- Click vào bất kỳ đâu trên `channel-grid-cell` mở đúng detail-panel của kênh đó; click ra ngoài panel hoặc `Esc` đóng panel.
- Luồng điển hình: kênh chuyển warning/critical → đội trực click ô → xem bitrate/lịch sử/đầu mối liên hệ trong panel → bấm "Xác nhận đã tiếp nhận" → ô vẫn giữ viền/màu cảnh báo gốc, chỉ thêm `ack-label` → gọi điện đầu mối theo đúng SĐT lấy từ panel → khi kênh tự phục hồi `ok`, `ack-label` biến mất theo.

## Cross-Story Dependencies

- Phụ thuộc Epic 2 (Story 2.1 domain core, Story 2.2 channel-registry, Story 2.4 alert-badge/trạng thái ô) làm nền dữ liệu trạng thái và nguồn tên đài/đầu mối liên hệ.
- Story 3.2 (detail-panel) phụ thuộc Story 3.1 (HistoryPort/ring buffer) để có dữ liệu lịch sử hiển thị.
- Story 3.3 (Ack) phụ thuộc Story 3.2 (nút ack chỉ đặt trong detail-panel).
- Epic 4 (Story 4.4 thông báo phục hồi) và Epic 5 (Story 5.1 điều hướng bàn phím cho nút ack) đều dựa trên cơ chế `ack-label` tự xoá đã build ở Story 3.3.
