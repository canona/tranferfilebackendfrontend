# Addendum — PRD Hệ thống truyền dẫn & giám sát tín hiệu SRT (VTCDigital)

*Tài liệu này lưu chi tiết kỹ thuật-how, phương án bị loại bỏ và dữ liệu nền không thuộc phạm vi PRD, nhưng có giá trị cho `bmad-architecture` và các quyết định tương lai. Không lặp lại nội dung đã có trong `prd.md`.*

## 1. Phương án đã cân nhắc và loại bỏ

Ba phương án dưới đây từng được cân nhắc trong brainstorm/brief nhưng bị loại khỏi phạm vi MVP#1; giữ lại để tham khảo khi kiến trúc hoặc quyết định tương lai cần xét lại.

### 1.1 SRT Connection Bonding

**Nguồn:** brainstorm Decision Journey (`brainstorm.html` §05), `brief.md`/`addendum.md`.

Trong quá trình brainstorm, kiến trúc từng đi qua các bước sau trước khi chốt phạm vi cuối:

1. **Morphological Analysis**: chọn tổ hợp "2 đường internet song song + SRT Bonding" — nâng cấp từ ý tưởng ban đầu là failover đơn thuần lên gửi song song 2 đường (zero-glitch).
2. **Failure Analysis**: sự cố giả định "nhà mạng cam kết tốc độ nhưng thực tế không ổn định" được hiểu là củng cố thêm cho hướng Bonding → tổng hợp tạm thời: kiến trúc phòng thủ 3 lớp (ABR → SRT Bonding → cảnh báo khi cả 2 đường cùng nghẽn).
3. **Question Storming (addendum cuối phiên)**: trả lời câu hỏi "có cần đường dự phòng/2 nhà mạng?" là **Không cần** — vì đầu nhận là 1 máy tính, modem trung tâm đã đảm bảo đường truyền.
4. **Phát hiện mâu thuẫn**: bước 3 đối chọi trực tiếp với bước 1.
5. **Giải quyết**: tách đúng lớp trách nhiệm — phần mềm chỉ là 1 kết nối SRT điểm-điểm ở tầng ứng dụng; đảm bảo đường truyền (dự phòng, dual-ISP, bonding vật lý) là trách nhiệm hạ tầng mạng bên dưới, ngoài phạm vi phần mềm (chi tiết ranh giới kỹ thuật xem §2).

**Lý do loại bỏ**: không phải sai lầm trong tư duy — là "một hướng khám phá thú vị bị thu hẹp phạm vi khi hiểu rõ hơn bối cảnh triển khai thực tế". ABR (khác Bonding) vẫn giữ lại vì là trách nhiệm tầng ứng dụng/phần mềm, không phải hạ tầng.

### 1.2 Nền tảng SRT: tự build vs nguyên bản/thương mại

**Nguồn:** brief §Giải pháp, §Điểm khác biệt.

Cân nhắc giữa dùng nguyên bản Haivision SRT / wrapper thương mại có sẵn (Zixi, v.v. — xem §3 bên dưới) so với tự build trên libsrt + custom orchestration. Chọn tự build vì:
- Chủ động công nghệ hoàn toàn — không phụ thuộc tính năng/SLA/roadmap của bên thứ ba.
- Giảm chi phí dài hạn — loại bỏ chi phí license/thuê ngoài lặp lại, đổi lấy đầu tư một lần vào phát triển nội bộ.

Đánh đổi (không phải quyết định sai, nhưng cần ghi nhận cho kiến trúc): tự build đồng nghĩa VTCDigital tự chịu trách nhiệm toàn bộ về độ ổn định, bảo trì, và các edge case mà các nền tảng thương mại đã xử lý sẵn (xem so sánh thị trường ở §3).

### 1.3 Portal/API tự động hoá cấu hình kênh

**Nguồn:** brainstorm Morphological Analysis (`brainstorm.html`).

Từng được xếp cùng mức ưu tiên với giám sát trong Morphological Analysis, nhưng hạ ưu tiên xuống giai đoạn sau MVP#1 do tần suất sự kiện thêm kênh/đột xuất thấp (vài tháng/lần) — không phải nỗi đau liên tục như thiếu khả năng giám sát.

## 2. Ranh giới phần mềm vs hạ tầng mạng — chi tiết cần xác nhận (OQ-3)

Ranh giới hiện tại (đã chốt về mặt khái niệm, chưa chốt về mặt kỹ thuật chi tiết):
- **Trong phạm vi phần mềm**: 1 kết nối SRT điểm-điểm, ABR ở tầng ứng dụng, color bars khi mất kết nối, giám sát/cảnh báo.
- **Ngoài phạm vi phần mềm**: đảm bảo đường truyền internet ổn định (redundancy, dual-ISP, bonding vật lý ở tầng hạ tầng).

Điểm cần xác nhận với đội hạ tầng mạng khi vào giai đoạn kiến trúc chính thức: modem/router tại mỗi đài địa phương có kết nối đơn hay đã có dự phòng vật lý sẵn? Nếu đài chỉ có 1 đường internet duy nhất không dự phòng, rủi ro đứt kết nối hoàn toàn (ngoài khả năng ABR xử lý) vẫn tồn tại và color bars là biện pháp an toàn duy nhất — không phải giải pháp khôi phục.

## 3. Bối cảnh thị trường & kỹ thuật SRT (research nền, không phải yêu cầu sản phẩm)

*Nguồn: research subagent, 2026-08-28. Dùng để tham khảo khi thiết kế metrics giám sát ở kiến trúc, không phải cam kết trong PRD.*

**Đặc tính kỹ thuật SRT:**
- Giao thức tầng ứng dụng trên UDP (Haivision khởi xướng, nay là chuẩn mở IETF draft/SRT Alliance). Kết hợp độ tin cậy kiểu TCP (ARQ) với độ trễ thấp của UDP.
- Độ trễ cấu hình được, thường 80–500ms cho đường truyền sạch; khuyến nghị latency buffer ≥3x RTT.
- Phục hồi gói tin chủ yếu qua ARQ (retransmit theo yêu cầu), có thể kết hợp FEC khi loss cao. Chịu được packet loss tới ~30% nếu latency đủ lớn; loss <1% được coi là tốt.
- Mã hoá AES-128/256 tích hợp sẵn trong handshake.

**So sánh sản phẩm giám sát trên thị trường:**
- **Haivision** (SRT Gateway/StreamHub) — giám sát network performance theo connection (dropped packets, bitrate, RTT); nắm rõ nội bộ giao thức vì là bên phát triển gốc.
- **Zixi** (ZEN Master + Broadcaster) — tập trung vào hướng "orchestration + observability", dashboard tổng quan nhiều luồng. Điểm khác biệt: **Zixi Health Score** — dự đoán real-time khả năng đứt kết nối bằng model phân tích RTT/dropped packets/encoder quality (hướng predictive thay vì hiển thị số liệu thô).
- **Wowza** — hỗ trợ SRT ingest, giám sát cơ bản hơn, không có multi-channel dashboard chuyên sâu.
- **VideoLAN/SRS (open-source)** — cung cấp core protocol/stats, không có dashboard doanh nghiệp sẵn, cần tự xây trên SRT stats API.
- Điểm chung: tất cả lấy dữ liệu từ **SRT statistics API** (libsrt) — khác biệt chủ yếu ở tầng trực quan hoá/alerting/predictive, không phải nguồn số liệu. → Có thể tham khảo khi thiết kế lớp thu thập metric cho dashboard nội bộ.

**Metrics chuẩn ngành cho 1 luồng SRT** (tham khảo khi kiến trúc chọn metric hiển thị/lưu trữ):
- Connection state (connected/disconnected, uptime), Bitrate (current/average kbps), RTT (ms), Packet loss rate (%), Retransmitted packets, PktRecvDrop/PktRecvBelated, Buffer/latency window, Available bandwidth (ước lượng bởi SRT), Jitter.

**Pattern dashboard nhiều kênh (tham khảo cho UX/kiến trúc, đã áp dụng một phần trong UX spine hiện tại):**
- Trực quan hoá dạng tile/mosaic màu trạng thái để quét nhanh — đã áp dụng trong `channel-grid`.
- Ngưỡng nên dựa trên baseline đo thực tế theo từng kênh/tuyến thay vì ngưỡng cứng chung — điểm này **chưa** được áp dụng trong FR hiện tại (ngưỡng 70% là cố định toàn hệ thống) — cân nhắc cho phiên bản sau nếu dữ liệu vận hành cho thấy cần cá nhân hoá theo kênh.
- Xu hướng predictive/health-score (Zixi) — không nằm trong scope MVP#1, ghi nhận như hướng tham khảo dài hạn.
- Refresh rate phổ biến 1-5s cho dashboard số liệu — khớp với cold-load 1-2s đã chốt trong UX spine.

**Nguồn tham khảo:**
- https://www.haivision.com/blog/all/srt-everything-you-need-to-know-about-the-secure-reliable-transport-protocol/
- https://haivision.github.io/srt-rfc/draft-sharabayko-srt.html
- https://doc.haivision.com/StreamHub/4.4/monitoring-the-network-performance-data-transmissi
- https://spalk.zendesk.com/hc/en-us/articles/8602655395087-Understanding-SRT-Input-Health-Metrics
- https://docs.zixi.com/how-to-guides/the-gathered-data-from-zixi-platform-components
- https://docs.zixi.com/zen-master/dashboard
- https://www.kentik.com/kentipedia/network-monitoring-alerts/
- https://www.thebroadcastbridge.com/content/entry/968/taking-a-multi-view-approach-to-video-monitoring

## 4. Chi tiết accessibility đã đo (từ UX validation, tham khảo kỹ thuật)

*Nguồn: `DESIGN.md`, `validation-report.md` (ux-TranferFiles-2026-08-27).*

- `on-state-warning`: 9.68:1 (vượt AAA).
- `on-state-critical`: 5.94:1 (đạt AA; không theo AAA có chủ đích — giữ độ bão hoà cao để bắt mắt ngoại vi trong phòng tối).
- `on-state-ok`: 10.46:1 (trước đó dùng thẳng `state-ok` chỉ 3.68:1, dưới AA — đã sửa trong spine hiện hành).
- `focus-ring`: 5.98:1 (so `surface-base`) / 5.36:1 (so `surface-raised`).
- `text-primary`/`surface-base`: 17.01:1.

**Phát hiện còn bỏ ngỏ từ validation report** (chưa xác nhận đã fix trong spine hiện hành): âm báo động chỉ kêu 1 lần khi chuyển trạng thái, không có lớp bù thị giác cho cảnh báo tồn đọng (vd chỉ báo tĩnh/số đếm cảnh báo chưa ack) khi đội trực không nghe thấy hoặc bỏ lỡ âm báo đầu tiên. Nếu vận hành thực tế cho thấy đây là vấn đề, cân nhắc bổ sung ở phiên bản sau.

## 5. Tài liệu nguồn đầy đủ

- `_bmad-output/planning-artifacts/briefs/brief-TranferFiles-2026-08-27/brief.md` + `addendum.md`
- `_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/brainstorm-intent.md`, `architecture-onepager.md`, `brainstorm.html`
- `_bmad-output/planning-artifacts/ux-designs/ux-TranferFiles-2026-08-27/DESIGN.md`, `EXPERIENCE.md`, `validation-report.md`, thư mục `mockups/`
