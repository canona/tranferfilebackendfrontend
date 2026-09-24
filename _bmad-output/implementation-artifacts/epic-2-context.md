# Epic 2 Context: Giám sát trạng thái kênh thời gian thực & phân loại cảnh báo trên lưới

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Đội trực sóng nhìn lưới 20 ô cố định vị trí theo đài và thấy ngay trạng thái từng kênh (`ok`/`warning`/`critical`) theo thời gian thực, event-driven (không polling), với debounce 5 giây chống nhấp nháy do nhiễu tức thời. Epic này dựng ranh giới kiến trúc cốt lõi: dashboard-backend là nơi DUY NHẤT tính debounce/ngưỡng/trạng thái từ telemetry thô do transport-core gửi lên; frontend chỉ render thuần, không tự suy luận. Epic cũng xử lý đúng 2 tình huống mất kết nối khác nhau về bản chất — mất toàn bộ luồng dữ liệu giám sát (`disconnected`) và một máy trung tâm cụ thể bị lỗi phần cứng/phần mềm (`machine-offline`) — để đội trực không bao giờ nhầm dữ liệu cũ là đang live hoặc chẩn đoán sai nguyên nhân sự cố.

## Stories

- Story 2.1: Dashboard-backend — ranh giới telemetry thô → trạng thái tính toán
- Story 2.2: Channel-registry hot-reload — nguồn liệt kê kênh & vị trí lưới chính thức
- Story 2.3: Design tokens & lưới tổng quan cố định vị trí (cold-load)
- Story 2.4: Trạng thái ô kênh (ok/warning/critical) & alert-badge
- Story 2.5: VU meter & thumbnail/color-bars theo trạng thái
- Story 2.6: Cập nhật trạng thái kênh event-driven qua WebSocket
- Story 2.7: Xử lý mất kết nối dữ liệu giám sát (`disconnected`) & máy trung tâm chết (`machine-offline`)

## Requirements & Constraints

- Mapping trạng thái: `CONNECTED`+bitrate≥70% → `ok`; `CONNECTED`+bitrate<70% → `warning`; `RECONNECTING` → `critical`; `REJECTED` → `critical` kèm sub-type "nghi vấn cấu hình/bảo mật" (khác sub-type với mất tín hiệu thường).
- Đổi trạng thái hiển thị chỉ sau khi trạng thái mới ổn định liên tục ≥5 giây (debounce); VU meter cập nhật real-time, KHÔNG qua debounce này.
- Toàn bộ cập nhật qua event stream, không polling. Cold-load: mỗi ô chuyển skeleton→dữ liệu thật ngay khi kênh đó có event (~1-2s), không chờ đủ 20 kênh.
- Vị trí ô lưới lấy từ `channel-registry` (static, hot-reload), KHÔNG từ thứ tự mảng event/telemetry — bất biến ở mọi trạng thái (cold-load, cảnh báo, disconnected), không bao giờ sắp xếp lại/lọc/ẩn.
- `disconnected` (mất luồng dữ liệu giám sát toàn cục): banner đỏ full-width trên mọi layer + làm mờ toàn lưới; số liệu đứng yên, không nội suy; tự phục hồi khi kết nối lại, không cần reload.
- `machine-offline` (1 máy trung tâm không gửi heartbeat quá 3x chu kỳ 5s): trạng thái/badge riêng, KHÁC `critical`/`disconnected` toàn cục — phân biệt lỗi phần cứng/phần mềm tại trung tâm với mất tín hiệu SRT.
- `alert-badge` luôn kèm đồng thời nền màu VÀ chữ/icon (`OK`, `⚠ ABR`, `✕ MẤT TÍN HIỆU`) — không phụ thuộc màu đơn lẻ; dùng cặp màu `on-state-*` đã đo đạt AA (không dùng thẳng `state-ok` cho chữ).
- Không animation/transition gây xao nhãng khi đổi trạng thái trên lưới.
- Dashboard-backend/frontend chỉ accessible trong LAN/VPN nội bộ, không expose internet; không có tài khoản/self-service cho đài địa phương.
- Dashboard-backend chạy Windows Service với auto-restart (cùng cơ chế transport-core); mất kết nối backend kích hoạt `disconnected` tại mọi frontend đang mở.
- FR-13 (bàn phím) và FR-14 (không phụ thuộc màu, đo tương phản AA) được lược bớt khỏi pilot 1 kênh, hoàn thiện ở Epic 5 trước khi mở rộng 20 kênh — component xây ở epic này (badge, grid-cell) phải sẵn sàng tương thích nhưng không cần validate đầy đủ ngay.

## Technical Decisions

- Paradigm: hexagonal ports & adapters cho dashboard-backend (Node.js). Lõi nghiệp vụ thuần (debounce/threshold/cooldown/state) tách biệt khỏi adapter ingest (WebSocket/TCP) và adapter outbound; lõi PHẢI test độc lập được bằng fake `TelemetryInboundPort`/`AlertOutboundPort`, không cần máy thật.
- Ports liên quan: `TelemetryInboundPort`, `SnapshotPort`, `HeartbeatPort`, `AlertOutboundPort`, `HistoryPort`, `ChannelRegistryPort` (hot-reload), `AckCommandPort`.
- Giao tiếp LAN: mỗi máy trung tâm là client outbound kết nối WebSocket/TCP trực tiếp tới 1 endpoint duy nhất trên backend, kèm bearer-token riêng/máy; không dùng message broker; backend không gọi ngược vào transport-core ngoài event-contract.
- Envelope event chung bắt buộc cho mọi `event_type`: `schema_version` (int), `channel_id`, `timestamp` (ISO 8601 UTC), `event_type`, `payload`. `event_type` ∈ tập đóng {`telemetry`, `snapshot`, `alert`, `ack-command`, `heartbeat`, `handshake_reject`, `handshake_success`}; thêm giá trị mới phải tăng `schema_version`.
- Telemetry payload tối thiểu: `bitrate`, `rtt`, `connection_state` (giá trị đóng CONNECTING/CONNECTED/RECONNECTING/REJECTED — không rút gọn boolean), `audio_level: [L, R]` dBFS (field riêng, không qua debounce).
- Snapshot: JPEG độ phân giải thấp, `event_type=snapshot`, `payload.image_base64`, gửi định kỳ đồng bộ nhịp cold-load (~1-2s); KHÔNG gửi khi kênh mất tín hiệu (`critical`) — backend chỉ cache khung mới nhất/kênh, không xử lý ảnh.
- Heartbeat: `event_type=heartbeat`, mỗi 5s, độc lập `connection_state`; backend theo dõi "last heartbeat"/máy để suy ra `machine-offline`.
- `channel-registry`: file config tĩnh, nguồn liệt kê `channel_id` chính thức DUY NHẤT, ánh xạ `channel_id → {station_name, contact_name, contact_phone, grid_position}`; backend watch/reload không cần restart process.
- Naming: `channel_id` là business identifier cố định theo đài, immutable — không dùng index vị trí lưới hay thứ tự deploy làm định danh.
- Design tokens (dark-only, không light mode): màu (`surface-base`, `surface-raised`, `border`, `text-*`, `accent`=`state-ok`, `state-warning`, `state-critical`, `on-state-*`, `audio-normal`, `focus-ring`), typography system-ui stack (không tải font ngoài, `numeric` dùng monospace riêng), spacing bội số 4px + `cell-gap`/`panel-padding`, bo góc `sm/md/lg/pill` — định nghĩa và áp dụng đúng theo DESIGN.md, không tự đặt giá trị mới.

## UX & Interaction Patterns

- `channel-grid`: lưới cố định 5 cột × 4 hàng = 20 ô, nền `surface-base`, không có ô dự phòng; layout đơn-surface, luôn là màn hình gốc.
- `channel-grid-cell` 4 trạng thái thị giác `ok`/`warning`/`critical`/`acknowledged` (ack thuộc Epic 3 nhưng token đã định nghĩa ở đây): viền/nền theo đúng token; `critical` thay hoàn toàn thumbnail bằng color bars tĩnh (không chờ snapshot); `warning` giữ hình thật + icon cảnh báo chồng lên.
- `vu-meter`: 2 thanh/ô, gradient 3 mốc `audio-normal`→`state-warning`→`state-critical` theo `audio_level` thực tế; 2 vạch ngưỡng cố định (`warning-mark`, `peak-mark`) luôn hiển thị bất kể trạng thái/màu — chỉ báo phi-màu độc lập với trạng thái SRT, hoạt động cả khi kênh `critical`.
- `alert-badge`: label-caps, luôn kèm nền màu + chữ/icon; `ok` dùng nền pha loãng `state-ok` với chữ `on-state-ok` (không dùng thẳng `state-ok` — dưới AA).
- `connection-banner`: full-width, cố định đầu màn hình, trên mọi layer; nền `state-critical`, hiện thời điểm cập nhật lần cuối (HH:mm); kèm `grid-overlay` (color-mix mờ) phủ toàn `channel-grid` khi active.
- Elevation phẳng, phân lớp bằng tông màu (không shadow); không animation/transition trên lưới tổng quan.
- Microcopy: nhãn ngắn, số liệu trần trụi (`Bitrate: 62%`), không diễn giải cảm tính; badge dùng đúng `OK`/`⚠ ABR`/`✕ MẤT TÍN HIỆU`.

## Cross-Story Dependencies

- Story 2.1 (backend tính trạng thái) là nền tảng bắt buộc trước 2.4/2.5/2.6 — frontend chỉ render trạng thái đã tính sẵn, không tự suy luận lại.
- Story 2.2 (channel-registry) là input bắt buộc cho vị trí ô ở 2.3 (`grid_position`) và sẽ được Epic 3 (detail-panel) tái sử dụng cho tên đài/đầu mối liên hệ.
- Story 2.3 định nghĩa design tokens dùng chung cho 2.4, 2.5, 2.7 (màu, spacing, rounded).
- Story 2.6 (WebSocket event-driven) là kênh vận chuyển chung mà 2.7 dùng để phát hiện mất kết nối (`disconnected`) và nhận trạng thái `machine-offline`.
- Story 2.7 phụ thuộc dữ liệu heartbeat/connection_state đã được 2.1 tính toán và đường truyền WebSocket của 2.6.
- Epic 5 (bàn phím + accessibility AA đầy đủ) chủ đích lược bớt khỏi epic này theo AD-19, nhưng `alert-badge` (2.4) phải tuân thủ icon+chữ ngay từ đầu để không phải làm lại.
