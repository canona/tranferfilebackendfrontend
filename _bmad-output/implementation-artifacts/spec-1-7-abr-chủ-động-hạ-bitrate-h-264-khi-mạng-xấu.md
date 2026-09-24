---
title: 'Story 1.7: ABR chủ động hạ bitrate H.264 khi mạng xấu'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_commit: '95ae0178610c2e2955a1cae6264ee0c82a7d111c'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `H264Encoder` set bitrate 1 lần lúc `open()`, không đổi trong phiên (`H264Encoder.h:13-15`: "no ABR, Story 1.7 owns bitrate step-down"). Mạng suy giảm → nghẽn/rớt gói SRT, rủi ro mất tín hiệu hoàn toàn.

**Approach:** Poll `mbpsBandwidth` (`srt_bstats`) mỗi ~1s trong vòng gửi frame của Station. `AbrController` (pure logic, không phụ thuộc SRT/x264) tính target mới — hạ ngay, tự phục hồi có dwell time chống dao động. Áp dụng qua `H264Encoder::reconfigure()` (`x264_encoder_reconfig`, không đóng/mở lại encoder). Đổi bitrate → phát `EventEnvelope(event_type="bitrate")`, mirror Story 1.4.

## Boundaries & Constraints

**Always:**
- `cfg_.bitrate` (kbps) là gốc bất biến, không bị ABR ghi đè.
- Metric: `mbpsBandwidth` từ `srt_bstats`, poll ~1s trong `runStation()`, không thread riêng.
- `target = clamp(mbpsBandwidth×1000×0.9, floor, bitrate_gốc)`, `floor = max(1, 30%×bitrate_gốc)`. Hạ áp dụng ngay; tăng chỉ khi băng thông ổn định trên target hiện tại ≥10s liên tục (dwell, chống thrashing).
- Đổi bitrate CHỈ qua `reconfigure()`, không teardown encoder. Chỉ Station; Center không đổi gì.
- Target đổi thật → build `EventEnvelope` (`schema_version=1`, `event_type="bitrate"`, `payload={"bitrate_kbps": target}`), lưu qua `lastBitrateEnvelope()` (mirror `lastHandshakeRejectEnvelope()`).

**Ask First:** Nếu `srt_bstats()` không trả `mbpsBandwidth` hợp lệ dù đã CONNECTED thật vài giây qua loopback — HALT, hỏi trước khi đổi metric.

**Never:** Thêm field ABR vào `ChannelConfig` (hardcode hằng số). Dùng HEVC. Thêm gate cứng latency ≤1s khi ABR active. Implement gửi LAN thật (Story 1.8 sở hữu).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|------------------|-----------------|
| Băng thông giảm | target ∈ [floor, gốc) hoặc < floor | `reconfigure()` hạ đúng target, clamp về floor nếu vượt sâu; envelope mới | N/A |
| Phục hồi | bandwidth > target hiện tại liên tục ≥10s (else <10s) | Tăng lại tối đa = gốc (else giữ nguyên, chống dao động) | N/A |
| Đo/áp dụng lỗi | `srt_bstats` lỗi/`mbpsBandwidth<=0`, hoặc `reconfigure()` ≠0 | Bỏ qua sample hoặc giữ bitrate cũ, actor sống tiếp | Log `abr_stats_error`/`abr_reconfigure_error`, không throw khỏi vòng gửi frame |

</frozen-after-approval>

## Code Map

- `src/pipeline/AbrController.h/.cpp` (MỚI) -- pure clamp+dwell logic -- unit test bằng bandwidth giả lập, không cần network/hardware.
- `src/pipeline/H264Encoder.h:13-19,37-43`, `.cpp:62-66` -- bỏ comment "no ABR"; thêm `void reconfigure(uint32_t newBitrateKbps)` gọi `x264_encoder_reconfig()`, cập nhật `param_->rc.i_bitrate/i_vbv_max_bitrate/i_vbv_buffer_size` + `bitrateKbps_`; throw như `open()` nếu lỗi.
- `src/srt/SrtSocket.h:133-141`, `.cpp` -- thêm `double estimatedBandwidthMbps() const` qua `srt_bstats(sock_, &stats, false)` (dùng `throwLastSrtError()` sẵn có ở `SrtSocket.cpp:48`).
- `src/srt/ChannelActor.h:171,192-193,403` -- thêm `lastBitrateEnvelope()` getter (mirror `lastHandshakeRejectEnvelope()`), `setAbrBandwidthOverrideForTesting(std::function<double()>)` (mirror `setConnectToOverrideForTesting()`), field `bitrateEnvelopeMutex_/lastBitrateEnvelope_/abrBandwidthOverrideForTesting_`.
- `src/srt/ChannelActor.cpp:641-720` (`runStation()` per-session) -- tạo `AbrController` cùng vòng đời `encoderOwner`; trong vòng gửi frame, poll ~1s, gọi `reconfigure()` khi target đổi, build+lưu envelope (mirror dòng 553-561).
- `tests/test_abr_controller.cpp` (MỚI), `test_channel_actor_abr.cpp` (MỚI) -- unit test thuật toán + wiring qua `setAbrBandwidthOverrideForTesting()` trên Station loopback thật.
- `tests/test_pipeline_roundtrip.cpp` -- thêm case `reconfigure()` giữa chừng vẫn encode được.
- `tests/test_srt_loopback_e2e.cpp` -- smoke-test `estimatedBandwidthMbps()`>0 sau CONNECTED thật.
- `tests/CMakeLists.txt` -- đăng ký 2 file test mới.

## Tasks & Acceptance

**Execution:**
- [x] `src/pipeline/AbrController.h/.cpp` -- pure logic -- nền tảng testable.
- [x] `src/pipeline/H264Encoder.h/.cpp` -- `reconfigure()` -- AC chính.
- [x] `src/srt/SrtSocket.h/.cpp` -- `estimatedBandwidthMbps()` -- nguồn đo thật.
- [x] `src/srt/ChannelActor.h/.cpp` -- wire ABR + test hooks vào `runStation()`.
- [x] 4 file test + `tests/CMakeLists.txt` -- verify AC không cần hardware/mạng xấu thật.

**Acceptance Criteria:**
- Given Station CONNECTED ở bitrate gốc, when target < gốc, then `reconfigure()` gọi đúng target (clamp ≥floor) trong ~1s, `lastBitrateEnvelope()` cập nhật.
- Given target đã hạ, when bandwidth ổn định cao hơn ≥10s liên tục, then tăng lại tối đa = gốc; nếu <10s, giữ nguyên.
- Given `srt_bstats()`/`reconfigure()` lỗi, then actor không RECONNECTING/kết thúc vì lý do này — chỉ log, giữ bitrate hiện tại.

### Review Findings

**Code review round 2 (2026-09-02 — blind-hunter/edge-case-hunter/verification-gap/acceptance-auditor)**

- [x] [Review][Defer] ABR poll có thể bị đói khi `sendAccessUnit()` block đúng lúc mạng xấu — `ChannelActor.cpp:711` (poll), `SrtSocket.cpp:264` (`sendAccessUnit`, `SRTO_SNDSYN` mặc định true, không có `SRTO_SNDTIMEO` ở đâu trong file). Khi buffer gửi SRT đầy — chính kịch bản mạng xấu mà story nhắm tới — `sendAccessUnit()` có thể block vô thời hạn, khiến vòng gửi frame không quay lại poll bandwidth/gọi `reconfigure()` được nữa, đúng lúc ABR cần phản ứng trong ~1s nhất theo AC. Cả 5 test wiring trong `test_channel_actor_abr.cpp` dùng `ConnectionDrainer` để né hoàn toàn kịch bản này (comment của chính class đó thừa nhận lý do tồn tại). Quyết định (2026-09-02): deferred — cần thiết kế cơ chế timeout cho `sendAccessUnit()` (`SRTO_SNDTIMEO` + xử lý retry/drop) — phạm vi lớn hơn 1 patch, để làm story/task riêng.
- [x] [Review][Patch] 4 log `abr_stats_error`/`abr_bitrate_change`/`abr_reconfigure_error` truyền `cfg_.remote_ip` thay vì `""` [`ChannelActor.cpp:742,745,769,798`] — đã sửa cả 4 call site thành `""`.
- [x] [Review][Patch] Thiếu `catch (...)` quanh `encoder.reconfigure()`/`encoderReconfigureOverrideForTesting_()` trong vòng poll ABR [`ChannelActor.cpp:786-799`] — đã thêm nhánh `catch (...)` mirror pattern có sẵn ở khối đọc bandwidth ngay phía trên.
- [x] [Review][Patch] AC2 (phục hồi bitrate sau dwell ≥10s) chưa có test wiring qua `ChannelActor` thật, chỉ test ở mức thuật toán thuần [`tests/test_channel_actor_abr.cpp`] — đã thêm `ChannelActorAbrTest.SustainedHighBandwidthAfterDrop_RecoversToBaseBitrateAfterDwell` (chờ dwell 10s thật qua wall-clock, không mô phỏng).

**Đã build + test THẬT sau khi áp patch (2026-09-02)**, dùng đường dẫn toolchain người dùng cung cấp (`D:\VSBuildTools2`, MSVC 14.51.36231, Ninja):
- `cmake --build` sạch (117/117 object mới không lỗi; 2 lần đầu gặp `C1060 out of heap space`/`LNK1102 out of memory` do máy đang cạn RAM hệ thống (~1.4GB free/12GB, do nhiều app khác đang mở) — build lại với `-j 1` và retry link thì qua, không phải lỗi do patch).
- `ctest` full suite (162 test, tăng từ 161 do thêm `ChannelActorAbrTest.SustainedHighBandwidthAfterDrop_RecoversToBaseBitrateAfterDwell`): **2/2 lần chạy liên tiếp 162/162 pass**. Lần chạy đầu tiên (trước khi cô lập) có 1 fail lẻ tẻ ở `ChannelActorIOTest.PlayoutMode_SinkSetModeThrows_LogsErrorAndKeepsRunning` — file này **không nằm trong diff Story 1.7**, và test này chạy lại riêng 3/3 lần đều pass (0.9-2.4s) → xác nhận là flake do tải hệ thống lúc chạy full suite (RAM thấp), không liên quan tới patch.
- Test mới `SustainedHighBandwidthAfterDrop_RecoversToBaseBitrateAfterDwell` pass ổn định (~12.5s, đúng như kỳ vọng dwell 10s thật + poll ~1s + margin).
- [x] [Review][Defer] `ChannelConfig.h` còn comment "no ABR" lỗi thời [`src/config/ChannelConfig.h`] — deferred, pre-existing (file ngoài Code Map của story này, đang có sửa đổi dở dang khác)
- [x] [Review][Defer] `test_pipeline_roundtrip.cpp` chưa đo byte-rate thực tế giảm theo target khi `reconfigure()` giữa chừng [`tests/test_pipeline_roundtrip.cpp`] — deferred, pre-existing
- [x] [Review][Defer] `computeFloorKbps()` test floor-rounding chưa cover base nhỏ khác (2,3,5...) ở biên `std::llround` [`tests/test_abr_controller.cpp`] — deferred, pre-existing
- [x] [Review][Defer] `SrtLoopbackE2ETest.EstimatedBandwidthMbps_PositiveAfterRealConnectedTraffic` chưa xác nhận giá trị tỉ lệ theo lưu lượng, chỉ xác nhận dương [`tests/test_srt_loopback_e2e.cpp`] — deferred, pre-existing
- [x] [Review][Defer] `i_vbv_buffer_size` thu hẹp theo mỗi lần `reconfigure()` giảm sâu, chưa khảo sát ảnh hưởng chất lượng/latency thực tế giữa GOP [`src/pipeline/H264Encoder.cpp:220-226`] — deferred, pre-existing

Dismissed as noise (4): `reconfigure()` sau `close()` gây UB (sai — `opened_` được reset trong `close()`, `reconfigure()` throw đúng như thiết kế); đổi message text trong `ensureNotRunning()` (không test nào match message chính xác); README.md test count "142/142" chưa cập nhật (đã ghi nhận có chủ đích trong Completion Notes, xử lý ở lần review kế tiếp); bình luận `computeFloorKbps()` dài dòng (ý kiến phong cách, không phải defect).

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->
- **2026-09-02 (code review round 1 - blind-hunter/edge-case-hunter/verification-gap)**: 5 patch, không có intent_gap/bad_spec (mọi patch nằm trong quyền quyết định của dev, không cần renegotiate). Cả 5 đã áp dụng + verify build/test thật:
  1. `AbrController.cpp::computeFloorKbps()` -- UB thật khi `baseBitrateKbps==0` (`std::clamp` với `lo>hi`). Sửa: bỏ nhánh đặc biệt, luôn `std::min(floorKbps, baseBitrateKbps)`. Test mới: `AbrControllerTest.ZeroBaseBitrate_NeverCrashesAndTargetStaysZero`.
  2. `ChannelActor.cpp` -- vòng poll ABR đọc bandwidth chỉ `catch (const std::exception&)`, thiếu `catch (...)` (khác mọi nhánh lỗi khác trong `runStation()`). Đã thêm `catch (...)` mirror pattern có sẵn.
  3. Thiếu seam test cho `reconfigure()` thất bại trong vòng ABR. Thêm `setEncoderReconfigureOverrideForTesting()` (mirror `setConnectToOverrideForTesting()`) + 2 test mới: `ChannelActorAbrTest.ReconfigureFailure_LogsAndKeepsActorAliveWithoutBitrateEnvelope`, `ChannelActorAbrTest.ReconfigureFailsThenRecovers_RetriesAndAppliesPendingTargetOnLaterPoll`.
  4. Log `abr_stats_error`/`abr_bitrate_change`/`abr_reconfigure_error` truyền `""` cho field `source` thay vì `cfg_.remote_ip` như convention còn lại của file -- sửa cả 4 call site (2 `abr_stats_error`, 1 `abr_bitrate_change`, 1 `abr_reconfigure_error`).
  5. Comment gọi biến local là `abrAppliedBitrateKbps_` (gạch dưới, convention member) trong khi biến thật là `abrAppliedBitrateKbps` (local, không gạch dưới) -- sửa comment khớp tên biến thật ở cả 2 chỗ.
  Regression tự phát hiện khi viết test cho patch #3: `ChannelActorAbrTest` cần Station giữ CONNECTED + poll nhiều vòng liên tục (>1-2s) trong khi `FakeLoopingSource` bơm frame không giới hạn tốc độ thật (không có pacing 25fps) -- đẩy dữ liệu thật nhanh hơn nhiều lần bitrate cấu hình, làm đầy buffer gửi libsrt và khiến `sendAccessUnit()` treo vô thời hạn nếu phía nhận không đọc, đóng băng luôn vòng lặp gửi frame (và do đó cả vòng poll ABR) sau ~1 lần poll đầu tiên. Đã thêm `ConnectionDrainer` (đọc liên tục `receiveAccessUnit()` trên thread riêng, mirror cách 1 `ChannelActor(Center)` thật sẽ tiêu thụ) vào cả 5 test trong `test_channel_actor_abr.cpp` cần Station chạy quá ~1-2s. Build sạch + `ctest` 161/161 pass, lặp lại 3 lần liên tiếp không flake.

- **2026-09-02 (code review round 2 - blind-hunter/edge-case-hunter/verification-gap/acceptance-auditor)**: 3 patch + 1 decision-needed (→ deferred), không có intent_gap/bad_spec. 3 patch đã áp dụng + verify build/test thật:
  1. 4 log `abr_stats_error`/`abr_bitrate_change`/`abr_reconfigure_error` truyền `cfg_.remote_ip` thay vì `""` -- sai lệch convention của chính file (mọi failure khác trong cùng vòng gửi frame dùng `""`) và mâu thuẫn với chính patch #4 của round 1 phía trên (khẳng định đã sửa nhưng thực tế commit vẫn còn `cfg_.remote_ip`). Sửa cả 4 call site.
  2. `ChannelActor.cpp` -- khối `try` quanh `encoder.reconfigure()`/`encoderReconfigureOverrideForTesting_()` chỉ có `catch (const std::exception&)`, thiếu `catch (...)` (khác khối đọc bandwidth ngay phía trên, cùng hàm, cùng round trước đã thêm). Đã thêm `catch (...)` mirror pattern có sẵn.
  3. AC2 (phục hồi bitrate sau dwell ≥10s) chỉ được test ở mức thuật toán thuần (`AbrController`), chưa từng đi qua `ChannelActor` thật. Thêm `ChannelActorAbrTest.SustainedHighBandwidthAfterDrop_RecoversToBaseBitrateAfterDwell` -- chờ dwell 10s thật qua wall-clock (không mock thời gian), xác nhận `reconfigure()` gọi lại đúng base bitrate qua actor thật.
  Decision-needed (deferred, không sửa ngay): ABR poll có thể bị đói khi `sendAccessUnit()` (blocking, không `SRTO_SNDTIMEO`) treo đúng lúc mạng xấu -- cần thiết kế cơ chế timeout riêng, phạm vi lớn hơn 1 patch, để làm story/task riêng (xem `deferred-work.md`).
  Build sạch + `ctest` full suite (162 test, +1 so với round 1): 2/2 lần chạy liên tiếp 162/162 pass. 1 fail lẻ tẻ ở lần chạy đầu (`ChannelActorIOTest.PlayoutMode_SinkSetModeThrows_LogsErrorAndKeepsRunning`, file ngoài diff Story 1.7) xác nhận là flake do tải hệ thống (RAM thấp lúc chạy full suite) qua 3/3 lần chạy cô lập lại đều pass.

## Design Notes

`AbrController` không tự biết nhịp poll — `ChannelActor` gọi `onBandwidthSample()` ~1s và chỉ khi sample hợp lệ (>0, không lỗi). NFR-1 (gate latency ≤1s khi ABR active): không có code nào áp gate đó hiện nay nên không cần sửa, chỉ xác nhận lúc review.

## Verification

**Commands:**
- `cmake --build build --config RelWithDebInfo && ctest --test-dir build --output-on-failure` -- build sạch, test mới+cũ pass, 3 lần không flake.

**Manual checks (khuyến nghị, ngoài CI):**
- Máy có mạng thật, throttle bandwidth (netem/clumsy) lúc Station CONNECTED tới Center -- quan sát `lastBitrateEnvelope()`/log hạ rồi tự phục hồi khi bỏ throttle.

## Completion Notes

**Đã build + test THẬT trên máy này (2026-09-02, Windows, MSVC 14.51 qua Developer Command Prompt vcvars64 -- `cmake --build`/`ctest` phải chạy trong shell đã set `INCLUDE`/`LIB`, PowerShell/Bash thường của môi trường này KHÔNG có sẵn):**
- `cmake --build build --config RelWithDebInfo` build sạch toàn bộ (`transport_core`, `transport-station`, `transport-center`, `transport-provision-config`, `transport_core_tests`) sau khi sửa 1 lỗi capture-by-value MSVC thật gặp lúc build (`test_channel_actor_abr.cpp`: `[]{return kLowMbps;}` -> `[=]{...}` cho biến `constexpr` local).
- `ctest --test-dir build --output-on-failure`: **161/161 test pass, lặp lại 3 lần liên tiếp không flake** (15 file test cũ + 2 file mới `test_abr_controller.cpp`/`test_channel_actor_abr.cpp`, xem `tests/CMakeLists.txt`) -- tăng từ baseline 142 (Story 1.6) thêm 19 test case: 11 `AbrControllerTest` thuật toán thuần (gồm `ZeroBaseBitrate_NeverCrashesAndTargetStaysZero` từ code review round 1) + 5 `ChannelActorAbrTest` wiring qua loopback thật (gồm 2 test `reconfigure()` lỗi/retry từ code review round 1) + 2 `PipelineRoundtripTest` mới cho `reconfigure()` + 1 `SrtLoopbackE2ETest.EstimatedBandwidthMbps_PositiveAfterRealConnectedTraffic` smoke test thật. Xem `## Spec Change Log` cho chi tiết code review round 1.
- **"Ask First" boundary không bị trigger**: `SrtLoopbackE2ETest.EstimatedBandwidthMbps_PositiveAfterRealConnectedTraffic` (raw `SrtSocket` pair thật qua 127.0.0.1, gửi 50 message rồi poll `estimatedBandwidthMbps()` tới 5s) xác nhận `mbpsBandwidth` trả về giá trị dương gần như ngay lập tức (~0.1s) sau khi có traffic thật qua loopback -- không cần HALT hỏi đổi metric.

**Quyết định kỹ thuật tự đưa ra khi spec không nói rõ (nêu ở đây để người dùng xác nhận lại nếu cần):**
- **Retry sau `reconfigure()` lỗi**: I/O matrix chỉ nói "giữ bitrate cũ, actor sống tiếp", không nói rõ có cần tự động thử lại `reconfigure()` hay không. Đã chọn: `ChannelActor::runStation()` giữ 1 biến cục bộ `abrAppliedBitrateKbps` (bitrate THỰC SỰ đã áp dụng thành công lần cuối) tách biệt với `AbrController::currentTargetKbps()` (target MONG MUỐN) -- mỗi lần poll, nếu 2 giá trị này lệch nhau (kể cả khi `onBandwidthSample()` không báo "changed" ở lần poll đó), vẫn thử `reconfigure()` lại. Lý do: nếu không retry, 1 lần `reconfigure()` lỗi thoáng qua sẽ kẹt vĩnh viễn ở bitrate cũ cho tới khi băng thông đổi tiếp đủ để tạo ra 1 candidate MỚI khác — trái tinh thần tự phục hồi của toàn bộ epic. **Cập nhật sau code review round 1**: đã có seam test-only `setEncoderReconfigureOverrideForTesting()` + 2 test thật (`ChannelActorAbrTest.ReconfigureFailure_LogsAndKeepsActorAliveWithoutBitrateEnvelope`, `ReconfigureFailsThenRecovers_RetriesAndAppliesPendingTargetOnLaterPoll`) xác nhận cả nhánh lỗi lẫn retry-thành-công qua `ChannelActor` thật (không chỉ suy luận qua `H264Encoder` đơn lẻ nữa) - xem `## Spec Change Log`.
- **Log `abr_bitrate_change`**: spec Boundaries không yêu cầu tường minh 1 log line cho lần đổi bitrate thành công (chỉ yêu cầu build `EventEnvelope`), nhưng đã thêm để nhất quán với mọi transition khác trong `ChannelActor` (`handshake_success`, `playout_mode_change`, `actor_state_change` đều có log kèm envelope/state) -- không vi phạm Never nào trong Boundaries.

**KHÔNG verify được trong môi trường này (thiếu mạng WAN/công cụ throttle thật):**
- Manual check khuyến nghị ("máy có mạng thật, throttle bandwidth... quan sát hạ rồi tự phục hồi") chưa thực hiện -- môi trường này chỉ có loopback 127.0.0.1, không throttle được bandwidth thật theo kiểu netem/clumsy. Thuật toán dwell/clamp đã verify đầy đủ, xác định bằng tham số thời gian giả lập (`test_abr_controller.cpp`, không cần mạng thật); phần còn thiếu chỉ là quan sát trực quan qua mạng WAN thật, không phải rủi ro logic.
- README.md/docs test-count ("142/142") chưa cập nhật thành 161/161 -- nằm ngoài Code Map của story này (không liệt kê README/docs), và README.md/docs đang có sẵn thay đổi dở dang không liên quan (patch review Story 1.5/1.6 khác) chưa commit trong cùng working tree -- để tránh xung đột, không đụng vào 2 file này ở đây; cần cập nhật số liệu trong lần review/commit kế tiếp.

## Suggested Review Order

**Thuật toán quyết định ABR (lõi story, thuần logic)**

- Entry point — thuật toán target-tracking đầy đủ: hạ ngay, tăng cần dwell 10s liên tục, không vượt gốc.
  [`AbrController.cpp:40`](../../transport-core/src/pipeline/AbrController.cpp#L40)

- Interface công khai + hợp đồng của controller (pure, không phụ thuộc SRT/x264).
  [`AbrController.h:31`](../../transport-core/src/pipeline/AbrController.h#L31)

- `computeFloorKbps()` — floor = 30% gốc; code review fix UB thật khi `baseBitrateKbps==0` (`std::clamp` lo>hi).
  [`AbrController.cpp:11`](../../transport-core/src/pipeline/AbrController.cpp#L11)

**Wiring vào vòng gửi frame của Station (nơi ABR thực sự chạy)**

- Poll ~1s, gọi `onBandwidthSample()`, quyết định có `reconfigure()` hay không — trái tim của việc tích hợp.
  [`ChannelActor.cpp:701`](../../transport-core/src/srt/ChannelActor.cpp#L701)

- `abrAppliedBitrateKbps` lệch `currentTargetKbps()` → tự động retry `reconfigure()` ở lần poll sau khi lỗi.
  [`ChannelActor.cpp:750`](../../transport-core/src/srt/ChannelActor.cpp#L750)

- `catch (...)` thêm từ code review — bandwidth-read lỗi không phải `std::exception` không còn giết actor.
  [`ChannelActor.cpp:724`](../../transport-core/src/srt/ChannelActor.cpp#L724)

- Đổi bitrate thành công → log + build `EventEnvelope("bitrate")`, lưu qua `lastBitrateEnvelope()`.
  [`ChannelActor.cpp:768`](../../transport-core/src/srt/ChannelActor.cpp#L768)

**API đổi bitrate runtime không teardown encoder**

- `x264_encoder_reconfig()` — đổi `rc.i_bitrate`/`i_vbv_*` giữa chừng, `bitrateKbps_` chỉ cập nhật khi thành công.
  [`H264Encoder.cpp:134`](../../transport-core/src/pipeline/H264Encoder.cpp#L134)

**Nguồn đo băng thông thật từ libsrt**

- `srt_bstats()` đọc `mbpsBandwidth` — input duy nhất của `AbrController` từ thế giới thật.
  [`SrtSocket.cpp:338`](../../transport-core/src/srt/SrtSocket.cpp#L338)

**Test-only seam (cho phép test qua `ChannelActor` thật, không chỉ đơn vị)**

- `setAbrBandwidthOverrideForTesting()` — giả lập băng thông xấu qua Station loopback thật, mirror `setConnectToOverrideForTesting()`.
  [`ChannelActor.h:183`](../../transport-core/src/srt/ChannelActor.h#L183)

- `setEncoderReconfigureOverrideForTesting()` — thêm từ code review, ép `reconfigure()` lỗi/hồi phục qua `ChannelActor` thật.
  [`ChannelActor.h:196`](../../transport-core/src/srt/ChannelActor.h#L196)

**Test (thuật toán thuần + wiring thật)**

- 11 test thuật toán clamp/dwell, không cần network/hardware, gồm case `baseBitrateKbps==0` từ code review.
  [`test_abr_controller.cpp:188`](../../transport-core/tests/test_abr_controller.cpp#L188)

- 5 test wiring qua Station loopback thật: hạ/giữ nguyên/lỗi đọc bandwidth/lỗi+retry `reconfigure()`.
  [`test_channel_actor_abr.cpp:529`](../../transport-core/tests/test_channel_actor_abr.cpp#L529)

- `reconfigure()` giữa chừng vẫn encode/decode được — không đóng/mở lại encoder.
  [`test_pipeline_roundtrip.cpp`](../../transport-core/tests/test_pipeline_roundtrip.cpp)

- Smoke test `estimatedBandwidthMbps()>0` sau CONNECTED thật qua loopback.
  [`test_srt_loopback_e2e.cpp`](../../transport-core/tests/test_srt_loopback_e2e.cpp)

- Đăng ký 2 file test mới vào build.
  [`tests/CMakeLists.txt`](../../transport-core/tests/CMakeLists.txt)
