---
title: PRD — Hệ thống truyền dẫn & giám sát tín hiệu SRT (VTCDigital)
status: final
created: 2026-08-28
updated: 2026-08-31
version: v6 - final (bổ sung ranh giới reconnect FR-1 ↔ color-bars FR-3, xem .memlog.md)
---

# PRD: Hệ thống truyền dẫn & giám sát tín hiệu SRT (VTCDigital)

## 0. Document Purpose

PRD này dành cho PM/lãnh đạo VTCDigital duyệt phạm vi, và làm đầu vào trực tiếp cho `bmad-architecture` (thiết kế kỹ thuật) và `bmad-create-epics-and-stories` (chia epic/story). Tài liệu được cấu trúc theo Glossary-anchored vocabulary: mọi thuật ngữ dùng đúng như định nghĩa ở §3, FR được nhóm theo feature và đánh số toàn cục, giả định được gắn `[ASSUMPTION]` inline và tổng hợp lại ở §10.

PRD này **kế thừa, không lặp lại** các tài liệu đã có:
- **Product Brief** — `_bmad-output/planning-artifacts/briefs/brief-TranferFiles-2026-08-27/brief.md` (+ `addendum.md`): vấn đề, đối tượng, phạm vi MVP, quyết định loại bỏ SRT Bonding.
- **Brainstorm kỹ thuật** — `_bmad-output/brainstorming/brainstorm-srt-video-transport-2026-08-27/`: hành trình quyết định kiến trúc, các phương án đã cân nhắc/loại bỏ.
- **UX Spine** — `_bmad-output/planning-artifacts/ux-designs/ux-TranferFiles-2026-08-27/DESIGN.md` + `EXPERIENCE.md` (status `final`): 2 user journey chi tiết, 2 surface (lưới kênh + panel chi tiết), toàn bộ component/state patterns, đã qua validation report.

Chi tiết kỹ thuật-how, phương án bị loại và dữ liệu so sánh thị trường không lặp lại trong PRD — xem `addendum.md` cùng thư mục.

## 1. Vision

VTCDigital vận hành trung tâm phát sóng vệ tinh, cung cấp dịch vụ uplink cho 20 đài địa phương. Hiện tại, việc truyền tín hiệu từ đài về trung tâm do đơn vị ngoài đảm nhiệm, và VTCDigital **không có khả năng tự giám sát** tín hiệu của chính mình — đây là nỗi đau xảy ra hàng ngày, được xác định là ưu tiên xử lý trước so với chi phí thuê ngoài hay thủ tục thêm kênh chậm (tần suất thấp).

Hệ thống này là nền tảng truyền dẫn tín hiệu tự chủ, dựa trên giao thức SRT tự build (libsrt + custom orchestration), kết nối điểm-điểm giữa mỗi đài địa phương và trung tâm, đi kèm dashboard giám sát nội bộ cho đội trực sóng 24/7. Giá trị cốt lõi: đội trực **chủ động phát hiện sự cố tín hiệu trong vòng 1 phút**, thay vì phụ thuộc hoàn toàn vào đơn vị truyền dẫn thuê ngoài như hiện nay — đồng thời đặt nền móng công nghệ để VTCDigital giảm dần chi phí thuê ngoài và tự động hoá cấu hình kênh ở các giai đoạn sau.

Đây là công cụ **nội bộ**, vận hành bởi VTCDigital cho VTCDigital. 20 đài địa phương là bên thụ hưởng gián tiếp (tín hiệu ổn định hơn, chi phí thấp hơn về lâu dài) nhưng không thao tác trực tiếp lên hệ thống.

`[NOTE FOR PM]` Tầm nhìn dài hạn của brief đi xa hơn phạm vi PRD này: (1) thay thế hoàn toàn đơn vị truyền dẫn thuê ngoài cho toàn bộ 20 đài, và (2) mở rộng trở thành nền tảng truyền dẫn chuẩn của VTCDigital, phục vụ thêm đối tác khác ngoài 20 đài hiện tại. PRD này chỉ giải quyết bước đầu (giám sát nội bộ MVP#1) — hai mục tiêu trên là cột mốc tương lai, chưa có FR nào phục vụ trực tiếp. Nếu PRD/kết quả MVP#1 được dùng để trình lãnh đạo phê duyệt đầu tư tiếp theo, cần bổ sung mục tiêu ngân sách/% giảm chi phí cụ thể — hiện chưa có con số nào được xác nhận (xem `brief/addendum.md`).

## 2. Target User

### 2.1 Jobs To Be Done

- **Chức năng**: Đội trực sóng VTCDigital cần biết ngay khi một trong 20 kênh gặp sự cố (mất tín hiệu, suy giảm chất lượng) để xử lý trước khi ảnh hưởng phát sóng thật.
- **Chức năng**: Khi phát hiện sự cố, cần đủ thông tin (kênh nào, bitrate hiện tại, xu hướng, đầu mối liên hệ) để hành động ngay mà không phải tra cứu ở nơi khác.
- **Cảm xúc/xã hội**: Đội trực cần cảm giác **kiểm soát được** 20 kênh cùng lúc trên một màn hình lớn, không phải "mù thông tin" chờ đài báo lên.
- **Ngữ cảnh**: Vận hành liên tục 24/7 trên màn hình TV lớn tại phòng trực — không phải thao tác ngồi gần trên laptop cá nhân.

### 2.2 Non-Users (v1)

- **20 đài địa phương** — không có quyền truy cập dashboard, không có view giám sát riêng cho tín hiệu của họ trong MVP#1 (quyết định đã xác nhận, xem §6, §9).
- **Lãnh đạo VTCDigital** — không phải người dùng thao tác dashboard; chỉ nhận Telegram/Email khi có cảnh báo **mất tín hiệu** (mức "cảnh báo chủ động"/`critical`) — không nhận thông báo ở mức "chú ý"/ABR (`warning`), khác với đội trực (nhận cả 2 mức, xem FR-11).
- **Đơn vị truyền dẫn thuê ngoài hiện tại** — không tương tác với hệ thống này.

### 2.3 Key User Journeys

*Nguồn: `EXPERIENCE.md` §Key Flows (status `final`). Đánh số lại theo UJ-N để FR tham chiếu; giữ nguyên nội dung gốc.*

- **UJ-1. Anh Long phát hiện và xử lý mất tín hiệu giữa ca trực đêm.**
  - **Persona + context:** Anh Long, trực ca đêm, đang quan sát lưới 20 kênh trên TV wall, tất cả đang `ok`.
  - **Entry state:** Đã ở màn hình lưới tổng quan (`channel-grid`), không cần đăng nhập lại.
  - **Path:** Kênh "Đài Huế" mất tín hiệu → sau khi trạng thái ổn định ≥5s, ô chuyển `critical` (viền đỏ, thumbnail → color bars, badge `✕ MẤT TÍN HIỆU`) đồng thời phát âm báo động + gửi Telegram/Email. Anh Long nghe âm báo, ngước lên thấy ngay ô đỏ đúng vị trí quen thuộc (lưới cố định). Click vào ô → `detail-panel` mở, thấy bitrate=0, biểu đồ tụt đột ngột, tên đài, tên+SĐT đầu mối liên hệ. Bấm "Xác nhận đã tiếp nhận" → ô giữ nguyên màu, thêm `ack-label` "✓ Đã nhận: A.Long". Gọi đầu mối liên hệ theo SĐT trong panel.
  - **Climax:** Tín hiệu ổn định lại ≥5s → ô tự về `ok`, `ack-label` biến mất, thông báo phục hồi gửi Telegram ngay lập tức (không cooldown).
  - **Resolution:** Anh Long tiếp tục theo dõi các kênh khác; sự cố đã đóng, không cần thao tác thủ công để "đóng ticket".
  - **Edge case:** Đầu mối liên hệ không nghe máy → ô treo `critical + acknowledged`; nếu cảnh báo dao động (mất-có-mất lại), cooldown 60s vẫn nhắc lại định kỳ. Không có escalation tự động ngoài cooldown lặp lại (xem Open Question OQ-5).

- **UJ-2. Anh Minh theo dõi cảnh báo ABR bitrate thấp giữa ca sáng.**
  - **Persona + context:** Anh Minh, trực ca sáng, quan sát lưới 20 kênh.
  - **Entry state:** Ở màn hình lưới tổng quan, kênh "Đài Quy Nhơn" vừa chuyển viền vàng.
  - **Path:** Badge `⚠ ABR` xuất hiện — hiểu ngay đây là ABR tự hạ bitrate do mạng xấu, kênh vẫn phát được. Click xem chi tiết: bitrate hiện tại 62% so với gốc, biểu đồ giảm dần vài phút gần đây. Bấm "Xác nhận đã tiếp nhận" → giữ viền vàng, thêm `ack-label` "✓ Đã nhận: T.Minh". Tiếp tục quan sát kênh khác, không cần gọi điện ngay (mức chú ý, không phải cảnh báo chủ động).
  - **Climax:** Bitrate tự vượt lại 70% → ô tự về `ok`, `ack-label` biến mất, tự khép lại không cần can thiệp.
  - **Resolution:** Không cần hành động thêm; sự kiện tự đóng khi mạng phục hồi.
  - **Edge case:** ABR xấu thêm → chuyển tiếp `warning` → `critical`; `ack-label` cũ biến mất vì là chuyển trạng thái mới; phát âm báo + Telegram/Email như cảnh báo mới, tiếp diễn theo UJ-1.

## 3. Glossary

- **Kênh (Channel)** — Một đường truyền tín hiệu độc lập từ 1 đài địa phương về trung tâm VTCDigital. Hệ thống quản lý 20 kênh, mỗi kênh ứng với 1 đài.
- **Đài địa phương** — Đơn vị phát thanh truyền hình cấp tỉnh, nguồn phát tín hiệu SDI đầu vào. Không phải người dùng của hệ thống (xem §2.2).
- **Trung tâm** — Trung tâm phát sóng vệ tinh của VTCDigital, nơi nhận tín hiệu SRT và uplink vệ tinh.
- **SRT (Secure Reliable Transport)** — Giao thức truyền tải video/audio qua internet dùng cho kết nối điểm-điểm giữa đài địa phương và trung tâm. Xem đặc tính kỹ thuật ở `addendum.md`.
- **Kết nối điểm-điểm** — Kiến trúc truyền dẫn: 1 kết nối SRT trực tiếp giữa máy tính tại đài và máy tính tại trung tâm, không qua trung gian bonding phần mềm.
- **Passphrase (khoá mã hoá SRT)** — Khoá bí mật cấu hình riêng cho từng kết nối kênh, dùng để mã hoá AES tích hợp sẵn trong SRT và xác thực kết nối ở bước handshake.
- **ABR (Adaptive Bitrate)** — Cơ chế chủ động hạ bitrate mã hoá khi băng thông mạng suy giảm, giữ tín hiệu tiếp tục phát thay vì mất hoàn toàn.
- **Color bars** — Hình ảnh thay thế hiển thị tại đầu ra trung tâm khi kết nối SRT mất hoàn toàn, tránh đứng hình/màn đen (an toàn phát sóng).
- **Trạng thái kênh** — Một trong ba giá trị: `ok` (bitrate ≥70% gốc), `warning` (bitrate <70% gốc do ABR), `critical` (mất tín hiệu). Có thể kèm cờ phụ `acknowledged`.
- **Debounce** — Yêu cầu trạng thái kênh phải giữ ổn định ≥5 giây trước khi coi là đã đổi trạng thái, tránh nhấp nháy do nhiễu tức thời.
- **Cooldown** — Khoảng cách tối thiểu 60 giây giữa hai lần gửi lại cảnh báo Telegram/Email cùng loại cho cùng một kênh. Không áp dụng cho thông báo phục hồi.
- **Xác nhận (Ack / Acknowledge)** — Hành động của đội trực xác nhận đã tiếp nhận một cảnh báo, tránh gọi trùng đầu mối liên hệ. Không xoá hay đổi màu cảnh báo.
- **Đội trực sóng** — Nhân sự kỹ thuật VTCDigital vận hành ca 24/7, là người dùng chính của dashboard.
- **Lưới kênh (Channel Grid)** — Màn hình mặc định hiển thị toàn bộ 20 kênh dạng lưới ô cố định vị trí theo đài.
- **Panel chi tiết (Detail Panel)** — Overlay hiển thị khi click vào 1 ô kênh: bitrate hiện tại/lịch sử, tên đài, đầu mối liên hệ.
- **Trạng thái mất kết nối giám sát (`disconnected`)** — Trạng thái toàn cục khi hệ thống mất kết nối tới nguồn dữ liệu giám sát (event stream) — khác với sự cố tín hiệu của một kênh cụ thể (kênh ở trạng thái `critical`).
- **Giai đoạn thí điểm (Pilot phase)** — Giai đoạn go-live đầu tiên trên một tập con kênh trước khi mở rộng ra đủ 20 kênh (xem §7.3).

## 4. Features

### 4.1 Truyền dẫn tín hiệu điểm-điểm qua SRT

**Description:** Nền tảng truyền dẫn cho mỗi kênh: tín hiệu SDI từ đài địa phương được capture qua card Blackmagic, mã hoá, truyền qua kết nối SRT điểm-điểm tới trung tâm, giải mã và xuất lại SDI qua card Blackmagic tại trung tâm để uplink vệ tinh. Đây là nền tảng bắt buộc cho mọi tính năng khác — dashboard giám sát (§4.2, §4.3) đọc dữ liệu từ chính lớp này.

#### FR-1: Kết nối điểm-điểm qua SRT

Hệ thống thiết lập và duy trì 1 kết nối SRT điểm-điểm độc lập cho mỗi kênh, giữa máy tính tại đài địa phương và máy tính tại trung tâm, dựa trên libsrt tự build với lớp orchestration riêng (đánh đổi: VTCDigital tự chịu trách nhiệm toàn bộ ổn định/bảo trì giao thức, không có SLA bên thứ ba — xem `addendum.md` §1.2). `[ASSUMPTION: thiết kế chi tiết state machine/retry/reconnect của lớp orchestration chưa đi sâu — xem OQ-7]`.

**Consequences (testable):**
- Mỗi kênh có 1 kết nối SRT riêng biệt, không chia sẻ trạng thái với kênh khác — sự cố ở kênh A không ảnh hưởng kênh B.
- Kết nối tự động thử lại (reconnect) liên tục, không giới hạn số lần, khi bị ngắt do mất mạng — không có "give up". Ngay khi kết nối mất (bất kể reconnect đang chạy nền), color bars kích hoạt tức thời tại trung tâm (xem FR-3) — không chờ hết một số lần thử nhất định, vì retry là vô hạn; color bars tự động biến mất khi reconnect thành công. Khoảng backoff cụ thể giữa các lần thử lại do mất mạng thuộc thiết kế chi tiết state machine — xem `[ASSUMPTION]` đầu FR-1 và OQ-7.
- Khi bị từ chối do sai passphrase (FR-5, khác mất mạng): dùng backoff/phân loại riêng, không retry dồn dập theo kiểu mất mạng, và cảnh báo vận hành nếu một kênh liên tục bị từ chối — tránh nhầm lẫn giữa lỗi cấu hình và một cuộc dò passphrase.
- **Out of Scope:** Đảm bảo đường truyền internet (dự phòng, đa nhà mạng, bonding vật lý) — trách nhiệm hạ tầng mạng, không thuộc phần mềm (xem §6, `addendum.md`).

#### FR-2: ABR — chủ động hạ bitrate khi mạng xấu

Hệ thống tự động hạ bitrate mã hoá khi băng thông mạng suy giảm, để duy trì tín hiệu liên tục thay vì mất hoàn toàn. Realizes UJ-2.

**Consequences (testable):**
- Khi bitrate thực tế đo được giảm xuống dưới ngưỡng cấu hình gốc, hệ thống tự động điều chỉnh bitrate mã hoá tương ứng trong thời gian thực.
- Sự kiện hạ bitrate được phát ra để dashboard đọc và hiển thị trạng thái `warning` (xem FR-10).
- `[ASSUMPTION: codec/kỹ thuật nén cụ thể cho ABR chưa chốt — xem OQ-2]`.

#### FR-3: Color bars khi mất kết nối hoàn toàn

Khi kết nối SRT của một kênh mất hoàn toàn, đầu ra SDI tại trung tâm tự động chuyển sang hiển thị color bars thay vì đứng hình hoặc màn đen. Kích hoạt tức thời khi mất kết nối, độc lập với reconnect đang chạy nền ở FR-1 (không chờ hết số lần thử vì retry là vô hạn).

**Consequences (testable):**
- Đầu ra SDI không bao giờ ở trạng thái đứng hình/màn đen khi mất tín hiệu nguồn — luôn có color bars hoặc tín hiệu thật.
- Chuyển đổi color bars diễn ra tự động, không cần thao tác từ đội trực.

#### FR-4: Tích hợp capture/playout SDI qua Blackmagic

Hệ thống capture tín hiệu SDI đầu vào tại đài và xuất SDI đầu ra tại trung tâm bằng card Blackmagic **DeckLink Studio 4K**.

**Consequences (testable):**
- Card Blackmagic DeckLink Studio 4K được dùng ở cả 2 đầu (đài địa phương và trung tâm) cho capture/playout SDI.
- `[ASSUMPTION: yêu cầu driver/hệ điều hành cụ thể cho DeckLink Studio 4K chưa chốt — xem OQ-1]`.

#### FR-5: Mã hoá dữ liệu truyền tải qua internet

Hệ thống mã hoá toàn bộ dữ liệu luồng SRT giữa đài địa phương và trung tâm bằng AES (encryption tích hợp sẵn trong giao thức SRT), đảm bảo dữ liệu không đọc được nếu bị chặn bắt trên đường truyền internet công cộng.

**Consequences (testable):**
- Mọi kết nối SRT bắt buộc bật encryption AES-128/256 — không tồn tại chế độ chạy không mã hoá trong production.
- Mỗi kênh có passphrase riêng, không dùng chung 1 khoá cho toàn bộ 20 kênh — hạn chế phạm vi ảnh hưởng nếu một khoá bị lộ.
- Kết nối không xác thực đúng passphrase bị trung tâm từ chối ngay ở bước handshake, không tạo kết nối một phần hay rơi về chế độ không mã hoá.
- Mọi lần handshake bị từ chối được ghi log kèm nguồn gốc kết nối; hệ thống cảnh báo khi tần suất bất thường từ cùng một nguồn — vì passphrase là lớp phòng thủ duy nhất cho cổng SRT public-facing (không IP whitelist/VPN, xem §6).
- `[ASSUMPTION: cơ chế lưu trữ/luân chuyển khoá (key management/rotation) cụ thể chưa chốt — xem OQ-6]`.

**Feature-specific NFRs:**
- **Độ trễ truyền dẫn end-to-end (encode + network + decode, chưa tính hiển thị dashboard) ≤ 1 giây trong điều kiện mạng nominal (ABR không active)** — chỉ tiêu cứng, ràng buộc thiết kế ABR/buffer SRT (quyết định xác nhận trực tiếp với người yêu cầu, 2026-08-28). Đóng góp latency theo thứ tự ưu tiên cần tối ưu: (1) latency buffer SRT/ARQ (khuyến nghị ≥3x RTT — xem `addendum.md` §3), (2) encode/decode codec nén, (3) network transit, (4) overhead mã hoá AES (nhỏ nhất, single-digit ms trên phần cứng hiện đại). `[ASSUMPTION: chỉ tiêu này chưa được benchmark trên RTT thực tế liên tỉnh qua internet công cộng VN — bắt buộc đo baseline + benchmark trong 1-2 ngày đầu giai đoạn thí điểm (§7.3) trước khi coi ≤1s là gate go/no-go chính thức]`.
- **Khi ABR đang active (mạng suy giảm)**: không áp dụng chỉ tiêu ≤1s cứng — ưu tiên duy trì phát sóng liên tục (qua ABR/color bars) hơn giữ đúng ngân sách latency. Đây là quy tắc ưu tiên tường minh khi các NFR xung đột (latency vs continuity), áp dụng cho cả SM-2 và SM-C2.
- Chi phí xử lý mã hoá/giải mã (FR-5) là phần đóng góp nhỏ nhất vào ngân sách độ trễ ≤1s nêu trên (xem thứ tự ưu tiên ở trên) — không cấu hình mã hoá theo cách làm vượt NFR độ trễ, nhưng cũng không phải điểm cần tối ưu đầu tiên.

### 4.2 Giám sát trạng thái kênh thời gian thực

**Description:** Dashboard desktop hiển thị trên màn hình TV lớn tại phòng trực 24/7, dark theme mặc định (không có light mode — phòng trực tối 24/7). Gồm 2 surface: lưới tổng quan 20 kênh (mặc định) và panel chi tiết (overlay khi click 1 kênh). Kiến trúc event-driven, không polling. Realizes UJ-1, UJ-2.

#### FR-6: Lưới tổng quan 20 kênh, vị trí cố định

Hệ thống hiển thị toàn bộ 20 kênh dạng lưới ô, mỗi ô ở vị trí cố định tuyệt đối theo đài — không sắp xếp lại/lọc/ẩn theo trạng thái hay mức độ nghiêm trọng trong bất kỳ tình huống nào (kể cả cảnh báo, cold-load, disconnected).

**Consequences (testable):**
- Vị trí ô trong lưới không đổi giữa các lần render, không phụ thuộc thứ tự trạng thái trả về từ backend.
- Không có thao tác kéo-thả hoặc sắp xếp lại ô kênh ở bất kỳ trạng thái nào.
- Mỗi ô gồm: thumbnail/color-bars, 2 VU meter, tên đài, alert-badge (luôn kèm cả màu nền và chữ/icon — không phụ thuộc màu đơn lẻ).
- Thumbnail phân biệt theo mức: `warning` giữ hình thật kèm icon cảnh báo chồng lên; `critical` thay hoàn toàn bằng color bars (xem FR-3).

#### FR-7: Cập nhật trạng thái kênh theo thời gian thực (event-driven)

Trạng thái mỗi kênh (`ok`/`warning`/`critical`) được cập nhật qua event stream, không polling, với debounce ≥5 giây trước khi coi là đổi trạng thái.

**Consequences (testable):**
- Khi vừa mở app (`cold-load`), toàn bộ 20 ô hiện skeleton/placeholder; từng ô chuyển sang dữ liệu thật ngay khi kênh đó có event về, không chờ đủ 20 kênh. Độ trễ cold-load ~1-2 giây.
- Chuyển trạng thái ô (`ok`↔`warning`↔`critical`) chỉ diễn ra sau khi trạng thái mới giữ ổn định liên tục ≥5 giây.
- VU meter cập nhật thời gian thực, **không qua debounce 5s của trạng thái cảnh báo** (khác với việc chuyển `ok`/`warning`/`critical`) — kênh `critical` vẫn có thể hiện VU thấp/im lặng. Khi toàn cục ở trạng thái `disconnected` (FR-9), VU meter cũng đứng yên như mọi số liệu khác — không phải ngoại lệ.

#### FR-8: Panel chi tiết kênh

Click vào bất kỳ ô kênh nào mở `detail-panel` (overlay, không điều hướng trang) hiển thị bitrate hiện tại, biểu đồ lịch sử bitrate, tên đài, tên và số điện thoại đầu mối liên hệ. Panel có 3 trạng thái: `loading`, `loaded`, `no-history-data`. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Panel mở tức thì (khung panel hiện ngay), không chặn thao tác trên lưới phía sau; đóng bằng click ra ngoài hoặc phím `Esc`.
- Trạng thái `loading`: ngay khi vừa mở, trước khi dữ liệu bitrate/lịch sử về, vùng số liệu và biểu đồ hiển thị skeleton/placeholder — không bao giờ hiện trắng/trống.
- Trạng thái `no-history-data`: kênh mới/chưa đủ dữ liệu lịch sử — vẫn hiện bitrate hiện tại, vùng biểu đồ hiện thông báo thiếu dữ liệu (tránh hiểu nhầm bitrate=0 là sự cố).

#### FR-9: Xử lý khi mất kết nối tới nguồn dữ liệu giám sát

Khi hệ thống mất kết nối tới nguồn dữ liệu giám sát (event stream chết) — khác với 1 kênh `critical` — dashboard hiển thị `connection-banner` toàn cục (nền đỏ, full-width, trên mọi lớp kể cả detail-panel) kèm thời điểm cập nhật lần cuối, đồng thời làm mờ toàn bộ lưới kênh.

**Consequences (testable):**
- Số liệu từng ô đứng yên ở giá trị cuối khi `disconnected`, **không tự nội suy**.
- Khi phục hồi: banner biến mất ngay, lưới rõ nét trở lại, dữ liệu resume từ event tiếp theo — không cần reload thủ công.
- Đây là hạng mục được validation report UX đánh dấu **Critical** trước đó (thiếu state này gây false-negative im lặng, đe doạ SM-1) — đã được bổ sung vào UX spine hiện hành.

### 4.3 Cảnh báo tự động

**Description:** Cảnh báo 2 mức dựa trên trạng thái kênh, đẩy qua kênh âm thanh (tại chỗ) và Telegram/Email (từ xa), với cơ chế debounce/cooldown để tránh báo động giả và spam. Realizes UJ-1, UJ-2.

#### FR-10: Phân loại cảnh báo 2 mức

Hệ thống phân loại cảnh báo theo 2 mức dựa trên bitrate: **"chú ý"** khi bitrate hạ xuống dưới 70% so với cấu hình gốc (ABR đang hoạt động), và **"cảnh báo chủ động"** khi mất tín hiệu/color bars.

**Consequences (testable):**
- Mức "chú ý" → badge `⚠ ABR`, viền vàng, push Telegram.
- Mức "cảnh báo chủ động" → badge `✕ MẤT TÍN HIỆU`, viền đỏ, push Telegram + Email + âm báo động tại chỗ.
- Cả hai mức đều tuân theo debounce ≥5 giây (FR-7) trước khi kích hoạt.

#### FR-11: Đẩy thông báo Telegram/Email với cooldown

Cảnh báo mới (sau debounce) được đẩy qua Telegram/Email với cooldown tối thiểu 60 giây giữa hai lần gửi lại cùng loại cảnh báo, cùng kênh. Thông báo phục hồi (trở lại `ok`) luôn gửi ngay lập tức, không bị chặn bởi cooldown.

**Consequences (testable):**
- Mức "chú ý"/ABR (`warning`): push Telegram tới **đội trực sóng** — không gửi cho lãnh đạo VTCDigital.
- Mức "cảnh báo chủ động" (`critical`, mất tín hiệu): push Telegram + Email tới **cả đội trực sóng và lãnh đạo VTCDigital**.
- Cùng một kênh, cùng loại cảnh báo, không nhận quá 1 thông báo mỗi 60 giây.
- Thông báo phục hồi không bao giờ bị trì hoãn bởi cooldown đang chạy.
- Âm báo động tại chỗ chỉ kêu **một lần duy nhất** mỗi lần chuyển trạng thái mới — không lặp lại theo cooldown như Telegram/Email.

#### FR-12: Xác nhận tiếp nhận cảnh báo (Ack)

Đội trực có thể bấm "Xác nhận đã tiếp nhận" trong `detail-panel` để đánh dấu đã nhận cảnh báo, tránh việc nhiều người gọi trùng đầu mối liên hệ.

**Consequences (testable):**
- Ack chỉ thêm `ack-label` (tên viết tắt người ack) — không đổi màu ô, không đổi badge, không xoá cảnh báo.
- `ack-label` tự biến mất khi kênh phục hồi về `ok`, không phải khi ack.
- Nút ack chỉ nằm trong `detail-panel`, không có ack nhanh trên lưới — buộc mở panel xem đủ thông tin trước khi xác nhận.
- Khi kênh chuyển sang trạng thái cảnh báo mới (vd `warning`→`critical`), `ack-label` cũ biến mất vì là sự kiện cảnh báo mới.
- Viền ô chuyển sang nét đứt (dashed) khi `acknowledged`, giữ nguyên màu nền/màu viền gốc — thêm một lớp tín hiệu phi-màu độc lập với `ack-label`.

**Notes:**
- **`[NOTE FOR PM]`** Không có cơ chế escalation tự động khi đầu mối liên hệ không phản hồi, ngoài việc cooldown 60s lặp lại cảnh báo nếu trạng thái còn dao động. Xem OQ-5.

### 4.4 Trải nghiệm vận hành & khả năng tiếp cận

**Description:** Yêu cầu tương tác và khả năng tiếp cận áp dụng xuyên suốt cả 2 surface, đảm bảo đội trực vận hành hiệu quả trên màn hình TV lớn, 24/7, kể cả khi không nhìn trực tiếp màn hình liên tục.

#### FR-13: Điều hướng đầy đủ bằng bàn phím

Toàn bộ thao tác chính (di chuyển giữa 20 ô, mở/đóng panel, ack) thực hiện được bằng bàn phím.

**Consequences (testable):**
- `Tab` di chuyển focus qua 20 ô theo đúng thứ tự vị trí lưới (trái→phải, trên→dưới).
- `Enter`/`Space` mở `detail-panel` ô đang focus; `Esc` đóng panel.
- Nút "Xác nhận đã tiếp nhận" nằm trong thứ tự Tab, kích hoạt bằng `Enter`/`Space`.
- Viền focus rõ ràng, đạt ngưỡng tương phản ≥3:1 (chi tiết đo đạc ở `addendum.md`).

#### FR-14: Không phụ thuộc màu đơn lẻ để truyền đạt trạng thái

Mọi trạng thái/cảnh báo trên dashboard luôn kèm icon hoặc chữ, không chỉ dựa vào màu sắc.

**Consequences (testable):**
- `alert-badge` luôn có cả nền màu và chữ/icon (`OK`, `⚠ ABR`, `✕ MẤT TÍN HIỆU`).
- `vu-meter` có 2 vạch ngưỡng cố định (warning-mark, peak-mark) hiển thị bất kể trạng thái.
- Tương phản màu chữ/nền đạt chuẩn AA (≥4.5:1 chữ thường, ≥3:1 đồ hoạ/border/focus-ring); riêng `on-state-critical` giữ 5.94:1 (đạt AA, không theo đuổi AAA có chủ đích để giữ độ bão hoà bắt mắt ngoại vi trong phòng tối).

**Feature-specific NFRs:**
- Không tải font ngoài (system-ui font stack) — giảm phụ thuộc mạng/CDN cho app chạy cố định 24/7.
- Không có animation/transition gây xao nhãng trên lưới tổng quan.

## 5. Bảo mật dữ liệu truyền tải (Security)

Tín hiệu truyền hình được truyền qua môi trường **internet công cộng** (không phải mạng riêng/VPN) giữa 20 đài địa phương và trung tâm — đây là bề mặt tấn công cần phòng thủ rõ ràng, khác với ràng buộc độ tin cậy đường truyền đã nêu ở §4.1. Yêu cầu bổ sung theo xác nhận trực tiếp của người yêu cầu, 2026-08-28.

**Yêu cầu đã chốt** (dựa trên khả năng mã hoá tích hợp sẵn của giao thức SRT — xem `addendum.md` §3):
- Toàn bộ dữ liệu truyền giữa đài địa phương và trung tâm phải được **mã hoá end-to-end** bằng AES (SRT built-in encryption) — không có kết nối nào truyền ở dạng plaintext qua internet công cộng. Realizes FR-5.
- Mỗi kết nối kênh dùng **passphrase riêng biệt** — không dùng chung 1 khoá cho toàn bộ 20 kênh, hạn chế phạm vi ảnh hưởng nếu một khoá bị lộ.
- Kết nối đến không xác thực đúng passphrase phải bị **từ chối** tại trung tâm ngay ở bước handshake — ngăn chặn việc chèn tín hiệu giả mạo vào luồng phát sóng qua kết nối mạo danh một đài địa phương.

**Điều kiện tiên quyết trước khi pilot go-live** (đây là quy trình nghiệp vụ, không phải chi tiết kỹ thuật thuần tuý có thể chờ giai đoạn kiến trúc):
- Phải chốt tối thiểu một RACI cho vòng đời passphrase: ai (vai trò cụ thể tại VTCDigital) sinh và lưu trữ passphrase gốc cho từng kênh; kênh phân phối an toàn tới đài địa phương (đài không có quyền truy cập hệ thống — §2.2/§6 — nên không có cổng tự phục vụ để nhận khoá); quy trình thu hồi/xoay vòng khi nghi lộ hoặc nhân sự đài thay đổi. Xem OQ-6.
- Passphrase là lớp phòng thủ **duy nhất** cho cổng SRT public-facing tại trung tâm (không IP whitelist/VPN — xem mục "Ngoài phạm vi PRD này" ngay dưới đây) — do đó log/cảnh báo handshake bị từ chối (FR-5) phải hoạt động trước go-live, không phải tính năng bổ sung sau.

**Ngoài phạm vi PRD này** (chi tiết kỹ thuật thuần tuý, để `bmad-architecture` quyết định):
- Cơ chế lưu trữ/luân chuyển khoá cụ thể ở tầng hệ thống (vd secrets vault, HSM) — miễn RACI vận hành ở trên đã chốt trước pilot.
- Bảo mật tầng hạ tầng mạng (firewall, VPN, IP whitelist) — thuộc ranh giới hạ tầng mạng đã nêu ở §4.1 FR-1 và §6 Non-Goals.

## 6. Non-Goals (Explicit)

- Hệ thống này **không** phải nền tảng self-service cho đài địa phương — đài không có quyền truy cập, không có view giám sát riêng ở bất kỳ giai đoạn nào của MVP#1 (quyết định xác nhận 2026-08-28, khớp brief gốc).
- Hệ thống này **không** đảm nhiệm hạ tầng mạng (dự phòng đường truyền, đa nhà mạng, bonding vật lý) — đây là trách nhiệm của đội hạ tầng mạng, ranh giới cụ thể cần xác nhận ở giai đoạn kiến trúc (xem OQ-3).
- Hệ thống này **không** bao gồm Portal/API tự động hoá cấu hình kênh ở MVP#1 — tần suất thêm kênh/sự kiện đột xuất thấp (vài tháng/lần) nên được hạ ưu tiên, dự kiến ở giai đoạn sau khi nền tảng đã chứng minh độ tin cậy.
- Hệ thống này **không** triển khai SRT Connection Bonding (gửi song song 2 đường internet) ở tầng phần mềm — quyết định thu hẹp phạm vi sau khi làm rõ kiến trúc điểm-điểm (lý do đầy đủ ở `addendum.md`).
- Dashboard **không** cung cấp cơ chế tắt âm báo vĩnh viễn từ giao diện chính, và **không** tự động đóng/ẩn cảnh báo mà không qua phục hồi thật sự.
- Hệ thống này **không** bao gồm bảo mật tầng hạ tầng mạng (firewall, VPN, IP whitelist) — xem §5.

## 7. MVP Scope

### 7.1 In Scope

- Truyền dẫn điểm-điểm qua SRT (libsrt custom orchestration) giữa đài địa phương và trung tâm, mã hoá AES end-to-end.
- Capture/playout SDI qua card Blackmagic DeckLink Studio 4K ở cả 2 đầu.
- ABR chủ động hạ bitrate khi mạng xấu; color bars khi mất kết nối hoàn toàn.
- Dashboard giám sát nội bộ: lưới tổng quan + panel chi tiết, cảnh báo 2 mức, ack, xử lý trạng thái `disconnected`.
- Đẩy thông báo Telegram + Email với logic debounce/cooldown/phục hồi đã chốt.
- Điều hướng bàn phím đầy đủ + accessibility AA.

### 7.2 Out of Scope for MVP

- Portal/API tự động hoá cấu hình kênh — deferred, ưu tiên thấp do tần suất sự kiện thấp.
- View giám sát riêng cho đài địa phương — không nằm trong roadmap gần, giữ kín nội bộ VTCDigital theo quyết định nghiệp vụ (không phải giới hạn kỹ thuật tạm thời).
- SRT Connection Bonding / dự phòng đa đường truyền ở tầng phần mềm — thuộc hạ tầng mạng, ngoài phạm vi phần mềm vĩnh viễn (không phải "để sau").
- Cơ chế escalation tự động khi đầu mối liên hệ không phản hồi — **`[NOTE FOR PM]`** có thể là điểm cần bổ sung nếu vận hành thực tế cho thấy cooldown lặp lại là chưa đủ; revisit sau giai đoạn thí điểm.
- Bảo mật tầng hạ tầng mạng (firewall, VPN, IP whitelist) và cơ chế key management/rotation chi tiết — để `bmad-architecture` quyết định (xem §5, OQ-6).

### 7.3 Kế hoạch triển khai theo giai đoạn (Rollout)

**Lưu ý**: mốc 7 ngày được chốt trực tiếp bởi người yêu cầu, chưa qua thẩm định kỹ thuật đầy đủ (OQ-1, OQ-2, OQ-6, OQ-7 đều còn mở) — kế hoạch dưới đây là biện pháp giảm thiểu rủi ro, không phải xác nhận rằng mốc này chắc chắn khả thi.

Go-live chia 2 giai đoạn, và giai đoạn thí điểm **thu hẹp cả phạm vi tính năng lẫn số kênh** — không chỉ số kênh:

1. **Giai đoạn thí điểm — pilot tối giản (trong 7 ngày tới)**: go-live trên **một tập con kênh thí điểm** (số lượng cụ thể — xem OQ-4) với phạm vi:
   - **Bắt buộc có**: FR-1 đến FR-5 (truyền dẫn + mã hoá), FR-6 đến FR-11 (dashboard + cảnh báo cốt lõi) — phần hiện thực hoá trực tiếp SM-1/SM-2.
   - **Lược bớt cho riêng pilot, hoàn thiện đầy đủ trước khi mở rộng 20 kênh**: FR-13/FR-14 (điều hướng bàn phím đầy đủ, chuẩn accessibility AA đầy đủ) — không chặn mục tiêu kiểm chứng kỹ thuật của pilot. Quy trình passphrase có thể dùng phương án tạm/thủ công cho số kênh nhỏ của pilot (FR-5 mã hoá vẫn bắt buộc, không được tắt — chỉ có RACI phân phối/thu hồi đầy đủ theo OQ-6 là được hoàn thiện song song, xong trước khi mở rộng).
   - **Benchmark bắt buộc trong 1-2 ngày đầu** (tính vào 7 ngày, không phải buffer ngoài lịch): đo baseline RTT thực tế đài↔trung tâm, benchmark latency SRT buffer + encode/decode với codec ứng viên, để xác nhận SM-2 ≤1s khả thi trước khi coi đây là gate go/no-go chính thức. Nếu không đạt, chấp nhận chỉ tiêu tạm thời nới lỏng riêng cho pilot, ghi nhận lý do.
   - Mục tiêu: kiểm chứng SM-1, SM-2, SM-3 trên điều kiện mạng thật trước khi cam kết quy mô đầy đủ.
2. **Giai đoạn mở rộng**: Sau khi pilot ổn định (tiêu chí — xem OQ-4) **và** đã hoàn thiện đầy đủ FR-13/FR-14 + RACI passphrase (OQ-6), mở rộng dần lên đủ 20 kênh.

**Kế hoạch dự phòng (rollback)**: Nếu pilot không đạt SM-2 hoặc gặp sự cố driver/codec nghiêm trọng trong 7 ngày, phương án là (a) gia hạn pilot thêm trên cùng tập kênh thí điểm thay vì mở rộng đúng hạn, hoặc (b) với kênh đang thí điểm, tạm thời duy trì song song qua đơn vị truyền dẫn thuê ngoài hiện tại trong lúc xử lý sự cố — không để kênh đó mất giám sát hoàn toàn. Chọn (a)/(b) do đội trực/PM quyết định tại thời điểm phát sinh sự cố, dựa trên mức độ nghiêm trọng.

## 8. Success Metrics

**Primary**
- **SM-1**: Thời gian phát hiện sự cố mất tín hiệu — từ lúc xảy ra đến lúc đội trực nhận được cảnh báo (âm báo + Telegram/Email) — **≤ 1 phút**. Validates FR-7, FR-10, FR-11.
- **SM-2**: Độ trễ truyền dẫn tín hiệu end-to-end (encode + network + decode, không tính hiển thị dashboard) trong điều kiện mạng nominal (ABR không active) — **≤ 1 giây**, tạm thời cho đến khi benchmark thực tế đầu pilot xác nhận (xem §4.1, §7.3). Validates FR-1, FR-2, FR-4, FR-5.

**Secondary**
- **SM-3**: Giai đoạn thí điểm (§7.3) vận hành ổn định (không có sự cố phần mềm ngoài dự kiến) trong khoảng thời gian quan sát trước khi mở rộng lên 20 kênh. Validates FR-1 đến FR-5.

**Counter-metrics (do not optimize)**
- **SM-C1**: Tỷ lệ cảnh báo giả (kênh chuyển `warning`/`critical` rồi tự phục hồi trong vài giây) không được tăng lên khi tối ưu SM-1 — nghĩa là không hạ ngưỡng debounce 5 giây chỉ để rút ngắn thời gian phát hiện. Counterbalances SM-1.
- **SM-C2**: Chất lượng hình ảnh sau ABR không được hạ quá mức chỉ để giữ SM-2 ≤1s trong mọi điều kiện mạng — ABR là đánh đổi có kiểm soát (giữ phát sóng liên tục), không phải mục tiêu nén tối đa. Counterbalances SM-2. Chi phí mã hoá/giải mã (FR-5) cũng không được đánh đổi lấy việc tắt/hạ cấp encryption chỉ để giữ SM-2.

## 9. Open Questions

1. **OQ-1**: Yêu cầu driver/hệ điều hành cụ thể cho card Blackmagic DeckLink Studio 4K — cần xác nhận ở giai đoạn kiến trúc.
2. **OQ-2**: Codec/kỹ thuật nén cụ thể cho ABR (FR-2) — hiện chỉ có yêu cầu định tính ("nén hiệu quả, ít băng thông, giữ chất lượng"), chưa chốt công nghệ cụ thể. Để `bmad-architecture` quyết định.
3. **OQ-3**: Ranh giới kỹ thuật chính xác giữa "phần mềm" (điểm-điểm SRT) và "hạ tầng mạng" (dự phòng, đa nhà mạng) — cần xác nhận với đội hạ tầng mạng ở giai đoạn kiến trúc chính thức.
4. **OQ-4**: Số lượng kênh cụ thể cho giai đoạn thí điểm (§7.3) và tiêu chí "ổn định" để chuyển sang mở rộng 20 kênh — chưa chốt, cần xác định ở sprint planning/architecture dựa trên năng lực triển khai thực tế trong 7 ngày.
5. **OQ-5**: Có cần cơ chế escalation tự động khi đầu mối liên hệ tại đài không phản hồi cảnh báo, ngoài việc lặp lại theo cooldown 60s? — `[NOTE FOR PM]`, revisit sau giai đoạn thí điểm dựa trên phản hồi vận hành thực tế.
6. **OQ-6**: RACI cụ thể cho vòng đời passphrase (sinh, lưu trữ, phân phối tới 20 đài, thu hồi/xoay vòng khi nghi lộ hoặc đổi nhân sự) — **phải chốt trước khi pilot go-live** (không chờ giai đoạn kiến trúc), vì đây là lớp phòng thủ duy nhất cho cổng SRT public-facing (FR-5, §5).
7. **OQ-7**: Thiết kế chi tiết state machine/retry/reconnect của lớp orchestration tự build trên libsrt (FR-1) — chưa đi sâu trong brainstorm, cần thiết kế kỹ thuật riêng ở giai đoạn kiến trúc.
8. **OQ-8**: Âm báo động chỉ kêu 1 lần khi chuyển trạng thái, không có lớp bù thị giác cho cảnh báo tồn đọng nếu đội trực bỏ lỡ âm báo đầu tiên — ảnh hưởng trực tiếp độ tin cậy SM-1 (xem `addendum.md` §4). Cân nhắc bổ sung chỉ báo tĩnh/số đếm cảnh báo chưa ack cho pilot hoặc giai đoạn sau.
9. **OQ-9**: Rủi ro phần cứng loa cảnh báo (loa hỏng, âm lượng hệ điều hành = 0) là giới hạn đã biết của kênh âm thanh, ảnh hưởng trực tiếp độ tin cậy SM-1 — ngoài phạm vi phần mềm nhưng cần quy trình vận hành (vd kiểm tra loa đầu ca trực) để giảm thiểu.

## 10. Assumptions Index

- Từ §4.1 FR-1: Thiết kế chi tiết state machine/retry/reconnect của lớp orchestration chưa chốt — xem OQ-7.
- Từ §4.1 FR-2: Codec/kỹ thuật nén cụ thể cho ABR chưa chốt — xem OQ-2.
- Từ §4.1 FR-4: Yêu cầu driver/hệ điều hành cụ thể cho DeckLink Studio 4K chưa chốt — xem OQ-1.
- Từ §4.1 FR-5: Cơ chế lưu trữ/luân chuyển khoá mã hoá (key management/rotation) chưa chốt — xem OQ-6.
- Từ §4.1 (NFR độ trễ): Chỉ tiêu SM-2 ≤1s chưa được benchmark trên RTT thực tế — xem §7.3.
