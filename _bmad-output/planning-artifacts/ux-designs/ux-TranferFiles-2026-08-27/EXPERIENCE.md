---
name: TranferFiles
status: final
sources:
  - "{planning_artifacts}/briefs/brief-TranferFiles-2026-08-27/brief.md"
  - "{planning_artifacts}/briefs/brief-TranferFiles-2026-08-27/addendum.md"
  - "_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/brainstorm-intent.md"
  - "_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/architecture-onepager.md"
  - "{planning_artifacts}/ux-designs/ux-TranferFiles-2026-08-27/.memlog.md"
  - "{planning_artifacts}/ux-designs/ux-TranferFiles-2026-08-27/mockups/color-themes-1.html"
updated: 2026-08-31
---

# TranferFiles — Experience Spine

> Dashboard giám sát nội bộ VTCDigital cho 20 kênh truyền dẫn SDI→SRT→SDI, hiển thị trên màn hình TV lớn tại phòng trực 24/7 (chi tiết persona/phạm vi ở Foundation). Paired với `DESIGN.md`.

## Foundation

Single-surface desktop app, dark theme mặc định (không có light mode — quyết định trong memlog, phòng trực tối 24/7). Chạy trên máy trực kết nối màn hình TV lớn tại phòng trực, không phải laptop cá nhân — mọi kích thước/khoảng cách đọc phải tính theo bối cảnh xem từ xa, không phải xem gần trên bàn làm việc.

Persona duy nhất: đội trực sóng kỹ thuật VTCDigital, vận hành ca 24/7. Lãnh đạo VTCDigital **không** phải user của dashboard — chỉ nhận thông báo Telegram/Email khi có cảnh báo mất tín hiệu, không có UI riêng. 20 đài địa phương không có quyền truy cập, không có view nào được thiết kế cho họ ở đợt này.

`DESIGN.md` là tham chiếu thị giác (màu, chữ, bo góc, token component); spine này mô tả hành vi.

## Information Architecture

| Surface | Truy cập từ | Mục đích |
|---|---|---|
| Lưới tổng quan (`channel-grid`) | Mở app (mặc định, luôn hiển thị) | Toàn cảnh 20 kênh: trạng thái, thumbnail/color-bars, VU meter theo thời gian thực |
| Panel chi tiết kênh (`detail-panel`) | Click vào một `channel-grid-cell` bất kỳ trên lưới tổng quan | Bitrate hiện tại + lịch sử, tên đài, tên và SĐT đầu mối liên hệ xử lý sự cố |

Chỉ hai surface, không có điều hướng dạng tab/sidebar/trang riêng — lưới tổng quan luôn là màn hình gốc, panel chi tiết là overlay nổi lên trên nó (đóng lại quay về đúng lưới, không mất ngữ cảnh 20 kênh). Không có surface cấu hình/quản trị trong đợt này — cấu hình kênh nằm ngoài phạm vi (xem `brief.md`).

Tham chiếu thị giác: [`mockups/key-channel-grid.html`](mockups/key-channel-grid.html) (lưới tổng quan, cả `cold-load`/`disconnected`), [`mockups/key-detail-panel.html`](mockups/key-detail-panel.html) (panel chi tiết). Mock chỉ minh hoạ — spine luôn thắng khi lệch nhau.

## Voice and Tone

Microcopy cho nhãn trạng thái, badge và nút ack. Không phải giọng thương hiệu (xem `DESIGN.md.Brand & Style`) — đây là nhãn vận hành, phải ngắn, chính xác, đọc được trong một cái liếc mắt từ xa.

| Do | Don't |
|---|---|
| `OK` | `Bình thường ✓✓✓` |
| `⚠ ABR` (kèm caption "Bitrate <70%") | `Cảnh báo nhẹ, không cần lo lắng!` |
| `✕ MẤT TÍN HIỆU` | `Lỗi kết nối` (mơ hồ, không nói rõ mức độ) |
| `✓ Đã nhận: {tên viết tắt}` (ví dụ "Đã nhận: A.Long") | `Đã xử lý xong` (ack không có nghĩa là đã hết sự cố) |
| Nút hành động: `Xác nhận đã tiếp nhận` | `OK`, `Đồng ý` (trùng với nhãn trạng thái `OK`, gây nhầm) |
| Số liệu trần trụi: `Bitrate: 62%` | Diễn giải cảm tính: `Bitrate hơi thấp` |

## Component Patterns

Hành vi. Thị giác đã có ở `DESIGN.md.Components`.

| Component | Dùng ở | Quy tắc hành vi |
|---|---|---|
| `channel-grid` | Toàn màn hình, luôn hiển thị (màn hình gốc) | Vị trí 20 ô cố định tuyệt đối theo đài, không bao giờ sắp xếp lại/lọc/ẩn theo trạng thái hay mức độ nghiêm trọng — kể cả khi có cảnh báo, khi vừa mở app (`cold-load`), hay khi mất kết nối dữ liệu giám sát (`disconnected`). Hai trạng thái toàn cục này là của riêng `channel-grid`, khác trạng thái từng ô — xem chi tiết ở State Patterns. |
| `channel-grid-cell` | Lưới tổng quan | Click ở bất kỳ đâu trên ô → mở `detail-panel` của đúng kênh đó. Chuyển trạng thái (ok↔warning↔critical) chỉ diễn ra sau khi trạng thái mới giữ ổn định **≥5 giây** (debounce) — tránh ô nhấp nháy do nhiễu tức thời. |
| `alert-badge` | Góc mỗi `channel-grid-cell` | Luôn hiển thị đồng thời màu + icon/chữ, không bao giờ chỉ đổi màu nền một mình (quyết định accessibility trong memlog). Cập nhật cùng nhịp debounce với trạng thái ô. |
| `ack-label` | Dưới `channel-grid-cell` đang warning/critical | Xuất hiện khi một thành viên đội trực bấm nút "Xác nhận đã tiếp nhận" trong `detail-panel` của kênh đó. Chỉ thêm nhãn tên người ack — **không đổi màu, không đổi badge, không xoá cảnh báo**. Mục đích duy nhất: tránh hai người cùng gọi điện xử lý trùng một sự cố. Nhãn tự biến mất khi kênh phục hồi về `ok` (không phải khi ack — ack và phục hồi là hai sự kiện độc lập). |
| `detail-panel` | Overlay sau khi click một ô kênh | Mở tức thì, không chặn thao tác khác trên lưới tổng quan phía sau. Hiển thị: bitrate hiện tại, biểu đồ đường (line chart) lịch sử bitrate theo thời gian, tên đài, tên và SĐT đầu mối liên hệ. Đóng bằng click ra ngoài panel hoặc phím `Esc`. |
| `vu-meter` | 2 thanh/ô, mọi trạng thái | Cập nhật thời gian thực theo mức âm thanh thực tế của kênh, **không** qua debounce (đây là đồng hồ đo tức thời, không phải trạng thái cảnh báo). Hoạt động độc lập với trạng thái SRT — một kênh `critical` mất hình vẫn có thể còn hiển thị `vu-meter` ở mức thấp/im lặng. Hai vạch ngưỡng cố định (threshold tick, xem `DESIGN.md.vu-meter`) luôn hiển thị trên thanh đo, không phụ thuộc màu/trạng thái — chỉ báo phi-màu bổ sung cho gradient màu. |
| Âm thanh báo động | Toàn cục (không gắn 1 ô cụ thể) | Phát khi có cảnh báo **mới** xuất hiện (sau debounce ≥5 giây), song song với đổi màu ô + gửi Telegram/Email. Kêu **một lần duy nhất** cho mỗi lần chuyển trạng thái mới — không lặp lại theo cooldown 60s như Telegram/Email (khác biệt có chủ đích: âm thanh chỉ để bắt sự chú ý ban đầu, việc nhắc lại định kỳ đã có kênh Telegram/Email đảm nhiệm). |
| Thông báo Telegram/Email | Ngoài dashboard, tới đội trực + lãnh đạo | Cảnh báo mới: cooldown lặp lại tối thiểu **60 giây** cho cùng loại cảnh báo trên cùng kênh. Thông báo phục hồi (trở lại `ok`): gửi ngay lập tức, không bị cooldown chặn. |

## State Patterns

**Lưới tổng quan — trạng thái toàn cục của `channel-grid` (không phải từng ô):**

| State | Điều kiện | Thể hiện |
|---|---|---|
| `cold-load` | Vừa mở app, dữ liệu 20 kênh đầu tiên chưa về (độ trễ event-driven ~1-2s) | Toàn bộ 20 ô hiện dạng skeleton/placeholder (khung ô + vùng chờ dữ liệu), không phải màn hình trắng/trống. Từng ô chuyển sang dữ liệu thật ngay khi kênh đó về, không chờ đủ cả 20 kênh cùng lúc. |
| `disconnected` | Mất kết nối tới nguồn dữ liệu giám sát (event stream chết) — khác hoàn toàn với một kênh `critical`, đây là toàn hệ thống mất khả năng giám sát | `connection-banner` hiện toàn chiều rộng đầu màn hình: "Mất kết nối dữ liệu giám sát — cập nhật lần cuối: HH:mm". Toàn bộ lưới 20 ô bị làm mờ/xám (`grid-overlay` trong `DESIGN.md`) để không ai nhầm dữ liệu cũ là đang live; số liệu từng ô đứng yên ở giá trị cuối cùng nhận được, không tự nội suy. |
| `disconnected` → phục hồi | Kết nối lại nguồn dữ liệu giám sát thành công | `connection-banner` biến mất ngay lập tức, `grid-overlay` gỡ bỏ, lưới trở lại rõ nét; dữ liệu resume cập nhật thời gian thực từ event tiếp theo — không cần reload thủ công. |

**Lưới tổng quan — mỗi `channel-grid-cell`:**

| State | Điều kiện | Thể hiện |
|---|---|---|
| `ok` | Bitrate ≥70% gốc, tín hiệu bình thường | Viền/nền `{colors.state-ok}`-neutral, badge `OK`, thumbnail hình thật |
| `warning` | Bitrate <70% gốc do ABR, giữ ổn định ≥5 giây | Viền `{colors.state-warning}`, badge `⚠ ABR` |
| `critical` | Mất tín hiệu, color bars, giữ ổn định ≥5 giây | Viền `{colors.state-critical}`, badge `✕ MẤT TÍN HIỆU`, thumbnail = color bars, âm thanh báo động đã phát |
| `warning`/`critical` + `acknowledged` | Đã có người bấm tiếp nhận | Giữ nguyên viền/nền của trạng thái gốc, cộng `ack-label` |

**Panel chi tiết kênh:**

| State | Điều kiện | Thể hiện |
|---|---|---|
| `loading` | Vừa mở panel, dữ liệu bitrate/lịch sử chưa về | Khung panel hiện ngay (không chờ), vùng số liệu và biểu đồ ở trạng thái skeleton/placeholder |
| `loaded` | Đầy đủ dữ liệu | Bitrate hiện tại, biểu đồ lịch sử, tên đài, tên + SĐT đầu mối liên hệ |
| `no-history-data` | Kênh mới hoặc chưa đủ dữ liệu lịch sử để vẽ biểu đồ | Vẫn hiện bitrate hiện tại; vùng biểu đồ hiện thông báo chưa đủ dữ liệu thay vì biểu đồ rỗng gây hiểu nhầm là bitrate = 0 |

## Interaction Primitives

- **Click** là hành động chính: click vào ô kênh mở `detail-panel`; click ra ngoài panel hoặc `Esc` đóng panel. Tương đương bàn phím đầy đủ (chi tiết ở Accessibility Floor): `Tab` di chuyển focus qua 20 ô theo đúng thứ tự vị trí lưới, `Enter`/`Space` mở `detail-panel` của ô đang focus, `Esc` đóng panel. Đội trực thao tác bằng chuột/bàn phím tại máy trực kết nối TV wall.
- **Không kéo-thả, không sắp xếp lại** ô kênh trong bất kỳ tình huống nào — vị trí lưới là bất biến.
- Nút "Xác nhận đã tiếp nhận" chỉ nằm trong `detail-panel`, không có ack nhanh ngay trên lưới tổng quan — buộc người ack phải mở panel, tức là đã thấy đủ thông tin (tên đài, SĐT liên hệ) trước khi xác nhận tiếp nhận. Nút này focusable và kích hoạt được bằng `Enter`/`Space` giống mọi control khác trong panel.
- **Cấm:**
  - Tự động đóng/ẩn cảnh báo mà không qua phục hồi thật sự.
  - Tắt âm thanh báo động vĩnh viễn từ giao diện chính (quyết định mute là vận hành, ngoài phạm vi spine này — cũng như rủi ro phần cứng loa, ví dụ loa hỏng hoặc âm lượng hệ thống OS = 0).
  - Animation/hiệu ứng chuyển cảnh gây xao nhãng trên lưới tổng quan (màn hình TV chạy 24/7, chuyển động thừa gây mỏi mắt và làm chậm nhận diện cảnh báo thật).
  - Để `channel-grid` trông "bình thường" khi dữ liệu đã cũ/ngừng cập nhật do mất kết nối dữ liệu giám sát — bắt buộc `connection-banner` + làm mờ lưới (xem State Patterns).

## Accessibility Floor

Hành vi. Độ tương phản màu đã có ở `DESIGN.md`.

- **Không phụ thuộc màu đơn lẻ** — hệ quả accessibility của quy tắc icon+chữ đã chốt (`DESIGN.md.Components`, `Do's and Don'ts`): người khiếm thị màu hoặc ánh sáng phòng trực biến động vẫn phân biệt được trạng thái.
- **Đọc được từ khoảng cách xem TV wall** — kích thước chữ/icon trong `channel-name` và `alert-badge` phải đủ lớn để đọc từ vị trí ngồi thông thường trong phòng trực, không phải khoảng cách đọc màn hình máy tính để bàn. **[ASSUMPTION — memlog chưa có số liệu khoảng cách xem cụ thể (mét) hay kích thước màn hình TV thực tế; cần đo đạc tại phòng trực thật để chốt kích thước chữ cuối cùng, xem ghi chú tương ứng trong `DESIGN.md.Typography`]**.
- **Kênh cảnh báo âm thanh song song với kênh thị giác**: báo động phát khi có cảnh báo mới giúp đội trực phát hiện sự cố ngay cả khi không đang nhìn trực tiếp vào màn hình TV wall tại thời điểm xảy ra — đây là lớp dự phòng độc lập với màu/icon.
- Toàn bộ thao tác (mở panel, ack, đóng panel) phải thực hiện được bằng cả chuột và bàn phím: `Tab` di chuyển qua 20 `channel-grid-cell` theo đúng thứ tự vị trí lưới (trái→phải, trên→dưới); `Enter`/`Space` mở `detail-panel` khi một ô đang focus, viền focus dùng `{colors.focus-ring}` (`DESIGN.md`); nút "Xác nhận đã tiếp nhận" trong panel phải nằm trong thứ tự Tab và kích hoạt được bằng `Enter`/`Space`; `Esc` để đóng panel là bắt buộc, không chỉ click-outside.
- Vị trí cố định của lưới 20 ô cũng là một biện pháp accessibility về trí nhớ không gian: đội trực không phải tìm lại vị trí kênh mỗi lần có cảnh báo.

## Key Flows

### Flow 1 — Xử lý sự cố mất tín hiệu (anh Long, trực ca đêm)

*Bước 2-3 minh hoạ ở [`mockups/key-channel-grid.html`](mockups/key-channel-grid.html) (ô "Đài Huế"); bước 4-5 minh hoạ ở [`mockups/key-detail-panel.html`](mockups/key-detail-panel.html).*

1. Anh Long đang trực ca đêm, màn hình TV wall hiển thị lưới tổng quan 20 kênh, tất cả đang `ok`.
2. Kênh "Đài Huế" mất tín hiệu tại nguồn. Sau khi trạng thái mất tín hiệu giữ ổn định ≥5 giây (debounce), ô kênh chuyển sang `critical`: viền đỏ `{colors.state-critical}`, thumbnail đổi thành color bars, badge `✕ MẤT TÍN HIỆU`. Cùng lúc: dashboard phát âm thanh báo động, và hệ thống gửi Telegram + Email tới đội trực và lãnh đạo VTCDigital.
3. **Climax — phát hiện:** anh Long nghe âm thanh báo động, ngước lên TV wall, thấy ngay ô đỏ tại đúng vị trí quen thuộc của Đài Huế trên lưới cố định — không cần dò tìm.
4. Anh click vào ô Đài Huế → `detail-panel` mở: bitrate hiện tại về 0, biểu đồ lịch sử cho thấy tụt đột ngột, tên đài "Đài Huế", tên và SĐT đầu mối liên hệ kỹ thuật của đài.
5. Anh bấm "Xác nhận đã tiếp nhận" trong panel. Ô kênh trên lưới vẫn giữ nguyên viền đỏ + color bars (không đổi màu), chỉ thêm `ack-label` "✓ Đã nhận: A.Long" — báo cho các thành viên khác trong ca trực biết đã có người xử lý, tránh gọi điện trùng.
6. Anh Long gọi điện cho đầu mối liên hệ của Đài Huế theo đúng SĐT lấy từ panel, thông báo sự cố và phối hợp xử lý.
7. Đài Huế xử lý tại chỗ (kiểm tra lại thiết bị/đường truyền). Trong lúc chờ, ô kênh vẫn đứng yên ở `critical` + `acknowledged` trên lưới — anh Long tiếp tục theo dõi các kênh khác song song, không cần "canh" riêng ô này.
8. **Climax — phục hồi:** tín hiệu về lại ổn định ≥5 giây, ô kênh tự chuyển thẳng về `ok`, `ack-label` biến mất theo, và thông báo phục hồi được gửi Telegram ngay lập tức (không chờ cooldown 60s). Anh Long nhìn lưới thấy lại toàn xanh, xác nhận sự cố đã hết mà không cần gọi lại hỏi đài.

**Failure path:** đầu mối liên hệ của Đài Huế không nghe máy hoặc không xử lý được ngay (ví dụ kỹ thuật viên không có mặt tại đài). Ô kênh vẫn treo ở `critical` + `acknowledged` kéo dài; nếu cảnh báo tái phát dạng dao động (mất rồi có rồi mất lại), cooldown 60 giây đảm bảo Telegram không gửi dồn dập nhưng vẫn nhắc lại định kỳ tới đội trực và lãnh đạo. Anh Long tiếp tục theo dõi ô đó trên lưới, thử gọi lại số khác hoặc báo cấp trên qua kênh liên lạc ngoài dashboard — dashboard không có cơ chế "leo thang" (escalation) tự động nào khác ngoài thông báo lặp lại theo cooldown.

### Flow 2 — Theo dõi cảnh báo ABR bitrate thấp (anh Minh, ca sáng)

*Bước 1 &amp; 3 minh hoạ ở [`mockups/key-channel-grid.html`](mockups/key-channel-grid.html) (ô "Đài Quy Nhơn").*

1. Anh Minh thấy ô "Đài Quy Nhơn" chuyển viền vàng `{colors.state-warning}`, badge `⚠ ABR` — biết ngay đây là ABR đang chủ động hạ bitrate do mạng xấu đi, kênh vẫn đang phát được, khác hẳn mức độ với mất tín hiệu.
2. Anh click vào ô để xem chi tiết: `detail-panel` hiện bitrate hiện tại (62% so với gốc) và biểu đồ lịch sử cho thấy xu hướng giảm dần trong vài phút gần đây.
3. Anh bấm "Xác nhận đã tiếp nhận" — ô vẫn giữ viền vàng, cộng thêm `ack-label` "✓ Đã nhận: T.Minh", để đồng đội biết đã có người đang theo dõi kênh này.
4. Anh tiếp tục quan sát các kênh khác trên lưới; không cần gọi điện ngay vì đây là mức chú ý (ABR tự bù), không phải cảnh báo chủ động như mất tín hiệu.
5. **Climax:** bitrate tự phục hồi vượt lại 70%, ô kênh tự chuyển về `ok`, `ack-label` biến mất — sự cố tự khép lại mà không cần anh Minh can thiệp thêm.

**Failure path:** nếu tình trạng ABR xấu thêm và chuyển thành mất tín hiệu hoàn toàn, ô kênh chuyển tiếp từ `warning` sang `critical` (badge và viền đổi theo), `ack-label` "T.Minh" cũ biến mất vì đây là chuyển trạng thái mới — dashboard phát âm thanh báo động + gửi Telegram/Email như một cảnh báo mới, và luồng tiếp tục theo Flow 1.
