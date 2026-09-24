---
review-of: '_bmad-output/planning-artifacts/architecture/architecture-TranferFiles-2026-08-28/ARCHITECTURE-SPINE.md'
review-type: version-verify (web reality-check của bảng Stack)
reviewed-date: '2026-08-31'
verdict: pass-with-findings
---

# Review — Verify version/công nghệ trong bảng Stack (ARCHITECTURE-SPINE.md)

Phương pháp: mỗi dòng Stack được web-search độc lập (WebSearch/WebFetch), đối chiếu số liệu trong tài liệu với nguồn hiện hành tại thời điểm review (2026-08-31). Không dùng training data để phán đoán — mọi khẳng định "đúng"/"sai" dưới đây đều bám nguồn đã fetch.

## Verdict: PASS-WITH-FINDINGS

Đa số dòng đúng và có thể xem là thực sự đã web-verify. Có **1 lỗi sự kiện nghiêm trọng** (CVE ID sai) và **1 điểm đã lỗi thời ngay tại/ngay sau ngày "verified"** cần sửa trước khi coi Stack table là final. Các dòng còn lại pass, kèm 1-2 ghi chú risk nhỏ nên biết.

---

## Chi tiết từng dòng

### 1. Windows (Windows 11 / Windows Server, không dùng Windows 10) — PASS

- Windows 10 end-of-support: **14/10/2025**, xác nhận qua Microsoft Support chính thức. Khớp con số trong tài liệu.
- Ghi chú risk (không phải lỗi, nhưng đáng biết): tài liệu chỉ ghi chung chung "Windows 11" — search cho thấy **Windows 11 24H2 hết mainstream support 04/10/2026** (~5 tuần sau ngày review này), Windows 11 23H2 (Home/Pro) đã hết hỗ trợ từ 11/2025. Nếu 40 máy transport-core cài 24H2 hôm nay, sẽ cần kế hoạch upgrade lên 25H2 trong vài tháng tới để không lặp lại đúng vấn đề mà dòng này đang né (EOL). Windows Server 2025 thì an toàn dài hạn (mainstream tới 11/2029). Đề xuất: spine nên chỉ định rõ build Windows 11 (25H2 trở lên) hoặc Windows Server 2025, không để "Windows 11" trần.
- Nguồn: [Microsoft Support – Windows 10 end of support](https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/windows-10-support-has-ended-on-october-14-2025), [windowslatest.com – 2026 EOL wave](https://www.windowslatest.com/2026/01/01/microsofts-2026-end-of-support-wave-includes-windows-11-24h2-office-2021-and-more/)

### 2. libsrt (Haivision/srt) ≥ 1.5.6 — FAIL (2 vấn đề)

**a) Version đã lỗi thời ngay tại/ngay sau "verified web 2026-08-28":**
Haivision/srt đã phát hành **v1.5.7 ngày 28/08/2026** — đúng ngày tài liệu ghi "verified web". Tính đến hôm nay (31/08/2026), 1.5.6 KHÔNG còn là "bản mới nhất hiện hành" như tài liệu khẳng định. v1.5.7 là bản security-hardening tiếp theo, vá thêm các vấn đề trong handshake/encryption negotiation, ACK validation, FEC, bonding use-after-free — nhiều hơn phạm vi 2 CVE mà tài liệu dẫn cho 1.5.6. Rule "≥1.5.6" (dạng lower-bound) về mặt kỹ thuật vẫn cho phép dùng 1.5.7, nhưng câu văn "bản mới nhất hiện hành" là sai và cần cập nhật thành ≥1.5.7.

**b) CVE ID sai (dấu hiệu training-data assert, không phải web-verify thật):**
Tài liệu ghi "CVE-2026-55840 encryption downgrade + CVE-2026-55841 heap overflow KMREQ". Đối chiếu GitHub release notes chính thức của Haivision/srt v1.5.6 và Debian security-tracker:
- CVE thật cho encryption state-machine downgrade là **CVE-2026-55868**.
- CVE thật cho heap-based buffer overflow trong KMREQ handling là **CVE-2026-55869**.

Tài liệu lệch đúng 28 số (55840/55841 vs 55868/55869) — dạng lỗi kinh điển của số bị "nhớ nhầm"/hallucinate gần đúng, không phải copy từ nguồn thật. Đây là bằng chứng rõ nhất trong toàn bảng Stack cho thấy dòng này KHÔNG thực sự qua web-verify dù có gắn nhãn "verified web 2026-08-28" — cần sửa lại đúng ID và tra lại nguồn trước khi giữ nhãn "verified".

- Nguồn: [Haivision/srt Releases (tags v1.5.7, v1.5.6...)](https://github.com/Haivision/srt/tags), [Release v1.5.6](https://github.com/Haivision/srt/releases/tag/v1.5.6), [Release v1.5.7](https://github.com/Haivision/srt/releases/tag/v1.5.7), [Debian security-tracker CVE-2026-55869](https://security-tracker.debian.org/tracker/CVE-2026-55869)

### 3. Blackmagic Desktop Video SDK 16.0 (build-time) — PASS

SDK 16.0 tồn tại, là gốc của dòng 16.0 → 16.0.1 → 16.3 → 16.4 (xác nhận qua Newsshooter/nofilmschool). Cách tài liệu diễn giải "SDK dùng để build FFmpeg với --enable-decklink, transport-core không gọi trực tiếp" khớp với cách FFmpeg thực sự build DeckLink support (xem mục 5 bên dưới).

- Nguồn: [nofilmschool – Desktop Video 16.0.1](https://nofilmschool.com/blackmagic-design-desktop-video-update), [Blackmagic Developer SDK page](https://www.blackmagicdesign.com/developer/products/capture-and-playback/sdk-and-software)

### 4. Blackmagic Desktop Video driver 16.4 (deploy-time) — PASS

Xác nhận Desktop Video **16.4 phát hành 24/08/2026** (Newsshooter), thêm tính năng cấu hình IP thủ công cho NMOS register trên dòng DeckLink IP HD — trước ngày "verified web 2026-08-28" trong tài liệu, nên con số hợp lý tại thời điểm đó. Một search khác (không index kịp bài 24/08) từng báo "mới nhất là 16.3" — đây là race hiển nhiên giữa các nguồn/index, không phải lỗi của tài liệu; 16.4 là số đúng.

- Nguồn: [Newsshooter – Desktop Video 16.4 Update (24/08/2026)](https://www.newsshooter.com/2026/08/24/blackmagic-design-desktop-video-16-4-update/)

### 5. FFmpeg (libavformat/libavcodec/libavdevice, build --enable-decklink) 8.1.x (8.1.2) — PASS, kèm 1 ghi chú judgment-call

- **8.1.2 có thật**, là bản mới nhất của nhánh **8.1** (codename "Hoare"), release 17/06/2026, nhánh cắt từ master 08/03/2026, >100 bugfix/stability fix — khớp mô tả "nhánh ổn định 8.1.x, đã qua vài điểm vá". Xác nhận qua ffmpeg.org/download.html: liệt kê rõ 9.0.1 (mới nhất) → 8.1.2 → 8.0.3 → 7.1.5... đúng cấu trúc nhánh release mà tài liệu mô tả.
- **FFmpeg 9.0 ("Lei") đã release ~03-04/08/2026**, có bản vá 9.0.1 ngày 12/08/2026 — nghĩa là tại ngày "verified web 2026-08-31", 9.0.x đã tồn tại được ~4 tuần và có 1 điểm vá. Việc tài liệu chọn 8.1.x thay vì 9.0.1 vì "đã qua vài điểm vá hơn" là judgment-call hợp lý về mặt kỹ thuật (9.0 mới hơn, ít giờ bay hơn trong production), nhưng lập luận "8.1.x nhiều điểm vá hơn 9.0.1" chỉ đúng ở KHÍA CẠNH thời gian tồn tại, không phải số lượng point-release (9.0 mới có 9.0.1, còn 8.1 đã có 8.1.0→8.1.2). Kết luận chọn 8.1.2 là hợp lý và không sai, nhưng nên diễn đạt lý do là "nhánh 8.1 đã chạy production lâu hơn/rộng hơn" thay vì ngụ ý 9.0.1 "mới ra" kém ổn định hơn về mặt patch-count tuyệt đối — hiện tại cả 2 nhánh đều mới có đúng 1-2 điểm vá kể từ khi cắt nhánh.
- **`--enable-decklink` cần Blackmagic Desktop Video SDK ở build-time — xác nhận ĐÚNG.** FFmpeg configure cần trỏ `--extra-cflags`/`--extra-ldflags` vào thư mục `include`/`lib` của DeckLink SDK để compile/link module decklink trong `libavdevice`; sau khi build xong, binary/lib đã link tĩnh phần cần thiết và tại deploy-time chỉ cần **driver** Desktop Video (không cần SDK) để giao tiếp phần cứng — đúng như tài liệu tách "SDK (build-time)" khỏi "driver (deploy-time)".

- Nguồn: [ffmpeg.org/download.html](https://ffmpeg.org/download.html), [UbuntuHandbook – FFmpeg 8.1.2](https://ubuntuhandbook.org/index.php/2026/06/ffmpeg-8-1-2-over-hundred-fixes/), [Phoronix – FFmpeg 9.0 Released](https://www.phoronix.com/news/FFmpeg-9.0-Released), [jbkempf.com – FFmpeg 9.0](https://jbkempf.com/blog/2026/ffmpeg-9.0/), [HackMD – building-ffmpeg-with-decklink](https://hackmd.io/BOEQSrH4SMumU6YzO078Jg)

### 6. H.264 encoder (x264 / NVENC / QuickSync / AMF qua libavcodec) — PASS (không cần verify version, tài liệu tự nói "không cần pin version")

Không có con số cụ thể để kiểm; lựa chọn công cụ (libavcodec wrapper cho x264/NVENC/QuickSync/AMF) nhất quán với các dòng FFmpeg/SDK ở trên. Không có gì để cờ đỏ.

### 7. Node.js 24.x (Active LTS) — PASS

Xác nhận Node.js 24 đang ở trạng thái **Active LTS** tính đến 2026 (LTS tới 30/04/2028), Node.js 26 là dòng Current (non-LTS). Khớp chính xác dòng "24.x (Active LTS)".

- Nguồn: [PkgPulse – Node 22 vs Node 24 in 2026](https://www.pkgpulse.com/guides/nodejs-22-vs-nodejs-24-2026), [eosl.date Node.js](https://eosl.date/eol/product/nodejs/)

### 8. React 19.2.x — PASS

Bản mới nhất tại thời điểm review: **19.2.8 (21/07/2026)**, chưa có 19.3/20 được công bố. Khớp chính xác "19.2.x".

- Nguồn: [GitHub – Release 19.2.8](https://github.com/react/react/releases/tag/v19.2.8), [react.dev/versions](https://react.dev/versions)

### 9. `ws` (WebSocket library, Node) — PASS (đúng tinh thần "không pin version")

Tài liệu không cam kết con số cụ thể ("bản hiện hành npm tại thời điểm code hoá") — không có gì sai để verify. Ghi nhận tham khảo: bản hiện hành tại thời điểm review là **8.21.x**.

- Nguồn: npm/Snyk package page `ws`

---

## Tổng hợp Findings ưu tiên

1. **[FAIL – phải sửa] libsrt: CVE ID sai** — "CVE-2026-55840/55841" không tồn tại; CVE thật là **CVE-2026-55868** (encryption downgrade) và **CVE-2026-55869** (KMREQ heap overflow). Đây là bằng chứng dòng này gắn nhãn "verified web" nhưng số liệu không khớp nguồn thật — cần tra lại và sửa.
2. **[FAIL – phải cập nhật] libsrt: version đã lỗi thời** — v1.5.7 phát hành đúng 28/08/2026 (ngày tài liệu ghi "verified"), là bản mới nhất tính đến hôm nay 31/08/2026, không phải 1.5.6. Câu "bản mới nhất hiện hành" cần sửa thành 1.5.7 (rule "≥1.5.6" vẫn đúng dạng lower-bound nhưng nên nâng lên ≥1.5.7 vì 1.5.7 vá thêm nhiều lỗ hổng).
3. **[Risk — nên bổ sung] Windows 11 build cụ thể** — tài liệu ghi chung "Windows 11" nhưng Windows 11 24H2 hết mainstream support 04/10/2026 (~5 tuần nữa); nên chỉ định rõ 25H2 trở lên hoặc Windows Server 2025 để tránh lặp lại vấn đề EOL mà chính dòng này đang cố tránh với Windows 10.
4. **[Judgment call, không phải lỗi] FFmpeg 8.1.2 vs 9.0.1** — lựa chọn 8.1.x hợp lý và số liệu đúng thật, nhưng lý do "đã qua vài điểm vá hơn n9.0.1" nên diễn đạt lại chính xác hơn (9.0 cũng đã có 9.0.1); bản chất quyết định (ưu tiên nhánh chạy production lâu hơn) vẫn đứng vững.
5. **[PASS, đã verify thật]** Windows 10 EOL, Blackmagic SDK 16.0, Blackmagic driver 16.4, Node.js 24 LTS, React 19.2.x, và cơ chế `--enable-decklink` cần SDK build-time/driver deploy-time — tất cả khớp nguồn web hiện hành, không có dấu hiệu hallucination.

## Khuyến nghị hành động

- Sửa ngay dòng libsrt trong Stack table: đổi CVE ID đúng (55868/55869) và nâng version tối thiểu lên ≥1.5.7 (hoặc ghi rõ ngày verify lại nếu team chủ động chốt ở 1.5.6 vì lý do khác — nhưng hiện tài liệu không nêu lý do đó).
- Thêm build cụ thể cho dòng Windows (25H2+ hoặc Server 2025) kèm ngày hết hạn để tránh phải sửa lại giữa pilot.
- Không cần đổi FFmpeg 8.1.2 — chỉ cần chỉnh câu văn lý do cho chính xác hơn.
