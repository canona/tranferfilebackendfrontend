# Kiến trúc kỹ thuật sơ bộ (One-Pager) — Truyền dẫn video/audio qua SRT

> **BẢN NHÁP SƠ BỘ từ session brainstorm** (không phải kiến trúc chính thức).
> Nguồn: `.memlog.md` — session brainstorm "Ứng dụng truyền dẫn video/audio qua internet bằng giao thức SRT", ngày 2026-08-27.
> Mục đích: điểm khởi đầu cho bước `bmad-architecture` chính thức, còn nhiều câu hỏi mở và khoảng hở cần giải quyết.

## Bối cảnh

- VTCDigital có trung tâm phát sóng vệ tinh, làm dịch vụ uplink cho các đài địa phương.
- Hiện đang thuê đơn vị ngoài truyền dẫn tín hiệu từ đài địa phương về trung tâm.
- Pain points của đài địa phương: chi phí truyền dẫn cao; thủ tục chậm khi cần thêm kênh/sự kiện đột xuất; không tự giám sát được tín hiệu của chính mình đang đi đâu, chất lượng thế nào.
- Mô hình vận hành đã chốt: VTCDigital chủ động cấu hình phần mềm truyền dẫn từ tín hiệu đài địa phương về trung tâm — **không phải self-service** cho đài địa phương.

## Quy mô & luồng tín hiệu vật lý

- 34 tỉnh thành, tương ứng 34 đài địa phương cần kết nối về trung tâm.
- Cả 2 đầu (đài địa phương và trung tâm) đều là máy tính cài phần mềm + **card chuyên dụng Blackmagic (SDI I/O)** làm cầu nối SDI ↔ IP/phần mềm.
- Luồng tín hiệu:
  1. Đài địa phương: tín hiệu đầu vào **SDI** → card Blackmagic capture vào máy tính → phần mềm xử lý/encode → đẩy qua internet (SRT).
  2. Trung tâm VTCDigital: máy tính nhận luồng SRT → phần mềm xử lý → đẩy ra lại thành **SDI** qua card Blackmagic.

## Các thành phần kiến trúc đã thảo luận/chốt

1. **Encoder với ABR (Adaptive Bitrate)**
   - Chủ động hạ bitrate khi điều kiện mạng xấu đi.
   - Lý do: bài học từ sự cố giả định — không thể tin tưởng cam kết tốc độ internet, cần kỹ thuật nén tốt để dùng ít băng thông nhưng vẫn giữ chất lượng.
   - Codec cụ thể chưa chốt trong memlog — chỉ ghi nhận yêu cầu "cần nén hiệu quả".

2. **Lớp orchestration tự build trên libsrt**
   - Hướng đi được chọn: tự build trên libsrt + custom orchestration.
   - Không dùng nguyên bản Haivision SRT hay wrapper có sẵn.

3. **Kết nối điểm-điểm (point-to-point) qua phần mềm**
   - Topology: 2 máy tính kết nối trực tiếp với nhau qua phần mềm — 1 tại đài địa phương, 1 tại trung tâm.
   - **Đã chốt phạm vi:** đảm bảo đường truyền internet (dự phòng, đa nhà mạng, bonding vật lý) là trách nhiệm của hạ tầng mạng bên dưới — **nằm ngoài phạm vi phần mềm**. Ý tưởng SRT Connection Bonding (2 đường song song, zero-glitch) được cân nhắc ở giai đoạn brainstorm nhưng bị loại khỏi phạm vi dự án sau khi làm rõ: phần mềm chỉ cần lo 1 kết nối SRT điểm-điểm.
   - Xử lý khi đứt mạng hoàn toàn: hiển thị màu chờ (color bars) tại đầu ra — an toàn phát sóng, tránh đóng băng hình/màn đen.

4. **Portal/API tự động hoá cấu hình kênh**
   - Tự động hoá đầy đủ việc cấu hình kênh.
   - Vận hành bởi VTCDigital — giữ quyền kỹ thuật, không self-service cho đài địa phương.
   - Giải quyết nỗi đau "thủ tục chậm khi cần thêm kênh/sự kiện đột xuất".

5. **Giám sát**
   - Đội trực sóng 24/7 của VTCDigital — phát hiện sự cố chủ động, không phụ thuộc đài địa phương báo.
   - Dashboard nội bộ VTCDigital.
   - Còn khoảng hở: có mở view riêng cho đài địa phương xem tín hiệu của họ không, hay giữ kín nội bộ (chưa quyết định).

## Mô hình phòng thủ ở tầng ứng dụng (đã thu hẹp phạm vi)

1. **Lớp 1 — ABR chủ động hạ bitrate**: khi điều kiện mạng xấu đi, encoder tự hạ bitrate để duy trì truyền dẫn ổn định.
2. **Lớp 2 — Che bảng màu khi mất kết nối hoàn toàn**: đầu ra hiển thị color bars thay vì đóng băng hình/màn đen, đội trực sóng 24/7 phát hiện và xử lý.

> Lưu ý: dự phòng đường truyền/đa nhà mạng (SRT Bonding) đã được xác nhận là **ngoài phạm vi phần mềm** — thuộc trách nhiệm hạ tầng mạng, không phải một layer phòng thủ của ứng dụng.

## Câu hỏi mở còn lại (chưa giải quyết)

- Model/dòng card Blackmagic cụ thể (DeckLink, UltraStudio...) và yêu cầu driver/hệ điều hành tương ứng — chưa chốt.

## Khoảng hở cần bmad-architecture giải quyết

- Dashboard giám sát: có mở view riêng cho đài địa phương xem tín hiệu/chất lượng của chính họ không, hay giữ kín nội bộ VTCDigital.
- Codec/kỹ thuật nén cụ thể cho encoder — chưa chốt, chỉ có yêu cầu "nén hiệu quả".
- Chi tiết kỹ thuật của lớp custom orchestration trên libsrt (chưa đi sâu trong brainstorm).
- Ranh giới kỹ thuật chính xác giữa "phần mềm" và "hạ tầng mạng" — cần xác nhận với đội hạ tầng khi vào giai đoạn kiến trúc chính thức.
- Câu hỏi mở ở mục trên cần được trả lời trước hoặc trong bước kiến trúc chính thức.

## Ghi chú

- Đây là bản tổng hợp thuần từ nội dung memlog, không bổ sung chi tiết kỹ thuật ngoài phạm vi đã thảo luận.
- Kỹ thuật brainstorm đã dùng: Job to Be Done, Question Storming, Morphological Analysis, Failure Analysis.
