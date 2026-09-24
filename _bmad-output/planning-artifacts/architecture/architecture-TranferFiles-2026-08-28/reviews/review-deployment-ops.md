---
name: review-deployment-ops
type: architecture-review
reviewer-lens: deployment / environments / operations (độc lập)
target: ARCHITECTURE-SPINE.md (architecture-TranferFiles-2026-08-28)
status: draft
created: '2026-08-28'
---

# Review — Deployment / Environments / Operations

## Verdict

**FAIL có điều kiện (conditional fail)** — spine giải quyết tốt kiến trúc runtime của *một node đang chạy* (state machine, resilience của tiến trình, ranh giới transport↔dashboard), nhưng ở altitude=feature, spine **bỏ sót gần như toàn bộ quyết định "làm sao 68 node đó lên đời, được vá lỗi, được quan sát vận hành, và được rollback"** — đây là những quyết định ảnh hưởng trực tiếp đến 34→34 máy vật lý phân tán và không thể hoãn tới lúc code hoá vì chúng định hình cách đóng gói, cách viết Windows Service, và cách log/telemetry được thiết kế ngay từ AD-3/AD-27. Một số mục có thể chấp nhận là "ngoài phạm vi altitude=feature", nhưng ít nhất 3/5 câu hỏi (update/patch, monitoring hạ tầng, rollback) lẽ ra phải xuất hiện như AD hoặc như mục Deferred tường minh — hiện tại chúng **không được nhắc tới ở bất kỳ hình thức nào** (không AD, không Deferred, không Open Question), nên không thể coi là "đã cân nhắc và hoãn có chủ đích".

## Đối chiếu 5 câu hỏi bắt buộc

### 1. Update/patch transport-core trên 68 máy phân tán — GAP nghiêm trọng, không được nhắc tới

- Spine định nghĩa transport-core chạy dưới Windows Service (AD-3) với auto-restart, nhưng **không có bất kỳ AD nào nói về cơ chế deploy bản build mới lên 68 máy** (đài ở xa qua Internet công cộng — AD-6/sơ đồ SRT/AES qua Internet — và trung tâm qua LAN nội bộ).
- Không nhắc: build artifact là gì (MSI? binary + script copy tay? self-extracting installer?), ai/cái gì đẩy bản cập nhật lên 34 máy đài (thường không có VPN/RMM sẵn — spine không đề cập), có cần dừng Windows Service thủ công tại từng máy đài hay không.
- AD-7 (passphrase DPAPI) và AD-24 (channel-registry file) là **per-machine local state** — bất kỳ cơ chế update nào cũng phải không được ghi đè các file này, nhưng spine không nêu invariant "update procedure không được đụng tới file cấu hình local". Đây là rủi ro cụ thể: một AD (ví dụ "update package không bao gồm/không ghi đè `config/`") lẽ ra nên tồn tại ngay bây giờ vì nó ràng buộc cấu trúc thư mục `transport-core/app/` đã vẽ trong Structural Seed.
- Kết luận: đây không phải chi tiết "để lúc code hoá" — nó ảnh hưởng ngược lên đóng gói (packaging), lên cấu trúc thư mục, và lên việc 34 đài (thường ở xa, kết nối Internet công cộng, khả năng cao không có RMM/domain join) update như thế nào là câu hỏi kiến trúc thực sự, không phải câu hỏi thao tác vận hành đơn thuần.

### 2. Monitoring/observability cho CHÍNH hệ thống (không phải tín hiệu kênh) — GAP nghiêm trọng

- Toàn bộ AD-11/AD-15/AD-17 chỉ nói về giám sát **tín hiệu truyền dẫn** (bitrate/RTT/connection-state/audio level) — đây là business monitoring, không phải infra monitoring.
- Không có AD nào về:
  - Health-check tiến trình transport-core tự thân (ngoài "Windows Service auto-restart" — AD-3/AD-27 nói tiến trình tự phục hồi, nhưng không nói **ai biết** là nó vừa crash-restart 10 lần trong 1 giờ, CPU/RAM/disk của 68 máy vật lý, hay máy vật lý bị mất điện/mất kết nối OS hoàn toàn khác với "kênh disconnected").
  - Log tập trung: AD-6 chỉ định "log reject handshake dạng structured JSON lines" nhưng **không nói log này ở đâu** — local disk mỗi máy? Có gửi về trung tâm không? Convention bảng "State & cross-cutting" mô tả format log nhưng không mô tả nơi lưu/thu thập/xoay vòng (log rotation) — nếu chỉ ghi local trên 68 máy, khi có sự cố đội vận hành phải remote vào từng máy đọc log, không scalable ngay ở pilot 1 kênh chứ đừng nói 34 kênh.
  - Phân biệt "máy vật lý transport-core chết/mất kết nối OS" với "kênh disconnected do SRT". AD-16 xử lý disconnected toàn cục ở tầng dashboard (mất kết nối event stream), nhưng đó là dashboard-frontend mất kết nối tới dashboard-backend — không phải giám sát 68 máy transport-core có đang sống hay không ở mức OS/process. Một máy trung tâm bị crash toàn bộ (không chỉ actor kênh) có thể biểu hiện giống hệt "signal loss" trên dashboard — đội vận hành sẽ không phân biệt được đó là sự cố phần cứng/OS máy trung tâm hay sự cố đường truyền, dẫn đến chẩn đoán sai và kéo dài MTTR.
- Đây là gap quan trọng nhất trong 5 câu: AD-27 nói "Dashboard-backend resilience tương đương transport-core" nhưng không có AD tương ứng nói "vận hành cần thấy được sức khoẻ hạ tầng của toàn bộ 68 máy" — tức là tự giám sát hệ thống giám sát chưa có, trong khi PRD/spine đặt nặng yêu cầu giám sát 24/7 (AD-17 gọi đội trực).

### 3. Môi trường staging/test phía trung tâm/dashboard — GAP một phần, không nhất quán với AD-8

- AD-8 (Source abstraction, `FileMediaSource`) chỉ giải quyết test *input* phía đài — cách ly capture khỏi pipeline để test không cần tín hiệu SDI sống. Đây là điểm tốt, nhưng chỉ là **một nửa** bài toán.
- Không có tương đương cho:
  - Trung tâm: không có abstraction/mô phỏng cho SDI out (Blackmagic Studio 4K output) khi test — không rõ làm sao verify pipeline end-to-end (đài→trung tâm→output) mà không cần 2 máy vật lý thật + card Blackmagic thật đã gắn dây.
  - Dashboard-backend/frontend: không có staging environment nào được nhắc — dashboard nhận telemetry qua WebSocket/TCP thật từ 34 máy trung tâm (AD-13); không có cách nào giả lập 34 nguồn telemetry để test debounce/threshold/cooldown/UI trước khi đấu nối máy thật. Đây là thiếu sót đáng chú ý vì AD-11 đặt toàn bộ business logic (debounce/threshold/cooldown) tập trung ở dashboard-backend — logic phức tạp nhất của cả hệ thống — mà không có cách nào test nó độc lập với 34 máy trung tâm vật lý.
  - Không có mock/stub cho event-contract (dashboard-backend "core" hexagonal có ports rõ ràng — AD-20/AD-27 — về lý thuyết dễ test đơn vị qua ports, nhưng spine không nói rõ điều này như một invariant/expectation, dù kiến trúc hexagonal sẵn có lẽ ra nên được tận dụng tường minh cho mục đích test).
- Với pilot 7 ngày và benchmark RTT/latency bắt buộc "1-2 ngày đầu" (AD-19), thiếu staging cho phần trung tâm+dashboard nghĩa là lần đầu tiên toàn bộ pipeline (kể cả dashboard) chạy full là **trên máy thật, trong cửa sổ pilot** — rủi ro cao cho mốc 7 ngày.

### 4. Rollback plan khi 1 bản cập nhật lỗi ảnh hưởng nhiều kênh — GAP nghiêm trọng, không được nhắc tới

- Không có AD, không có Deferred entry nào đề cập rollback.
- Vì AD-11 tập trung TOÀN BỘ ngưỡng/debounce/cooldown vào 1 điểm (dashboard-backend, chạy trên 1 máy — AD-12), một bản cập nhật lỗi cho **dashboard-backend** có khả năng ảnh hưởng giám sát của toàn bộ 34 kênh cùng lúc (không phải "vài kênh" — là tất cả). AD-27 nói backend tự phục hồi qua Windows Service, nhưng auto-restart một bản build lỗi logic (không phải crash hạ tầng) sẽ **restart lại vào đúng lỗi đó** — không giải quyết được rollback về bản trước.
- Tương tự, nếu một bản build transport-core lỗi được đẩy đồng loạt lên 34 (hoặc 68) máy, spine không có invariant nào kiểu "giữ lại N bản build trước, có thể revert nhanh trên từng máy", cũng không có chiến lược rollout kiểu canary/staged rollout ở mức kỹ thuật (khác với AD-19 vốn là rollout theo *số lượng kênh*, không phải theo *phiên bản phần mềm*).
- Đây là gap có hệ quả vận hành cụ thể: hệ thống dùng để giám sát 24/7 sự cố tín hiệu — nếu chính công cụ giám sát (dashboard-backend) bị lỗi sau update và không rollback được nhanh, đội trực mất khả năng phát hiện sự cố tín hiệu thật trong lúc đó.

### 5. Quy trình triển khai tăng dần pilot→34 kênh (đóng gói, cấu hình mỗi máy) — Có nhắc, nhưng nông hơn mức cần thiết

- AD-19 xác định rõ **tiêu chí khi nào mở rộng** (3 điều kiện) và **khung thời gian pilot**, đây là điểm được xử lý tốt ở tầng "khi nào".
- Nhưng AD-19 không nói **cách** mở rộng ở khía cạnh kỹ thuật:
  - Không có mô tả đóng gói cài đặt (installer/setup script) cho từng máy đài/trung tâm mới khi thêm 33 kênh còn lại — mỗi máy cần: cài Windows Service, đưa file config DPAPI đúng `channel_id`, đưa `channel-registry` entry mới (AD-24), gán `grid_position` (AD-26). Việc này có làm thủ công 33 lần hay có script/template không, spine không nói.
  - AD-24 nói `channel-registry` "sửa thủ công khi thêm/đổi đài" — với 1→34 kênh, đây là 34 lần sửa tay 1 file tại dashboard-backend cộng với distribute passphrase riêng từng đài (đã Deferred ở RACI passphrase, nhưng khía cạnh *kỹ thuật* — ví dụ "cần restart dashboard-backend để nạp lại channel-registry hay hot-reload?" — không được trả lời; AD-24 nói nạp file "khi khởi động", ngụ ý cần restart dashboard-backend mỗi lần thêm 1 kênh mới, ảnh hưởng tới 33 kênh đang chạy ổn định — đây là một xung đột tiềm ẩn giữa AD-19 (mở rộng dần) và AD-24 (nạp registry lúc khởi động) chưa được spine nhận diện).
  - "Portal/API tự động hoá cấu hình kênh" đã Deferred đúng cách (ngoài scope MVP#1) — nhất quán, không phải gap.
- Tóm lại: AD-19 trả lời "khi nào" tốt nhưng bỏ ngỏ "làm bằng cách nào" ở mức đủ để dev có thể code hoá nhất quán — và có một xung đột ẩn (restart dashboard-backend để thêm kênh mới ảnh hưởng 33 kênh đang online) đáng được nêu ít nhất như Open Question.

## Bảng tổng hợp

| # | Chủ đề | Có AD/Deferred? | Mức độ gap | Ghi chú |
| --- | --- | --- | --- | --- |
| 1 | Update/patch 68 máy | Không | Nghiêm trọng | Không AD, không Deferred, không OQ — im lặng hoàn toàn |
| 2 | Monitoring hạ tầng (log tập trung, health-check OS/process) | Không (chỉ có business/signal monitoring) | Nghiêm trọng | Log location/rotation không nêu; không phân biệt "máy chết" vs "kênh disconnected" |
| 3 | Staging trung tâm/dashboard | Một phần (chỉ AD-8 phía đài) | Trung bình-cao | Dashboard-backend — nơi tập trung business logic phức tạp nhất — không có cách test độc lập |
| 4 | Rollback plan | Không | Nghiêm trọng | Auto-restart (AD-27) không tương đương rollback khi lỗi là lỗi logic/build |
| 5 | Quy trình mở rộng pilot→34 (kỹ thuật) | Có một phần (AD-19 + AD-24) | Trung bình | "Khi nào" rõ, "làm sao" (packaging, hot-reload registry) chưa; có xung đột ẩn AD-19↔AD-24 chưa nêu |

## Khuyến nghị cụ thể cho spine (altitude=feature, không đi sâu chi tiết vận hành)

1. Thêm tối thiểu 1 AD hoặc 1 Deferred entry tường minh cho **update mechanism** — kể cả nếu quyết định thực tế là "MVP#1 dùng cập nhật thủ công qua remote desktop/USB, không có CI/CD", đó vẫn là một quyết định kiến trúc cần ghi lại (nó ràng buộc: build artifact dạng gì, update có được ghi đè `config/DPAPI` hay không).
2. Thêm 1 AD về **log tập trung tối thiểu**: ít nhất nêu rõ log structured (đã có ở AD-6) được lưu ở đâu và có cơ chế thu thập về 1 điểm để vận hành không phải remote 68 máy — nếu quyết định là "Deferred, log chỉ local trong MVP#1", nêu rõ như Deferred kèm rủi ro.
3. Thêm 1 dòng Deferred hoặc AD cho **health-check hạ tầng** (phân biệt process/OS down với channel disconnected) — tối thiểu ghi nhận đây là gap đã biết, chưa quyết, để tránh nhầm lẫn "im lặng = không cần" với "im lặng = đã cân nhắc và hoãn".
4. Thêm 1 AD hoặc Deferred cho **rollback**: tối thiểu là quy tắc "giữ bản build N-1 sẵn sàng trên mỗi máy, có script/thủ tục revert" — đặc biệt cho dashboard-backend vì single point of aggregation (AD-11/AD-12).
5. Bổ sung staging story cho dashboard-backend: tận dụng chính kiến trúc hexagonal đã có (AD-20) — nêu rõ ports cho phép test core logic (debounce/threshold/cooldown) độc lập với 34 kết nối WebSocket thật, không cần AD mới nếu chỉ là hệ quả tự nhiên của AD-20, nhưng nên nói tường minh để không bị bỏ qua khi code hoá.
6. Gắn cờ xung đột AD-19 ↔ AD-24 (nạp channel-registry lúc khởi động vs mở rộng dần từng kênh không gián đoạn 33 kênh đang chạy) như Open Question mới hoặc bổ sung vào AD-24.

## Ghi chú phạm vi review

Review này chỉ đánh giá khía cạnh deployment/environments/operations theo yêu cầu; không đánh giá lại tính đúng đắn của các quyết định business logic (AD-9, AD-11, AD-15...) đã được spine xử lý tốt và nằm ngoài phạm vi lens này.
