---
title: 'Story 1.3: Color bars tự động khi mất kết nối hoàn toàn'
type: 'feature'
created: '2026-09-01'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelActor` (Center role) hiện chỉ đếm frame decode được (`framesDecoded_`) rồi bỏ — không có khái niệm "đầu ra SDI" nào, kể cả ở mức state. Khi mất kết nối SRT hoàn toàn (`RECONNECTING`), không có gì báo hiệu đầu ra phải chuyển sang color bars; khi phục hồi, không có gì tự chuyển lại tín hiệu thật.

**Approach:** Thêm interface `output::PlayoutSink` (mirror `source::Source`) với 2 mode đóng `ColorBars`/`RealSignal`, cùng 1 impl mặc định `NoopPlayoutSink` (chỉ lưu mode, KHÔNG hardware thật — Blackmagic thật là Story 1.6). `ChannelActor` (Center) giữ `sink_` + atomic `playoutMode_` public qua getter. Hook trực tiếp vào 2 điểm đã có sẵn trong `runCenter()`: chuyển `ColorBars` ngay tại `setState(RECONNECTING)`; chuyển `RealSignal` ngay khi decode thành công access unit ĐẦU TIÊN của phiên `CONNECTED` hiện tại (dùng lại `decodedThisCall > 0` đã có — không thêm debounce/ngưỡng N-frame mới).

## Boundaries & Constraints

**Always:**
- Chuyển `playoutMode_` sang `ColorBars` xảy ra CÙNG lúc với `setState(RECONNECTING)` trong `runCenter()` (dòng ~587 hiện tại) — trước bất kỳ backoff sleep nào, không delay.
- "Tín hiệu ổn định" cho phiên `CONNECTED` hiện tại = đã decode thành công ≥1 access unit (`decodedThisCall > 0`) trong phiên đó; access unit lỗi/garbage (nhánh `decode_error` đã có) không tính.
- `playoutMode_` mặc định `ColorBars` từ khi actor khởi tạo (trước khi từng đạt `CONNECTED` lần đầu) — không bao giờ mặc định `RealSignal` khi chưa xác nhận có frame thật.
- Chỉ áp dụng cho `ActorRole::Center`; Station không có khái niệm playout.
- Mỗi chuyển mode phải log qua `logger_` (event_type mới `"playout_mode_change"`, `reason` mô tả nguyên nhân) — theo đúng convention log hiện có của actor.

**Ask First:** Không có — ngưỡng "ổn định" = 1 frame decode thành công là quyết định best-effort của spec (dựa trên `framesDecoded_`/`decodedThisCall` đã có sẵn), có thể chỉnh lại tại checkpoint nếu human muốn ngưỡng khác (debounce/N-frame).

**Never:** Không render pixel color bars thật (không dùng lavfi/`smptebars`, không thêm `avfilter`/`avdevice` vào `vcpkg.json`) và không có Blackmagic decklink output thật — cả 2 đều là Story 1.6; `NoopPlayoutSink` chỉ dựng interface. Không tạo `BlackmagicPlayoutSink` ở story này — chưa có AC nào cần đến, để nguyên cho Story 1.6 tự tạo cùng lúc implement thật (tránh scaffolding suy đoán trước). Không sửa `H264Decoder` để expose `AVFrame`/`VideoFrame` ra ngoài — không cần cho story này. Không áp dụng logic playout cho Station.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chưa từng CONNECTED | Actor vừa `start()`, chưa accept ai | `playoutMode() == ColorBars` | N/A |
| CONNECTED nhưng chưa có frame nào | Handshake xong, chưa nhận access unit hợp lệ | `playoutMode()` vẫn `ColorBars` | N/A |
| Frame thật đầu tiên decode thành công | `decoder.decode()` trả `>0` lần đầu trong phiên | `playoutMode()` chuyển `RealSignal` ngay | N/A |
| Access unit lỗi trước khi có frame thật | Garbage access unit → `decode_error` | `playoutMode()` vẫn `ColorBars` (không tính là "ổn định") | Log `decode_error` như hiện có, không đổi mode |
| Mất kết nối giữa phiên (peer đóng / accept lỗi) | `connectionLost`/`acceptFailed` → `setState(RECONNECTING)` | `playoutMode()` chuyển `ColorBars` ngay, cùng thời điểm state đổi | N/A |
| Reconnect thành công + decode lại được | `CONNECTED` mới, frame đầu tiên decode ok | `playoutMode()` tự chuyển lại `RealSignal`, không thao tác thủ công | N/A |

</frozen-after-approval>

## Code Map

- `transport-core/src/output/PlayoutSink.h` (MỚI) -- interface `PlayoutSink` + `enum class PlayoutMode { ColorBars, RealSignal }`, mirror `source/Source.h`.
- `transport-core/src/output/NoopPlayoutSink.h/.cpp` (MỚI) -- impl an toàn mặc định: lưu mode, không hardware thật; sink mặc định của `ChannelActor` cho tới khi Story 1.6 thay bằng `BlackmagicPlayoutSink` thật (mirror vai trò `FileMediaSource` hiện nay so với `BlackmagicSource`).
- `transport-core/src/srt/ChannelActor.h:153-186` (getters), `:257-291` (members) -- thêm `std::atomic<output::PlayoutMode> playoutMode_{ColorBars}` + `playoutMode()` getter (Center-only, mirror `framesDecoded()`), `std::unique_ptr<output::PlayoutSink> sink_`.
- `transport-core/src/srt/ChannelActor.cpp:30-31` (ctor init `sink_`), `:550` (khai báo cờ `sawFirstFrameThisSession` cạnh `FrameReassembler reassembler;`), `:564-568` (nhánh decode thành công — trigger `RealSignal` lần đầu), `:587` (`setState(RECONNECTING)` — trigger `ColorBars` ngay).
- `transport-core/src/CMakeLists.txt:6-16` -- thêm `output/NoopPlayoutSink.cpp` vào `add_library(transport_core ...)`.
- `transport-core/tests/test_channel_actor_io.cpp:73-222` -- thêm test case theo I/O Matrix, tái dùng helper `makeCenterConfig()`/`makeNoisyFrame()`/pattern poll có sẵn; dùng port mới chưa dùng (vd 40023+).

## Tasks & Acceptance

**Execution:**
- [x] `transport-core/src/output/PlayoutSink.h` -- tạo interface `PlayoutSink`/`PlayoutMode` -- nền tảng abstraction cho cả story này và Story 1.6.
- [x] `transport-core/src/output/NoopPlayoutSink.h/.cpp` -- impl mặc định lưu mode, không hardware -- sink production-safe cho tới 1.6.
- [x] `transport-core/src/srt/ChannelActor.h` -- thêm `playoutMode_`/`playoutMode()`/`sink_` -- expose state cho caller/test.
- [x] `transport-core/src/srt/ChannelActor.cpp` -- wire `sink_`/`playoutMode_` tại CONNECTED-decode-đầu-tiên và RECONNECTING -- hiện thực AC.
- [x] `transport-core/src/CMakeLists.txt` -- đăng ký file `.cpp` mới -- build không thiếu symbol.
- [x] `transport-core/tests/test_channel_actor_io.cpp` -- test toàn bộ I/O Matrix -- verify AC bằng test thật, không chỉ trace logic.

**Acceptance Criteria:**
- Given center `CONNECTED` và đã decode ≥1 frame thật (`RealSignal`), when kết nối SRT chuyển `RECONNECTING` (peer đóng hoặc accept lỗi), then `playoutMode()` chuyển `ColorBars` ngay tại thời điểm `setState(RECONNECTING)`, không chờ backoff/số lần reconnect.
- Given center `RECONNECTING` đang `ColorBars`, when kết nối phục hồi `CONNECTED` và decode thành công access unit đầu tiên của phiên mới, then `playoutMode()` tự động chuyển `RealSignal`, không cần thao tác thủ công.
- Given center chưa từng `CONNECTED` hoặc đã `CONNECTED` nhưng chưa decode được frame nào, then `playoutMode()` luôn là `ColorBars`.

### Review Findings

- [x] [Review][Decision] Diff scope bundles Story 1.2's reconnect state machine với Story 1.3's playout logic, mâu thuẫn với Code Map/"Phạm vi đã implement đúng Code Map, không lệch" — Chưa từng có commit nào trong `transport-core` ngoài "Initial commit" duy nhất, nên diff review này buộc phải phủ toàn bộ working tree chưa commit của cả Story 1.1+1.2+1.3 gộp lại (bao gồm `everConnected`, `connectFailed`/`acceptFailed`, `nextBackoff()`, `sleepInterruptible()`, 3 setter test-only, và `tests/test_channel_actor_reconnect.cpp` 737 dòng — toàn bộ thuộc Story 1.2, đã "done" và đã qua review riêng ở round 1/2 nhưng chưa từng được commit). **Resolved:** đã commit baseline gộp 1.1+1.2+1.3 (`1751bec`) trước khi xử lý patch; từ story sau sẽ commit ngay sau mỗi lần review pass.

- [x] [Review][Patch] `start()` áp dụng reset playout mode (`sink_->setMode()` + `playoutMode_.store()`) vô điều kiện cho cả Station, vi phạm "Chỉ áp dụng cho `ActorRole::Center`"/"Không áp dụng logic playout cho Station" — đồng thời làm sai luôn tiền đề của defer-item hiện có ("Station không bao giờ đụng playoutMode_/sink_") [ChannelActor.cpp:128-133] — **Fixed** (`39e5fdf`): gate cả khối bằng `if (role_ == ActorRole::Center)`.
- [x] [Review][Patch] Việc `start()` reset `playoutMode_`/`sink_` về `ColorBars` khi restart là 1 lần chuyển mode thật (khi run trước đó đã ở `RealSignal`) nhưng không log `"playout_mode_change"` như mọi lần chuyển mode khác trong `runCenter()`, vi phạm "Mỗi chuyển mode phải log qua `logger_`" [ChannelActor.cpp:128-133] — **Fixed** (`39e5fdf`): log khi `previousPlayoutMode != ColorBars`.
- [x] [Review][Patch] Chưa có test xác nhận `playoutMode()`/`sink_` thực sự reset về `ColorBars` sau `stop()`+`start()` lại trên actor đã từng đạt `RealSignal` — đúng kịch bản comment của chính `start()` mô tả [ChannelActor.cpp:120-127, tests/test_channel_actor_io.cpp] — **Fixed** (`39e5fdf`): `PlayoutMode_RestartAfterRealSignal_ResetsToColorBars`.
- [x] [Review][Patch] Chưa có test xác nhận backoff của Station reset về base qua 2 chu kỳ reconnect liên tiếp trong cùng 1 run (test `Backoff_ResetsToBaseAfterSuccessfulReconnect` hiện chỉ cover Center) [tests/test_channel_actor_reconnect.cpp] — **Fixed** (`39e5fdf`): `StationRole_Backoff_ResetsToBaseAfterSuccessfulReconnect_TwoCycles`.
- [x] [Review][Patch] Cả 3 điểm gọi `sink_->setMode()` chỉ `catch (const std::exception&)`, không `catch (...)` — 1 exception non-std::exception từ sink thật (Story 1.6) tương lai vẫn thoát ra `run()`'s outer catch và kết thúc actor, trái với đúng ý định đã ghi trong comment tại chỗ ("not left to escape to run()'s outer catch") [ChannelActor.cpp:128-131, 618-627, 660-664] — **Fixed** (`39e5fdf`): thêm `catch (...)` ở cả 3 điểm.
- [x] [Review][Patch] Precondition "không được gọi khi run thread đang chạy" của `setSourceFactoryForTesting()`/`setBackoffParamsForTesting()`/`advanceBackoffForTesting()` chỉ enforce qua `assert()` — no-op khi NDEBUG, không có fallback runtime-check như đã làm cho phần clamp số backoff [ChannelActor.cpp:43-57,59-73; ChannelActor.h:104-106] — **Fixed** (`39e5fdf`): thêm `throw std::logic_error` bên cạnh `assert()` ở cả 3 hàm.
- [x] [Review][Patch] Chưa có test-only throwing `PlayoutSink` nào để exercise 3 nhánh log `"playout_sink_error"` mới thêm — hiện là dead code vì `NoopPlayoutSink::setMode()` không bao giờ throw [ChannelActor.cpp:128-131, 618-627, 660-664] — **Fixed** (`39e5fdf`): thêm `setPlayoutSinkForTesting()` + `PlayoutMode_SinkSetModeThrows_LogsErrorAndKeepsRunning`.

**Verification sau patch round 2 (2026-09-01):** `cmake --build build --config RelWithDebInfo` sạch; `ctest --test-dir build --output-on-failure` **74/74 pass** (71 cũ + 3 test mới); chạy lại riêng `ChannelActorIOTest`+`ChannelActorReconnectTest` thêm 2 lần nữa (tổng 3 lần) — pass cả 3 lần, không flake.

- [x] [Review][Defer] Trùng lặp cấu trúc nặng giữa `runStation()`/`runCenter()` (scoped-socket / connectFailed-hay-acceptFailed / RECONNECTING / backoff-sleep lặp gần như nguyên văn) [ChannelActor.cpp:239-459 vs 461-680] — deferred, pre-existing (thuộc scope Story 1.2, không phải do hook playout của 1.3 gây ra)
- [x] [Review][Defer] `framesDecoded_` vẫn là 1 counter cộng dồn suốt vòng đời actor dù từ Story 1.2 actor có thể sống qua nhiều phiên CONNECTED/RECONNECTING — không phân biệt được "đang decode tốt" với "đã tích luỹ trước khi treo" [ChannelActor.h, member `framesDecoded_`] — deferred, pre-existing (ngữ nghĩa telemetry thuộc Story 1.8)

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->

## Design Notes

- `PlayoutSink` tách biệt khỏi `ChannelActor` (interface, không phải mode trực tiếp trên actor) vì Story 1.6 cần thay `NoopPlayoutSink` bằng impl thật mà không đụng `ChannelActor`.
- Không cần sửa `H264Decoder` để expose `AVFrame`: chỉ cần `decodedThisCall > 0` đã có sẵn -- giữ scope tối thiểu, không kéo theo thay đổi `vcpkg.json`/FFmpeg feature.
- `sawFirstFrameThisSession` là biến local trong `runCenter()`'s outer `for(;;)` iteration (reset tự nhiên mỗi lần vào lại vòng lặp CONNECTED mới) -- không cần thêm member mới trên actor.

## Verification

**Commands:**
- `cmake --build --preset windows-vcpkg && ctest --preset windows-vcpkg --output-on-failure` -- build sạch, toàn bộ test cũ + mới pass, không flake qua 3 lần chạy.

**Manual checks (if no CLI):** Nếu sandbox không có toolchain: trace logic theo Code Map, đối chiếu từng dòng trong I/O Matrix + Acceptance Criteria; ghi rõ trong Completion Notes là build/test thật chưa chạy trong phiên này.

## Completion Notes

**Implementation (2026-09-01):** Toolchain có sẵn trong sandbox (cmake 4.4.3 tại `C:\Program Files\CMake\bin`, MSVC qua `D:\VSBuildTools2\VC\Auxiliary\Build\vcvars64.bat`, `VCPKG_ROOT=D:\ThucHanhAI\TranferFiles\vcpkg`, ninja qua winget link). Đã build + chạy test thật, không phải trace logic suông.

- `cmake --build build --config RelWithDebInfo` (dùng `build/` đã configure sẵn cho preset `windows-vcpkg`) -- build sạch, không lỗi/warning liên quan thay đổi.
- `ctest --test-dir build --output-on-failure` -- **66/66 test pass**, gồm 5 test mới (`ChannelActorIOTest.PlayoutMode_*`) + toàn bộ 61 test cũ (Story 1.1/1.2 reconnect, crash isolation, lifecycle, loopback e2e, framing, config, logger, pipeline...) không có test nào regress.
- Chạy riêng `-R ChannelActorIOTest` thêm 2 lần nữa (tổng 3 lần) -- pass cả 3 lần, không flake, đúng yêu cầu Verification.

Không dùng preset `--preset windows-vcpkg` trực tiếp (CMakePresets.json's configurePreset ghi đè `binaryDir` giống hệt `build/` đã có sẵn) -- dùng `cmake --build build`/`ctest --test-dir build` tương đương, cùng CMakeCache/toolchain.

**Phạm vi đã implement đúng Code Map, không lệch:** `output/PlayoutSink.h` (interface + `PlayoutMode`), `output/NoopPlayoutSink.h/.cpp` (impl lưu mode, không hardware), `ChannelActor.h` (`playoutMode_` atomic + `playoutMode()` getter + `sink_`), `ChannelActor.cpp` (ctor init `sink_`, `sawFirstFrameThisSession` local trong `runCenter()`, 2 điểm hook: RECONNECTING và decode thành công lần đầu), `CMakeLists.txt` (đăng ký `output/NoopPlayoutSink.cpp`), `tests/test_channel_actor_io.cpp` (5 test mới, port 40023-40027, dùng lại `makeCenterConfig()`/`makeNoisyFrame()` có sẵn).

**Không có gì incomplete/risky đáng kể.** Một điểm đáng ghi chú (không phải thiếu sót, chỉ là quyết định thiết kế theo đúng "Never" của spec): `PlayoutSink::open()`/`close()` được khai báo trên interface (mirror `source::Source`) nhưng KHÔNG được `ChannelActor` gọi ở story này -- đúng như Code Map (chỉ liệt kê ctor init + 2 hook mode), để nguyên cho Story 1.6 quyết định lifecycle thật khi thêm `BlackmagicPlayoutSink`.

**Code review (2026-09-01, 3 layer song song — blind-hunter, edge-case-hunter, verification-gap):** không có finding nào thuộc `intent_gap`/`bad_spec` (không loopback, `review_loop_iteration` giữ nguyên 0). 6 finding `patch` đã áp dụng: (1) sửa assertion yếu trong test `PlayoutMode_ReconnectCycle_...` (match nhầm log của lần chuyển đầu); (2) `start()` giờ reset `playoutMode_`/`sink_` về `ColorBars` mỗi lần restart; (3) cả 2 điểm gọi `sink_->setMode()` được bọc try/catch riêng, log `"playout_sink_error"`, không còn có thể làm chết actor nếu sink thật (1.6) throw; (4) thêm `tests/test_noop_playout_sink.cpp` (4 test unit riêng cho `NoopPlayoutSink`); (5) thêm comment cho `PlayoutSink::close()` xác nhận deferred như `open()`; (6) thêm test `PlayoutMode_AcceptFailedAfterRealSignal_SwitchesToColorBars` che phủ nhánh `acceptFailed` (trước đó chỉ test nhánh `connectionLost`). 4 finding `defer` đã ghi vào `deferred-work.md`. Vài finding `reject` (log lặp lại khi RECONNECTING liên tiếp — khớp convention log đã có từ Story 1.2; race thứ tự atomic vô hại; thiếu `operator<<`/dead-code nhẹ trên `sink_->mode()`) bị bỏ qua vì không phải defect thật hoặc đã khớp convention hiện có.

**Verification sau patch (độc lập, chạy 2 lần bởi implementer + 1 lần bởi orchestrator):** `cmake --build build --config RelWithDebInfo` sạch; `ctest --test-dir build --output-on-failure` **71/71 pass**, không flake.

## Suggested Review Order

**Điểm hook chính: chuyển mode theo state (lõi story)**

- Entry point — `RECONNECTING` kích hoạt `ColorBars` ngay, không chờ backoff; `playoutMode_` vẫn chuyển dù `sink_` thật (1.6) throw.
  [`ChannelActor.cpp:648`](../../transport-core/src/srt/ChannelActor.cpp#L648)

- Nhánh quyết định "tín hiệu ổn định": frame đầu tiên decode thành công của phiên `CONNECTED` mới → `RealSignal`.
  [`ChannelActor.cpp:602`](../../transport-core/src/srt/ChannelActor.cpp#L602)

- Cờ `sawFirstFrameThisSession` reset tự nhiên mỗi phiên `CONNECTED` mới, không cần member mới trên actor.
  [`ChannelActor.cpp:578`](../../transport-core/src/srt/ChannelActor.cpp#L578)

**An toàn khi restart / khi sink thật (1.6) throw (patch từ code review)**

- `start()` reset `playoutMode_`/`sink_` về `ColorBars` — tránh `RealSignal` cũ rò rỉ qua lần chạy mới sau `stop()`/`start()`.
  [`ChannelActor.cpp:120`](../../transport-core/src/srt/ChannelActor.cpp#L120)

- Cả 2 điểm gọi `sink_->setMode()` được bọc try/catch riêng, log `"playout_sink_error"` thay vì làm chết actor.
  [`ChannelActor.cpp:660`](../../transport-core/src/srt/ChannelActor.cpp#L660)

**Playout abstraction (interface + default impl)**

- Interface đóng 2 mode, mirror `source::Source` — nền tảng cho cả story này và Story 1.6.
  [`PlayoutSink.h:10`](../../transport-core/src/output/PlayoutSink.h#L10)

- Impl an toàn mặc định: chỉ lưu mode, không hardware — thay thế bằng `BlackmagicPlayoutSink` thật ở 1.6.
  [`NoopPlayoutSink.cpp:1`](../../transport-core/src/output/NoopPlayoutSink.cpp#L1)

- Getter public cho caller/test, Center-only theo convention `framesDecoded()`.
  [`ChannelActor.h:198`](../../transport-core/src/srt/ChannelActor.h#L198)

**Build & test (peripherals)**

- Đăng ký file `.cpp` mới vào thư viện tĩnh.
  [`CMakeLists.txt:9`](../../transport-core/src/CMakeLists.txt#L9)

- Test riêng cho `NoopPlayoutSink` (mirror `test_blackmagic_source.cpp`).
  [`test_noop_playout_sink.cpp:15`](../../transport-core/tests/test_noop_playout_sink.cpp#L15)

- 6 test theo I/O Matrix qua `ChannelActor` thật (kể cả nhánh `acceptFailed` thêm từ code review).
  [`test_channel_actor_io.cpp:135`](../../transport-core/tests/test_channel_actor_io.cpp#L135)

