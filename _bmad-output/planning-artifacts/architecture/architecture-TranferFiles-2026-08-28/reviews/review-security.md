---
name: 'Security Review — SRT Transport & Monitoring VTCDigital'
type: architecture-review
reviews: '_bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md'
reviewer: 'independent security reviewer (adversarial pass)'
created: '2026-08-28'
scope: 'AD-6, AD-7, AD-9, AD-28 và mọi AD chạm attack surface (AD-1, AD-2, AD-13, AD-25)'
---

# Review bảo mật độc lập — Architecture Spine SRT Transport & Monitoring

## Verdict

**CONDITIONAL PASS — không đủ chặt để go-live nếu không vá thêm 3 lỗ hổng chưa có mitigation kỹ thuật**: (1) DPAPI không có chiến lược recovery/backup cho 34 máy phân tán không domain-joined → mất máy = mất passphrase vĩnh viễn; (2) cơ chế "cảnh báo khả nghi dò passphrase" (AD-9) là alert-only, không có auto-throttle/block, nên không thực sự chống được brute-force hay volumetric DoS trên cổng SRT public-facing; (3) kênh LAN nội bộ (AD-13) và WebSocket ack-command (AD-25) ngầm định "trong LAN/trong kết nối sẵn có = tin cậy" mà không có xác thực/mã hoá riêng, tạo đường leo thang từ máy trung tâm bị compromise (chính là máy internet-facing) thẳng vào dashboard-backend.

Các AD còn lại (AD-6 áp AES bắt buộc + reject cứng, AD-28 cô lập dashboard khỏi internet) là quyết định đúng hướng và nên giữ nguyên; vấn đề nằm ở phần *thực thi/vận hành* của các AD này chưa được đặc tả đủ để chặn các kịch bản tấn công thực tế.

---

## 1. AD-6 — Passphrase là lớp phòng thủ duy nhất

**Đánh giá bối cảnh đã chốt**: chấp nhận passphrase-only làm lớp duy nhất (không network whitelist/VPN) là quyết định business đã chốt, không tranh luận lại. Nhưng "passphrase là lớp phòng thủ duy nhất" không đồng nghĩa "không được có bất kỳ cơ chế giảm thiểu volumetric/brute-force nào ở tầng vận hành" — hai việc này bị gộp lẫn trong spine.

**Gap:**
- AD-6 không đặt yêu cầu tối thiểu về **entropy/độ dài passphrase** (SRT hỗ trợ 10–79 ký tự). Không có rule → dễ bị chọn passphrase yếu khi vận hành thực tế bàn giao qua RACI (Deferred), làm brute-force khả thi hơn nhiều so với thiết kế giả định.
- Không có giới hạn **tốc độ handshake/connection attempt** ở tầng ứng dụng hoặc OS (ví dụ: giới hạn số lần bắt tay mỗi giây từ 1 nguồn, cookie/stateless-handshake trước khi tốn CPU cho crypto check). Đây không phải "IP whitelist/VPN" (network ACL theo địa chỉ tin cậy) mà là **rate-limiting chống lạm dụng**, hoàn toàn tương thích với ràng buộc đã chốt nhưng spine không đề cập, nên rất dễ bị hiểu nhầm/bỏ sót khi hiện thực hoá.
- SRT chạy trên UDP: handshake giả mạo (spoofed source) có thể ép server tốn tài nguyên xử lý crypto trước khi biết đúng/sai — đây là rủi ro DoS ở tầng giao thức mà "reject ngay, không tạo kết nối một phần" (đúng cho tính đúng đắn logic) không giải quyết được cho tính sẵn sàng (availability) khi bị flood.

**Khuyến nghị**: bổ sung 1 rule kỹ thuật (không phải network whitelist) về entropy tối thiểu passphrase, và về connection-rate-limit/backoff phía server độc lập với backoff phía actor client (xem mục 3).

## 2. AD-7 — Passphrase-at-rest qua Windows DPAPI: giới hạn cho 34 máy phân tán

Đây là finding **nghiêm trọng nhất** của review này.

**Cơ chế DPAPI**: `CryptProtectData`/`CryptUnprotectData` mã hoá dữ liệu bằng key dẫn xuất từ:
- **User scope (CRYPTPROTECT_LOCAL_MACHINE không set)**: gắn với user profile SID, master key dẫn xuất từ password hash của user đó. Đổi mật khẩu domain-reset hoặc migrate profile có thể làm hỏng khả năng decrypt nếu không đúng luồng.
- **Machine scope (CRYPTPROTECT_LOCAL_MACHINE)**: gắn với machine, dùng chung cho mọi user trên máy đó — phù hợp hơn cho Windows Service, nhưng master key này **chỉ được backup tự động lên Domain Controller nếu máy domain-joined**. 34 máy đài phân tán địa lý qua Internet công cộng gần như chắc chắn là **standalone/workgroup, không domain-joined** — nghĩa là machine DPAPI master key **không có backup nào ngoài chính máy đó**.

**Hệ quả trực tiếp cho use-case 34 máy phân tán**: máy hỏng ổ cứng, cài lại OS, hoặc thay máy → toàn bộ file config đã DPAPI-encrypt **không thể decrypt lại được, vĩnh viễn** (không phải "khó", mà là *cryptographically impossible* nếu không có domain backup key hay export thủ công master key trước đó). Kênh đó mất passphrase, phải cấp lại passphrase mới và phân phối lại tới đài tương ứng — đây là outage vận hành thực (không truyền được tín hiệu) cho tới khi RACI vòng đời passphrase (hiện đang Deferred) xử lý xong, nhưng đó là *phản ứng*, không phải *phòng ngừa*.

Spine hiện gán toàn bộ vấn đề này cho "RACI vòng đời passphrase — business process tách riêng" (Deferred). Đây là **phân loại sai**: khả năng phục hồi sau mất máy là câu hỏi kỹ thuật của chính cơ chế lưu trữ (AD-7), không phải quy trình cấp phát nghiệp vụ. Spine cần trả lời trước pilot mở rộng 34 kênh (AD-19 điều kiện (c) "RACI passphrase đã chốt" là chưa đủ nếu thiếu vế kỹ thuật này):

1. DPAPI scope nào được dùng — machine hay user? (ảnh hưởng trực tiếp tới việc Windows Service chạy dưới SYSTEM/service account nào có decrypt được không, và service account đổi thì sao).
2. Có cơ chế backup master key nào (export `ExportEncryptionInfo`/tự lưu offline secondary entropy) trước khi máy đi vào vận hành không, hay chấp nhận "mất máy = phải cấp lại passphrase" như 1 rủi ro đã biết?
3. Nếu chấp nhận rủi ro #2, cần ghi rõ nó vào spine (không chỉ Deferred) như 1 **Prevents/Rule tường minh**, để không bị hiểu nhầm là DPAPI "an toàn tuyệt đối" khi đọc lướt.

Ngoài ra: DPAPI chỉ chống đọc trộm passphrase bởi **user/tiến trình khác** trên cùng máy hoặc khi copy file sang máy khác — không chống lại attacker đã có quyền chạy mã dưới cùng context (SYSTEM/service account) của chính máy đó, tức là không bảo vệ gì thêm nếu máy đã bị compromise ở mức OS. Điều này acceptable cho threat model "bảo vệ file khi bị đánh cắp ổ đĩa/copy ra ngoài", nhưng spine nên nói rõ giới hạn này thay vì để ngầm hiểu "DPAPI = đủ an toàn".

## 3. AD-9 — Cảnh báo "khả nghi dò passphrase": không đủ chống brute-force/DoS

**Cơ chế hiện tại**: ≥5 lần reject/5 phút (theo actor/kênh, có field `source` trong log) → cảnh báo vận hành. Đây là **detective control** (giúp con người biết), không phải **preventive/reactive control** (không tự động làm gì để chặn tấn công đang diễn ra).

**Lỗ hổng cụ thể:**
- **Không có throttle/block tự động**: sau khi cảnh báo bắn ra, kẻ tấn công vẫn tiếp tục gửi handshake với tốc độ tuỳ ý — thời gian phản ứng của con người (phút→giờ) luôn chậm hơn tốc độ brute-force (hàng trăm/giây), nên cảnh báo chỉ có giá trị *biết được sau khi việc đã xảy ra*, không ngăn được việc đoán ra passphrase trước khi ai đó kịp phản ứng.
- **Backoff 2 nhánh (AD-9) chỉ áp cho actor hợp lệ tự quản lý retry của chính nó** (client thật bị reject do gõ sai config sẽ tự chờ lâu hơn) — hoàn toàn không ràng buộc kẻ tấn công bên ngoài, vì attacker không dùng state machine của hệ thống, họ tự viết client riêng và có thể gửi handshake nhanh tuỳ ý.
- **Low-and-slow bypass**: ngưỡng 5 lần/5 phút dễ bị né bằng cách giữ tốc độ dò dưới ngưỡng (ví dụ 4 lần/5 phút, kéo dài nhiều ngày) — với 34 kênh độc lập, đây vẫn là tấn công khả thi về mặt thời gian nếu passphrase yếu.
- **Không phân biệt/khoanh vùng theo nguồn để phản ứng chọn lọc**: log có field `source` (tốt cho điều tra), nhưng AD-9 không định nghĩa hành động dựa trên `source` (không có concept "chặn tạm nguồn X sau N lần reject"), nên giá trị phòng ngừa gần như bằng 0 dù có giá trị điều tra.
- **Không cover volumetric/spoofed-source DoS**: SRT trên UDP dễ bị flood bằng gói giả nguồn (không cần hoàn tất handshake để tốn băng thông/CPU phía server). Đếm "reject" chỉ tính các lần hoàn tất handshake sai passphrase — một cuộc tấn công DoS thuần bandwidth/UDP-flood sẽ không sinh đủ "reject" hợp lệ để trigger cảnh báo này, và spine không có mitigation nào khác cho lớp tấn công này.

**Khuyến nghị**: bổ sung 1 rule tách biệt (không vi phạm "không network whitelist/VPN") — connection-rate-limiting theo nguồn ở tầng ứng dụng/OS firewall rule tổng quát (không phải danh sách trắng cố định), và escalation tự động (tạm khoá nguồn N phút) khi vượt ngưỡng, thay vì chỉ alert. Nếu business quyết định không làm (chấp nhận rủi ro để giữ đơn giản MVP#1), cần ghi rõ đây là rủi ro tồn dư đã biết, không nên để ngầm hiểu AD-9 là "đủ chống brute-force".

## 4. AD-13 (LAN nội bộ) và AD-25 (WebSocket ack-command): "LAN nội bộ = an toàn" là giả định rủi ro

**Vấn đề cốt lõi**: chuỗi tấn công leo thang. Theo AD-2, mỗi máy trung tâm là máy vật lý riêng, **trực tiếp expose ra Internet công cộng** để nhận kết nối SRT (AD-1, AD-6). Theo AD-13, chính máy trung tâm này lại là client kết nối **không xác thực, không mã hoá riêng** (chỉ "WebSocket/TCP trực tiếp qua LAN nội bộ") vào dashboard-backend. Nếu 1 trong 34 máy trung tâm bị compromise qua bề mặt SRT-facing (lỗ hổng libsrt tự build, lỗ hổng OS/driver Blackmagic, hay chính passphrase bị lộ/brute-force thành công — xem mục 3), attacker có ngay bàn đạp mạng nằm **trong LAN nội bộ VTCDigital**, và AD-13 không có gì ngăn nó giả mạo telemetry hoặc tấn công trực tiếp dashboard-backend, vì:

- **Không có mutual authentication** giữa 34 máy trung tâm và endpoint dashboard-backend — "1 endpoint duy nhất" nghĩa là bất kỳ máy nào biết địa chỉ/port trên LAN đều connect được, không cần chứng minh là 1 trong 34 máy trung tâm hợp lệ.
- **Không yêu cầu TLS** (`wss://`) cho kênh này — Stack table chỉ ghi thư viện `ws`, không có rule bắt buộc TLS. Nếu 1 đoạn LAN bị compromise/sniff (kể cả do thiết bị mạng khác bị xâm nhập, không nhất thiết qua máy trung tâm), toàn bộ telemetry/snapshot JPEG/audio level bị lộ mà không cần giải mã.
- Hệ quả nghiêm trọng nhất: attacker kiểm soát 1 máy trung tâm có thể **giả telemetry "ok"** để che giấu sự cố thật đang xảy ra ở kênh đó (an toàn vận hành bị phá vỡ ngầm, đội trực không hề biết), hoặc dội alert giả (`critical` giả) trên toàn bộ 34 kênh gây "alert fatigue"/từ chối dịch vụ vận hành. Đây là vi phạm trực tiếp mục tiêu cốt lõi của cả hệ thống (giám sát đáng tin), mà AD-13 không có cơ chế nào chặn.

**AD-25 (ack-command)**: `operator_label` là text nhập tay, không xác thực danh tính (chính AD-25 tự gắn `[ASSUMPTION]` ghi nhận rủi ro này). Ngoài vấn đề accountability (ai thực sự ack không được đảm bảo — bất kỳ ai truy cập được dashboard-frontend, tức bất kỳ ai trong LAN/VPN nội bộ theo AD-28, có thể ack và mạo danh operator khác), kênh gửi ack-command dùng **chung WebSocket không xác thực** với luồng đọc — nên cùng rủi ro injection nếu WebSocket connection bị hijack/spoof trên LAN.

**Nhận xét thêm về AD-28**: cô lập dashboard khỏi internet là đúng hướng, nhưng dashboard-frontend tự nó **không có bất kỳ authentication layer nào** — toàn bộ access control dồn vào ranh giới mạng (LAN/VPN). Đây lặp lại đúng pattern "1 lớp phòng thủ duy nhất" giống AD-6 (passphrase), nhưng lần này không được spine gọi tên tường minh như 1 quyết định có chủ đích — nó là hệ quả ngầm của việc không có AD nào nói về auth cho dashboard UI. Nếu VPN nội bộ nói ở AD-28 là remote-access VPN cho nhân viên (không chỉ site LAN), thì "ai vào được VPN là vào được toàn quyền dashboard, ack được nhân danh bất kỳ ai" là rủi ro nên được ghi nhận tường minh, không chỉ ngầm định.

**Khuyến nghị**: (a) thêm shared-secret/token hoặc client-cert đơn giản cho kết nối máy trung tâm → dashboard-backend (mutual auth nhẹ, không cần PKI phức tạp cho MVP), (b) bắt buộc TLS (`wss://`) cho mọi WebSocket kể cả trong LAN, (c) ghi nhận rõ trong spine rằng máy trung tâm compromise = LAN nội bộ compromise, và liệt kê đây như 1 rủi ro tồn dư đã biết nếu quyết định không vá trong MVP#1.

## 5. Log/Audit trail — đủ để điều tra sự cố sau này?

**Điểm được**: log reject handshake structured (JSON lines: `timestamp, channel_id, event_type=handshake_reject, source, reason`) là nền tảng tốt cho điều tra brute-force.

**Thiếu sót:**
- **Không log handshake thành công**: chỉ log reject, không log connect thành công kèm `source`. Không có baseline "kênh A luôn connect từ IP X" để phát hiện anomaly khi passphrase bị lộ và attacker connect thành công từ nguồn lạ — đây chính là kịch bản nguy hiểm nhất (bypass thành công) mà log hiện tại mù hoàn toàn.
- **Ack history không phải audit trail bền vững**: theo AD-18/AD-25, `ack_label` tự xoá khi kênh phục hồi hoặc chuyển cảnh báo mới — nghĩa là hệ thống không giữ lịch sử "ai ack lúc nào cho sự cố nào" lâu dài, chỉ có giá trị hiển thị tức thời. Điều tra sau sự cố (post-incident review) cần biết chuỗi ack theo thời gian, nhưng thiết kế hiện tại không có store append-only riêng cho việc này.
- **Không có log/store cho alert đã gửi** (Telegram/Email) trong chính dashboard-backend — nguồn sự thật duy nhất là lịch sử chat/email client bên ngoài, không có nguồn nội bộ để đối chiếu khi điều tra "hệ thống có gửi cảnh báo đúng lúc không".
- **Không có centralized log shipping** cho 34+34+1 máy phân tán địa lý — log structured được nói tới nhưng không rõ lưu ở đâu/gửi đi đâu. Khi 1 máy đài/trung tâm nghi bị compromise, log cục bộ trên chính máy đó có thể không còn tin cậy (attacker có thể xoá/sửa) hoặc máy offline không truy cập được — không có remote/append-only log sink nào được kiến trúc hoá.
- **Không log lỗi decrypt DPAPI** (trường hợp máy cài lại/đổi service account không decrypt được passphrase) — đây là blind spot vận hành liên quan trực tiếp tới finding #2.
- **Không có retention/rotation policy** cho log — không rõ giữ bao lâu, đủ cho điều tra sự cố xảy ra vài tuần trước không.

**Khuyến nghị**: bổ sung (a) log connect thành công kèm source cho mọi channel, (b) audit store riêng append-only cho ack-command (tách khỏi channel state transient), (c) tối thiểu ghi nhận trong spine rằng log cần remote/centralized shipping ra khỏi máy phát sinh log đó (không bắt buộc chọn công cụ, nhưng phải là 1 invariant).

---

## Tổng hợp mức độ nghiêm trọng

| # | Finding | AD liên quan | Mức độ |
| --- | --- | --- | --- |
| 1 | DPAPI không có chiến lược recovery/backup key cho máy standalone (không domain) — mất máy = mất passphrase vĩnh viễn, và scope (machine/user) + service account chưa được chốt | AD-7 | **Cao** |
| 2 | Cảnh báo dò passphrase (AD-9) là alert-only, không throttle/block tự động — không chống được brute-force tốc độ cao lẫn low-and-slow | AD-9, AD-6 | **Cao** |
| 3 | AD-13 (LAN) và AD-25 (WebSocket) không có xác thực/mã hoá riêng — máy trung tâm bị compromise (chính là máy internet-facing) mở đường thẳng vào dashboard-backend, có thể giả telemetry/ack | AD-13, AD-25, AD-1, AD-2 | **Cao** |
| 4 | Không có rule về entropy/độ dài passphrase tối thiểu, và chưa phân biệt rõ "rate-limit chống lạm dụng" (được phép) với "network whitelist/VPN" (đã loại trừ) | AD-6 | Trung bình |
| 5 | Log thiếu handshake thành công + audit ack bền vững + không centralized — hạn chế khả năng điều tra sự cố sau này | AD-6 (log), AD-25 | Trung bình |
| 6 | Dashboard-frontend không có authentication layer riêng, chỉ dựa network perimeter (LAN/VPN) — cùng pattern rủi ro như AD-6 nhưng không được gọi tên tường minh | AD-28 | Trung bình |
| 7 | SRT/UDP dễ bị volumetric/spoofed-source DoS, cơ chế đếm reject của AD-9 không cover lớp tấn công này | AD-6, AD-9 | Trung bình |

## Kết luận

Các quyết định lớn (AES bắt buộc, reject cứng không tạo kết nối một phần, cô lập dashboard khỏi internet) đúng hướng. Rủi ro thực sự nằm ở **khoảng trống giữa "quyết định chính sách" và "cơ chế thực thi"**: DPAPI được chọn nhưng chưa tính đường phục hồi cho fleet phân tán; cảnh báo dò passphrase được thiết kế nhưng chỉ dừng ở mức thông báo; và ranh giới tin cậy LAN nội bộ được giả định an toàn trong khi chính nó tiếp giáp trực tiếp với 1 máy internet-facing per kênh. Khuyến nghị chốt 3 gap Cao (mục 1–3) trước khi cho phép AD-19 mở rộng từ pilot 1 kênh lên 34 kênh, vì ở quy mô 34 máy phân tán, xác suất ít nhất 1 máy gặp sự cố phần cứng hoặc bị dò passphrase trong vòng đời vận hành là không nhỏ.
