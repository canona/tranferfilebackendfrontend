---
title: "Product Brief: Hệ thống truyền dẫn & giám sát tín hiệu qua SRT (VTCDigital)"
status: draft
created: 2026-08-27
updated: 2026-08-31
---

# Product Brief: Hệ thống truyền dẫn & giám sát tín hiệu qua SRT (VTCDigital)

## Tóm tắt điều hành

VTCDigital vận hành trung tâm phát sóng vệ tinh, cung cấp dịch vụ uplink cho 20 đài địa phương. Hiện tại, việc truyền tín hiệu từ đài về trung tâm do một đơn vị ngoài đảm nhiệm — chi phí cao, thủ tục chậm mỗi khi cần thêm kênh, và VTCDigital không tự giám sát được tín hiệu của mình đang đi đâu, chất lượng ra sao.

Dự án xây dựng công cụ nội bộ để tự chủ việc truyền dẫn này, dựa trên giao thức SRT (tự build trên libsrt + custom orchestration, không dùng nguyên bản Haivision SRT hay wrapper có sẵn). Kiến trúc: mỗi đầu (đài địa phương và trung tâm) là một máy tính cài phần mềm, kết hợp card Blackmagic (SDI I/O) làm cầu nối giữa tín hiệu SDI truyền thống và luồng IP/SRT, kết nối điểm-điểm qua internet.

Phiên bản đầu tiên (MVP#1) tập trung vào nỗi đau cấp thiết và liên tục nhất: **giám sát nội bộ** — giúp VTCDigital chủ động phát hiện kênh gặp sự cố trong vòng 1 phút, thay vì phụ thuộc hoàn toàn vào đơn vị ngoài như hiện nay. Tự động hóa cấu hình kênh (Portal/API) và mục tiêu thay thế hoàn toàn đơn vị ngoài là hướng đi tiếp theo, sau khi nền tảng truyền dẫn + giám sát chứng minh được độ tin cậy.

## Vấn đề

Đài địa phương — thông qua VTCDigital, bên vận hành hộ — đang chịu ba nỗi đau cụ thể:

1. **Chi phí truyền dẫn cao** — do thuê đơn vị ngoài xử lý toàn bộ việc truyền tín hiệu về trung tâm.
2. **Thủ tục chậm** — mỗi lần cần thêm kênh hoặc xử lý sự kiện đột xuất, phải ký hợp đồng và chờ cấu hình thủ công. Tuy nhiên tần suất sự kiện đột xuất thực tế thấp (vài tháng/lần), nên đây không phải nỗi đau xảy ra liên tục.
3. **Không có khả năng tự giám sát** — không biết tín hiệu của mình đang đi đâu, chất lượng ra sao. Đây là nỗi đau xảy ra **liên tục**, mỗi ngày, và là nỗi đau ưu tiên xử lý trước.

Lưu ý về phạm vi: nỗi đau #3 được giải quyết bằng việc **VTCDigital chủ động giám sát và phát hiện sự cố thay cho đài địa phương** — không phải bằng cách mở quyền truy cập giám sát trực tiếp cho đài địa phương. Đài địa phương không dùng dashboard này; VTCDigital giữ toàn bộ quyền kỹ thuật và vận hành (không phải mô hình self-service).

## Giải pháp

**Nền tảng truyền dẫn** (bắt buộc, làm nền cho mọi tính năng khác):
- Luồng tín hiệu: SDI tại đài địa phương → card Blackmagic capture → phần mềm encode → SRT qua internet → phần mềm tại trung tâm nhận → card Blackmagic xuất lại thành SDI.
- Kết nối điểm-điểm (point-to-point) qua phần mềm tự build trên libsrt. Đảm bảo đường truyền internet (dự phòng, đa nhà mạng, bonding vật lý) là trách nhiệm của hạ tầng mạng bên dưới, nằm ngoài phạm vi phần mềm.
- Phòng thủ 2 lớp ở tầng ứng dụng: (1) ABR chủ động hạ bitrate khi mạng xấu đi; (2) hiển thị color bars tại đầu ra khi mất kết nối hoàn toàn (an toàn phát sóng, tránh đóng băng hình/màn đen).

**MVP#1 — Dashboard giám sát nội bộ** (ưu tiên xây trước):
- Theo dõi trạng thái 20 kênh theo thời gian thực, kiến trúc event-driven (không polling), độ trễ dữ liệu 1-2s.
- Cảnh báo tự động, 2 mức, kèm cơ chế debounce chống dao động cảnh báo:
  - Bitrate hạ ≥70% so với cấu hình gốc → mức chú ý (ABR đang hoạt động) → push Telegram.
  - Mất tín hiệu / color bars → cảnh báo chủ động thật sự → push Telegram + email.
  - Debounce: trạng thái phải giữ ≥5s mới tính là đổi trạng thái; cooldown lặp lại 60s; thông báo phục hồi luôn được gửi, không bị chặn bởi cooldown.
- Người dùng: đội trực sóng 24/7 của VTCDigital — không phụ thuộc đài địa phương báo sự cố.

**Đợt sau (không thuộc MVP#1)**: Portal/API tự động hóa cấu hình kênh (JTBD#2) — xem [Phạm vi](#phạm-vi).

## Điểm khác biệt

So với việc tiếp tục thuê ngoài hoặc dùng nguyên bản Haivision SRT / wrapper thương mại có sẵn, hướng tự build nhằm hai mục tiêu cốt lõi:
- **Chủ động công nghệ** — VTCDigital nắm toàn quyền kỹ thuật với logic truyền dẫn, giám sát và cảnh báo, không phụ thuộc tính năng/SLA/roadmap của bên thứ ba.
- **Giảm chi phí** — loại bỏ chi phí thuê ngoài lặp lại theo kênh/sự kiện, đổi lấy chi phí đầu tư một lần vào nền tảng nội bộ.

## Đối tượng phục vụ

**Người dùng chính**: Đội trực sóng 24/7 của VTCDigital — vận hành dashboard giám sát, xử lý cảnh báo, đảm bảo phát sóng liên tục cho 20 kênh.

**Người thụ hưởng gián tiếp**: 20 đài địa phương — được hưởng lợi từ chi phí thấp hơn và độ tin cậy cao hơn, nhưng **không** thao tác trực tiếp trên dashboard hay hệ thống cấu hình (không self-service).

## Tiêu chí thành công

- **Phát hiện sự cố**: rút ngắn thời gian phát hiện xuống còn **1 phút**, từ mức hiện tại là không có khả năng tự phát hiện. Mục tiêu này khớp với kiến trúc event-driven đã chốt (độ trễ dữ liệu 1-2s + debounce ≥5s + push tức thời), nên khả thi về mặt kỹ thuật với thiết kế hiện tại.
- **Mốc go-live**: production go-live cho **toàn bộ MVP#1** (nền truyền dẫn libsrt custom + tích hợp Blackmagic + ABR + dashboard giám sát) trong **1 tuần**.
  > ⚠️ **Rủi ro cần lưu ý**: đây là mốc do người yêu cầu chốt, chưa qua thẩm định kỹ thuật. Tại thời điểm viết brief này, codec/kỹ thuật nén cho ABR, model card Blackmagic cụ thể, và chi tiết lớp custom orchestration trên libsrt **đều chưa chốt** (xem `addendum.md`) — nghĩa là còn thiết kế kỹ thuật đáng kể chưa làm trước khi có thể ước lượng công sức đáng tin cậy. 1 tuần cho toàn bộ nền tảng truyền dẫn (không chỉ dashboard) là mốc rất gấp so với khối lượng chưa rõ này. Khuyến nghị: bước `bmad-architecture` tiếp theo cần xác nhận lại tính khả thi của mốc này càng sớm càng tốt, và cân nhắc thu hẹp phạm vi go-live tuần đầu nếu cần (ví dụ: dashboard trước, trên một kênh thí điểm, thay vì cả 20 kênh + toàn bộ nền tảng cùng lúc).
- **Chi phí**: giảm chi phí thuê ngoài là mục tiêu chiến lược dài hạn của toàn dự án (không phải KPI đo ở MVP#1) — hiện chưa có mục tiêu ngân sách/% cụ thể được xác nhận.

## Phạm vi

**Trong phạm vi (nền tảng + MVP#1)**:
- Truyền dẫn điểm-điểm qua SRT (libsrt custom) + tích hợp Blackmagic SDI I/O.
- ABR chủ động hạ bitrate + color bars khi mất kết nối hoàn toàn.
- Dashboard giám sát nội bộ VTCDigital cho 20 kênh, cảnh báo tự động (Telegram/email) theo logic đã chốt.

**Ngoài phạm vi (đợt sau hoặc không xây)**:
- Portal/API tự động hóa cấu hình kênh (JTBD#2) — hạ ưu tiên do tần suất sự kiện đột xuất thấp; dự kiến là bước tiếp theo sau MVP#1.
- View giám sát riêng cho đài địa phương xem tín hiệu của chính họ — giữ kín nội bộ VTCDigital, không mở self-service.
- Dự phòng đường truyền/đa nhà mạng, SRT Connection Bonding — thuộc trách nhiệm hạ tầng mạng bên dưới, không phải tính năng phần mềm (xem `addendum.md` cho lý do loại bỏ).

## Tầm nhìn

Nếu MVP#1 chứng minh được độ tin cậy (đặc biệt là mục tiêu phát hiện sự cố trong 1 phút), dự án mở rộng theo 3 hướng:

1. **Thay thế hoàn toàn đơn vị thuê ngoài** cho cả 20 đài địa phương — hiện thực hóa mục tiêu chiến lược ban đầu (giảm chi phí truyền dẫn).
2. **Portal/API tự động hóa cấu hình kênh** (JTBD#2) — rút ngắn thủ tục thêm kênh/xử lý sự kiện đột xuất, vẫn giữ quyền kỹ thuật ở VTCDigital (không self-service cho đài).
3. **Mở rộng ra ngoài 20 đài địa phương hiện tại** — trở thành nền tảng truyền dẫn chuẩn của VTCDigital, phục vụ thêm các đối tác khác ngoài phạm vi 20 đài ban đầu.
