---
reviewer: rubric-walker (subagent)
target: ARCHITECTURE-SPINE.md (SRT Transport & Monitoring VTCDigital)
target_updated: 2026-08-31
review_date: 2026-08-31
focus: AD-4 amend (Blackmagic SDK trực tiếp → link libavformat/libavcodec/libavdevice) + AD-31 mới (ranh giới link-library vs CLI-subprocess)
verdict: PASS-WITH-FINDINGS
---

# Review — Rubric Walker

## Verdict: PASS-WITH-FINDINGS

Amend AD-4 và AD-31 mới đúng tinh thần gốc (không FFI/subprocess, ABR vẫn đọc `srt_bstats` trong-process qua libsrt), Stack table và Structural Seed đã cập nhật khớp phần lớn. Tuy nhiên có **1 mâu thuẫn nội bộ thực sự giữa AD-8 và AD-31** (đúng câu hỏi trọng tâm #1), **1 lỗi CVE sai số hiệu** trong dòng "verified web", và **Capability → Architecture Map bỏ sót hoàn toàn AD-4/AD-8/AD-31** dù chính AD-4 tự khai Binds các FR đó. Không finding nào phá vỡ toàn bộ kiến trúc, nhưng cần sửa trước khi coi amendment này là "closed".

---

## 1. Rule có enforceable và prevent đúng divergence đã nêu?

Nhìn chung: đạt. AD-4 amended cấm rõ "shell-out CLI ffmpeg làm subprocess" — kiểm được bằng code review (grep `CreateProcess`/`exec`/`ffmpeg.exe` trong transport-core). AD-31 gán rõ thư viện theo từng thư mục (`source/`→avdevice, `pipeline/`→avcodec, `srt/`→libsrt not avformat) — kiểm được bằng việc soát `#include` trong từng module. Enforceable.

Điểm yếu: xem Finding 1 và Finding 5 — một phần ranh giới (avformat, input/output) không đủ tường minh để 2 người implement độc lập chắc chắn hội tụ.

## 2. Deferred có mục nào để 2 unit chọn không tương thích?

Không phát hiện. Đã rà toàn bộ 11 mục Deferred: OQ-3/OQ-5/OQ-8/OQ-9 ngoài phạm vi code; tiêu chí "ổn định", RACI passphrase, update/patch 40 máy, rollback/canary, log aggregation, backup registry, HEVC/Portal/TSDB/broker/dashboard-đài — tất cả đều là **quyết định tương lai tập trung 1 nơi** (PM/architect quyết 1 lần trước khi mở rộng), không phải trường hợp nhiều unit tự chọn song song ngay bây giờ. Đạt.

Tuy nhiên xem **Finding 4** — "cơ chế update/patch 40 máy" (Deferred) đang che khuất một quyết định lẽ ra thuộc phạm vi AD-4/AD-31 ngay bây giờ: static-link hay dynamic-link libav*? Đây không phải "2 unit tự chọn khác nhau" theo đúng nghĩa rubric, nhưng là một dimension mà AD-4/AD-31 sở hữu (packaging của chính thư viện mà AD vừa quyết dùng) lại bị bỏ trống hoàn toàn — không Deferred tường minh, không quyết định.

## 3. Công nghệ nêu tên đã verified-current chưa?

Đã chạy WebSearch đối chiếu từng dòng "verified web":

| Dòng trong spine | Kết quả đối chiếu thực tế | Verdict |
| --- | --- | --- |
| Windows 11/Server, không dùng Win10 (EOL 14/10/2025) | Đúng, không kiểm tra lại chi tiết (không phải trọng tâm amendment) | OK |
| libsrt ≥1.5.6, vá **CVE-2026-55840** + **CVE-2026-55841** | **SAI SỐ HIỆU** — CVE thật là **CVE-2026-55868** (encryption downgrade) và **CVE-2026-55869** (heap overflow KMREQ). Xem Finding 2. | **FAIL** |
| Blackmagic SDK 16.0 (build-time) | Có thật — phát hành 8/4/2026. Nhưng tính đến 2026-08-31 đã có SDK 16.1 (8/7/2026), 16.3, 16.4 (8/2026) mới hơn; spine không giải thích vì sao pin 16.0 thay vì bản mới hơn (có thể hợp lý — ổn định — nhưng không nêu lý do như đã làm với libsrt). | Chấp nhận được, low-priority note |
| Blackmagic driver 16.4 (deploy-time) | Đúng, khớp thực tế release ~24/8/2026 | OK |
| FFmpeg 8.1.2, nhánh 8.1.x stable | Đúng — 8.1.2 phát hành 17/6/2026 từ nhánh 8.1 cắt 8/3/2026, đúng là bản stable mới nhất nhánh 8.1 tại thời điểm review | OK |
| Node.js 24.x Active LTS | Đúng — Active LTS tới 20/10/2026 | OK |
| React 19.2.x | Đúng bản mới nhất là 19.2.8 (21/7/2026). **Nhưng**: CVSS 10.0 RCE "React2Shell" (CVE-2025-55182) ảnh hưởng React 19.0–19.2.0 (React Server Components/Flight protocol), vá ở 19.2.1+. Spine không pin patch tối thiểu hay loại trừ rủi ro này như đã làm rất kỹ với libsrt. | Xem Finding 6 |

## 4. Kế thừa parent spine

N/A — không có parent spine.

## 5. Mọi dimension altitude này sở hữu đã quyết/deferred/open question?

Đạt cho phần lớn (operational envelope: OS, service model, resilience, rollout, patch/update, log, backup đều có AD hoặc Deferred). Riêng dimension **"link mode của thư viện FFmpeg mới thêm vào (static/dynamic)"** — sinh ra trực tiếp từ chính amendment đang review — bị bỏ trống hoàn toàn, không AD, không Deferred. Xem Finding 4.

---

## TRỌNG TÂM: 4 câu hỏi đặc biệt

### Q1 — AD-4 amended có nhất quán với AD-8, AD-10, AD-31 không?

**KHÔNG hoàn toàn — có 1 mâu thuẫn văn bản trực tiếp giữa AD-8 và AD-31.** Xem Finding 1 (chi tiết bên dưới). AD-4 ↔ AD-10 nhất quán tốt (ABR đọc `srt_bstats` qua libsrt, không đụng libav*, nhắc lại thống nhất ở cả AD-4, AD-10 nguyên văn không đổi, và AD-31). AD-4 ↔ AD-31 nhất quán ở phần phân công thư viện theo thư mục, nhưng để lại một khoảng ambiguous ở vai trò `libavformat` (Finding 5).

### Q2 — Stack table nhất quán với AD-4 amended không?

**Có, nhất quán về mặt kiến trúc** (build FFmpeg với `--enable-decklink` cần Blackmagic SDK 16.0 tại build-time; transport-core không gọi SDK trực tiếp nữa — đúng khớp AD-4 amended). Vấn đề duy nhất ở Stack table là **factual, không phải architectural**: sai số hiệu CVE của libsrt (Finding 2) — không liên quan trực tiếp tới nội dung amendment nhưng nằm trong phạm vi rubric "verified web" phải kiểm.

### Q3 — Structural Seed (source/pipeline/srt) có khớp AD-4 amended/AD-31 không?

**Khớp gần như 1:1 về câu chữ** với Rule của AD-31 (source/→libavdevice, pipeline/→libavcodec, srt/→libsrt not avformat). Vấn đề duy nhất là annotation `source/` copy nguyên văn cụm "input/output" từ AD-31 trong khi AD-8 (dẫn chiếu ngay bên cạnh trong cùng dòng comment) chỉ nói "input" — tức là bản thân Structural Seed đang phản chiếu trung thực sự mâu thuẫn đã có ở Finding 1, không tự nó tạo thêm lỗi mới.

### Q4 — Capability → Architecture Map: FR-2/FR-4 cần dẫn AD-31 không, hay AD-4/AD-5/AD-8/AD-10 là đủ?

**Câu hỏi giả định sai một tiền đề**: hiện FR-2 và FR-4 (và cả FR-1, FR-5) **không dẫn chiếu AD-4 lẫn AD-8** — dù chính AD-4 tự khai `Binds: FR-1, FR-2, FR-4, FR-5` và AD-8 tự khai `Binds: FR-1, FR-2, FR-4`. Đây là gap nghiêm trọng hơn việc "có nên thêm AD-31 hay không" (Finding 3).

Trả lời trực tiếp: **AD-31 không cần xuất hiện riêng trong Map** — đúng vì AD-31 không tự Binds vào FR nào (nó Binds vào AD-4/AD-5/AD-8/AD-10, xem Finding 3b), nó là AD "clarifying" được truy cập gián tiếp qua AD-4 (AD-4's Rule đã tự "xem AD-31"). Nhưng điều kiện tiên quyết để cơ chế gián tiếp đó hoạt động là **AD-4 phải có mặt trong Map trước** — hiện không có. Fix đúng: thêm `AD-4` (và `AD-8`) vào các dòng FR-1, FR-2, FR-4, FR-5; không cần thêm `AD-31` riêng.

---

## Findings chi tiết

### Finding 1 [HIGH] — AD-8 và AD-31 mâu thuẫn văn bản về phạm vi `BlackmagicSource`

- AD-8 (dòng cập nhật amendment): *"BlackmagicSource implement bằng cách gọi `libavdevice` (**decklink input**)"* — chỉ input.
- AD-31 Rule: *"`transport-core/src/source/BlackmagicSource` gọi `libavdevice` (**decklink input/output**)"* — cả input lẫn output.
- Structural Seed lặp lại đúng bản AD-31 ("input/output") trong annotation `source/`.

Đây là mâu thuẫn trực tiếp, low-inference, đúng loại lỗi mà rubric "AD mới không được mâu thuẫn AD liên quan" nhắm tới — dù không có parent spine, 2 AD trong cùng spine tự mâu thuẫn nhau về scope của cùng 1 component là vi phạm tinh thần "no dimension left contradictorily decided". Hệ quả thực tế: người viết code phía đài (input, dùng AD-8's `Source` interface qua AD-2/AD-8) và người viết code phía trung tâm (output/playout + color-bars switching của AD-10) có thể hội tụ sai — 1 người nghĩ `BlackmagicSource` chỉ là input nên tự tạo thêm 1 class riêng cho output (vd `BlackmagicSink`) không được đặt tên/kiến trúc ở đâu cả trong spine, người kia đọc AD-31 rồi dùng chung `BlackmagicSource` cho cả 2 chiều.

Cũng liên quan: interface `Source` (AD-8) về mặt tên gọi ngữ nghĩa (input-producing abstraction) không tự nhiên bao gồm trách nhiệm output/playout — nhưng AD-31 lại gán output cho đúng class đó. Cả AD-8 lẫn AD-10 (output/color-bars) đều không có 1 dòng nào nói rõ: "output/playout tại trung tâm dùng lại `BlackmagicSource`, hay có 1 interface `Sink`/`Output` riêng?"

**Đề xuất fix**: chọn 1 trong 2 hướng và làm nhất quán cả AD-8 + AD-31 + Structural Seed:
- (a) Sửa AD-8 thành "input/output" khớp AD-31, và đổi tên hoặc note rõ `BlackmagicSource` đảm nhiệm cả 2 vai trò tuỳ theo `app/` role (đài dùng path input, trung tâm dùng path output) — hoặc
- (b) Tách 1 interface `Sink`/`Output` riêng (khớp tinh thần "Source abstraction tách capture khỏi pipeline" của chính AD-8), sửa AD-31 chỉ nói "decklink input" cho `BlackmagicSource`, thêm 1 dòng Rule cho output component riêng trong `pipeline/` hoặc `source/`.

### Finding 2 [HIGH] — Sai số hiệu CVE của libsrt trong Stack table

Stack table (dòng libsrt): *"vá CVE-2026-55840 encryption downgrade + CVE-2026-55841 heap overflow KMREQ"*.

Đối chiếu web thực tế (2026-08-31): số hiệu đúng là **CVE-2026-55868** (encryption state machine downgrade) và **CVE-2026-55869** (heap-based buffer overflow trong xử lý KMREQ) — nguồn: Debian security-tracker (`security-tracker.debian.org/tracker/CVE-2026-55869`), GitHub `Haivision/srt` release v1.5.6.

Đáng chú ý: **`.memlog.md` entry #47 đã ghi ĐÚNG số hiệu** ("libsrt pin >=1.5.6 (vá CVE-2026-55868/55869)") — nghĩa là lỗi phát sinh khi transcribe từ memlog sang spine (Stack table), không phải lỗi nghiên cứu gốc. Đây chính là loại lỗi mà rubric "kiểm tra các dòng verified web" được thiết kế để bắt.

**Đề xuất fix**: sửa dòng Stack table libsrt, đổi `CVE-2026-55840`→`CVE-2026-55868`, `CVE-2026-55841`→`CVE-2026-55869`.

### Finding 3 [HIGH] — Capability → Architecture Map bỏ sót AD-4, AD-8 (và do đó cả AD-31) ở FR-1/FR-2/FR-4/FR-5

AD-4 tự khai `Binds: FR-1, FR-2, FR-4, FR-5`. AD-8 tự khai `Binds: FR-1, FR-2, FR-4`. Nhưng Capability Map hiện tại:

| FR | Map hiện tại | Thiếu |
| --- | --- | --- |
| FR-1 | AD-1, AD-2, AD-9, AD-11 | AD-4, AD-8 |
| FR-2 | AD-5, AD-10, AD-11 | AD-4, AD-8 |
| FR-4 | AD-2, AD-3 | AD-4, AD-8 |
| FR-5 | AD-6, AD-7, AD-9, AD-30 | AD-4 |

AD-4 và AD-8 hoàn toàn không xuất hiện ở BẤT KỲ dòng nào trong Capability Map, dù đây chính là AD quyết định "transport-core viết bằng gì, gọi Blackmagic/encode bằng cách nào" — trọng tâm của FR-2 (ABR/encode) và FR-4 (capture/playout) theo đúng câu hỏi review. Đây là gap có sẵn trước amendment (không phải do lần sửa AD-4/AD-31 gây ra), nhưng amendment lẽ ra là dịp để phát hiện/fix nó vì đúng 2 FR này nằm trong phạm vi review.

**Đề xuất fix (trả lời câu hỏi Q4 ở trên)**: thêm `AD-4, AD-8` vào FR-1/FR-2/FR-4 và `AD-4` vào FR-5. **Không cần thêm AD-31 riêng** — AD-31 không tự Binds FR nào (xem Finding 3b), việc truy vết AD-31 nên đi gián tiếp qua AD-4 (AD-4's Rule text đã tự dẫn "xem AD-31").

### Finding 3b [MEDIUM] — AD-31 là AD duy nhất có `Binds` trỏ vào AD khác thay vì FR

Toàn bộ 30 AD còn lại trong spine dùng field `Binds` để liệt kê FR (`FR-x`) hoặc `all`. Riêng AD-31: `**Binds:** AD-4, AD-5, AD-8, AD-10` — trỏ vào AD, không phải FR. Đây là lệch convention document-wide, và rất có thể chính là lý do khiến AD-31 (và gián tiếp AD-4/AD-8) bị bỏ sót khỏi Capability Map — vì bất kỳ script/quy trình nào scan field `Binds` để build Map tự động sẽ không thấy FR nào ở AD-31 để gắn.

**Đề xuất fix**: 1 trong 2 hướng — (a) đổi `Binds` của AD-31 thành các FR thực sự nó ảnh hưởng (probably FR-2, FR-4, giống AD-4/AD-8/AD-10), giữ nguyên phần diễn giải "làm rõ ranh giới với AD-4/AD-5/AD-8/AD-10" trong phần Rule/Prevents thay vì field Binds; hoặc (b) giữ nguyên nhưng thêm 1 dòng chú thích rằng field này là ngoại lệ có chủ đích (AD-31 là "clarifying AD", không phải "FR-governing AD" độc lập) — để reviewer sau không nhầm là lỗi.

### Finding 4 [MEDIUM] — Static-link hay dynamic-link libav*/libsrt chưa được quyết, ảnh hưởng trực tiếp deployment 40 máy

AD-4 nói "link trực tiếp thư viện FFmpeg... vào trong tiến trình C++" — nhưng không nói static hay dynamic linking. Đây là quyết định có tác động vận hành thật: nếu dynamic-link, mỗi máy trong 40 máy transport-core (Windows) cần kèm đúng bộ `avformat*.dll/avcodec*.dll/avdevice*.dll/avutil*.dll/swscale*.dll/...` khớp version 8.1.2 pin, cộng nguy cơ DLL bị ghi đè/thiếu khi mở rộng pilot→20 kênh (tương tác trực tiếp với Deferred "cơ chế update/patch 40 máy" — nhưng mục Deferred đó nói chung chung "copy thủ công + restart Service", không đề cập gì tới việc có cần copy kèm DLL runtime hay không). Nếu static-link, binary lớn hơn nhưng deploy đơn giản hơn (1 file exe/máy, khớp tinh thần "copy thủ công" đã ghi trong Deferred).

**Đề xuất fix**: thêm 1 dòng vào AD-4 hoặc AD-31 (hoặc 1 dòng Deferred mới nếu chưa muốn quyết ngay): "build FFmpeg static-link vào transport-core.exe (ưu tiên đơn giản hoá deploy 40 máy, khớp Deferred update/patch thủ công)" — hoặc nếu dynamic, note rõ danh sách DLL cần kèm theo mỗi lần copy thủ công.

### Finding 5 [LOW] — Vai trò `libavformat` không được gán chủ sở hữu tường minh trong AD-31

AD-4's Rule liệt kê 3 thư viện cùng lúc: *"link trực tiếp thư viện FFmpeg (`libavformat`/`libavcodec`/`libavdevice`)"*. AD-31 (ra đời để làm rõ ranh giới) chỉ gán rõ 2/3: `source/`→avdevice, `pipeline/`→avcodec — và chỉ nhắc `libavformat` theo hướng phủ định ("`srt/`... không qua libavformat"). Không có dòng nào nói `libavformat` API thực sự được gọi ở đâu.

Về mặt kỹ thuật, module decklink trong `libavdevice` được đăng ký và điều khiển qua chính API của `libavformat` (`avformat_open_input`, `av_read_frame`, v.v. — avdevice tự nó không có API độc lập, nó plug vào avformat) — nên trên thực tế `source/` gần như chắc chắn cũng phải gọi API `libavformat` để lái `libavdevice`. Việc AD-31 không nói rõ điều này để lại 1 khoảng mù: người review code sau này thấy `#include <libavformat/avformat.h>` trong `source/` có thể tưởng nhầm là vi phạm ranh giới (vì đọc AD-31 tưởng `source/` chỉ được dùng avdevice).

**Đề xuất fix**: thêm 1 câu vào AD-31: *"`source/` gọi cả API `libavformat` (bắt buộc để điều khiển `libavdevice`, vì avdevice không có API độc lập) lẫn `libavdevice` (đăng ký decklink) — đây KHÔNG phải muxing/demuxing container, chỉ là cơ chế bắt buộc của FFmpeg để expose thiết bị capture."*

### Finding 6 [INFO] — React version pin thiếu rigor tương đương libsrt

Spine pin libsrt rất chặt (≥1.5.6, có lý do CVE tường minh — dù sai số hiệu, xem Finding 2). React chỉ ghi "19.2.x" không pin patch tối thiểu. Thực tế có 1 RCE CVSS 10.0 ("React2Shell", CVE-2025-55182) ảnh hưởng React 19.0–19.2.0 (React Server Components/Flight protocol), vá ở 19.2.1+. Rủi ro này **nhiều khả năng KHÔNG áp dụng** cho dashboard-frontend (mô tả trong spine là "React, trình duyệt TV wall" — SPA client-side thuần, không thấy nhắc RSC/Next.js ở đâu trong spine) — nhưng spine không có 1 dòng nào loại trừ tường minh, khác hẳn cách libsrt được xử lý.

**Đề xuất fix (không bắt buộc)**: thêm nửa câu vào Stack table dòng React: *"19.2.x, ≥19.2.1 (loại trừ CVE-2025-55182 React2Shell — không áp dụng vì dashboard-frontend là SPA thuần, không dùng React Server Components, nhưng pin patch tối thiểu để tránh nhầm lẫn sau này)."*

---

## Tổng kết

| # | Finding | Mức độ | Bắt buộc fix trước khi coi amendment "closed"? |
| --- | --- | --- | --- |
| 1 | AD-8 vs AD-31 mâu thuẫn scope `BlackmagicSource` (input vs input/output) | HIGH | Có |
| 2 | Sai số hiệu CVE libsrt trong Stack table (55840/41 → phải là 55868/69) | HIGH | Có |
| 3 | Capability Map thiếu AD-4/AD-8 ở FR-1/2/4/5 | HIGH | Có |
| 3b | AD-31 `Binds` trỏ AD thay vì FR, lệch convention | MEDIUM | Nên |
| 4 | Static/dynamic link libav* chưa quyết | MEDIUM | Nên (trước khi bắt đầu code pilot) |
| 5 | `libavformat` không có chủ sở hữu tường minh trong AD-31 | LOW | Nên |
| 6 | React thiếu pin patch/loại trừ CVE tường minh | INFO | Tuỳ chọn |

Không finding nào ở mức FAIL toàn spine — paradigm, Stack table (trừ Finding 2), Structural Seed (trừ phản chiếu Finding 1) đều nhất quán và enforceable. Khuyến nghị: xử lý Finding 1–3 trước khi đóng dấu amendment này là final; Finding 3b/4/5 có thể gộp vào cùng 1 lần sửa nhỏ tiếp theo; Finding 6 tuỳ chọn.
