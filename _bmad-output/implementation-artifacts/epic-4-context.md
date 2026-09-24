# Epic 4 Context: Cảnh báo tự động qua âm thanh & Telegram/Email

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Đảm bảo đội trực sóng và lãnh đạo VTCDigital nhận được cảnh báo kịp thời ngay cả khi không nhìn trực tiếp màn hình TV wall, thông qua âm báo động tại chỗ và thông báo từ xa (Telegram/Email). Epic này hiện thực hoá trực tiếp Success Metric SM-1 (thời gian phát hiện sự cố mất tín hiệu ≤ 1 phút, tính từ lúc xảy ra sự cố đến lúc đội trực nhận được cảnh báo). Cơ chế debounce (kế thừa từ Epic 2) tránh báo động giả, cooldown 60 giây chống spam Telegram/Email, và thông báo phục hồi được ưu tiên gửi ngay để đội trực biết sự cố đã tự hết mà không cần gọi lại hỏi đài.

## Stories

- Story 4.1: Âm báo động tại chỗ khi có cảnh báo mới
- Story 4.2: Đẩy Telegram cho mức "chú ý" (ABR/warning) tới đội trực
- Story 4.3: Đẩy Telegram + Email cho mức "cảnh báo chủ động" (critical) tới đội trực & lãnh đạo
- Story 4.4: Thông báo phục hồi gửi ngay lập tức, bỏ qua cooldown

## Requirements & Constraints

- Cảnh báo mới chỉ kích hoạt sau khi trạng thái đã qua debounce ≥5 giây (dùng lại kết quả tính trạng thái từ Epic 2/dashboard-backend) — không tính lại debounce riêng ở tầng thông báo.
- Phân biệt người nhận theo mức độ nghiêm trọng: mức "chú ý" (`warning`, ABR/bitrate <70%) chỉ gửi Telegram tới đội trực sóng, KHÔNG gửi lãnh đạo. Mức "cảnh báo chủ động" (`critical`, mất tín hiệu hoàn toàn) gửi cả Telegram + Email tới đội trực sóng VÀ lãnh đạo VTCDigital. Lãnh đạo không phải người dùng dashboard, không có UI riêng, chỉ nhận qua Telegram/Email ở mức critical.
- Cooldown tối thiểu 60 giây áp dụng độc lập theo từng cặp (channel_id, alert_type) — cooldown của `warning` và `critical` trên cùng kênh không dùng chung bộ đếm.
- Thông báo phục hồi (kênh trở lại `ok`) luôn gửi ngay lập tức, không bao giờ bị chặn bởi cooldown đang chạy của cảnh báo trước đó. Nếu trạng thái trước phục hồi là `critical`, thông báo phục hồi gửi cả Telegram lẫn Email; nếu là `warning`, chỉ Telegram.
- Âm báo động tại chỗ chỉ kêu đúng 1 lần cho mỗi lần chuyển sang trạng thái cảnh báo mới (không lặp lại theo cooldown như Telegram/Email — đây là khác biệt có chủ đích: âm thanh chỉ để bắt sự chú ý ban đầu, việc nhắc định kỳ do Telegram/Email đảm nhiệm).
- Không có cơ chế tắt âm báo vĩnh viễn từ giao diện chính, và không tự động đóng/ẩn cảnh báo mà không qua phục hồi thật sự.
- Chuyển tiếp trạng thái `warning` → `critical` (ABR xấu thêm) được coi là cảnh báo MỚI: `ack-label` cũ biến mất, âm báo + Telegram/Email phát lại như một cảnh báo mới (không phải cảnh báo phục hồi).
- Không có escalation tự động khi đầu mối liên hệ không phản hồi, ngoài việc cooldown 60s lặp lại nếu trạng thái còn dao động (đã biết là giới hạn, để revisit sau pilot — không phải phạm vi epic này).
- Rủi ro vận hành đã biết và ngoài phạm vi phần mềm: phần cứng loa cảnh báo hỏng hoặc âm lượng hệ điều hành = 0 ảnh hưởng trực tiếp độ tin cậy SM-1 — cần quy trình vận hành (kiểm tra loa đầu ca) để giảm thiểu, không phải việc của epic này.
- Không có lớp bù thị giác (chỉ báo tĩnh/số đếm cảnh báo chưa ack) nếu đội trực bỏ lỡ âm báo đầu tiên — đã ghi nhận là khoảng hở đã biết, cân nhắc bổ sung ở giai đoạn sau pilot, không bắt buộc cho epic này.

## Technical Decisions

- Toàn bộ logic debounce/threshold/cooldown/mapping severity nằm tại dashboard-backend (domain core, hexagonal), tách biệt khỏi adapter outbound — transport-core không biết gì về Telegram/Email.
- Outbound adapter riêng cho Telegram và Email nằm trong `dashboard-backend/adapters/outbound/` (song song với adapter WebSocket → React); domain core giao tiếp qua `AlertOutboundPort` (không phụ thuộc trực tiếp SDK Telegram/Email).
- Domain core phải test được độc lập bằng fake ports, không cần hạ tầng thật (Telegram bot thật, SMTP thật, máy trung tâm thật).
- Dashboard-backend chạy dưới Windows Service với auto-restart; vì toàn bộ debounce/threshold/cooldown/alert tập trung ở đây, một bản lỗi có thể ảnh hưởng cảnh báo của toàn bộ kênh cùng lúc — cần cẩn trọng khi thay đổi logic cooldown/dedup.
- Envelope event chung áp dụng cho `alert` event nội bộ giữa domain core và adapter: `schema_version`, `channel_id`, `timestamp` (ISO 8601 UTC), `event_type`, `payload`.

## Cross-Story Dependencies

- Phụ thuộc Epic 2 (Story 2.1): trạng thái `ok`/`warning`/`critical` đã được tính sẵn qua debounce ≥5s tại dashboard-backend — Epic 4 chỉ phản ứng theo trạng thái đó, không tự tính lại ngưỡng/debounce.
- Liên quan Story 3.3 (Ack): `ack-label` tự biến mất khi kênh phục hồi `ok` hoặc chuyển sang cảnh báo mới — Story 4.4 cần đồng bộ đúng thời điểm này khi gửi thông báo phục hồi.
- Story 4.2 và 4.3 dùng chung cơ chế cooldown/gửi thông báo nhưng khác nhau về danh sách người nhận và kênh gửi (Telegram-only vs Telegram+Email) — nên thiết kế chung 1 pipeline outbound có tham số hoá theo alert_type, tránh trùng lặp code giữa 2 story.
- Story 4.1 (âm báo) độc lập về mặt kỹ thuật với 4.2/4.3/4.4 (không qua cooldown, không qua mạng ngoài) nhưng cùng kích hoạt từ 1 điểm sự kiện "cảnh báo mới" — cần đảm bảo cả 2 nhánh (âm thanh tại chỗ + Telegram/Email từ xa) bắn ra đồng thời từ cùng 1 lần chuyển trạng thái, không lệch nhau.
