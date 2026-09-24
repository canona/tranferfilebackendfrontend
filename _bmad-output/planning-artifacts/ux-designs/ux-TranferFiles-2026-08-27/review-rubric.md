# Spine Pair Review — TranferFiles

## Overall verdict

Cặp spine DESIGN.md/EXPERIENCE.md có shape chuẩn, token/cross-ref sạch, và 2 Key Flow bám sát đúng 2 loại cảnh báo đã chốt trong brief/addendum — về cơ bản consumer (architecture, story-dev) source-extract được không vướng. Điểm yếu thật là **state coverage**: dashboard giám sát không có state nào cho tình huống chính hệ thống giám sát tự mất kết nối dữ liệu (khác với một kênh mất tín hiệu) — đây là lỗ hổng đáng kể cho một sản phẩm mà mục tiêu thành công cốt lõi là "phát hiện sự cố trong 1 phút". Ghi chú tự-đánh-giá trong `.memlog.md` ("Pass 1 self-check... đều strong") lạc quan hơn so với review độc lập này.

## 1. Flow coverage — strong

Sources không có PRD với UJ ID hình thức; brief.md liệt kê 3 pain points, trong đó chỉ pain #3 ("không tự giám sát được") thuộc scope MVP#1, và JTBD#2 (Portal/API) bị loại khỏi scope tường minh. EXPERIENCE.md có đúng 2 Key Flow, khớp 2 mức cảnh báo đã chốt trong addendum.md (ABR <70% → warning; mất tín hiệu → critical): Flow 1 (anh Long, mất tín hiệu) và Flow 2 (anh Minh, ABR). Cả hai có nhân vật tên riêng, bước đánh số, climax đánh dấu rõ (kể cả climax kép ở Flow 1: phát hiện + phục hồi), và failure path cụ thể. Journey "thấy cảnh báo → gọi điện → quay lại kiểm tra" từ `.memlog.md` dòng 24 khớp đúng Flow 1.

### Findings
- Không phát hiện thiếu sót.

## 2. Token completeness — adequate

Toàn bộ token trong frontmatter YAML (colors, typography, rounded, spacing, components) đều được định nghĩa đầy đủ với giá trị hex/px cụ thể, không có token "để trống". Mọi `{path.to.token}` reference trong DESIGN.md và EXPERIENCE.md đều resolve về đúng tên token trong frontmatter (đã kiểm bằng grep toàn bộ `{...}` — không có ref treo). Đã tính thử contrast ratio thực tế của các cặp màu cảnh báo: `on-state-warning`/`state-warning` = 9.68:1, `on-state-critical`/`state-critical` = 5.41:1, `text-primary`/`surface-base` = 17.01:1 — tất cả đều đạt AA thoải mái trên thực tế.

### Findings
- **medium** DESIGN.md không nêu contrast target số cụ thể (ví dụ "WCAG AA ≥4.5:1") cho bất kỳ cặp màu nào, kể cả cặp quan trọng nhất text-trên-nền-cảnh-báo (`on-state-warning`/`state-warning`, `on-state-critical`/`state-critical`) — chỉ có mô tả định tính "đảm bảo tương phản đọc được"/"tương phản tối đa" (`DESIGN.md` dòng 149, 200). Giá trị hex hiện tại đạt AA (đã verify độc lập), nhưng spine không tự chứng minh điều đó — downstream (dev) không có ngưỡng để kiểm tra khi thay đổi màu sau này. *Fix:* thêm 1 dòng trong `Colors` hoặc `Do's and Don'ts` nêu rõ ngưỡng tối thiểu (AA 4.5:1 cho text, 3:1 cho border/graphical) và xác nhận các cặp trọng yếu đã đạt.
- **low** Token `typography.label-caps` được mô tả bằng lời là dùng cho `alert-badge` (`DESIGN.md` dòng 162) nhưng component block `alert-badge` trong frontmatter (dòng 105–116) không có field `typography: '{typography.label-caps}'` như `ack-label` có (dòng 122). *Fix:* thêm field typography vào `alert-badge` cho nhất quán với cách khai báo của `ack-label`.

## 3. Component coverage — adequate

6 component trong `DESIGN.md.Components` (`channel-grid`, `channel-grid-cell`, `vu-meter`, `alert-badge`, `ack-label`, `detail-panel`) đều có visual spec. 5/6 có row hành vi tương ứng trong `EXPERIENCE.md.Component Patterns` với luật thật (debounce, độ trễ ack, điều kiện xuất hiện/biến mất...), không phải mô tả 1 từ. EXPERIENCE.md có thêm 2 row không có visual counterpart ("Âm thanh báo động", "Thông báo Telegram/Email") — hợp lý vì đây là hành vi phi-visual, không cần spec trong DESIGN.md.

### Findings
- **low** `channel-grid` (component container, có visual spec ở `DESIGN.md` dòng 193) không có row riêng trong `EXPERIENCE.md.Component Patterns`. Hành vi "vị trí cố định, không sắp xếp lại" của nó bị rải ở row `channel-grid-cell` (dòng 54) và ở `Interaction Primitives` (dòng 85) thay vì gom vào một row rõ ràng cho chính component `channel-grid`. *Fix:* cân nhắc thêm 1 row `channel-grid` riêng, hoặc chấp nhận hiện trạng nếu coi `channel-grid-cell` đã đủ đại diện — không chặn downstream nhưng gây khó tra cứu.

## 4. State coverage — thin

Đi qua 2 IA surface (`channel-grid`, `detail-panel`). `channel-grid-cell` có 5 state (`ok`, `warning`, `warning+acknowledged`, `critical`, `critical+acknowledged`) — đầy đủ theo logic cảnh báo đã chốt. `detail-panel` có 3 state (`loading`, `loaded`, `no-history-data`) — hợp lý. Permission-denied không áp dụng (persona duy nhất, full access) — đúng, không cần cover.

### Findings
- **critical** Không có state nào cho tình huống **chính dashboard mất kết nối với nguồn dữ liệu giám sát** (event stream/WebSocket chết, khác hoàn toàn với một kênh bị `critical` do mất tín hiệu SDI). Nếu pipeline dữ liệu đứng yên, theo spine hiện tại các ô kênh sẽ tiếp tục hiển thị trạng thái cũ (có thể là `ok`) vô thời hạn — tức là "false negative" hoàn toàn im lặng, trực tiếp phá vỡ mục tiêu thành công cốt lõi của brief ("rút ngắn thời gian phát hiện sự cố xuống 1 phút", `brief.md` dòng 59). Không surface nào trong `EXPERIENCE.md` (Foundation, State Patterns, Accessibility Floor) nhắc tới trường hợp này. *Fix:* thêm 1 state mới (ví dụ `stale`/`disconnected`) ở mức `channel-grid` toàn cục — phân biệt rõ với state `critical` của từng kênh — và một dòng trong Accessibility Floor/State Patterns mô tả cách phát hiện + hiển thị (ví dụ banner toàn cục + timestamp "cập nhật lần cuối").
- **medium** Không có "cold-load" state cho `channel-grid` khi app vừa mở, trước khi dữ liệu 34 kênh đầu tiên về (kiến trúc event-driven có độ trễ 1-2s theo addendum.md). `Foundation` chỉ nói "Mở app (mặc định, luôn hiển thị)" mà không mô tả UI trong khoảng thời gian ngắn chưa có dữ liệu. *Fix:* thêm 1 row state `cold-load`/`initial` (ví dụ skeleton/placeholder cho 34 ô) trong `State Patterns`, tương tự pattern "Cold app load" ở ví dụ Drift.
- **medium** Không có state/spec cho `focus` (bàn phím) trên `channel-grid-cell`. `Accessibility Floor` yêu cầu "toàn bộ thao tác phải thực hiện được bằng cả chuột và bàn phím" nhưng không có token màu focus-ring trong `DESIGN.md.colors` lẫn không có row `focus` trong `EXPERIENCE.md.State Patterns`/`Component Patterns` mô tả traversal (Tab qua 34 ô) và chỉ báo focus nhìn thấy được. *Fix:* thêm token `focus-ring` (hoặc tương đương) vào DESIGN.md và 1 dòng mô tả hành vi Tab-order trong Accessibility Floor.

## 5. Visual reference coverage — strong

Workspace `ux-TranferFiles-2026-08-27/` chỉ có 1 file tham chiếu thị giác: `.working/color-themes-1.html` (không có `mockups/`, `wireframes/`, `imports/`). File này được link inline và giải thích rõ ở `DESIGN.md.Colors` ("Bảng màu chốt theo phương án #1 'Electric Technical Blue' trong `.working/color-themes-1.html`", dòng 138) và có mặt trong frontmatter `sources` của cả hai file.

### Findings
- Không có orphan, không có tham chiếu mơ hồ.

## 6. Bloat & overspecification — strong

Độ chi tiết (5s debounce, cooldown 60s, ngưỡng 70%, hex cụ thể...) đều bắt nguồn trực tiếp từ quyết định đã chốt trong `addendum.md`/`.memlog.md`, không phải chi tiết bịa thêm. Không có section thừa, không lặp nội dung giữa 2 file (DESIGN.md giữ visual, EXPERIENCE.md giữ behavioral, ít chồng lấn).

### Findings
- Không phát hiện bloat đáng kể.

## 7. Inheritance discipline — strong

Tất cả 6 đường dẫn trong frontmatter `sources` của cả hai file resolve được (đã đọc trực tiếp). Thuật ngữ verbatim khớp nguồn: "đội trực sóng 24/7 của VTCDigital", "34 kênh/đài địa phương", "ABR", "color bars" đều lặp lại đúng cách brief/addendum dùng. Không có UJ ID hình thức nào trong sources để đối chiếu tên (brief không dùng UJ ID, chỉ có JTBD#2 — bị loại khỏi scope và đúng là không xuất hiện trong 2 spine). Tên component nhất quán tuyệt đối giữa DESIGN.md và EXPERIENCE.md. 3 ASSUMPTION cũ (line chart lịch sử, âm báo 1 lần, lưới 6x6) đã được resolve và đánh dấu nhất quán ở cả `.memlog.md` lẫn nội dung 2 file; ASSUMPTION còn treo (kích thước chữ theo khoảng cách TV wall) được gắn `[ASSUMPTION]` tường minh và trỏ chéo đúng giữa `DESIGN.md.Typography` và `EXPERIENCE.md.Accessibility Floor`.

### Findings
- **low** Trường `name` trong frontmatter khác nhau giữa 2 file: DESIGN.md = "TranferFiles — Dashboard Giám Sát SRT", EXPERIENCE.md = "TranferFiles". *Fix:* thống nhất một giá trị (khuyến nghị dùng bản ngắn "TranferFiles" ở cả hai, để mô tả dài nằm ở `description`).

## 8. Shape fit — strong

DESIGN.md theo đúng thứ tự canonical 8 section (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts), không thiếu, không đảo thứ tự. EXPERIENCE.md có đủ 8 section mặc định (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows). Hai section tuỳ chọn bị bỏ — `Responsive & Platform` và `Inspiration & Anti-patterns` — đều hợp lý: sản phẩm là desktop app single-surface cố định trên TV wall (không multi-breakpoint), và không có source nào trong `.memlog.md`/brief nhắc tới sản phẩm tham chiếu/inspiration để trích dẫn.

### Findings
- Không phát hiện lệch shape.

## Mechanical notes

- Tên không nhất quán: `name` frontmatter khác nhau giữa DESIGN.md ("TranferFiles — Dashboard Giám Sát SRT") và EXPERIENCE.md ("TranferFiles") — xem finding ở mục 7.
- Tất cả cross-ref `{path.to.token}` giữa hai file đều resolve đúng; không có broken reference.
- Frontmatter đầy đủ trường bắt buộc ở cả hai file (`name`, `status`, `sources`, `updated`; DESIGN.md có thêm `description`, `colors`, `typography`, `rounded`, `spacing`, `components`).
- Không có diagram Mermaid trong cặp spine — không áp dụng kiểm tra lỗi Mermaid.
- `.memlog.md` tự đánh giá "Pass 1 self-check: flow/token/component/state coverage đều strong" (dòng 31) — review độc lập này không đồng ý ở mục State coverage (xem mục 4), cụ thể là thiếu state mất-kết-nối-dữ-liệu toàn cục.
