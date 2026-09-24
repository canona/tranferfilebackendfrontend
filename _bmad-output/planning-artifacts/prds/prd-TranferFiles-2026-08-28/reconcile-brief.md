# Reconciliation — brief.md + addendum.md vs PRD

## Đã phản ánh đầy đủ

- Bối cảnh & vấn đề cốt lõi: VTCDigital vận hành trung tâm phát sóng vệ tinh cho 34 đài, hiện thuê ngoài truyền dẫn, không tự giám sát được — ưu tiên xử lý nỗi đau giám sát (liên tục) trước chi phí/thủ tục (tần suất thấp). Khớp `prd.md` §1 Vision.
- Sắc thái quan trọng "giám sát hộ, không mở quyền cho đài địa phương" (VTCDigital chủ động phát hiện thay đài, không phải self-service cho đài) — giữ nguyên ở §2.2 Non-Users và §6 Non-Goals.
- Kiến trúc nền tảng: mỗi đầu là 1 máy tính + card Blackmagic làm cầu nối SDI↔IP/SRT, kết nối điểm-điểm qua libsrt tự build + custom orchestration — khớp FR-1, FR-4.
- Phòng thủ 2 lớp tầng ứng dụng (ABR hạ bitrate, color bars khi mất kết nối hoàn toàn) và lý do giữ lại ABR nhưng loại Bonding — khớp FR-2, FR-3, và giải trình đầy đủ hơn ở `addendum.md` PRD §1.1.
- Ranh giới phần mềm vs hạ tầng mạng (dự phòng đường truyền là trách nhiệm hạ tầng, không phải phần mềm) — khớp FR-1 Out of Scope, §6 Non-Goals, OQ-3, và mở rộng thêm chi tiết cần xác nhận (modem/router tại đài) ở `addendum.md` PRD §2.
- Toàn bộ logic cảnh báo MVP#1 (ngưỡng 70%, 2 mức, debounce ≥5s, cooldown 60s, thông báo phục hồi không bị chặn) — khớp chính xác FR-10, FR-11, Glossary §3.
- Người dùng chính (đội trực sóng 24/7) và người thụ hưởng gián tiếp (34 đài, không thao tác trực tiếp) — khớp §2.
- Tiêu chí phát hiện sự cố ≤1 phút và lập luận "khớp kiến trúc event-driven nên khả thi" — khớp SM-1 và FR-7.
- Rủi ro mốc go-live 1 tuần cho toàn bộ nền tảng (brief cảnh báo kỹ thuật chưa chốt, khuyến nghị thu hẹp phạm vi tuần đầu như pilot 1 kênh) — PRD hiện thực hoá đúng khuyến nghị này bằng kế hoạch rollout 2 giai đoạn (pilot → mở rộng) ở §7.3, cùng OQ-4 cho số kênh pilot cụ thể.
- Phạm vi trong/ngoài MVP#1 (Portal/API hạ ưu tiên, không mở view cho đài, loại SRT Bonding) — khớp §6, §7.1, §7.2.
- Điểm khác biệt chiến lược (chủ động công nghệ, giảm chi phí dài hạn so với thuê ngoài/thương mại) — được giữ lại và giải trình sâu hơn ở `addendum.md` PRD §1.2 (bao gồm cả đánh đổi tự chịu trách nhiệm bảo trì mà brief gốc chưa nêu).
- Các chi tiết kỹ thuật chưa chốt trong brief addendum (model Blackmagic, codec ABR) đều được theo dõi tiếp bằng `[ASSUMPTION]` + Open Questions (OQ-1, OQ-2) trong PRD.

## Gaps (nội dung input gốc chưa xuất hiện trong PRD hoặc addendum PRD)

- [Trung bình] Tầm nhìn dài hạn hướng #3 của brief — "Mở rộng ra ngoài 34 đài địa phương hiện tại, trở thành nền tảng truyền dẫn chuẩn của VTCDigital, phục vụ thêm các đối tác khác" — không xuất hiện ở bất kỳ đâu trong PRD hay addendum PRD. Đây là mục tiêu chiến lược định tính (mở rộng thị trường/đối tác) mà cấu trúc FR/Non-Goals không có chỗ chứa. Vị trí gốc: `brief.md` mục "## Tầm nhìn", điểm 3.
- [Trung bình] Tầm nhìn dài hạn hướng #1 — "Thay thế hoàn toàn đơn vị thuê ngoài cho cả 34 đài địa phương... hiện thực hóa mục tiêu chiến lược ban đầu" — PRD §1 Vision chỉ nhắc mờ nhạt bằng cụm "giảm dần chi phí thuê ngoài", không nêu rõ đích đến là thay thế hoàn toàn đơn vị ngoài như một cột mốc tương lai. Vị trí gốc: `brief.md` mục "## Tầm nhìn", điểm 1.
- [Trung bình] Cảnh báo trong addendum brief: "Mục tiêu ngân sách/% giảm chi phí cụ thể — user xác nhận hiện 'chưa quan tâm ngân sách'; nếu brief được dùng để trình lãnh đạo phê duyệt đầu tư, cần bổ sung con số cụ thể trước đó." Đây là lưu ý định tính quan trọng cho quy trình phê duyệt (không phải yêu cầu kỹ thuật), nhưng không có mục Open Question/Assumption nào trong PRD nhắc lại nhu cầu bổ sung con số ngân sách trước khi trình lãnh đạo. Vị trí gốc: `brief/addendum.md` mục "Chi tiết kỹ thuật chưa chốt", bullet cuối.
- [Thấp] "Chi tiết lớp custom orchestration trên libsrt — chưa đi sâu trong brainstorm, cần thiết kế kỹ thuật riêng" được brief addendum liệt kê như một hạng mục kỹ thuật rõ ràng còn thiếu thiết kế. PRD FR-1 mô tả lớp orchestration này như đã chốt (chỉ nói "dựa trên libsrt tự build với lớp orchestration riêng"), không gắn `[ASSUMPTION]` hay Open Question tương ứng như đã làm với model Blackmagic (OQ-1) hay codec ABR (OQ-2). Vị trí gốc: `brief/addendum.md` mục "Chi tiết kỹ thuật chưa chốt", bullet 3; đối chiếu `prd.md` §4.1 FR-1.
- [Thấp] Sắc thái cảnh báo rủi ro rõ nét của brief về mốc go-live 1 tuần ("đây là mốc do người yêu cầu chốt, chưa qua thẩm định kỹ thuật... 1 tuần... là mốc rất gấp so với khối lượng chưa rõ này") bị pha loãng trong PRD: PRD hiện thực hoá đúng giải pháp (rollout theo giai đoạn) nhưng không còn phát biểu rõ ràng rằng bản thân mốc 7 ngày là một rủi ro lịch trình chưa được thẩm định — điều này có thể quan trọng nếu PRD được dùng để trao đổi kỳ vọng với lãnh đạo/các bên liên quan ngoài đội kỹ thuật. Vị trí gốc: `brief.md` mục "## Tiêu chí thành công", khối cảnh báo ⚠️ về mốc go-live.

## Ghi chú khác

- PRD (bản v2, `prd.md` frontmatter: "bo sung yeu cau bao mat du lieu truyen tai") bổ sung toàn bộ §5 Bảo mật dữ liệu truyền tải (mã hoá AES, passphrase riêng/kênh, từ chối handshake sai) — đây là yêu cầu mới, không có trong brief/addendum gốc (được xác nhận trực tiếp với người yêu cầu ngày 2026-08-28 theo ghi chú trong PRD). Không phải gap thiếu sót — chỉ là mở rộng phạm vi sau brief, cần lưu ý khi đối chiếu ngược lại brief trong tương lai (brief chưa được cập nhật để phản ánh yêu cầu bảo mật này).
- `addendum.md` của PRD mở rộng đáng kể so với `addendum.md` của brief: thêm nghiên cứu thị trường/kỹ thuật SRT (Haivision, Zixi, Wowza...), metrics chuẩn ngành, và số liệu accessibility đã đo — đều là bổ sung giá trị cho kiến trúc, không mâu thuẫn với nội dung gốc.
- Nội dung UX (journeys UJ-1/UJ-2, glossary chi tiết, FR-6 đến FR-14, FR-13/14 accessibility) đến từ UX Spine (không phải brief) nên nằm ngoài phạm vi đối chiếu này — không phát sinh gap vì không phải input gốc đang xét.
