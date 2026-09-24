---
title: 'Story 4.4: Thông báo phục hồi gửi ngay lập tức, bỏ qua cooldown'
type: 'feature'
created: '2026-09-22'
status: 'done'
review_loop_iteration: 1
context: []
baseline_commit: 'f290435ff48b45f1f90e8c1ffc02d636911dbabc'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi kênh phục hồi về `ok` trong lúc cooldown 60s của cảnh báo `warning`/`critical` trước đó còn hiệu lực, `TelegramAlertAdapter`/`EmailAlertAdapter` không có nhánh nào gửi thông báo phục hồi — đội trực (và lãnh đạo nếu trước đó `critical`) không biết sự cố đã tự hết, phải gọi lại hỏi đài.

**Approach:** Thêm `previousDisplayState` vào `ChannelStateChange` tại `applyCandidate` VÀ tại `handleHeartbeat`'s resume-sau-machine-offline re-publish (review vòng 1 phát hiện: path này CŨNG phát `displayState==='ok'`, giả định ban đầu "chỉ applyCandidate phát ok" là sai), rồi thêm 1 nhánh "phục hồi" trong `TelegramAlertAdapter`/`EmailAlertAdapter`: khi `displayState==='ok'`, `previousDisplayState` khớp state mà instance phụ trách, VÀ `subType!=='machine-offline'` (tránh báo phục hồi giả khi dashboard vẫn hiển thị machine-offline), gửi ngay lập tức, bỏ qua hoàn toàn cooldown Map hiện có (không set/check `lastSentAt` cho nhánh này).

## Boundaries & Constraints

**Always:**
- Thêm field optional `previousDisplayState?: DisplayState` vào `ChannelStateChange` (`AlertOutboundPort.ts`); gán từ `previous?.state` (biến `previous` đã có sẵn) tại `applyCandidate` khi build `change`.
- Mỗi instance nhận diện nhánh phục hồi độc lập theo state nó phụ trách: instance Telegram warning → `previousDisplayState==='warning'`; 2 instance Telegram critical (đội trực, lãnh đạo) và `EmailAlertAdapter` → `previousDisplayState==='critical'`. Điều kiện luôn đi kèm `displayState==='ok'`.
- Nhánh phục hồi gửi NGAY, không đụng `lastSentAt` Map (không set, không check) — tách biệt hoàn toàn khỏi cooldown của nhánh cảnh báo mới, không ảnh hưởng cooldown đang chạy cho lần cảnh báo tiếp theo.
- Nội dung message/email phục hồi phải khác rõ nội dung cảnh báo (nhánh format riêng trong `formatAlertMessage`/formatter email), nêu rõ đây là tin phục hồi.
- Lỗi gửi (network/SMTP) ở nhánh phục hồi bị nuốt + log qua `Logger`, không throw — mirror pattern nhánh cảnh báo hiện có.
- Giữ nguyên 100% hành vi filter/cooldown hiện có cho nhánh cảnh báo mới (warning/critical) — chỉ thêm nhánh mới, không sửa nhánh cũ.
- `handleHeartbeat`'s resume-sau-machine-offline re-publish (`channelState.ts:339-347`): khi `record.committed?.state === 'ok'`, gán `previousDisplayState: 'critical'` CỐ ĐỊNH trên `change` publish — KHÔNG dùng giá trị telemetry nội bộ trước đó, vì `checkOneChannelHeartbeatTimeout` luôn công bố machine-offline là `critical` (Story 2.7) nên "trạng thái trước đó mà đội trực/lãnh đạo đã nhận cảnh báo" luôn là `critical`, bất kể `record.committed` nội bộ là gì.
- Nhánh phục hồi (cả Telegram lẫn Email) chỉ kích hoạt khi THÊM điều kiện `change.subType !== 'machine-offline'` — nếu telemetry tự hồi phục qua `applyCandidate` (displayState='ok') trong lúc `machineOfflineActive` vẫn `true` (heartbeat CHƯA resume), `subType:'machine-offline'` vẫn bị ép kèm theo boundaries Story 2.7 hiện có (dashboard vẫn hiển thị critical/machine-offline) — gửi phục hồi lúc này là báo giả.

**Never:**
- Không tính lại debounce ở tầng thông báo — dùng nguyên kết quả `applyCandidate`/`handleHeartbeat` đã chốt.
- Không coi chuyển `warning`→`critical` là phục hồi — đó là cảnh báo mới, xử lý bởi pipeline hiện có (Story 4.2/4.3), không đụng.
- Không sửa `checkOneChannelHeartbeatTimeout` — path này luôn publish `displayState:'critical'` (không bao giờ `'ok'`), ngoài phạm vi AC.
- Không thêm biến môi trường mới hay thay đổi wiring `main.ts` ngoài việc các instance hiện có tự có thêm nhánh phục hồi.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phục hồi từ `warning`, cooldown warning đang chạy | `previousDisplayState='warning'`, `displayState='ok'`, `lastSentAt` warning <60s trước | Telegram đội trực (instance warning) gửi tin phục hồi ngay, bỏ qua cooldown; Email không gửi | N/A |
| Phục hồi từ `critical`, cooldown critical đang chạy | `previousDisplayState='critical'`, `displayState='ok'` | Cả 2 Telegram critical (đội trực + lãnh đạo) VÀ Email đều gửi tin phục hồi ngay, bỏ qua cooldown riêng từng kênh | N/A |
| `warning`→`critical` (không phải phục hồi) | `previousDisplayState='warning'`, `displayState='critical'` | Không nhánh phục hồi nào kích hoạt; pipeline cảnh báo mới hiện có xử lý bình thường theo cooldown thường | N/A |
| Gửi tin phục hồi lỗi (network/SMTP) | `sendMessage`/`sendMail` reject ở nhánh phục hồi | Nuốt lỗi, log, KHÔNG throw | catch, `logger.log` |
| `previousDisplayState` undefined (event thiếu field) | `change` không có `previousDisplayState` | Không kích hoạt nhánh phục hồi; fallback filter hiện có (bỏ qua vì không khớp `this.displayState`) | N/A |
| Heartbeat resume sau machine-offline, `record.committed.state==='ok'` | `handleHeartbeat`: `wasOffline===true`, `record.committed.state==='ok'` | `change` publish gắn `previousDisplayState:'critical'` CỐ ĐỊNH; 2 Telegram critical (đội trực+lãnh đạo) + Email gửi tin phục hồi ngay | N/A |
| Telemetry tự hồi phục 'ok' trong lúc `machineOfflineActive` vẫn `true` (heartbeat chưa resume) | `change.displayState==='ok'`, `change.subType==='machine-offline'`, `change.previousDisplayState==='critical'` | Nhánh phục hồi KHÔNG kích hoạt (gated bởi `subType`) — dashboard vẫn hiển thị critical/machine-offline, chờ heartbeat resume thật | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/ports/AlertOutboundPort.ts:11-26` -- thêm `previousDisplayState?: DisplayState` vào `ChannelStateChange`.
- `dashboard-backend/src/core/channelState.ts:247` (`const previous = record.committed`) và `:273-282` (build `change`) -- gán `previousDisplayState: previous?.state` vào object `change` phát đi qua `applyCandidate`.
- `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:122-190` (`publishStateChange`) và `:127` (early-return filter hiện có), `:110,129,131-144,150` (cooldown Map `lastSentAt`) -- thêm nhánh phục hồi TRƯỚC filter hiện có: nếu `change.displayState==='ok' && change.previousDisplayState===this.displayState && change.subType!=='machine-offline'`, gửi ngay không qua `lastSentAt`.
- `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:198-204` (`formatAlertMessage`) -- thêm nhánh format tin phục hồi (khác text cảnh báo).
- `dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts:149-203` (`publishStateChange`), `:154` (filter `critical` cứng), `:132` (cooldown Map key theo `channelId`) -- thêm nhánh phục hồi khi `change.displayState==='ok' && change.previousDisplayState==='critical' && change.subType!=='machine-offline'`, bypass cooldown Map.
- `dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts` (email body formatter cạnh `publishStateChange`) -- thêm nhánh nội dung email phục hồi.
- `dashboard-backend/src/core/channelState.ts:339-347` (`handleHeartbeat` resume-sau-machine-offline, khối `if (record.committed) { const change: ChannelStateChange = {...}; this.alertPort.publishStateChange(change); }`) -- khi `record.committed.state === 'ok'`, thêm `previousDisplayState: 'critical'` CỐ ĐỊNH vào `change` (không đọc giá trị telemetry nội bộ nào khác).
- `dashboard-backend/tests/telegramAlertAdapter.test.ts` -- pattern `FakeClock`, `makeChange(overrides)`, `waitUntil` -- mirror thêm test bypass-cooldown phục hồi cho instance warning và 2 instance critical, cộng test guard `subType==='machine-offline'` không kích hoạt phục hồi.
- `dashboard-backend/tests/emailAlertAdapter.test.ts` -- tương tự cho nhánh phục hồi Email, cộng test guard `subType`.
- `dashboard-backend/tests/channelState.test.ts` -- thêm test xác nhận `previousDisplayState` xuất hiện đúng giá trị trong `ChannelStateChange` khi `applyCandidate` chốt sang state mới (bao gồm về `ok`), VÀ test `handleHeartbeat` resume-sau-machine-offline gán đúng `previousDisplayState:'critical'` khi `record.committed.state==='ok'`.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/ports/AlertOutboundPort.ts` -- thêm field optional `previousDisplayState?: DisplayState` vào `ChannelStateChange` -- nền tảng để adapter phân biệt phục hồi vs cảnh báo mới.
- [x] `dashboard-backend/src/core/channelState.ts` -- gán `previousDisplayState: previous?.state` khi build `change` trong `applyCandidate` -- domain core cung cấp đủ thông tin cho adapter, không đụng logic debounce/threshold.
- [x] `dashboard-backend/src/core/channelState.ts` -- trong `handleHeartbeat`'s resume-sau-machine-offline re-publish, khi `record.committed?.state === 'ok'`, gán thêm `previousDisplayState: 'critical'` CỐ ĐỊNH vào `change` -- machine-offline luôn được công bố `critical`, nên audience trước đó luôn nhận `critical`.
- [x] `dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts` -- thêm nhánh phục hồi (gửi ngay bỏ qua cooldown khi `displayState==='ok'`, `previousDisplayState` khớp `this.displayState`, VÀ `subType!=='machine-offline'`) + format message phục hồi riêng -- áp dụng chung cho cả 3 instance (warning, team-critical, leadership-critical) vì dùng chung class.
- [x] `dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts` -- thêm nhánh phục hồi tương tự (điều kiện `previousDisplayState==='critical' && subType!=='machine-offline'`) + format email phục hồi riêng -- lõi tính năng cho audience critical.
- [x] `dashboard-backend/tests/telegramAlertAdapter.test.ts` -- test bypass-cooldown phục hồi: cooldown đang active (gửi cảnh báo trước, không advance clock đủ 60s) → publish `change` phục hồi khớp `previousDisplayState` → assert vẫn gửi; test KHÔNG kích hoạt khi `previousDisplayState` không khớp; test KHÔNG kích hoạt khi `subType==='machine-offline'` dù `previousDisplayState` khớp.
- [x] `dashboard-backend/tests/emailAlertAdapter.test.ts` -- test tương tự cho nhánh phục hồi Email (chỉ khi `previousDisplayState==='critical'`), cộng test guard `subType==='machine-offline'`.
- [x] `dashboard-backend/tests/channelState.test.ts` -- test `previousDisplayState` đúng giá trị trong `ChannelStateChange` phát ra qua `applyCandidate` (bao gồm lần đầu chốt, không có `previous` → `undefined`); test `handleHeartbeat` resume-sau-machine-offline gán đúng `previousDisplayState:'critical'` khi `record.committed.state==='ok'`.

**Acceptance Criteria:**
- Given kênh đang `warning`, cooldown warning đang chạy, when kênh phục hồi về `ok` (debounce ≥5s ổn định), then Telegram đội trực gửi tin phục hồi ngay lập tức, không bị chặn bởi cooldown.
- Given kênh đang `critical`, cooldown critical đang chạy, when kênh phục hồi về `ok`, then Telegram đội trực + Telegram lãnh đạo + Email đều gửi tin phục hồi ngay lập tức, không bị chặn bởi cooldown riêng từng kênh.
- Given kênh chuyển `warning`→`critical`, when `publishStateChange` kích hoạt, then không có nhánh phục hồi nào gửi; hành vi cảnh báo mới (Story 4.2/4.3) không đổi.
- Given `ack-label` đang hiển thị, when kênh phục hồi về `ok`, then `ack-label` tự biến mất theo cơ chế `clearAckIfAcknowledged` đã có (không cần code mới, xác nhận qua test hiện có không bị phá).
- Given kênh đang `machine-offline` (critical), khi heartbeat resume và `record.committed.state==='ok'`, then Telegram critical (đội trực+lãnh đạo) + Email đều gửi tin phục hồi ngay.
- Given `machineOfflineActive` vẫn `true` (heartbeat chưa resume) nhưng telemetry tự hồi phục về `ok` qua `applyCandidate`, when `change` publish kèm `subType:'machine-offline'`, then KHÔNG có nhánh phục hồi nào kích hoạt.

### Review Findings

- [x] [Review][Defer] Nhánh phục hồi bypass cooldown hoàn toàn không có anti-flood/dedup nào — flapping có thể gây spam tin phục hồi hoặc gửi "phục hồi" cho 1 cảnh báo chưa từng thật sự gửi — Chi tiết: (a) `channelState.ts:339-356` (`handleHeartbeat`): nếu heartbeat timeout/resume lặp lại nhiều lần liên tiếp trong khi `record.committed.state` vẫn `'ok'`, mỗi lần resume publish lại `previousDisplayState:'critical'` vô điều kiện, kích hoạt gửi phục hồi KHÔNG giới hạn (mở rộng pattern pre-existing Story 2.7 "re-publish mỗi lần resume", nhưng giờ mỗi lần đó kèm gửi Telegram/Email thật thay vì chỉ đổi UI); (b) `telegramAlertAdapter.ts:133`, `emailAlertAdapter.ts:156`: kênh flap `critical`<->`ok` nhanh hơn cooldown 60s khiến cảnh báo critical gốc bị cooldown chặn (không gửi), nhưng nhánh phục hồi vẫn gửi ngay do bypass cooldown tuyệt đối — audience nhận "đã phục hồi" cho 1 sự cố họ chưa từng được báo. Hành vi này đúng như spec yêu cầu ("gửi NGAY, bỏ qua HOÀN TOÀN cooldown Map") — deferred theo quyết định người dùng (2026-09-23): pilot quy mô nhỏ, chấp nhận rủi ro. Theo dõi lại nếu pilot thực tế gặp đúng kịch bản flapping này.
- [x] [Review][Patch] `dashboard-backend/README.md` chưa tài liệu hoá nhánh thông báo phục hồi mới (audience, bypass cooldown hoàn toàn, nội dung khác cảnh báo) [dashboard-backend/README.md] — đã thêm đoạn mô tả Story 4.4 vào phần giới thiệu
- [x] [Review][Patch] Test `'heartbeat resume sau machine-offline -> clear flag, re-publish record.committed hiện tại'` (nhánh resume về `warning`) chưa assert `previousDisplayState === undefined` trên `change` publish [dashboard-backend/tests/channelState.test.ts:490] — đã thêm assertion
- [x] [Review][Patch] Thiếu test cho tổ hợp `{displayState:'ok', subType:'machine-offline', previousDisplayState:'critical'}` mà `applyCandidate` thực sự phát ra khi telemetry tự hồi phục trong lúc machine-offline CHƯA resume — nếu 1 refactor tương lai thu hẹp điều kiện ép `subType:'machine-offline'` (vd loại trừ khi `candidate.state==='ok'`), guard `subType!=='machine-offline'` ở cả 2 adapter sẽ pass sai và gửi phục hồi giả, không test hiện có nào phát hiện được [dashboard-backend/src/core/channelState.ts:283-287] — đã thêm test mới, `npm test`: 260/261 pass (1 fail flaky pre-existing `installService.test.js`, không liên quan diff, xem epic-2-retro-item-13)
- [x] [Review][Defer] Nội dung tin Telegram/email phục hồi không nêu `subType`/thời lượng downtime của sự cố — khó đối chiếu đúng đợt nào vừa hồi phục khi nhiều sự cố xảy ra gần nhau [dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts:250, dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts:254] — deferred, vượt yêu cầu tối thiểu của spec (chỉ cần "khác rõ nội dung cảnh báo, nêu rõ đây là tin phục hồi")
- [x] [Review][Defer] Trùng lặp pattern nhánh phục hồi (guard 3 điều kiện + fire-and-forget/log/catch) giữa `TelegramAlertAdapter`/`EmailAlertAdapter` [telegramAlertAdapter.ts:122-136,213-232; emailAlertAdapter.ts:149-159,220-241] — deferred, pre-existing pattern mở rộng từ Story 4.2/4.3, không mới do 4.4 gây ra
- [x] [Review][Defer] Không có test end-to-end xác nhận `ChannelStateChange` nhánh phục hồi fan-out đúng qua `createCompositeAlertPort` tới cả 4 adapter thật (Email + 2 Telegram critical + Telegram warning) cùng lúc — deferred, pre-existing (cùng nhóm gap e2e đã defer ở review Story 2.7)
- [x] [Review][Defer] Guard `subType !== 'machine-offline'` lặp lại dạng string literal độc lập ở 2 adapter, không có hằng số/type guard dùng chung nối lại `AlertOutboundPort.ts`'s subType union [telegramAlertAdapter.ts:133, emailAlertAdapter.ts:156] — deferred, cải tiến type-safety nhỏ, không blocking
- [x] [Review][Defer] Không có bước xác minh credential SMTP/Telegram lúc khởi động — lỗi cấu hình chỉ lộ ra khi có sự kiện gửi thật (critical hoặc phục hồi) xảy ra — deferred, pre-existing, ngoài scope Story 4.4

## Design Notes

`ack-label` đã tự động biến mất đúng lúc qua `clearAckIfAcknowledged` (gọi tại mọi lần `applyCandidate` commit candidate mới, kể cả về `ok`) — cơ chế này độc lập hoàn toàn với `AlertOutboundPort`, không cần sửa gì cho Story 4.4, chỉ cần không phá vỡ khi thêm field mới.

`previousDisplayState` là field optional/additive trên `ChannelStateChange` — không phá test hiện có (TypeScript object literal thừa field optional vẫn hợp lệ; test cũ dùng `makeChange()` mặc định `undefined`, không khớp bất kỳ `previousDisplayState` nào nên không kích hoạt nhánh phục hồi mới).

`checkOneChannelHeartbeatTimeout` luôn publish `displayState:'critical'` (không bao giờ `'ok'`) nên không cần đụng. `handleHeartbeat`'s resume path THÌ CÓ phát `displayState==='ok'` khi `record.committed.state==='ok'` — review vòng 1 (3 layer đồng thuận) phát hiện giả định ban đầu ("cả 2 path không phát ok") sai; đã renegotiate với human, gán `previousDisplayState:'critical'` CỐ ĐỊNH (không phải `record.committed` cũ) vì đây là trạng thái mà audience thực sự đã nhận cảnh báo.

Guard `subType!=='machine-offline'` trên nhánh phục hồi ngăn báo phục hồi giả trong khoảng thời gian telemetry đã tự hồi phục nhưng heartbeat chưa xác nhận resume (dashboard vẫn hiển thị critical/machine-offline theo hợp đồng Story 2.7 hiện có).

## Spec Change Log

- 2026-09-22 (review vòng 1, intent_gap): 3 review layer (blind-hunter, edge-case-hunter, verification-gap) độc lập phát hiện cùng 1 gap: Never-constraint gốc "`checkOneChannelHeartbeatTimeout`/`handleHeartbeat` không phát `displayState==='ok'`" SAI — `handleHeartbeat`'s resume-sau-machine-offline re-publish (`channelState.ts:339-347`) publish `displayState: record.committed.state`, có thể là `'ok'`. Hậu quả: kịch bản phục hồi quan trọng nhất (máy trung tâm treo→sống lại) không bao giờ kích hoạt thông báo phục hồi. Verification-gap review phát hiện thêm 1 gap liên quan: nếu chỉ sửa vậy, telemetry tự hồi phục qua `applyCandidate` trong lúc `machineOfflineActive` vẫn `true` (heartbeat chưa resume) sẽ kích hoạt báo phục hồi GIẢ (dashboard vẫn hiển thị critical/machine-offline). Code đã revert về `baseline_commit`. Renegotiate với human (AskUserQuestion): (1) mở rộng scope xử lý `handleHeartbeat`, gán `previousDisplayState:'critical'` CỐ ĐỊNH (không phải `record.committed` cũ) khi resume và `record.committed.state==='ok'` — approved; (2) gate nhánh phục hồi bằng `subType!=='machine-offline'` — approved. Amend: Boundaries (Always/Never), I/O matrix (+2 dòng), Code Map, Tasks & Acceptance (+2 task, +2 AC, reset checkbox), Design Notes. KEEP: toàn bộ thiết kế nhánh phục hồi qua `applyCandidate` (warning/critical, bypass cooldown hoàn toàn, format message riêng) giữ nguyên không đổi — chỉ MỞ RỘNG thêm 1 call site (`handleHeartbeat`) và 1 điều kiện gate (`subType`).
- 2026-09-22 (review vòng 2, defer + patch): implement lại theo amend vòng 1, review lại từ đầu. blind-hunter + edge-case-hunter phát hiện 1 gap mới: `previousDisplayState` chỉ so khớp single-hop (state chốt NGAY TRƯỚC), nên chuỗi `critical→warning→ok` khiến audience critical không bao giờ nhận phục hồi; blind-hunter phát hiện thêm 1 gap hẹp: kênh chưa từng có `record.committed` khi rơi machine-offline cũng không nhận được phục hồi khi resume. verification-gap review xác nhận 2 fix của vòng 1 đã được test thật đầy đủ, không tìm thấy gap nào khác — "No verification gaps found." Renegotiate: người dùng chọn KHÔNG mở rộng scope thêm, DEFER cả 2 gap mới (ghi `deferred-work.md`, không sửa code, không đổi Boundaries/AC). Patch tự fix (không cần hỏi): làm rõ doc comment `previousDisplayState` trên `AlertOutboundPort.ts` — nêu rõ giá trị tại `handleHeartbeat` là hằng số cố định (không phải lịch sử `committed` thật) và giới hạn single-hop đã biết. `npm test`: 260/260 pass sau patch (1 fail flaky `installService.test.js` ở lần chạy đầu, pass lại ngay — xác nhận flake môi trường pre-existing, không liên quan diff, xem epic-2-retro-item-13). KEEP: toàn bộ code implement vòng 2 (single-hop `previousDisplayState`, guard `subType!=='machine-offline'`, `previousDisplayState:'critical'` cố định ở `handleHeartbeat`) giữ nguyên không đổi.

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- expected: pass toàn bộ, gồm test mới cho nhánh phục hồi ở cả Telegram (3 instance) và Email.

**Manual checks:**
- Giả lập 1 kênh chuyển `warning` rồi phục hồi `ok` trong vòng 60s (còn cooldown) → xác nhận Telegram đội trực nhận tin phục hồi ngay, `ack-label` (nếu có) biến mất.
- Giả lập 1 kênh chuyển `critical` rồi phục hồi `ok` trong vòng 60s → xác nhận cả 2 Telegram (đội trực, lãnh đạo) + Email đều nhận tin phục hồi ngay.
- Giả lập 1 kênh máy trung tâm treo (machine-offline) rồi heartbeat resume với telemetry đã ở `ok` → xác nhận cả 2 Telegram critical + Email đều nhận tin phục hồi ngay.

## Suggested Review Order

**Port contract — `previousDisplayState`**

- Entry point: field mới trên `ChannelStateChange`, kèm ghi chú giới hạn single-hop đã biết (round 2).
  [`AlertOutboundPort.ts:23`](../../dashboard-backend/src/ports/AlertOutboundPort.ts#L23)

**Domain core — 2 nơi gán `previousDisplayState`**

- `applyCandidate`: gán từ `record.committed` thật trước lần chốt này (single-hop).
  [`channelState.ts:281`](../../dashboard-backend/src/core/channelState.ts#L281)

- `handleHeartbeat` resume-sau-machine-offline: hằng số CỐ ĐỊNH `'critical'` — kết quả renegotiate review vòng 1 (audience luôn nhận machine-offline là critical, bất kể `record.committed` nội bộ).
  [`channelState.ts:352`](../../dashboard-backend/src/core/channelState.ts#L352)

**Nhánh phục hồi — Telegram**

- Điều kiện 3 phần (`displayState==='ok'` + `previousDisplayState` khớp + `subType!=='machine-offline'`) — guard cuối là kết quả renegotiate vòng 1.
  [`telegramAlertAdapter.ts:122`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L122)

- `sendRecoveryMessage`: fire-and-forget, KHÔNG đụng `lastSentAt` — bypass cooldown tuyệt đối, đúng tên story.
  [`telegramAlertAdapter.ts:213`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L213)

- `formatRecoveryMessage`: text riêng biệt hoàn toàn với cảnh báo.
  [`telegramAlertAdapter.ts:250`](../../dashboard-backend/src/adapters/outbound/telegramAlertAdapter.ts#L250)

**Nhánh phục hồi — Email**

- Điều kiện tương tự, `previousDisplayState==='critical'` cứng (audience Email chỉ phục vụ critical).
  [`emailAlertAdapter.ts:149`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L149)

- `sendRecoveryMail`: mirror pattern Telegram, bypass cooldown.
  [`emailAlertAdapter.ts:220`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L220)

- `formatRecoveryEmailBody`.
  [`emailAlertAdapter.ts:254`](../../dashboard-backend/src/adapters/outbound/emailAlertAdapter.ts#L254)

**Peripherals — tests**

- `previousDisplayState` đúng giá trị qua `applyCandidate` (lần đầu/chuyển state/tự phục hồi).
  [`channelState.test.ts:230`](../../dashboard-backend/tests/channelState.test.ts#L230)

- `handleHeartbeat` resume gán đúng `'critical'` CỐ ĐỊNH (fix review vòng 1).
  [`channelState.test.ts:529`](../../dashboard-backend/tests/channelState.test.ts#L529)

- Bypass-cooldown phục hồi + guard `subType==='machine-offline'` (fix review vòng 1) cho cả 2 instance Telegram.
  [`telegramAlertAdapter.test.ts:514`](../../dashboard-backend/tests/telegramAlertAdapter.test.ts#L514) · [`telegramAlertAdapter.test.ts:617`](../../dashboard-backend/tests/telegramAlertAdapter.test.ts#L617)

- Tương tự cho Email, cộng guard `previousDisplayState!=='critical'`.
  [`emailAlertAdapter.test.ts:287`](../../dashboard-backend/tests/emailAlertAdapter.test.ts#L287) · [`emailAlertAdapter.test.ts:337`](../../dashboard-backend/tests/emailAlertAdapter.test.ts#L337)

