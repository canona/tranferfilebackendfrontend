---
id: SPEC-video-preview-snapshot-thật
companions: []
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Video-preview thật qua WebSocket (AD-22)

## Why

Kiến trúc gốc (AD-22) đã định nghĩa: mỗi máy trung tâm định kỳ trích khung JPEG độ phân giải thấp, gửi qua LAN dưới `event_type=snapshot`, không gửi khi kênh `critical`. Story 2.5 dựng UI cho phần thân ô lưới (thumbnail/color-bars/vu-meter) nhưng **explicit defer** đúng phần này — placeholder gradient hash-theo-`channelId` thay cho ảnh thật, ghi rõ trong Never: *"Nối WebSocket/backend thật cho audioLevel/snapshot... Ảnh JPEG thật/snapshot thật"*. Đội trực giám sát nhiều kênh cùng lúc trên lưới tổng quan — placeholder không cho biết kênh có đang phát đúng nội dung hay không, chỉ có state (ok/warning/critical) và VU meter. Spec này lấp đúng khoảng trống đó: forward khung JPEG thật từ transport-core qua dashboard-backend tới dashboard-frontend, thay placeholder bằng ảnh thật khi kênh ok/warning.

## Capabilities

- **CAP-1**
  - **intent:** dashboard-backend nhận `event_type=snapshot` qua kết nối WS Telemetry (transport-core → backend), validate `channel_id` có mặt, đã đăng ký trong channel-registry, và `payload.image_base64` là string non-empty; forward nguyên văn (`channelId`, `imageBase64`, `timestamp`) tới tầng outbound.
  - **success:** Gửi 1 envelope `event_type=snapshot` hợp lệ cho channel đã đăng ký → outbound port nhận đúng 3 giá trị, `telemetryPort`/`heartbeatPort` không bị chạm. Envelope thiếu `channel_id` hoặc `payload.image_base64` rỗng/sai kiểu → không forward, log `envelope_invalid`, connection WS vẫn sống.

- **CAP-2**
  - **intent:** Tầng outbound (WS UI) giữ khung snapshot mới nhất theo từng channel (không phải lịch sử) để replay ngay cho client dashboard connect muộn.
  - **success:** Publish nhiều khung liên tiếp cho cùng 1 channel rồi mới có client connect → client nhận đúng khung **mới nhất**, không phải khung đầu tiên. Thứ tự replay lúc connect: `registry-snapshot` → `channel-seen` → `channel-state-change` → `channel-snapshot` (snapshot luôn sau cùng).

- **CAP-3**
  - **intent:** dashboard-frontend nhận message `channel-snapshot` qua WS UI, validate hình dạng thô, và lưu trạng thái sẵn-dùng-để-render (data-URI) cho từng channel.
  - **success:** Message `channel-snapshot` hợp lệ → store lưu `data:image/jpeg;base64,<...>` theo đúng `channel_id`, ghi đè khi có khung mới cho cùng channel. Message thiếu/rỗng `channel_id`/`image_base64` → bỏ qua âm thầm, store không đổi.

- **CAP-4**
  - **intent:** Người vận hành nhìn lưới tổng quan thấy ảnh thật của kênh (không phải placeholder giả) khi kênh đang ok/warning.
  - **success:** Channel có `snapshotDataUri` và `displayState` ok/warning → thumbnail render đúng ảnh đó làm nền (warning vẫn chồng icon cảnh báo). Channel chưa có `snapshotDataUri` → fallback gradient placeholder hiện có, không lỗi/không trống. Channel `critical` → luôn color-bars tĩnh, bất kể có `snapshotDataUri` hay không.

- **CAP-5**
  - **intent:** Khi 1 channel chuyển sang `critical`, cache khung-mới-nhất của channel đó bị xoá — cả backend lẫn frontend — để khi phục hồi về ok/warning không hiện nhầm ảnh cũ.
  - **success:** Channel có `snapshotDataUri`/cache snapshot, chuyển `displayState` sang `critical` → backend (`wsUiAdapter`'s `lastSnapshot`) và frontend (`channelStore`'s `channelSnapshots`) đều xoá entry của channel đó. Phục hồi về ok/warning ngay sau đó (trước khi có khung mới từ transport-core) → UI fallback gradient placeholder, không hiện ảnh cũ.

## Constraints

- `channel_id` không có trong channel-registry → bỏ qua, log `channel_unregistered`, không forward, không cache (chặn phình cache vô hạn từ channel rác).
- `image_base64` forward nguyên văn xuyên suốt mọi layer backend và transport layer của frontend — không decode/validate/re-encode/diễn giải nội dung ảnh ở đâu ngoài bước build data-URI trong store.
- Không debounce ở bất kỳ layer nào — transport-core tự kiểm soát nhịp gửi (~1.5s/kênh khi CONNECTED, tự ngừng khi RECONNECTING/critical); mọi tầng forward/ghi đè mỗi khung nhận được.
- Exception từ implementation của cổng inbound/outbound snapshot phải được bắt và log (không throw ra ngoài) — không được crash process hay đóng kết nối WS đang mở.
- Cache khung-mới-nhất-theo-channel ghi đè vô điều kiện, không idempotent-guard (mirror `channel-state-change`) — mỗi khung nhận được coi là mới.
- `displayState=critical` luôn override sang color-bars tĩnh, kể cả khi còn `snapshotDataUri` cũ cho channel đó — an toàn hiển thị ưu tiên hơn continuity hình ảnh.
- data-URI được build đúng 1 lần tại thời điểm nhận (áp dụng vào store), không build lại ở mỗi lần render.
- Xoá cache snapshot khi vào `critical` (CAP-5) kiểm tra đúng 1 điều kiện `displayState === 'critical'` — không cần điều kiện riêng cho `subType='machine-offline'`, vì subtype đó chỉ có hiệu lực khi `displayState` đã là `critical`.
- Không giới hạn/backpressure kích thước message `channel-snapshot` ở tầng nhận (WS Telemetry lẫn WS UI) — quyết định dứt khoát, không cần triển khai giới hạn.

## Non-goals

- Xử lý/diễn giải nội dung ảnh (resize, re-encode, validate byte JPEG) ở bất kỳ layer nào — trách nhiệm của trình duyệt khi gán data-URI.
- Lưu lịch sử nhiều khung/kênh (ring buffer ảnh) — chỉ giữ đúng 1 khung mới nhất/kênh, khác `HistoryPort` bitrate ring-buffer của Epic 3 (AD-14).
- Panel chi tiết kênh / ảnh độ phân giải đầy đủ (Epic 3 Story 3.2, chưa xây).
- Cơ chế backfill/gửi lại snapshot khi kênh phục hồi từ critical — transport-core tự ngừng gửi khi critical; sau khi cache bị xoá (CAP-5), kênh chỉ có ảnh thật trở lại khi transport-core tự gửi khung tiếp theo, spec này không định nghĩa cơ chế yêu cầu gửi sớm hơn.
- Giới hạn/backpressure cho message snapshot cỡ lớn ở tầng nhận — quyết định không cần, xem Constraints.

## Success signal

Một kênh ở trạng thái ok/warning hiển thị ảnh JPEG thật cập nhật theo đúng nhịp transport-core gửi (~1.5s/khung) thay vì placeholder gradient; một dashboard client mở muộn thấy ngay khung mới nhất/kênh mà không cần chờ tick kế tiếp; snapshot của channel_id chưa đăng ký không bao giờ tới được UI và không tích luỹ trong cache backend; một kênh chuyển sang critical rồi phục hồi không bao giờ hiện ảnh cũ trước khi có khung mới.

## Assumptions

- Input của spec này hoàn toàn là code đã implement (uncommitted) + comment inline đi kèm, không phỏng vấn user trực tiếp — giả định comment phản ánh đúng quyết định đã chốt lúc code, không có version-drift giữa các file liên quan.
