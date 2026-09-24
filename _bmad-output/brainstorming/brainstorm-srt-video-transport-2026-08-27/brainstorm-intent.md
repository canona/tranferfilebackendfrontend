# Intent Doc: Ứng dụng truyền dẫn video/audio qua internet bằng SRT

## 1. Bối cảnh & mục tiêu
- VTCDigital vận hành trung tâm phát sóng vệ tinh, cung cấp dịch vụ uplink cho các đài địa phương.
- Hiện đang thuê đơn vị ngoài để truyền dẫn tín hiệu từ đài địa phương về trung tâm.
- Mục tiêu: xây dựng công cụ nội bộ cho VTC, truyền dẫn tin cậy, dựa trên giao thức SRT (open source, nền tảng Haivision SRT), tích hợp vào hạ tầng đài.

## 2. Vấn đề cốt lõi cần giải (Job to Be Done)
Đài địa phương cần:
1. Giảm chi phí truyền dẫn (hiện đang cao do thuê ngoài).
2. Rút ngắn thủ tục khi cần thêm kênh hoặc xử lý sự kiện đột xuất (hiện phải ký hợp đồng và chờ VTCDigital cấu hình thủ công mỗi lần tăng kênh).
3. Tự giám sát được tín hiệu của chính mình (đang đi đâu, chất lượng thế nào) — hiện không có khả năng này.

## 3. Ràng buộc vận hành đã chốt
- Mô hình vận hành: VTCDigital chủ động cấu hình phần mềm truyền dẫn từ tín hiệu đài địa phương về trung tâm. Đây KHÔNG phải mô hình self-service cho đài địa phương — VTCDigital giữ quyền kỹ thuật.
- Không thể tin tưởng cam kết tốc độ/băng thông internet của đường truyền (bài học từ sự cố giả định) → cần kỹ thuật nén tốt để dùng ít băng thông nhưng vẫn giữ chất lượng.

## 4. Hướng kiến trúc đã chọn
- Hướng triển khai: tự build trên libsrt + custom orchestration, không dùng nguyên bản Haivision SRT hay wrapper có sẵn.
- Topology: kết nối điểm-điểm (point-to-point) qua phần mềm giữa 2 máy tính — 1 tại đài địa phương, 1 tại trung tâm. Đảm bảo đường truyền internet (dự phòng, đa nhà mạng) là trách nhiệm của hạ tầng mạng bên dưới, **nằm ngoài phạm vi phần mềm**.
- Cấu hình kênh: tự động hóa đầy đủ qua Portal/API nội bộ (giải quyết nỗi đau "thủ tục chậm", nhưng vẫn do VTCDigital vận hành, không mở cho đài địa phương tự cấu hình).
- Giám sát: Dashboard nội bộ VTCDigital.
- Xử lý khi đứt mạng: hiển thị màu chờ (color bars) tại đầu ra thay vì đóng băng hình hoặc màn đen.
- Phát hiện sự cố: đội trực sóng 24/7 của VTCDigital giám sát chủ động, không phụ thuộc đài địa phương báo.
- Kiến trúc phòng thủ ở tầng ứng dụng:
  1. ABR (Adaptive Bitrate) chủ động hạ bitrate khi điều kiện mạng xấu đi.
  2. Che bảng màu khi mất kết nối hoàn toàn (an toàn phát sóng).
  - (Dự phòng đường truyền/đa nhà mạng — nếu có — là lớp hạ tầng mạng, không phải tính năng phần mềm.)

## 5. Quy mô & luồng tín hiệu vật lý
- 34 tỉnh thành, tương ứng 34 đài địa phương cần kết nối.
- Cả 2 đầu (đài địa phương và trung tâm) đều là máy tính cài phần mềm + **card chuyên dụng Blackmagic (SDI I/O)** làm cầu nối SDI ↔ IP/phần mềm.
- Luồng: tín hiệu đầu vào tại đài địa phương là **SDI** → card Blackmagic capture vào máy tính → phần mềm xử lý, encode, đẩy qua internet (SRT) về máy tính trung tâm VTCDigital → phần mềm trung tâm nhận luồng SRT → đẩy ra lại thành **SDI** qua card Blackmagic.

## 6. Câu hỏi/khoảng hở còn mở cần quyết định tiếp
- Model/dòng card Blackmagic cụ thể (DeckLink, UltraStudio...) và yêu cầu driver/hệ điều hành tương ứng — chưa chốt.
- Dashboard giám sát có nên mở view riêng cho đài địa phương xem tín hiệu của chính họ không, hay giữ kín hoàn toàn nội bộ VTCDigital?
- Codec/kỹ thuật nén cụ thể cho ABR — chưa chốt.
