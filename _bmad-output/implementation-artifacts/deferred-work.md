## Deferred from: code review of spec-3-2-panel-chi-tiết-kênh-detail-panel (2026-09-12)

- `publishHistoryPoint`'s broadcast loop (`wsUiAdapter.ts`) không try/catch riêng từng client — 1 client throw có thể chặn broadcast tới các client còn lại trong cùng lần gọi. Pre-existing: y hệt pattern ở `publishChannelSeen`/`publishStateChange`/`publishSnapshot`, không mới ở story 3.2; `send()` thực tế không throw đồng bộ khi socket OPEN (lỗi network raise qua event `'error'` bất đồng bộ). [`wsUiAdapter.ts:421-425`]
- `DetailPanel`/`ChannelGridCell`/biểu đồ SVG chưa có focus trap, return-focus khi đóng, hay text alternative đầy đủ cho screen reader — `epic-3-context.md` dòng 25 đã chốt accessibility "hoàn thiện đầy đủ ở Epic 5", story 3.2 chỉ cần Tab+Enter/Space+Esc (đã có, đã test). [`DetailPanel.tsx`, `ChannelGridCell.tsx:194`]
- 1 kênh mới thêm vào registry (hot-reload) sau khi client đã connect sẽ không bao giờ nhận `channel-history-snapshot` của kênh đó cho tới khi client tự reconnect — panel kẹt `loading` vô hạn nếu mở trước reconnect. Pre-existing: toàn bộ adapter (kể cả `registry-snapshot` chính nó) không có cơ chế push-on-registry-change, không riêng story 3.2. [`wsUiAdapter.ts:265-302`]

## Deferred from: code review of story-1-7-abr-chủ-động-hạ-bitrate-h-264-khi-mạng-xấu (2026-09-02)

- ABR poll có thể bị đói khi `sendAccessUnit()` block đúng lúc mạng xấu [`ChannelActor.cpp:711`, `SrtSocket.cpp:264`] — `sendAccessUnit()` là call blocking (`SRTO_SNDSYN` mặc định true, không có `SRTO_SNDTIMEO`), nằm cùng vòng lặp với poll ABR ~1s. Khi buffer gửi SRT đầy (đúng kịch bản mạng xấu), send có thể block vô thời hạn, khiến poll/ `reconfigure()` không chạy được nữa. Cả 5 test wiring dùng `ConnectionDrainer` để né kịch bản này. Lý do defer: cần thiết kế cơ chế timeout cho `sendAccessUnit()` (`SRTO_SNDTIMEO` + xử lý retry/drop) — phạm vi lớn hơn 1 patch, để làm story/task riêng.
- `ChannelConfig.h` còn comment "no ABR" lỗi thời [`src/config/ChannelConfig.h`] — ABR giờ coi field `bitrate` là trần bất biến, comment nói "fixed for Story 1.1 (no ABR)" đã không còn đúng. Ngoài Code Map của Story 1.7 (file đang có sửa đổi dở dang khác chưa commit), không đụng vào ở đây.
- `test_pipeline_roundtrip.cpp` chưa đo byte-rate thực tế giảm theo target khi `reconfigure()` giữa chừng [`tests/test_pipeline_roundtrip.cpp`] — test hiện tại chỉ xác nhận vẫn decode được, chưa xác nhận bitrate encode thực sự đổi theo target mới.
- `computeFloorKbps()` test floor-rounding chưa cover base nhỏ khác (2,3,5...) ở biên `std::llround` [`tests/test_abr_controller.cpp`] — hiện chỉ test base=2000/1000/1.
- `SrtLoopbackE2ETest.EstimatedBandwidthMbps_PositiveAfterRealConnectedTraffic` chưa xác nhận giá trị tỉ lệ theo lưu lượng, chỉ xác nhận dương [`tests/test_srt_loopback_e2e.cpp`].
- `i_vbv_buffer_size` thu hẹp theo mỗi lần `reconfigure()` giảm sâu, chưa khảo sát ảnh hưởng chất lượng/latency thực tế giữa GOP [`src/pipeline/H264Encoder.cpp:220-226`].

## Deferred from: code review of spec-1-8-telemetry-thô-vu-meter-snapshot-heartbeat-qua-lan-có-xác-thực (2026-09-02)

- `sws_getContext()` trong `H264Decoder::decode()` bị gọi lại mỗi frame khi thất bại dai dẳng (pixel format lạ, cấp phát context lỗi...), lãng phí CPU trên hot path thay vì thử 1 lần rồi bỏ qua cho tới lần `open()` kế tiếp. [`H264Decoder.cpp` decode()]
- `TelemetryWsClient::send()` không có backpressure/giới hạn hàng đợi gửi khi dashboard-backend xử lý chậm trong khi socket vẫn báo connected — payload snapshot cỡ lớn gửi mỗi ~1-2s không có giới hạn dữ liệu chưa-ACK tích luỹ. [`TelemetryWsClient.cpp:131`]
- `pumpForAudioLevelMetering()` giới hạn cứng 64 packet/lần poll (~1s) nhưng không có counter/metric đếm packet bị driver âm thầm drop khi audio 48kHz sinh ra nhiều hơn ngưỡng đó — không có cách quan sát mức mất mẫu khi debug độ chính xác `audio_level` trên thực địa. [`BlackmagicSource.cpp`]
- `ChannelConfig::validate()` cho `dashboard_ws_url` chỉ kiểm tra prefix `ws://` + độ dài > 5, vẫn cho qua giá trị hỏng cấu trúc như `"ws:// "` (khoảng trắng) hay `"ws://:::"` — chỉ fail lúc connect WS thật (non-fatal, tự retry + log theo thiết kế). [`ChannelConfig.cpp` validate()]
- Guard NaN/negative/overflow cho `bitrate_kbps` (patch #9, code review round 1) chưa có test/override hook trực tiếp để verify — `sendTelemetry()` luôn đọc `estimatedBandwidthMbps()` thật, không có seam test-only kiểu `setAbrBandwidthOverrideForTesting()` cho nhánh Center. [`ChannelActor.cpp` sendTelemetry()]
- `findProvisionExe()` trong `test_provision_channel_config.cpp` dò 4 đường dẫn tương đối cố định (`app/...`, `../app/...`, `build/app/...`, `./...`); nếu layout CI/ctest khác không khớp candidate nào, 3 test bearer_token-prompt sẽ skip âm thầm thay vì fail — đã verify pass ở môi trường build thật hiện tại (2/2 lần chạy, không skip) nhưng chưa chắc portable sang layout khác. [`test_provision_channel_config.cpp:30`]
- **[Đã user xác nhận chấp nhận rủi ro]** `sendHeartbeat()` không "độc lập connection_state hoàn toàn" khi actor đang ngồi chờ TRONG `listener.accept()` (blocking, libsrt 1.5.6 không hỗ trợ timeout) — chỉ ca "chưa Station nào từng kết nối" không cover được, mọi backoff sleep khác vẫn gửi heartbeat đúng nhịp. Fix đúng nghĩa cần chuyển sang SRT epoll non-blocking — theo dõi lại nếu pilot thực tế (rollout kế hoạch 1 kênh 7 ngày) cho thấy đây là vấn đề thật. [`ChannelActor.cpp:1360-1372`, xem spec Design Notes "Risk đã biết"]

## Deferred from: code review of spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán (2026-09-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: `wsTelemetryAdapter.ts` chưa có connection/rate limiting thật (giới hạn số kết nối đồng thời/IP, throttle số lần bearer-token sai liên tiếp) ngoài `maxPayload` cơ bản.
  evidence: LAN nội bộ (AD-28) giảm rủi ro nhưng không loại trừ actor nội bộ ác ý/misconfigured client spam kết nối hoặc brute-force bearer-token tĩnh dùng chung/máy (AD-13) — cần thiết kế riêng (không phải 1 patch trivial), ngoài scope frozen Boundaries của Story 2.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: dashboard-backend chưa có health-check/readiness HTTP endpoint riêng cho công cụ giám sát ngoài (hiện chỉ có 404 mặc định cho request non-upgrade).
  evidence: Với 1 service chạy 24/7 giám sát 40 máy trung tâm, cần cách kiểm tra "còn sống" không phải qua WS handshake thật — không có trong AC/Boundaries của Story 2.1, nên để story sau (có thể gộp cùng Epic 2 sau hoặc vận hành) quyết định hình dạng endpoint.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: SIGTERM dưới `node-windows`/winsw chưa verify có thực sự gửi tín hiệu Node bắt được khi `net stop`/SCM dừng service, hay winsw kill trực tiếp bỏ qua graceful-shutdown code.
  evidence: Cần máy Windows admin thật để verify (cùng loại giới hạn với các item epic-1 retro cần hardware thật) — nếu winsw không gửi tín hiệu bắt được, toàn bộ SIGTERM handler trong `main.ts:141` không bao giờ chạy trong production; theo dõi lại khi có môi trường deploy thật.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: Không có WS ping/pong keep-alive để phát hiện kết nối "chết" nửa chừng (client rớt mạng không đóng TCP sạch).
  evidence: `wsTelemetryAdapter.ts` không wire `ws`'s built-in heartbeat — thuộc scope Story 2.7 (xử lý `disconnected`/`machine-offline`), không phải AC của Story 2.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: `envelope.schema_version` được nhận nhưng chưa validate/log khi có giá trị lệch so với kỳ vọng.
  evidence: Boundaries chỉ yêu cầu tăng `schema_version` khi thêm `event_type` mới (nghĩa vụ phía sender) — quan sát/validate phía receiver là cải tiến observability ngoài AC hiện có.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: Adapter inbound chỉ validate kiểu dữ liệu (`isFiniteNumber`), không validate dấu/khoảng cho `rtt_ms`/`bitrate_kbps` — range-guard chỉ có ở core (`computeBitratePct` clamp bitrate âm về 0%).
  evidence: Lệch tầng validate giữa adapter (hình dạng) và core (nghiệp vụ) nhưng chưa gây sai hành vi thật — `rtt_ms` hiện chưa được core sử dụng ở đâu.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: So sánh bearer-token (`validBearerTokens.has(token)`) không phải constant-time.
  evidence: Rủi ro timing-attack lý thuyết khi dò token; ưu tiên thấp do dashboard-backend chỉ accessible trong LAN/VPN nội bộ, không expose internet (epic-2-context).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-ranh-giới-telemetry-thô-trạng-thái-tính-toán.md`
  summary: Chưa có log rotation/size bound cho `JsonLinesLogger` (ghi thẳng stderr, không giới hạn).
  evidence: Dịch vụ chạy 24/7 dưới Windows Service qua winsw — rotation nên cấu hình ở tầng winsw (vận hành), ngoài scope code của story này.

## Deferred from: code review of spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức (2026-09-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md`
  summary: `fs.watch` (built-in) có thể âm thầm ngừng nhận event khi file `channel-registry.json` bị thay bằng cơ chế atomic write (ghi file tạm rồi rename/move) thay vì ghi đè trực tiếp — hot-reload có thể "chết lặng" không log lỗi nào.
  evidence: Đây đúng là điều kiện Ask First đã ghi trong Boundaries của spec ("nếu phát hiện bằng chứng cụ thể... HALT trước khi thêm chokidar") — chưa gặp bằng chứng thực nghiệm trong lúc code/test (chỉ ghi đè trực tiếp qua `writeFileSync`), nhưng 1 số editor/công cụ deploy dùng rename-based save. Cần watch thư mục cha thay vì file, hoặc chuyển sang `chokidar`, trước khi mở rộng ngoài pilot — quyết định này đã được đóng khung là cần hỏi người dùng trước, không tự đổi.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md`
  summary: `baseline_kbps` trong channel-registry không có kiểm tra ngưỡng trên hợp lý (chỉ chặn <=0) — nhập nhầm đơn vị (Mbps thay vì kbps) vẫn qua được validate và làm sai lệch `bitrate_pct` tính toán.
  evidence: Rủi ro thao tác con người khi điền registry thủ công (README hướng dẫn sửa tay); hậu quả là 1 kênh có thể bị phân loại sai trạng thái ok/warning/critical do baseline sai đơn vị mà không có cảnh báo nào ở tầng config.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md`
  summary: `ChannelRegistryEntry` trả về từ `getEntry()` không được freeze/clone trước khi trả ra ngoài — caller tương lai (Epic 2.3+/detail-panel Epic 3) có thể vô tình mutate object đang nằm trong Map dùng chung của adapter.
  evidence: Hiện tại `channelState.ts` chỉ đọc `entry.baselineKbps`, không mutate — rủi ro chưa hiện thực hoá, nhưng port này sẽ có thêm caller khi Story 2.3+ tiêu thụ metadata hiển thị (station_name/contact_name/grid_position).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md`
  summary: So khớp `channel_id` (registry lookup lẫn telemetry) là case-sensitive tuyệt đối, không chuẩn hoá hoa/thường — lệch case giữa `EventEnvelope.channel_id` (transport-core) và channel-registry.json sẽ khiến 1 kênh bị coi "chưa đăng ký" vĩnh viễn mà khó chẩn đoán nguyên nhân qua log.
  evidence: Đặc điểm có từ Story 2.1 (tra cứu baseline cũng case-sensitive), không phải do Story 2.2 gây ra mới — nhưng đáng xem xét toàn hệ thống 1 lần trước khi mở rộng 20 kênh (AD-19), vì `channel_id` là business identifier nhập tay ở nhiều nơi (passphrase config AD-7, channel-registry, transport-core config).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md`
  summary: Chưa có test tích hợp qua `startApp()` chứng minh `registryPort.start()` ở composition root thực sự kích hoạt hot-reload xuyên suốt (test hiện tại chỉ verify adapter độc lập qua gọi `start()`/`reload()` trực tiếp trên instance, đúng như Boundaries chỉ định, và verify `startApp()` wiring không throw — nhưng không có test nào theo dõi 1 lần sửa file sau khi `startApp()` đã chạy).
  evidence: Xoá dòng `registryPort.start()` khỏi `main.ts` sẽ không làm fail bất kỳ test nào hiện có (61/61 vẫn xanh) dù đây là hành vi chính của cả story — cần `startApp()` hỗ trợ inject/quan sát 1 `Logger` test-only trước khi viết được test tích hợp sạch (hiện `startApp()` luôn dùng `defaultLogger()` singleton nội bộ, không có seam để test theo dõi log `registry_reload_success` qua toàn luồng).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md`
  summary: Chưa có test gọi `FileChannelRegistryAdapter.start()` 2 lần liên tiếp để xác nhận không rò rỉ watcher cũ.
  evidence: Code đã có guard (`this.watcher?.close()` trước khi tạo watcher mới trong `start()`) nhưng chưa có test xác nhận hành vi này đúng như thiết kế — rủi ro thấp, guard đơn giản, nhưng chưa coverage.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-channel-registry-hot-reload-nguồn-liệt-kê-kênh-vị-trí-lưới-chính-thức.md` (code review vòng 2)
  summary: `channel_id` bị xoá khỏi channel-registry qua hot-reload trong khi `ChannelStateService.channels` đang giữ `committed` display state cho kênh đó — không có cơ chế dọn dẹp/prune; trạng thái hiển thị cũ (vd "critical") bị giữ vĩnh viễn cho 1 kênh không còn đăng ký, và `channels` Map tích rác không giới hạn theo mỗi lần chỉnh sửa registry gây churn.
  evidence: Hành vi mới do hot-reload (Story 2.2) tạo ra — Story 2.1 chỉ load registry 1 lần lúc khởi động nên channel_id không bao giờ "biến mất" giữa lúc chạy. Rủi ro thấp ở quy mô hiện tại (~20 kênh, sửa registry không thường xuyên); Epic 2-3 (grid render theo registry) không lộ trạng thái orphan này ra UI vì sẽ chỉ query theo channel_id có trong registry. Cần quyết định hành vi mong muốn khi xoá kênh (publish 1 state "removed"? tự prune khi reload?) trước khi patch — để dành cho story dọn dẹp/hoặc khi Epic 2-3 cần hình dạng cụ thể.

## Deferred from: code review of spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load (2026-09-04)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `dashboard-frontend/src/services/uiWsClient.ts`'s `connectUiWsClient` không có handler `close`/`error` và không tự reconnect — sau 1 lần mất mạng/restart dashboard-backend, dashboard đứng yên vĩnh viễn (không nhận thêm `channel-seen`/`registry-snapshot` nào) cho tới khi người dùng tự reload tab, không có tín hiệu thị giác nào báo hiệu điều này đã xảy ra.
  evidence: Đây chính xác là kịch bản Story 2.7 (`connection-banner`, AD-16) được thiết kế để xử lý — AC của 2.7 nói "dashboard-frontend đang kết nối WebSocket tới dashboard-backend... khi kết nối mất... connection-banner hiện" — nhưng 2.7 được viết trước khi biết Story 2.3 sẽ dựng 1 WS server RIÊNG (`wsUiAdapter.ts`, không phải WS telemetry) cho mục đích này. Ghi chú lại để Story 2.7 nhắm đúng kết nối `uiWsClient.ts` này (bao gồm cả case connect-fail, không chỉ case "luồng dữ liệu im lặng"), không giả định nhầm là 1 kết nối WS chung chung nào khác.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `wsUiAdapter.ts`'s `seenChannels: Map<string, string>` nội bộ không bao giờ được dọn (prune) khi 1 channel_id bị xoá khỏi channel-registry qua hot-reload (Story 2.2) — Map chỉ tăng, không bao giờ giảm.
  evidence: Cùng nhóm lỗi với orphan-state đã defer ở review Story 2.2 (`ChannelStateService.channels` không prune) — đúng như ghi chú ở entry Story 2.2 phía trên, giả định "Epic 2-3 không lộ orphan ra UI vì sẽ query theo channel_id có trong registry" chỉ đúng cho registry-snapshot mới nhất; `seenChannels` là state nội bộ tách biệt của `wsUiAdapter.ts`, không tự đồng bộ theo registry. Rủi ro thấp ở quy mô hiện tại (~20 kênh, sửa registry không thường xuyên) vì channel bị orphan không được `ChannelGrid` render (chỉ render theo `channels` từ registry-snapshot mới nhất).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: Khi channel-registry hot-reload (Story 2.2) trong lúc dashboard-frontend đã có client đang mở, `wsUiAdapter.ts` KHÔNG gửi lại `registry-snapshot` mới cho các client đó — chỉ gửi 1 lần duy nhất lúc connect. 1 lần sửa station_name/contact info qua hot-reload sẽ không tới được tab trình duyệt đang mở sẵn cho tới khi nó tự reconnect/reload trang.
  evidence: Phản bác trực tiếp giả định đã ghi ở entry Story 2.2 phía trên ("Epic 2-3 sẽ chỉ query theo channel_id có trong registry" — giả định ngầm là frontend luôn đọc registry mới nhất mỗi lần cần, nhưng thiết kế thật của Story 2.3 là snapshot 1 lần lúc connect, không phải query theo yêu cầu). Không nằm trong I/O Matrix/AC đã chốt của Story 2.3 (chỉ cover "connect"/"connect muộn"), nên không coi là bad_spec — nhưng là hành vi thật cần theo dõi nếu registry được sửa thường xuyên hơn dự kiến ở pilot.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `findDuplicateTopLevelKey()` (`fileChannelRegistryAdapter.ts`, có từ Story 2.2, Story 2.3 không đụng vào) so khớp key top-level bằng cách so sánh trực tiếp chuỗi con trong text gốc, không giải mã escape sequence — 2 key byte-khác-nhau nhưng giải mã ra cùng 1 chuỗi (vd `"chan-a"` vs `"chan-a"`) sẽ lách qua được guard chống trùng `channel_id`.
  evidence: Phát hiện lại khi review Story 2.3 (do `listEntries()` mới được thêm cạnh hàm này) nhưng bản thân hàm không đổi — kịch bản kích hoạt cần ai đó tự tay gõ unicode escape vào `channel-registry.json` (file cấu hình LAN-only, admin tự sửa tay), rủi ro thực tế thấp.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `isNonEmptyString()` (`fileChannelRegistryAdapter.ts`, có từ Story 2.2) chỉ `trim()` khoảng trắng thường, không loại các ký tự invisible khác (vd zero-width space U+200B) — 1 giá trị chỉ gồm ký tự vô hình vẫn được coi là "non-empty" hợp lệ.
  evidence: Cùng nhóm rủi ro thao tác con người khi điền registry thủ công đã ghi ở entry Story 2.2 phía trên (đơn vị baseline_kbps sai) — Story 2.3 không đụng vào hàm này.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `parsePort()` (`app/main.ts`, có từ Story 2.1) dùng `Number(raw)` để coerce — chấp nhận các dạng số không phải thập phân thuần (vd `"1e2"`, `"0x50"`) như 1 giá trị port hợp lệ thay vì đòi hỏi chuỗi số nguyên thập phân đơn thuần.
  evidence: Phát hiện lại khi review Story 2.3 (thêm `DASHBOARD_UI_WS_PORT` dùng chung hàm này) nhưng bản thân hàm không đổi từ Story 2.1 — rủi ro thấp (biến môi trường do người vận hành/deploy-script set, không phải input từ xa).

## Deferred from: code review of spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load, round 2 (2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: Cả `wsTelemetryAdapter.ts` (Story 2.1) lẫn `wsUiAdapter.ts` (Story 2.3, mới) đều mặc định bind `0.0.0.0` (mọi interface) khi không set `host`/`uiHost` tường minh, thay vì giới hạn theo 1 interface LAN cụ thể.
  evidence: WS UI mới không auth (đã chốt LAN-only, Boundaries/Never của Story 2.3) — trên 1 host dual-homed hoặc có kết nối VPN, `0.0.0.0` khiến endpoint không-auth này lọt ra ngoài phạm vi LAN dự kiến. Đây là pattern có sẵn từ Story 2.1 (không phải do Story 2.3 gây ra mới), nhưng WS UI mới làm rủi ro cụ thể hơn (thêm PII contact_name/contact_phone). Cần quyết định interface LAN cụ thể (hoặc xác nhận rủi ro chấp nhận được) ở tầng vận hành/deploy trước khi mở rộng ngoài pilot.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: Re-xác nhận (đã defer từ vòng review 2026-09-04, vẫn còn mở, chưa fix): `connectUiWsClient` không reconnect/không có listener `close`/`error`; `wsUiAdapter` không rebroadcast `registry-snapshot` khi channel-registry hot-reload; `findDuplicateTopLevelKey` so khớp text JSON chưa decode escape.
  evidence: Không phát sinh finding mới — chỉ ghi chú để lần review sau biết các mục này đã được kiểm tra lại ở vòng 2 (2026-09-06) và xác nhận vẫn đúng hiện trạng, không phải bị bỏ sót.

## Deferred from: code review of spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load, round 3 (2026-09-06, review lại 6 file vừa patch ở round 2)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: BOM-fix (`loadAndValidate()`) chỉ xử lý BOM UTF-8 (`﻿` sau khi decode `'utf8'`) — file lưu bằng tùy chọn "Unicode" (UTF-16) của Notepad sẽ decode ra mojibake bằng `readFileSync(..., 'utf8')`, regex BOM không khớp gì.
  evidence: Fix đúng nghĩa cần đọc file dạng `Buffer` trước, sniff 2-3 byte BOM đầu (UTF-8 `EF BB BF`, UTF-16LE `FF FE`, UTF-16BE `FE FF`) rồi mới chọn encoding để decode — thay đổi lớn hơn phạm vi patch BOM hiện tại (chỉ 1 dòng `.replace()`). Windows 10/11 Notepad hiện mặc định lưu UTF-8, giảm khả năng gặp phải kịch bản UTF-16 trong thực tế.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `chokidar`'s `watcher.on('error', ...)` (`fileChannelRegistryAdapter.ts`, có từ Story 2.2) chỉ log `registry_watch_error`, không tự đóng + tái tạo watcher mới — nếu chokidar tự phát lỗi thật (khác kịch bản atomic-rename mà chokidar đã giải quyết), hot-reload "chết lặng" vĩnh viễn tới khi restart process.
  evidence: Cùng nhóm rủi ro với Ask First đã ghi ở Story 2.2 (fs.watch atomic-rename) nhưng là 1 lớp lỗi khác (watcher-level error thay vì miss-event) — chưa có bằng chứng thực nghiệm nào (chỉ phát hiện qua đọc code), rủi ro thấp ở quy mô hiện tại.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `app/main.ts`'s nhánh cleanup khi bind telemetry thất bại SAU KHI UI đã bind (`registryPort.stop(); await ui.close(); throw err;`) — nếu `ui.close()` tự reject, lỗi gốc (nguyên nhân thật của bind fail) bị thay thế bởi lỗi cleanup không liên quan, gây khó chẩn đoán.
  evidence: Pre-existing từ round 1 (Story 2.3), chỉ lộ ra khi review lại toàn bộ `main.ts` ở round 3 — không phải do patch round 2 (chỉ đổi `parsePort`'s tham số `varName`, không đụng nhánh cleanup này).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `AppHandle.stop()` gọi `ui.close()` rồi `ws.close()` tuần tự, không cô lập — nếu `ui.close()` treo/reject, `ws.close()` không bao giờ chạy, rò rỉ WS server telemetry lúc lẽ ra phải graceful shutdown.
  evidence: Pre-existing từ round 1, cùng lớp lỗi với nhánh cleanup phía trên — fix đúng nghĩa cần `Promise.allSettled`/cô lập lỗi từng nhánh, để dành review sau khi có ưu tiên rõ ràng hơn cho shutdown-path hardening.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: 2 test EADDRINUSE trong `main.test.ts` (round 1) verify cleanup qua side-effect Windows-specific (`rmSync` throw EBUSY/EPERM nếu watcher chưa đóng), không kèm OS-guard — trên non-Windows runner, assertion `doesNotThrow` có thể pass bất kể cleanup có thực sự chạy hay không.
  evidence: Dịch vụ này chỉ triển khai trên Windows (Windows Service qua winsw, theo epic-2-context.md), rủi ro portability thấp trong thực tế triển khai hiện tại — nhưng đáng lưu ý nếu CI/test infra sau này chạy đa nền tảng.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: Kích thước lưới (20 ô / 5 cột / 0-19) hard-code lặp lại độc lập ở 3 nơi không chia sẻ nguồn chân lý chung: `GRID_SIZE` (`ChannelGrid.tsx`), `GRID_COLUMNS` (`ChannelGridCell.tsx`), `GRID_POSITION_MIN/MAX` (backend `fileChannelRegistryAdapter.ts`).
  evidence: Cải tiến kiến trúc (cần module hằng số dùng chung xuyên frontend/backend, hiện 2 project riêng biệt không share code) — không blocking, kích thước lưới không nằm trong lộ trình thay đổi hiện tại (AD-19 chỉ nói mở rộng số kênh giám sát, không đổi layout 5x4).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: 20 ô placeholder skeleton (round 2) dùng chung 1 `aria-label="Đang tải kênh"` không có cue vị trí/index; `ChannelGrid`'s `role="grid"` cũng thiếu `role="row"` trung gian theo đúng ARIA grid pattern (pre-existing từ round 1).
  evidence: Thuộc phạm vi FR-14 (accessibility, không phụ thuộc màu, đo tương phản AA) đã lược bớt khỏi pilot theo AD-19, hoàn thiện ở Epic 5 trước khi mở rộng 20 kênh (epic-2-context.md).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
  summary: `isNonEmptyString()` (`fileChannelRegistryAdapter.ts`, Story 2.2) trim để validate nhưng lưu giá trị GỐC chưa trim — 1 giá trị có khoảng trắng đầu/cuối (vd `" Đài 1 "`) qua được validate nhưng khoảng trắng lộ ra tận UI/aria-label.
  evidence: Cùng nhóm rủi ro thao tác con người khi điền registry thủ công đã ghi nhận ở Story 2.2 (baseline_kbps sai đơn vị, invisible unicode char) — cosmetic, pre-existing, Story 2.3 không đụng vào hàm này.

## Deferred from: code review of spec-2-4-trạng-thái-ô-kênh-ok-warning-critical-alert-badge (2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-trạng-thái-ô-kênh-ok-warning-critical-alert-badge.md`
  summary: Không có validation/fallback runtime nếu `displayState` nhận giá trị ngoài 3 literal `'ok'|'warning'|'critical'` (component tin tưởng hoàn toàn kiểu TypeScript tại boundary prop, không guard runtime).
  evidence: Không thể xảy ra ở Story 2.4 (fixture chỉ sinh đúng 3 giá trị hợp lệ) — chỉ thành rủi ro thật khi Story 2.6 nối dữ liệu backend/WebSocket thật vào `displayState`, lúc đó payload sai định dạng có thể khiến `className`/badge render `undefined`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-trạng-thái-ô-kênh-ok-warning-critical-alert-badge.md`
  summary: `dashboard-frontend/app/page.tsx` (component `Page`) chưa có bất kỳ test nào từ trước tới nay — bao gồm cả wiring `channelDisplayStates` mới thêm ở Story 2.4 — nên logic tính `useMemo`/truyền prop xuống `ChannelGrid` chỉ được xác minh gián tiếp qua build/test thủ công, không qua test tự động.
  evidence: Pre-existing gap của `page.tsx` (chưa từng có test file riêng qua Story 2.3/2.4), rộng hơn phạm vi 1 patch của Story 2.4 — cần quyết định hướng test Next.js page (mock `connectUiWsClient`/store) làm việc riêng.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-trạng-thái-ô-kênh-ok-warning-critical-alert-badge.md` (code review vòng 2)
  summary: `alert-badge`/`displayState` không lộ ra `aria-label`/`aria-live` nào cho screen reader — `aria-label` của `ChannelGridCell` (Story 2.3, không đổi ở Story 2.4) chỉ chứa `stationName`, không kèm `OK`/`⚠ ABR`/`✕ MẤT TÍN HIỆU`; 1 kênh chuyển `critical` hoàn toàn im lặng với assistive tech dù đây là badge cảnh báo chính của phòng trực.
  evidence: Thuộc phạm vi FR-14 (accessibility, không phụ thuộc màu, đo tương phản AA) đã lược bớt khỏi pilot theo AD-19, hoàn thiện ở Epic 5 trước khi mở rộng 20 kênh (`epic-2-context.md`) — cùng nhóm với item accessibility đã defer ở review Story 2.3 round 3 (skeleton `aria-label` không có cue vị trí, thiếu `role="row"`).

## Deferred from: code review of spec-2-5-vu-meter-thumbnail-color-bars-theo-trạng-thái (2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-vu-meter-thumbnail-color-bars-theo-trạng-thái.md`
  summary: `vu-meter` (mức âm thanh thực tế theo `audioLevel`) không có `aria-label`/text tương đương nào cho screen reader — chỉ `thumbnail`/`colorBars` được đánh `aria-hidden="true"` (đúng, thuần trang trí), nhưng vùng vu-meter tự nó không expose giá trị dBFS nào cho assistive tech, dù đây là thông tin vận hành (mức âm) đội trực dùng để giám sát.
  evidence: Cùng nhóm với các item accessibility đã defer ở Story 2.3 round 3 và Story 2.4 vòng 2 — thuộc phạm vi FR-14 (accessibility, không phụ thuộc màu, đo tương phản AA) đã lược bớt khỏi pilot theo AD-19, hoàn thiện ở Epic 5 trước khi mở rộng 20 kênh (`epic-2-context.md`).

## Deferred from: code review of spec-2-6-cập-nhật-trạng-thái-kênh-event-driven-qua-websocket (2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-cập-nhật-trạng-thái-kênh-event-driven-qua-websocket.md`
  summary: `lastState` (`wsUiAdapter.ts`, mới ở Story 2.6, dùng để replay `channel-state-change` cho client connect muộn) chỉ được ghi (`set`), không bao giờ bị xoá theo vòng đời channel-registry — nếu 1 `channel_id` bị gỡ khỏi registry qua hot-reload, entry cũ vẫn tồn tại vĩnh viễn trong Map và tiếp tục được replay cho client connect muộn dù kênh không còn tồn tại.
  evidence: Cùng lớp rủi ro pre-existing với `seenChannels` (Story 2.3, chưa từng dọn theo registry) mà `lastState` cố ý mirror pattern — không phải lỗi mới do Story 2.6 gây ra, chỉ mở rộng 1 pattern đã tồn tại từ trước sang 1 Map thứ 2. Cần quyết định cơ chế đồng bộ theo registry (xoá entry khi channel bị gỡ) cho cả 2 Map cùng lúc, phạm vi lớn hơn 1 patch.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-cập-nhật-trạng-thái-kênh-event-driven-qua-websocket.md`
  summary: `channelStore.ts`'s `channelDisplayStates` (frontend, mới ở Story 2.6) cùng lớp rủi ro: không có cơ chế dọn state khi 1 `channel_id` bị gỡ khỏi registry — cùng gốc với `seenChannelIds` (Story 2.3) vốn cũng "chỉ cộng thêm, không bao giờ gỡ bỏ" theo đúng thiết kế hiện có.
  evidence: Đối xứng với entry `lastState` phía backend ở trên — cả 2 phía đều thiếu đồng bộ theo vòng đời channel-registry, nhưng đây là pattern đã được chấp nhận từ Story 2.3 cho `seenChannelIds`, không phải regression riêng của Story 2.6.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-cập-nhật-trạng-thái-kênh-event-driven-qua-websocket.md` (code review /bmad-code-review, 4-lớp)
  summary: `dashboard-frontend/src/state/channelStore.ts`/`src/services/uiWsClient.ts` (state/service layer) import `DisplayState` từ `dashboard-frontend/src/components/ChannelGridCell.tsx` (file component UI) — dependency ngược hướng layer.
  evidence: Spec Code Map của Story 2.6 tự chỉ định đúng import này ("import type từ ChannelGridCell.tsx, đúng type đã dùng ở page.tsx/ChannelGrid.tsx") nên không phải tự ý sai lệch — nhưng đào sâu 1 pattern có từ Story 2.4 (nơi `DisplayState` lần đầu được định nghĩa trong 1 component thay vì 1 module type/port dùng chung). Fix đúng nghĩa cần dời `DisplayState` sang 1 module type trung lập (mirror cách backend đã làm với `AlertOutboundPort.ts`) — phạm vi lớn hơn 1 patch của Story 2.6, ảnh hưởng nhiều file đã ổn định qua nhiều story.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-cập-nhật-trạng-thái-kênh-event-driven-qua-websocket.md` (code review /bmad-code-review, 4-lớp)
  summary: `createCompositeAlertPort` (`dashboard-backend/app/main.ts`) log lỗi fan-out chỉ định danh nhánh throw bằng index số (`port[0]`/`port[1]`), không tên adapter thật (`LogAlertAdapter`/`WsUiAdapter`).
  evidence: Gây khó chẩn đoán hơn cần thiết khi tra log production (phải đọc lại `main.ts:263` để biết index nào ứng với adapter nào). Fix sạch cần đổi shape tham số (`{name, port}[]` thay vì `AlertOutboundPort[]` trần) — chạm cả call site lẫn 5 test hiện có của `createCompositeAlertPort`, không phải 1 patch trivial; để dành khi có ưu tiên rõ ràng hơn cho observability.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-cập-nhật-trạng-thái-kênh-event-driven-qua-websocket.md` (code review /bmad-code-review, 4-lớp)
  summary: `createCompositeAlertPort` chỉ log `alert_publish_error` (text log), không có metric/counter riêng để alert/dashboard khi 1 nhánh fan-out lỗi lặp lại liên tục.
  evidence: Ngoài scope AC/Boundaries của Story 2.6 (không có yêu cầu metrics trong spec/epic context) — codebase hiện chưa có hạ tầng metrics nào khác để so sánh convention; cần quyết định công cụ/hình dạng metric ở phạm vi lớn hơn 1 story trước khi thêm.

## Deferred from: code review of spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline (2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: `handleHeartbeat`'s recovery re-publish dùng `record.committed` verbatim, không xét `record.pending` đang chờ debounce (nếu telemetry đã đổi candidate trong lúc machine-offline nhưng chưa đủ 5s ổn định).
  evidence: Badge có thể hiện giá trị `committed` cũ vài giây ngay sau khi heartbeat resume, tới khi `pending` tự chốt qua debounce bình thường - cửa sổ hẹp, cosmetic, không phải tín hiệu sai lệch nghiêm trọng (không giống bug chính machine-offline/telemetry desync đã patch).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Test integration mới `main.test.ts`'s heartbeat wiring thật dùng `setTimeout(resolve, 100)` cố định để "chắc chắn" WS message đã được xử lý trước khi advance() FakeClock, thay vì poll 1 tín hiệu quan sát được.
  evidence: Rủi ro flaky tiềm ẩn dưới tải CI cao (không có tín hiệu externally-observable nào khác để poll thay thế mà không thêm hook test-only mới vào `ChannelStateService`) - độ ưu tiên thấp, không ảnh hưởng đúng/sai hành vi production.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Không có test khẳng định `clearInterval(heartbeatTimeoutTimer)` trong nhánh lỗi bind `startWsTelemetryAdapter` (`main.ts`) thực sự ngăn `checkHeartbeatTimeouts()` chạy tiếp sau khi `startApp()` reject.
  evidence: Đã verify bằng đọc code trực tiếp là hành vi ĐÚNG (clearInterval được gọi) - đây thuần là verification gap (thiếu assertion), không phải bug thật; cần spy/fake-timer bổ sung vào test hiện có của nhánh EADDRINUSE để khoá lại.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Không có test nào xác nhận `ConnectionBanner`/`grid-overlay` (mất kết nối WS UI toàn cục) và badge `machine-offline` (per-channel) render đồng thời hợp lý khi cả 2 xảy ra cùng lúc.
  evidence: 2 cơ chế độc lập hoàn toàn (đã verify qua code + test riêng lẻ từng cái), nhưng chưa có test tổ hợp xác nhận UI không xung đột/che khuất nhau khi cả 2 active cùng lúc.

## Deferred from: bmad-build clarify (spec-5-2-xác-thực-hoàn-thiện-accessibility-không-phụ-thuộc-màu-đơn-lẻ, 2026-09-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-xác-thực-hoàn-thiện-accessibility-không-phụ-thuộc-màu-đơn-lẻ.md`
  summary: Đo/xác nhận kích thước chữ và icon (`channel-name`, `alert-badge`/`label-caps`, `numeric`, và thực ra toàn bộ 7 token typography trong DESIGN.md) trên màn hình TV wall thật theo khoảng cách xem thực tế phòng trực, điều chỉnh nếu cần.
  evidence: `epic-5-context.md` dòng 23 và `DESIGN.md` (mỗi token typography, dòng 31/37/43/49/55/61/67 + dòng 190/242) đều gắn cờ `[ASSUMPTION]` này — cần đo vật lý trên phần cứng TV wall thật, ngoài khả năng của agent code. Người dùng xác nhận (2026-09-23): defer việc đo thật ra khỏi Story 5.2, để lại như 1 hạng mục QA thủ công cần môi trường thật; Story 5.2 chỉ xác thực phần contrast màu sắc (không đụng font-size).

## Deferred from: code review of spec-5-2-xác-thực-hoàn-thiện-accessibility-không-phụ-thuộc-màu-đơn-lẻ (/bmad-build step-04, 2026-09-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-xác-thực-hoàn-thiện-accessibility-không-phụ-thuộc-màu-đơn-lẻ.md`
  summary: Marker glyph mới (`.vuMeterZoneMarker`, `⚠`/`✕` báo zone hiện tại của vu-meter) không có `aria-label`/text alternative nào cho screen reader — chỉ là 1 glyph Unicode trần.
  evidence: Cùng nhóm gap accessibility đã defer nhiều lần trước đó cho alert-badge/vu-meter (Story 2.3 round 3, Story 2.4 vòng 2, Story 2.5, Story 2.7) — thuộc phạm vi FR-14/aria đã lược khỏi pilot theo AD-19. AC1 của Story 5.2 chỉ yêu cầu tín hiệu phi-màu cho mắt nhìn (không phụ thuộc màu), không yêu cầu ARIA/screen-reader semantics — marker mới tiếp nối đúng pattern chưa xử lý này, không phải regression mới.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-xác-thực-hoàn-thiện-accessibility-không-phụ-thuộc-màu-đơn-lẻ.md`
  summary: Khả năng phân biệt thị giác giữa marker "warning" (9px) và "critical" (11px + bold) chưa được xác nhận trên màn hình TV wall thật theo khoảng cách xem thực tế phòng trực — chỉ mới đúng theo thiết kế trên giấy.
  evidence: Cùng nhóm với hạng mục TV-wall sizing đã defer ở heading phía trên của cùng story này (2026-09-23) — cần đo vật lý ngoài khả năng agent code, không phải lỗi thiết kế.

## Deferred from: code review of spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline (/bmad-code-review, 4-lớp, 2026-09-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: "**[Đã user xác nhận chấp nhận rủi ro]** subType `machine-offline` đè `config-or-security-suspected` khi 1 kênh vừa `machineOfflineActive` vừa có candidate telemetry `REJECTED` cùng lúc — `applyCandidate()` (`channelState.ts:208-217`) ép cứng `subType:'machine-offline'` lên publish bất kể `candidate.subType` thực tế là gì, xoá mất tín hiệu `config-or-security-suspected` (AD-9) khỏi `alertPort`/audit log cho tới khi heartbeat resume."
  evidence: "Về câu chữ vi phạm Boundaries Never (\"2 subType độc lập\") — 4/4 layer review độc lập phát hiện (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). Quyết định (2026-09-07, người dùng xác nhận): giữ nguyên hành vi hiện tại — machine-offline luôn thắng khi trùng, vì ưu tiên hiển thị máy chết (mất giám sát hoàn toàn) hơn REJECTED (vẫn có audit log riêng qua Story 2.1 patch). Theo dõi lại nếu pilot thực tế cho thấy kịch bản trùng này xảy ra thật và gây hậu quả cụ thể."
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: `this.channels` (backend `channelState.ts`), `seenChannels`/`lastState` (`wsUiAdapter.ts`) không prune khi 1 channel_id bị gỡ khỏi channel-registry qua hot-reload — record cũ (kể cả `lastHeartbeatAt`/`machineOfflineActive` mới thêm ở Story 2.7) tồn tại vĩnh viễn trong bộ nhớ tiến trình.
  evidence: Pre-existing pattern từ Story 2.2/2.3/2.6 (đã tracked ở các heading phía trên) — Story 2.7 chỉ mở rộng thêm 2 field lên cùng 1 record đã sẵn không được prune, không phải regression mới. Rủi ro thấp ở quy mô ~20 kênh, registry ít sửa.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Không có test end-to-end (wiring `main.ts` thật + WS thật) cho chiều "heartbeat resume" — chỉ có E2E cho chiều "phát hiện machine-offline" (`main.test.ts:667`), chiều phục hồi chỉ unit-test trực tiếp `ChannelStateService`.
  evidence: Cùng nhóm gap test-coverage đã ghi ở heading round-1 phía trên cho story này (setTimeout(100) cố định, thiếu assertion clearInterval) — bổ sung thêm 1 gap cùng loại, ưu tiên thấp, không ảnh hưởng đúng/sai hành vi production.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Envelope `event_type=heartbeat` (`wsTelemetryAdapter.ts:110`) chỉ validate `typeof envelope.timestamp === 'string'`, không parse/validate định dạng ISO 8601 — 1 chuỗi bất kỳ vẫn lọt qua.
  evidence: Chỉ ảnh hưởng log (core dùng Clock injectable, không đọc field này để tính timeout) — cùng nhóm rủi ro validate-lỏng đã defer từ Story 2.1 (`schema_version`/`rtt_ms`).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Badge `machine-offline` mới (`✕ TRUNG TÂM LỖI`) không có tooltip/aria-label riêng phân biệt với `✕ MẤT TÍN HIỆU` cho assistive tech — cả 2 chỉ khác text hiển thị, không có ngữ cảnh bổ sung nào cho screen reader.
  evidence: Cùng nhóm accessibility đã lược khỏi pilot theo AD-19, hoàn thiện ở Epic 5 (đã defer tương tự ở Story 2.3 round 3, Story 2.4 vòng 2, Story 2.5).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-xử-lý-mất-kết-nối-dữ-liệu-giám-sát-disconnected-máy-trung-tâm-chết-machine-offline.md`
  summary: Sau khi `dashboard-backend` RESTART tiến trình (không chỉ đứt mạng), `channelStore.applyRegistrySnapshot()` (frontend) chỉ ghi đè `channels`, KHÔNG reset `channelDisplayStates`/`channelMachineOffline` — badge cũ (kể cả `machine-offline`) có thể tồn đọng trên UI cho tới khi có event mới đúng kênh đó dù backend không còn biết gì về trạng thái cũ.
  evidence: Mirror hành vi `channelDisplayStates` đã có từ Story 2.6 (không reset theo registry-snapshot) — không phải regression riêng của Story 2.7, chỉ mở rộng field `channelMachineOffline` lên cùng 1 pattern đã tồn tại.

## Deferred from: code review of spec-cap-5-xoa-cache-snapshot-khi-critical (2026-09-08)

- source_spec: `_bmad-output/implementation-artifacts/spec-cap-5-xoa-cache-snapshot-khi-critical.md`
  summary: `SnapshotRelayService.handleSnapshot()` (dashboard-backend/src/core/snapshotRelay.ts) forward mọi snapshot hợp lệ về registry vô điều kiện, không có guard chặn 1 khung snapshot đến trễ/lệch thứ tự cho channel đang `critical` — nếu xảy ra, nó âm thầm ghi đè lại `lastSnapshot` (CAP-5 vừa xoá) và làm mất tác dụng của CAP-5, dựa hoàn toàn vào giả định transport-core tự ngừng gửi khi critical.
  evidence: Blind-hunter review layer của bmad-build cho CAP-5 chỉ ra: comment trong `snapshotRelay.ts` tự thừa nhận đảm bảo "không gửi khi critical" là hoàn toàn phía ngoài (transport-core), không có safeguard nào ở dashboard-backend/dashboard-frontend cho trường hợp race/frame trễ. Thuộc scope `SPEC-video-preview-snapshot-thật` (CAP-1..4), không phải lỗi của thay đổi CAP-5 hiện tại.

## Deferred from: code review of spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack (2026-09-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md`
  summary: `checkOneChannelHeartbeatTimeout` (`dashboard-backend/src/core/channelState.ts:374`) không gọi `clearAckIfAcknowledged` khi 1 channel_id bị gỡ khỏi channel-registry (hot-reload) trong lúc `acknowledged=true` — nhánh registry-not-found return sớm trước khi chạm helper auto-clear.
  evidence: Đối xứng hành vi "đóng băng" sẵn có của `committed`/`machineOfflineActive`/`lastHeartbeatAt` khi 1 channel bị gỡ registry (không riêng ack) — `handleTelemetry`/`handleHeartbeat` cũng return sớm ở nhánh registry-not-found mà không dọn field nào của record đó. Cùng nhóm rủi ro "không prune theo vòng đời registry" đã tracked nhiều lần từ Story 2.2/2.3/2.6/2.7 (`this.channels`/`seenChannels`/`lastState` không bao giờ bị xoá khi channel bị gỡ). Ngoài phạm vi 3 điểm auto-clear mà Boundaries của story 3.3 yêu cầu (`applyCandidate`, `checkOneChannelHeartbeatTimeout` khi kích hoạt machine-offline, `handleHeartbeat`'s nhánh recovery) — dereg không phải 1 trong 3 điểm đó.

## Deferred from: code review of spec-3-1-ring-buffer-lịch-sử-bitrate-historyport-tri-state (2026-09-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-ring-buffer-lịch-sử-bitrate-historyport-tri-state.md`
  summary: `BitrateHistoryService`'s `history: Map<channelId, points[]>` (dashboard-backend/src/core/bitrateHistory.ts) không bao giờ xoá key khi 1 channel_id bị gỡ khỏi channel-registry qua hot-reload — mỗi channel_id từng xuất hiện giữ vĩnh viễn 1 key trong Map suốt vòng đời process (dữ liệu/kênh bị trim theo 15 phút, nhưng KEY thì không).
  evidence: Cùng nhóm lỗi đã tracked ở `epic-2-retro-item-10` (gộp 4 điểm Map không prune theo channel-registry hot-reload: `channelState.ts` channels, `wsUiAdapter.ts` seenChannels/lastState, frontend channelDisplayStates/channelMachineOffline) — story 3.1 thêm 1 Map thứ 5 vào đúng nhóm này, nên gộp chung khi làm cơ chế dọn dẹp thống nhất, không phải fix riêng lẻ.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-ring-buffer-lịch-sử-bitrate-historyport-tri-state.md`
  summary: `BitrateHistoryService.recordBitrate()` giả định `timestampMs` truyền vào luôn tăng dần theo mỗi lần gọi cho cùng 1 channelId (push vào cuối mảng + scan cutoff từ đầu mảng) — không có guard cho `timestampMs` không hợp lệ (NaN) hay lệch thứ tự (vd đồng hồ hệ thống bị chỉnh lùi).
  evidence: Phát hiện độc lập bởi cả blind-hunter lẫn edge-case-hunter. Rủi ro thấp trong thực tế: caller duy nhất (`channelState.ts:handleTelemetry`) luôn gọi đồng bộ, đơn luồng, bằng `this.clock.now()` tại đúng thời điểm gọi (Node.js single-threaded, `Date.now()` monotonic trừ khi bị NTP/admin chỉnh lùi) — cùng giả định monotonic-clock đã có sẵn ở `applyCandidate()`'s `stableForMs = now - pending.since` (Story 2.1) chưa từng được guard. Cần quyết định 1 lần cho toàn bộ core (không riêng story này) nếu muốn hardening chống clock-adjustment.

## Deferred from: code review of spec-3-1-ring-buffer-lịch-sử-bitrate-historyport-tri-state, round 2 (/bmad-code-review, 4-lớp, 2026-09-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-ring-buffer-lịch-sử-bitrate-historyport-tri-state.md`
  summary: Re-xác nhận (đã defer từ vòng review 2026-09-09, vẫn còn mở, chưa fix): `BitrateHistoryService`'s `history` Map không prune theo channel-registry hot-reload (nhóm "epic-2-retro-item-10"); `recordBitrate` giả định `timestampMs` tăng dần, không guard clock-skew.
  evidence: Không phát sinh finding mới cho 2 mục này — chỉ ghi chú để lần review sau biết đã được kiểm tra lại ở vòng 2 (2026-09-12), 4 layer (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) và xác nhận vẫn đúng hiện trạng, không phải bị bỏ sót.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-ring-buffer-lịch-sử-bitrate-historyport-tri-state.md`
  summary: `AppHandle.bitrateHistoryService` (`dashboard-backend/app/main.ts`) expose thẳng type cụ thể `BitrateHistoryService` thay vì interface `HistoryPort` — rò rỉ ranh giới hexagonal ra composition root, dù chỉ dùng để test quan sát wiring.
  evidence: Phát hiện mới ở vòng 2 (blind-hunter). Không ảnh hưởng hành vi runtime (chỉ khác biệt về kiểu khai báo) — route là `patch` (đổi type field, không đổi logic) thay vì defer, nên KHÔNG cần theo dõi riêng ở đây nếu đã patch; ghi lại phòng trường hợp patch bị bỏ qua ("Leave as action items").

## Deferred from: code review of spec-3-2-panel-chi-tiết-kênh-detail-panel (2026-09-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-panel-chi-tiết-kênh-detail-panel.md`
  summary: `channelStore.ts`'s `channelHistory` Map (MỚI, Story 3.2) không prune khi 1 channel_id bị gỡ khỏi channel-registry qua hot-reload; `selectedChannelId` cũng không tự về `null` nếu đúng kênh đang mở panel bị gỡ khỏi registry (panel vẫn mở, hiện tên đài/liên hệ rỗng cho kênh không còn tồn tại).
  evidence: Cùng nhóm lỗi đã tracked ở `epic-2-retro-item-10` (gộp các Map không prune theo channel-registry hot-reload: `channelState.ts` channels, `wsUiAdapter.ts` seenChannels/lastState, frontend channelDisplayStates/channelMachineOffline, `bitrateHistory.ts`'s history Map đã defer ở Story 3.1) — `channelHistory` là 1 Map thứ 6 vào đúng nhóm này, nên gộp chung khi làm cơ chế dọn dẹp thống nhất, không phải fix riêng lẻ. Blind-hunter review layer phát hiện độc lập.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-panel-chi-tiết-kênh-detail-panel.md`
  summary: `HISTORY_RETENTION_MS = 15 * 60 * 1000` được định nghĩa lặp lại độc lập ở cả `dashboard-backend/src/core/bitrateHistory.ts` (Story 3.1) và `dashboard-frontend/src/state/channelStore.ts` (Story 3.2, MỚI) — không có nguồn dùng chung, không có test cross-check giữa 2 phía.
  evidence: Cùng nhóm lỗi đã tracked ở `epic-2-retro-item-12` (gộp hằng số kích thước lưới GRID_SIZE/GRID_COLUMNS/GRID_POSITION_MIN/MAX lặp lại giữa các file) — cửa sổ retention lịch sử bitrate là 1 cặp hằng số nữa thuộc đúng nhóm "hằng số lặp lại xuyên biên frontend/backend" này, nên gộp chung 1 lần dọn dẹp thay vì fix riêng. Blind-hunter review layer phát hiện.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-panel-chi-tiết-kênh-detail-panel.md`
  summary: `DetailPanel.tsx` (MỚI) là 1 modal/overlay nhưng không có focus trap (giữ focus bên trong panel khi Tab) hay focus-restore (trả focus về đúng `channel-grid-cell` vừa click khi đóng panel) — chỉ có Esc/click-outside để đóng.
  evidence: epic-3-context.md nói rõ accessibility "hoàn thiện đầy đủ ở Epic 5, nhưng cần tương thích ngay từ Epic 3" — Esc-to-close (bắt buộc theo Boundaries) đã có; focus trap/restore đầy đủ hơn thuộc phần "hoàn thiện" dành cho Epic 5 (mirror cách các gap accessibility khác của Epic 2 đã defer tới Epic 5: badge tooltip/aria-label Story 2.3/2.4/2.5/2.7). Blind-hunter review layer phát hiện.

## Deferred from: code review of spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack, round 1 (2026-09-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md`
  summary: Nút ack/`ack-label` không có `aria-live`/thông báo riêng cho screen reader khi xuất hiện/biến mất — tín hiệu "✓ Đã nhận" hoàn toàn chỉ mang tính thị giác.
  evidence: epic-3-context.md dòng 25 đã chốt accessibility "hoàn thiện đầy đủ ở Epic 5, nhưng cần tương thích ngay từ Epic 3" — story 3.3 chỉ cần Tab+Enter/Space cho nút ack (đã có trong scope), đúng tiền lệ đã defer ở Story 3.2 (focus trap/restore) cho cùng lý do. Blind-hunter review layer phát hiện.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md`
  summary: Ack-state (`acknowledged`/`ackLabel`) chỉ lưu in-memory trong `ChannelStateService`'s `channels` Map, không có persistence — restart dashboard-backend giữa ca trực xoá sạch toàn bộ acknowledgement hiện có, không có cảnh báo nào cho operator.
  evidence: Đặc điểm kiến trúc toàn hệ thống, không riêng ack — TOÀN BỘ state của `channelState.ts` (committed/pending/machineOfflineActive) và ring buffer lịch sử bitrate (Story 3.1) đều chỉ in-memory, không có tầng persistence nào trong dashboard-backend hiện tại (AD-27 chỉ cam kết auto-restart qua Windows Service, không cam kết giữ state qua restart). Blind-hunter review layer phát hiện.

## Deferred from: code review of spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack, round 2 (2026-09-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md`
  summary: `MAX_OPERATOR_LABEL_LENGTH = 64` được định nghĩa lặp lại độc lập ở `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts` và `dashboard-frontend/src/components/DetailPanel.tsx` — không có nguồn dùng chung, không có test cross-check giữa 2 phía.
  evidence: Cùng nhóm lỗi đã tracked ở `epic-2-retro-item-12` (gộp hằng số kích thước lưới lặp lại) và đã defer tương tự ở Story 3.2 (`HISTORY_RETENTION_MS` lặp lại backend/frontend) — đây là 1 cặp hằng số nữa thuộc đúng nhóm "hằng số lặp lại xuyên biên frontend/backend", nên gộp chung 1 lần dọn dẹp thay vì fix riêng. Blind-hunter review layer round 2 phát hiện.

## Deferred from: code review of spec-4-2-đẩy-telegram-cho-mức-chú-ý-abr-warning-tới-đội-trực (2026-09-22)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-đẩy-telegram-cho-mức-chú-ý-abr-warning-tới-đội-trực.md`
  summary: `TelegramAlertAdapter` không có throttle/giới hạn nào giữa các `channelId` khác nhau cùng gửi tới 1 `chat_id` chung — cooldown 60s chỉ độc lập theo từng kênh, nên nhiều kênh cùng chuyển `warning` gần như đồng thời (vd 1 sự cố mạng thượng nguồn ảnh hưởng nhiều đài) có thể bắn nhiều request đồng thời vào cùng 1 chat, dễ chạm rate-limit của Telegram; do spec đã chốt "không retry", các cảnh báo bị rate-limit sẽ chỉ bị nuốt lỗi + log, không có fallback nào khác cho operator.
  evidence: Blind-hunter review layer phát hiện. Ngoài phạm vi AC/Boundaries hiện tại của Story 4.2 (chỉ yêu cầu cooldown độc lập/kênh) và pilot hiện tại chỉ chạy 1 kênh (AD-19) nên chưa phát sinh thật — cần theo dõi lại khi mở rộng nhiều kênh.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-đẩy-telegram-cho-mức-chú-ý-abr-warning-tới-đội-trực.md`
  summary: Nội dung tin nhắn Telegram (`formatWarningMessage`, `telegramAlertAdapter.ts`) chỉ gồm `channelId` + timestamp UTC thô, không tra `station_name`/`contact_name` từ channel-registry (vốn đã có sẵn qua `ChannelRegistryPort`) — đội trực nhận tin phải tự tra chéo channel_id sang tên đài thật, và timestamp UTC cần tự quy đổi giờ VN.
  evidence: Blind-hunter review layer phát hiện. Không nằm trong I/O Matrix/AC đã chốt của Story 4.2 (chỉ yêu cầu gửi kèm channel_id) — thêm lookup registry vào adapter là 1 thay đổi thiết kế (thêm dependency `ChannelRegistryPort` vào `TelegramAlertAdapter`) lớn hơn phạm vi 1 patch, để dành quyết định cho story sau nếu vận hành thực tế thấy cần.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-đẩy-telegram-cho-mức-chú-ý-abr-warning-tới-đội-trực.md`
  summary: `TelegramAlertAdapter`'s `lastSentAt: Map<string, number>` (khoá `channelId:warning`) không bao giờ được dọn khi 1 `channel_id` bị gỡ khỏi channel-registry qua hot-reload.
  evidence: Cùng nhóm lỗi đã tracked ở `epic-2-retro-item-10` (gộp các Map không prune theo channel-registry hot-reload) — đây là 1 Map nữa thuộc đúng nhóm này, nên gộp chung khi làm cơ chế dọn dẹp thống nhất, không phải fix riêng lẻ. Blind-hunter review layer phát hiện.

## Deferred from: code review of spec-4-3-đẩy-telegram-email-cho-mức-cảnh-báo-chủ-động-critical-tới-đội-trực-lãnh-đạo (2026-09-22)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-đẩy-telegram-email-cho-mức-cảnh-báo-chủ-động-critical-tới-đội-trực-lãnh-đạo.md`
  summary: `registryPort.stop()` gọi trước mỗi throw fail-fast trong `app/main.ts` (khối Telegram Story 4.2, khối Telegram-lãnh-đạo/SMTP/email mới của Story 4.3, và các nhánh cleanup bind-thất-bại khác) không bọc try/catch — nếu bản thân `stop()` throw, lỗi cấu hình gốc (vd "thiếu DASHBOARD_SMTP_HOST") bị thay thế bởi 1 exception không liên quan, gây khó chẩn đoán lúc khởi động.
  evidence: Edge-case-hunter review layer phát hiện ở 2 điểm mới của Story 4.3 (main.ts, khối thiếu-biến-môi-trường + khối parseSmtpPort lỗi) nhưng đây là pattern lặp lại y hệt đã tồn tại từ Story 4.2 (và các nhánh cleanup bind UI/telemetry thất bại khác, đã defer 1 lần ở review Story 2.3 round 3) — Story 4.3 chỉ mirror đúng pattern có sẵn theo đúng chỉ định của spec ("mirror Story 4.2 patch"). Sửa đúng nghĩa cần bọc try/catch quanh MỌI lệnh gọi `registryPort.stop()` trong file (không chỉ 2 chỗ mới của 4.3) để nhất quán — gộp lại thành 1 lần dọn dẹp toàn file thay vì vá rời rạc từng story.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-đẩy-telegram-email-cho-mức-cảnh-báo-chủ-động-critical-tới-đội-trực-lãnh-đạo.md`
  summary: Không có cơ chế xác thực kết nối SMTP/Telegram bot lúc khởi động (vd 1 lần gọi `transporter.verify()`/Telegram `getMe`) — fail-fast hiện tại chỉ kiểm tra biến môi trường không rỗng/đúng định dạng, không kiểm tra credential có thật sự hoạt động; 1 SMTP password/host sai vẫn khởi động bình thường và chỉ lộ ra khi có cảnh báo `critical` thật, lúc đó lỗi gửi bị nuốt + log (đúng thiết kế "không throw"), dễ bị bỏ sót cho tới khi cần dùng thật.
  evidence: Blind-hunter review layer phát hiện. Ngoài scope Boundaries/AC hiện tại của Story 4.3 (chỉ yêu cầu fail-fast khi thiếu/rỗng biến môi trường, không yêu cầu verify credential thật) và không có tiền lệ nào cho việc này ở Story 4.2 (Telegram) — cần thiết kế riêng (dry-run/health-check command hoặc `verify()` lúc `startApp()`), lớn hơn phạm vi 1 patch, để dành quyết định cho story vận hành sau nếu pilot thực tế cho thấy đây là vấn đề thật.

## Deferred from: code review of spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown, round 2 (2026-09-22)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: "**[Đã user xác nhận chấp nhận rủi ro]** `previousDisplayState` chỉ so khớp state CHỐT NGAY TRƯỚC ĐÓ (single-hop) — chuỗi `critical→warning→ok` (kết nối lại nhưng bitrate còn thấp rồi mới hồi phục hẳn) khiến audience critical (lãnh đạo + đội trực-critical, cả Telegram lẫn Email) KHÔNG BAO GIỜ nhận tin phục hồi, dù kênh đã thực sự ok."
  evidence: "Blind-hunter + edge-case-hunter review layer (vòng 2) độc lập phát hiện. Quyết định (2026-09-22, người dùng xác nhận): giữ nguyên thiết kế single-hop hiện tại — pilot hiện 1 kênh, dashboard vẫn là nguồn sự thật real-time chính, epic-4-context đã có tiền lệ defer các robustness/escalation edge-case tới sau pilot. Fix đúng nghĩa cần redesign tracking theo hướng per-instance \"còn cảnh báo treo hay không\" (hoặc track state nặng nhất kể từ lần phục hồi gần nhất) thay vì so single-hop — phạm vi lớn hơn 1 patch của story này. Theo dõi lại nếu pilot thực tế gặp đúng kịch bản reconnect-với-bitrate-thấp-rồi-mới-hồi-phục-hẳn này."
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: Kênh CHƯA từng có `record.committed` nào (chưa đủ 5s telemetry ổn định lần đầu) khi rơi vào machine-offline sẽ không bao giờ nhận tin phục hồi khi heartbeat resume — `handleHeartbeat`'s guard `if (record.committed)` bỏ qua re-publish hoàn toàn, và lần commit telemetry đầu tiên sau đó có `previous===undefined` nên `previousDisplayState` cũng `undefined`.
  evidence: Blind-hunter review layer (vòng 2) phát hiện. Kịch bản hẹp (cần: đã có ít nhất 1 heartbeat để có `lastHeartbeatAt`, nhưng CHƯA có bất kỳ telemetry nào ổn định đủ 5s trước khi heartbeat im lặng ≥15s) — thường chỉ xảy ra trong vài giây đầu 1 kênh mới đăng ký. Guard `if (record.committed)` là hành vi PRE-EXISTING từ Story 2.7, không phải do Story 4.4 gây ra mới; Story 4.4 chỉ kế thừa giới hạn này khi thêm previousDisplayState.

## Deferred from: code review (/bmad-code-review, 4-lớp) of spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown (2026-09-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: "**[Đã user xác nhận chấp nhận rủi ro]** Nhánh phục hồi bypass cooldown hoàn toàn không có anti-flood/dedup nào — (a) `handleHeartbeat` (`channelState.ts:339-356`): heartbeat timeout/resume lặp lại nhiều lần trong khi `record.committed.state` vẫn `'ok'` khiến mỗi lần resume gửi phục hồi KHÔNG giới hạn; (b) kênh flap `critical`<->`ok` nhanh hơn cooldown 60s khiến cảnh báo gốc bị cooldown chặn nhưng nhánh phục hồi vẫn gửi ngay — audience nhận 'đã phục hồi' cho 1 sự cố chưa từng được báo."
  evidence: "Blind-hunter + edge-case-hunter review layer độc lập phát hiện. Đúng như spec yêu cầu ('gửi NGAY, bỏ qua HOÀN TOÀN cooldown Map') nên fix đúng nghĩa cần renegotiate Boundaries (thêm dedup/rate-limit riêng cho nhánh phục hồi). Quyết định (2026-09-23, người dùng xác nhận): giữ nguyên — pilot quy mô nhỏ, chấp nhận rủi ro. Theo dõi lại nếu pilot thực tế gặp đúng kịch bản flapping này. [`channelState.ts:339-356`, `telegramAlertAdapter.ts:133`, `emailAlertAdapter.ts:156`]"
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: Nội dung tin Telegram/email phục hồi không nêu `subType`/thời lượng downtime của sự cố — khó đối chiếu đúng đợt nào vừa hồi phục khi nhiều sự cố xảy ra gần nhau.
  evidence: Blind-hunter review layer phát hiện. Vượt yêu cầu tối thiểu của spec (Boundaries chỉ đòi "nội dung phải khác rõ cảnh báo, nêu rõ đây là tin phục hồi") — cải tiến UX, không blocking. [`telegramAlertAdapter.ts:250`, `emailAlertAdapter.ts:254`]
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: Trùng lặp pattern nhánh phục hồi (guard 3 điều kiện + fire-and-forget/log/catch) giữa `TelegramAlertAdapter`/`EmailAlertAdapter`.
  evidence: Blind-hunter review layer phát hiện. Pre-existing pattern mở rộng từ Story 4.2/4.3 (đã duplicate 1 lần cho nhánh cảnh báo, giờ duplicate lần 2 cho nhánh phục hồi) — refactor cần 1 helper dùng chung, phạm vi lớn hơn 1 patch của story này. [`telegramAlertAdapter.ts:122-136,213-232`; `emailAlertAdapter.ts:149-159,220-241`]
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: Không có test end-to-end xác nhận `ChannelStateChange` nhánh phục hồi fan-out đúng qua `createCompositeAlertPort` tới cả 4 adapter thật (Email + 2 Telegram critical + Telegram warning) cùng lúc.
  evidence: Blind-hunter review layer phát hiện. Cùng nhóm gap test-coverage đã defer ở review Story 2.7 (thiếu e2e cho chiều "heartbeat resume") — chỉ có unit test per-adapter, chưa có wiring test thật qua composition root.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: Guard `subType !== 'machine-offline'` lặp lại dạng string literal độc lập ở 2 adapter, không có hằng số/type guard dùng chung nối lại `AlertOutboundPort.ts`'s subType union.
  evidence: Blind-hunter review layer phát hiện. Cải tiến type-safety nhỏ (1 rename literal tương lai có thể âm thầm phá guard 1 adapter mà không có compiler error) — không blocking, rủi ro thấp. [`telegramAlertAdapter.ts:133`, `emailAlertAdapter.ts:156`]
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-thông-báo-phục-hồi-gửi-ngay-lập-tức-bỏ-qua-cooldown.md`
  summary: Không có bước xác minh credential SMTP/Telegram lúc khởi động — lỗi cấu hình chỉ lộ ra khi có sự kiện gửi thật (critical hoặc phục hồi) xảy ra.
  evidence: Blind-hunter review layer phát hiện. Pre-existing, đã ghi nhận y hệt ở review Story 4.3 (2026-09-22) — Story 4.4 chỉ thêm 1 send-path mới (recovery) dùng chung credential chưa-verify sẵn có, không phải gap mới. Ngoài scope Story 4.4.

## Deferred from: code review of spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím (2026-09-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: Đóng `detail-panel` sau khi đã chuyển sang xem 1 kênh KHÁC (click/Enter trên 1 `channel-grid-cell` khác trong lúc panel vẫn mở, tính năng có sẵn từ Story 3.2) trả focus về đúng cell đã MỞ panel lần đầu, không phải cell đang thực sự được focus/xem gần nhất — `previouslyFocusedElementRef` (`DetailPanel.tsx`, effect mới của Story 5.1) chỉ cập nhật theo `isOpen` (đóng/mở), không theo mỗi lần đổi kênh giữa lúc panel vẫn mở.
  evidence: Blind-hunter review layer phát hiện, verify-gap layer xác nhận không có test nào cover kịch bản này. Đúng theo câu chữ Boundaries đã duyệt ("focus trả về phần tử đã có focus ngay trước lúc mở" — số ít, 1 lần mở) nên không phải deviation so với spec đã frozen, nhưng là 1 edge-case UX chưa lường hết khi viết Boundaries. Cần quyết định sản phẩm (trả về cell mở đầu tiên, hay cell đang xem gần nhất) trước khi patch — không tự chọn 1 trong 2 vì cả hai đều hợp lý tuỳ ý đồ UX. [`DetailPanel.tsx` effect `useEffect(..., [isOpen])`, `handlePointerDownCapture`]
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: Pattern CSS `outline: 2px solid var(--color-focus-ring); outline-offset: ...px;` giờ lặp lại độc lập ở 3 nơi (`ChannelGridCell.module.css`'s `.cell:focus-visible` mới, `DetailPanel.module.css`'s `.ackInput:focus-visible`/`.ackButton:focus-visible` có sẵn) không qua 1 rule/token dùng chung.
  evidence: Blind-hunter review layer phát hiện. Dự án dùng CSS Modules thuần (không SCSS/mixin/composition, đã xác nhận lúc điều tra Story 5.1) nên chưa có cơ chế chia sẻ rule CSS; Code Map của Story 5.1 tự chỉ định mirror y hệt pattern có sẵn (chủ đích, không phải sơ suất). Cùng nhóm với các item "gộp hằng số/pattern lặp" đã defer ở Epic 2/3 retro (`epic-2-retro-item-12`) — để dành gộp chung 1 đợt khi có ưu tiên rõ ràng hơn, không phải 1 patch trivial của riêng story này.

## Deferred from: code review (/bmad-code-review, 4-lớp) of spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím, round 2 (2026-09-23, re-review)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: Re-xác nhận (đã defer từ vòng review trước, cùng ngày, vẫn còn mở, chưa quyết định): focus trả về đúng cell đã MỞ panel lần đầu, không phải cell đang xem gần nhất khi chuyển kênh giữa lúc panel mở; và pattern CSS `focus-visible` lặp lại 3 nơi.
  evidence: Không phát sinh finding mới — 4 layer review (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) độc lập ở vòng này phát hiện lại đúng 2 mục trên, chỉ để ghi chú đã kiểm tra lại và xác nhận vẫn đúng hiện trạng, không phải bị bỏ sót.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: `.panel` (DetailPanel) không có CSS `:focus`/`:focus-visible` riêng khi nhận `.focus()` lập trình lúc mở bằng bàn phím — `.cell`/`.ackInput`/`.ackButton` đều đã có outline focus-visible, riêng `.panel` (chính phần tử nhận focus khi mở panel) thì không.
  evidence: Blind-hunter review layer phát hiện. Boundaries của Story 5.1 chỉ yêu cầu outline cho `.cell`, không đề cập `.panel` — overlay/backdrop tự thân đã tạo độ nổi bật thị giác mạnh (hộp nổi giữa màn hình, nền/viền khác biệt) nên không coi là vi phạm AC, nhưng đáng cân nhắc khi làm Story 5.2 (accessibility AA). [`DetailPanel.module.css:27`]
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: `useMemo` (`ChannelGrid.tsx:96-99`, mới) gọi lại `placeholderChannels()` tạo mảng mới mỗi render trong khoảng ngắn trước khi có `registry-snapshot` đầu tiên (`channels.length===0`) — không đạt tối ưu ổn định tham chiếu mà chính comment của `useMemo` này hướng tới, trong đúng khoảng thời gian đó.
  evidence: Edge-case-hunter + blind-hunter độc lập phát hiện. Đã verify: `channels` giữ nguyên reference qua các update không liên quan MỘT KHI đã có snapshot thật (`channelStore.ts`'s pattern `{...state, field}`), nên khiếm khuyết chỉ tồn tại trong cửa sổ rất ngắn (trước khi nhận registry-snapshot đầu tiên) — không phải lỗi hành vi, chỉ là tối ưu chưa trọn vẹn. [`ChannelGrid.tsx:96-99`]
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: `aria-modal="true"` trên `.panel` (có từ Story 3.2, không đổi ở Story 5.1) mâu thuẫn ngữ nghĩa ARIA với chủ trương "không thêm Tab-trap" mà Story 5.1 vừa chốt tường minh — dialog `aria-modal=true` theo spec ARIA kỳ vọng giữ focus bên trong, nhưng Tab vẫn thoát ra ngoài panel.
  evidence: Blind-hunter review layer phát hiện. Pre-existing từ Story 3.2, Story 5.1 không đụng vào attribute này — mâu thuẫn đã tồn tại từ trước, chỉ lộ rõ hơn khi Story 5.1 tường minh hoá quyết định "không Tab-trap". Cần renegotiate ở Story 5.2 (accessibility AA) nếu muốn xử lý đúng nghĩa (bỏ `aria-modal` hoặc thêm trap). [`DetailPanel.tsx:203`]
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: `previouslyFocusedElementRef.current` chỉ kiểm tra `.isConnected` trước khi `.focus()` lại lúc đóng panel, không kiểm tra phần tử có đang `disabled`/`display:none`/`aria-hidden` hay không — nếu đúng lúc đó phần tử rơi vào trạng thái không thể nhận focus, `.focus()` sẽ âm thầm không có tác dụng.
  evidence: Edge-case-hunter + blind-hunter độc lập phát hiện. Hiện chưa có đường dẫn thực tế nào trong app khiến 1 `channel-grid-cell` bị disabled/ẩn trong lúc panel đang mở (cell luôn giữ `tabIndex=0` khi có `onSelect`, không có state nào tắt nó đi) — rủi ro lý thuyết, chưa có kịch bản kích hoạt thật. [`DetailPanel.tsx:169-172`]

## Deferred from: code review of spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím, round 3 (2026-09-23, re-review)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-điều-hướng-đầy-đủ-bằng-bàn-phím.md`
  summary: Focus-restore qua click CHUỘT (khác đường bàn phím Enter/Space) có thể không hoạt động trên Safari — `channel-grid-cell` là `<div tabIndex=0>` (non-form element, `ChannelGridCell.tsx:199-215`); Safari lịch sử không tự đưa focus vào phần tử non-form khi click chuột, nên bước LƯU `document.activeElement` lúc panel mở (`DetailPanel.tsx:158`) có thể lưu sai phần tử ngay từ đầu trên trình duyệt đó.
  evidence: Blind-hunter review layer phát hiện (finding mới, khác góc với item "disabled/hidden check" đã defer ở round 2 — item đó nói về bước TRẢ focus, item này nói về bước LƯU). Đường bàn phím Enter/Space không bị ảnh hưởng (đã verify `onKeyDown` chỉ fire khi cell đã có focus, nên `document.activeElement` luôn đúng cell trên đường này). Ngoài phạm vi AC của Story 5.1 (AC mô tả luồng bàn phím, không phải click chuột) — chưa có bằng chứng thực nghiệm trên Safari thật, chỉ phát hiện qua đọc code.
