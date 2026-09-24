---
name: TranferFiles
description: Dashboard giám sát nội bộ 20 kênh truyền dẫn SDI→SRT→SDI của VTCDigital, chạy trên desktop app hiển thị màn hình TV lớn tại phòng trực 24/7. Dark theme mặc định, accent Electric Technical Blue.
status: final
sources:
  - "{planning_artifacts}/briefs/brief-TranferFiles-2026-08-27/brief.md"
  - "{planning_artifacts}/briefs/brief-TranferFiles-2026-08-27/addendum.md"
  - "_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/brainstorm-intent.md"
  - "_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/architecture-onepager.md"
  - "{planning_artifacts}/ux-designs/ux-TranferFiles-2026-08-27/.memlog.md"
  - "{planning_artifacts}/ux-designs/ux-TranferFiles-2026-08-27/mockups/color-themes-1.html"
updated: 2026-08-31
colors:
  surface-base: '#0A0E14'
  surface-raised: '#121B27'
  border: '#223247'
  text-primary: '#EAF1FB'
  text-secondary: '#8CA0BE'
  accent: '#2F8FFF'
  state-ok: '#2F8FFF'
  state-warning: '#F5B915'
  state-critical: '#FF3B3B'
  on-state-warning: '#241A00'
  on-state-critical: '#000000'
  on-state-ok: '#EAF1FB'
  audio-normal: '#35D07F'
  focus-ring: '#2F8FFF'
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 22px
    fontWeight: '600'
    lineHeight: '1.3'
  heading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 18px
    fontWeight: '700'
    lineHeight: '1.3'
  channel-name:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.25'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.45'
  label-caps:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 13px
    fontWeight: '700'
    letterSpacing: 0.02em
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.3'
  numeric:
    fontFamily: '"SF Mono", "Cascadia Code", Consolas, "Courier New", monospace'
    # [ASSUMPTION] cần đo lại theo khoảng cách xem TV wall thật
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.2'
rounded:
  sm: 4px
  md: 9px
  lg: 14px
  pill: 10px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  cell-gap: 12px
  panel-padding: 24px
components:
  channel-grid:
    background: '{colors.surface-base}'
    gap: '{spacing.cell-gap}'
    layout: 'lưới cố định 20 ô, 5 cột x 4 hàng, không có ô dự phòng, vị trí theo đài không đổi khi có cảnh báo'
  channel-grid-cell:
    background: '{colors.surface-raised}'
    radius: '{rounded.md}'
    border-width: '1.5px'
    states:
      ok:
        border: '{colors.border}'
        background: '{colors.surface-raised}'
      warning:
        border: '{colors.state-warning}'
        background: 'color-mix(in srgb, {colors.state-warning} 14%, {colors.surface-raised})'
      critical:
        border: '{colors.state-critical}'
        background: 'color-mix(in srgb, {colors.state-critical} 18%, {colors.surface-raised})'
        thumbnail-override: 'color bars thay cho hình thumbnail'
      acknowledged:
        border-style: 'dashed'
        note: 'không có màu riêng — giữ nguyên border-color + background của state warning/critical hiện tại, chỉ đổi border-style sang dashed và cộng thêm ack-label'
  vu-meter:
    bar-color-normal: '{colors.audio-normal}'
    bar-color-warning: '{colors.state-warning}'
    bar-color-peak: '{colors.state-critical}'
    threshold-tick:
      warning-mark: 'vạch ngang 1px màu {colors.text-primary}, cố định tại đúng mốc chuyển audio-normal → state-warning, luôn hiển thị bất kể mức âm thanh hiện tại — chỉ báo phi-màu'
      peak-mark: 'vạch ngang 1px màu {colors.text-primary}, cố định tại đúng mốc chuyển state-warning → state-critical, đậm/dài hơn warning-mark để phân biệt hai vạch bằng hình dạng chứ không chỉ vị trí'
    radius: '{rounded.sm}'
    count-per-cell: 2
  alert-badge:
    radius: '{rounded.sm}'
    typography: '{typography.label-caps}'
    ok:
      background: 'color-mix(in srgb, {colors.state-ok} 25%, transparent)'
      text: '{colors.on-state-ok}'
      border: '1px solid color-mix(in srgb, {colors.state-ok} 55%, transparent)'
    warning:
      background: '{colors.state-warning}'
      text: '{colors.on-state-warning}'
    critical:
      background: '{colors.state-critical}'
      text: '{colors.on-state-critical}'
  ack-label:
    background: 'transparent'
    text: '{colors.text-primary}'
    border: '1px dashed {colors.text-primary}'
    radius: '{rounded.pill}'
    typography: '{typography.body}'
  detail-panel:
    background: '{colors.surface-raised}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    padding: '{spacing.panel-padding}'
  connection-banner:
    background: '{colors.state-critical}'
    text: '{colors.on-state-critical}'
    typography: '{typography.body}'
    position: 'toàn chiều rộng, cố định đầu màn hình, trên tất cả các lớp khác kể cả detail-panel'
    grid-overlay: 'color-mix(in srgb, {colors.surface-base} 70%, transparent)'
---

## Brand & Style

Đây là công cụ vận hành, không phải sản phẩm tiêu dùng. Toàn bộ giao diện phục vụ đúng một tác vụ: đội trực sóng 24/7 của VTCDigital nhìn lên màn hình TV wall trong phòng trực và biết ngay 20 kênh có đang ổn không. Không có sự trang trí thừa — mọi pixel tồn tại để trả lời câu hỏi "kênh nào đang có vấn đề, mức độ nào".

Cảm xúc mục tiêu là **Electric Technical Blue**: sắc bén, tỉnh táo, năng lượng cao — cảm giác trạm điều khiển kỹ thuật cao (control room), không phải cảm giác "app doanh nghiệp". Nền tối gần như tuyệt đối, chữ trắng ánh xanh, và một màu xanh điện (`{colors.accent}`) duy nhất kéo mắt về những gì đang hoạt động. Trạng thái cảnh báo (vàng/đỏ) là ngoại lệ hiếm hoi được phép nổi bật hơn accent — đúng chức năng của nó: ngắt sự chú ý khỏi 19 kênh đang ổn để dồn vào kênh đang gặp sự cố.

## Colors

Bảng màu chốt theo phương án #1 "Electric Technical Blue" trong [`mockups/color-themes-1.html`](mockups/color-themes-1.html) — dark-only theo đúng quyết định trong memlog (phòng trực tối, giảm chói, nổi bật màu cảnh báo trên TV wall suốt 24/7; sản phẩm không có chế độ light nên spine chỉ định nghĩa một bộ token, không cần cặp `-dark`).

- **`surface-base` (`#0A0E14`)** — nền chính của toàn bộ lưới 20 kênh, gần đen ánh xanh. Không dùng cho card/panel.
- **`surface-raised` (`#121B27`)** — nền của từng ô kênh (`channel-grid-cell`) và `detail-panel`, tách lớp nhẹ khỏi `surface-base` bằng tông chứ không phải shadow.
- **`border` (`#223247`)** — viền mặc định của ô kênh ở trạng thái `ok`, không mang nghĩa cảnh báo.
- **`text-primary` (`#EAF1FB`)** — chữ chính: tên đài, số liệu bitrate, tiêu đề panel.
- **`text-secondary` (`#8CA0BE`)** — chữ phụ: caption, timestamp, ghi chú trạng thái.
- **`accent` (`#2F8FFF`)** — xanh điện thương hiệu VTC. Dùng cho header, nút hành động chính, và trùng với `state-ok` (kênh hoạt động bình thường mang đúng màu thương hiệu — "mọi thứ ổn" = "đúng màu nhà").
- **`state-ok` (`#2F8FFF`)** — dùng chung giá trị với `accent`, chủ đích: kênh OK không cần một màu "trạng thái" riêng — `state-ok` chính là màu nền tảng của hệ thống.
- **`state-warning` (`#F5B915`)** — vàng cảnh báo, dành riêng cho trạng thái ABR đang hạ bitrate (<70% gốc). Không dùng cho mục đích trang trí hay nhấn mạnh khác.
- **`state-critical` (`#FF3B3B`)** — đỏ, dành riêng cho mất tín hiệu (color bars). Đây là màu nghiêm trọng nhất trong hệ thống, không chia sẻ với bất kỳ ngữ nghĩa nào khác.
- **`on-state-warning` (`#241A00`)** — màu chữ trên nền `state-warning` đặc (ví dụ chữ trong `alert-badge`). Đo được **9.68:1** so với `state-warning` — vượt AAA.
- **`on-state-critical` (`#000000`)** — màu chữ trên nền `state-critical` đặc. Đổi từ `#2A0000` sang đen tuyệt đối: nền `state-critical` (`#FF3B3B`) có luminance quá cao để bất kỳ chữ tối màu nào đạt AAA (7:1) — trần lý thuyết tối đa chỉ ~5.9:1 kể cả với đen tuyệt đối. Đo được **5.94:1** — đạt và vượt AA (4.5:1), đây là target chính thức của token này (xem mục tiêu tương phản bên dưới).
- **`on-state-ok` (`#EAF1FB`, dùng chung giá trị `text-primary`)** — màu chữ `alert-badge` ở trạng thái `ok`, đặt trên nền `state-ok` pha 25% lên `surface-raised`. Trước đây chữ dùng thẳng `{colors.state-ok}`, đo được chỉ **3.68:1** — dưới AA. Đổi sang `on-state-ok`: đo được **10.46:1**, đạt AA thoải mái.
- **`audio-normal` (`#35D07F`)** — xanh lá riêng cho dải an toàn của `vu-meter` (đo mức âm thanh thực tế theo kênh, độc lập với trạng thái SRT). Không được dùng làm màu trạng thái kênh — VU meter và trạng thái kênh là hai hệ ngữ nghĩa khác nhau dù cùng xuất hiện trong một ô.
- **`focus-ring` (`#2F8FFF`, dùng chung giá trị `accent`)** — viền focus bàn phím khi `Tab` tới `channel-grid-cell` hoặc control trong `detail-panel` (xem `EXPERIENCE.md.Accessibility Floor`). Đo được **5.98:1** so với `surface-base` và **5.36:1** so với `surface-raised` — vượt ngưỡng ≥3:1 cho thành phần đồ hoạ/border, nên dùng chung giá trị `accent` thay vì thêm màu mới.

**Ngưỡng tương phản mục tiêu:** hệ thống nhắm **AA** (text thường ≥4.5:1, thành phần đồ hoạ/border/focus-ring ≥3:1) trên toàn bộ token màu. **AAA (7:1) không được theo đuổi có chủ đích cho `on-state-critical`/`state-critical`**: `state-critical` cần giữ độ bão hoà/độ sáng cao (`#FF3B3B`) để bắt mắt ngoại vi (peripheral vision) trong phòng trực tối — làm nền tối hơn để ép đạt AAA sẽ làm giảm khả năng "giật mình" nhận ra cảnh báo từ xa, phản tác dụng với đúng mục đích của màu này. Số đo chi tiết xem tại từng token ở trên; hai giá trị bổ sung chưa nêu: `text-primary`/`surface-base` = 17.01:1, `focus-ring`/`surface-base` = 5.98:1.

Tránh: gradient trang trí, thêm màu chromatic thứ ba ngoài vàng/đỏ cho trạng thái, dùng `state-ok`/`accent` cho bất kỳ cảnh báo nào, làm tối `state-critical` hơn nữa chỉ để ép đạt AAA (đánh đổi khả năng bắt mắt ngoại vi trong phòng trực tối).

## Typography

Toàn bộ hệ chữ dùng system-ui stack (không tải font ngoài — quan trọng cho một app chạy cố định 24/7 trên máy trực, giảm phụ thuộc mạng/CDN). Vai trò chữ tách theo mật độ đọc trên lưới 20 ô và panel chi tiết:

- **`display`** — tiêu đề toàn màn hình (nếu có), hiếm khi dùng.
- **`heading`** — tiêu đề `detail-panel` (tên đài).
- **`channel-name`** — tên đài trên mỗi ô lưới, luôn hiển thị, phải đọc được trước tiên.
- **`body`** — nội dung panel chi tiết, tên/SĐT đầu mối liên hệ, `ack-label` (nâng từ `caption` 12px lên 14px — đây là tín hiệu chống-gọi-trùng, không được đọc nhầm ở khoảng cách xa).
- **`label-caps`** — nhãn `alert-badge` (`OK`, `⚠ ABR`, `✕ MẤT TÍN HIỆU`), viết hoa, letter-spacing rộng để dễ nhận diện dạng khối màu + chữ ở khoảng cách xa.
- **`caption`** — timestamp, ghi chú trạng thái.
- **`numeric`** — monospace, dùng riêng cho số liệu bitrate (hiện tại + trong biểu đồ lịch sử) để các con số thẳng hàng, dễ so sánh nhanh bằng mắt.

**[ASSUMPTION]** Kích thước điểm ảnh trong bảng trên là điểm khởi đầu (scale lên so với bản mock trình duyệt trong [`mockups/color-themes-1.html`](mockups/color-themes-1.html), vốn được thiết kế cho card xem trên web chứ không phải ô kênh thật trên TV wall). Kích thước cuối cùng cần xác nhận trên thiết bị thật theo khoảng cách xem thực tế của phòng trực — xem thêm `EXPERIENCE.md.Accessibility Floor`.

## Layout & Spacing

Thang giãn cách theo bội số 4px (`{spacing.1}`–`{spacing.6}`), cộng hai token đặt tên cho khu vực đặc thù: `cell-gap` (khoảng cách giữa các ô trong `channel-grid`) và `panel-padding` (đệm trong của `detail-panel`).

Nguyên tắc bố cục quan trọng nhất của sản phẩm này: **lưới 20 ô cố định vị trí theo đài, không sắp xếp lại theo trạng thái hay mức độ nghiêm trọng** (quyết định trong memlog — đội trực quen vị trí, cảnh báo không được làm xáo trộn bản đồ tinh thần của họ). Bố cục 5 cột x 4 hàng, khớp đúng 20 ô, không có ô dự phòng — mở rộng thêm đài trong tương lai (xem `brief.md` §Tầm nhìn) cần thiết kế lại lưới, không phải việc bố cục hiện tại xử lý sẵn. Tỷ lệ gần vuông phù hợp với màn hình TV wall, ưu tiên quét mắt nhanh hơn là khớp đúng tỷ lệ 16:9.

Layout đơn-surface (single view chính) — `detail-panel` là lớp phủ (overlay) trên lưới, không phải điều hướng sang trang khác; lưới 20 ô vẫn hiển thị phía sau/xung quanh panel để đội trực không mất bối cảnh tổng thể khi xem chi tiết một kênh.

## Elevation & Depth

Phẳng, có chủ đích. Không dùng shadow để phân lớp — tách lớp hoàn toàn bằng tông màu (`surface-base` → `surface-raised`) và viền `{colors.border}`. Một phòng trực nhìn màn hình TV liên tục nhiều giờ không cần chiều sâu thị giác kiểu "nổi khối" — cần đọc được trạng thái tức thì, và shadow chỉ làm nhiễu độ tương phản của viền cảnh báo.

`detail-panel` nổi lên trên lưới nền như một overlay nhưng vẫn dùng nguyên tắc tông màu, không thêm shadow.

## Shapes

- **`rounded.sm` (4px)** — `alert-badge`, các control nhỏ.
- **`rounded.md` (9px)** — `channel-grid-cell`, khối chính của toàn bộ lưới.
- **`rounded.lg` (14px)** — `detail-panel`, khối nổi lớn nhất trên màn hình.
- **`rounded.pill` (10px)** — `ack-label`, hình viên thuốc nhỏ để phân biệt rõ với `alert-badge` dù cùng nằm trong ô kênh.

Không dùng góc vuông tuyệt đối (0px) ở đâu — bo nhẹ giữ cảm giác "màn hình điều khiển" chứ không "bảng dữ liệu thô".

## Components

- **`channel-grid`** — vùng chứa 20 `channel-grid-cell`, nền `{colors.surface-base}`, khoảng cách `{spacing.cell-gap}` giữa các ô. Tham chiếu thị giác: [`mockups/key-channel-grid.html`](mockups/key-channel-grid.html) (trạng thái mặc định + `cold-load`/`disconnected`).
- **`channel-grid-cell`** — đơn vị hiển thị một kênh: thumbnail/color-bars + 2 `vu-meter` + tên đài (`{typography.channel-name}`) + `alert-badge`. 4 trạng thái:
  - **`ok`** — viền `{colors.border}`, nền `{colors.surface-raised}`, badge dùng `{colors.state-ok}`.
  - **`warning`** — viền `{colors.state-warning}`, nền pha 14% `state-warning` vào `surface-raised`, thumbnail giữ hình thật kèm icon cảnh báo chồng lên.
  - **`critical`** — viền `{colors.state-critical}`, nền pha 18% `state-critical` vào `surface-raised`, thumbnail thay hoàn toàn bằng color bars.
  - **`acknowledged`** — cờ độc lập, không phải màu riêng: chồng lên trạng thái `warning` hoặc `critical` hiện có, đổi kiểu viền sang nét đứt (dashed) và thêm `ack-label` bên dưới. Màu nền/viền gốc của trạng thái cảnh báo giữ nguyên.
- **`vu-meter`** — 2 thanh mức âm/kênh, gradient 3 mốc: `{colors.audio-normal}` → `{colors.state-warning}` → `{colors.state-critical}` theo mức âm thanh thực tế, hoạt động độc lập với trạng thái SRT của kênh. Hai vạch ngưỡng cố định (`threshold-tick.warning-mark`, `threshold-tick.peak-mark`) luôn hiển thị trên thanh đo bất kể màu hiện tại — chỉ báo phi-màu, không tắt/ẩn theo trạng thái.
- **`alert-badge`** — nhãn trạng thái góc trên ô kênh, luôn có cả màu nền VÀ chữ/icon (không bao giờ chỉ là một khối màu trơn), chữ dùng `{typography.label-caps}`. `ok` dùng nền pha loãng của `state-ok` với chữ `{colors.on-state-ok}` (không dùng thẳng `state-ok` — tương phản đo được chỉ 3.68:1, dưới AA); `warning`/`critical` dùng nền đặc + chữ tối (`on-state-warning`/`on-state-critical`) để tương phản tối đa.
- **`ack-label`** — nhãn phụ dạng viên thuốc, viền đứt nét `{colors.text-primary}`, nền trong suốt, chứa tên người đã tiếp nhận (ví dụ "✓ Đã nhận: A.Long"). Xuất hiện thêm vào, không thay thế `alert-badge`.
- **`detail-panel`** — overlay mở khi click vào một ô kênh: bitrate hiện tại (`{typography.numeric}`), biểu đồ lịch sử bitrate theo thời gian, tên đài (`{typography.heading}`), tên và số điện thoại đầu mối liên hệ xử lý sự cố của đài đó. Tham chiếu thị giác: [`mockups/key-detail-panel.html`](mockups/key-detail-panel.html) (state `loaded` trước/sau ack).
- **`connection-banner`** — banner cảnh báo toàn cục, chiếm hết chiều rộng đầu màn hình, nằm trên tất cả lớp khác kể cả `detail-panel`. Nền `{colors.state-critical}`, chữ `{colors.on-state-critical}` — dùng tông nghiêm trọng nhất hệ thống vì đây là mất hoàn toàn khả năng giám sát (event stream chết), không phải cảnh báo của riêng một kênh. Khi active, phủ thêm `grid-overlay` (`color-mix(in srgb, {colors.surface-base} 70%, transparent)`) lên toàn bộ `channel-grid` để làm mờ lưới, ngăn đội trực nhầm dữ liệu cũ là đang live.

*Mock chỉ minh hoạ — khi mock và spine (token/prose trên) lệch nhau, spine luôn thắng.*

## Do's and Don'ts

| Do | Don't |
|---|---|
| Luôn đi kèm icon/chữ với mọi màu trạng thái (`alert-badge` không bao giờ chỉ là khối màu) — người mù màu hoặc ánh sáng phòng biến động vẫn đọc được trạng thái | Dùng riêng màu viền/nền làm tín hiệu duy nhất cho warning/critical |
| Giữ nguyên màu/kiểu nền cảnh báo sau khi acknowledge, chỉ thêm `ack-label` | Đổi màu ô kênh sang một màu "đã xử lý" riêng khi ack — sự cố chưa hết chỉ vì có người nhận |
| Giữ lưới 2 ô cố định vị trí tuyệt đối theo đài | Sắp xếp lại, lọc, hoặc ẩn ô kênh theo mức độ nghiêm trọng |
| `state-ok` dùng chung giá trị với `accent` — OK là trạng thái nền tảng | Thêm màu "OK" riêng khác `accent` 
| Phẳng, phân lớp bằng tông màu (`surface-base`/`surface-raised`) | Thêm shadow/gradient trang trí để tạo chiều sâu |
| `vu-meter` dùng thang màu âm thanh riêng (`audio-normal`/`state-warning`/`state-critical`) | Diễn giải màu của `vu-meter` như trạng thái SRT của kênh |
| Hiện `connection-banner` + làm mờ toàn bộ `channel-grid` ngay khi mất kết nối dữ liệu giám sát | Để lưới trông "bình thường" khi dữ liệu đã cũ/ngừng cập nhật |
| Chữ/icon đủ lớn để đọc được từ khoảng cách xem TV wall thực tế | Giữ nguyên kích thước chữ của bản mock xem trên trình duyệt máy tính |
