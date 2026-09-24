# PRD Quality Review — Hệ thống truyền dẫn & giám sát tín hiệu SRT (VTCDigital)

## Overall verdict

PRD này là một capability spec nội bộ chất lượng cao: FR có consequence kiểm chứng được với số liệu cụ thể (ngưỡng %, giây, tỷ lệ tương phản), Non-Goals phân biệt rõ "vĩnh viễn" và "để sau", Open Questions thực sự mở và có nơi đến (kiến trúc/sprint planning). Rủi ro lớn nhất là một mâu thuẫn ngưỡng bitrate giữa Glossary và FR-10 (`≥70%` vs `<70%`) — đúng vào FR quyết định logic cảnh báo, tức là trung tâm của thesis SM-1 — cần chốt lại trước khi giao cho `bmad-architecture`/`bmad-create-epics-and-stories`. Ngoài điểm đó, cấu trúc glossary-anchored, ID liên tục và cross-reference đều đáng tin cậy cho downstream.

## Decision-readiness — strong

Quyết định được phát biểu rõ ràng chứ không núp dưới dạng "cân nhắc": §6 Non-Goals nêu từng loại trừ kèm lý do và phân biệt rõ loại trừ **vĩnh viễn** (SRT Bonding, bảo mật hạ tầng mạng) với loại trừ **để sau** (Portal/API cấu hình kênh). Trade-off được nêu kèm cái giá phải trả — không chỉ nêu lựa chọn: `addendum.md` §1.2 nói rõ tự build libsrt "đổi lấy" việc VTCDigital tự chịu trách nhiệm toàn bộ ổn định/bảo trì, không được các nền tảng thương mại xử lý sẵn. `[NOTE FOR PM]` ở FR-12 (§4.3) và §7.2 đặt đúng vào điểm căng thật (thiếu escalation tự động khi đầu mối không phản hồi) chứ không phải checkpoint an toàn. Open Questions (OQ-1 đến OQ-6) là câu hỏi thật, có chủ sở hữu tiếp theo rõ ràng (kiến trúc/sprint planning), không phải câu hỏi tu từ đã có đáp án ngay câu sau.

### Findings
- **medium** Rủi ro "tự build SRT" chỉ nằm trong addendum, không có tín hiệu nào trong thân PRD (§ toàn PRD) — FR-1 (§4.1) phát biểu "dựa trên libsrt tự build với lớp orchestration riêng" như một fact đã chốt, không có câu trỏ đến rủi ro vận hành (tự chịu trách nhiệm ổn định/bảo trì, không có SLA bên thứ ba) đã nêu ở `addendum.md` §1.2. Người duyệt PRD (PM/lãnh đạo) đọc riêng `prd.md` sẽ không thấy rủi ro này. *Fix:* thêm 1 câu trỏ addendum trong Vision (§1) hoặc FR-1, ví dụ "(đánh đổi: tự chịu trách nhiệm vận hành/bảo trì toàn bộ giao thức — xem addendum §1.2)".
- **low** Working title chưa chốt (dòng 10: `*Working title — confirm.*`) trong khi PRD đã ở trạng thái sắp giao cho kiến trúc/epic — nên chốt tên trước khi tài liệu downstream tham chiếu tên hệ thống. *Fix:* xác nhận tên chính thức hoặc xoá callout nếu đã chốt ngầm.

## Substance over theater — strong

Không phát hiện theater đáng kể. Vision (§1) gắn chặt với bối cảnh cụ thể (34 đài, uplink vệ tinh, "phát hiện sự cố trong vòng 1 phút") — không thể swap sang PRD khác. NFR không rơi vào boilerplate: "hệ thống phải scalable/secure" kiểu chung chung hoàn toàn vắng mặt; thay vào đó là ngưỡng cụ thể — độ trễ end-to-end ≤1s (§4.1), tương phản AA ≥4.5:1/≥3:1 và giá trị đo thực tế 5.94:1/9.68:1/10.46:1 (§4.4, đối chiếu `addendum.md` §4). Hai UJ (Long, Minh) đều dẫn tới consequence cụ thể trong FR (ack-label, badge, debounce) — không phải persona trang trí, số lượng cũng phù hợp quy mô single-role tool.

## Strategic coherence — strong

Thesis rõ: VTCDigital hiện "không có khả năng tự giám sát" (§1) là nỗi đau ưu tiên hơn chi phí thuê ngoài — feature order bám theo thesis này: nền tảng truyền dẫn (§4.1, điều kiện tiên quyết) → giám sát thời gian thực (§4.2, giá trị cốt lõi) → cảnh báo tự động (§4.3, hiện thực hoá "phát hiện trong 1 phút") → khả năng tiếp cận vận hành (§4.4, đảm bảo giá trị cốt lõi hoạt động được trong điều kiện thực tế 24/7). SM-1 và SM-2 (§8) đo trực tiếp thesis (thời gian phát hiện, độ trễ truyền dẫn), không phải activity metric kiểu DAU. Counter-metrics SM-C1/SM-C2 chặn đúng hướng gaming khả dĩ nhất (hạ debounce để đẹp SM-1, ép nén quá tay để đẹp SM-2) — đây là dấu hiệu counter-metric được nghĩ thật, không phải điền cho đủ mục.

## Done-ness clarity — adequate

Phần lớn FR có consequence kiểm chứng được bằng số cụ thể (FR-5: AES-128/256 bắt buộc, passphrase riêng/kênh, từ chối handshake sai; FR-10/11: ngưỡng %, cooldown 60s, "kêu một lần duy nhất"; FR-13/14: contrast ratio, thứ tự Tab). Tuy nhiên có một mâu thuẫn ngưỡng cần chốt gấp, và một khoảng trống về giới hạn hành vi reconnect.

### Findings
- **critical** Mâu thuẫn ngưỡng bitrate giữa Glossary và FR-10 — §3 Glossary định nghĩa "Trạng thái kênh": `ok` (bitrate ≥70% gốc), `warning` (bitrate **<70%** gốc do ABR). Nhưng FR-10 (§4.3) viết: `"chú ý" khi bitrate hạ ≥70% so với cấu hình gốc (ABR đang hoạt động)` — dùng `≥70%` thay vì `<70%`, đảo ngược điều kiện định nghĩa gốc. Ví dụ cụ thể ở UJ-2 (§2.3, "bitrate hiện tại 62% so với gốc") khớp với Glossary (`<70%` → warning), càng cho thấy câu chữ ở FR-10 là lỗi soạn thảo, không phải chủ ý. Đây là FR quyết định trực tiếp logic phân loại cảnh báo — trung tâm của SM-1 — nếu đội kiến trúc/dev đọc theo câu chữ FR-10 thay vì Glossary sẽ cài sai điều kiện kích hoạt "chú ý". *Fix:* sửa FR-10 thành `khi bitrate hạ xuống dưới 70% so với cấu hình gốc` để khớp Glossary và ví dụ UJ-2.
- **medium** FR-1 (§4.1) "Kết nối tự động thử lại (reconnect) khi bị ngắt mà không cần can thiệp thủ công" không có giới hạn nào (số lần thử, backoff, khi nào coi là "mất hoàn toàn" để FR-3 color bars kích hoạt). Hai FR liên quan trực tiếp (FR-1 reconnect và FR-3 color bars) cần một ranh giới thời điểm chuyển giao rõ ràng để kiểm thử được. *Fix:* bổ sung 1 câu nêu rõ retry là vô hạn liên tục (không có "give up") hoặc trỏ về `addendum.md`/OQ nếu chưa chốt — hiện tại không có ASSUMPTION/OQ nào che phủ khoảng trống này.
- **low** FR-7 (§4.2) "Độ trễ cold-load ~1-2 giây" dùng dấu `~` (ước lượng) trong khi các NFR khác trong PRD đều dùng ngưỡng cứng (≤1s, ≤1 phút, ≥3:1). Không nhất quán về mức độ chắc chắn của ngưỡng. *Fix:* đổi thành ngưỡng kiểm thử được, ví dụ "≤2 giây" nếu đó là ý định, hoặc gắn `[ASSUMPTION]` nếu con số này chưa đo thực tế.

## Scope honesty — strong

§6 Non-Goals là điểm mạnh nhất của tài liệu: mỗi mục loại trừ đều có lý do và phân loại rõ "vĩnh viễn" (SRT Bonding — "ngoài phạm vi phần mềm vĩnh viễn (không phải 'để sau')"; bảo mật hạ tầng mạng) và "để sau" (Portal/API — "dự kiến ở giai đoạn sau"). Ba `[ASSUMPTION]` inline (FR-2, FR-4, FR-5) đều có mặt đầy đủ ở Assumptions Index (§10), không thừa không thiếu. `[NOTE FOR PM]` đặt đúng vào quyết định treo thật (escalation, §4.3 và §7.2). §7.3 tự thừa nhận căng thẳng giữa mốc 7 ngày và các chi tiết kỹ thuật chưa kiểm chứng (driver DeckLink, codec ABR) — và xử lý bằng rollout 2 giai đoạn thay vì giấu rủi ro hoặc hứa suông. Mật độ open-item (6 OQ + 3 ASSUMPTION + 2 NOTE FOR PM) là cao nhưng đã được chính PRD thừa nhận và có kế hoạch giảm thiểu (pilot trước khi mở rộng) — phù hợp bối cảnh nội bộ, không phải dấu hiệu né tránh.

## Downstream usability — strong

PRD là chain-top (nuôi `bmad-architecture` và `bmad-create-epics-and-stories` theo §0), nên dimension này có trọng số cao và đáp ứng tốt. ID liên tục không gap: FR-1→FR-14, UJ-1/UJ-2, SM-1/SM-2/SM-3/SM-C1/SM-C2, OQ-1→OQ-6. Mọi cross-reference kiểm tra được đều resolve đúng chỗ: OQ-3 ↔ §4.1 FR-1 & §6; OQ-6 ↔ FR-5 & §5 & §7.2; OQ-5 ↔ FR-12 Notes & §7.2. Thuật ngữ Glossary (`ok`/`warning`/`critical`, `debounce`, `cooldown`, `ack`, `disconnected`) dùng nhất quán xuyên UJ, FR, §5 — ngoại trừ điểm mâu thuẫn FR-10 đã nêu ở Done-ness. Hai UJ đều có protagonist tên riêng (Anh Long, Anh Minh) mang theo ngữ cảnh ca trực — không có UJ trôi nổi.

### Findings
- **low** Tag "Realizes UJ-N" áp dụng không đồng nhất: một số FR gắn trực tiếp (FR-2, FR-8), một số chỉ có ở cấp feature-header (§4.2, §4.3 nói "Realizes UJ-1, UJ-2" chung cho cả nhóm FR-6..FR-9 hoặc FR-10..FR-12) mà không rõ FR nào ứng với UJ nào cụ thể. Không chặn hiểu tài liệu nhưng khi trích riêng lẻ một FR ra khỏi ngữ cảnh feature, người đọc mất traceability tới UJ. *Fix:* nếu cần trace chi tiết cho story-splitting, cân nhắc gắn "Realizes UJ-N" ở từng FR thay vì chỉ ở feature description.

## Shape fit — strong

Đây là công cụ nội bộ single-operator role (đội trực sóng), và PRD chọn đúng shape: capability spec theo feature (§4.1–4.4) làm khung chính, UJ chỉ dùng 2 cái và cả hai đều load-bearing (dẫn tới consequence cụ thể trong FR) — không rơi vào UJ density thừa cho công cụ vận hành nội bộ. Success Metrics là operational (thời gian phát hiện, độ trễ truyền dẫn, ổn định giai đoạn thí điểm) thay vì user-satisfaction — đúng bản chất single-role tool. §5 Bảo mật xử lý như constraint traceability (yêu cầu chốt ↔ FR-5 ↔ Non-Goals ↔ OQ-6) dù không phải bối cảnh regulatory — cách tiếp cận phù hợp cho yêu cầu bổ sung có tính ràng buộc cứng. Không có dấu hiệu over-formalize (không có persona thừa, không ép UJ cho actor không thao tác hệ thống — 34 đài và lãnh đạo được liệt kê đúng là Non-Users ở §2.2) hay under-formalize (FR vẫn đủ chi tiết để kiểm thử).

## Mechanical notes

- Glossary drift: điểm duy nhất đáng kể là mâu thuẫn ngưỡng 70% giữa §3 và FR-10 (đã nêu ở Done-ness, findings critical) — cần sửa đồng bộ cả hai nơi nếu hướng sửa khác với đề xuất trên.
- ID continuity: FR/UJ/SM/OQ đều liên tục, không trùng, không gap.
- Assumptions Index roundtrip: khớp hoàn toàn — 3 `[ASSUMPTION]` inline (FR-2, FR-4, FR-5) đều có mặt ở §10, không có entry thừa hoặc thiếu.
- UJ protagonist naming: đạt — cả 2 UJ có tên riêng, giữ ngữ cảnh ca trực trong toàn bộ path.
- Required sections cho stakes nội bộ + chain-top: đầy đủ (Vision, Target User, Glossary, Features/FR, Security, Non-Goals, MVP Scope, Success Metrics, Open Questions, Assumptions Index).
- Vụn vặt: header YAML dòng 6 `version: v2 - bo sung yeu cau bao mat du lieu truyen tai` thiếu dấu tiếng Việt — không ảnh hưởng nội dung, chỉ là lỗi chính tả trong metadata.
