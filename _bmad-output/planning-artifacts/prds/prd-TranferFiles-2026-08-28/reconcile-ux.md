# Reconciliation — UX design docs vs PRD

Input gốc: `DESIGN.md`, `EXPERIENCE.md` (ux-TranferFiles-2026-08-27, status `final`).
Đối chiếu với: `prd.md` + `addendum.md` (prd-TranferFiles-2026-08-28).

## Đã phản ánh đầy đủ

- **2 user journey (UJ-1, UJ-2)** — PRD §2.3 giữ nguyên nội dung Key Flows từ `EXPERIENCE.md`, đánh số lại đúng thứ tự, đủ persona/entry-context/path/climax/resolution/edge-case.
- **Glossary** — debounce (≥5s), cooldown (60s), ack, `disconnected`, trạng thái kênh 3 giá trị + cờ `acknowledged` — đều khớp định nghĩa gốc trong `EXPERIENCE.md`.
- **`channel-grid`**: vị trí 34 ô cố định tuyệt đối, không sắp xếp lại/lọc/ẩn trong mọi tình huống (kể cả cold-load, disconnected) — FR-6 khớp `EXPERIENCE.md.Component Patterns` + `Interaction Primitives.Cấm`.
- **`cold-load`**: skeleton toàn bộ 34 ô, từng ô cập nhật ngay khi có event riêng, không chờ đủ 34 kênh, độ trễ ~1-2s — FR-7 khớp `State Patterns`.
- **`disconnected`**: connection-banner full-width trên mọi lớp, làm mờ lưới, số liệu đứng yên không nội suy, phục hồi tự động không cần reload — FR-9 khớp đầy đủ, kể cả ghi chú "Critical" từ validation report.
- **Debounce ≥5s cho chuyển trạng thái ô**, **VU meter không qua debounce** và độc lập với trạng thái SRT — FR-7 khớp.
- **Ack behavior cốt lõi**: chỉ thêm `ack-label`, không đổi màu/badge/không xoá cảnh báo, tự biến mất khi phục hồi (không phải khi ack), ack chỉ nằm trong `detail-panel` (không có ack nhanh trên lưới) — FR-12 khớp `Component Patterns` + `Interaction Primitives`.
- **Cooldown 60s cho Telegram/Email cùng loại cảnh báo/cùng kênh**, **thông báo phục hồi luôn gửi ngay không qua cooldown**, **âm báo động kêu đúng 1 lần/lần chuyển trạng thái mới (không lặp theo cooldown)** — FR-11 khớp.
- **Accessibility**: không phụ thuộc màu đơn lẻ (alert-badge luôn kèm icon/chữ), Tab theo đúng thứ tự lưới trái→phải trên→dưới, Enter/Space mở panel, Esc đóng panel, nút ack nằm trong thứ tự Tab, focus-ring — FR-13, FR-14 khớp `Accessibility Floor`.
- **`detail-panel` no-history-data**: vẫn hiện bitrate hiện tại, vùng biểu đồ hiện thông báo thiếu dữ liệu thay vì biểu đồ rỗng — FR-8 khớp.
- **Non-Goals/Cấm**: không tắt âm báo vĩnh viễn từ UI chính, không tự động đóng/ẩn cảnh báo ngoài phục hồi thật, không animation gây xao nhãng trên lưới — PRD §6 + FR-14 NFR khớp `Interaction Primitives.Cấm`.
- **Non-users**: 34 đài địa phương không có quyền truy cập/không có view riêng — PRD §2.2 khớp `Foundation`.
- **Layout đơn-surface**: detail-panel là overlay không điều hướng trang, không chặn thao tác lưới phía sau — FR-8 khớp.

## Gaps (nội dung input gốc chưa xuất hiện trong PRD hoặc addendum PRD)

- **[Quan trọng]** `detail-panel` thiếu trạng thái `loading` (skeleton) trong PRD. `EXPERIENCE.md §State Patterns — Panel chi tiết kênh` định nghĩa rõ 3 state: `loading` ("Khung panel hiện ngay, vùng số liệu và biểu đồ ở trạng thái skeleton/placeholder"), `loaded`, `no-history-data`. PRD FR-8 chỉ phản ánh `loaded` và `no-history-data`, bỏ sót hành vi khi panel vừa mở nhưng dữ liệu bitrate/lịch sử chưa về — rủi ro implementation hiện panel trắng/trống thay vì skeleton.

- **[Quan trọng]** Mất phân biệt người nhận Telegram/Email theo mức cảnh báo. `EXPERIENCE.md §Foundation`: "Lãnh đạo VTCDigital... chỉ nhận thông báo Telegram/Email khi có cảnh báo mất tín hiệu" (tức chỉ mức `critical`, KHÔNG nhận cho mức ABR/`warning`). PRD §2.2 chỉ ghi chung chung "Lãnh đạo... chỉ nhận cảnh báo qua Telegram/Email" không giới hạn theo mức độ, và FR-10/FR-11 không định nghĩa recipient khác nhau giữa đội trực và lãnh đạo theo từng mức — có thể dẫn tới thiết kế gửi nhầm noti mức "chú ý" (ABR) tới lãnh đạo, trái với ý đồ UX gốc.

- **[Trung bình]** Hành vi border-style khi `acknowledged` bị bỏ sót. `DESIGN.md components.channel-grid-cell.states.acknowledged`: "đổi kiểu viền sang nét đứt (dashed) và thêm ack-label" — đây là chỉ báo hình dạng độc lập, không chỉ là thêm text. PRD FR-12 chỉ nói "không đổi màu ô, không đổi badge" nhưng không đề cập việc viền ô phải chuyển sang dashed khi ack — thiếu chi tiết này khiến implementation có thể chỉ thêm label mà giữ nguyên viền solid, mất một lớp tín hiệu phi-màu.

- **[Trung bình]** Phân biệt hành vi thumbnail giữa `warning` và `critical` chưa vào PRD. `DESIGN.md components.channel-grid-cell`: `warning` giữ "thumbnail giữ hình thật kèm icon cảnh báo chồng lên"; `critical` mới "thumbnail thay hoàn toàn bằng color bars". PRD FR-6 chỉ ghi chung "thumbnail/color-bars" không phân biệt 2 mức, và FR-3 chỉ mô tả color bars cho trường hợp mất tín hiệu hoàn toàn — thiếu yêu cầu icon cảnh báo chồng lên thumbnail ở mức `warning`.

- **[Thấp]** Bố cục lưới cụ thể (~6 cột × 6 hàng, 34/36 ô, 2 ô cuối để trống dự phòng mở rộng thêm đài) trong `DESIGN.md components.channel-grid` / `Layout & Spacing` không được nhắc tới ở PRD FR-6. Không sai về chức năng nhưng có thể ảnh hưởng kiến trúc UI khi cần mở rộng số kênh sau giai đoạn thí điểm (§7.3).

- **[Thấp]** Rủi ro phần cứng loa cảnh báo (loa hỏng, âm lượng hệ điều hành = 0) được `EXPERIENCE.md §Interaction Primitives.Cấm` nêu như giới hạn đã biết của kênh âm thanh ("rủi ro phần cứng loa... ngoài phạm vi spine này"). PRD không note lại limitation này ở đâu (không trong Non-Goals, không trong Open Questions) dù nó liên quan trực tiếp đến độ tin cậy của SM-1 (thời gian phát hiện phụ thuộc một phần vào âm báo).

- **[Thấp]** Dạng biểu đồ lịch sử cụ thể là "biểu đồ đường (line chart)" theo `EXPERIENCE.md.Component Patterns.detail-panel`; PRD FR-8 chỉ ghi chung "biểu đồ lịch sử bitrate" không chỉ rõ dạng line chart. Chi tiết trình bày, không ảnh hưởng chức năng cốt lõi.

## Ghi chú khác

- PRD đã chủ động bổ sung phân tách "push Telegram (mức chú ý)" vs "push Telegram + Email + âm báo (mức cảnh báo chủ động)" ở FR-10 — chi tiết này KHÔNG có trong `EXPERIENCE.md`/`DESIGN.md` (2 file này chỉ nói chung "Telegram/Email" không tách kênh theo mức). Đây có thể là thông tin lấy từ `brief.md` (ngoài phạm vi input được giao đối chiếu ở task này) — không tính là gap của UX reconciliation nhưng nên xác nhận nguồn gốc quyết định này nếu chưa rõ, vì nó tương tác trực tiếp với gap "người nhận theo mức" nêu trên.
- Voice & Tone (microcopy do/don't) trong `EXPERIENCE.md` được PRD tuân thủ đúng nguyên văn nhãn (`OK`, `⚠ ABR`, `✕ MẤT TÍN HIỆU`, `✓ Đã nhận: {tên}`, `Xác nhận đã tiếp nhận`) — không có sai lệch.
- Các chi tiết đo tương phản màu (AA/AAA) đã được PRD dẫn chiếu đúng qua FR-14 + addendum §4, không lặp lại số liệu — hợp lý vì đây là dữ liệu tham chiếu kỹ thuật, không phải yêu cầu chức năng riêng.
