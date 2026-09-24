# Story 1.1: Khởi tạo transport-core, cấu hình kết nối & kết nối SRT điểm-điểm cơ bản

Status: done
Baseline Commit: NO_VCS

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Context engine analysis completed — đây là story đầu tiên của codebase, thiết lập scaffold/convention cho transport-core/. -->

## Story

As a đội kỹ thuật vận hành VTCDigital,
I want mỗi kênh có 1 file cấu hình riêng (IP nhận, port, bitrate gốc, độ trễ buffer, độ dài khoá AES, passphrase, đường dẫn nguồn test) và thiết lập được kết nối SRT điểm-điểm dựa trên libsrt (≥1.5.6) với lớp orchestration C++ tự build,
so that tín hiệu được truyền point-to-point theo đúng tham số cấu hình, không phụ thuộc appliance/SDK thương mại, không chia sẻ state giữa các kênh, và test được thông luồng ngay cả khi chưa có card Blackmagic.

## Acceptance Criteria

1. **Config file per kênh** — transport-core đọc 1 file cấu hình JSON/YAML/kênh chứa đủ các field: `remote_ip`, `port`, `bitrate` (gốc), `latency_ms` (độ trễ buffer SRT), `aes_key_length` (128 hoặc 256), `passphrase`, `test_source_path` (đường dẫn file mp4 cho `FileMediaSource`). Thiếu field bắt buộc hoặc `aes_key_length` không thuộc {128,256} → startup fail rõ ràng (không silently default).
   [Source: epics.md#Story-1.1; epics.md#Additional-Requirements-(Story-1.1-config-surface)]

2. **Kết nối SRT qua libsrt, trực tiếp C API, AES bắt buộc** — kết nối SRT thiết lập thành công qua libsrt (xem Dev Notes §Version libsrt để chọn version cụ thể — tối thiểu 1.5.6, ưu tiên 1.5.7 nếu vcpkg có sẵn), gọi trực tiếp `libsrt` C API (không qua FFI trung gian, AD-4), áp đúng `aes_key_length` (→ `SRTO_PBKEYLEN`) và `latency_ms` (→ `SRTO_LATENCY`) đã cấu hình. AES luôn bật; **không tồn tại code path nào khởi động được kết nối với AES tắt** — nếu `aes_key_length` rỗng/0 ở config, chặn ngay tại validate (AC#1), không tới tận bước connect mới fail.
   [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-4, #AD-6; epics.md#Story-1.1]

3. **Actor độc lập/kênh, không chia sẻ state** — mỗi kênh chạy như 1 actor độc lập (own config, own SRT socket, own lifecycle) — không có biến static/global dùng chung giữa các actor. Crash hoặc exception ở actor A không làm actor B dừng/crash theo (verify bằng test: actor A ném exception giả lập → actor B vẫn tiếp tục hoạt động bình thường).
   [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-20; epics.md#Story-1.1]

4. **Source abstraction + test thông luồng không cần Blackmagic** — interface `Source` (`BlackmagicSource`/`FileMediaSource`) được định nghĩa; `FileMediaSource` đọc `test_source_path` (file mp4), phát lặp làm nguồn vào. Test end-to-end (encode→SRT→decode) chạy được **hoàn toàn không cần card Blackmagic thật** — `BlackmagicSource` chỉ cần tồn tại như khai báo interface/stub trong story này (impl thật là Story 1.6).
   [Source: ARCHITECTURE-SPINE.md#AD-8; epics.md#Story-1.1]

## Tasks / Subtasks

- [x] Task 1: Scaffold codebase `transport-core/` theo đúng Structural Seed (AC: #1-#4)
  - [x] Tạo cây thư mục: `src/{source,pipeline,srt,telemetry,config,logging}/`, `app/` — kể cả các thư mục chưa dùng đầy đủ ở story này (`telemetry/`, `logging/`) để story sau (1.4/1.8) không phải tái cấu trúc.
  - [x] Chọn build tooling: **CMake + vcpkg** (khuyến nghị mặc định — kiến trúc/PRD KHÔNG chỉ định build system cụ thể, đây là gap đã ghi nhận ở review-deployment-ops.md; chốt ở đây để các story sau nhất quán theo).
  - [x] Chọn test framework C++: **GoogleTest** (khuyến nghị mặc định, cùng lý do trên — không có chỉ định trong PRD/Architecture).
  - [x] Pin libsrt qua vcpkg theo đúng Dev Notes §Version libsrt bên dưới — **kiểm tra version cụ thể có sẵn trong vcpkg registry tại thời điểm code hoá trước khi chốt**, không giả định port đã theo kịp bản mới nhất trên GitHub.

- [x] Task 2: Config loader per-kênh (AC: #1)
  - [x] Parse JSON/YAML → struct `ChannelConfig{remote_ip, port, bitrate, latency_ms, aes_key_length, passphrase, test_source_path}`.
  - [x] Validate tại startup: field bắt buộc đầy đủ, `aes_key_length ∈ {128, 256}` (không rỗng/0) — fail-fast với thông báo lỗi rõ field nào sai/thiếu.
  - [x] Passphrase: lưu **plaintext trong config ở story này** — đúng epics.md ("field placeholder — sinh/mã hoá theo Story 1.5"), KHÔNG implement DPAPI encryption hay random generation ở đây (tránh scope creep). Chỉ đảm bảo `passphrase` KHÔNG bao giờ bị ghi vào structured log (AD-30 log fields chỉ có `timestamp, channel_id, event_type, source, reason` — không có passphrase).

- [x] Task 3: Source abstraction (AC: #4)
  - [x] Định nghĩa interface `Source` (pure virtual C++): `open()`, `readFrame()`, `close()`.
  - [x] Implement `FileMediaSource`: mở `test_source_path`, phát lặp (loop) frame làm nguồn vào khi hết file.
  - [x] Khai báo `BlackmagicSource` như stub implement `Source` (không implement capture thật — throw/not-implemented) — full capture là Story 1.6, không code ở đây.

- [x] Task 4: libsrt wrapper + actor per kênh (AC: #2, #3)
  - [x] Wrap libsrt C API trực tiếp: `srt_create_socket`, `srt_connect`/`srt_listen`, set `SRTO_PBKEYLEN` (16 cho 128-bit, 32 cho 256-bit — verify đúng semantic/tên option trong version libsrt đã pin trước khi code), `SRTO_LATENCY = latency_ms`, `SRTO_PASSPHRASE`.
  - [x] Actor/kênh: đóng gói own thread/task + own SRT socket + own config, không static/global shared state. Định nghĩa field/enum `connection_state` với **đúng 4 giá trị chuẩn AD-9/AD-11: `CONNECTING`, `CONNECTED`, `RECONNECTING`, `REJECTED`** (chuỗi tiếng Anh viết hoa, verbatim — xem Dev Notes §connection_state naming) ngay từ story này dù chỉ exercise `CONNECTING → CONNECTED`, để 1.2/1.4 chỉ cần thêm transition, không phải đổi tên/kiểu field hay refactor actor.
  - [x] Test crash-isolation: actor A ném exception giả lập, actor B (kênh khác) vẫn tiếp tục chạy bình thường.

- [x] Task 5: Pipeline encode/decode tối thiểu, bitrate cố định (AC: #2, #4)
  - [x] Encode H.264 (x264 software là đủ cho story này; hardware NVENC/QuickSync/AMF là tối ưu hoá, không bắt buộc ở 1.1) tại ĐÚNG `bitrate` đã cấu hình — **không có logic ABR/hạ bitrate động** (đó là Story 1.7).
  - [x] Decode phía nhận: decode thành công là đủ để verify end-to-end (đếm/log số frame decode được) — **KHÔNG cần xuất SDI output thật** (Blackmagic playout là Story 1.6, chưa có phần cứng).

- [x] Task 6: Entrypoint theo vai trò (đài/trung tâm) (AC: #1-#4)
  - [x] `app/`: đọc `ChannelConfig`, khởi tạo `Source` (FileMediaSource cho test) + pipeline encode/SRT (vai trò đài) hoặc SRT/decode (vai trò trung tâm), khởi động actor.
  - [x] KHÔNG implement Windows Service hosting ở đây — đó là AC riêng của Story 1.6; chạy như console app/process thường cho story này.

- [x] Task 7: Test end-to-end thông luồng (AC: #2, #4)
  - [x] 2 process cục bộ (localhost loopback đủ dùng, không cần internet thật): vai trò đài dùng `FileMediaSource` + file mp4 test, vai trò trung tâm nhận qua SRT. (Xem Completion Notes — station/center binaries triển khai đủ; test tự động hoá dùng ChannelActor trực tiếp thay vì 2 process riêng, vì môi trường code hoá không có compiler để build/run 2 process thật.)
  - [x] Verify: kết nối thành công với đúng `aes_key_length`/`latency_ms` cấu hình; kết nối với sai `passphrase` bị handshake fail (không cần implement state `REJECTED` đầy đủ — chỉ cần verify libsrt tự reject, đúng hành vi built-in của thư viện).
  - [x] Verify crash-isolation (Task 4) và validate config (Task 2) bằng unit test riêng (GoogleTest).

### Review Findings

_Code review 2026-08-31 (4 layer: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). Severity trong ngoặc._

- [x] [Review][Patch] (High) Pipeline media (FileMediaSource→H264Encoder→FrameFraming→H264Decoder) có 0 test tự động — e2e chỉ assert handshake, station trỏ mp4 không tồn tại nên chưa từng gửi 1 byte payload; lý do "sandbox không có compiler" trong comment đã hết hiệu lực. Thêm test tích hợp in-memory: frame YUV tổng hợp → encode → split/reassemble → decode, assert framesDecoded > 0 + test FileMediaSource loop; cập nhật comment lỗi thời [transport-core/tests/test_srt_loopback_e2e.cpp:1]
- [x] [Review][Patch] (Medium) AC#2/AD-6 "không tồn tại code path nào kết nối với AES tắt" chỉ được chặn ở config loader — ChannelConfig dựng tay (như test đang làm) đi thẳng tới SRTO_PBKEYLEN=0/passphrase rỗng = tắt mã hoá; re-validate ở ChannelActor ctor / applyChannelOptions (reject pbkeylen ∉ {16,32}, passphrase rỗng) + set SRTO_ENFORCEDENCRYPTION=true tường minh [transport-core/src/srt/SrtSocket.cpp:70]
- [x] [Review][Patch] (Medium) Data race UB trên `SrtSocket::sock_`: stop() ghi qua close() từ thread điều khiển trong khi actor thread đọc trong send/recv/isConnected không đồng bộ — chuyển `sock_` sang `std::atomic<int32_t>` [transport-core/src/srt/SrtSocket.h:74]
- [x] [Review][Patch] (Medium) stop() sớm không unblock được: runStation thiếu check `stopRequested_` sau khi đăng ký socket (runCenter có, runStation không) — stop() trước connectTo() làm join chờ hết connect timeout; với center trước accept() có thể treo vô hạn [transport-core/src/srt/ChannelActor.cpp:107]
- [x] [Review][Patch] (Medium) stop() chủ động trong lúc connectTo()/accept() đang block bị báo là failure: SrtError → failed_=true, log handshake_reject/actor_exception sai bản chất, exit code 1 cho một lần shutdown sạch — map teardown-error trong connectTo/accept thành kết thúc sạch như send/receive đã làm [transport-core/src/srt/SrtSocket.cpp:89]
- [x] [Review][Patch] (Medium) Không có trạng thái "kết thúc bình thường": run loop thoát sạch (peer ngắt) nhưng failed_=false, state kẹt CONNECTED — main loop station/center quay vô hạn sau khi thread actor đã chết; thêm cờ finished_/isRunning() và check trong 2 app main [transport-core/src/srt/ChannelActor.h:63]
- [x] [Review][Patch] (Medium) FrameFraming không có sequence number: SRT live mode (TLPKTDROP) drop chunk giữa → START+…gap…+END ráp thành access unit sai lệch âm thầm đẩy vào decoder — thêm 1 byte seq vào header, mismatch thì drop unit [transport-core/src/srt/FrameFraming.cpp:37]
- [x] [Review][Patch] (Medium) Heap overflow với video width/height lẻ: chroma buffer cấp floor(w/2)·floor(h/2) nhưng sws_scale YUV420P ghi ceil — reject odd dimensions ngay tại open() (FileMediaSource là test-only, chặn sớm là đủ); H264Encoder cũng giả định chẵn [transport-core/src/source/FileMediaSource.cpp:114]
- [x] [Review][Patch] (Medium) Truncation số nguyên trong config loader phá fail-fast AC#1: `aes_key_length=2^32+128` cast int → 128 LỌT validate; bitrate/latency_ms ≥ 2^32 wrap âm thầm; bitrate > INT_MAX wrap âm trong x264 — validate range trên `long long` trước khi cast [transport-core/src/config/ChannelConfig.cpp:127]
- [x] [Review][Patch] (Medium) Test AC#2 không quan sát giá trị negotiate thật: bỏ set PBKEYLEN/LATENCY test vẫn xanh — sau CONNECTED đọc lại `srt_getsockflag(SRTO_PBKEYLEN/SRTO_LATENCY)` (thêm getter trên SrtSocket) và assert đúng config [transport-core/tests/test_srt_loopback_e2e.cpp:75]
- [x] [Review][Patch] (Medium) Bất biến "passphrase KHÔNG BAO GIỜ vào log" không có test canh giữ, và không viết nổi vì ChannelActor hard-code defaultLogger() — inject Logger (default = defaultLogger) rồi test với ostringstream assert output không chứa passphrase + pin format 5 field [transport-core/src/srt/ChannelActor.cpp:96]
- [x] [Review][Patch] (Low) `defaultLogger()` là static shared giữa các actor — lệch tuyên bố "share nothing" AD-20 trong comment ChannelActor.h (bỏ sót logger); giải quyết cùng finding inject-logger ở trên hoặc ghi nhận rõ là exception có chủ đích [transport-core/src/logging/Logger.cpp:75]
- [x] [Review][Patch] (Low) FrameReassembler không có cap kích thước buffer (peer lỗi/độc hại gửi mãi continuation không END → phình vô hạn) + H264Decoder::decode không guard accessUnit rỗng [transport-core/src/srt/FrameFraming.cpp:59]
- [x] [Review][Patch] (Low) swsCtx_ cache vĩnh viễn — dimension/pixel-format đổi giữa stream dùng scaler cũ sai geometry; tái tạo khi w/h/fmt đổi hoặc reject [transport-core/src/source/FileMediaSource.cpp:103]
- [x] [Review][Patch] (Low) seekToStart() bỏ qua return của av_seek_frame — file không seek được làm loop hỏng với thông báo lỗi mù mờ về sau [transport-core/src/source/FileMediaSource.cpp:90]
- [x] [Review][Patch] (Low) EAGAIN của avcodec_send_packet làm rơi packet/access-unit âm thầm ở cả FileMediaSource lẫn H264Decoder (khó xảy ra do drain-trước-send nhưng fix rẻ: drain rồi resend) [transport-core/src/pipeline/H264Decoder.cpp:59]
- [x] [Review][Patch] (Low) `channel_id` sai kiểu (non-string) bị bỏ qua âm thầm fallback về filename stem — fail rõ ràng theo tinh thần AC#1 [transport-core/src/config/ChannelConfig.cpp:74]
- [x] [Review][Patch] (Low) start() gọi 2 lần → gán đè std::thread joinable → std::terminate; stop() không reset stopRequested_ nên actor không tái sử dụng được — guard joinable + reset cờ trong start() [transport-core/src/srt/ChannelActor.cpp:34]
- [x] [Review][Patch] (Low) toString(ConnectionState) — hợp đồng wire AD-9/AD-11 cho Story 1.8 — chưa pin bằng unit test 4 chuỗi verbatim [transport-core/src/srt/ConnectionState.cpp:7]
- [x] [Review][Patch] (Low) Test crash-isolation chưa chứng minh literal AC#3 "actor B tiếp tục hoạt động bình thường" — B cũng fail (connection refused); thêm kịch bản cặp station/center đang CONNECTED, A crash, B vẫn CONNECTED [transport-core/tests/test_actor_crash_isolation.cpp:40]
- [x] [Review][Patch] (Low) FindSRT.cmake không kiểm tra version (TRANSPORT_CORE_LIBSRT_VERSION khai báo rồi bỏ đó) — libsrt hệ thống < 1.5.6 vẫn lọt khi build ngoài vcpkg flow; parse srt/version.h + VERSION_VAR cho FPHSA [transport-core/cmake/FindSRT.cmake:25]
- [x] [Review][Patch] (Low) Thiếu README/hướng dẫn build hoàn toàn (bootstrap vcpkg, VCPKG_ROOT, preset windows-vcpkg, chạy 2 binary với config mẫu, ctest) [transport-core/]
- [x] [Review][Patch] (Low) Test flaky theo môi trường: port cứng 40001–41002 đụng độ khi chạy song song/TIME_WAIT + sleep 150ms "chờ listener bind" là race thuần thời gian [transport-core/tests/test_srt_loopback_e2e.cpp:75]
- [x] [Review][Patch] (Low) Center log handshake_success với source=cfg.remote_ip (giá trị config vô nghĩa với vai trò listener) thay vì địa chỉ peer thật từ srt_accept — sai ngữ nghĩa field `source` AD-30 [transport-core/src/srt/ChannelActor.cpp:173]
- [x] [Review][Defer] Đơn vị `bitrate` = kbps là [ASSUMPTION] đã document nhưng chưa được ops xác nhận — phải chốt trước khi Story 1.7 (ABR) xây tiếp trên field này [transport-core/src/config/ChannelConfig.h:267] — deferred, pre-existing

### Review Findings (Round 2 — re-review sau khi áp patch vòng 1)

_Code review 2026-08-31, cùng 4 layer, chạy lại trên code đã patch. Phát hiện 2 lỗi thật trong chính patch vòng 1 (VG1, AA3) — reviewer tự kiểm tra công việc của mình._

- [x] [Review][Patch] (Medium) Test `PassphraseNeverAppearsInLogOutput` (vòng 1) là tautology — passphrase khai báo không hề được đưa vào event trước khi assert vắng mặt, luôn pass vô điều kiện — viết lại test để thực sự nhúng passphrase làm regression check, thêm test thật dùng ChannelActor+Logger injected qua kịch bản wrong-passphrase [transport-core/tests/test_logger.cpp, tests/test_srt_loopback_e2e.cpp]
- [x] [Review][Patch] (Medium) `ChannelActor::runCenter()`'s decode/framesDecoded wiring chưa test nào chạm tới — `test_pipeline_roundtrip.cpp` bypass thẳng qua ChannelActor — thêm `test_channel_actor_io.cpp` dùng raw SrtSocket peer + ChannelActor(Center) thật [transport-core/tests/test_channel_actor_io.cpp]
- [x] [Review][Patch] (Medium) `ConnectionState::REJECTED` định nghĩa nhưng không bao giờ được set — `runStation()`'s reject branch chỉ log rồi rethrow — set state đúng lúc [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Medium) `applyChannelOptions()` chưa nhận biết teardown-error như connectTo/accept — stop() trong lúc set option bị báo false failure — dùng cùng pattern isConnectionTeardownError, thêm stopRequested_ check ngay sau ở cả 2 vai trò [transport-core/src/srt/SrtSocket.cpp, ChannelActor.cpp]
- [x] [Review][Patch] (Medium) Message ngắn hơn header framing khiến `FrameReassembler::addChunk` throw, giết cả actor thay vì bỏ 1 message — guard trong `receiveAccessUnit` trước khi gọi addChunk [transport-core/src/srt/SrtSocket.cpp]
- [x] [Review][Patch] (Medium) `H264Decoder::decode()` throw trên access unit hỏng giết cả actor — wrap trong try/catch ở `runCenter()`'s loop, log `decode_error` và tiếp tục [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Medium) `negotiatedPbkeylenBytes()/negotiatedLatencyMs()` throw opaque SrtError thay vì std::logic_error đã document khi gọi đúng lúc socket vừa bị stop() đóng — thêm check `isConnected()` [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Medium) Race trong test AC#2 negotiated-options (vòng 1): đọc negotiated values có thể race với station's own FileMediaSource.open() throw ngay sau CONNECTED — thêm helper đọc retry-tolerant [transport-core/tests/test_srt_loopback_e2e.cpp]
- [x] [Review][Patch] (Low) `remote_ip` chưa validate cú pháp IPv4 tại config-load — chỉ fail muộn ở connectTo() — thêm validator dotted-quad thuần logic (không cần header network) [transport-core/src/config/ChannelConfig.cpp]
- [x] [Review][Patch] (Low) Guard kích thước lẻ ở `FileMediaSource::open()` dùng nguồn khác (`codecpar`) với buffer allocation thực tế (`decodedFrame_`) — thêm guard tại đúng nơi cấp buffer [transport-core/src/source/FileMediaSource.cpp]
- [x] [Review][Patch] (Low) `runCenter()` không đọc `cfg_.remote_ip`, không có doc rõ field này "chết" với vai trò Center, rủi ro operator hiểu nhầm là allow-list — thêm doc comment [transport-core/src/config/ChannelConfig.h]
- [x] [Review][Patch] (Low) `ChannelActor.cpp` dùng std::logic_error/runtime_error dựa vào include bắc cầu — thêm `#include <stdexcept>` tường minh [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Low) Không có test cho validate defense-in-depth của `SrtSocket::applyChannelOptions()` — chỉ test gián tiếp qua config đã pass validate — thêm `test_srt_socket_options.cpp` [transport-core/tests/test_srt_socket_options.cpp]
- [x] [Review][Patch] (Low) `H264Encoder` không tự validate width/height chẵn, fps, bitrate, kích thước plane Y/U/V — dựa hoàn toàn vào caller (FileMediaSource) — thêm validate ở `open()`/`encode()` [transport-core/src/pipeline/H264Encoder.cpp]
- [x] [Review][Patch] (Low) `SrtSocket::applyChannelOptions` chưa validate `latencyMs` (0 hoặc tràn int32) — không nhất quán với pbkeylen/passphrase re-check mới thêm — thêm check [transport-core/src/srt/SrtSocket.cpp]
- [x] [Review][Patch] (Low) `state()` không có doc rõ "chỉ phản ánh handshake state, không phản ánh actor lifecycle" — thêm doc comment giải thích phải check cùng hasFailed()/hasFinished() [transport-core/src/srt/ChannelActor.h]
- [x] [Review][Patch] (Low) `bindAndListen(cfg_.port)` dùng backlog mặc định =1 không có rationale — thêm comment giải thích (actor-per-channel, 1 caller/kênh) [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Low) Tài liệu "17/17 tests passed" đã lỗi thời — giờ có 42 test/9 file, chưa cái nào chạy lại — cập nhật ghi chú rõ [story file này]
- [x] [Review][Patch] (Low) README thiếu ghi chú Windows Defender/firewall prompt khi chạy `transport-center.exe` lần đầu — thêm note [transport-core/README.md]
- [x] [Review][Defer] FrameReassembler seq 1 byte wrap tại 256 chunk — access unit >8MB (gần cap kMaxAccessUnitBytes) có thể wrap qua nhiều chunk, che mất 1 chunk bị drop đúng lúc wrap trùng — access unit thực tế trong pipeline này chỉ vài KB, đây là biên rất xa; đổi wire format sang seq rộng hơn là thay đổi phá vỡ tương thích, ngoài scope vòng patch này — deferred, pre-existing design tradeoff
- [x] [Review][Defer] `SIGTERM` handler chết trên Windows console (cần `SetConsoleCtrlHandler` cho CTRL_CLOSE/SHUTDOWN) — graceful shutdown qua signal thật sự cần thiết khi có Windows Service hosting (Story 1.6), ngoài scope story này (chỉ chạy console app) — deferred to Story 1.6
- [x] [Review][Defer] `FileMediaSource.cpp`'s logic mới (odd-dim reject, EAGAIN retry, sws rebuild) chưa có test tự động — cần file mp4 fixture thật, commit binary asset vào repo là quyết định repo-policy (kích thước, CI) nên để user quyết định ở story sau, không tự ý thêm — deferred, cần user input
- [x] [Review][Defer] `stop()` gọi đồng thời từ 2 thread khác nhau là UB (không có mutex serialize joinable()/join()) — không có call site nào trong codebase hiện tại làm vậy (station_main/center_main gọi 1 lần, destructor không chạy đồng thời với explicit stop()) — deferred, thêm mutex nếu story sau cần concurrent stop()
- [x] [Review][Defer] Port cứng trong test (40001-41003) chưa có dynamic allocation thật — chỉ nửa fix của patch #23 vòng 1 (đã fix phần sleep-race, chưa fix phần port-collision) — cần thêm API `SrtSocket::localPort()` qua `srt_getsockname` và restructure thứ tự start test, non-trivial — deferred
- [x] [Review][Defer] Không có CI/build workflow (GitHub Actions) build+ctest tự động — đây chính là lý do cả 2 vòng patch này không build-verify được — khuyến nghị thêm ở story/task riêng, ngoài scope 1 lần code review — deferred
- [x] [Review][Defer] `Logger`/`escapeJson` không giới hạn kích thước field trước khi ghi log — rủi ro thấp (field hiện tại đều ngắn/từ config đã validate hoặc exception message), không như bitrate/latency đã có bound — deferred, low priority
- [x] [Review][Defer] AC#4 literal "test end-to-end (encode→SRT→decode)" chưa có 1 test tự động duy nhất chạy trọn chuỗi qua mạng SRT thật — trade-off đã biết, đã document trong comment `test_srt_loopback_e2e.cpp` (SRT layer test + pipeline in-memory test tách biệt, cộng 1 lần chạy tay 2-process) — deferred, accepted trade-off. **[Cập nhật vòng 3]** `test_channel_actor_io.cpp` (thêm ở vòng 2) thực ra đã chạy encode→srt_sendmsg2/srt_recvmsg2 thật→decode qua `ChannelActor` thật — gap còn lại hẹp hơn nhiều: chỉ còn thiếu test tự động cho đúng path `runStation()` (FileMediaSource+encoder bên trong actor), không phải "không có test nào chạy encode→SRT→decode thật" như câu chữ cũ.

### Review Findings (Round 3 — re-review sau khi áp patch vòng 2)

_Code review 2026-08-31, cùng 4 layer, chạy lại trên code đã patch 2 vòng. Mức độ nghiêm trọng giảm dần: chỉ còn 2 Medium, phần lớn là compile-hygiene và test-coverage gap cho code đã đúng._

- [x] [Review][Patch] (Medium) `SrtSocket::bindAndListen()` chưa nhận biết teardown-error — cùng loại bug round 1/2 đã vá cho connectTo/accept/applyChannelOptions nhưng bỏ sót hàm này — stop() trong lúc bind/listen bị báo false failure. Đổi thành trả `bool`, check `isConnectionTeardownError`, thêm check `stopRequested_` sau đó ở runCenter [transport-core/src/srt/SrtSocket.cpp, ChannelActor.cpp]
- [x] [Review][Patch] (Medium) `stopRequested_` còn thiếu ở 2 chỗ: ngay sau CONNECTED trước khi mở FileMediaSource/encoder (runStation) và trước khi mở H264Decoder (runCenter) — stop() đúng lúc này bị báo false failure thay vì clean shutdown [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Low) `runStation()`'s readFrame()/encode() lỗi giết cả actor, không có resilience per-frame giống runCenter()'s decode_error — bọc try/catch tương tự, log `source_error`/`encode_error` [transport-core/src/srt/ChannelActor.cpp]
- [x] [Review][Patch] (Low) AC#1/Task2 nói "JSON/YAML" nhưng codebase chỉ support JSON — gap có từ implementation gốc, chưa từng ghi nhận là quyết định có chủ đích — thêm doc note [SCOPE] giống cách document `bitrate` unit assumption, không tự ý thêm YAML parser [transport-core/src/config/ChannelConfig.h]
- [x] [Review][Patch] (Low) `H264Encoder::open()`'s validate bitrate (thêm ở vòng 2) chỉ chặn upper-bound, quên chặn `bitrateKbps_==0` — thêm check [transport-core/src/pipeline/H264Encoder.cpp]
- [x] [Review][Patch] (Low) `H264Encoder::open()`'s validate fps chưa đủ chặt — fps rất nhỏ (`fps_*1000.0 < 1.0`) vẫn qua rồi làm `i_fps_num` = 0 khi cast — siết điều kiện [transport-core/src/pipeline/H264Encoder.cpp]
- [x] [Review][Patch] (Low) `H264Decoder::decode()` không chặn `accessUnit.size() > INT_MAX` — cast âm khi truncate — thêm check [transport-core/src/pipeline/H264Decoder.cpp]
- [x] [Review][Patch] (Low) `H264Decoder::decode()`'s vòng lặp retry EAGAIN (thêm vòng 1) không có giới hạn số lần — decoder kẹt EAGAIN mãi làm treo thread actor vô thời hạn — cap 64 lần retry rồi throw [transport-core/src/pipeline/H264Decoder.cpp]
- [x] [Review][Patch] (Low) `FileMediaSource`'s `av_read_frame() < 0` xử lý mọi lỗi (kể cả lỗi I/O thật) giống EOF bình thường — lỗi I/O bền vững bị che giấu thành hành vi loop-on-EOF — phân biệt `AVERROR_EOF` với lỗi khác, throw cho lỗi thật [transport-core/src/source/FileMediaSource.cpp]
- [x] [Review][Patch] (Low) `SrtSocket`'s move ctor/assign (thêm vòng 1) quên chuyển `seqCounter_` — reset về 0 sau move làm receiver mismatch sequence ở chunk tiếp theo (chưa có call site thật nào bị ảnh hưởng nhưng là sai contract) — thêm vào move ctor/assign [transport-core/src/srt/SrtSocket.cpp]
- [x] [Review][Patch] (Low) `SrtSocket`'s `sock_` atomic không có in-class initializer — momentarily indeterminate giữa construct và store() (không phải bug sống nhưng nên khép kín invariant "own 1 SRTSOCKET" ngay từ instruction đầu) — thêm `{-1}` + static_assert khớp SRT_INVALID_SOCK [transport-core/src/srt/SrtSocket.h, SrtSocket.cpp]
- [x] [Review][Patch] (Low) `Logger.cpp` dùng `std::snprintf` không include `<cstdio>` tường minh — dựa vào include bắc cầu — thêm include [transport-core/src/logging/Logger.cpp]
- [x] [Review][Patch] (Low) `ChannelActor.h` dùng `uint64_t`/`uint32_t` không include `<cstdint>` tường minh — thêm include [transport-core/src/srt/ChannelActor.h]
- [x] [Review][Patch] (Low) `FindSRT.cmake` im lặng bỏ qua version pin nếu `version.h` thiếu/macro đổi tên (VERSION_VAR rỗng khiến FPHSA skip check) — thêm `FATAL_ERROR` rõ ràng thay vì silent bypass [transport-core/cmake/FindSRT.cmake]
- [x] [Review][Patch] (Low) `TRANSPORT_CORE_LIBSRT_VERSION` (CMakeLists.txt) không liên kết với `vcpkg.json`'s override — thêm comment cảnh báo phải sync 2 chỗ [transport-core/CMakeLists.txt]
- [x] [Review][Patch] (Low) `srt_rejectreason_str(int)` — param type chưa có ghi chú xác nhận (lo ngại libsrt header có thể dùng enum type thay vì int) — build gốc đã chạy qua path này thành công (17/17 tests, wrong-passphrase test) nên đã verify; thêm comment xác nhận [transport-core/src/srt/SrtSocket.cpp]
- [x] [Review][Patch] (Low) Test helper `readNegotiatedPbkeylenBytesOrFail`/`readNegotiatedLatencyMsOrFail` (thêm vòng 2) khi hết retry gọi cả `ADD_FAILURE()` lẫn trả sentinel bị `EXPECT_EQ` so sánh tiếp — double-failure confusing — đổi thành hàm assert nội bộ, trả void [transport-core/tests/test_srt_loopback_e2e.cpp]
- [x] [Review][Patch] (Low) Comment trong `test_logger.cpp`'s `PassphraseNeverAppearsInLogOutput` viết "EXPECTED TO FAIL" gây hiểu lầm dù assertion thực chất pass đúng thiết kế — viết lại rõ ràng hơn [transport-core/tests/test_logger.cpp]
- [x] [Review][Patch] (Low) Không có test cho `remote_ip` sai định dạng IPv4 qua `loadFromFile()`/`validate()` thật (chỉ có validator, chưa test) — thêm 4 test case + 2 test gọi `validate()` trực tiếp (seam có sẵn nhưng chưa ai dùng) [transport-core/tests/test_channel_config.cpp]
- [x] [Review][Patch] (Low) Không có test cho resilience decode_error (vòng 2) qua actor thật — thêm test gửi access unit hỏng qua raw peer, verify actor sống sót và vẫn decode frame tốt tiếp theo [transport-core/tests/test_channel_actor_io.cpp]
- [x] [Review][Patch] (Low) Không có test cho `H264Encoder::encode()`'s plane-size guard (vòng 2) — thêm test VideoFrame plane thiếu kích thước [transport-core/tests/test_pipeline_roundtrip.cpp]
- [x] [Review][Patch] (Low) Không có test cho `start()` gọi 2 lần throw logic_error, không có test cho chu trình restart stop()/start() — thêm 2 test [transport-core/tests/test_actor_crash_isolation.cpp]
- [x] [Review][Patch] (Low) `BlackmagicSource` — 0 test coverage cho contract "mọi method throw logic_error" — thêm `test_blackmagic_source.cpp` [transport-core/tests/test_blackmagic_source.cpp]
- [x] [Review][Defer] `ChannelConfig::validate()` giờ đã có test trực tiếp (patch phía trên) nhưng `FileMediaSource`'s width()/height() (dựa `codecpar`) có thể lệch với `decodeOneFrame()`'s dimension check (dựa `decodedFrame_`) nếu crop metadata/mid-stream resolution đổi — H264Encoder's dimension-match check sẽ throw mọi frame nếu vậy. Rework cần theo dõi geometry nhất quán hơn, ngoài scope 1 lần review nhỏ — deferred
- [x] [Review][Defer] `ChannelActor::start()`/`stop()` gọi đồng thời từ 2 thread khác nhau vẫn là UB (đã ghi nhận vòng 2) — không call site nào trong codebase làm vậy — vẫn deferred, chưa cần mutex
- [x] [Review][Defer] Không có test cho `stop()` thực sự unblock một thread đang block thật sự trong `connectTo()`/`accept()` (vd. connect tới địa chỉ bị black-hole) — môi trường-fragile để test tin cậy, chưa cần thiết vì cơ chế đã document kỹ và loopback tests đã gián tiếp exercise phần lớn đường đi — deferred, low priority
- [x] [Review][Defer] `FrameReassembler`'s size-cap (kMaxAccessUnitBytes) drop access unit hợp lệ nhưng quá khổ mà không log/báo hiệu gì — không phân biệt được với case "đang chờ thêm chunk" từ phía caller — cần đổi contract (thêm out-param hoặc exception riêng), ngoài scope patch nhỏ — deferred, observability nice-to-have

## Dev Notes

- **Ranh giới scope story này** — CHỈ làm: config loader + validate, kết nối SRT cơ bản (libsrt trực tiếp), actor skeleton (state tối thiểu CONNECTING/CONNECTED), Source abstraction + FileMediaSource, encode/decode ở bitrate cố định. **KHÔNG làm** (đã có story riêng, đừng lấn scope): reconnect/backoff vô hạn khi mất mạng (1.2), color bars khi mất kết nối (1.3), nhánh REJECTED + log audit đầy đủ (1.4), sinh ngẫu nhiên/DPAPI encryption cho passphrase (1.5), Blackmagic capture/playout thật + Windows Service hosting (1.6), ABR hạ bitrate động (1.7), telemetry event ra dashboard qua LAN (1.8). Một implementation đưa các phần này vào "cho tiện" sẽ tạo trùng lặp/xung đột với story sau — giữ đúng ranh giới.
- **AD bindings áp dụng cho story này:** AD-1 (tự build orchestration trên libsrt, không appliance thương mại đóng gói — libsrt bản thân LÀ thư viện SRT gốc/mở của Haivision, ranh giới "tự build" nằm ở lớp orchestration, không phải tránh chính libsrt), AD-2 (cách ly máy vật lý — không cần dựng 40 máy thật cho dev/test, nhưng code phải sẵn sàng chạy độc lập/máy), AD-4 (C++ trực tiếp, không FFI), AD-6 (passphrase là lớp phòng thủ duy nhất — AES luôn bật, reject cứng không kết nối một phần), AD-8 (Source abstraction), AD-9 (chỉ exercise `CONNECTING→CONNECTED` ở story này, nhưng field/enum phải khai báo đủ 4 giá trị — xem §connection_state naming), AD-20 (actor-per-channel, không chia sẻ state).
- **§Version libsrt — ĐÃ XÁC MINH TRỰC TIẾP QUA GITHUB RELEASES API (review-version-verify.md, 2026-08-28), CHỐT LẠI KHÁC VỚI GHI CHÚ TRONG epics.md/ARCHITECTURE-SPINE.md:**
  - epics.md và bảng Stack trong `ARCHITECTURE-SPINE.md` ghi "libsrt ≥1.5.6, vá CVE-2026-55840/55841" — nhưng con số CVE này **chưa được review-version-verify xác minh khớp** (review tự tra GitHub release notes và tìm ra 2 CVE ID khác: `CVE-2026-55868` encryption-downgrade + `CVE-2026-55869` heap overflow KMREQ). **KHÔNG dùng số CVE nào ở trên làm sự thật đã chốt** — đối chiếu lại trực tiếp trên `github.com/Haivision/srt/releases` (release notes của v1.5.6 và v1.5.7) trước khi ghi số CVE vào bất kỳ tài liệu/log/comment nào.
  - Sự thật đã verify: `CVE-2026-55868`/`CVE-2026-55869` là 2 lỗi đã tồn tại ở các bản **trước** v1.5.6 (vd. v1.5.4) và được **v1.5.6 vá** — nghĩa là v1.5.6 KHÔNG "vẫn còn" 2 CVE này, nó là bản đã fix. **Không dùng v1.5.4 hoặc cũ hơn.**
  - Quan trọng nhất: tại 2026-08-28, **v1.5.7 đã là bản mới nhất** (phát hành 2026-08-26, chỉ 2 ngày trước ngày verify), release note tự mô tả thêm "security hardening and multiple vulnerability fixes" (memory corruption, protocol state manipulation, resource exhaustion) — bản mà cả epics.md lẫn ARCHITECTURE-SPINE.md đều bỏ sót hoàn toàn khi viết "≥1.5.6".
  - **Quyết định cho story này**: PIN **v1.5.7** nếu vcpkg registry đã có port cho bản này tại thời điểm code hoá (kiểm tra `vcpkg search srt` / port version trước). Nếu vcpkg chưa cập nhật port lên 1.5.7, fallback tối thiểu là **v1.5.6** (vẫn thoả AC "≥1.5.6" của epics.md) — không dùng bản nào cũ hơn 1.5.6. Ghi rõ trong `Completion Notes` bản libsrt thực tế đã dùng và lý do (1.5.7 sẵn có, hay fallback 1.5.6 vì vcpkg chưa theo kịp).
- **`connection_state` naming — phải khớp AD-9/AD-11 verbatim ngay từ story này** (review-adversarial.md mục 1.1 ghi nhận đây từng là điểm bất đồng NGHIÊM TRỌNG giữa team transport-core và dashboard-backend về việc field này là enum 4 giá trị hay boolean trên wire): AD-9 định nghĩa `connection_state` là tập giá trị đóng `{CONNECTING, CONNECTED, RECONNECTING, REJECTED}` — chuỗi tiếng Anh viết hoa, verbatim, KHÔNG rút gọn thành boolean (AD-11 nhắc lại rõ). Story 1.1 không phát telemetry (đó là 1.8) nhưng **enum nội bộ của actor phải dùng đúng 4 tên này ngay từ đầu** để khi 1.8 serialize field này ra wire, không phải đổi tên/ánh xạ lại.
- **Build tooling & test framework KHÔNG được PRD/Architecture chỉ định** (gap ghi nhận ở `review-deployment-ops.md` mục 3) — story này CHỐT quy ước cho toàn bộ transport-core: CMake + vcpkg (quản lý libsrt, dependencies khác), GoogleTest cho unit test. Các story sau (1.2 trở đi) kế thừa quy ước này, không tự chọn lại.
- **`latency_ms` guidance** (không phải requirement cứng, tham khảo khi test/validate giá trị mặc định): khuyến nghị buffer ≥3× RTT thực đo; độ trễ SRT điển hình trên đường truyền sạch 80–500ms. [Source: addendum.md#3]
- **`aes_key_length` → libsrt option mapping**: `SRTO_PBKEYLEN` nhận số BYTE khoá (16 = AES-128, 32 = AES-256), KHÔNG phải bit — verify đúng trước khi map trực tiếp giá trị 128/256 từ config.
- **Passphrase trong story này**: plaintext trong file config là CHẤP NHẬN ĐƯỢC (sinh ngẫu nhiên + DPAPI là Story 1.5) — nhưng tuyệt đối không log giá trị passphrase ở bất kỳ đâu (structured log theo AD-30 không có field này).
- **Stack versions liên quan tới story này**: libsrt — xem §Version libsrt ở trên; Node.js/React KHÔNG liên quan story này (transport-core thuần C++). Blackmagic SDK/driver KHÔNG cần cho story này (dùng FileMediaSource).

### Project Structure Notes

- Codebase hoàn toàn mới (`transport-core/` chưa tồn tại — xác nhận: không có `transport-core/`, `dashboard-backend/`, `dashboard-frontend/` nào trong repo hiện tại). Không có code cũ để tương thích ngược.
- Bắt buộc theo đúng cây thư mục Structural Seed trong `ARCHITECTURE-SPINE.md`:
  ```
  transport-core/
    src/
      source/        # BlackmagicSource (stub), FileMediaSource
      pipeline/       # encode H.264 (bitrate cố định ở story này)
      srt/            # libsrt wrapper, actor state CONNECTING/CONNECTED (enum khai báo đủ 4 giá trị)
      telemetry/       # (thư mục tạo sẵn, nội dung thật ở Story 1.8)
      config/          # loader ChannelConfig (plaintext passphrase ở story này)
      logging/         # (thư mục tạo sẵn, nội dung thật đầy đủ ở Story 1.4/1.8)
    app/               # entrypoint theo vai trò đài/trung tâm, console app (không phải Windows Service ở story này)
  ```
- Không tạo `dashboard-backend/`/`dashboard-frontend/` ở story này (ngoài scope Epic 1).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.1] — user story, acceptance criteria gốc, Additional Requirements (config surface).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md#AD-1,AD-2,AD-4,AD-6,AD-7,AD-8,AD-9,AD-11,AD-20,AD-21] — invariants áp dụng, Structural Seed, Stack table.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/reviews/review-version-verify.md] — libsrt version/CVE thực tế verify qua GitHub Releases API (v1.5.7 là bản mới nhất, CVE ID trong spine chưa khớp nguồn).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/reviews/review-deployment-ops.md] — gap: build/test tooling, staging cho transport-core chưa được đặc tả.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/reviews/review-adversarial.md#1.1] — bất đồng nghiêm trọng giữa team về `connection_state` enum vs boolean, lý do phải khai báo verbatim 4 giá trị ngay từ story này.
- [Source: _bmad-output/planning-artifacts/prds/prd-TranferFiles-2026-08-28/addendum.md#3] — latency buffer ≥3x RTT, đặc tính kỹ thuật SRT.
- Không có story trước (1.1 là story đầu tiên của Epic 1) — không có Previous Story Intelligence để áp dụng.
- Không có git history liên quan (repo chưa khởi tạo git, chưa có commit code nào) — không có Git Intelligence để áp dụng.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via Claude Code subagent.

### Debug Log References

**Round 4 — real build + full test verification, 2026-08-31 (this run).**
Toolchain located at `D:\VSBuildTools2` (cmake 4.3.1-msvc1, ninja bundled
alongside it, cl.exe 19.51.36256.0) with vcpkg at
`D:\ThucHanhAI\TranferFiles\vcpkg`. `ctest` was not on `PATH` in the user's
plain PowerShell (VS Build Tools installs it under
`Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin`, not linked into
`PATH`) — full `cmake --preset windows-vcpkg` → `cmake --build --preset
windows-vcpkg` → `ctest --preset windows-vcpkg` was instead run directly
against that toolchain (via `vcvars64.bat` for the MSVC environment) to
actually build and execute round 1–3's changes for the first time.

3 real compile errors surfaced (all in code introduced by the review rounds
above, none previously build-verified) — fixed and confirmed clean:

- `H264Encoder.cpp`: `std::to_string` used without `#include <string>`
  (C2039/C3861) — only `<limits>`/`<stdexcept>` were included.
- `SrtSocket.cpp`: `std::numeric_limits<int32_t>::max()` — `<winsock2.h>`
  (pulled in for `SRTO_*`/`sockaddr_in`) defines a `max` macro by default on
  Windows, silently mangling the call into a syntax error (C2589/C2059).
  Fixed project-wide (not just this file) by adding
  `add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN)` under `if(WIN32)`
  in the top-level `CMakeLists.txt` — the same collision could otherwise
  recur in any other file that transitively pulls in `<windows.h>`.
- `test_logger.cpp`: MSVC (C3493) refused to implicitly capture a
  `constexpr int` local (`kLinesPerThread`) used only as a loop bound inside
  a `[&logger, t]` lambda — GCC/Clang accept this without an explicit
  capture, MSVC does not. Fixed by adding it to the capture list.

One real **production race condition** surfaced only once the tests actually
ran against real threads/timing (not visible to manual review):
`SrtLoopbackE2ETest.MatchingPassphraseAndOptions_ReachesConnected` failed —
`ChannelActor::negotiatedPbkeylenBytes()`/`negotiatedLatencyMs()` read
`activeSocket_` live, but the test's station actor tears its socket down
(`FileMediaSource` deliberately fails to open a non-existent test file,
by design — see the comment above `runStationWithRetry` in the test file)
within single-digit milliseconds of reaching `CONNECTED`, faster than the
round-3 retry-loop workaround could reliably win. Root-caused as a genuine
design gap rather than a flaky test: these getters have no business being a
*live* query at all — AC#2 only cares what libsrt negotiated *at handshake
time*, not whatever happens to still be queryable afterward. Fixed at the
source: `ChannelActor` now snapshots both values into its own members
(`captureNegotiatedOptions()`) once, immediately after `setState(CONNECTED)`
in both `runStation()`/`runCenter()`, decoupled from `activeSocket_`'s later
lifecycle; the getters now throw `std::logic_error` only if this run never
reached `CONNECTED` at all, never due to a subsequent unrelated teardown.

**Result: 53/53 tests passed** (`transport_core_tests.exe`, all 10 test
files/`ctest --preset windows-vcpkg`) — re-run 3 times in a row, 53/53 every
time, to rule out the fix itself being flaky. Both `transport-station.exe`
and `transport-center.exe` link cleanly against the same build.

**Code review — 3 rounds applied on 2026-08-31 — NOT build-verified at the time (now superseded by Round 4 above).**

- **Round 3** (23 patches, severity now clearly declining — 2 Medium, 21
  Low): `SrtSocket::bindAndListen()` made teardown-aware (same bug class as
  round 1/2, missed on this one call); 2 more missing `stopRequested_`
  checks (right after `CONNECTED`, before Source/decoder work starts);
  `runStation()` given the same per-frame error resilience `runCenter()`
  already had; documented JSON-only as a deliberate scope decision (AC#1
  mentions JSON/YAML, only JSON is implemented — pre-existing gap, not
  introduced by review); `H264Encoder`/`H264Decoder` input-bound hardening
  (bitrate==0, fps truncation, access-unit size, EAGAIN retry cap);
  `FileMediaSource` no longer masks a real I/O error as normal EOF-looping;
  `SrtSocket` move semantics fixed to carry `seqCounter_`; 2 missing
  `#include`s made explicit (`<cstdio>`, `<cstdint>` — compiled only via
  transitive includes before); `FindSRT.cmake` now fails loudly instead of
  silently skipping its own version-pin enforcement if `version.h` can't be
  parsed; fixed a double-failure bug in round 2's own test helper; reworded
  a confusingly-worded test comment; added test coverage for 6 previously-
  untested surfaces (malformed `remote_ip`, `ChannelConfig::validate()`
  called directly, decode-error resilience through a real actor, the
  `H264Encoder` plane-size guard, `start()`-twice/restart lifecycle,
  `BlackmagicSource`'s not-implemented contract).

- **Round 1** (24 patches): SrtSocket atomic `sock_`, teardown-aware
  connectTo/accept, AES enforcement defense-in-depth, FrameFraming seq
  numbers + buffer cap, odd-dimension guard, config truncation checks,
  `finished_` state, injectable Logger, FindSRT.cmake version check,
  README.md, 4 new test files.
- **Round 2** (19 patches, found by re-reviewing round 1's own changes):
  fixed a tautological test (`test_logger.cpp`'s passphrase check never
  actually embedded a passphrase before asserting its absence) and a race
  in round 1's own negotiated-options test assertions; set
  `ConnectionState::REJECTED` on handshake reject (was defined, never set);
  made `applyChannelOptions()` teardown-aware (same gap round 1 fixed for
  connectTo/accept, missed here); added `latency_ms`/plane-size/dimension
  validation to `SrtSocket`/`H264Encoder` directly (previously only
  reachable indirectly via `ChannelConfig`); guarded against one malformed
  SRT message or one corrupt access unit killing the whole actor instead of
  just that frame; added IPv4 syntax validation for `remote_ip`; added 2
  more test files (`test_srt_socket_options.cpp`,
  `test_channel_actor_io.cpp` — the latter closes the gap that
  `test_pipeline_roundtrip.cpp` bypassed `ChannelActor` entirely); fixed
  this file's own stale "17/17 tests" claim (see above).

Both rounds were applied in a session with no `cmake`/`ninja`/`vcpkg` on
`PATH` (a different shell context than the one that produced the "Build/test
verified" entry below — no persistent toolchain across sessions in this
sandbox), so **none of this could be compiled or run**. Changes were
verified only by careful manual re-read of every edited file (and, for round
2, by 4 independent review layers re-reading the round-1 diff). **Before
trusting this story as `done`: run `cmake --build --preset windows-vcpkg` +
`ctest --preset windows-vcpkg` on a machine with the toolchain and fix
whatever that surfaces**, then update `Status` accordingly. Left at
`in-progress` for exactly this reason.

**Build/test verified on 2026-08-31** after the environment gained a real
toolchain (VS Build Tools 2026 v18 C++ workload installed by the user at
`D:\VSBuildTools2`, CMake 4.4.3 + Ninja 1.13.2 + vcpkg via winget/git):

- `cmake --preset windows-vcpkg` + `cmake --build --preset windows-vcpkg` —
  **build succeeded**, all 3 targets linked (`transport-station.exe`,
  `transport-center.exe`, `transport_core_tests.exe`). vcpkg built
  ffmpeg 9.0.1 / x264 0.165.3222 / libsrt 1.5.6 / gtest 1.18.0 /
  nlohmann-json 3.12.0 from source against `x64-windows`.
- **Bug found and fixed during first build attempt**: `SrtSocket.cpp` and
  `SrtLibraryGuard.cpp` wrapped `#include <srt/srt.h>` in an extra
  `extern "C" { }` block. libsrt's `srt.h` already self-guards internally
  (`#ifdef __cplusplus extern "C" {` at its own line ~129) — the outer
  wrapper forced whatever standard headers its preamble pulls in first
  (`<set>`, `<xtree>`, `<cmath>`, ...) into `extern "C"` context too, which
  MSVC rejects (C2894, 100+ errors, `error C1003`). Fix: dropped the extra
  wrapper, `#include <srt/srt.h>` directly in both files (comment left in
  place explaining why). Rebuild succeeded clean after the fix.
- `transport_core_tests.exe` — **17/17 tests passed** (`ChannelConfigTest`
  ×13 covering AC#1's fail-fast matrix, `ChannelActorCrashIsolationTest` ×2
  covering AC#3, `SrtLoopbackE2ETest` ×2 covering AC#2/#4 — matching
  passphrase reaches `handshake_success`/`CONNECTED`, wrong passphrase gets
  `BADSECRET`/rejected by libsrt itself).
  **[Stale as of the 2 code-review rounds below]** — this 17/17 figure is
  from the ORIGINAL pre-review implementation only (3 test files). Two
  review rounds since added 6 more test files
  (`test_frame_framing.cpp`, `test_connection_state.cpp`, `test_logger.cpp`,
  `test_srt_socket_options.cpp`, `test_pipeline_roundtrip.cpp`,
  `test_channel_actor_io.cpp`) plus 2 more `TEST`s in
  `test_actor_crash_isolation.cpp`/`test_srt_loopback_e2e.cpp` — **42 tests
  across 9 files as of 2026-08-31, none of them run since** (see the two
  "NOT build-verified" notes below). Do not read "17/17" as current
  coverage.
- **Manual 2-process demo run** (Task 7 bullet 1, literal reading):
  generated a real 10s test mp4 via `ffmpeg` (`testsrc` 1280x720 + tone) at
  `C:\transport-core-testdata\sample.mp4` (matches `example_station.json`'s
  `test_source_path`), launched `transport-center.exe center.json` then
  `transport-station.exe station.json` as two separate OS processes on
  127.0.0.1:9001. Structured JSON log (stderr) on both sides confirmed
  `handshake_success` with `aes_key_length=128`; x264 encoder initialized
  (Constrained Baseline profile) and ran without exceptions; both processes
  stayed alive and CPU-active (continuous encode/send/receive/decode) until
  manually stopped. No `passphrase` value appeared in any log line (AD-30).

### Completion Notes List

- **Status: done.** Full build + all 53 tests across 10 files passed
  (3× re-run, no flake) against the real toolchain at `D:\VSBuildTools2` —
  see Round 4 in Debug Log References above for the 3 compile errors and 1
  production race condition found and fixed there. This is the first time
  round 1–3's code-review patches were actually compiled/run — everything
  before that point in this file was manual-review-only, now superseded.
- **Compiled, tested, and demo-verified** on a real toolchain — see Debug
  Log References above for the full build/test/demo trail and the one bug
  found+fixed (`extern "C"` double-wrap around libsrt's self-guarding
  `srt.h`). Everything below this line is the original implementation
  record from the (toolchain-less) authoring session, kept as-is.
- **libsrt version actually used: v1.5.6** (fallback branch of Dev Notes
  §Version libsrt). Verified live (not from training data) during
  implementation: fetched `https://raw.githubusercontent.com/microsoft/vcpkg/master/versions/l-/libsrt.json`
  and `.../versions/baseline.json` — the vcpkg port is named **`libsrt`**
  (not `srt`), and as of that fetch its newest available version is 1.5.6;
  1.5.7 has no vcpkg port yet. `vcpkg.json` pins `libsrt` via
  `builtin-baseline` (commit `b42535f3e4001029e43149e24a8fa24975d8796a`,
  also fetched live) plus an explicit `"overrides"` entry for `1.5.6`.
- **libsrt has no CMake package config** (only `vcpkg_fixup_pkgconfig()` in
  its portfile — confirmed by fetching the actual vcpkg portfile.cmake).
  `find_package(srt CONFIG)` would silently fail to find anything usable, so
  `cmake/FindSRT.cmake` does `find_path`/`find_library` instead and exposes
  an `SRT::srt` imported target. Same situation for `x264`
  (`cmake/Findx264.cmake`, target `x264::x264`). `ffmpeg`'s vcpkg port only
  ships the classic `FindFFMPEG.cmake` style (`FFMPEG_INCLUDE_DIRS`/`_LIBRARIES`/`_LIBRARY_DIRS`,
  no imported target) — confirmed via `ports/ffmpeg/usage`.
- **libsrt C API verified against the real v1.5.6 header**
  (`srtcore/srt.h` fetched from `github.com/Haivision/srt` tag `v1.5.6`),
  not from memory: `SRTO_PBKEYLEN` takes **bytes** (16/32), not bits, exactly
  as Dev Notes warned; `SRTO_LATENCY` sets both RCV/PEER latency in ms;
  reject reason for a bad passphrase is queried via
  `srt_getrejectreason()`/`srt_rejectreason_str()` (`SRT_REJ_BADSECRET`);
  `SRT_LIVE_MAX_PLSIZE` = 1456 bytes is the live-mode per-message cap, which
  is why `src/srt/FrameFraming.*` exists (H.264 access units routinely
  exceed that, so they're fragmented into ≤1456-byte SRT messages and
  reassembled on the receive side using a 1-byte start/end flag header).
- **Design decision — FileMediaSource decodes a real mp4 via FFmpeg**
  (avformat demux + avcodec decode + swscale→YUV420P), not a raw YUV
  elementary stream, per epics.md/AC#4's explicit "test_source_path (đường
  dẫn file mp4 cho FileMediaSource)" wording. This pulls in
  `ffmpeg[avcodec,avformat,swscale]` as a dependency purely for the
  test-only source path (AD-8: "FileMediaSource chỉ dùng cho mục đích
  test/dev") and for `H264Decoder` on the receive side; `H264Encoder` uses
  x264 directly per AD-5/Task 5.
- **Design decision — single shared `ChannelConfig` schema regardless of
  role.** AC#1/epics.md describe one config file per channel with a fixed
  field set; nothing in the story distinguishes a "station schema" from a
  "center schema". Both `transport-station`/`transport-center` binaries load
  the exact same `ChannelConfig` struct — a center-role config's
  `bitrate`/`test_source_path` fields are present (required, validated) but
  functionally unused on that side (no encoder/FileMediaSource is
  constructed for `ActorRole::Center`).
- **Design decision — crash-isolation fault injection point.** Task 4's
  test only requires "actor A throws → actor B keeps running", not that the
  fault happen post-connection. `ChannelActor`'s fault injector fires at the
  very top of `run()`, before any SRT/network/codec work — this makes
  `tests/test_actor_crash_isolation.cpp` fully hermetic (no real SRT
  handshake needed) while still proving the load-bearing property: an
  exception must never escape a `std::thread` entry point (that calls
  `std::terminate()` and kills the whole process — every other actor with
  it), which is exactly what the try/catch around `run()`'s body prevents.
- **Design decision — `stop()` unblocks in-flight blocking libsrt calls.**
  `srt_connect`/`srt_accept`/`srt_recvmsg2` block with no built-in
  cancellation. `ChannelActor` registers its currently-active `SrtSocket*`
  (guarded by a mutex, RAII-scoped to each run function) so `stop()` can
  call `close()` on it from another thread to release a blocked call —
  otherwise `tests/test_srt_loopback_e2e.cpp`'s `stop()` calls would hang
  forever. `SrtSocket::sendAccessUnit`/`receiveAccessUnit` treat the
  resulting `SRT_ECONNLOST`/`ENOCONN`/`ESCLOSED`/`EINVSOCK` family as a
  clean end-of-connection (return `false`/`nullopt`) rather than throwing,
  so a deliberate `stop()` isn't reported as an actor failure.
- **AC#1 field validation beyond the literal "aes_key_length ∈ {128,256}"
  requirement**: also validates `passphrase` length is in libsrt's own
  hard-required `[10,79]` character range (`SRTO_PASSPHRASE` constraint,
  confirmed in the v1.5.6 header) and non-empty — AD-6 requires AES always
  on, so an empty/too-short passphrase must fail at config-validate time,
  the same fail-fast guarantee AC#1/AC#2 require for `aes_key_length`.
- **[ASSUMPTION]** `bitrate`'s unit is kbps (matches x264's
  `x264_param_t.rc.i_bitrate` directly). Neither epics.md nor
  ARCHITECTURE-SPINE.md specify a unit; documented in
  `src/config/ChannelConfig.h`. Flag for confirmation with ops before
  Story 1.7 (ABR) builds further on this field.
- **Task 7 bullet 1 ("2 process cục bộ")**: implemented literally as two
  separate binaries (`transport-station`, `transport-center`, see `app/`)
  that operators can run as two real local processes against a real test
  mp4 (`configs/example_station.json` / `example_center.json` are ready to
  copy/edit). The *automated* GoogleTest coverage
  (`tests/test_srt_loopback_e2e.cpp`) instead drives two `ChannelActor`
  instances in-process over real libsrt sockets on 127.0.0.1 — it exercises
  every AC#2 claim (successful connect with configured aes_key_length/latency_ms;
  libsrt rejecting a wrong passphrase) without depending on an actual video
  file being present in the repo/CI, and without a compiler in this sandbox
  to prove the two-binary path end-to-end. Running the two apps manually
  against a real mp4 is the recommended first manual verification step once
  this lands on a machine with the toolchain (see report to caller).
- No dashboard-backend/dashboard-frontend work done (correctly out of Epic 1
  scope). No reconnect/backoff, color bars, REJECTED state machine, DPAPI
  encryption, Blackmagic capture, Windows Service hosting, ABR, or telemetry
  publishing implemented — all correctly deferred to their own stories per
  Dev Notes' scope boundary.

### File List

_Cập nhật 2026-08-31 sau code review — thêm README.md và 4 file test mới (đánh dấu MỚI); các file khác đã sửa tại chỗ theo Review Findings._

- `transport-core/README.md` (MỚI — code review)
- `transport-core/docs/DEPLOY-2-MACHINES.md` (MỚI — hướng dẫn build/test/đóng gói triển khai 2 máy)
- `transport-core/vcpkg.json`
- `transport-core/CMakeLists.txt`
- `transport-core/CMakePresets.json`
- `transport-core/.gitignore`
- `transport-core/cmake/FindSRT.cmake`
- `transport-core/cmake/Findx264.cmake`
- `transport-core/src/CMakeLists.txt`
- `transport-core/src/config/ChannelConfig.h`
- `transport-core/src/config/ChannelConfig.cpp`
- `transport-core/src/source/VideoFrame.h`
- `transport-core/src/source/Source.h`
- `transport-core/src/source/FileMediaSource.h`
- `transport-core/src/source/FileMediaSource.cpp`
- `transport-core/src/source/BlackmagicSource.h`
- `transport-core/src/source/BlackmagicSource.cpp`
- `transport-core/src/pipeline/H264Encoder.h`
- `transport-core/src/pipeline/H264Encoder.cpp`
- `transport-core/src/pipeline/H264Decoder.h`
- `transport-core/src/pipeline/H264Decoder.cpp`
- `transport-core/src/srt/ConnectionState.h`
- `transport-core/src/srt/ConnectionState.cpp`
- `transport-core/src/srt/SrtLibraryGuard.h`
- `transport-core/src/srt/SrtLibraryGuard.cpp`
- `transport-core/src/srt/FrameFraming.h`
- `transport-core/src/srt/FrameFraming.cpp`
- `transport-core/src/srt/SrtSocket.h`
- `transport-core/src/srt/SrtSocket.cpp`
- `transport-core/src/srt/ChannelActor.h`
- `transport-core/src/srt/ChannelActor.cpp`
- `transport-core/src/logging/Logger.h`
- `transport-core/src/logging/Logger.cpp`
- `transport-core/src/telemetry/.gitkeep`
- `transport-core/app/CMakeLists.txt`
- `transport-core/app/station_main.cpp`
- `transport-core/app/center_main.cpp`
- `transport-core/tests/CMakeLists.txt`
- `transport-core/tests/test_channel_config.cpp`
- `transport-core/tests/test_frame_framing.cpp` (MỚI — code review)
- `transport-core/tests/test_connection_state.cpp` (MỚI — code review)
- `transport-core/tests/test_logger.cpp` (MỚI — code review)
- `transport-core/tests/test_srt_socket_options.cpp` (MỚI — code review vòng 2)
- `transport-core/tests/test_pipeline_roundtrip.cpp` (MỚI — code review)
- `transport-core/tests/test_blackmagic_source.cpp` (MỚI — code review vòng 3)
- `transport-core/tests/test_channel_actor_io.cpp` (MỚI — code review vòng 2)
- `transport-core/tests/test_actor_crash_isolation.cpp`
- `transport-core/tests/test_srt_loopback_e2e.cpp`
- `transport-core/configs/example_station.json`
- `transport-core/configs/example_center.json`
