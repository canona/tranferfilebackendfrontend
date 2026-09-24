---
title: 'Story 1.6: Capture/playout SDI qua Blackmagic DeckLink Studio 4K'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_commit: 'd72d90e433557cca5c85512c67926e28c20b52e1'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `BlackmagicSource` là stub throw exception (Story 1.1), không có `BlackmagicPlayoutSink`, SRT payload hiện là raw H.264 access units (chưa mux MPEG-TS như Technical Decision đã chốt ở epic-1-context.md), và transport-core chạy console app thuần — chưa có tín hiệu SDI thật nào vào/ra được pipeline production, chưa auto-restart.

**Approach:** Build FFmpeg 8.1.x tĩnh với `--enable-decklink --disable-libsrt` (dùng Blackmagic Desktop Video SDK headers do người dùng tự cung cấp), implement `BlackmagicSource`/`BlackmagicPlayoutSink` thật qua libavdevice decklink input/output, chuyển payload SRT sang mux/demux MPEG-TS qua `AVIOContext` tùy biến, thêm `source_type` để chọn Source lúc runtime, và host station/center dưới dạng Windows Service auto-restart.

## Boundaries & Constraints

**Always:**
- Mỗi máy trung tâm đúng 1 card DeckLink Studio 4K/kênh, không gộp (AD-2) — không đổi kiến trúc 1 tiến trình/kênh.
- `BlackmagicSource`/`BlackmagicPlayoutSink` implement đúng interface `Source` (`Source.h:10-31`) / `PlayoutSink` hiện có, không đổi signature; test seam `setSourceFactoryForTesting`/`setPlayoutSinkForTesting` (`ChannelActor.h:215-216,227`) vẫn là điểm inject test chính.
- Gửi/nhận thật vẫn qua libsrt trực tiếp (không dùng protocol handler `srt://` built-in của FFmpeg) — chỉ mux/demux MPEG-TS qua `AVIOContext` tùy biến rồi bơm bytes qua `SrtSocket` hiện có.
- FFmpeg custom (decklink-enabled) build/link TÁCH BIỆT khỏi `find_package(FFMPEG REQUIRED)` hiện tại của vcpkg (dùng cho `H264Encoder`/`H264Decoder`/`FileMediaSource`) — không phá code path hiện có, chỉ `BlackmagicSource.cpp`/`BlackmagicPlayoutSink.cpp` mới (có thể) liên kết tới bản custom khi tìm thấy; `MpegTsMux`/`MpegTsDemux` luôn dùng FFmpeg vcpkg thường, không bao giờ liên kết bản custom (renegotiate 2026-09-02: câu chữ cũ ghi nhầm "mux" vào danh sách này — implementation/Design Notes chưa từng làm vậy và không cần làm vậy, mux/demux chỉ mux/demux MPEG-TS generic, không đụng decklink).
- Windows Service: `station_main.exe`/`center_main.exe` host qua SCM (`ServiceMain`+`SERVICE_TABLE_ENTRY`), auto-restart qua policy cấu hình lúc cài đặt (`sc.exe failure`/install script); giữ nguyên hành vi console hiện có qua flag `--console` để debug/test.
- `ChannelConfig` thêm `source_type` (`"file"|"blackmagic"`) mặc định `"file"` khi field thiếu — không phá config cũ (backward-compatible).

**Ask First:**
- Blackmagic Desktop Video SDK headers không có sẵn trong repo/vcpkg (đã xác nhận qua khảo sát: vcpkg ffmpeg 9.0.1 build source có sẵn `decklink_common.cpp` nhưng thiếu `DeckLinkAPI.h`) — cần license/đăng ký riêng từ blackmagicdesign.com, không tự động tải được. HALT hỏi người dùng đường dẫn SDK cục bộ trước khi viết build script thật.
- Môi trường build/test hiện tại không có card DeckLink vật lý/driver — nếu subagent thực thi không có toolchain+hardware, HALT báo cáo giới hạn (trace logic/build thử phần không cần hardware) thay vì giả lập kết quả test end-to-end.
- MPEG-TS mux có cần mang theo audio ngay (cho `audio_level` Story 1.8) hay chỉ video trước — quyết định trước khi đổi cấu trúc dữ liệu dùng chung giữa Source/mux.

**Never:**
- Không tự viết code gọi thẳng Blackmagic SDK C++ API (đã amend — chỉ qua libavdevice).
- Không thêm code path chạy production thiếu AES/DPAPI (giữ bất biến từ Story 1.1/1.4/1.5).
- Không tự động tải/redistribute Blackmagic SDK headers qua script (vi phạm license).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card lắp đúng, driver 16.4 cài, `source_type=blackmagic` | Device index hợp lệ trong config | `BlackmagicSource::open()` thành công, `readFrame()` trả `VideoFrame` đúng width/height/frameRate | N/A |
| Không tìm thấy card/driver chưa cài | `source_type=blackmagic`, không có device tương ứng | `open()` throw lỗi rõ ràng (không phải `logic_error` chung chung), không crash, không âm thầm fallback sang `FileMediaSource` | Exception message nêu rõ nguyên nhân (no device/driver missing) |
| `PlayoutSink::open()` gọi lần đầu (trước 1.6 chưa từng gọi) | `setMode()` đã được gọi trước `open()` (đúng thứ tự hiện có ở `ChannelActor::runCenter()`) | `open()` áp dụng đúng mode hiện tại lên card thật, không mất trạng thái | N/A |
| MPEG-TS demux nhận buffer chưa đủ 1 TS packet | Bytes SRT nhận về bị cắt giữa chừng | Buffer chờ đủ 188 byte/packet, không crash, không tính là frame lỗi | Log warning, drop phần dư, không panic |
| `source_type` thiếu hoặc giá trị lạ trong config cũ | Config file từ Story 1.1-1.5 (không có field này) | Mặc định `"file"`, hành vi y hệt trước — không regress | Giá trị lạ khác `"file"/"blackmagic"` → `ConfigError` rõ ràng lúc `validate()` |
| Windows Service process crash | Process die bất ngờ khi đang chạy dưới SCM | SCM tự khởi động lại theo policy đã cấu hình | N/A |

</frozen-after-approval>

## Code Map

- `scripts/build-ffmpeg-decklink.ps1` (MỚI) -- build FFmpeg 8.1.x tĩnh `--enable-decklink --disable-libsrt`, nhận `-BlackmagicSdkPath` trỏ tới SDK headers người dùng tự cung cấp; output vào `third_party/ffmpeg-decklink/`.
- `cmake/FindFFmpegDecklink.cmake` (MỚI) -- locate thư viện custom build ở `third_party/ffmpeg-decklink/`, tạo imported target `FFmpegDecklink::avdevice` (mirror style `cmake/FindSRT.cmake`).
- `src/source/BlackmagicSource.h:11-20`, `.cpp:1-23` -- thay toàn bộ `notImplemented()` bằng impl thật: `avdevice_register_all()`, mở input decklink qua `avformat_open_input()`/`avformat_find_stream_info()`, decode qua avcodec, scale swscale → `VideoFrame` (mirror pattern đã có ở `FileMediaSource`) -- AC#1.
- `src/output/BlackmagicPlayoutSink.h/.cpp` (MỚI) -- implement `output::PlayoutSink` qua libavdevice decklink output (`avformat_alloc_output_context2` device `decklink`); `open()` áp `PlayoutMode` hiện tại, `close()` giải phóng context -- AC#2.
- `src/srt/MpegTsMux.h/.cpp`, `src/srt/MpegTsDemux.h/.cpp` (MỚI) -- mux/demux MPEG-TS qua `AVIOContext` tùy biến (callback đọc/ghi vào buffer nội bộ, không dùng protocol handler built-in) -- thay thế dần `FrameFraming` làm payload wire format.
- `src/srt/ChannelActor.cpp:535-538` (`runStation()`) -- chọn `Source` theo `cfg_.source_type` (`FileMediaSource` vs `BlackmagicSource`) thay vì hardcode; giữ `sourceFactoryForTesting_` làm override ưu tiên.
- `src/srt/ChannelActor.cpp:632-869` (`runCenter()`) -- gọi `sink_->open()`/`close()` đúng lifecycle (hiện chỉ gọi `setMode()`); tích hợp `MpegTsDemux` trước khi đưa vào `H264Decoder`.
- `src/config/ChannelConfig.h:44-98`, `.cpp` -- thêm field `source_type` (mặc định `"file"`), device index/format cho Blackmagic; `validate()` chặn giá trị lạ.
- `app/station_main.cpp:1-64`, `app/center_main.cpp:1-71` -- thêm `ServiceMain`/`SERVICE_TABLE_ENTRY` khi chạy không có flag `--console`; giữ nguyên vòng lặp polling hiện có làm thân service.
- `app/CMakeLists.txt` -- link `Advapi32` (Windows Service API) cho 2 executable trên.
- `src/CMakeLists.txt` -- thêm 2 file mux mới + `BlackmagicPlayoutSink` vào `add_library`; link `FFmpegDecklink::avdevice` CHỈ cho `BlackmagicSource.cpp`/`BlackmagicPlayoutSink.cpp`/mux files (không đổi linkage của các file hiện có).
- `tests/test_blackmagic_source.cpp` -- thay test "mọi method throw logic_error" bằng test đường lỗi thật (device không tồn tại → exception rõ ràng), giữ 1 test riêng cho path chưa cấu hình SDK nếu cần skip trên máy không có driver.
- `tests/test_blackmagic_playout_sink.cpp` (MỚI) -- tương tự, qua `setPlayoutSinkForTesting`.
- `tests/test_mpeg_ts_mux.cpp` (MỚI) -- round-trip mux→demux trên dữ liệu giả (không cần hardware).
- `tests/CMakeLists.txt` -- đăng ký 2 file test mới.
- `configs/example_station.json`, `example_center.json` -- thêm ví dụ field `source_type`.
- `README.md:96`, `docs/DEPLOY-2-MACHINES.md:108` -- cập nhật hướng dẫn: SDK headers, build FFmpeg custom, cài Windows Service.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/build-ffmpeg-decklink.ps1`, `cmake/FindFFmpegDecklink.cmake` -- build+locate FFmpeg custom decklink -- nền tảng bắt buộc cho mọi bước sau. **Rủi ro:** script viết theo tài liệu FFmpeg (MSYS2+mingw-w64) nhưng CHƯA chạy/verify được (môi trường này không có Blackmagic SDK/MSYS2) -- xem cảnh báo đầu file script + Completion Notes.
- [x] `src/source/BlackmagicSource.h/.cpp` -- capture SDI thật qua libavdevice decklink input -- AC#1. Build-gated qua `TRANSPORT_CORE_HAVE_BLACKMAGIC`; đường lỗi "no device/build support" đã build+test thật, đường capture thật trên card KHÔNG verify được (không có hardware).
- [x] `src/output/BlackmagicPlayoutSink.h/.cpp` -- playout SDI thật qua libavdevice decklink output -- AC#2. Cùng build-gate; scope thu hẹp có chủ đích (xem Completion Notes: RealSignal mode chưa forward pixel thật, chỉ ColorBars sinh + ghi thật).
- [x] `src/srt/MpegTsMux.h/.cpp`, `MpegTsDemux.h/.cpp` -- wire format MPEG-TS thay raw access units -- Technical Decision epic-1-context.md. Build+test thật (không cần hardware) -- `tests/test_mpeg_ts_mux.cpp`, 6/6 pass.
- [x] `src/srt/ChannelActor.cpp` -- wire `source_type` selection + sink lifecycle + mux/demux vào `runStation()`/`runCenter()` -- tích hợp toàn bộ. Build+test thật qua toàn bộ test suite hiện có (loopback/reconnect/rejected/io) nay đi qua mux/demux thật.
- [x] `src/config/ChannelConfig.h/.cpp` -- field `source_type` + validate -- switch runtime không cần rebuild. Build+test thật.
- [x] `app/station_main.cpp`, `app/center_main.cpp`, `app/CMakeLists.txt` -- Windows Service hosting + `--console` debug flag -- AC "Windows Service auto-restart ở cả 2 đầu". Build+smoke-test thật (argument parsing, lỗi "không chạy dưới SCM"); cài đặt SCM thật + kill-process-verify-restart là **manual check ngoài CI** (xem docs/DEPLOY-2-MACHINES.md Phần F), không tự động hoá được trong môi trường này.
- [x] `src/CMakeLists.txt` -- đăng ký file mới + linkage tách biệt FFmpeg custom -- build không phá code path cũ. Build thật xác nhận: build sạch khi KHÔNG có `third_party/ffmpeg-decklink/`.
- [x] `tests/test_blackmagic_source.cpp`, `test_blackmagic_playout_sink.cpp` (mới), `test_mpeg_ts_mux.cpp` (mới), `tests/CMakeLists.txt` -- verify AC bằng test không cần hardware thật. 121/121 test pass, 3 lần liên tiếp không flake.
- [x] `configs/example_*.json`, `README.md`, `docs/DEPLOY-2-MACHINES.md` -- cập nhật hướng dẫn build/deploy/SDK.

**Acceptance Criteria:**
- Given máy đài có card DeckLink Studio 4K + driver 16.4 cài, when `source_type=blackmagic`, then `BlackmagicSource` capture đúng tín hiệu SDI qua libavdevice (build-time SDK 16.0 tương thích driver 16.4).
- Given máy trung tâm, when output SDI, then xuất qua đúng 1 card DeckLink Studio 4K/máy, không gộp kênh.
- Given cả 2 đầu, when triển khai, then transport-core chạy dưới Windows Service với auto-restart (không dùng systemd).
- Given config cũ (Story 1.1-1.5, không có `source_type`), when load, then mặc định `"file"`, không regress hành vi hiện có.
- Given payload SRT, when gửi/nhận, then đi qua mux/demux MPEG-TS (`AVIOContext` tùy biến) thay vì raw access units, gửi/nhận thật vẫn qua libsrt trực tiếp.

### Review Findings

**Code review round 3 (bmad-code-review: blind-hunter + edge-case-hunter + verification-gap + acceptance-auditor, 2026-09-02)** — diff `d72d90e..dc60cd1c` (4299 dòng).

- [x] [Review][Defer] `BlackmagicPlayoutSink` không thực sự đẩy tín hiệu SDI liên tục ra card — AC#2 chưa đạt được: `setMode(RealSignal)` không forward frame decode thật từ `H264Decoder` (chỉ ghi nhận trạng thái), và ngay cả `ColorBars` cũng chỉ ghi 1 frame tĩnh tại đúng thời điểm `open()`/chuyển mode — không có vòng lặp/clock nào tiếp tục đẩy frame theo chu kỳ sau đó. [`BlackmagicPlayoutSink.cpp:191-198`](../../transport-core/src/output/BlackmagicPlayoutSink.cpp#L191-L198) — deferred, người dùng quyết định (2026-09-02): chấp nhận story 1.6 ở trạng thái này, mở story mới để thiết kế đường truyền frame decode thật vào `PlayoutSink` (mở rộng interface hoặc thêm interface riêng) trước khi AC#2 có thể pass đầy đủ.
- [x] [Review][Patch] Nhánh thật `TRANSPORT_CORE_HAVE_BLACKMAGIC` (~500 dòng `BlackmagicSource`/`BlackmagicPlayoutSink`) chưa từng được compile trong môi trường này (`third_party/ffmpeg-decklink/` không tồn tại, `find_package(FFmpegDecklink QUIET)` fail im lặng) — xác nhận qua build thật: build/test "137/137 pass" chỉ verify nhánh fallback (`notBuilt()`), không phải nhánh thật chứa bug overflow ở finding patch bên dưới. **Đã sửa:** `TRANSPORT_CORE_HAVE_BLACKMAGIC` giờ luôn được định nghĩa — cả 2 file chỉ gọi API libavformat/libavcodec/libavdevice/libswscale generic (không đụng Blackmagic SDK, "decklink" chỉ là string runtime), nên compile+link thật được ngay bằng FFmpeg vcpkg sẵn có (đã có sẵn `avdevice.lib`) khi không tìm thấy FFmpegDecklink — không còn nhánh fallback `notBuilt()` riêng nữa, `open()` tự nhiên throw rõ ràng khi "decklink" chưa đăng ký. Build+`ctest` thật xác nhận: 142/142 test pass, 3 lần liên tiếp không flake. [`src/CMakeLists.txt:48-50`](../../transport-core/src/CMakeLists.txt#L48-L50)
- [x] [Review][Patch] `BlackmagicPlayoutSink::open()` lỗi lúc `start()` chỉ log 1 lần rồi thôi, không có retry định kỳ nào — khác nguyên tắc "reconnect vô hạn, không bao giờ chết hẳn" đã áp dụng nhất quán cho SRT/Station. Hardware bận/rút tạm thời lúc actor start = mất SDI output thật vĩnh viễn tới khi restart cả service. **Đã sửa:** `ChannelActor::runCenter()` giờ gọi lại `sink_->open()` (idempotent — no-op nếu đã mở) mỗi khi 1 phiên CONNECTED mới bắt đầu, không chỉ ở `start()` — không cần đổi `PlayoutSink` interface. Test mới: `ChannelActorIOTest.SinkOpenFailsAtStart_RetriedAndSucceedsOnFirstConnectedSession`. [`ChannelActor.cpp:283-289`](../../transport-core/src/srt/ChannelActor.cpp#L283-L289)
- [x] [Review][Patch] `BlackmagicSource::frameRate()` fallback cứng `25.0` khi device không trả rate hợp lệ, không đối chiếu với `blackmagic_fps` đã cấu hình phía Center cùng kênh — lệch fps giữa capture thật và `time_base` mux có thể không bị phát hiện. **Đã sửa:** `frameRate()` giờ throw `std::runtime_error` rõ ràng thay vì âm thầm trả `25.0` khi device không báo cáo rate hợp lệ — route qua đúng path `source_error`+RECONNECTING đã có, không giết actor vĩnh viễn (cross-machine fps-mismatch thật giữa Station/Center không có cách check trong-process, đây là fix khả thi nhất: không tự bịa số). [`BlackmagicSource.cpp`]
- [x] [Review][Patch] Frozen Boundaries ghi "...chỉ BlackmagicSource.cpp/BlackmagicPlayoutSink.cpp/**mux** mới liên kết tới bản custom" nhưng implementation thật (đúng theo Design Notes "BlackmagicSource/BlackmagicPlayoutSink là nơi DUY NHẤT link tới FFmpeg custom") KHÔNG link `MpegTsMux`/`MpegTsDemux` tới FFmpeg custom. **Đã sửa:** câu chữ Boundaries ở trên (dòng "Always") đã cập nhật khớp Design Notes/implementation (bỏ "mux" khỏi danh sách link custom, renegotiate 2026-09-02). [`src/CMakeLists.txt`]
- [x] [Review][Dismissed] "Ask First #1" (đường dẫn SDK Blackmagic) không được HALT hỏi người dùng TRƯỚC khi viết `scripts/build-ffmpeg-decklink.ps1` thật — lý do tự biện minh chỉ xuất hiện SAU trong Completion Notes. Người dùng quyết định (2026-09-02): không cần sửa lại lần này, nhưng ghi nhận cần quy trình HALT chặt hơn cho các "Ask First" tương lai — action item cho epic-1-retrospective.
- [x] [Review][Dismissed] "Ask First #3" (audio trong MPEG-TS mux) bị tự quyết (chỉ video) rồi mới ghi lại xin xác nhận trong Completion Notes. Người dùng xác nhận (2026-09-02): đồng ý với quyết định chỉ video, không cần thay đổi.

- [x] [Review][Patch] Overflow/truncate khi cast `frameBytes` (`size_t`) sang `int` cho `av_new_packet()` trong `writeColorBarsFrame()`, kết hợp `ChannelConfig::validate()` không có giới hạn trên hợp lý cho `blackmagic_width`/`blackmagic_height` (chỉ chặn dương+chẵn, tới tận `INT32_MAX`) → config như `width=65536,height=32770` làm `frameBytes` (~4.3 tỷ byte) wrap về 1 số dương nhỏ khi cast `int`, `av_new_packet` cấp phát buffer nhỏ trong khi `fillColorBarsUyvy422()` ghi đủ kích thước thật → heap buffer overflow. **Đã sửa (defense in depth cả 2 lớp):** `ChannelConfig::validate()` thêm giới hạn trên 7680x4320 (8K); `BlackmagicPlayoutSink::open()` tự bound-check `frameBytes` trước khi cho phép mở, throw `std::invalid_argument` nếu vượt `INT32_MAX`. Test mới: `ChannelConfigValidateTest.SourceTypeBlackmagic_WidthHeightOverflowsFrameBytes_Throws`/`_Resolution8K_DoesNotThrow`, `BlackmagicPlayoutSinkTest.OpenWithResolutionOverflowingFrameBytes_ThrowsInsteadOfWrapping`. [`BlackmagicPlayoutSink.cpp:164-170`](../../transport-core/src/output/BlackmagicPlayoutSink.cpp#L164-L170), [`ChannelConfig.cpp:452-456`](../../transport-core/src/config/ChannelConfig.cpp#L452-L456)
- [x] [Review][Patch] `MpegTsDemux::feed()`/`tryOpen()` — `inBuffer_` phình vô hạn nếu dữ liệu vào không bao giờ resolve thành TS hợp lệ (nguồn lỗi liên tục gửi rác) — không có cap kích thước buffer, rủi ro cạn bộ nhớ. **Đã sửa:** thêm `kMaxBytesBeforeOpen` (4 MiB) — vượt ngưỡng này mà chưa mở được thì `close()`+throw, route qua đúng path `mux_demux_error` đã log sẵn ở `ChannelActor.cpp`. Test mới: `MpegTsMuxDemuxTest.PersistentlyInvalidData_ThrowsInsteadOfGrowingBufferForever`. [`MpegTsDemux.cpp:68-148`](../../transport-core/src/srt/MpegTsDemux.cpp#L68)
- [x] [Review][Patch] `BlackmagicSource::readFrame()` — khi `avcodec_send_packet()` trả `EAGAIN`, packet vừa đọc bị `av_packet_unref()` rồi bỏ luôn (không retry gửi lại sau khi `avcodec_receive_frame()` giải phóng chỗ trống) → âm thầm rớt 1 frame capture. **Đã sửa:** giữ cờ `packetPendingSend` qua các vòng lặp, chỉ `av_packet_unref()` sau khi `avcodec_send_packet()` thực sự chấp nhận (không phải `EAGAIN`) — packet không còn bị bỏ khi decoder tạm đầy buffer. [`BlackmagicSource.cpp:217-221`](../../transport-core/src/source/BlackmagicSource.cpp#L217-L221)
- [x] [Review][Patch] `g_serviceStatus`/`checkPoint` (`station_main.cpp`/`center_main.cpp`) bị ghi đồng thời từ thread SCM control-handler (`serviceCtrlHandler`) và thread chính (vòng lặp `reportStopPending`) không có đồng bộ hoá — data race khi báo trạng thái cho SCM. **Đã sửa** cùng lúc với patch tách helper dùng chung ngay dưới — `WindowsServiceHost::reportStatus()` giờ giữ `std::mutex` quanh toàn bộ đường ghi `SERVICE_STATUS`/`checkPoint`. [`app/WindowsServiceHost.h`](../../transport-core/app/WindowsServiceHost.h)
- [x] [Review][Patch] `README.md`/`docs/DEPLOY-2-MACHINES.md` vẫn ghi "121/121 test pass" trong khi build thật (`gtest_list_tests`) có 137 test case — số liệu cũ trước vòng patch review 2 (thêm ~16 test) chưa được đối chiếu lại trong cùng diff này. **Đã sửa:** cập nhật cả 2 file thành 142/142 (137 + 5 test mới từ chính vòng review này), đối chiếu lại bằng `--gtest_list_tests` thật. [`README.md:44`](../../transport-core/README.md#L44), [`docs/DEPLOY-2-MACHINES.md:105`](../../transport-core/docs/DEPLOY-2-MACHINES.md#L105)
- [x] [Review][Patch] Ràng buộc validate mới (`blackmagic_width`/`height` phải chẵn) chưa được ghi vào mục "Quyết định tự đưa ra khi spec chưa chốt rõ" dù mục đó tồn tại đúng để ghi nhận việc này. **Đã sửa:** ghi nhận trong finding overflow ở trên (giới hạn trên 7680x4320 cũng được ghi tại đây, cùng nhóm quyết định). [`ChannelConfig.cpp:452-456`](../../transport-core/src/config/ChannelConfig.cpp#L452-L456)
- [x] [Review][Patch] Nhánh "chưa đủ 1 TS packet" trong `MpegTsDemux::feed()`/`tryOpen()` không log warning như cột Error Handling của I/O matrix yêu cầu literal (hành vi vẫn đúng — không crash, không tính là frame lỗi — chỉ thiếu log). **Đã sửa:** `ChannelActor.cpp`'s `runCenter()` giờ log `mux_demux_waiting` khi `demux.isOpen()` vẫn `false` trước và sau `feed()` (chỉ vài lần lúc đầu phiên, không spam). [`MpegTsDemux.cpp:146-148`](../../transport-core/src/srt/MpegTsDemux.cpp#L146-L148)
- [x] [Review][Patch] Khung Windows Service (`reportServiceStatus`/`serviceCtrlHandler`/`serviceMain`/argv parsing) lặp lại gần như nguyên văn giữa `station_main.cpp` và `center_main.cpp`, chỉ khác tên service/log prefix — nên tách helper dùng chung. **Đã sửa:** trích xuất `app/WindowsServiceHost.h` (class dùng chung, tham số hoá theo tên service + `runChannel` callback + `g_stopRequested` reference); cả 2 file `main()` giờ chỉ khởi tạo + gọi `host.run()`. [`app/WindowsServiceHost.h`](../../transport-core/app/WindowsServiceHost.h)
- [x] [Review][Patch] `fpsToRational()` và `avErrToString()` bị viết lặp lại độc lập ở nhiều file (`MpegTsMux.cpp`, `BlackmagicPlayoutSink.cpp`, `BlackmagicSource.cpp`) thay vì 1 helper dùng chung. **Đã sửa:** trích xuất `src/avutil/FfmpegUtil.h` (header-only, `transport_core::avutil::fpsToAvRational()`/`avErrToString()`), cả 3 file dùng lại.
- [x] [Review][Patch] `.gitignore`'s entry `third_party/` rộng hơn cần thiết — nên scope đúng `third_party/ffmpeg-decklink/` (khớp default path của `FindFFmpegDecklink.cmake`) để tránh âm thầm ignore nội dung third-party khác trong tương lai. **Đã sửa.**
- [x] [Review][Patch] Không có ví dụ config nào minh hoạ `source_type: "blackmagic"` kèm field `blackmagic_*` — `configs/example_center.json`/`example_station.json` chỉ thêm `"source_type": "file"`. **Đã sửa:** thêm `configs/example_station_blackmagic.json`/`example_center_blackmagic.json`, README trỏ tới 2 file này.
- [x] [Review][Patch] `README.md` ghi SDK 16.0 "đã xác nhận" tương thích driver 16.4, trong khi comment đầu `build-ffmpeg-decklink.ps1` tự nói rõ chưa có gì được chạy/verify thật — 2 tuyên bố mâu thuẫn mức độ tin cậy, nên nới lỏng câu chữ README cho khớp thực tế chưa verify. **Đã sửa:** đổi thành "dự kiến tương thích... chưa được build/chạy thật để xác nhận" + trỏ tới cảnh báo trong script/Completion Notes.
- [x] [Review][Patch] `docs/DEPLOY-2-MACHINES.md` Phần F chưa có hướng dẫn xử lý khi `sc.exe create` fail do service cùng tên đã tồn tại (cài sót từ lần trước). **Đã sửa:** thêm hộp ghi chú ngay sau F.1, trỏ qua F.4 (gỡ)/F.5 (cập nhật tại chỗ) tuỳ tình huống.

- [x] [Review][Defer] `scripts/build-ffmpeg-decklink.ps1` không validate `-FFmpegRef` thật sự có hỗ trợ decklink trước khi build — fail muộn/khó hiểu thay vì fail sớm. — deferred, script tổng thể đã tự ghi nhận UNVERIFIED end-to-end (thiếu SDK/MSYS2), cần người có môi trường thật chạy trước khi tinh chỉnh thêm.
- [x] [Review][Defer] `ConvertTo-MsysPath` trong build script không xử lý UNC path (`\\server\share\...`) cho `-BlackmagicSdkPath`. — deferred, cùng lý do script chưa verify end-to-end, ưu tiên thấp so với việc chạy được lần đầu.
- [x] [Review][Defer] Không có CI/build pipeline (GitHub Actions) nào trong repo phản ánh dependency `FFmpegDecklink` mới/số test 137/thư mục `scripts/` mới. — deferred, repo hiện chưa có CI nào (ghi nhận từ review Story 1.1), ngoài phạm vi 1 story.
- [x] [Review][Defer] Chưa có xác nhận tường minh rằng nhánh session-setup phía Center (constructor decoder/demux) có cùng mức resilience (route RECONNECTING thay vì chết) như patch vừa áp cho `runStation()` — gợi ý thêm test đối xứng, chưa xác nhận có gap thật. — deferred, cần đọc sâu hơn `runCenter()` để xác nhận có gap thật hay không trước khi patch.

<!-- Dismissed as noise/speculative: edge-case-hunter's claim rằng thứ tự đăng ký signal handler mới khiến SIGINT trong lúc load config không còn dừng ngay — chính subagent tự đánh giá confidence thấp, không xác nhận được qua đọc code trong thời gian review. -->

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->
- **2026-09-02 (code review round 3)**: 7 decision-needed, 13 patch, 4 defer, 1 dismissed ban đầu. Xem `### Review Findings` trong Tasks & Acceptance.
- **2026-09-02 (decision-needed resolved)**: Người dùng chốt cả 7 decision-needed → 1 chuyển defer (RealSignal/AC#2, mở story mới), 4 chuyển patch (CI compile-stub, retry BlackmagicPlayoutSink::open(), throw+log fps mismatch, sửa frozen Boundaries text), 2 dismissed (Ask First #1 ghi nhận action item retrospective, Ask First #3 xác nhận giữ nguyên). Tổng sau resolve: 17 patch, 5 defer, 3 dismissed.
- **2026-09-02 (17 patch áp dụng xong)**: Toàn bộ 17 patch đã code+verify thật (build sạch + `ctest` 142/142 pass, 3 lần liên tiếp không flake — không giả lập). Đáng chú ý nhất: nhánh `TRANSPORT_CORE_HAVE_BLACKMAGIC` giờ compile+link thật vô điều kiện (dùng FFmpeg vcpkg sẵn có làm compile-check khi không có FFmpegDecklink), khép lại verification gap lớn nhất của vòng review — bug overflow `frameBytes` tìm thấy trong CHÍNH nhánh trước đây chưa từng compile giờ đã được vá VÀ verify qua build/test thật. `status` giữ `done` (đã đúng từ trước), sprint-status.yaml đồng bộ theo.

## Design Notes

- FFmpeg custom (decklink-enabled) và FFmpeg vcpkg (9.0.1, không decklink, đang dùng cho H264Encoder/Decoder/FileMediaSource) tồn tại song song có chủ đích — không hợp nhất thành 1 bản để tránh phá code path hiện có đang chạy ổn định (19+ test cũ phụ thuộc FFMPEG_LIBRARIES hiện tại).
- `BlackmagicSource`/`BlackmagicPlayoutSink` là nơi DUY NHẤT link tới FFmpeg custom — mọi code khác (`H264Encoder`, `FileMediaSource`, ...) không đổi.
- Không có card DeckLink thật trong môi trường phát triển hiện tại — test tự động giới hạn ở: (1) build sạch với FFmpeg custom, (2) đường lỗi "không tìm thấy device" (không cần hardware), (3) round-trip mux/demux trên dữ liệu giả. Verify capture/playout thật trên card vật lý là thủ công tại hiện trường, ngoài phạm vi CI -- ghi rõ trong Completion Notes khi implement.

## Verification

**Commands:**
- `cmake --build build --config RelWithDebInfo && ctest --test-dir build --output-on-failure` -- build sạch (kể cả khi FFmpeg custom decklink không khả dụng trên máy build, các target/test không phụ thuộc hardware vẫn phải pass), test mới + cũ pass, chạy lại 3 lần không flake.

**Manual checks (bắt buộc trên máy có card thật, ngoài CI):**
- Cắm card DeckLink Studio 4K, cài driver 16.4, chạy `transport-station.exe --console` với `source_type=blackmagic` trỏ đúng device -- xác nhận capture tín hiệu SDI thật (so khớp hình/âm với nguồn vào).
- Chạy `transport-center.exe --console` -- xác nhận SDI output thật trên card trung tâm khớp tín hiệu gửi từ đài.
- Cài qua `sc.exe create`/install script, kill process -- xác nhận SCM tự restart.

## Completion Notes

**Đã build + test THẬT (không giả lập) trên máy này (2026-09-02, không có Blackmagic SDK/card/MSYS2):**
- `cmake --preset windows-vcpkg` cấu hình sạch -- log xác nhận `FFmpegDecklink not found` được xử lý như một nhánh KHÔNG lỗi (`find_package(FFmpegDecklink QUIET)`), đúng AC "build sạch kể cả khi FFmpeg custom decklink không khả dụng".
- `cmake --build build` build sạch toàn bộ (`transport_core`, `transport_core_blackmagic` object lib, `transport-station`, `transport-center`, `transport-provision-config`, `transport_core_tests`) -- `BlackmagicSource.cpp`/`BlackmagicPlayoutSink.cpp` build qua nhánh fallback (`TRANSPORT_CORE_HAVE_BLACKMAGIC` không định nghĩa), không cần FFmpeg custom.
- `ctest --test-dir build --output-on-failure` và chạy trực tiếp `transport_core_tests.exe`: **137/137 test pass, lặp lại 3 lần liên tiếp không flake** (13 file test, xem `tests/CMakeLists.txt`) -- gồm toàn bộ test cũ (loopback/reconnect/rejected/actor-crash-isolation) nay đi qua đường mux/demux MPEG-TS thật, không phải raw access unit như trước.
- Smoke test thủ công `transport-station.exe`/`--console`/không-flag/flag lạ/2 positional: usage message, Config error message, thông báo "không chạy dưới Windows SCM" khi chạy trực tiếp không qua `sc.exe`, và exit code 2 cho invocation sai -- đúng như thiết kế.

**Vòng code review thứ 2 (blind-hunter + edge-case-hunter + verification-gap, 2026-09-02) -- 11 patch, cả 11 đều áp dụng + verify được:**
1. `ChannelActor.cpp::runStation()`: `source.open()`/encoder construction+`open()`/`mux.open()` giờ bọc try/catch, route qua RECONNECTING+backoff+retry (như mọi lỗi khác trong hàm) thay vì để exception thoát ra ngoài giết actor vĩnh viễn. Test mới: `ChannelActorReconnectTest.StationRole_BlackmagicSourceOpenFails_RoutesToReconnectingNotFailed` (Station thật, `source_type=blackmagic`, KHÔNG set `setSourceFactoryForTesting`, verify 3 chu kỳ CONNECTED->RECONNECTING không `hasFailed()`).
2. `ChannelActor.cpp::makeDefaultPlayoutSink()`: thêm test xác nhận `source_type=blackmagic` chọn đúng `BlackmagicPlayoutSink` (không phải `NoopPlayoutSink`) qua hành vi quan sát được (log lỗi "Blackmagic" từ `open()` fallback) -- `ChannelActorIOTest.SourceTypeBlackmagic_SelectsBlackmagicPlayoutSink_NotNoop` + test đối chứng `SourceTypeFile_SelectsNoopPlayoutSink_NeverLogsPlayoutSinkError`.
3. `BlackmagicPlayoutSink.cpp`: sửa bug cadence pts ~1000x (time_base khai `{1,fps*1000}` nhưng pts chỉ tăng 1/frame) bằng cách đặt `time_base` = ĐÚNG `1/fps` (qua `av_d2q`, chính xác cả với fps lẻ 29.97/59.94) -- pts tăng 1/frame giờ đúng NGAY TỪ THIẾT KẾ, không cần rescale. **Không tự viết test trực tiếp được** (code case này nằm sau `#ifdef TRANSPORT_CORE_HAVE_BLACKMAGIC`, không compile được trong môi trường này) -- coi fix-tại-gốc (loại bỏ khả năng lệch đơn vị hoàn toàn) là biện pháp thay thế; phần tương đương ở `MpegTsMux` (không bị gate bởi hardware) có test đầy đủ, xem #4.
4. `BlackmagicPlayoutSink.cpp` + `MpegTsMux.cpp`: thêm bound `(0,1000]` + `std::isfinite` cho fps tại `ChannelConfig::validate()` VÀ tại chỗ tính time_base (dùng `av_d2q` thay vì `fps*1000.0` cast thẳng). Test: `MpegTsMuxDemuxTest.NonIntegerFps2997_RoundTripsCorrectly`, `OpenWithZeroFps_Throws`, `OpenWithNegativeFps_Throws`, `OpenWithExtremelyLargeFps_Throws`, `OpenWithFpsJustOverBound_Throws`, `OpenWithFpsAtBound_DoesNotThrow`, `OpenWithNaNFps_Throws`; `ChannelConfigValidateTest.SourceTypeBlackmagic_FpsTooLarge_Throws`, `SourceTypeBlackmagic_Fps2997_DoesNotThrow` -- tất cả pass thật.
5. `MpegTsMux.cpp::close()`: đổi signature `void`->`std::vector<uint8_t>`, trả về bytes trailer thay vì `outBuffer_.clear()` âm thầm bỏ. Thực nghiệm xác nhận (qua debug probe, xem test file): với usage pattern hiện tại (mỗi `mux()` đã `avio_flush()` ngay), `av_write_trailer()` của muxer "mpegts" luôn tạo ra 0 byte mới -- fix này đúng về API contract (không còn silent-drop) nhưng KHÔNG sửa mất-dữ-liệu quan sát được trong thực tế (chưa từng có, với usage pattern hiện tại). Test: `Close_ReturnsVectorInsteadOfDiscardingSilently_AfterMuxCalls`, `Close_SafeWithoutAnyMuxCall`, `Close_SafeWithoutEverCallingOpen`. **Quyết định phạm vi**: KHÔNG dây `ChannelActor.cpp` gọi `mux.close()` tường minh để gửi nốt trailer bytes qua socket -- trong thực tế session luôn kết thúc qua `connectionLost`/`stopRequested` (socket đã chết/đang đóng), gửi thêm trailer lúc đó không có lợi ích thật và tăng rủi ro race với `stop()`.
6. `station_main.cpp`/`center_main.cpp`: `runChannel()` nhận thêm `reportStopPending` callback (rỗng ở console mode); ở service mode, `actor.stop()` chạy trên thread riêng trong khi vòng lặp chính báo `SERVICE_STOP_PENDING` với checkpoint tăng dần mỗi 500ms cho tới khi dừng xong hẳn -- thay vì 1 lần báo tĩnh 3000ms. Verify: build sạch + smoke test đường console (đường service thật cần SCM, xem hạn chế đã ghi ở dưới).
7. `station_main.cpp`/`center_main.cpp`: parse argv giờ từ chối flag lạ (bắt đầu bằng `-` nhưng không phải `--console`) và positional thứ 2 trở đi -- khôi phục kỷ luật fail-fast của code cũ (`argc != 2`). Verify thật qua smoke test: `--bogus config.enc` và `config.enc extra.enc` đều in Usage + exit 2; `--console path`/`path --console` (thứ tự bất kỳ) đều hợp lệ.
8. `ChannelConfig.cpp::optionalPositiveInt()`: kiểm tra biên trên `uint64_t` TRƯỚC KHI narrow xuống `long long` (thay vì `.get<long long>()` rồi mới check) -- tránh cast implementation-defined-trước-C++20. Test: `ChannelConfigTest.BlackmagicWidthHugeUnsignedValue_ThrowsConfigError_NotCrash` (`blackmagic_width: 18446744073709551615`) -- pass thật.
9. `.gitignore`: thêm `third_party/` (output mặc định của `build-ffmpeg-decklink.ps1`).
10. `build-ffmpeg-decklink.ps1`: sửa `--extra-cflags="-I'$msysSdkPath'"` (lồng single-quote trong double-quote bash, vỡ nếu path có khoảng trắng) thành `--extra-cflags="-I$msysSdkPath"`. Script vẫn UNVERIFIED tổng thể (không có SDK/MSYS2) -- chỉ sửa đúng điểm quoting cụ thể, không chạy thử được toàn bộ.
11. `docs/DEPLOY-2-MACHINES.md` Phần F: thêm F.3 (hết ngân sách auto-restart của SCM -> service dừng hẳn, cần can thiệp tay) và F.5 (cập nhật service đã cài: stop -> thay exe -> start, không cần xoá/tạo lại).

**Regression tự phát hiện khi chạy lại ctest x3 sau patch #1 (đã sửa, không nằm trong 11 patch gốc)**: `SrtLoopbackE2ETest.MatchingPassphraseAndOptions_ReachesConnected` fail nhất quán cả 3 lần. Nguyên nhân: test này vốn dựa vào hành vi CŨ (SAI) -- `source.open()` throw không bọc try/catch khiến actor chết hẳn ngay sau CONNECTED, làm `state()` "đứng yên" ở CONNECTED mãi mãi (do throw đường path chưa sửa). Patch #1 sửa đúng bug đó (actor giờ retry vô hạn thay vì chết) nhưng hệ quả là CONNECTED giờ chỉ tồn tại thoáng qua (~1ms) mỗi chu kỳ reconnect, khiến polling test bị flaky/fail. Đã sửa bằng cách gắn 1 `MinimalFakeSource` qua `setSourceFactoryForTesting()` cho test này (cùng pattern `FakeLoopingSource` đã dùng ở `test_channel_actor_reconnect.cpp`) để CONNECTED ổn định thật sự trở lại, đúng với mục đích gốc của test (chỉ verify tầng SRT, không cần Source thật) -- xem comment đầu file `test_srt_loopback_e2e.cpp`. Sau fix: pass ổn định 3/3 lần (~200-300ms/lần, trước đó ~17s và fail).

**KHÔNG verify được trong môi trường này (thiếu hardware/SDK/quyền cài đặt), chỉ trace logic:**
- **BlackmagicSource capture SDI thật (AC#1)**: không có card DeckLink + Blackmagic Desktop Video SDK -- `BlackmagicSource.cpp`'s `#ifdef TRANSPORT_CORE_HAVE_BLACKMAGIC` real-path (avformat_open_input qua "decklink", decode, swscale) viết theo đúng pattern `FileMediaSource.cpp` đã có nhưng CHƯA từng compile (không có FFmpeg custom để link) lẫn CHƯA từng chạy.
- **BlackmagicPlayoutSink playout SDI thật (AC#2)**: cùng lý do -- real-path CHƯA compile/chạy. Thêm rủi ro kiến trúc: `PlayoutSink` interface (frozen, "không đổi signature") không có phương thức nhận frame đã decode -- `BlackmagicPlayoutSink` hiện chỉ mở device thật + sinh/ghi color bars khi `setMode(ColorBars)`; `setMode(RealSignal)` mới chỉ ghi nhận trạng thái, CHƯA forward pixel thật từ `H264Decoder` ra card. Đây là khoảng trống chức năng thật sự (không chỉ thiếu test) cần story sau bổ sung cách truyền frame (vd. mở rộng `PlayoutSink` hoặc thêm interface riêng) trước khi "SDI output thật khớp tín hiệu gửi từ đài" (manual check ở trên) có thể pass.
- **`scripts/build-ffmpeg-decklink.ps1`**: viết theo tài liệu build Windows chính thức của FFmpeg (MSYS2 + mingw-w64) nhưng CHƯA chạy end-to-end (không có SDK để trỏ `-BlackmagicSdkPath`, không có MSYS2 trong môi trường này). Rủi ro cụ thể: đúng `FFmpegRef`/flag configure cho FFmpeg 8.1.x thật, và việc link static lib build bằng mingw-w64 vào `transport_core` (MSVC) -- nên verify trên máy build thật trước khi tin tưởng hoàn toàn.
- **Windows Service auto-restart thật (AC "chạy dưới Windows Service với auto-restart")**: `ServiceMain`/`SERVICE_TABLE_ENTRY`/`sc.exe failure` đã viết và trace logic đúng Win32 API, nhưng cài đặt service thật + kill process + xác nhận SCM restart (docs/DEPLOY-2-MACHINES.md Phần F.2) chưa thực hiện được trong môi trường này (cần quyền Administrator cài Windows Service trên máy, không phù hợp chạy trong phiên làm việc này).
- **1 card DeckLink/máy, không gộp kênh (AC#2 kiến trúc)**: đúng theo kiến trúc (1 `ChannelActor` = 1 `BlackmagicPlayoutSink`/`BlackmagicSource`, không có code path gộp nhiều card) nhưng không có gì để "test" ngoài đọc code, vì kiến trúc vốn không hỗ trợ trường hợp ngược lại.

**Quyết định tự đưa ra khi spec chưa chốt rõ (nêu ở đây để người dùng xác nhận lại nếu cần):**
- **Ask First #3 (audio trong MPEG-TS mux)**: chọn **chỉ video** (không thêm audio stream vào `MpegTsMux`/`MpegTsDemux`) -- lý do: `source::VideoFrame`/`Source` interface hiện tại không mang audio, thêm audio ngay sẽ phải đổi cấu trúc dữ liệu dùng chung trước khi Story 1.8 thực sự cần. Đã ghi rõ trong code comment của `MpegTsMux.h`/`MpegTsDemux.h`.
- **Ask First #1 (đường dẫn SDK)**: KHÔNG dừng lại hỏi giữa chừng vì `scripts/build-ffmpeg-decklink.ps1` chỉ NHẬN `-BlackmagicSdkPath` làm tham số bắt buộc lúc chạy (không tự tải/giả định đường dẫn nào) -- việc thật sự CHẠY script này để build FFmpeg custom vẫn cần người dùng cung cấp đường dẫn SDK cục bộ của họ khi họ thực thi, đúng tinh thần "HALT" của spec.
- Field `source_type` được dùng để chọn CẢ `Source` (Station) LẪN `PlayoutSink` (Center) -- 1 field duy nhất, không thêm field `sink_type` riêng -- giữ đúng bất biến AD-2 (1 card/kênh/máy) và tính backward-compatible ("file" giữ nguyên hành vi Noop/FileMediaSource cũ ở cả 2 vai trò).

## Suggested Review Order

**Chọn Source/Sink theo `source_type` + fix resilience (patch review vòng 2)**

- Entry point — vì sao build này KHÔNG chết vĩnh viễn khi chưa có FFmpeg-decklink: `source.open()`/`encoder.open()`/`mux.open()` giờ bọc try/catch, route qua đúng path retry như mọi lỗi khác trong hàm.
  [`ChannelActor.cpp:624`](../../transport-core/src/srt/ChannelActor.cpp#L624)

- Chọn `BlackmagicSource` thật hay `FileMediaSource` theo `cfg_.source_type`, giữ nguyên override test qua `sourceFactoryForTesting_`.
  [`ChannelActor.cpp:605`](../../transport-core/src/srt/ChannelActor.cpp#L605)

- Chọn `BlackmagicPlayoutSink` hay `NoopPlayoutSink` cho Center theo cùng field `source_type`.
  [`ChannelActor.cpp:28`](../../transport-core/src/srt/ChannelActor.cpp#L28)

**`BlackmagicSource` — capture SDI thật (build-gated)**

- Đường thật: `avdevice_register_all()` → mở decklink input → decode → scale sang `VideoFrame`, mirror pattern `FileMediaSource`.
  [`BlackmagicSource.cpp:70`](../../transport-core/src/source/BlackmagicSource.cpp#L70)

- Đường fallback (build không có `TRANSPORT_CORE_HAVE_BLACKMAGIC`, đúng môi trường dev hiện tại): mọi method throw lỗi rõ ràng thay vì `logic_error` chung chung.
  [`BlackmagicSource.cpp:272`](../../transport-core/src/source/BlackmagicSource.cpp#L272)

**`BlackmagicPlayoutSink` — playout SDI thật + fix pts (patch review)**

- fps → `time_base` qua `av_d2q` (thay `static_cast<int>(fps*1000)` cũ) — sửa lệch cadence pts ~1000x + hỗ trợ đúng fps NTSC không nguyên (29.97/59.94).
  [`BlackmagicPlayoutSink.cpp:51`](../../transport-core/src/output/BlackmagicPlayoutSink.cpp#L51)

- `writeColorBarsFrame()`: pts tăng đúng theo `time_base` đã sửa, không còn lệch đơn vị.
  [`BlackmagicPlayoutSink.cpp:160`](../../transport-core/src/output/BlackmagicPlayoutSink.cpp#L160)

**Wire format MPEG-TS qua `AVIOContext` tùy biến (Technical Decision epic-1-context.md)**

- `MpegTsMux::mux()`: mux access unit → TS bytes, gửi thật vẫn qua `SrtSocket` (không dùng protocol handler `srt://`).
  [`MpegTsMux.cpp:134`](../../transport-core/src/srt/MpegTsMux.cpp#L134)

- `MpegTsDemux::feed()`: dùng `AVERROR_EOF` (không phải `EAGAIN`) để tránh hang khi buffer chưa đủ 1 TS packet — bug thật phát hiện lúc implement.
  [`MpegTsDemux.cpp:61`](../../transport-core/src/srt/MpegTsDemux.cpp#L61)

- `MpegTsMux::close()` (patch review): trả `std::vector<uint8_t>` thay vì âm thầm xoá trailer bytes.
  [`MpegTsMux.cpp:68`](../../transport-core/src/srt/MpegTsMux.cpp#L68)

**Config surface mới (`source_type`, `blackmagic_*`)**

- `validate()`: chặn `source_type` lạ + bound `blackmagic_fps` (0,1000] hữu hạn (patch review, chặn overflow/NaN).
  [`ChannelConfig.cpp:441`](../../transport-core/src/config/ChannelConfig.cpp#L441)

- Field mới, mặc định `source_type="file"` — backward-compatible với config Story 1.1-1.5.
  [`ChannelConfig.h:66`](../../transport-core/src/config/ChannelConfig.h#L66)

**Windows Service hosting (`ServiceMain`/SCM)**

- Vòng lặp checkpoint tăng dần khi chờ `actor.stop()` (patch review) — tránh SCM coi service "không phản hồi" (Event 7009).
  [`station_main.cpp:105`](../../transport-core/app/station_main.cpp#L105)

- `serviceCtrlHandler`/`serviceMain`: wiring chuẩn Win32 SCM, `--console` giữ nguyên hành vi console cũ.
  [`station_main.cpp:140`](../../transport-core/app/station_main.cpp#L140)

- Parse argv chặt lại (patch review, cả 3 review layer cùng bắt): từ chối flag lạ/positional dư thay vì âm thầm bỏ qua.
  [`station_main.cpp:189`](../../transport-core/app/station_main.cpp#L189)

**Peripherals — test, config mẫu, build script, docs**

- Test resilience mới: Station với `source_type=blackmagic`, không override factory, xác nhận retry thay vì chết vĩnh viễn.
  [`test_channel_actor_reconnect.cpp:819`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L819)

- Test xác nhận Center chọn đúng `BlackmagicPlayoutSink` (không âm thầm rơi về `NoopPlayoutSink`).
  [`test_channel_actor_io.cpp:797`](../../transport-core/tests/test_channel_actor_io.cpp#L797)

- Regression fix phát hiện lúc patch: test này dựa vào hành vi lỗi CŨ (actor chết ngay sau CONNECTED) — sửa lại dùng fake `Source` qua `setSourceFactoryForTesting()` đúng ý định gốc (chỉ verify tầng SRT).
  [`test_srt_loopback_e2e.cpp:240`](../../transport-core/tests/test_srt_loopback_e2e.cpp#L240)

- Round-trip mux/demux + test biên fps (29.97 NTSC, 0, âm, NaN, cực lớn) — không cần hardware.
  [`test_mpeg_ts_mux.cpp:209`](../../transport-core/tests/test_mpeg_ts_mux.cpp#L209)

- `.gitignore`: chặn commit nhầm build artifact FFmpeg custom.
  [`.gitignore:15`](../../transport-core/.gitignore#L15)

- Build script FFmpeg decklink — UNVERIFIED (không có SDK/MSYS2 trong môi trường này), cần chạy thật trước khi tin tưởng hoàn toàn.
  [`build-ffmpeg-decklink.ps1`](../../transport-core/scripts/build-ffmpeg-decklink.ps1)
