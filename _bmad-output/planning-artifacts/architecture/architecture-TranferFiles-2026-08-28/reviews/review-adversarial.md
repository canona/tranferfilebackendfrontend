# Adversarial Review — ARCHITECTURE-SPINE.md (SRT Transport & Monitoring VTCDigital)

**Ngày review:** 2026-08-31
**Target:** `_bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md`
**Phương pháp:** Dựng ra ≥2 lập trình viên/team độc lập, mỗi người tuân thủ ĐÚNG TỪNG CHỮ mọi AD trong spine (không tự ý diễn giải rộng hơn), rồi kiểm tra xem sản phẩm của họ có tương thích nhau không (wire format, ABI, ownership, interface). Trọng tâm: AD-4 (amended) và AD-31 (mới) — 2 quyết định sửa trong ngày 2026-08-31.
**Verdict:** **PASS-WITH-FINDINGS** — paradigm/ranh giới tổng thể (AD-11, AD-20, AD-21) chặt và nhất quán; nhưng AD-4/AD-31 giải quyết "dùng libav* hay CLI ffmpeg" (câu hỏi đúng của ngày hôm nay) mà bỏ ngỏ một lớp câu hỏi thấp hơn — *cùng dùng libav*, nhưng dùng như thế nào* — nơi 2 người tuân thủ đúng luật vẫn build ra 2 thứ không nói chuyện được với nhau. 5 finding dưới đây đều tái hiện được bằng cách đọc spine đúng nghĩa đen.

---

## Finding 1 [CRITICAL] — AD-31 chỉ đặc tả đường đài (capture→encode→srt-send); đường trung tâm (srt-recv→decode→playout) không có AD nào chi phối → wire-format + audio + decode-ownership đều là chỗ trống

### Dựng 2 dev

- **Dev A (đài — encode path):** đọc AD-31 dòng "`transport-core/src/pipeline/` encode H.264 gọi `libavcodec`" + AD-4 "gọi như native C API". Cô ấy dùng `avcodec_encode` lấy AVPacket H.264, rồi vì AD-31 chỉ cấm `libavformat` trong `srt/` ("không qua libavformat") — không cấm ở `pipeline/` — cô mux các AVPacket vào MPEG-TS bằng `avformat_write_header`/`av_interleaved_write_frame` (muxer nội bộ, ghi ra buffer chứ không đụng socket), rồi mới chunk buffer đó qua `srt_sendmsg`. Đây là cách làm chuẩn công nghiệp cho SRT (SRT nguyên bản được thiết kế để mang MPEG-TS).
- **Dev B (trung tâm — decode/playout path):** đọc đúng những dòng AD-4/AD-31 mà anh có — không có dòng nào nói `pipeline/` phía nhận phải demux MPEG-TS trước khi decode. Anh đọc AD-8 ("pipeline encode/ABR/SRT chỉ phụ thuộc interface `Source`") và suy luận (hợp lý, vì spine không nói khác) rằng payload nhận qua `srt_recvmsg` chính là **Annex-B elementary stream** — encode bên kia sao thì decode bên này vậy, không có lớp container. Anh viết `avcodec_decode` thẳng trên buffer nhận từ `srt_recvmsg`.

**Kết quả:** SRT handshake OK (AES/passphrase đúng theo AD-6), `connection_state=CONNECTED`, telemetry `bitrate`/`rtt` vẫn báo bình thường (vì đó là số liệu tầng SRT, không phải tầng payload) — nhưng decoder ở trung tâm nhận byte-stream MPEG-TS mà tưởng là Annex-B thuần, decode lỗi/garbage 100% thời gian. Đây đúng dạng lỗi nguy hiểm nhất: **mọi AD về transport/security/telemetry đều "xanh"**, dashboard báo `ok`, nhưng SDI output tại trung tâm là màn hình nhiễu — không kênh nào trong AD-9/AD-10/AD-11 phát hiện ra vì tất cả đều quan sát tầng SRT, không quan sát tầng payload.

### Tại sao AD-31 không chặn được

AD-31's "Prevents" chỉ nói về ranh giới **libav\* API vs CLI subprocess** — đúng câu hỏi hôm 2026-08-31 hỏi. Nó hoàn toàn im lặng về:

1. **Container/framing trên wire giữa `pipeline/` (encode, đài) và `pipeline/` (decode, trung tâm)** — MPEG-TS qua `libavformat` mux/demux, hay raw Annex-B chunk trực tiếp? Cả hai đều "hợp pháp" theo câu chữ AD-31 vì lệnh cấm `libavformat` chỉ áp cho `srt/`.
2. **Audio.** AD-5/AD-31 chỉ nói "H.264" — chỉ video. Nhưng AD-23 định nghĩa `audio_level: [L, R]` telemetry field (ngụ ý audio ĐANG được capture/phân tích), và SDI out tại trung tâm (FR-4) là tín hiệu phát sóng — theo thông lệ ngành phải có audio đi kèm. Không AD nào nói: audio có được encode/truyền qua SRT hay không, bằng codec gì (AAC? PCM passthrough? Opus?), qua module nào. Một dev có thể hợp lệ build pipeline video-only (đọc đúng chữ AD-5), dev kia giả định audio bắt buộc đi kèm vì đọc đúng chữ AD-23 — không ai sai theo spine, kết quả không tương thích.
3. **Decode không xuất hiện trong Structural Seed.** Đọc lại comment trong seed: `pipeline/ # encode H.264 qua libavcodec (AD-4 amended/AD-31, AD-5), ABR (AD-10)` — chỉ "encode". Không có `decode/`, không có dòng nào gán trách nhiệm demux/decode cho trung tâm. Dev B phải tự bịa ra vị trí code và interface cho việc này — không có cơ sở nào trong spine để 2 dev hội tụ về cùng 1 thiết kế.

### AD cần sửa

Cần **AD mới (đề xuất AD-32 — "Wire payload contract giữa encode (đài) và decode (trung tâm)")**, bind FR-2/FR-4/AD-31, quy định:
- Container cụ thể trên SRT payload (khuyến nghị: MPEG-TS qua `libavformat` mux/demux CHỈ để đóng gói bytes — không phải I/O; `srt/` vẫn chỉ gọi `srt_sendmsg`/`srt_recvmsg` trên buffer đã mux/demux, giữ đúng tinh thần "không qua libavformat cho I/O" của AD-31).
- Audio: có hay không, codec gì, PID/stream mapping nếu TS.
- Structural Seed: thêm `pipeline/decode` (hoặc tách rõ `pipeline/encode` vs `pipeline/decode`) là component tường minh ở phía trung tâm, với comment nêu rõ AD chi phối.

---

## Finding 2 [HIGH] — Stack table pin version FFmpeg (8.1.2) nhưng không pin `./configure` flags → 2 build libavcodec khác tập codec/device được compile-in

### Dựng 2 dev

- **Dev A** build FFmpeg từ nguồn cho máy đài có GPU NVIDIA: `./configure --enable-decklink --enable-nvenc --enable-gpl --enable-libx264`. Đúng AD-31 (`--enable-decklink`), đúng AD-5 (x264 + NVENC).
- **Dev B** build FFmpeg cho máy trung tâm (không cần encode, nhưng theo "entrypoint theo vai trò" trong Structural Seed thì `app/` là 1 codebase build 1 lần rồi chọn role lúc chạy — nghĩa là lẽ ra phải là CÙNG MỘT BINARY cho cả đài lẫn trung tâm). Anh build lại từ nguồn (vì Stack chỉ pin version FFmpeg, không pin flag) với `./configure --enable-decklink` — quên `--enable-gpl --enable-nonfree --enable-libx264` (nghĩ "trung tâm không encode nên không cần x264"), và cũng không có `--enable-nvenc` vì máy build của anh không có SDK NVIDIA cài sẵn.

**Kết quả:** Nếu đúng theo Structural Seed là 1 binary/role-switch dùng chung cho 40 máy, thì bất kỳ máy đài nào chạy build của Dev B sẽ thiếu hẳn libx264 lẫn NVENC compiled-in — AD-5 ("x264 software, hoặc hardware NVENC/QuickSync/AMF tuỳ máy") không còn là lựa chọn runtime nữa mà crash/lỗi "encoder not found" ngay tại `avcodec_find_encoder_by_name`. Nếu spine thực chất ngầm định build riêng theo máy/role (không nói rõ) thì đây chính là finding — sự mơ hồ "1 binary hay N binary" tự nó đã là một hole khác (xem Finding 5 liên quan).

### AD cần sửa

Amend AD-4 hoặc thêm dòng vào Stack table: liệt kê tường minh flag `./configure` bắt buộc (`--enable-gpl --enable-nonfree --enable-libx264 --enable-decklink --enable-nvenc --enable-libmfx --enable-amf` khi khả dụng trên toolchain build), và quy định build 1 lần duy nhất (CI pipeline chung, artifact chung deploy cho toàn bộ 40 máy) — không cho phép build cục bộ theo từng máy/dev.

---

## Finding 3 [HIGH] — AD-4 "link trực tiếp" không phân biệt static/dynamic linking → phá vỡ giả định "copy thủ công" ở Deferred + rủi ro DLL hell + nguy cơ 2 bản libsrt cùng tồn tại trong 1 tiến trình

### Dựng 2 dev

- **Dev A** hiểu "link trực tiếp thư viện FFmpeg...vào trong tiến trình C++" (AD-4) = static link toàn bộ `libavcodec`/`libavformat`/`libavdevice`/`libx264`/`libsrt` vào 1 file `.exe` self-contained. Khớp đúng nghĩa đen "vào TRONG tiến trình", và khớp Deferred: *"pilot 1 kênh (2 máy): copy thủ công + restart Windows Service là đủ"* (copy 1 file exe).
- **Dev B** hiểu "link trực tiếp" = dynamic link (cách build FFmpeg mặc định/phổ biến nhất, ít công build hơn) → exe phụ thuộc ~15 DLL (`avcodec-61.dll`, `avformat-61.dll`, `avdevice-61.dll`, `avutil-*.dll`, `swscale-*.dll`, `swresample-*.dll`, `libx264-165.dll`...) đặt cùng thư mục hoặc trên PATH.

**Kết quả:** "Copy thủ công" ở Deferred chỉ đúng cho build của Dev A. Máy nào nhận build của Dev B mà quy trình vận hành (RACI/runbook chưa viết, vì "Cơ chế update/patch...chưa thiết kế ở spine này") chỉ copy đúng 1 file `.exe` cũ theo thói quen → chương trình không chạy được hoặc tệ hơn, Windows DLL search-order nạp nhầm 1 DLL cũ còn sót trên máy (từ lần cài FFmpeg thử nghiệm trước đó, hoặc từ 1 phần mềm khác dùng chung tên DLL phổ biến này) — silent version mismatch, không crash ngay, chỉ lệch hành vi ABR/encode tinh vi giữa các máy trung tâm khác nhau.

**Thêm 1 lớp rủi ro bảo mật cụ thể:** Stack table pin `libsrt ≥ 1.5.6` bắt buộc vì vá CVE-2026-55840/55841. Nhưng FFmpeg tự nó CÓ THỂ được `./configure --enable-libsrt` để avformat có sẵn protocol handler `srt://` riêng (dùng libsrt làm dependency ẩn bên trong). Không AD nào cấm cờ này. Nếu Dev A (build FFmpeg) bật `--enable-libsrt` (vô tình, vì nghĩ "hệ thống dùng SRT nên bật cho đủ"), quá trình build sẽ vendor/link thêm **1 bản libsrt thứ hai** (version do FFmpeg's dependency resolver chọn, không nhất thiết ≥1.5.6) vào cùng binary với bản libsrt ≥1.5.6 mà `srt/` module link trực tiếp — 2 bản libsrt cùng tồn tại trong 1 tiến trình (static: nguy cơ trùng symbol ở link-time, hoặc silent duplicate nếu namespace khác; dynamic: DLL nào load trước thắng, không kiểm soát được) — vi phạm ngầm chính pin bảo mật mà Stack table tuyên bố là bắt buộc.

### AD cần sửa

Amend AD-4: quy định tường minh **static linking**, single self-contained `.exe`, không phụ thuộc DLL runtime cho `libav*`/`libx264`/`libsrt` (khớp đúng "vào TRONG tiến trình" + giữ nguyên giả định "copy thủ công" ở Deferred). Đồng thời cấm tường minh `--enable-libsrt` khi build FFmpeg (để tránh vendor libsrt thứ 2) — nên thêm dòng này vào Finding 2's AD-4 amendment luôn (cùng chỗ sửa).

---

## Finding 4 [MEDIUM] — Stack table pin SDK 16.0 (build-time) + driver "hiện hành tại thời điểm cài đặt" (deploy-time) không phải một cặp (SDK, driver) được validate cố định → ABI mismatch giữa máy cài sớm và máy cài muộn trong rollout AD-19

### Dựng 2 dev/thời điểm

- **Máy đài #1 (pilot, cài ngày X):** build libavdevice's decklink module link với Blackmagic SDK 16.0 headers (đúng Stack table), cài driver "hiện hành tại thời điểm X" = ví dụ driver 16.4.
- **Máy trung tâm #15 (mở rộng 20 kênh theo AD-19, cài ngày X+6 tuần):** dùng ĐÚNG cùng build FFmpeg/SDK 16.0 (artifact không đổi, đúng quy trình), nhưng "driver hiện hành tại thời điểm cài đặt" lúc này đã là 1 bản driver mới hơn (Blackmagic phát hành driver mới trong 6 tuần đó) — Stack table cho phép việc này ("driver hiện hành...tại thời điểm cài đặt", không phải "phiên bản driver X cố định").

**Kết quả:** Blackmagic Desktop Video SDK có lịch sử breaking change ở COM interface (vd `IDeckLinkInput` → `IDeckLinkInput2`...) giữa các minor version. Nếu driver mới hơn thay đổi ABI mà `libavdevice` compiled cứng với SDK 16.0 header không tương thích ngược hoàn toàn, máy trung tâm #15 có thể: capture lỗi âm thầm (frame drop/corrupt không crash), hoặc crash khi mở device — trong khi máy pilot #1 chạy hoàn toàn ổn vì cặp (SDK 16.0, driver 16.4) đã được validate qua pilot 7 ngày. Đây chính là kịch bản "2 người (2 thời điểm cài đặt) tuân thủ đúng từng chữ Stack table nhưng ra 2 kết quả khác nhau" — vì "hiện hành tại thời điểm cài đặt" tự nó không phải một giá trị cố định, nó trôi theo thời gian rollout của AD-19.

### AD cần sửa

Amend Stack table (hoặc thêm dòng vào AD-19): pin **1 cặp (SDK version, driver version) đã validate cùng nhau ở pilot** làm baseline bắt buộc cho toàn bộ rollout — không cho phép "driver hiện hành tại thời điểm cài đặt" trôi tự do qua các đợt lắp máy khác nhau của cùng 1 MVP#1; nếu driver cần nâng cấp, phải re-validate cả cặp trước khi áp dụng cho máy mới, và áp lại cho các máy cũ (đồng bộ toàn hệ thống) — không để 40 máy chạy driver lệch nhau âm thầm.

---

## Finding 5 [MEDIUM] — AD-31 gọi `BlackmagicSource` là "decklink input/output" trong khi AD-8 định nghĩa `Source` = capture-abstraction only → không có interface cho playout/Sink, 2 dev tự bịa 2 thiết kế khác nhau

### Dựng 2 dev

- **Dev A (đài):** đọc AD-8: *"Transport-core tại đài định nghĩa 1 interface `Source`...pipeline chỉ phụ thuộc interface này"* — implement `BlackmagicSource` đúng nghĩa capture (decklink input), khớp tên class, khớp mô tả "Source abstraction tách capture khỏi pipeline".
- **Dev B (trung tâm):** cần playout SDI + color-bars fallback (AD-10: *"output SDI tại trung tâm tự động chuyển color bars"*). Anh đọc câu chữ AD-31: *"`BlackmagicSource` gọi `libavdevice` (decklink **input/output**)"* — literally nói class `BlackmagicSource` bao gồm cả output. Anh có 2 lựa chọn hợp lệ theo spine, không cái nào bị cấm:
  - (a) tái sử dụng/mở rộng chính class `BlackmagicSource` để thêm method ghi (write) — biến 1 interface được AD-8 định nghĩa là "Source" (đọc) thành bidirectional, phá vỡ chính lý do AD-8 tồn tại ("tách capture khỏi pipeline" — giờ Source vừa đọc vừa ghi, ranh giới không còn rõ).
  - (b) tự bịa ra 1 class mới hoàn toàn (`BlackmagicSink`, `PlayoutTarget`, `DecklinkOutput`...) — tên và interface không được spine chỉ định ở đâu cả, không có cơ sở để hội tụ với những gì Dev A hoặc 1 dev thứ 3 (viết color-bars switch logic trong `pipeline/` per AD-10) đã giả định.

**Kết quả:** Không phải lỗi runtime tức thì (đây là compile-time/design-time), nhưng là nguồn gây **rework/incompatibility ở review/integration**: nếu Dev A và dev viết `pipeline/`/AD-10 (ABR + color-bars logic) giả định tồn tại sẵn 1 interface `Sink` để gọi `sink.write(frame)` / `sink.switchToColorBars()`, còn Dev B build class hoàn toàn khác tên/API, tích hợp gãy ngay ở biên module đầu tiên — đúng dạng "state-mutation path xung đột" theo yêu cầu review (ai sở hữu việc chuyển sang color-bars: `Source`? `Sink` mới? hay `pipeline/` tự làm thẳng qua `libavdevice` không qua abstraction nào?).

### AD cần sửa

Sửa câu chữ AD-31 (bỏ "input/output" gộp chung dưới tên `BlackmagicSource`) + mở rộng AD-8 thêm 1 interface tường minh thứ hai, ví dụ `PlayoutSink` (đối xứng với `Source`), với rule: `BlackmagicSource` chỉ implement input (đài); 1 class riêng (đặt tên rõ trong spine, ví dụ `BlackmagicSink`) implement output/color-bars-switch tại trung tâm, cả 2 cùng gọi `libavdevice` nhưng là 2 interface tách biệt — không class nào vừa đọc vừa ghi.

---

## Các hole đã kiểm tra nhưng KHÔNG thấy vấn đề (để tránh false positive)

- **Ack-state ownership (AD-25):** backend là single owner tường minh, không có 2 chủ sở hữu.
- **channel-registry (AD-24) vs passphrase-config (AD-7):** đã có rule tường minh "cấp passphrase luôn đi kèm thêm vào channel-registry trong cùng quy trình" — không có khoảng hở đồng bộ hoá rõ ràng ở mức AD (rủi ro còn lại là vận hành/RACI, đã Deferred đúng chỗ).
- **machine-offline (AD-29) vs critical (AD-9/AD-11):** backend là single source of truth cho mapping severity — không có 2 actor cùng quyết định 1 ô hiển thị.
- **Envelope JSON chung (Consistency Conventions):** đủ chặt (schema_version, closed event_type set) — không tìm được cách 2 dev diễn giải khác nhau mà vẫn hợp lệ.

---

## Tổng kết & khuyến nghị AD mới/sửa

| # | Finding | Mức độ | AD cần sửa |
| --- | --- | --- | --- |
| 1 | Wire container/audio/decode-ownership giữa đài↔trung tâm không được đặc tả | CRITICAL | AD mới (AD-32) + sửa Structural Seed thêm `pipeline/decode` |
| 2 | FFmpeg `./configure` flags không pin → thiếu codec/device compiled-in tuỳ máy build | HIGH | Amend AD-4 + Stack table |
| 3 | Static vs dynamic linking không phân biệt → phá "copy thủ công", DLL hell, nguy cơ 2 bản libsrt | HIGH | Amend AD-4 (+ cấm `--enable-libsrt` khi build FFmpeg) |
| 4 | Cặp (SDK, driver) Blackmagic không pin cố định qua thời gian rollout | MEDIUM | Amend Stack table / AD-19 |
| 5 | `BlackmagicSource` "input/output" gộp chung, không có interface Sink/Playout riêng | MEDIUM | Sửa câu chữ AD-31 + mở rộng AD-8 (thêm `PlayoutSink`) |

**Verdict cuối:** PASS-WITH-FINDINGS. Spine không sai ở tầng đã quyết (AD-4/AD-31 giải quyết đúng và chặt câu hỏi "libav* API vs CLI subprocess"), nhưng để 2 lập trình viên (đài vs trung tâm) build độc lập rồi ráp lại mà không lệch nhau, bắt buộc phải đóng Finding 1 (wire contract) trước khi phân công code — đây là rủi ro tích hợp cao nhất, phát hiện sớm ở giai đoạn spine rẻ hơn nhiều so với phát hiện lúc pilot 1 kênh chạy thử.
