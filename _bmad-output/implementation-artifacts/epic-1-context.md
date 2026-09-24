# Epic 1 Context: Truyền dẫn tín hiệu điểm-điểm ổn định qua SRT

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Xây dựng đường truyền SDI→SRT→SDI tự chủ, điểm-điểm giữa mỗi đài và trung tâm tương ứng, không phụ thuộc appliance/SDK thương mại. Tự phục hồi khi mạng suy giảm (ABR hạ bitrate thay vì mất tín hiệu) hoặc mất kết nối hoàn toàn (reconnect vô hạn có backoff + color bars để không bao giờ đứng hình/màn đen), mã hoá AES đầu-cuối bắt buộc. Tự thân đã thay thế đơn vị truyền dẫn thuê ngoài, tạo giá trị ngay cả trước khi có dashboard giám sát (Epic 2+).

## Stories

- Story 1.1: Khởi tạo transport-core, cấu hình kết nối & kết nối SRT điểm-điểm cơ bản
- Story 1.2: State machine reconnect vô hạn khi mất mạng
- Story 1.3: Color bars tự động khi mất kết nối hoàn toàn
- Story 1.4: Nhánh reject riêng khi sai passphrase + log audit
- Story 1.5: Sinh & lưu trữ passphrase an toàn qua DPAPI
- Story 1.6: Capture/playout SDI qua Blackmagic DeckLink Studio 4K
- Story 1.7: ABR chủ động hạ bitrate H.264 khi mạng xấu
- Story 1.8: Telemetry thô + VU meter + snapshot + heartbeat qua LAN có xác thực

## Requirements & Constraints

- Mỗi kênh = 1 kết nối SRT độc lập; reconnect vô hạn khi mất mạng, backoff/phân loại riêng khi bị từ chối do sai passphrase (không gộp chung mất mạng).
- AES bắt buộc mọi kết nối, không có chế độ plaintext/kết nối một phần. Passphrase sinh ngẫu nhiên riêng/kênh, tối thiểu 128-bit entropy, không dùng chung giữa các kênh.
- Handshake bị từ chối phải log structured kèm nguồn gốc; cảnh báo khi tần suất bất thường, đếm riêng theo kênh đã biết và nguồn lạ.
- Mất kết nối SRT hoàn toàn → output SDI chuyển ngay color bars (độc lập vòng reconnect nền); phục hồi tự động, không thao tác thủ công.
- ABR hạ bitrate H.264 khi băng thông suy giảm, ưu tiên continuity; không dùng HEVC cho MVP#1.
- Latency end-to-end mục tiêu ≤1s khi mạng nominal + ABR không active — chưa benchmark thực tế (bắt buộc benchmark 1-2 ngày đầu pilot); khi ABR active thì bỏ ngưỡng này. Không đánh đổi chất lượng ảnh sau ABR hay hạ cấp encryption chỉ để giữ ngưỡng ≤1s.
- Mỗi kênh 1 tiến trình/actor độc lập, không chia sẻ state; cách ly cả ở máy vật lý (1 máy trung tâm = đúng 1 card capture, không gộp kênh).
- transport-core chạy Windows Service có auto-restart.
- File cấu hình/kênh (chỉnh tay, không UI/CLI cho MVP#1): IP nhận, port, bitrate gốc, độ trễ buffer (khuyến nghị ≥3x RTT thực đo), độ dài khoá AES (128/256), passphrase, đường dẫn file nguồn test. Toàn bộ file (kể cả passphrase) mã hoá DPAPI scope machine tại chỗ, không tách file riêng; mỗi máy giữ đúng 1 file của đúng 1 kênh.

## Technical Decisions

- C++, 1 tiến trình/kênh. Gọi libsrt (≥1.5.7 bắt buộc, bản cũ dính CVE) trực tiếp qua C API trong cùng tiến trình để ABR đọc thống kê SRT real-time.
- **Amend quan trọng sau khi lập epic**: capture/encode/decode/output KHÔNG tự viết lên Blackmagic SDK, mà link static thư viện FFmpeg (`libavformat`/`libavcodec`/`libavdevice`, nhánh 8.1.x, build `--disable-libsrt`) làm native library trong cùng tiến trình — không shell-out CLI `ffmpeg` subprocess. `libavdevice` có sẵn module decklink input/output.
- Interface `Source` ở đài (`BlackmagicSource` qua libavdevice decklink input / `FileMediaSource` chỉ test-dev) và interface riêng `PlayoutSink` ở trung tâm (libavdevice decklink output) — không dùng chung vì khác vai trò.
- Payload qua SRT = MPEG-TS; mux/demux dùng muxer libavformat qua `AVIOContext` tuỳ biến (không dùng protocol handler `srt://` built-in) — gửi/nhận thật vẫn qua libsrt trực tiếp.
- State machine actor: `CONNECTING→CONNECTED`; mất mạng→`RECONNECTING` (backoff 1s→2s→4s...trần 30s, vô hạn); sai passphrase→`REJECTED` (backoff riêng 5s→60s trần, tự throttle cục bộ). Hai nhánh backoff dùng bộ đếm độc lập.
- Actor chỉ backoff cục bộ + phát `handshake_reject`/`handshake_success`; đếm ngưỡng cảnh báo dò passphrase thuộc dashboard-backend (Epic 2), không phải transport-core.
- Envelope event chung mọi `event_type`: `schema_version`, `channel_id`, `timestamp` (ISO 8601 UTC), `event_type`, `payload`. Transport-core chỉ phát telemetry thô (`bitrate`, `rtt`, `connection_state` — 4 giá trị đóng, không rút gọn boolean; `audio_level: [L, R]` dBFS) — không tự tính debounce/threshold/severity.
- Mỗi máy trung tâm là client outbound WebSocket/TCP qua LAN tới 1 endpoint dashboard-backend, kèm bearer-token riêng/máy; không message broker.
- Snapshot JPEG định kỳ (~1-2s, KHÔNG gửi khi mất tín hiệu) + heartbeat riêng mỗi 5s (độc lập `connection_state`) để phát hiện máy trung tâm chết.
- Log JSON-lines cục bộ mỗi máy: handshake thành công/reject, chuyển state actor, heartbeat mất/khôi phục.
- Rollout: pilot 1 kênh 7 ngày, benchmark RTT/latency bắt buộc 1-2 ngày đầu; mở rộng 20 kênh chỉ sau khi ổn định + quy trình cấp passphrase chứng thực lặp lại được.

## Cross-Story Dependencies

- Story 1.1 là nền tảng cấu hình + interface `Source`/actor cho mọi story sau.
- Story 1.5 hoàn thiện field `passphrase` đã đặt placeholder ở 1.1.
- Story 1.6 implement cụ thể `Source`/`PlayoutSink` từ 1.1, thay `FileMediaSource` dùng để test.
- Story 1.3 phản ứng theo state `RECONNECTING` từ Story 1.2; Story 1.4/1.7 phát event mà Story 1.8 gom thành telemetry/log gửi LAN.
- Story 1.8 nối ra Epic 2: telemetry/snapshot/heartbeat ở đây là input duy nhất để dashboard-backend (Story 2.1) tính debounce/threshold/trạng thái hiển thị — transport-core không tự tính severity.
