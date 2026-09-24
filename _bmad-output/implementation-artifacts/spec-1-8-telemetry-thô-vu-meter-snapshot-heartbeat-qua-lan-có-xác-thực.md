---
title: 'Story 1.8: Telemetry thô + VU meter + snapshot + heartbeat qua LAN có xác thực'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_commit: 'e9540d19b93052c3beabe3cd025be6c0f778fd3d'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelActor` (Center) hiện không gửi bất kỳ dữ liệu giám sát nào ra ngoài SRT (`src/telemetry/` chỉ có `EventEnvelope`, transport thật là placeholder — `EventEnvelope.h:13`, `README.md:122`). Dashboard-backend (Epic 2) chưa có nguồn dữ liệu thô nào để tính trạng thái hiển thị; audio level, snapshot ảnh, heartbeat hoàn toàn chưa tồn tại trong codebase.

**Approach:** Center mở 1 kết nối WebSocket outbound (IXWebSocket, thêm mới qua vcpkg) tới 1 endpoint duy nhất trên dashboard-backend, xác thực bằng `bearer_token`/máy (field mới trên `ChannelConfig`, đi theo whole-file DPAPI encryption sẵn có — mirror Story 1.5). Piggyback trên vòng poll ~1s hiện có (`ChannelActor.cpp:707-712`, mirror ABR Story 1.7): gửi `telemetry` (bitrate, rtt mới từ `SrtSocket::rttMs()`, connection_state, audio_level đo thật). Thêm timer riêng (không thread mới, kiểm tra theo `steady_clock` mỗi vòng poll) cho `snapshot` (~1-2s, JPEG qua ffmpeg MJPEG encoder có sẵn) và `heartbeat` (5s, độc lập connection_state). Audio level đo thật qua audio stream nhúng SDI (`BlackmagicSource` mở thêm audio stream PCM, tính dBFS RMS L/R).

## Boundaries & Constraints

**Always:**
- WS client + toàn bộ logic Story 1.8 chỉ chạy ở `ActorRole::Center`; `runStation()`/ABR không đổi.
- WS reconnect vô hạn khi rớt (mirror triết lý SRT Story 1.2), chạy nền không block vòng gửi/nhận SRT chính, không làm actor `hasFailed()`.
- `ChannelConfig` thêm `bearer_token` (string) + `dashboard_ws_url` (string), đi theo `saveEncrypted()`/`loadFromFile()` DPAPI hiện có; KHÔNG log giá trị `bearer_token` (mirror `Logger` 4-field, không có generic extra-map).
- `SrtSocket` thêm `rttMs() const` qua `srt_bstats()` field `msRTT` — mirror `estimatedBandwidthMbps()` (`SrtSocket.cpp:338`).
- `BlackmagicSource` mở thêm audio stream nếu decklink input có (`av_find_best_stream(..., AVMEDIA_TYPE_AUDIO, ...)`), decode PCM (giả định `pcm_s16le`, decklink chuẩn), tính dBFS RMS mỗi kênh L/R tại mỗi lần poll telemetry. `source_type="file"` hoặc không có audio stream → `audio_level=[-100.0, -100.0]` (sentinel), không throw.
- Snapshot: downscale frame `VideoFrame` đã decode gần nhất + encode JPEG qua `avcodec` MJPEG (đã link sẵn, không thêm vcpkg dep), base64 vào `payload.image_base64`; KHÔNG gửi khi `connection_state != CONNECTED`.
- Toàn bộ envelope mirror pattern `lastBitrateEnvelope()` (mutex + `unique_ptr<EventEnvelope>`, `schema_version=1`, `currentIso8601Utc()`).
- Test-only override seam mirror `setAbrBandwidthOverrideForTesting()`: `setTelemetryWsClientOverrideForTesting()` (fake WS send), `setAudioLevelOverrideForTesting()` — để test qua `ChannelActor` thật không cần dashboard-backend/hardware decklink thật.

**Ask First:**
- Nếu tại máy build thật, decklink audio stream KHÔNG phải PCM (`pcm_s16le`/tương đương) như giả định — HALT, hỏi trước khi thêm decoder khác.
- Nếu vcpkg không có port `ixwebsocket` khả dụng trên môi trường build thật — HALT, hỏi trước khi đổi thư viện.

**Never:** Đổi logic ABR/H264Encoder (Story 1.7 sở hữu). Implement dashboard-backend (Epic 2 sở hữu). Mux audio vào `MpegTsMux`/truyền qua SRT — audio chỉ dùng để đo mức tại chỗ, không phát qua SRT. Áp debounce cho telemetry (debounce là việc của backend, Epic 2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|------------------|-----------------|
| WS mất kết nối | dashboard-backend down/network LAN drop | Actor tiếp tục chạy SRT bình thường; WS tự reconnect vô hạn nền | Log `ws_disconnect`/`ws_reconnect`, không throw khỏi actor |
| Bearer-token sai | Backend reject WS handshake (401/close) | Retry theo backoff giống reconnect, không crash | Log `ws_reject_auth` |
| Không có audio stream | `source_type=file` hoặc decklink không audio | `audio_level=[-100.0,-100.0]`, telemetry vẫn gửi | N/A |
| Mất tín hiệu SDI | `connection_state != CONNECTED` | Snapshot KHÔNG gửi; telemetry + heartbeat vẫn gửi đúng nhịp | N/A |

</frozen-after-approval>

## Code Map

- `src/telemetry/EventEnvelope.h/.cpp` -- đã có, không đổi -- struct/serialize dùng lại nguyên vẹn.
- `src/telemetry/TelemetryWsClient.h/.cpp` (MỚI) -- wrap IXWebSocket, connect/send/reconnect-vô-hạn, xác thực bearer-token qua header -- test qua fake seam, không cần backend thật.
- `src/srt/SrtSocket.h:136-148`, `.cpp:338-344` -- thêm `rttMs() const` (mirror `estimatedBandwidthMbps()`, đọc `stats.msRTT`).
- `src/source/BlackmagicSource.h:64-82`, `.cpp` -- thêm `audioStreamIndex_`, mở/decode audio stream PCM, `readAudioLevelDbfs()` trả `{L,R}` hoặc sentinel.
- `src/source/Source.h` -- thêm hàm ảo `readAudioLevelDbfs()` mặc định trả sentinel (để `FileMediaSource` không cần đổi).
- `src/config/ChannelConfig.h:44-139` -- thêm `bearer_token`, `dashboard_ws_url`; `loadSeedFromFile()`/`saveEncrypted()`/`validate()` cập nhật theo.
- `app/provision_channel_config.cpp` -- thêm nhập `bearer_token` qua flow giống passphrase (không qua argv).
- `src/srt/ChannelActor.h:436-463` -- thêm `lastTelemetryEnvelope()`/`lastSnapshotEnvelope()`/`lastHeartbeatEnvelope()` getters + mutex/member pairs (mirror `lastBitrateEnvelope_`), `TelemetryWsClient` member, override-seam setters.
- `src/srt/ChannelActor.cpp:707-793` (`runStation()` poll) -- piggyback telemetry mỗi ~1s; thêm 2 mốc thời gian độc lập (snapshot ~1-2s, heartbeat 5s) trong cùng vòng lặp, không thread mới; gửi qua `TelemetryWsClient`.
- `vcpkg.json` -- thêm dep `ixwebsocket`.
- `tests/test_telemetry_ws_client.cpp` (MỚI), `tests/test_channel_actor_telemetry.cpp` (MỚI) -- mirror `test_channel_actor_abr.cpp` (`ConnectionDrainer`, `FakeLoopingSource`, override seam).
- `tests/CMakeLists.txt` -- đăng ký 2 file test mới.

## Tasks & Acceptance

**Execution:**
- [x] `src/srt/SrtSocket.h/.cpp` -- `rttMs()` -- nguồn RTT thật.
- [x] `src/source/Source.h`, `src/source/BlackmagicSource.h/.cpp` -- audio stream + `readAudioLevelDbfs()` -- nguồn audio_level thật.
- [x] `src/config/ChannelConfig.h/.cpp`, `app/provision_channel_config.cpp` -- `bearer_token`/`dashboard_ws_url` -- xác thực + endpoint.
- [x] `src/telemetry/TelemetryWsClient.h/.cpp`, `vcpkg.json` -- WS client outbound + reconnect vô hạn -- kênh gửi thật.
- [x] `src/srt/ChannelActor.h/.cpp` -- wire telemetry/snapshot/heartbeat + envelope getters + override seams. **Deviation from Code Map**: wired into `runCenter()`, not `runStation()` — Boundaries ("WS client... chỉ chạy ở ActorRole::Center") and Approach ("Center mở 1 kết nối WebSocket outbound") are explicit and repeated (also in epic-1-context.md: "Mỗi máy trung tâm là client outbound WebSocket"); the Code Map's "ChannelActor.cpp:707-793 (runStation() poll)" line citation is read as "mirror this technique", not a literal insertion point. `bitrate`/`rtt` telemetry read from the Center's own accepted `SrtSocket` (`estimatedBandwidthMbps()`/`rttMs()`); snapshot uses a newly-added `H264Decoder::copyLastDecodedFrame()` (not in original Code Map, needed because decode only happens in `runCenter()`); `audio_level` on Center is read from a best-effort local `BlackmagicSource` instance (reusing `cfg_.blackmagic_device`) constructed only when `source_type=="blackmagic"`, since audio is explicitly measured "tại chỗ" and never crosses the SRT/MpegTsMux boundary. See implementation report for full reasoning and risk flag.
- [x] 2 file test mới (`test_telemetry_ws_client.cpp`, `test_channel_actor_telemetry.cpp`) + `tests/CMakeLists.txt` -- verify AC không cần backend/hardware thật.

**Acceptance Criteria:**
- Given Center CONNECTED tới dashboard-backend qua WS với đúng bearer-token, when vòng poll chạy, then telemetry (`bitrate`,`rtt`,`connection_state`,`audio_level`) gửi mỗi ~1s không debounce, `lastTelemetryEnvelope()` cập nhật.
- Given `connection_state=CONNECTED`, when tới mốc ~1-2s, then snapshot JPEG gửi; given `connection_state!=CONNECTED`, then snapshot không gửi.
- Given actor đang chạy bất kể `connection_state`, when tới mốc 5s, then heartbeat gửi đều đặn.
- Given WS tới dashboard-backend rớt hoặc bearer-token sai, then actor không `hasFailed()`/không ảnh hưởng SRT — chỉ log, tự reconnect vô hạn.
- Given source không có audio (file hoặc decklink không audio stream), then `audio_level` trả sentinel cố định, không throw.

### Review Findings

- [x] [Review][Decision→Patch] Heartbeat không thực sự "độc lập connection_state hoàn toàn" — `listener.accept()` chặn vô hạn khi chưa Station nào từng kết nối, đúng ca heartbeat cần phát hiện nhất ("máy trung tâm chết"); code tự nhận "KNOWN LIMITATION" nhưng "Risk đã biết" mà Suggested Review Order trỏ tới không thực sự tồn tại trong Design Notes. **Quyết định:** chấp nhận rủi ro (thiết kế cấm thread riêng, libsrt 1.5.6 không hỗ trợ timeout cho `accept()`) — bổ sung đúng đoạn "Risk đã biết" vào Design Notes cho khớp với Suggested Review Order; không sửa code. [`ChannelActor.cpp:1360-1372`, spec `## Design Notes`] — ĐÃ ÁP DỤNG: bổ sung đoạn "Risk đã biết" vào Design Notes.
- [x] [Review][Decision→Patch] `BlackmagicSource` mở audio stream + decode audio vô điều kiện ở MỌI instance, kể cả instance capture SDI thật của Station — vi phạm Boundary "Story 1.8 logic chỉ chạy ở ActorRole::Center"; class không có tham số/flag phân biệt vai trò gọi. **Quyết định:** thêm flag gate ở constructor (vd `enableAudioMonitoring`), Station's capture instance (`runStation()`) giữ `false`, Center's `audioMonitorSource_` bật `true`. [`src/source/BlackmagicSource.h/.cpp` `open()`/`readFrame()`, `ChannelActor.cpp` (2 call sites tạo `BlackmagicSource`)] — ĐÃ ÁP DỤNG: thêm `enableAudioMonitoring` (không default, ép mọi call site khai báo rõ), gate audio-probe trong `open()`; build sạch + 201/201 test pass.
- [x] [Review][Patch] `rtt_ms` gửi vào telemetry payload không có guard NaN/range như `bitrate_kbps` (patch #9) — `SrtSocket::rttMs()`/`msRTT` libsrt hợp lệ trả `-1` trước khi có mẫu RTT đầu tiên sau CONNECTED. [`ChannelActor.cpp:602-654`] — ĐÃ ÁP DỤNG.
- [x] [Review][Patch] `ChannelActor::stop()`: `telemetryWsClient_->stop()` không bọc try/catch, không nhất quán với `audioMonitorSource_->close()` ngay bên dưới và với chính kỷ luật try/catch của `start()`. [`ChannelActor.cpp:435-437`] — ĐÃ ÁP DỤNG.
- [x] [Review][Patch] `sws_scale()` không kiểm tra giá trị trả về ở 2 vị trí mới thêm — scale lỗi/1 phần sẽ âm thầm commit/encode frame hỏng thay vì báo lỗi. [`H264Decoder.cpp` decode() ~L359, `SnapshotEncoder.cpp:143`] — ĐÃ ÁP DỤNG (throw khi số dòng scale ra không khớp).
- [x] [Review][Patch] `H264Decoder::decode()`: nhánh snapshot-copy thất bại hoàn toàn im lặng — `catch(...)` nuốt lỗi không log (class không có logger, khác mọi failure path khác của Story 1.8), và frame kích thước lẻ bị loại vĩnh viễn khỏi snapshot cũng không log gì; comment ở `sendSnapshot()` ("nothing decoded yet") gây hiểu nhầm cho ca vĩnh viễn này. [`H264Decoder.cpp` decode(), `ChannelActor.cpp:666-667`] — ĐÃ ÁP DỤNG: thêm `snapshotConversionFailureCount()`/`lastSnapshotConversionError()`, `sendSnapshot()` log lần đầu qua `logger_`.
- [x] [Review][Patch] `stripControlCharsForHeader()` (rào chống CRLF/header-injection cho `bearer_token`) không có unit test trực tiếp nào — nằm trong anonymous namespace, chỉ được phủ gián tiếp. [`TelemetryWsClient.cpp:34`] — ĐÃ ÁP DỤNG: expose ra header + thêm `TelemetryWsClientTest.StripControlCharsForHeader_DropsEveryAsciiControlChar`.
- [x] [Review][Defer] `sws_getContext()` bị gọi lại mỗi frame khi thất bại dai dẳng, lãng phí CPU thay vì thử 1 lần rồi bỏ qua. [`H264Decoder.cpp` decode()] — deferred, pre-existing perf nit, không phải correctness bug
- [x] [Review][Defer] `TelemetryWsClient::send()` không có backpressure/giới hạn hàng đợi gửi khi dashboard-backend xử lý chậm. [`TelemetryWsClient.cpp:131`] — deferred, rủi ro vận hành ở quy mô lớn hơn (Epic 2+), không chặn story này
- [x] [Review][Defer] `pumpForAudioLevelMetering()` giới hạn cứng 64 packet/poll, không có counter cho packet bị driver drop khi audio 48kHz vượt ngưỡng. [`BlackmagicSource.cpp`] — deferred, chỉ verify được trên hardware thật
- [x] [Review][Defer] `ChannelConfig::validate()` cho `dashboard_ws_url` vẫn cho qua giá trị hỏng cấu trúc như `"ws:// "`/`"ws://:::"`. [`ChannelConfig.cpp` validate()] — deferred, tự sửa lỗi qua thất bại kết nối + log, không fatal
- [x] [Review][Defer] Guard NaN/overflow cho `bitrate_kbps` (patch #9) chưa có test/override hook để verify trực tiếp giá trị pathological. [`ChannelActor.cpp` sendTelemetry()] — deferred, logic guard đơn giản đủ tin cậy qua đọc code
- [x] [Review][Defer] `findProvisionExe()` trong test dò 4 đường dẫn tương đối cố định, có thể skip âm thầm ở layout CI khác. [`test_provision_channel_config.cpp:30`] — deferred, đã verify pass ở môi trường build thật hiện tại
- [x] [Review][Patch sau-Done, 2026-09-24] `sendTelemetry()` báo cáo `bitrate_kbps` lên dashboard-backend bằng `SrtSocket::estimatedBandwidthMbps()` (`mbpsBandwidth` — băng thông ƯỚC LƯỢNG khả dụng của đường truyền qua packet-pair probing, đúng ngữ nghĩa cho `AbrController` nhưng KHÔNG phải bitrate đang truyền). Trên localhost/LAN dư băng thông, giá trị này lớn phi lý (dashboard-backend tính `bitrate_pct = bitrate_kbps/baseline_kbps*100` ra ~50485% thay vì số hợp lý gần 100%) — phát hiện khi build/chạy end-to-end thật lần đầu tiên trên máy dev (station+center thật, dashboard-backend thật), ngoài phạm vi 1 code-review round chính thức. Thử sửa sang `mbpsSendRate` (tốc độ GỬI) trước — vẫn sai, vì hàm này chỉ chạy ở `ActorRole::Center` (`pollTelemetryAndHeartbeat()` early-out nếu `role_ != Center`), và Center luôn là bên NHẬN video từ Station nên tốc độ gửi của nó ~0. [`ChannelActor.cpp:625` (gọi), `SrtSocket.h/.cpp` (field đọc)] — ĐÃ ÁP DỤNG: thêm `SrtSocket::actualRecvRateMbps()` đọc field `mbpsRecvRate` (tốc độ NHẬN thực tế), dùng trong `sendTelemetry()` thay `estimatedBandwidthMbps()`; `estimatedBandwidthMbps()`/`mbpsBandwidth` giữ nguyên, vẫn dùng đúng chỗ trong `AbrController` (`ChannelActor.cpp:1131`). Verify: build sạch + 201/201 test pass (`ctest --preset windows-vcpkg`), verify trực tiếp qua WS client thật kết nối `ws://localhost:8081` — `bitrate_pct` sau fix ổn định ~240-250% (phần chênh với 100% do `baseline_kbps` demo trong `channel-registry.json` chưa hiệu chỉnh khớp bitrate thực tế của file test, không phải bug).

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->
- **2026-09-02 (code review round 1 - blind-hunter/edge-case-hunter/verification-gap)**: 16 patch, 1 quyết định người dùng (không phải bad_spec/intent_gap chính thức — xử lý trực tiếp thay vì revert toàn bộ diff, xem lý do bên dưới).
  - **Quyết định (2026-09-02, người dùng xác nhận)**: kiến trúc "Center tự mở `BlackmagicSource` riêng để tự giám sát audio playout của chính nó" (deviation đã ghi ở `## Tasks & Acceptance`) được GIỮ NGUYÊN, không renegotiate. Rủi ro chưa xác minh được (thiết bị DeckLink có hỗ trợ mở đồng thời playout + capture-audio-only trên cùng 1 device index hay không) được CHẤP NHẬN, verify sau qua "Manual checks" trong `## Verification` (mục đã có sẵn: "Có hardware Blackmagic thật... audio_level phản ứng đúng"). Nếu hardware không hỗ trợ, `audio_level` sẽ lại về sentinel im lặng — biết trước, chấp nhận được cho tới khi có hardware thật để verify.
  - **KEEP**: toàn bộ phần WS client (`TelemetryWsClient`), bearer-token/`dashboard_ws_url` trên `ChannelConfig`, snapshot (`SnapshotEncoder` + `H264Decoder::copyLastDecodedFrame()`), heartbeat, `SrtSocket::rttMs()`, và quyết định wiring vào `runCenter()` (không phải `runStation()`) — tất cả đã qua 172+ test thật, không phụ thuộc câu hỏi audio-architecture ở trên, KHÔNG re-derive.
  - 16 patch (bug thật + gap kiểm thử), route lại cho subagent step-03 áp dụng trong 1 lượt, không revert code hiện có:
    1. **[Correctness, cao nhất]** `BlackmagicSource::decodeAudioPacketForLevelMetering()` chỉ được gọi từ bên trong `readFrame()`, nhưng `ChannelActor` không bao giờ gọi `readFrame()` trên `audioMonitorSource_` — audio_level THẬT không bao giờ chạy trên hardware thật, luôn về sentinel giống hệt phương án placeholder đã bị từ chối. Fix: bơm packet audio thật (gọi `readFrame()` định kỳ trên `audioMonitorSource_`, bỏ qua output video, hoặc thêm hàm pump audio-only riêng).
    2. `audioMonitorSource_` mở vô điều kiện khi `source_type=="blackmagic"` kể cả khi `dashboard_ws_url` rỗng (telemetry chưa cấu hình) — thêm guard `!cfg_.dashboard_ws_url.empty()`.
    3. `ChannelConfig::validate()` chấp nhận `wss://` nhưng `ixwebsocket` build với `default-features:false` (không có TLS) — sửa `validate()` chỉ chấp nhận `ws://` cho tới khi TLS thật sự được wire, ghi rõ lý do trong comment.
    4. Zero test coverage cho rule mới của `validate()` (`dashboard_ws_url`/`bearer_token` phải đi cùng nhau, prefix hợp lệ) — thêm test case theo đúng gợi ý của verification-gap review (5 case: thiếu 1 trong 2, scheme sai, wss hợp lệ trước khi patch #3, cả 2 rỗng).
    5. Không có test round-trip `saveEncrypted()`/`loadFromFile()` cho 2 field mới, và không test config cũ (thiếu 2 field, mặc định `""`) vẫn load được — thêm test.
    6. `provision_channel_config.cpp` prompt `bearer_token` mới (gating theo `dashboard_ws_url`, strip BOM/whitespace, xử lý EOF stdin) chưa có test nào, khác hẳn passphrase prompt nó mirror theo — thêm test.
    7. `src/telemetry/SnapshotEncoder.{h,cpp}` không có file test riêng — error path (width/height lẻ, plane thiếu, `maxWidth<=0`) chưa test trực tiếp — thêm file test riêng.
    8. `H264Decoder::decode()` — nếu resize plane Y/U/V ném ngoại lệ giữa chừng, `hasLastDecodedFrame_` không được cập nhật atomic, có thể để lại state "rách" (width/height mới, u/v cũ) — sửa để chỉ set `hasLastDecodedFrame_=true` khi toàn bộ resize/copy thành công.
    9. Cast `bitrateMbps` (double) sang `uint32_t` cho `bitrateKbps` không guard NaN/giá trị âm/vượt phạm vi — UB tiềm ẩn — thêm `std::isfinite`+clamp trước khi cast.
    10. `TelemetryWsClient` build header `Authorization: Bearer <token>` không sanitize ký tự điều khiển (CR/LF) trong `bearer_token` — thêm strip/reject trước khi build header (defense-in-depth, provisioning đã strip lúc ghi nhưng không đảm bảo mọi nguồn ghi config).
    11. `ChannelConfig::validate()` chỉ check prefix `ws://`/`wss://`, chấp nhận cả `"ws://"` trơ trụi không có host — thêm check tối thiểu có nội dung sau `://`.
    12. README.md chưa tài liệu hoá field `dashboard_ws_url`/`bearer_token` mới và flow provisioning bearer-token mới — bổ sung theo đúng pattern README đã dùng cho Story 1.5.
    13. `SrtSocket::rttMs()` không có unit test riêng (khác với `estimatedBandwidthMbps()` nó mirror theo, đã có test) — thêm test.
    14. `ChannelActor::start()` — nếu `TelemetryWsClient`/`audioMonitorSource_` construction/`start()` ném ngoại lệ, exception thoát ra ngoài `start()` thay vì được nuốt best-effort như `sink_`/audio source khác — bọc try/catch, log, tiếp tục.
    15. `sendEnvelope()` — nếu lệnh gửi WS thật ném ngoại lệ, có thể lan ra tận `runCenter()`'s receive loop — bọc try/catch quanh lệnh gửi thật (không chỉ override-for-testing), log và tiếp tục.
    16. `ChannelConfig.h`/README — `source_type=="blackmagic"` trên config Center giờ cũng kích hoạt audio-monitor thật (ý nghĩa field bị overload, chưa ai ghi chú) — thêm comment/doc note giải thích.
  - Dismissed as noise (1): audio monitor chỉ đọc kênh 0/1 (L/R), bỏ qua kênh embedded khác nếu có — đúng theo AC (`audio_level: [L,R]`), không phải defect.
  - **Đã build + test THẬT sau khi áp 16 patch (2026-09-02)**, dùng toolchain người dùng cung cấp (`D:\VSBuildTools2`, MSVC, Ninja, vcpkg tại `D:\ThucHanhAI\TranferFiles\vcpkg`, `ixwebsocket` cài mới thành công qua vcpkg manifest mode):
    - `cmake --build` sạch 27/27 target, không lỗi.
    - `ctest` full suite: **2/2 lần chạy liên tiếp 200/200 pass**, không flaky (bao gồm các test timing thật: dwell 10s, heartbeat 5s×2, poll 1-2s).
    - 1 bug **thứ 17** phát hiện trong lúc verify (không nằm trong 16 patch ở trên, do chính người review phát hiện lúc chạy test thật, không phải từ 3 lớp review tự động): `tests/test_provision_channel_config.cpp`'s `runProvisionTool()` xây dựng chuỗi lệnh 3 tham số có quote (`"exe" "seed" "out"`) truyền cho `_popen()` — trên Windows, `_popen()` chạy qua `cmd.exe /c <chuỗi>`, và cmd.exe chỉ giữ nguyên quote khi TOÀN BỘ chuỗi có ĐÚNG 2 ký tự quote; với 3 tham số quote riêng (6 ký tự quote), cmd.exe rơi vào hành vi legacy: cắt bỏ mù quáng ký tự quote ĐẦU và CUỐI, làm hỏng câu lệnh (`E" "S" "O` thay vì `"E" "S" "O"`) → exe con không bao giờ chạy đúng, exit code 1, không ghi file — 2/3 test mới (patch #6) fail. Đây là bug ở TEST CODE, không phải `provision_channel_config.cpp` (đã verify riêng: chạy trực tiếp qua `.bat`/shell thật đều đúng). Sửa: bọc thêm 1 cặp quote bao toàn bộ chuỗi (`"\"" + innerCmd + "\""`) — lợi dụng đúng cơ chế cắt-quote đó để sau khi cmd.exe cắt cặp quote ngoài cùng, phần còn lại đúng là câu lệnh 3-tham-số nguyên vẹn. Đã verify: 3/3 test `ProvisionChannelConfigTest` pass sau fix.
- **2026-09-24 (patch sau-Done, phát hiện ngoài code-review round — build/chạy end-to-end thật lần đầu trên máy dev)**: 1 patch, xem `### Review Findings` (mục `[Review][Patch sau-Done, 2026-09-24]`) cho chi tiết đầy đủ.
  - `sendTelemetry()` báo cáo `bitrate_kbps` bằng field SRT sai (`mbpsBandwidth` — băng thông ước lượng, không phải throughput thực tế) khiến `bitrate_pct` phía dashboard-backend ra số phi lý (~50485%). Sửa: `SrtSocket` thêm `actualRecvRateMbps()` (field `mbpsRecvRate`), dùng thay `estimatedBandwidthMbps()` trong `sendTelemetry()`; `estimatedBandwidthMbps()` giữ nguyên cho `AbrController`.
  - Build sạch + 201/201 test pass (`ctest --preset windows-vcpkg`); verify trực tiếp qua WS client thật — `bitrate_pct` sau fix ổn định ~240-250%.
  - Commit: `a9c058a` (branch `story-2-2-channel-registry-hot-reload`, transport-core repo) — gộp chung với 1 thay đổi khác không liên quan (nới lỏng `ChannelConfig::loadFromFile()` cho phép fallback JSON plaintext khi decrypt DPAPI thất bại, phục vụ dev/test cục bộ — người dùng xác nhận giữ, không thuộc phạm vi patch note này).

## Design Notes

`TelemetryWsClient` là lớp mỏng bọc IXWebSocket, KHÔNG chứa business logic đo lường — mọi giá trị (bitrate/rtt/audio_level) được `ChannelActor::runStation()` thu thập rồi truyền vào, giống cách `AbrController` tách biệt khỏi wiring ở Story 1.7. 3 mốc thời gian (telemetry ~1s, snapshot ~1-2s, heartbeat 5s) đều là biến `steady_clock::time_point` cục bộ trong cùng vòng lặp hiện có — không thread/timer riêng, mirror nguyên tắc "không thread riêng" đã áp dụng cho ABR poll.

Audio decode giả định decklink trả PCM không nén (`pcm_s16le`) — chuẩn phổ biến của thiết bị SDI capture, nhưng chưa verify trên phần cứng thật của dự án; xem "Ask First".

**Risk đã biết (code review round 2):** `sendHeartbeat()` không thực sự "độc lập connection_state hoàn toàn" trong MỌI trường hợp — `runCenter()`'s `listener.accept()` là lệnh blocking không có timeout (libsrt 1.5.6's `srt_accept()` bỏ qua `SRTO_RCVTIMEO` hoàn toàn, đã confirm qua `srtcore/api.cpp`), nên `pollTelemetryAndHeartbeat()` không tick được khi actor đang ngồi chờ TRONG lệnh `accept()` đó — nghĩa là khi CHƯA từng có Station nào kết nối tới (hoặc Station đã mất kết nối và chưa từng thử lại), heartbeat sẽ không gửi cho tới khi có 1 kết nối SRT tới (thành công hoặc bị handshake reject). Telemetry/heartbeat VẪN gửi đúng nhịp trong mọi backoff sleep khác (RECONNECTING/REJECTED, qua `sleepInterruptible()`) — chỉ riêng ca "ngồi chờ accept() lần đầu/liên tục không ai gọi tới" là chưa cover được. Design Notes cấm dùng thread/timer riêng ("không thread mới") nên fix đúng nghĩa cần chuyển `accept()` sang non-blocking qua SRT epoll (`srt_epoll_wait`) — phạm vi lớn hơn 1 patch của story này. **Quyết định (code review round 2, đã user xác nhận):** chấp nhận rủi ro này cho MVP#1, không sửa code trong story 1.8 — theo dõi lại nếu pilot thực tế cho thấy đây là vấn đề (xem `deferred-work.md`).

## Verification

**Commands:**
- `cmake --build build --config RelWithDebInfo && ctest --test-dir build --output-on-failure` -- build sạch, test mới+cũ pass.

**Manual checks (khuyến nghị, ngoài CI):**
- Có dashboard-backend giả (hoặc `wscat`/script Python) lắng nghe WS thật, xác nhận nhận đúng 3 loại event + envelope hợp lệ trong vài phút chạy liên tục.
- Có hardware Blackmagic thật + nguồn audio SDI thật, xác nhận `audio_level` phản ứng đúng khi có/không có âm thanh (không chỉ sentinel).

## Suggested Review Order

**Vòng poll telemetry/snapshot/heartbeat trên Center (lõi story)**

- Entry point — điểm gọi vòng poll mới mỗi lần `runCenter()` lặp, không thread riêng.
  [`ChannelActor.cpp:1528`](../../transport-core/src/srt/ChannelActor.cpp#L1528)

- Hàm điều phối 3 mốc thời gian độc lập (~1s/~1-2s/5s) trong 1 vòng lặp.
  [`ChannelActor.cpp:710`](../../transport-core/src/srt/ChannelActor.cpp#L710)

- `sendTelemetry()` — gộp bitrate/rtt/connection_state/audio_level, cast an toàn double→uint32_t (patch #9).
  [`ChannelActor.cpp:602`](../../transport-core/src/srt/ChannelActor.cpp#L602)

- `sendSnapshot()` — gate cứng theo `connection_state==CONNECTED`, đọc frame đã decode gần nhất.
  [`ChannelActor.cpp:664`](../../transport-core/src/srt/ChannelActor.cpp#L664)

- `sendHeartbeat()` — độc lập connection_state hoàn toàn; xem "Risk đã biết" trong Design Notes (chặn khi `accept()` chưa có kết nối nào).
  [`ChannelActor.cpp:695`](../../transport-core/src/srt/ChannelActor.cpp#L695)

- `sendEnvelope()` — điểm gửi WS thật duy nhất, bọc try/catch quanh lệnh gửi thật (patch #15).
  [`ChannelActor.cpp:576`](../../transport-core/src/srt/ChannelActor.cpp#L576)

**Audio level thật — điểm review quan trọng nhất (đã sửa bug chết trong review round 1)**

- `readLocalAudioLevel()` — bơm `pumpForAudioLevelMetering()` thật mỗi poll (patch #1: trước đó không bao giờ chạy).
  [`ChannelActor.cpp:534`](../../transport-core/src/srt/ChannelActor.cpp#L534)

- `pumpForAudioLevelMetering()` — audio-only pump, bỏ qua output video, tách biệt khỏi `readFrame()` playout path.
  [`BlackmagicSource.cpp:458`](../../transport-core/src/source/BlackmagicSource.cpp#L458)

- `decodeAudioPacketForLevelMetering()` — decode PCM, tích luỹ RMS dBFS L/R (giả định `pcm_s16le`, xem "Ask First").
  [`BlackmagicSource.cpp:396`](../../transport-core/src/source/BlackmagicSource.cpp#L396)

- `readAudioLevelDbfs()` — drain accumulator, trả sentinel nếu chưa có sample nào.
  [`BlackmagicSource.cpp:486`](../../transport-core/src/source/BlackmagicSource.cpp#L486)

- `audioMonitorSource_` construction — best-effort, gate theo `dashboard_ws_url` không rỗng (patch #2), try/catch không chặn `start()` (patch #14).
  [`ChannelActor.cpp:376`](../../transport-core/src/srt/ChannelActor.cpp#L376)

**Cấu hình `bearer_token`/`dashboard_ws_url` + xác thực**

- `ChannelConfig::validate()` — cặp both-or-neither, chỉ chấp nhận `ws://` (patch #3), yêu cầu host sau scheme (patch #11).
  [`ChannelConfig.cpp:28`](../../transport-core/src/config/ChannelConfig.cpp#L28)

- Provisioning: prompt `bearer_token` qua stdin (không argv), chỉ khi seed có `dashboard_ws_url`.
  [`provision_channel_config.cpp:186`](../../transport-core/app/provision_channel_config.cpp#L186)

**WS client outbound tới dashboard-backend**

- `TelemetryWsClient` — wrap IXWebSocket, `Authorization: Bearer <token>` đã sanitize control-char (patch #10).
  [`TelemetryWsClient.h:44`](../../transport-core/src/telemetry/TelemetryWsClient.h#L44)

- `send()` — no-op khi chưa connected, không debounce, không queue.
  [`TelemetryWsClient.h:80`](../../transport-core/src/telemetry/TelemetryWsClient.h#L80)

- Construction/`start()` của `TelemetryWsClient` trong `ChannelActor::start()` — best-effort, không chặn SRT (patch #14).
  [`ChannelActor.cpp:338`](../../transport-core/src/srt/ChannelActor.cpp#L338)

**Snapshot JPEG**

- `encodeSnapshotJpegBase64()` — downscale + MJPEG (avcodec), toàn bộ error path throw `std::runtime_error` rõ ràng.
  [`SnapshotEncoder.cpp:93`](../../transport-core/src/telemetry/SnapshotEncoder.cpp#L93)

- `H264Decoder::copyLastDecodedFrame()` — commit atomic sau khi resize/copy xong hoàn toàn, tránh state "rách" (patch #8).
  [`H264Decoder.cpp:206`](../../transport-core/src/pipeline/H264Decoder.cpp#L206)

**RTT thật**

- `SrtSocket::rttMs()` — mirror `estimatedBandwidthMbps()`, đọc `msRTT` từ `srt_bstats()`.
  [`SrtSocket.cpp:346`](../../transport-core/src/srt/SrtSocket.cpp#L346)

**Test**

- `test_channel_actor_telemetry.cpp` — 5 test qua `ChannelActor` thật (Center), cover đủ 4 dòng I/O matrix.
  [`test_channel_actor_telemetry.cpp:217`](../../transport-core/tests/test_channel_actor_telemetry.cpp#L217)

- `test_telemetry_ws_client.cpp` — `TelemetryWsClient` qua `ix::WebSocketServer` thật, không mock.
  [`test_telemetry_ws_client.cpp:80`](../../transport-core/tests/test_telemetry_ws_client.cpp#L80)

- `test_snapshot_encoder.cpp` — toàn bộ error path của `SnapshotEncoder` (patch #7).
  [`test_snapshot_encoder.cpp:1`](../../transport-core/tests/test_snapshot_encoder.cpp#L1)

- `test_provision_channel_config.cpp` — chạy exe thật qua subprocess, cover gating/BOM/EOF (patch #6); sửa 1 bug quote-stripping của `_popen()` phát hiện lúc verify (xem Spec Change Log).
  [`test_provision_channel_config.cpp:74`](../../transport-core/tests/test_provision_channel_config.cpp#L74)

- `test_channel_config.cpp` — validate()/round-trip/backward-compat cho `bearer_token`/`dashboard_ws_url` (patch #4, #5).
  [`test_channel_config.cpp:1`](../../transport-core/tests/test_channel_config.cpp#L1)
