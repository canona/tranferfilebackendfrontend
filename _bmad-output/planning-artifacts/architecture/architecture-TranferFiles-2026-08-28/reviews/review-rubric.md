---
title: Review (rubric walker) — ARCHITECTURE-SPINE SRT Transport & Monitoring VTCDigital
reviewer: independent (Claude, sub-agent review)
target: architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md
reference: prd-TranferFiles-2026-08-28/prd.md
date: 2026-08-28
---

# Review Rubric — ARCHITECTURE-SPINE (SRT Transport & Monitoring VTCDigital)

## Verdict tổng quát

Spine có chất lượng khá cao — 28 AD, mỗi AD có Binds/Prevents/Rule rõ ràng, Capability→Architecture Map phủ đủ FR-1..FR-14, Stack có "verified web" kèm ngày cho phần lớn tech nêu tên. Tuy nhiên có **1 mâu thuẫn nội tại nghiêm trọng** giữa AD-2 (1 máy trung tâm = 1 kênh, đối xứng 1:1) và AD-7 (file passphrase phía trung tâm là *index cả 34 passphrase* theo channel-id) — điều này vừa gây mơ hồ triển khai (file đó nằm ở đâu: trên từng máy trung tâm hay 1 nơi tập trung?) vừa **làm vô hiệu chính lý do bảo mật "hạn chế blast radius" mà AD-6/PRD §5 dựa vào** (nếu mỗi trong 34 máy trung tâm đều giữ index 34 passphrase, lộ 1 máy = lộ toàn bộ 34 khoá). Ngoài ra, dimension "deployment & environments / operations" gần như bị bỏ lặng hoàn toàn (không quyết, không hoãn, không nêu open question) — vi phạm trực tiếp yêu cầu rubric. AD-19 và mục Deferred cũng lệch nhau về thời điểm bắt buộc chốt RACI passphrase (trước pilot go-live hay trước khi mở rộng 34 kênh). Khuyến nghị: sửa 3 điểm trên trước khi dùng spine này làm input cho epic/story.

---

## 1. Spine có fix đúng các điểm phân kỳ thật sự cho tầng dưới, không bỏ sót?

Phần lớn điểm phân kỳ kỹ thuật quan trọng (ngôn ngữ, OS, codec, boundary transport/dashboard, state machine, ring buffer, ack ownership, grid position...) đều đã có AD tương ứng, đủ chi tiết để 2 dev độc lập build ra cùng 1 kết quả. Tuy nhiên phát hiện các điểm phân kỳ **chưa được fix** hoặc **fix mâu thuẫn**:

### Finding 1 (Nghiêm trọng) — AD-2 vs AD-7: mô hình lưu passphrase phía trung tâm mâu thuẫn với mô hình triển khai vật lý

- **AD-2** (dòng 42-46): "Trung tâm gồm 34 máy vật lý riêng biệt, đối xứng 1:1 với 34 máy tại đài; **mỗi máy trung tâm nhận đúng 1 kênh** qua đúng 1 card DeckLink. Không gộp nhiều kênh trung tâm vào chung một máy vật lý."
- **AD-7** (dòng 72-76) + Consistency Conventions (dòng 220): "Trung tâm: 1 file config mã hoá DPAPI chứa **index 34 passphrase theo channel-id**." (đối xứng với đài: "1 file config... chứa passphrase riêng của kênh đó" — tức chỉ 1 khoá).
- **Vấn đề:** Nếu mỗi máy trung tâm chỉ xử lý đúng 1 kênh (AD-2), nó không có lý do nghiệp vụ nào để cần index của cả 34 passphrase — nó chỉ cần đúng 1 passphrase của kênh mình phụ trách, y hệt mô hình phía đài. Việc AD-7 quy định máy trung tâm giữ index 34 khoá:
  1. **Không rõ ràng về vị trí triển khai**: file đó nằm trên *từng máy trong 34 máy trung tâm* (đồng bộ hoá 34 bản sao mỗi khi 1 khoá đổi?), hay trên 1 máy tập trung nào đó chưa được mô hình hoá ở đâu khác trong spine? Đây là loại mơ hồ khiến 2 team build lệch nhau (1 bên build loader single-passphrase per máy, 1 bên build loader multi-passphrase index).
  2. **Xung đột trực tiếp với lý do bảo mật ở AD-6/PRD §5**: "Mỗi kênh có passphrase riêng... hạn chế phạm vi ảnh hưởng nếu một khoá bị lộ." Nếu mỗi trong 34 máy trung tâm đều giữ index toàn bộ 34 khoá, thì lộ/compromise **1 máy trung tâm** = lộ **toàn bộ 34 passphrase** — đúng thứ mà kiến trúc tuyên bố ngăn chặn. AD-7 hiện tại **không enforce được Prevents của chính nó** ("passphrase lệch mapping giữa các kênh") theo cách an toàn, mà tạo ra rủi ro blast-radius lớn hơn nhiều so với chủ đích.
- **Khuyến nghị sửa**: đối xứng hoá AD-7 với AD-2 — mỗi máy trung tâm chỉ giữ đúng 1 passphrase của kênh mình (giống đài), loại bỏ khái niệm "index 34 passphrase" khỏi runtime của máy trung tâm; nếu cần 1 kho tổng để provisioning/backup thì phải nói rõ đó là artifact ở tầng vận hành/CM, không phải file runtime trên máy sản xuất.

### Finding 2 (Trung bình) — Envelope không có version field dù AD-11 tự nêu lý do "khó redeploy đồng bộ"

AD-11 (dòng 96-100) lấy chính lý do "Logic ngưỡng/debounce/cooldown lặp lại và lệch nhau giữa 34 điểm triển khai transport-core (**khó redeploy đồng bộ**)" làm Prevents. Nhưng Consistency Conventions (dòng 219) định nghĩa envelope tối thiểu (`channel_id`, `timestamp`, `event_type`, `payload`) **không có trường version/schema-version**. Khi 68 máy transport-core không thể redeploy đồng bộ (chính điều AD-11 thừa nhận), việc mở rộng envelope sau này (thêm field mới) sẽ không có cách nào để dashboard-backend phân biệt "máy cũ chưa update" với "dữ liệu lỗi thiếu field" — đây là đúng loại phân kỳ triển khai mà AD này lẽ ra phải lường trước nhưng chưa fix.

---

## 2. Mọi AD's Rule có enforceable và ngăn được đúng Prevents đã nêu?

Đa số AD (AD-1, AD-2, AD-3, AD-5, AD-9, AD-13, AD-14, AD-16, AD-17, AD-18, AD-22, AD-23, AD-26, AD-27, AD-28) có Rule cụ thể, đo/kiểm được, khớp Prevents.

Ngoại lệ đáng chú ý:

- **AD-7** — như Finding 1, Rule hiện tại **không ngăn được** rủi ro thực sự (lộ 1 máy = lộ toàn bộ khoá) mà lẽ ra phải ngăn theo tinh thần AD-6/PRD §5.
- **AD-8** — Rule "`FileMediaSource` chỉ dùng cho mục đích test/dev" là quy ước convention-level, không có cơ chế enforce (build flag, config gate, hoặc kiểm tra runtime chặn dùng ở máy production) — rủi ro thấp nhưng đáng ghi chú vì Prevents nói rõ lo ngại "nhầm lẫn input file-based là fallback production".
- **AD-19** — xem Finding 3 dưới đây: Rule của chính AD-19 mâu thuẫn với mục Deferred về RACI passphrase.

### Finding 3 (Nghiêm trọng) — AD-19 đặt sai thời điểm gate của RACI passphrase, mâu thuẫn với Deferred và PRD §5

- **PRD §5** (dòng 259-261): "**Điều kiện tiên quyết trước khi pilot go-live**... Phải chốt tối thiểu một RACI cho vòng đời passphrase."
- **Deferred trong spine** (dòng 306): "RACI vòng đời passphrase... **phải chốt trước pilot go-live** (không chờ spine này)." — khớp đúng PRD.
- **AD-19** (dòng 144-148): "Mở rộng lên 34 kênh chỉ sau khi: (a) tiêu chí ổn định đạt, (b) FR-13/FR-14 hoàn thiện đầy đủ, **(c) RACI passphrase đã chốt**." — đặt RACI làm gate cho **mở rộng lên 34 kênh**, không phải gate cho pilot 1-kênh go-live.
- **Vấn đề**: Đây là mâu thuẫn trực tiếp giữa 2 phần trong cùng 1 tài liệu (AD-19 vs Deferred) và giữa spine với PRD §5. Story/epic viết theo AD-19 sẽ cho phép pilot 1-kênh go-live mà chưa cần RACI — trái với PRD gốc và trái với chính mục Deferred vài chục dòng bên dưới. Đây chính xác là loại "điểm phân kỳ chưa fix" (2 team đọc 2 phần khác nhau của spine sẽ lên kế hoạch khác nhau).
- **Khuyến nghị sửa**: bổ sung RACI đã chốt làm điều kiện tiên quyết ngay của pilot go-live trong Rule của AD-19, tách biệt rõ với điều kiện mở rộng 34 kênh.

---

## 3. Có gì dưới Deferred mà thực ra để 2 unit độc lập build lệch nhau (Deferred quá tay)?

Rà soát từng mục Deferred (dòng 300-311):

- OQ-3 (ranh giới hạ tầng mạng), OQ-5 (escalation), OQ-8/OQ-9 (bù thị giác/rủi ro loa), Portal/API, Time-series DB, Message broker, Dashboard riêng cho đài — tất cả đều **không** phải điểm gây build-lệch ở tầng transport-core/dashboard hiện tại, vì đã có AD khác đóng cứng behavior tương ứng (VD: AD-13 đã chốt "không broker" nên việc "cân nhắc broker sau" không tạo mơ hồ hiện tại; AD-28 đã đóng cứng "không dashboard riêng cho đài" nên mục Deferred đó chỉ là ghi chú lịch sử, không phải quyết định còn treo).
- **HEVC**: an toàn, vì AD-5 đã khoá cứng H.264 cho MVP#1, không có ngã ba nào để 2 team đi 2 hướng khác nhau ở giai đoạn này.
- **Tiêu chí "ổn định" cụ thể**: đây là mục Deferred *có rủi ro thấp* vì ảnh hưởng story rollout-mở-rộng (không phải story build lõi) và có đề xuất mặc định ghi trong memlog — chấp nhận được ở mức spine, miễn story rollout-34-kênh phải treo lại đúng open question này thay vì tự đoán số.
- **RACI passphrase**: bản thân việc defer là hợp lý (đúng là business process, không phải quyết định kiến trúc) — nhưng như Finding 3, vấn đề không phải "defer quá tay" mà là *nội dung defer bị nhắc lại sai lệch ở AD-19*.

Không phát hiện thêm mục Deferred nào khác nên được nâng cấp thành AD.

---

## 4. Tech nêu tên đã verify current chưa (Stack, "verified web" + ngày)?

| Tech | Có "verified web" + ngày? |
| --- | --- |
| libsrt ~1.5.4/1.5.6 | Có — verified web 2026-08-28 |
| Blackmagic SDK 16.3 | Có — verified web 2026-08-28 |
| Node.js 24.x | Có — verified web 2026-08-28 |
| React 19.2.x | Có — verified web 2026-08-28 |
| Windows 10/11/Server | Không verify cụ thể, nhưng **có ghi rõ lý do hoãn** ("xác nhận bản cụ thể khi code hoá") — chấp nhận được |
| `ws` (Node WebSocket lib) | Không verify version, nhưng cũng ghi rõ "bản hiện hành npm tại thời điểm code hoá" — chấp nhận được |

### Finding 4 (Nhẹ) — H.264 encoder không có version lẫn ghi chú hoãn

Dòng "H.264 encoder | x264 (software) / NVENC, QuickSync, AMF (hardware, tuỳ máy)" là dòng **duy nhất** trong Stack không có version, không có "verified web + ngày", và cũng không có câu ghi chú kiểu "xác nhận khi code hoá" như 2 dòng Windows/`ws` bên trên — không nhất quán về cách xử lý "chưa chốt version" so với phần còn lại của bảng Stack. Nên bổ sung version tối thiểu cho x264 (hoặc ít nhất câu ghi chú tương tự Windows/`ws`).

---

## 5. Spine có cover đủ capabilities của PRD (Capability → Architecture Map)?

Map (dòng 281-298) phủ đầy đủ FR-1 → FR-14, không bỏ sót capability nào ở cấp FR. FR-13/FR-14 được ủy quyền hợp lý sang UX spine (đúng vì đó là invariant UI, không phải kiến trúc hệ thống) và ghi rõ bị lược khỏi pilot theo AD-19 — nhất quán với PRD §7.3.

Một khoảng hở nhỏ: PRD §4.1 có "Feature-specific NFRs" dưới FR-5 (ngân sách latency ≤1s, thứ tự ưu tiên tối ưu SRT-buffer/encode/network/AES) — đây là 1 ràng buộc thiết kế quan trọng (ảnh hưởng trực tiếp SM-2) nhưng không xuất hiện như 1 dòng riêng trong Capability Map, dù được vá một phần qua AD-19 (yêu cầu benchmark RTT/latency trong 1-2 ngày đầu pilot) và AD-10 (quy tắc ưu tiên continuity vs latency khi ABR active). Vì AD-19 đã đưa việc benchmark vào rule, khoảng hở này ở mức nhẹ, không chặn triển khai, nhưng nên ghi chú tường minh trong Map rằng NFR-latency-budget "được vận hành hoá qua AD-10 + AD-19 (benchmark gate)" để tránh người đọc sau này nghĩ rằng ngân sách latency thứ tự ưu tiên (SRT buffer ≥3xRTT...) chưa có chủ sở hữu kiến trúc.

---

## 6. Deployment & environments / infra-provider strategy / operations — quyết, hoãn, hay bị bỏ lặng?

Đây là điểm yếu rõ nhất của spine theo rubric.

### Đã có (rải rác, không tập trung thành 1 khu vực riêng):
- **Placement/topology**: AD-2 (34 máy trung tâm vật lý riêng), AD-12 (dashboard trên máy riêng, tách khỏi 68 máy transport) — quyết định rõ.
- **Network exposure**: AD-28 (dashboard chỉ LAN nội bộ, không internet), AD-13 (LAN trực tiếp, không broker) — quyết định rõ.
- **Process supervision**: AD-3 (Windows Service + auto-restart cho transport-core), AD-27 (tương tự cho dashboard-backend) — đây là phần "operations" duy nhất được quyết tường minh.

### Finding 5 (Trung bình-nặng) — Deployment/release mechanism cho 68+1 máy vật lý bị bỏ lặng hoàn toàn

Không có AD, không có Deferred, không có Open Question nào đề cập:
- Cơ chế cài đặt/cập nhật phần mềm transport-core lên 34 máy đài + 34 máy trung tâm (thủ công copy? installer/MSI? config templating cho từng máy?) — đặc biệt quan trọng vì AD-19 (rollout pilot 1 → 34 kênh) ngụ ý sẽ phải nhân bản việc triển khai này 33 lần nữa, nhưng spine không nói triển khai lần 2 trở đi khác gì lần đầu.
- Không có khái niệm environment tách biệt (dev/test/staging vs production) — pilot 1 kênh gần như đóng vai trò "staging" trên thực tế nhưng điều này không được spine gọi tên hay quyết định tường minh.
- Không có chiến lược logging/observability tổng quát cho vận hành 68 máy (ngoài structured log riêng cho `handshake_reject` ở AD-6/Consistency Conventions) — không có gì cho lỗi encode, lỗi DeckLink, crash dump, hay cách đội vận hành debug 1 máy đài xa khi có sự cố ngoài phạm vi dashboard.
- Không có chiến lược backup/DR cho các file config tĩnh quan trọng (`channel-registry`, passphrase DPAPI files) — đây là single point of failure vật lý trên từng máy, không được nhắc tới dù chúng chứa dữ liệu vận hành thiết yếu.

Theo rubric, dimension này **phải** được quyết/hoãn/open-question tường minh — hiện tại nó hoàn toàn vắng bóng (không nằm trong AD, không nằm trong Deferred, không nằm trong Open Questions kế thừa từ PRD dù PRD cũng không có mục riêng cho việc này — tức spine đáng lẽ phải tự phát hiện khoảng hở này ở tầng kiến trúc, vì đây thuộc altitude "feature/kỹ thuật" mà spine sở hữu, không phải PRD).

**Khuyến nghị**: bổ sung tối thiểu 1 AD hoặc 1 mục Deferred tường minh về (a) cơ chế deploy/update phần mềm ra 68 máy vật lý, (b) chiến lược logging/diagnostics vận hành ngoài phạm vi dashboard, (c) backup cho config files thiết yếu (registry, passphrase) — kể cả khi câu trả lời là "hoãn tới sprint planning", nó cần được ghi rõ thay vì im lặng.

### Infra/provider strategy
Được ngụ ý rõ ràng là on-premise 100% (không cloud) qua mô tả vật lý (34+34 máy, dashboard "1 máy riêng"), nhưng không có AD phát biểu tường minh "MVP#1 không dùng cloud/VM, toàn bộ on-prem". Vì suy luận từ toàn bộ spine là nhất quán và khó hiểu nhầm, đây là gap nhẹ, không nghiêm trọng như Finding 5 — nhưng nên thêm 1 câu tường minh nếu muốn đạt "quyết định rõ ràng, không chỉ ngụ ý" đúng tinh thần rubric.

---

## Bảng tổng hợp Findings

| # | Mức độ | AD/mục liên quan | Tóm tắt |
| --- | --- | --- | --- |
| 1 | Nghiêm trọng | AD-2 vs AD-7 | Passphrase index-34 ở "trung tâm" mâu thuẫn với mô hình 1 máy = 1 kênh; làm vô hiệu lý do "hạn chế blast radius" của AD-6/PRD §5 |
| 2 | Trung bình | AD-11, Consistency Conventions | Envelope không có version field dù AD-11 tự nêu lý do "khó redeploy đồng bộ" |
| 3 | Nghiêm trọng | AD-19 vs Deferred (RACI) vs PRD §5 | RACI passphrase: AD-19 gate cho mở-rộng-34-kênh, còn Deferred/PRD §5 yêu cầu chốt trước pilot go-live — mâu thuẫn thời điểm |
| 4 | Nhẹ | Stack — H.264 encoder | Thiếu version/"verified web"/ghi chú hoãn, không nhất quán với các dòng khác trong Stack |
| 5 | Trung bình-nặng | Toàn spine (không AD nào) | Deployment/update mechanism cho 68 máy, logging/observability vận hành, backup config — bị bỏ lặng hoàn toàn, không quyết/không hoãn/không open-question |
| 6 | Nhẹ | Toàn spine | Infra strategy "on-prem, không cloud" chỉ ngụ ý qua mô tả vật lý, chưa phát biểu tường minh thành 1 quyết định kiến trúc |

## Khuyến nghị ưu tiên

1. Sửa AD-7 để đối xứng với AD-2 (mỗi máy trung tâm giữ đúng 1 passphrase, không phải index 34) — đây là lỗ hổng bảo mật thực chất, không chỉ vấn đề văn bản.
2. Đồng bộ AD-19 với Deferred/PRD §5 về thời điểm bắt buộc chốt RACI passphrase (trước pilot go-live, không phải trước mở-rộng-34-kênh).
3. Bổ sung tối thiểu 1 AD hoặc mục Deferred tường minh cho deployment/update mechanism + logging vận hành + backup config trên 68 máy vật lý.
4. (Nhẹ) Thêm version/ghi chú hoãn cho dòng H.264 encoder trong Stack; thêm version field vào event envelope.
