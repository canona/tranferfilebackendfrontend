---
title: 'Story 4.2: Đẩy Telegram cho mức "chú ý" (ABR/warning) tới đội trực'
type: 'feature'
created: '2026-09-22'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'eecef0ede8e6b51b4498ce283cdde402e7bdff9d'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Đội trực không luôn nhìn TV wall; hiện tại chưa có kênh thông báo nào ngoài dashboard khi 1 kênh chuyển sang `warning` (ABR hạ bitrate) — chỉ có `LogAlertAdapter` ghi log nội bộ, không ai được chủ động báo.

**Approach:** Thêm `TelegramAlertAdapter` implement `AlertOutboundPort` hiện có, gắn vào composite alert port tại composition root (`app/main.ts`); adapter chỉ phản ứng với `displayState==='warning'`, áp cooldown 60s độc lập theo từng `channelId`, gửi tin nhắn tới 1 chat Telegram chung của đội trực sóng qua Bot API.

## Boundaries & Constraints

**Always:**
- Chỉ gửi khi `change.displayState === 'warning'` — bỏ qua `ok`/`critical` (thuộc Story 4.3/4.4).
- Cooldown tối thiểu 60000ms, độc lập theo từng `channelId` (key kiểu `${channelId}:warning`), dùng `Clock` injectable (không `Date.now()` trực tiếp) — test được bằng fake clock.
- Lỗi gọi Telegram Bot API (network/HTTP status lỗi) phải bị nuốt và log qua `Logger` có sẵn, KHÔNG throw ra ngoài (adapter tự chịu trách nhiệm, không dựa hoàn toàn vào `createCompositeAlertPort`'s catch chung).
- Thiếu `DASHBOARD_TELEGRAM_BOT_TOKEN`/`DASHBOARD_TELEGRAM_CHAT_ID` lúc khởi động → fail-fast, throw Error rõ ràng tại `app/main.ts` (mirror pattern `DASHBOARD_BEARER_TOKENS`) — không âm thầm start thiếu kênh cảnh báo.

**Ask First:**
- Có cần retry/backoff khi gọi Telegram API lỗi không (spec này mặc định KHÔNG retry — gửi 1 lần, lỗi thì log và bỏ qua).

**Never:**
- Không gửi cho lãnh đạo VTCDigital (chỉ đội trực sóng, 1 chat_id duy nhất qua config — AD-17).
- Không thêm field `telegram_chat_id` riêng theo từng kênh trong `channel-registry` — đội trực dùng chung 1 chat.
- Không đổi debounce 5s/mapping bitrate ở `channelState.ts`/`bitrateThreshold.ts`.
- Không thêm dependency HTTP client mới (axios/node-fetch) — dùng `fetch` built-in của Node ≥24.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|---------------------------|----------------|
| Warning mới, không trong cooldown | `displayState=warning`, chưa từng gửi/lần gửi trước >=60s | Gửi Telegram, ghi `lastSentAt=now` | N/A |
| Warning lặp lại cùng kênh trong <60s | 2 lần publish warning cùng `channelId` cách nhau <60000ms | Lần 2 KHÔNG gửi (cooldown), log sự kiện bỏ qua | N/A |
| Warning kênh khác trong lúc kênh A đang cooldown | `channelId` khác nhau | Vẫn gửi bình thường (cooldown tính độc lập/kênh) | N/A |
| `critical` hoặc `ok` | `displayState !== 'warning'` | Bỏ qua hoàn toàn, không gọi Telegram, không tính cooldown | N/A |
| Gọi Telegram API lỗi (network throw/HTTP status != 2xx) | `sendMessage` reject hoặc trả lỗi | Nuốt lỗi, log 1 event riêng, KHÔNG throw | catch, `logger.log` event mới |
| Warning cùng kênh sau khi cooldown đã hết | `now - lastSentAt >= 60000` | Gửi lại bình thường, cập nhật `lastSentAt=now` | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/core/channelState.ts:273-283` -- `applyCandidate()` chốt debounce, gọi `alertPort.publishStateChange(change)` — nguồn DUY NHẤT phát `warning` thật (2 nhánh heartbeat khác chỉ phát `critical`/`machine-offline`).
- `dashboard-backend/src/ports/AlertOutboundPort.ts:9,28-30` -- `AlertOutboundPort`/`ChannelStateChange`/`DisplayState` — tái dùng nguyên, không sửa.
- `dashboard-backend/src/adapters/outbound/logAlertAdapter.ts` -- pattern adapter outbound đơn giản tham khảo (constructor nhận `Logger`, implement `publishStateChange`).
- `dashboard-backend/app/main.ts:94-125` -- `createCompositeAlertPort(ports, logger)` fan-out, mỗi port lỗi cô lập riêng.
- `dashboard-backend/app/main.ts:269,338` -- nơi `logAlertPort` được `new` và nơi mảng composite được dựng (`createCompositeAlertPort([logAlertPort, ui], logger)`) — thêm `telegramAlertPort` vào đúng 2 chỗ này.
- `dashboard-backend/src/core/channelState.ts:23-27` -- `Clock` interface + `systemClock` — tái dùng cho cooldown 60s.
- `dashboard-backend/tests/logAlertAdapter.test.ts` -- pattern test adapter outbound (`node:test`, `FakeLogger`, dựng `ChannelStateChange` tay).
- `dashboard-backend/tests/main.test.ts:21,123-129` -- pattern test parse env var + wiring tại `main.ts`.
- `dashboard-backend/README.md:27-30` -- bảng docs biến môi trường `DASHBOARD_*` — thêm 2 dòng mới.
- `dashboard-backend/package.json` -- Node `>=24` có global `fetch`; KHÔNG có axios/node-fetch sẵn.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts` (MỚI) -- implement `AlertOutboundPort`: lọc chỉ `displayState==='warning'`, cooldown 60000ms qua `Map<string, number>` khoá `${channelId}:warning` + `Clock` injectable, gửi qua hàm `sendMessage` injectable (mặc định POST `https://api.telegram.org/bot<token>/sendMessage` bằng `fetch`), nuốt lỗi + log qua `Logger` -- lõi tính năng.
- [x] `dashboard-backend/app/main.ts` -- đọc `DASHBOARD_TELEGRAM_BOT_TOKEN`/`DASHBOARD_TELEGRAM_CHAT_ID` (fail-fast nếu thiếu/rỗng, mirror `DASHBOARD_BEARER_TOKENS`), `new TelegramAlertAdapter(...)` cạnh dòng 269, thêm vào mảng `createCompositeAlertPort([...])` dòng 338 -- wiring composition root.
- [x] `dashboard-backend/tests/telegramAlertAdapter.test.ts` (MỚI) -- test toàn bộ I/O matrix (cooldown độc lập/kênh, lọc chỉ warning, lỗi API bị nuốt+log) bằng fake clock + fake `sendMessage`, mirror `logAlertAdapter.test.ts`.
- [x] `dashboard-backend/README.md` -- thêm 2 dòng bảng env var `DASHBOARD_TELEGRAM_BOT_TOKEN`/`DASHBOARD_TELEGRAM_CHAT_ID` -- tài liệu vận hành nhất quán.

**Acceptance Criteria:**
- Given kênh chuyển sang `warning` sau debounce, when `publishStateChange` kích hoạt lần đầu, then Telegram được gửi đúng 1 lần tới chat đội trực (không gửi lãnh đạo).
- Given 2 lần `warning` liên tiếp cùng kênh trong 60s, when lần 2 kích hoạt, then KHÔNG gửi Telegram lần 2, có log ghi nhận việc bỏ qua do cooldown.
- Given thiếu biến môi trường Telegram lúc khởi động, when chạy `startApp()`/`npm start`, then service dừng ngay với lỗi rõ ràng.

### Review Findings

- [x] [Review][Patch] Thiếu `registryPort.stop()` trước khi throw fail-fast do thiếu Telegram env var — rò rỉ chokidar watcher [dashboard-backend/app/main.ts:298-316]
- [x] [Review][Patch] README thiếu ghi chú breaking-change: bản deploy cũ nâng cấp lên sẽ fail-fast ngay nếu chưa set `DASHBOARD_TELEGRAM_BOT_TOKEN`/`DASHBOARD_TELEGRAM_CHAT_ID` [dashboard-backend/README.md]
- [x] [Review][Patch] README chưa tài liệu hoá định dạng/ràng buộc của `DASHBOARD_TELEGRAM_CHAT_ID` (numeric/group id âm/`@username`, tránh nhầm là danh sách phân tách dấu phẩy như `DASHBOARD_BEARER_TOKENS` ở dòng trên) [dashboard-backend/README.md]
- [x] [Review][Patch] `flushMicrotasks(times=6)` đếm tick cố định trong `telegramAlertAdapter.test.ts` dễ giòn — nên đổi sang poll-based `waitUntil()` như `main.test.ts` đã dùng cho cùng hành vi async fire-and-forget [dashboard-backend/tests/telegramAlertAdapter.test.ts]

## Spec Change Log

## Design Notes

Cooldown lưu in-memory (`Map`), không cần bền vững qua restart — restart hiếm và epic context đã chấp nhận không có escalation/persistence phức tạp ở epic này. `sendMessage` tách thành tham số injectable (không gọi `fetch` cứng trong logic cooldown) để test được toàn bộ nhánh lỗi/cooldown mà không cần gọi mạng thật, mirror cách `Clock` đã injectable trong `channelState.ts`.

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- expected: pass toàn bộ, gồm `telegramAlertAdapter.test.ts` mới.

**Manual checks:**
- Set `DASHBOARD_TELEGRAM_BOT_TOKEN`/`DASHBOARD_TELEGRAM_CHAT_ID` trỏ tới 1 bot Telegram thật, giả lập 1 kênh chuyển `warning` → xác nhận nhận được tin nhắn trong chat đội trực, không nhận 2 lần trong 60s.

## Suggested Review Order

**Lọc `warning` + cooldown 60s/kênh (lõi domain của adapter)**

- Entry point: lọc `displayState!=='warning'` sớm, cooldown theo key `channelId:warning` qua `Clock` injectable, ghi `lastSentAt` NGAY trước khi gửi.
  [`telegramAlertAdapter.ts:99`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L99)

- Hằng số cooldown tách riêng khỏi `DEBOUNCE_MS`/`HEARTBEAT_TIMEOUT_MS` của `channelState.ts` — không đụng ngưỡng debounce hiện có.
  [`telegramAlertAdapter.ts:25`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L25)

**Gửi bất đồng bộ an toàn (fire-and-forget, nuốt lỗi, không lộ token)**

- `Promise.resolve().then(sendMessage).then(logSent).catch(logError)` — bắt cả throw đồng bộ lẫn reject, chỉ log "đã gửi" SAU KHI resolve thật (patch review round 2).
  [`telegramAlertAdapter.ts:149`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L149)

- `defaultTelegramSendMessage`: timeout 10s (`AbortSignal.timeout`) + bắt riêng lỗi network để KHÔNG echo URL/token vào log, tách khỏi nhánh `!res.ok` (message an toàn, chỉ status+body).
  [`telegramAlertAdapter.ts:36`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L36)

**Wiring composition root (`main.ts`)**

- Đọc + trim + fail-fast gộp cả 2 biến `DASHBOARD_TELEGRAM_BOT_TOKEN`/`_CHAT_ID` trong 1 lần throw (patch review round 2: tránh round-trip sửa/restart 2 lần).
  [`main.ts:291`](../../dashboard-backend/app/main.ts#L291)

- Thêm `telegramAlertPort` vào mảng `createCompositeAlertPort([...])` — THÊM, không thay thế `logAlertPort`/`ui` hiện có.
  [`main.ts:398`](../../dashboard-backend/app/main.ts#L398)

**Test (peripheral)**

- Test tích hợp thật: đẩy bitrate xuống `warning`, assert `TelegramAlertAdapter` thật (qua composite wiring của `startApp()`) gọi đúng chatId + text — lấp gap wiring bị xoá/đảo thứ tự âm thầm.
  [`main.test.ts:596`](../../dashboard-backend/tests/main.test.ts#L596)

- 3 test fail-fast: thiếu bot token / thiếu chat id / toàn khoảng trắng.
  [`main.test.ts:206`](../../dashboard-backend/tests/main.test.ts#L206)

- Unit test toàn bộ I/O matrix + 2 test mới cho logic thật của `defaultTelegramSendMessage` (stub `global.fetch`, không qua fake `sendMessage`).
  [`telegramAlertAdapter.test.ts:275`](../../dashboard-backend/tests/telegramAlertAdapter.test.ts#L275)

- README: 2 dòng env var mới + tham chiếu spec Story 4.2.
  [`README.md:34`](../../dashboard-backend/README.md#L34)
