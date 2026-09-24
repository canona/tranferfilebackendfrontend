---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-TranferFiles-2026-08-28/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-TranferFiles-2026-08-27/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-TranferFiles-2026-08-27/EXPERIENCE.md
---

# TranferFiles - Epic Breakdown

## Overview

Tài liệu này phân rã epic/story cho **Hệ thống truyền dẫn & giám sát tín hiệu SRT (VTCDigital)**: nền tảng truyền dẫn điểm-điểm SDI→SRT→SDI tự build (libsrt + orchestration C++) giữa 20 đài địa phương và trung tâm, cùng dashboard giám sát nội bộ (React + Node.js) cho đội trực sóng 24/7, dựa trên PRD, Architecture Spine và UX Design contract (DESIGN.md + EXPERIENCE.md).

## Requirements Inventory

### Functional Requirements

FR-1: Kết nối điểm-điểm qua SRT — hệ thống thiết lập và duy trì 1 kết nối SRT điểm-điểm độc lập cho mỗi kênh (libsrt tự build + orchestration riêng), reconnect vô hạn khi mất mạng, backoff/phân loại riêng khi bị từ chối do sai passphrase.

FR-2: ABR — chủ động hạ bitrate mã hoá khi băng thông mạng suy giảm để duy trì tín hiệu liên tục; phát event cho dashboard hiển thị `warning`.

FR-3: Color bars khi mất kết nối hoàn toàn — đầu ra SDI tại trung tâm tự động chuyển sang color bars, kích hoạt tức thời, độc lập với reconnect nền ở FR-1.

FR-4: Tích hợp capture/playout SDI qua card Blackmagic DeckLink Studio 4K ở cả 2 đầu (đài + trung tâm).

FR-5: Mã hoá dữ liệu truyền tải qua internet — AES built-in của SRT, passphrase riêng/kênh, từ chối handshake sai ngay lập tức, log + cảnh báo khi tần suất reject bất thường.

FR-6: Lưới tổng quan 20 kênh, vị trí cố định tuyệt đối theo đài — không sắp xếp lại/lọc/ẩn trong bất kỳ tình huống nào; mỗi ô gồm thumbnail/color-bars, 2 VU meter, tên đài, alert-badge.

FR-7: Cập nhật trạng thái kênh theo thời gian thực (event-driven, không polling), debounce ≥5 giây trước khi đổi trạng thái; cold-load hiện skeleton, VU meter cập nhật real-time không qua debounce.

FR-8: Panel chi tiết kênh — overlay khi click 1 ô: bitrate hiện tại, biểu đồ lịch sử, tên đài, đầu mối liên hệ; 3 trạng thái `loading`/`loaded`/`no-history-data`.

FR-9: Xử lý khi mất kết nối tới nguồn dữ liệu giám sát — `connection-banner` toàn cục + làm mờ lưới, số liệu đứng yên không nội suy, tự phục hồi khi kết nối lại.

FR-10: Phân loại cảnh báo 2 mức — "chú ý" (bitrate <70%, ABR) và "cảnh báo chủ động" (mất tín hiệu), mỗi mức có badge/màu/kênh thông báo riêng.

FR-11: Đẩy thông báo Telegram/Email với cooldown 60 giây/kênh/loại cảnh báo; thông báo phục hồi luôn gửi ngay; âm báo động tại chỗ chỉ kêu 1 lần/lần chuyển trạng thái.

FR-12: Xác nhận tiếp nhận cảnh báo (Ack) trong `detail-panel` — chỉ thêm `ack-label` + border dashed, không đổi màu/badge/xoá cảnh báo; tự xoá khi kênh phục hồi `ok` hoặc chuyển cảnh báo mới.

FR-13: Điều hướng đầy đủ bằng bàn phím — Tab qua 20 ô theo thứ tự lưới, Enter/Space mở panel, Esc đóng, nút ack trong thứ tự Tab, viền focus ≥3:1 (lược bớt khỏi pilot 1 kênh theo AD-19, hoàn thiện trước khi mở rộng 20 kênh).

FR-14: Không phụ thuộc màu đơn lẻ để truyền đạt trạng thái — alert-badge luôn kèm icon/chữ, vu-meter có 2 vạch ngưỡng cố định phi-màu, contrast đạt AA (lược bớt khỏi pilot 1 kênh theo AD-19, hoàn thiện trước khi mở rộng 20 kênh).

### NonFunctional Requirements

NFR-1: Độ trễ truyền dẫn end-to-end (encode+network+decode, không tính hiển thị dashboard) ≤ 1 giây trong điều kiện mạng nominal (ABR không active) — chỉ tiêu cứng, chưa benchmark trên RTT thực tế (bắt buộc benchmark 1-2 ngày đầu pilot). Khi ABR active, không áp dụng ngưỡng cứng này — ưu tiên continuity (SM-2/SM-C2).

NFR-2: Không tải font ngoài — dùng system-ui font stack, giảm phụ thuộc mạng/CDN cho app chạy cố định 24/7.

NFR-3: Không có animation/transition gây xao nhãng trên lưới tổng quan.

NFR-4: Tương phản màu đạt chuẩn AA trên toàn bộ token: text thường ≥4.5:1, đồ hoạ/border/focus-ring ≥3:1; riêng `on-state-critical` giữ 5.94:1 (đạt AA, không theo đuổi AAA có chủ đích để giữ độ bão hoà bắt mắt ngoại vi).

NFR-5: Mọi kết nối SRT bắt buộc bật AES-128/256, không tồn tại chế độ chạy không mã hoá trong production; không có kết nối một phần hay rơi về plaintext khi auth sai.

NFR-6: Mỗi kênh dùng passphrase riêng biệt, sinh ngẫu nhiên (không cho người dùng tự đặt), tối thiểu 128-bit entropy — không dùng chung 1 khoá cho 20 kênh.

NFR-7: Mọi lần handshake bị từ chối được ghi log structured kèm nguồn gốc kết nối; cảnh báo khi tần suất bất thường từ cùng một nguồn (đếm ngưỡng tại dashboard-backend, tách riêng theo `channel_id` biết trước và `source` lạ).

NFR-8: Dashboard-backend/frontend KHÔNG expose ra internet công cộng — chỉ accessible trong mạng LAN/VPN nội bộ VTCDigital; không có cơ chế tài khoản/self-service cho đài địa phương.

NFR-9: Dashboard-backend và transport-core chạy dưới dạng Windows Service với auto-restart (resilience tương đương nhau); mất kết nối dashboard-backend kích hoạt `disconnected` toàn cục tại mọi frontend đang mở.

### Additional Requirements

- **Không có starter/greenfield template** được chỉ định trong Architecture — 3 codebase (`transport-core`, `dashboard-backend`, `dashboard-frontend`) khởi tạo mới từ đầu theo cấu trúc thư mục trong Structural Seed (AD-20/21).
- Cách ly lỗi ở mức máy vật lý: 20 máy trung tâm riêng biệt, đối xứng 1:1 với 20 máy đài, mỗi máy trung tâm đúng 1 card DeckLink Studio 4K, không gộp nhiều kênh vào chung 1 máy (AD-2).
- OS = Windows 11/Windows Server cho toàn bộ 40 máy transport-core, dùng Blackmagic Desktop Video driver for Windows (AD-3).
- Ngôn ngữ transport-core = C++, gọi trực tiếp libsrt C API và Blackmagic SDK C++ API, không qua lớp FFI trung gian (AD-4).
- Codec ABR = H.264 (x264 software hoặc NVENC/QuickSync/AMF hardware tuỳ máy) — không dùng HEVC cho MVP#1 (AD-5).
- Passphrase sinh ngẫu nhiên, lưu qua Windows DPAPI scope `LocalMachine`; mỗi máy (đài lẫn trung tâm) chỉ giữ đúng 1 passphrase của kênh mình phụ trách (AD-7).
- Source abstraction (interface `Source`: `BlackmagicSource`/`FileMediaSource`) tách capture khỏi pipeline encode/ABR/SRT; `FileMediaSource` chỉ dùng cho test/dev (AD-8).
- State machine actor kênh: `CONNECTING→CONNECTED`; mất mạng→`RECONNECTING` (backoff 1s→2s→4s...trần 30s, vô hạn); sai passphrase→`REJECTED` (backoff riêng 5s→60s trần, tự throttle cục bộ) (AD-9).
- Ranh giới transport↔dashboard: transport-core chỉ phát telemetry thô (`bitrate`, `rtt`, `connection_state`, `audio_level`); dashboard-backend là single source of truth cho debounce/threshold/cooldown/mapping severity (AD-11).
- Dashboard-backend (Node.js) và dashboard-frontend (React) chạy trên 1 máy riêng, ngoài 40 máy transport (AD-12).
- Giao tiếp LAN trực tiếp WebSocket/TCP, không message broker, kèm bearer-token riêng/máy để backend từ chối kết nối giả mạo trên LAN (AD-13).
- Lịch sử bitrate = in-memory ring buffer ~10-15 phút/kênh; `HistoryPort` trả discriminated result `loading`/`loaded`/`no-history-data` — không dùng time-series DB cho MVP#1 (AD-14).
- Event-driven toàn bộ, không polling; VU meter tách khỏi debounce 5s của trạng thái cảnh báo (AD-15).
- Ack là command gửi lên backend qua WebSocket (`event_type=ack-command`, payload `operator_label`); backend sở hữu ack-state, tự xoá khi phục hồi/chuyển cảnh báo mới (AD-25).
- Vị trí ô lưới lấy từ `channel-registry` (static config, hot-reload), KHÔNG lấy từ thứ tự mảng event/telemetry (AD-24, AD-26).
- Thumbnail/preview: mỗi máy trung tâm định kỳ trích khung JPEG độ phân giải thấp, gửi qua LAN dưới `event_type=snapshot`, `payload.image_base64`; không gửi khi kênh `critical` (AD-22).
- VU meter (`audio_level: [L, R]` dBFS) là field telemetry riêng, cập nhật cùng tần suất bitrate/RTT, không qua debounce (AD-23).
- `channel-registry` là nguồn liệt kê `channel_id` chính thức duy nhất, ánh xạ `channel_id → {station_name, contact_name, contact_phone, grid_position}`, hot-reload không cần restart process (AD-24).
- Heartbeat riêng (`event_type=heartbeat`, mỗi 5s) để phát hiện máy trung tâm chết → trạng thái `machine-offline` riêng, khác `critical`/`disconnected` toàn cục (AD-29).
- Log/audit tối thiểu: structured JSON-lines local log cho handshake thành công + reject, chuyển state actor, heartbeat mất/khôi phục, ack-command (AD-30).
- Envelope event chung bắt buộc cho MỌI `event_type`: `schema_version`, `channel_id`, `timestamp` (ISO 8601 UTC), `event_type`, `payload`; `event_type` ∈ {`telemetry`, `snapshot`, `alert`, `ack-command`, `heartbeat`, `handshake_reject`, `handshake_success`} — tập đóng, thêm giá trị mới phải tăng `schema_version`.
- Rollout: giai đoạn thí điểm = pilot 1 kênh (1 đài + 1 máy trung tâm + 1 máy dashboard-backend), 7 ngày, benchmark RTT/latency bắt buộc 1-2 ngày đầu; mở rộng 20 kênh chỉ sau khi đạt tiêu chí ổn định + FR-13/FR-14 hoàn thiện + RACI passphrase đã chứng thực lặp lại (AD-19).
- Stack cụ thể phải dùng: libsrt (Haivision/srt) ≥1.5.6 (vá CVE-2026-55840/55841), Blackmagic Desktop Video SDK 16.0 (build-time)/driver 16.4 (deploy-time), Node.js 24.x, React 19.2.x, thư viện `ws` cho WebSocket.

### UX Design Requirements

UX-DR1: Định nghĩa và implement toàn bộ design token màu dark-only (`surface-base`, `surface-raised`, `border`, `text-primary`, `text-secondary`, `accent`/`state-ok`, `state-warning`, `state-critical`, `on-state-warning`, `on-state-critical`, `on-state-ok`, `audio-normal`, `focus-ring`) theo đúng giá trị hex trong DESIGN.md — không có light mode.

UX-DR2: Implement bộ token typography (`display`, `heading`, `channel-name`, `body`, `label-caps`, `caption`, `numeric`) dùng system-ui font stack (không tải font ngoài); `numeric` dùng monospace stack riêng cho số liệu bitrate để căn thẳng hàng.

UX-DR3: Implement thang spacing bội số 4px (`spacing.1`–`spacing.6`) + 2 token đặt tên riêng (`cell-gap`, `panel-padding`); implement thang bo góc (`rounded.sm/md/lg/pill`) áp đúng theo từng component.

UX-DR4: Component `channel-grid`: layout lưới cố định 5 cột × 4 hàng = 20 ô, vị trí theo đài immutable (đọc từ `channel-registry`), không có ô dự phòng, không kéo-thả/sắp xếp lại ở bất kỳ trạng thái nào (kể cả cảnh báo, cold-load, disconnected).

UX-DR5: Component `channel-grid-cell` với 4 trạng thái thị giác (`ok`/`warning`/`critical`/`acknowledged`) đúng token màu; `acknowledged` chỉ đổi border-style sang dashed, giữ nguyên nền/viền màu gốc của warning/critical.

UX-DR6: Component `vu-meter`: 2 thanh/ô, gradient 3 mốc (`audio-normal`→`state-warning`→`state-critical`) theo `audio_level` thực tế; 2 vạch ngưỡng cố định (`warning-mark`, `peak-mark`) luôn hiển thị bất kể trạng thái/màu hiện tại — chỉ báo phi-màu độc lập với trạng thái SRT.

UX-DR7: Component `alert-badge`: luôn kèm đồng thời nền màu VÀ chữ/icon (`OK`, `⚠ ABR`, `✕ MẤT TÍN HIỆU`), dùng đúng cặp màu `on-state-*` đã đo tương phản AA (không dùng thẳng `state-ok` cho chữ — tương phản dưới AA).

UX-DR8: Component `ack-label`: dạng viên thuốc viền đứt nét, nội dung `✓ Đã nhận: {tên viết tắt}`, xuất hiện thêm vào (không thay thế `alert-badge`), tự biến mất khi kênh phục hồi `ok` hoặc chuyển sang cảnh báo mới.

UX-DR9: Component `detail-panel`: overlay non-blocking (không chặn thao tác lưới phía sau), 3 trạng thái `loading`/`loaded`/`no-history-data`; đóng bằng click ra ngoài hoặc `Esc`; chứa bitrate hiện tại (numeric), biểu đồ đường lịch sử bitrate, tên đài, tên+SĐT đầu mối liên hệ, nút "Xác nhận đã tiếp nhận".

UX-DR10: Component `connection-banner`: full-width, cố định đầu màn hình, trên mọi layer kể cả `detail-panel`; kèm `grid-overlay` (color-mix mờ) phủ lên toàn bộ `channel-grid` khi active; hiện thời điểm cập nhật lần cuối (HH:mm).

UX-DR11: Chuẩn hoá microcopy/voice-tone đúng bảng Do/Don't trong EXPERIENCE.md (nhãn badge, nút ack "Xác nhận đã tiếp nhận", số liệu trần trụi "Bitrate: 62%") — không dùng câu cảm tính/diễn giải mơ hồ.

UX-DR12: Accessibility keyboard: `Tab` di chuyển focus qua 20 ô theo đúng thứ tự vị trí lưới (trái→phải, trên→dưới); `Enter`/`Space` mở `detail-panel` ô đang focus; `Esc` đóng panel; nút ack nằm trong thứ tự Tab, kích hoạt bằng `Enter`/`Space`; viền focus dùng token `focus-ring`.

UX-DR13: `[ASSUMPTION]` Kích thước chữ/icon hiện tại (đặc biệt `channel-name`, `alert-badge`, `numeric`) là điểm khởi đầu scale từ mock xem trên trình duyệt — cần đo đạc và validate trên màn hình TV wall thật theo khoảng cách xem thực tế của phòng trực trước khi chốt kích thước cuối cùng.

### Additional Requirements (Story 1.1 config surface)

- File cấu hình JSON/YAML per-kênh (chỉnh tay, không có UI/CLI riêng cho MVP#1) chứa: `remote_ip` (IP nhận), `port`, `bitrate` (gốc), `latency_ms` (độ trễ buffer SRT/ARQ, khuyến nghị ≥3x RTT theo `addendum.md` §3), `aes_key_length` (128 hoặc 256), `passphrase` (field placeholder — sinh/mã hoá theo Story 1.5), `test_source_path` (đường dẫn file mp4 cho `FileMediaSource` khi chưa có card Blackmagic).
- Toàn bộ file cấu hình (bao gồm field `passphrase`) được mã hoá tại chỗ qua Windows DPAPI scope `LocalMachine` (thực hiện đầy đủ ở Story 1.5) — không tách 2 file riêng cho phần bí mật/không bí mật.

### FR Coverage Map

FR-1: Epic 1 - Kết nối SRT điểm-điểm
FR-2: Epic 1 - ABR hạ bitrate
FR-3: Epic 1 - Color bars
FR-4: Epic 1 - Capture/playout Blackmagic
FR-5: Epic 1 - Mã hoá AES
FR-6: Epic 2 - Lưới tổng quan
FR-7: Epic 2 - Cập nhật event-driven
FR-9: Epic 2 - Xử lý `disconnected`
FR-10: Epic 2 - Phân loại cảnh báo 2 mức
FR-8: Epic 3 - Panel chi tiết
FR-12: Epic 3 - Ack
FR-11: Epic 4 - Telegram/Email + âm báo
FR-13: Epic 5 - Bàn phím
FR-14: Epic 5 - Không phụ thuộc màu

## Epic List

### Epic 1: Truyền dẫn tín hiệu điểm-điểm ổn định qua SRT
Đài địa phương và trung tâm có đường truyền tín hiệu SDI→SRT→SDI tự chủ, tự phục hồi khi mạng yếu (ABR) hoặc mất kết nối (reconnect vô hạn + color bars), mã hoá AES đầu-cuối — tự thân đã tạo giá trị nghiệp vụ (thay thế đơn vị thuê ngoài) kể cả trước khi có dashboard.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5

### Epic 2: Giám sát trạng thái kênh thời gian thực & phân loại cảnh báo trên lưới
Đội trực nhìn lưới 20 ô cố định vị trí, thấy ngay trạng thái ok/warning/critical theo thời gian thực (event-driven, debounce 5s), xử lý đúng khi mất kết nối dữ liệu giám sát (`disconnected`).
**FRs covered:** FR-6, FR-7, FR-9, FR-10

### Epic 3: Panel chi tiết kênh & xác nhận tiếp nhận cảnh báo (Ack)
Đội trực click vào 1 kênh để xem bitrate/lịch sử/đầu mối liên hệ, và xác nhận đã tiếp nhận để tránh gọi trùng.
**FRs covered:** FR-8, FR-12

### Epic 4: Cảnh báo tự động qua âm thanh & Telegram/Email
Đội trực và lãnh đạo nhận cảnh báo kịp thời dù không nhìn màn hình, với debounce/cooldown chống spam và thông báo phục hồi tức thời — hiện thực hoá trực tiếp SM-1 (phát hiện ≤1 phút).
**FRs covered:** FR-11

### Epic 5: Điều hướng bàn phím & khả năng tiếp cận đầy đủ
Toàn bộ thao tác dùng được bằng bàn phím, mọi trạng thái đều có tín hiệu phi-màu — hoàn thiện trước khi mở rộng từ pilot 1 kênh lên 20 kênh (AD-19).
**FRs covered:** FR-13, FR-14

## Epic 1: Truyền dẫn tín hiệu điểm-điểm ổn định qua SRT

Đài địa phương và trung tâm có đường truyền tín hiệu SDI→SRT→SDI tự chủ, tự phục hồi khi mạng yếu (ABR) hoặc mất kết nối (reconnect vô hạn + color bars), mã hoá AES đầu-cuối — tự thân đã tạo giá trị nghiệp vụ kể cả trước khi có dashboard. Realizes FR-1, FR-2, FR-3, FR-4, FR-5.

### Story 1.1: Khởi tạo transport-core, cấu hình kết nối & kết nối SRT điểm-điểm cơ bản

As a đội kỹ thuật vận hành VTCDigital,
I want mỗi kênh có 1 file cấu hình riêng (IP nhận, port, bitrate gốc, độ trễ buffer, độ dài khoá AES, passphrase, đường dẫn nguồn test) và thiết lập được kết nối SRT điểm-điểm dựa trên libsrt (≥1.5.6) với lớp orchestration C++ tự build,
So that tín hiệu được truyền point-to-point theo đúng tham số cấu hình, không phụ thuộc appliance/SDK thương mại, không chia sẻ state giữa các kênh, và test được thông luồng ngay cả khi chưa có card Blackmagic.

**Acceptance Criteria:**

**Given** transport-core mới khởi tạo trên 1 cặp máy đài+trung tâm (Windows),
**When** đọc file cấu hình JSON/YAML của kênh đó,
**Then** file cấu hình chứa đủ: `remote_ip`, `port`, `bitrate` (gốc), `latency_ms` (độ trễ buffer), `aes_key_length` (128 hoặc 256), `passphrase`, `test_source_path` (đường dẫn file mp4 cho `FileMediaSource`).
**And** Kết nối SRT thiết lập thành công qua libsrt ≥1.5.6, gọi trực tiếp libsrt C API (không qua FFI trung gian), dùng đúng `aes_key_length` và `latency_ms` đã cấu hình; AES bật mặc định, không có chế độ không mã hoá.
**And** Mỗi kênh chạy 1 actor độc lập, không state/biến toàn cục dùng chung kênh khác (crash actor A không ảnh hưởng actor B).
**And** `Source` interface (`BlackmagicSource`/`FileMediaSource`) được định nghĩa; khi chưa có card Blackmagic, cấu hình `test_source_path` trỏ tới 1 file mp4 để `FileMediaSource` phát lặp làm nguồn vào, test thông luồng end-to-end (encode→SRT→decode) mà không cần phần cứng thật.

### Story 1.2: State machine reconnect vô hạn khi mất mạng

As a đội kỹ thuật vận hành VTCDigital,
I want kết nối SRT tự động thử lại vô hạn khi bị ngắt do mất mạng, backoff tăng dần,
So that kênh không bao giờ "give up" và tự phục hồi khi mạng có lại.

**Acceptance Criteria:**

**Given** kết nối đang `CONNECTED`,
**When** kết nối bị ngắt do mất mạng,
**Then** actor chuyển state `RECONNECTING`, backoff tăng dần 1s→2s→4s...trần 30s, tiếp tục thử lại vô hạn (không giới hạn số lần).
**And** Event `connection_state=RECONNECTING` phát ngay khi chuyển state, không chờ hết một số lần thử nhất định.
**And** Khi mạng phục hồi, kết nối tự động về `CONNECTED` mà không cần restart thủ công.
**And** Bộ đếm backoff của nhánh `RECONNECTING` dùng biến đếm/state riêng của actor, không dùng chung với bất kỳ nhánh state/backoff nào khác của cùng actor.

### Story 1.3: Color bars tự động khi mất kết nối hoàn toàn

As a đội kỹ thuật vận hành VTCDigital,
I want đầu ra SDI tại trung tâm tự động chuyển sang color bars ngay khi kết nối SRT mất hoàn toàn,
So that đầu ra không bao giờ đứng hình/màn đen — đảm bảo an toàn phát sóng.

**Acceptance Criteria:**

**Given** kênh đang `CONNECTED` và phát tín hiệu thật ra SDI,
**When** kết nối SRT chuyển sang `RECONNECTING`,
**Then** đầu ra SDI tại trung tâm chuyển ngay sang color bars — kích hoạt tức thời, không chờ hết số lần reconnect (vì retry vô hạn).
**And** Khi kết nối phục hồi `CONNECTED` và tín hiệu thật ổn định, đầu ra SDI tự động chuyển lại tín hiệu thật, không cần thao tác thủ công.

### Story 1.4: Nhánh reject riêng khi sai passphrase + log audit

As a đội kỹ thuật vận hành VTCDigital,
I want kết nối bị từ chối do sai passphrase được xử lý bằng nhánh backoff riêng (khác mất mạng) và được log đầy đủ,
So that phân biệt được lỗi cấu hình/nghi dò passphrase với sự cố mất mạng thông thường, không bị retry dồn dập.

**Acceptance Criteria:**

**Given** trung tâm nhận 1 yêu cầu kết nối SRT với passphrase sai,
**When** handshake thất bại do auth,
**Then** kết nối bị từ chối ngay tại bước handshake — không tạo kết nối một phần, không rơi về chế độ không mã hoá.
**And** Actor chuyển sang state riêng `REJECTED` (không phải `RECONNECTING`), backoff riêng 5s→60s trần, tự throttle cục bộ tại actor.
**And** Sự kiện `handshake_reject` được phát ra (theo envelope chung: `schema_version`, `channel_id`, `timestamp`, `event_type`, `payload`) mỗi lần bị reject.
**And** Log structured (JSON lines) cục bộ ghi lại: timestamp, channel_id, event_type, source, reason.
**And** Log cũng ghi lại các handshake THÀNH CÔNG (`event_type=handshake_success`) — không chỉ log lỗi.

### Story 1.5: Sinh & lưu trữ passphrase an toàn qua DPAPI

As a đội kỹ thuật vận hành VTCDigital,
I want passphrase trong file cấu hình (Story 1.1) được sinh ngẫu nhiên riêng/kênh và toàn bộ file được mã hoá qua Windows DPAPI,
So that dữ liệu không đọc được nếu bị chặn bắt, và 1 máy bị compromise chỉ lộ đúng 1 khoá.

**Acceptance Criteria:**

**Given** cấu hình 1 kênh mới,
**When** passphrase được sinh,
**Then** passphrase sinh ngẫu nhiên (không cho người dùng tự đặt), tối thiểu 128-bit entropy, riêng biệt cho kênh đó — không dùng chung khoá với kênh khác.
**And** Toàn bộ file cấu hình (bao gồm field `passphrase`) được mã hoá tại chỗ qua Windows DPAPI scope `LocalMachine`; mỗi máy (đài lẫn trung tâm) chỉ giữ ĐÚNG 1 file cấu hình của kênh mình phụ trách.
**And** Không có cấu hình nào cho phép tắt AES-128/256 trong production — xác nhận bằng kiểm tra không thể set `aes_key_length=0`/rỗng.

### Story 1.6: Capture/playout SDI qua Blackmagic DeckLink Studio 4K

As a đội kỹ thuật vận hành VTCDigital,
I want transport-core capture tín hiệu SDI đầu vào tại đài và xuất SDI đầu ra tại trung tâm bằng card Blackmagic DeckLink Studio 4K,
So that tín hiệu truyền hình thật được đưa vào/ra pipeline SRT mà không cần chuyển đổi thủ công.

**Acceptance Criteria:**

**Given** máy đài có lắp card Blackmagic DeckLink Studio 4K và Blackmagic Desktop Video driver for Windows đã cài,
**When** transport-core khởi động với `Source` = `BlackmagicSource`,
**Then** `BlackmagicSource` capture đúng tín hiệu SDI đầu vào qua Blackmagic SDK 16.0 (build-time)/driver 16.4 tương thích (deploy-time).
**And** Tại trung tâm, đầu ra SDI được xuất qua đúng 1 card DeckLink Studio 4K/máy — không gộp nhiều kênh vào chung 1 máy vật lý.
**And** transport-core chạy dưới dạng Windows Service với auto-restart (không dùng systemd) ở cả 2 đầu.

### Story 1.7: ABR chủ động hạ bitrate H.264 khi mạng xấu

As a đội kỹ thuật vận hành VTCDigital,
I want hệ thống tự động hạ bitrate mã hoá H.264 khi băng thông mạng suy giảm,
So that tín hiệu tiếp tục phát được thay vì mất hoàn toàn khi mạng yếu.

**Acceptance Criteria:**

**Given** kênh đang truyền ở bitrate gốc đã cấu hình,
**When** bitrate thực tế đo được giảm xuống dưới ngưỡng gốc do mạng suy giảm,
**Then** pipeline encode tự động hạ bitrate mã hoá H.264 (x264 software hoặc NVENC/QuickSync/AMF hardware tuỳ máy) tương ứng trong thời gian thực — không dùng HEVC.
**And** Sự kiện telemetry `bitrate` mới được phát ra ngay để dashboard đọc.
**And** Khi ABR đang active, hệ thống không áp đặt ngưỡng độ trễ ≤1s như gate cứng (NFR-1) — ưu tiên duy trì phát sóng liên tục.

### Story 1.8: Telemetry thô + VU meter + snapshot + heartbeat qua LAN có xác thực

As a đội kỹ thuật vận hành VTCDigital,
I want transport-core phát telemetry thô (bitrate, rtt, connection_state, audio_level) + snapshot ảnh + heartbeat qua kết nối LAN có bearer-token, không qua message broker,
So that dashboard-backend có đủ dữ liệu thô để tự tính toán trạng thái hiển thị, mà kết nối LAN không bị giả mạo.

**Acceptance Criteria:**

**Given** máy trung tâm đã kết nối LAN nội bộ tới dashboard-backend,
**When** transport-core phát telemetry định kỳ,
**Then** mỗi máy trung tâm là client outbound kết nối WebSocket/TCP trực tiếp tới 1 endpoint duy nhất trên dashboard-backend, kèm bearer-token riêng/máy; backend từ chối kết nối sai token.
**And** Payload telemetry tối thiểu gồm `bitrate`, `rtt`, `connection_state` (giá trị đóng CONNECTING/CONNECTED/RECONNECTING/REJECTED — không rút gọn boolean), `audio_level: [L, R]` (dBFS) — cập nhật cùng tần suất, KHÔNG qua debounce.
**And** Snapshot JPEG độ phân giải thấp (`event_type=snapshot`, `payload.image_base64`) được gửi định kỳ đồng bộ nhịp cold-load ~1-2s; KHÔNG gửi khi kênh mất tín hiệu.
**And** Heartbeat (`event_type=heartbeat`) được gửi mỗi 5s, độc lập với `connection_state` của kênh, để dashboard-backend phát hiện máy trung tâm "chết".
**And** Toàn bộ event tuân envelope chung: `schema_version`, `channel_id`, `timestamp` (ISO 8601 UTC), `event_type`, `payload`.

## Epic 2: Giám sát trạng thái kênh thời gian thực & phân loại cảnh báo trên lưới

Đội trực nhìn lưới 20 ô cố định vị trí, thấy ngay trạng thái ok/warning/critical theo thời gian thực (event-driven, debounce 5s), xử lý đúng khi mất kết nối dữ liệu giám sát (`disconnected`). Realizes FR-6, FR-7, FR-9, FR-10.

### Story 2.1: Dashboard-backend — ranh giới telemetry thô → trạng thái tính toán

As a đội trực sóng VTCDigital,
I want dashboard-backend nhận telemetry thô từ 20 máy trung tâm và tự tính trạng thái hiển thị (ok/warning/critical) theo ngưỡng 70%/debounce 5s tại một nơi duy nhất,
So that logic ngưỡng nhất quán giữa mọi kênh, không lệch nhau giữa các điểm triển khai.

**Acceptance Criteria:**

**Given** dashboard-backend (Node.js, hexagonal) đã nhận kết nối WebSocket/TCP từ máy trung tâm qua LAN,
**When** nhận telemetry (`bitrate`, `rtt`, `connection_state`, `audio_level`),
**Then** domain core (tách biệt khỏi adapter) tính debounce ≥5s trước khi đổi trạng thái hiển thị của kênh.
**And** Mapping: `CONNECTED`+bitrate≥70% → `ok`; `CONNECTED`+bitrate<70% → `warning`; `RECONNECTING` → `critical`; `REJECTED` → `critical` kèm sub-type "nghi vấn cấu hình/bảo mật".
**And** Domain core test được độc lập bằng fake `TelemetryInboundPort`/`AlertOutboundPort`, không cần 20+20 máy thật hay kết nối SRT thật.
**And** Dashboard-backend chạy dưới Windows Service với auto-restart, trên 1 máy riêng ngoài 40 máy transport-core; không expose ra internet công cộng — chỉ LAN/VPN nội bộ.

### Story 2.2: Channel-registry hot-reload — nguồn liệt kê kênh & vị trí lưới chính thức

As a đội trực sóng VTCDigital,
I want dashboard-backend nạp channel-registry ánh xạ `channel_id → {station_name, contact_name, contact_phone, grid_position}` và tự reload khi file thay đổi,
So that thêm/sửa 1 kênh không làm gián đoạn các kênh khác đang giám sát.

**Acceptance Criteria:**

**Given** file `channel-registry` tồn tại với ít nhất 1 kênh,
**When** dashboard-backend khởi động,
**Then** nạp đúng ánh xạ `channel_id → {station_name, contact_name, contact_phone, grid_position}`; file này là nguồn liệt kê `channel_id` hợp lệ DUY NHẤT của hệ thống.
**And** Khi file thay đổi (thêm/sửa 1 kênh), dashboard-backend áp dụng ngay không cần restart process, không gián đoạn các kênh đang chạy.

### Story 2.3: Design tokens & lưới tổng quan cố định vị trí (cold-load)

As a đội trực sóng VTCDigital,
I want mở app thấy lưới 20 ô cố định vị trí theo đài (5 cột × 4 hàng), skeleton khi vừa mở app,
So that tôi luôn định vị đúng kênh theo trí nhớ vị trí quen thuộc, không phải chờ đủ 20 kênh mới thấy gì.

**Acceptance Criteria:**

**Given** dashboard-frontend (React) kết nối WebSocket tới dashboard-backend,
**When** app vừa mở (`cold-load`),
**Then** toàn bộ 20 ô hiện skeleton/placeholder; từng ô chuyển sang dữ liệu thật ngay khi kênh đó có event về, không chờ đủ 20 kênh (~1-2 giây).
**And** Vị trí ô lấy từ `grid_position` trong channel-registry (Story 2.2), KHÔNG lấy từ thứ tự mảng event/telemetry trả về; không có thao tác kéo-thả/sắp xếp lại ở bất kỳ trạng thái nào.
**And** Toàn bộ design token màu (dark-only), typography (system-ui, không tải font ngoài), spacing (bội số 4px + `cell-gap`), rounded (`sm/md/lg/pill`) được định nghĩa và áp dụng đúng theo DESIGN.md.

### Story 2.4: Trạng thái ô kênh (ok/warning/critical) & alert-badge

As a đội trực sóng VTCDigital,
I want mỗi ô kênh đổi màu viền/nền và hiện alert-badge (`OK`/`⚠ ABR`/`✕ MẤT TÍN HIỆU`) đúng trạng thái tính toán từ backend,
So that tôi phân biệt ngay mức độ nghiêm trọng của từng kênh chỉ bằng một cái liếc mắt.

**Acceptance Criteria:**

**Given** dashboard-backend đã phát trạng thái tính toán của 1 kênh (Story 2.1),
**When** frontend nhận trạng thái `ok`/`warning`/`critical`,
**Then** ô kênh đổi viền/nền đúng token màu tương ứng (`border`/`state-warning`/`state-critical`), không sắp xếp lại vị trí.
**And** `alert-badge` luôn hiển thị đồng thời nền màu VÀ chữ/icon (`OK`, `⚠ ABR`, `✕ MẤT TÍN HIỆU`) — không bao giờ chỉ là khối màu trơn; dùng đúng cặp màu chữ `on-state-*` đã đo tương phản AA.
**And** Không có animation/transition gây xao nhãng khi đổi trạng thái.

### Story 2.5: VU meter & thumbnail/color-bars theo trạng thái

As a đội trực sóng VTCDigital,
I want mỗi ô kênh hiện 2 VU meter thời gian thực và thumbnail/color-bars đúng theo trạng thái,
So that tôi thấy được mức âm thanh thực tế và hình ảnh kênh mà không phải mở panel chi tiết.

**Acceptance Criteria:**

**Given** kênh đang gửi `audio_level: [L, R]` và snapshot (nếu có),
**When** frontend nhận dữ liệu,
**Then** `vu-meter` cập nhật thời gian thực theo `audio_level`, KHÔNG qua debounce 5s của trạng thái cảnh báo — kênh `critical` vẫn có thể hiện VU thấp/im lặng.
**And** 2 vạch ngưỡng cố định (`warning-mark`, `peak-mark`) luôn hiển thị trên thanh đo bất kể trạng thái/màu hiện tại.
**And** Thumbnail: `ok`/`warning` giữ hình thật từ snapshot (`warning` kèm icon cảnh báo chồng lên); `critical` thay hoàn toàn bằng color bars tĩnh (không chờ snapshot vì transport-core không gửi khi mất tín hiệu).

### Story 2.6: Cập nhật trạng thái kênh event-driven qua WebSocket

As a đội trực sóng VTCDigital,
I want trạng thái từng ô cập nhật ngay qua event stream (không polling) khi backend đẩy dữ liệu mới,
So that tôi thấy sự cố gần như tức thời mà hệ thống không phải liên tục hỏi lại backend.

**Acceptance Criteria:**

**Given** dashboard-backend đã tính xong trạng thái mới của 1 kênh (đã qua debounce ≥5s ở Story 2.1),
**When** backend đẩy state qua WebSocket,
**Then** frontend cập nhật store và re-render đúng ô kênh đó ngay, không polling định kỳ.
**And** Frontend chỉ render thuần trạng thái đã tính sẵn từ backend, không tự suy luận lại ok/warning/critical.

### Story 2.7: Xử lý mất kết nối dữ liệu giám sát (`disconnected`) & máy trung tâm chết (`machine-offline`)

As a đội trực sóng VTCDigital,
I want thấy banner cảnh báo toàn cục khi mất kết nối tới nguồn dữ liệu giám sát, và phân biệt được khi 1 máy trung tâm cụ thể bị lỗi phần cứng/phần mềm,
So that tôi không bao giờ nhầm dữ liệu cũ là đang live, và biết đúng nguyên nhân sự cố để xử lý đúng hướng.

**Acceptance Criteria:**

**Given** dashboard-frontend đang kết nối WebSocket tới dashboard-backend,
**When** kết nối tới dashboard-backend mất (event stream chết),
**Then** `connection-banner` hiện toàn chiều rộng đầu màn hình (nền đỏ, trên mọi layer) kèm thời điểm cập nhật lần cuối, đồng thời `grid-overlay` làm mờ toàn bộ lưới; số liệu từng ô đứng yên, không tự nội suy.
**And** Khi phục hồi, banner biến mất ngay, lưới rõ nét trở lại, dữ liệu resume từ event tiếp theo — không cần reload thủ công.
**And** Riêng biệt: khi dashboard-backend không nhận heartbeat từ 1 máy trung tâm quá timeout (3x chu kỳ 5s), kênh đó hiển thị badge/sub-type riêng `machine-offline` — khác `critical`/`disconnected` toàn cục, để đội trực biết đây là lỗi phần cứng/phần mềm tại trung tâm chứ không phải mất tín hiệu SRT.

## Epic 3: Panel chi tiết kênh & xác nhận tiếp nhận cảnh báo (Ack)

Đội trực click vào 1 kênh để xem bitrate/lịch sử/đầu mối liên hệ, và xác nhận đã tiếp nhận để tránh gọi trùng. Realizes FR-8, FR-12.

### Story 3.1: Ring buffer lịch sử bitrate & HistoryPort tri-state

As a đội trực sóng VTCDigital,
I want dashboard-backend giữ ring buffer lịch sử bitrate ~10-15 phút/kênh và phân biệt rõ "đang tải"/"đã có dữ liệu"/"chưa đủ dữ liệu",
So that panel chi tiết không hiểu nhầm kênh mới là đang gặp sự cố.

**Acceptance Criteria:**

**Given** kênh đang gửi telemetry bitrate liên tục,
**When** dashboard-backend nhận,
**Then** giữ ring buffer in-memory ~10-15 phút gần nhất/kênh (không dùng time-series DB).
**And** `HistoryPort` trả về discriminated result: state ∈ {`loading`, `loaded`, `no-history-data`} + data — KHÔNG biểu diễn `no-history-data` bằng mảng rỗng/giá trị 0.
**And** Kênh mới/chưa đủ dữ liệu → `no-history-data`; đủ dữ liệu → `loaded` kèm mảng bitrate theo thời gian.

### Story 3.2: Panel chi tiết kênh (detail-panel)

As a đội trực sóng VTCDigital,
I want click vào ô kênh mở panel hiện bitrate hiện tại, biểu đồ lịch sử, tên đài, đầu mối liên hệ,
So that tôi có đủ thông tin hành động ngay mà không phải tra cứu nơi khác.

**Acceptance Criteria:**

**Given** tôi click vào 1 `channel-grid-cell` bất kỳ,
**When** `detail-panel` mở,
**Then** panel mở tức thì (overlay, không điều hướng trang), không chặn thao tác trên lưới phía sau; đóng bằng click ra ngoài hoặc phím `Esc`.
**And** Trạng thái `loading`: skeleton/placeholder cho vùng số liệu và biểu đồ, không bao giờ hiện trắng/trống.
**And** Trạng thái `loaded`: hiện bitrate hiện tại (`numeric`), biểu đồ đường lịch sử bitrate, tên đài, tên+SĐT đầu mối liên hệ (từ channel-registry, Story 2.2).
**And** Trạng thái `no-history-data`: vẫn hiện bitrate hiện tại; vùng biểu đồ hiện thông báo thiếu dữ liệu thay vì biểu đồ rỗng (tránh hiểu nhầm bitrate=0 là sự cố).

### Story 3.3: Xác nhận tiếp nhận cảnh báo (Ack)

As a đội trực sóng VTCDigital,
I want bấm "Xác nhận đã tiếp nhận" trong `detail-panel` để đánh dấu đã nhận cảnh báo,
So that tránh nhiều người gọi trùng đầu mối liên hệ của cùng 1 sự cố.

**Acceptance Criteria:**

**Given** `detail-panel` của 1 kênh đang `warning`/`critical` đang mở,
**When** tôi bấm "Xác nhận đã tiếp nhận",
**Then** frontend gửi `ack-command` (envelope chung, `event_type=ack-command`, `payload.operator_label`) qua WebSocket tới backend.
**And** Backend lưu `acknowledged`+`ack_label` như 1 phần channel state; ô kênh trên lưới đổi border-style sang dashed, thêm `ack-label` "✓ Đã nhận: {tên viết tắt}" — KHÔNG đổi màu nền/viền gốc, KHÔNG đổi badge, KHÔNG xoá cảnh báo.
**And** Nút ack chỉ nằm trong `detail-panel`, không có ack nhanh trên lưới.
**And** `ack-label` tự biến mất khi kênh phục hồi về `ok`, hoặc khi chuyển sang trạng thái cảnh báo mới (vd `warning`→`critical`) — không phải khi thực hiện ack.

## Epic 4: Cảnh báo tự động qua âm thanh & Telegram/Email

Đội trực và lãnh đạo nhận cảnh báo kịp thời dù không nhìn màn hình, với debounce/cooldown chống spam và thông báo phục hồi tức thời — hiện thực hoá trực tiếp SM-1. Realizes FR-11.

### Story 4.1: Âm báo động tại chỗ khi có cảnh báo mới

As a đội trực sóng VTCDigital,
I want nghe âm báo động ngay khi có cảnh báo mới xuất hiện (sau debounce),
So that tôi phát hiện sự cố ngay cả khi không đang nhìn trực tiếp màn hình.

**Acceptance Criteria:**

**Given** 1 kênh vừa chuyển sang `warning` hoặc `critical` (sau debounce ≥5s),
**When** cảnh báo mới kích hoạt,
**Then** dashboard phát âm báo động 1 lần duy nhất cho lần chuyển trạng thái đó — không lặp lại theo cooldown như Telegram/Email.
**And** Không có cơ chế tắt âm báo vĩnh viễn từ giao diện chính.

### Story 4.2: Đẩy Telegram cho mức "chú ý" (ABR/warning) tới đội trực

As a đội trực sóng VTCDigital,
I want nhận Telegram khi 1 kênh chuyển sang `warning` (ABR hạ bitrate),
So that tôi biết ngay cả khi không nhìn màn hình TV wall.

**Acceptance Criteria:**

**Given** kênh chuyển sang `warning` sau debounce,
**When** cảnh báo mới kích hoạt,
**Then** Telegram được gửi tới đội trực sóng (không gửi lãnh đạo VTCDigital).
**And** Cooldown tối thiểu 60 giây giữa 2 lần gửi lại cùng loại cảnh báo, cùng kênh (không nhận quá 1 lần/60s).

### Story 4.3: Đẩy Telegram + Email cho mức "cảnh báo chủ động" (critical) tới đội trực & lãnh đạo

As a đội trực sóng VTCDigital và lãnh đạo VTCDigital,
I want nhận Telegram + Email khi 1 kênh mất tín hiệu hoàn toàn,
So that cả đội trực và lãnh đạo đều biết ngay để phối hợp xử lý.

**Acceptance Criteria:**

**Given** kênh chuyển sang `critical` sau debounce,
**When** cảnh báo mới kích hoạt,
**Then** Telegram + Email gửi tới CẢ đội trực sóng và lãnh đạo VTCDigital.
**And** Cooldown tối thiểu 60 giây/kênh/loại cảnh báo áp dụng độc lập với cooldown của mức `warning` (cặp channel_id+alert_type riêng).

### Story 4.4: Thông báo phục hồi gửi ngay lập tức, bỏ qua cooldown

As a đội trực sóng VTCDigital,
I want nhận thông báo phục hồi (trở lại `ok`) ngay lập tức không bị trì hoãn bởi cooldown đang chạy,
So that tôi biết ngay khi sự cố đã tự hết mà không cần gọi lại hỏi đài.

**Acceptance Criteria:**

**Given** kênh đang `warning` hoặc `critical`, đang trong cửa sổ cooldown,
**When** kênh phục hồi về `ok` (sau debounce ≥5s ổn định),
**Then** thông báo phục hồi gửi ngay lập tức qua Telegram (và Email nếu trước đó là mức `critical`), không bị chặn bởi cooldown đang chạy của cảnh báo trước đó.
**And** `ack-label` tương ứng (nếu có) tự biến mất theo cơ chế đã build ở Story 3.3.

## Epic 5: Điều hướng bàn phím & khả năng tiếp cận đầy đủ

Toàn bộ thao tác dùng được bằng bàn phím, mọi trạng thái đều có tín hiệu phi-màu — hoàn thiện trước khi mở rộng từ pilot 1 kênh lên 20 kênh (AD-19). Realizes FR-13, FR-14.

### Story 5.1: Điều hướng đầy đủ bằng bàn phím

As a đội trực sóng VTCDigital,
I want di chuyển giữa 20 ô, mở/đóng panel, và ack đều thực hiện được bằng bàn phím,
So that tôi thao tác được ngay cả khi không dùng chuột thuận tiện.

**Acceptance Criteria:**

**Given** tôi đang ở lưới tổng quan,
**When** tôi nhấn `Tab`,
**Then** focus di chuyển qua 20 `channel-grid-cell` theo đúng thứ tự vị trí lưới (trái→phải, trên→dưới).
**And** `Enter`/`Space` mở `detail-panel` của ô đang focus; `Esc` đóng panel.
**And** Nút "Xác nhận đã tiếp nhận" nằm trong thứ tự Tab của panel, kích hoạt được bằng `Enter`/`Space`.
**And** Viền focus rõ ràng dùng token `focus-ring`, đạt tương phản ≥3:1 so với nền xung quanh.

### Story 5.2: Xác thực & hoàn thiện accessibility không phụ thuộc màu đơn lẻ (AA)

As a đội trực sóng VTCDigital,
I want mọi trạng thái/cảnh báo trên dashboard được xác thực đạt chuẩn AA và không chỉ dựa vào màu sắc,
So that người khiếm thị màu hoặc ánh sáng phòng biến động vẫn đọc đúng trạng thái, trước khi mở rộng lên 20 kênh.

**Acceptance Criteria:**

**Given** toàn bộ component đã build ở Epic 2/3 (`alert-badge`, `vu-meter`, `channel-grid-cell`, `connection-banner`),
**When** kiểm tra accessibility,
**Then** mọi trạng thái/cảnh báo đều kèm icon hoặc chữ — không nơi nào chỉ dựa vào màu.
**And** Đo và xác nhận tương phản đạt AA cho toàn bộ token: text thường ≥4.5:1, đồ hoạ/border/focus-ring ≥3:1; riêng `on-state-critical` xác nhận 5.94:1 (đạt AA, không ép AAA có chủ đích).
**And** `[ASSUMPTION cần xác nhận]` Kích thước chữ/icon (`channel-name`, `alert-badge`, `numeric`) đã được đo đạc/validate trên màn hình TV wall thật theo khoảng cách xem thực tế phòng trực, điều chỉnh nếu cần trước khi mở rộng 20 kênh.
