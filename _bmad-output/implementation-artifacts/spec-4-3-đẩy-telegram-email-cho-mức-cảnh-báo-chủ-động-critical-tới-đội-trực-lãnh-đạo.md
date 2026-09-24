---
title: 'Story 4.3: Đẩy Telegram + Email cho mức "cảnh báo chủ động" (critical) tới đội trực & lãnh đạo'
type: 'feature'
created: '2026-09-22'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'a8a41059771284baa2ae1526d03f58f1808822e4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi kênh chuyển sang `critical` (mất tín hiệu hoàn toàn), hiện chỉ có Story 4.2 gửi Telegram cho đội trực ở mức `warning` — chưa có kênh nào báo mức `critical` cho cả đội trực lẫn lãnh đạo VTCDigital, và codebase chưa có bất kỳ cơ chế gửi Email nào.

**Approach:** Tổng quát hoá `TelegramAlertAdapter` (tham số hoá theo `displayState`) để dùng lại cho `critical` qua 2 instance mới (chat đội trực hiện có + chat lãnh đạo mới), và thêm `EmailAlertAdapter` mới dùng `nodemailer` qua SMTP gửi 1 email tới danh sách người nhận gộp (đội trực + lãnh đạo) khi `critical`.

## Boundaries & Constraints

**Always:**
- `TelegramAlertAdapter` nhận `displayState` qua constructor option (không hardcode `'warning'`); cooldown độc lập theo instance/kênh, dùng `Clock` injectable — không tính lại debounce.
- Cả 2 Telegram instance mới và `EmailAlertAdapter` chỉ kích hoạt khi `change.displayState === 'critical'`.
- Cooldown tối thiểu 60000ms độc lập theo từng (channelId, alert_type) — instance critical không dùng chung bộ đếm với instance warning hiện có, dù dùng chung `chatId` đội trực.
- `EmailAlertAdapter` dùng `nodemailer` qua SMTP; lỗi gửi (connect/auth/timeout) phải bị nuốt + log qua `Logger`, KHÔNG throw ra ngoài — mirror pattern `TelegramAlertAdapter`.
- Thiếu bất kỳ biến môi trường bắt buộc nào (leadership chat id, SMTP host/port/user/password/from, danh sách người nhận email) lúc khởi động → fail-fast rõ ràng tại `app/main.ts`, gọi `registryPort.stop()` trước khi throw (mirror Story 4.2 patch).
- README.md: thêm dòng biến môi trường mới + ghi chú breaking-change.

**Never:**
- Không gửi Email/Telegram lãnh đạo ở mức `warning` — giữ nguyên phạm vi Story 4.2 cho đội trực.
- Không xử lý thông báo phục hồi (bỏ qua cooldown khi trở lại `ok`) — thuộc Story 4.4.
- Không tự viết SMTP client qua `net`/`tls` — dùng `nodemailer`.
- Không đổi debounce/threshold ở `channelState.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|---------------------------|----------------|
| `critical` mới, ngoài cooldown | `displayState=critical`, chưa từng gửi/lần trước ≥60s | Gửi Telegram đội trực + Telegram lãnh đạo + 1 Email (đội trực+lãnh đạo) | N/A |
| `critical` lặp lại cùng kênh trong <60s | 2 lần critical cùng `channelId` cách nhau <60000ms | Không gửi lại (cả Telegram lẫn Email), log cooldown skip | N/A |
| `warning` hoặc `ok` | `displayState !== 'critical'` | Bỏ qua toàn bộ 3 kênh gửi mới, không tính cooldown | N/A |
| Gửi Telegram lỗi (network/HTTP) | `sendMessage` reject | Nuốt lỗi, log, KHÔNG throw; Email vẫn gửi độc lập | catch, `logger.log` |
| Gửi Email lỗi (SMTP) | `transport.sendMail` reject | Nuốt lỗi, log, KHÔNG throw; Telegram vẫn gửi độc lập | catch, `logger.log` |
| Thiếu biến môi trường mới lúc khởi động | Thiếu 1 trong: leadership chat id / SMTP host,port,user,password,from / email recipients | Service dừng ngay, lỗi rõ ràng, `registryPort.stop()` trước khi throw | throw `Error` |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:104` -- filter hardcode `displayState === 'warning'`, đổi thành so sánh với `displayState` tham số hoá qua constructor.
- `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:84-88,106` -- cooldown `Map` key `${channelId}:warning`, đổi theo `displayState` của instance.
- `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:169-171` -- `formatWarningMessage`, tổng quát hoá thành formatter theo `displayState` (thêm nhánh critical).
- `dashboard-backend/src/ports/AlertOutboundPort.ts:9,11-30` -- `DisplayState` đã có `'critical'`; `ChannelStateChange`/`AlertOutboundPort` tái dùng nguyên, không sửa.
- `dashboard-backend/src/adapters/outbound/logAlertAdapter.ts` -- pattern adapter đơn giản (constructor nhận `Logger`, implement `publishStateChange`) tham khảo cho `EmailAlertAdapter`.
- `dashboard-backend/app/main.ts:279-331` -- đọc/validate/fail-fast Telegram env hiện có (bao gồm `registryPort.stop()` dòng 315 trước throw) -- nhân bản pattern cho leadership chat id + SMTP config.
- `dashboard-backend/app/main.ts:150-184,166-172` -- khai báo config override của `startApp()` cho Telegram -- thêm override tương tự cho leadership chat id + SMTP/email (test injection).
- `dashboard-backend/app/main.ts:403` -- mảng `createCompositeAlertPort([logAlertPort, telegramAlertPort, ui], logger)` -- thêm 2 `TelegramAlertAdapter` mới (critical đội trực, critical lãnh đạo) + 1 `EmailAlertAdapter` mới vào đây.
- `dashboard-backend/tests/telegramAlertAdapter.test.ts` -- pattern test I/O matrix (cooldown, filter, lỗi swallow) -- mirror cho tham số hoá displayState.
- `dashboard-backend/tests/main.test.ts:206-331,429-481,596-660` -- pattern test fail-fast/wiring/integration -- mirror cho biến env + adapter mới.
- `dashboard-backend/README.md:28-40` -- bảng env var + ghi chú breaking-change -- thêm dòng mới.
- `dashboard-backend/package.json:18-19` -- thêm dependency `nodemailer` (+ `@types/nodemailer` devDependency).

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/package.json` -- thêm dependency `nodemailer` + `@types/nodemailer` -- nền tảng cho EmailAlertAdapter.
- [x] `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts` -- tham số hoá `displayState` qua constructor option (bắt buộc) + cooldown key + message formatter theo state -- dùng chung 1 pipeline cho cả warning (Story 4.2, hành vi không đổi) và critical (Story 4.3).
- [x] `dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts` (MỚI) -- implement `AlertOutboundPort` qua `nodemailer`: lọc chỉ `displayState==='critical'`, cooldown 60000ms qua `Clock` injectable (`Map` theo `channelId`, độc lập với Telegram), gửi 1 email tới danh sách recipients cấu hình, nuốt lỗi + log -- lõi tính năng.
- [x] `dashboard-backend/app/main.ts` -- đọc/validate/fail-fast `DASHBOARD_TELEGRAM_LEADERSHIP_CHAT_ID` + `DASHBOARD_SMTP_HOST`/`PORT`/`USER`/`PASSWORD`/`FROM`/`DASHBOARD_EMAIL_CRITICAL_RECIPIENTS` (gọi `registryPort.stop()` trước throw); khởi tạo 2 `TelegramAlertAdapter` mới (đội trực-critical dùng lại `chatId` hiện có, lãnh đạo-critical dùng `chatId` mới) + 1 `EmailAlertAdapter`; thêm cả 3 vào `createCompositeAlertPort([...])` -- wiring composition root.
- [x] `dashboard-backend/tests/telegramAlertAdapter.test.ts` -- test tham số hoá `displayState` (warning không đổi hành vi, critical hoạt động tương tự) + cooldown độc lập theo instance.
- [x] `dashboard-backend/tests/emailAlertAdapter.test.ts` (MỚI) -- test toàn bộ I/O matrix (lọc critical, cooldown, lỗi SMTP bị nuốt+log) bằng fake clock + fake `sendMail`, mirror `telegramAlertAdapter.test.ts`.
- [x] `dashboard-backend/tests/main.test.ts` -- test fail-fast cho từng biến mới, wiring (2 Telegram instance mới + Email instance có mặt trong composite), 1 test tích hợp critical thật.
- [x] `dashboard-backend/README.md` -- thêm dòng env var mới + ghi chú breaking-change + tham chiếu spec Story 4.3.

**Acceptance Criteria:**
- Given kênh chuyển sang `critical` sau debounce, when `publishStateChange` kích hoạt lần đầu, then đội trực + lãnh đạo đều nhận Telegram (2 chat khác nhau) VÀ 1 Email chung tới cả 2 nhóm.
- Given 2 lần `critical` liên tiếp cùng kênh trong 60s, when lần 2 kích hoạt, then không gửi lại Telegram lẫn Email lần 2, có log cooldown skip riêng cho từng kênh gửi.
- Given thiếu 1 trong các biến môi trường mới lúc khởi động, when chạy `startApp()`/`npm start`, then service dừng ngay với lỗi rõ ràng, `registryPort` đã được stop.
- Given kênh ở mức `warning` (không phải critical), when `publishStateChange` kích hoạt, then không gửi Telegram lãnh đạo/Email; hành vi Telegram đội trực ở mức warning (Story 4.2) không đổi.

### Review Findings

_Vòng 2 (bmad-code-review, 2026-09-22): gộp finding còn mở của vòng 1 với finding mới, sắp lại theo Decision trước / Patch sau._

- [x] [Review][Decision] **Resolved (2026-09-22, user):** giữ nguyên `To:` — đơn giản, minh bạch ai đã được báo; không cần sửa code. Email gửi critical dùng `To:` gộp thay vì `Bcc:` — Đội trực và lãnh đạo thấy được địa chỉ email của nhau trong MỌI email cảnh báo critical (khác Telegram, đã tách riêng theo audience qua 2 chat khác nhau). [dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts — `defaultEmailSendMail`]
- [x] [Review][Decision] **Resolved (2026-09-22, user):** AC4 "không đổi" chỉ tính hành vi gửi (điều kiện trigger/cooldown), không bắt buộc nguyên văn log — đóng finding, không cần sửa code. Tổng quát hoá `TelegramAlertAdapter` theo `displayState` làm đổi NGUYÊN VĂN message log của CHÍNH instance warning cũ (`telegram_alert_sent` bỏ chữ "đội trực"; `telegram_alert_cooldown_skipped`/`telegram_alert_send_error` thêm `displayState=`/`chat_id=` vào `reason`). [dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:132-183]
- [x] [Review][Decision] **Resolved (2026-09-22, user):** hạ tầng mail VTCDigital luôn dùng FQDN — giữ nguyên `EMAIL_SHAPE_REGEX`, chuyển thành 1 patch nhỏ ghi chú ràng buộc "domain phải có dấu `.`" vào README (xem mục Patch tương ứng bên dưới). `EMAIL_SHAPE_REGEX` (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) bắt buộc domain phải có dấu `.` — sẽ fail-fast chặn 1 địa chỉ dạng domain 1 nhãn (vd `user@mailhost`). [dashboard-backend/app/main.ts:70]
- [x] [Review][Patch] **Fixed (2026-09-22):** README tự mâu thuẫn số lượng biến môi trường mới (câu giới thiệu ghi "6", nhưng bảng + ghi chú breaking-change liệt kê đúng 7) [dashboard-backend/README.md:14]
- [x] [Review][Patch] **Fixed (2026-09-22):** Thứ tự validate biến môi trường Story 4.3 phá vỡ đảm bảo "báo đủ lỗi trong 1 lần restart" — gộp toàn bộ lỗi (thiếu biến + sai hình dạng email/port + trùng chat_id) vào 1 mảng `story43Errors`, throw 1 lần duy nhất [dashboard-backend/app/main.ts:414-523]
- [x] [Review][Patch] **Fixed (2026-09-22):** `parseEmailRecipients` dedupe giờ không phân biệt hoa/thường (so khớp qua `toLowerCase()`, giữ casing gốc của lần xuất hiện đầu tiên) [dashboard-backend/app/main.ts:80-98]
- [x] [Review][Patch] **Fixed (2026-09-22):** `DASHBOARD_SMTP_FROM` giờ được validate hình dạng email qua `EMAIL_SHAPE_REGEX`, fail-fast lúc khởi động thay vì lộ ra lúc gửi SMTP thật [dashboard-backend/app/main.ts:464-473]
- [x] [Review][Patch] **Fixed (2026-09-22):** Sửa lỗi chính tả lặp từ "học học" trong thông báo lỗi của `parseSmtpPort` [dashboard-backend/app/main.ts:113-118]
- [x] [Review][Patch] **Fixed (2026-09-22):** Thêm 4 test trực tiếp cho `parseSmtpPort` (hợp lệ, rỗng, hex/khoa học/dấu +, ngoài khoảng 1-65535) [dashboard-backend/tests/main.test.ts]
- [x] [Review][Patch] **Fixed (2026-09-22):** Thêm 5 test trực tiếp cho `defaultEmailSendMail` (secure theo port 465/587, timeout, redaction lỗi, `info.rejected`) qua stub `nodemailer.createTransport` [dashboard-backend/tests/emailAlertAdapter.test.ts]
- [x] [Review][Patch] **Fixed (2026-09-22):** `defaultEmailSendMail` giờ bắt lỗi `transporter.sendMail()` và thay bằng message cố định không chứa `smtpConfig.user`/`password`, mirror `defaultTelegramSendMessage` [dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts:56-91]
- [x] [Review][Patch] **Fixed (2026-09-22):** `defaultEmailSendMail` giờ kiểm tra `info.rejected` của `transporter.sendMail()`, throw nếu có recipient bị từ chối thay vì âm thầm coi là gửi đủ [dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts:56-91]
- [x] [Review][Patch] **Fixed (2026-09-22):** README: dòng `DASHBOARD_TELEGRAM_LEADERSHIP_CHAT_ID` giờ có ghi chú định dạng (số nguyên, có thể âm) + yêu cầu khác `DASHBOARD_TELEGRAM_CHAT_ID` [dashboard-backend/README.md]
- [x] [Review][Patch] **Fixed (2026-09-22):** README: dòng `DASHBOARD_EMAIL_CRITICAL_RECIPIENTS` giờ ghi rõ 1 entry sai định dạng email cũng fail-fast [dashboard-backend/README.md]
- [x] [Review][Patch] **Fixed (2026-09-22):** Thêm guard fail-fast khi `DASHBOARD_TELEGRAM_LEADERSHIP_CHAT_ID` trùng `DASHBOARD_TELEGRAM_CHAT_ID` [dashboard-backend/app/main.ts:440-454]
- [x] [Review][Patch] **Fixed (2026-09-22):** Mọi test fail-fast Story 4.3 (data-driven loop + SMTP port + leadership chat id whitespace + email format + SMTP_FROM format + duplicate chat id) giờ dùng `assert.doesNotThrow(() => rmSync(...))` mirror pattern 2 test EADDRINUSE [dashboard-backend/tests/main.test.ts]
- [x] [Review][Patch] **Fixed (2026-09-22):** Test tích hợp nhánh warning giờ assert `telegramCalls.length === 1` + spy `emailSendMail` assert `emailCalls.length === 0` [dashboard-backend/tests/main.test.ts:871-940]
- [x] [Review][Patch] **Fixed (2026-09-22):** README bổ sung ghi chú ràng buộc "domain phải có dấu `.`" cho `DASHBOARD_SMTP_FROM`/`DASHBOARD_EMAIL_CRITICAL_RECIPIENTS` [dashboard-backend/README.md]

## Spec Change Log

- 2026-09-22: bmad-code-review vòng 2 — gộp 11 finding còn mở của vòng 1 với 3 finding mới (integration test gap nhánh warning, AC4 log-text, `EMAIL_SHAPE_REGEX` domain-dot), giải quyết 3 decision (giữ `To:`, "không đổi" AC4 chỉ tính hành vi gửi, giữ regex + ghi chú README), áp dụng 15 patch. `npm test`: 247/248 pass (1 fail còn lại: `installService.test.js`, lỗi Node IPC pre-existing không liên quan diff này — xem epic-2-retro-item-13).

## Design Notes

Tổng quát hoá `TelegramAlertAdapter` theo `displayState` thay vì tạo class trùng lặp, đúng khuyến nghị trong epic context (1 pipeline tham số hoá theo alert_type, tránh trùng lặp code giữa Story 4.2/4.3). `EmailAlertAdapter` gộp chung danh sách người nhận (đội trực + lãnh đạo) trong 1 email thay vì gửi riêng theo từng nhóm — nội dung giống hệt nhau, tách theo audience chỉ có ý nghĩa với Telegram (khác chat/group), SMTP hỗ trợ multiple recipients native nên không cần 2 lần gửi cho Email.

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- expected: pass toàn bộ, gồm test mới cho critical Telegram + `emailAlertAdapter.test.ts`.

**Manual checks:**
- Set đủ biến môi trường (leadership chat id thật, SMTP thật trỏ hộp mail test), giả lập 1 kênh chuyển `critical` → xác nhận nhận đúng Telegram ở CẢ 2 chat + 1 email tới danh sách recipients, không lặp lại trong 60s.

## Suggested Review Order

**Tổng quát hoá `TelegramAlertAdapter` theo `displayState`**

- Entry point — `displayState` giờ là option BẮT BUỘC (không còn hardcode `'warning'`), nền tảng để 1 class phục vụ cả warning (4.2) và critical (4.3).
  [`telegramAlertAdapter.ts:87`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L87)

- Filter + cooldown key đổi từ hardcode `'warning'` sang so sánh với `this.displayState` — mỗi instance chỉ phản ứng đúng 1 state.
  [`telegramAlertAdapter.ts:127`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L127)

- `formatAlertMessage` rẽ nhánh theo `displayState`, nhánh warning giữ nguyên văn text cũ, thêm nhánh critical kèm `subType`.
  [`telegramAlertAdapter.ts:198`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L198)

**`EmailAlertAdapter` mới (mirror pattern Telegram)**

- Class mới, `lastSentAt` Map riêng theo `channelId` — cooldown độc lập tuyệt đối với mọi `TelegramAlertAdapter` instance.
  [`emailAlertAdapter.ts:94`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L94)

- `publishStateChange`: lọc chỉ `critical`, cooldown 60s, fire-and-forget `sendMail` qua `Promise.resolve().then/catch` — không throw ra ngoài.
  [`emailAlertAdapter.ts:123`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L123)

- Patch review: timeout SMTP (`connectionTimeout`/`greetingTimeout`/`socketTimeout`=10s) — tránh treo vô thời hạn khi SMTP host không phản hồi.
  [`emailAlertAdapter.ts:71`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L71)

- `formatCriticalEmailBody`: nội dung email kèm `subType` khi có — cùng thông tin với Telegram critical.
  [`emailAlertAdapter.ts:180`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L180)

**Wiring & fail-fast tại composition root (`main.ts`)**

- 2 instance `TelegramAlertAdapter` critical mới — đội trực tái dùng `chatId` Story 4.2, lãnh đạo dùng `chatId` mới.
  [`main.ts:495`](../../dashboard-backend/app/main.ts#L495) · [`main.ts:503`](../../dashboard-backend/app/main.ts#L503)

- `EmailAlertAdapter` instance mới, nhận danh sách recipients gộp đội trực+lãnh đạo.
  [`main.ts:513`](../../dashboard-backend/app/main.ts#L513)

- Cả 3 port mới được THÊM vào `createCompositeAlertPort([...])`, không thay thế port nào hiện có.
  [`main.ts:597`](../../dashboard-backend/app/main.ts#L597)

- Fail-fast gộp 7 biến môi trường mới (leadership chat id + SMTP host/port/user/password/from + email recipients), `registryPort.stop()` trước throw.
  [`main.ts:470`](../../dashboard-backend/app/main.ts#L470)

- Patch review: `parseEmailRecipients` giờ throw khi 1 entry sai hình dạng email — call site bọc try/catch để vẫn dọn `registryPort` trước khi rethrow.
  [`main.ts:429`](../../dashboard-backend/app/main.ts#L429)

- `parseSmtpPort`: chỉ chấp nhận chuỗi số nguyên thập phân thuần (patch: chặn `"0x1F"`/`"5e2"`/`"+587"` từng lọt qua `Number()`).
  [`main.ts:103`](../../dashboard-backend/app/main.ts#L103)

- `parseEmailRecipients`: validate hình dạng email + dedupe (giữ thứ tự xuất hiện đầu tiên) — patch review, đảo ngược quyết định "không dedupe" ban đầu.
  [`main.ts:80`](../../dashboard-backend/app/main.ts#L80)

**Peripherals**

- Test critical + cooldown độc lập instance (warning vs critical dùng chung `chatId`).
  [`telegramAlertAdapter.test.ts`](../../dashboard-backend/tests/telegramAlertAdapter.test.ts)

- Test toàn bộ I/O matrix + `subType` trong text của `EmailAlertAdapter`.
  [`emailAlertAdapter.test.ts`](../../dashboard-backend/tests/emailAlertAdapter.test.ts)

- Test fail-fast (data-driven, 7 biến mới) + wiring thật (2 Telegram critical + Email cùng gửi khi machine-offline) + `parseEmailRecipients` unit test.
  [`main.test.ts`](../../dashboard-backend/tests/main.test.ts)

- 7 dòng env var mới + ghi chú breaking-change.
  [`README.md`](../../dashboard-backend/README.md)

- Dependency `nodemailer` mới.
  [`package.json`](../../dashboard-backend/package.json)
