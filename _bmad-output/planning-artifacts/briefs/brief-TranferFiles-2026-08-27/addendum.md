# Addendum — Hệ thống truyền dẫn & giám sát tín hiệu qua SRT

Tài liệu ghi lại chi tiết kỹ thuật, phương án đã cân nhắc và loại bỏ, cùng các câu hỏi mở — không đưa vào brief chính để giữ brief gọn, nhưng cần cho bước PRD/kiến trúc chính thức tiếp theo.

## Chi tiết kỹ thuật chưa chốt (cần bmad-architecture giải quyết)

- **Model/dòng card Blackmagic cụ thể** (DeckLink, UltraStudio...) và yêu cầu driver/hệ điều hành tương ứng.
- **Codec/kỹ thuật nén cụ thể cho ABR** — hiện chỉ có yêu cầu "cần nén hiệu quả, dùng ít băng thông nhưng giữ chất lượng".
- **Chi tiết lớp custom orchestration trên libsrt** — chưa đi sâu trong brainstorm, cần thiết kế kỹ thuật riêng.
- **Ranh giới chính xác giữa "phần mềm" và "hạ tầng mạng"** — cần xác nhận với đội hạ tầng mạng khi vào giai đoạn kiến trúc chính thức (ai chịu trách nhiệm gì khi có sự cố đường truyền).
- **Mốc thời gian production go-live cho MVP#1** — cần bổ sung trước khi lập kế hoạch sprint.
- **Mục tiêu ngân sách/% giảm chi phí cụ thể** — user xác nhận hiện "chưa quan tâm ngân sách"; nếu brief được dùng để trình lãnh đạo phê duyệt đầu tư, cần bổ sung con số cụ thể trước đó.

## Phương án đã cân nhắc và loại bỏ

**SRT Connection Bonding (dự phòng đường truyền song song, zero-glitch)**
- Trong giai đoạn Morphological Analysis của brainstorm, đây từng là phương án được nâng cấp lựa chọn: gửi song song 2 đường internet, không glitch khi 1 đường mất, thay vì failover đơn thuần.
- Sau khi làm rõ phạm vi (Failure Analysis + xác nhận lại của user): kiến trúc chốt là 2 máy tính kết nối điểm-điểm trực tiếp qua phần mềm, ở "lớp trong" (tầng ứng dụng). Việc đảm bảo đường truyền internet (redundancy, dual-ISP, bonding vật lý) là trách nhiệm của hạ tầng mạng bên dưới — nằm ngoài phạm vi phần mềm.
- Lý do loại bỏ khỏi scope: phần mềm được cài đặt trên máy tính tại trung tâm, nơi modem của trung tâm đã đảm bảo đường truyền; phần mềm chỉ cần lo 1 kết nối SRT điểm-điểm. ABR (chủ động hạ bitrate) vẫn giữ lại vì đây là trách nhiệm tầng ứng dụng/phần mềm — khác với bonding đường truyền, vốn là trách nhiệm hạ tầng.
- Ghi chú mâu thuẫn đã xử lý: có một điểm chưa nhất quán giữa quyết định "chọn tổ hợp 2 đường internet + SRT Bonding" (Morphological Analysis) và câu trả lời sau đó "không cần đường dự phòng/đa nhà mạng" (Question Storming). User đã xác nhận lại: hướng đúng là loại bonding khỏi phạm vi phần mềm.

## Logic cảnh báo MVP#1 — chi tiết đầy đủ (từ party-mode, PM/Dev)

- Bitrate hạ ≥70% so với cấu hình gốc = ABR đang hoạt động → mức chú ý → push Telegram.
- Mất tín hiệu / color bars = cảnh báo chủ động thật sự → push Telegram + email.
- Debounce: trạng thái phải giữ ổn định ≥5 giây mới được tính là đổi trạng thái (tránh cảnh báo giả do nhiễu tức thời).
- Cooldown: lặp lại cảnh báo cùng loại cách nhau tối thiểu 60 giây.
- Thông báo phục hồi (trở lại bình thường) luôn được gửi ngay, không bị chặn bởi cooldown.
- Kiến trúc đề xuất: event-driven, không polling; độ trễ dữ liệu trong khoảng 1-2 giây.

## Nguồn tổng hợp

- `_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/brainstorm-intent.md`
- `_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/.memlog.md`
- `_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/architecture-onepager.md`
- `_bmad-output/party-mode/memories/installed/.memlog.md`
