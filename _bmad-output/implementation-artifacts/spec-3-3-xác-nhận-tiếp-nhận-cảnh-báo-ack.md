---
title: 'Story 3.3: Xác nhận tiếp nhận cảnh báo (Ack)'
type: 'feature'
created: '2026-09-12'
status: 'done'
baseline_commit: '31140111ec5c9b2e90abf60c2713f74e528c031b'
review_loop_iteration: 1
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi 1 kênh chuyển warning/critical, nhiều người trong đội trực có thể cùng thấy và gọi trùng đầu mối liên hệ vì không có cách nào biết đã có người khác tiếp nhận xử lý sự cố đó chưa.

**Approach:** Frontend gửi `ack-command` (envelope chung AD-25: `schema_version`, `channel_id`, `timestamp`, `event_type=ack-command`, `payload.operator_label`) qua WS UI hiện có (kênh MỚI, lần đầu `wsUiAdapter.ts` xử lý message TỪ client — ngoại lệ chiều ngược DUY NHẤT, chỉ frontend↔backend). Backend (`ChannelStateService`) lưu `acknowledged`+`ackLabel` trên chính channel state, broadcast `channel-ack-change` tới mọi client, tự xoá khi kênh chốt 1 trạng thái mới (phục hồi `ok` hoặc chuyển cảnh báo khác). Frontend: nút "Xác nhận đã tiếp nhận" + input tên tắt trong `detail-panel`; `channel-grid-cell` đổi border sang dashed + thêm `ack-label`, không đổi màu nền/viền/badge gốc.

## Boundaries & Constraints

**Always:**
- Envelope inbound `ack-command` đúng convention chung (Consistency Conventions) — KHÁC envelope snake_case `type` mà kênh WS UI này vẫn dùng cho outbound hiện có (`registry-snapshot`, `channel-state-change`, ...). `schema_version` KHÔNG cần validate giá trị (chưa validate ở `wsTelemetryAdapter.ts`, ngoài scope, giữ nhất quán).
- Validate `channel_id` qua registry TRƯỚC khi áp dụng ack (channel lạ → log `channel_unregistered`, bỏ qua — mirror `handleHeartbeat`).
- `acknowledged`/`ackLabel` lưu trên CHÍNH `ChannelRecord` hiện có (mirror `machineOfflineActive`), KHÔNG tạo Map riêng.
- Tự xoá ack ở MỌI điểm commit 1 candidate MỚI khác candidate đã chốt: trong `applyCandidate()` VÀ trong `checkOneChannelHeartbeatTimeout()` (machine-offline cũng là "chuyển cảnh báo mới") — publish `channel-ack-change(acknowledged=false)` nếu trước đó đang `true`.
- `publishAckChange` broadcast tới TẤT CẢ client WS UI (mirror `publishChannelSeen`/`publishHistoryPoint`, không riêng theo panel đang mở).
- Log audit `ack_command_applied` (AD-30): `channel_id`, `reason` chứa `operator_label`.
- `.acknowledged` (CSS) CHỈ override `border-style: dashed`, KHÔNG đụng `border-color`/`background` của class trạng thái (`ok`/`warning`/`critical`) hiện có.
- Text đúng nguyên văn: nút "Xác nhận đã tiếp nhận", nhãn "✓ Đã nhận: {operator_label}".
- Nút ack thao tác được bằng bàn phím (Tab + Enter/Space) — mirror `ChannelGridCell`'s `onKeyDown` pattern.
- Nút ack chỉ hiện/enable khi kênh đang `warning`/`critical` (đọc `channelDisplayStates`); backend KHÔNG áp thêm điều kiện này (chỉ validate registry, khớp AD-25) — phòng thủ ở tầng UI.

**Ask First:** Không phát sinh (không đổi wire format `BitrateHistoryPoint`/registry hiện có, không cần thư viện mới, không đụng kênh telemetry transport-core).

**Never:**
- Không thêm authentication cho WS UI (vẫn LAN-only, Story 2.3 đã chốt).
- Không có ack nhanh trên lưới tổng quan — nút ack CHỈ trong `detail-panel`.
- Không đổi mapping ok/warning/critical hay debounce 5s hiện có.
- Không giữ lịch sử ack lâu dài/append-only — chỉ 1 cờ hiện tại, tự xoá theo AC (audit trail bền vững đã ghi nhận là rủi ro chấp nhận ở review-security.md, ngoài scope MVP#1).
- Không xác thực identity operator ngoài nhập tay tên tắt (AD-25 `[ASSUMPTION]`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ack kênh đang warning/critical, registry hợp lệ | `ack-command` hợp lệ | `acknowledged=true`+`ackLabel` lưu; broadcast `channel-ack-change` tới mọi client; log `ack_command_applied` | N/A |
| Ack cho `channel_id` không có trong registry | `ack-command` với channel lạ | Bỏ qua, log `channel_unregistered` (mirror heartbeat) | Không throw |
| Kênh đang `acknowledged=true`, commit candidate mới khác (vd warning→critical, hoặc →ok) | `applyCandidate` chốt thay đổi | `acknowledged`/`ackLabel` bị xoá, broadcast `channel-ack-change(false)` | N/A |
| Kênh đang `acknowledged=true`, chuyển `machine-offline` | heartbeat timeout kích hoạt | `acknowledged`/`ackLabel` bị xoá, broadcast `channel-ack-change(false)` | N/A |
| Envelope `ack-command` hỏng (JSON lỗi/thiếu field) | raw message không hợp lệ | Bỏ qua, log lỗi (mirror `wsTelemetryAdapter.ts`'s `envelope_parse_error`/`envelope_invalid`) | Không throw/crash |
| Operator label rỗng/toàn khoảng trắng | Input rỗng lúc bấm nút | Nút disabled, không gửi `ack-command` | N/A |

</frozen-after-approval>

## Code Map

**Backend:**
- `dashboard-backend/src/ports/AckCommandPort.ts` -- MỚI, inbound port `handleAckCommand(channelId, operatorLabel, timestampMs)`, mirror `HeartbeatInboundPort.ts`.
- `dashboard-backend/src/ports/UiOutboundPort.ts:13-31` -- thêm `publishAckChange(channelId, acknowledged, ackLabel)`, mirror `publishHistoryPoint`.
- `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:34-45,56-59,261-340` -- thêm `ackCommandPort: AckCommandPort` vào `WsUiAdapterOptions`; connection handler thêm `ws.on('message', ...)` (dòng ~328, TRƯỚC `error`/`close`) parse envelope chung (mirror `wsTelemetryAdapter.ts:220-284`'s `handleMessage`) — **parse xong PHẢI gọi `operatorLabel.trim()` trước khi forward vào `ackCommandPort.handleAckCommand` (KHÔNG forward giá trị thô)**; **envelope_invalid thêm nhánh reject khi `operatorLabel.trim().length > 64`** (giới hạn hợp lý, mirror tinh thần validate lớp 2 hiện có); implement `publishAckChange` broadcast `channel-ack-change` (mirror `publishChannelSeen`); XOÁ comment stale dòng 323-327 (nhầm cho rằng ack-command đi qua `wsTelemetryAdapter.ts`).
  - **[Review round 1][bad_spec] Replay-on-connect cho ack-state (THIẾU ở lần implement trước — gap thật: client mới connect/reconnect không thấy ack đã có cho tới lần đổi ack tiếp theo, phá mục đích chống-gọi-trùng của cả tính năng):** thêm 1 cache `lastAckState: Map<string, { acknowledged: boolean; ackLabel: string | undefined }>` trong `wsUiAdapter.ts` — mirror ĐÚNG lifecycle của cache `lastState`/`lastSnapshot` hiện có cho `channel-state-change`/`channel-snapshot` (KHÔNG mirror `historyPort`'s direct-query pattern — `channelState.ts`'s `channels` Map không có port nào expose để query trực tiếp). `publishAckChange` cập nhật cache này TRƯỚC khi broadcast (mirror cách `publishStateChange`/snapshot cập nhật cache của chúng trước broadcast). Tại connect, SAU thứ tự replay hiện có (`registry-snapshot` → `channel-history-snapshot`/kênh → `channel-seen` → `channel-state-change` → `channel-snapshot`), thêm bước replay `channel-ack-change` cho MỌI channelId có trong `lastAckState` với `acknowledged===true` (bỏ qua entry `false` — không có gì để replay).
- `dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts:25-33,254-259,286-292,334-338` -- sửa các comment stale nhắc "ack-command" (đã route qua `wsUiAdapter.ts`, KHÔNG qua kênh này) — giữ nguyên `CLOSED_EVENT_TYPES`/hành vi bỏ qua (phòng thủ, không đổi logic).
- `dashboard-backend/src/core/channelState.ts:44-55,78,213-272,346-385` -- thêm `acknowledged?: boolean`/`ackLabel?: string` vào `ChannelRecord`; `class ChannelStateService implements ... , AckCommandPort`; method `handleAckCommand` mới (validate registry mirror `handleHeartbeat` dòng 282-289, set field, gọi `uiPort.publishAckChange`, log); private helper `clearAckIfAcknowledged(channelId, record)` gọi tại **3 điểm** (KHÔNG phải 2): trong `applyCandidate` (dòng 240-241, sau `record.committed = candidate`), trong `checkOneChannelHeartbeatTimeout` (dòng 367+, khi set `machineOfflineActive=true`), **VÀ trong `handleHeartbeat`'s nhánh recovery machine-offline (dòng ~296-321, ngay sau `record.machineOfflineActive = false`, TRƯỚC khi re-publish `record.committed`)** — **[Review round 1][patch] gap thật đã bỏ sót ở lần implement trước:** khi máy trung tâm phục hồi sau machine-offline, hiển thị trên UI đổi từ `critical`/`machine-offline` về lại `record.committed` thật (vd `warning`/`ok`) dù `record.committed` không đổi giá trị — đây VẪN là 1 lần "chuyển cảnh báo" theo góc nhìn người xem, ack phải biến mất theo đúng tinh thần AC2, nếu không ack-label kẹt vô thời hạn trên lưới dù kênh đã không còn ở đúng trạng thái lúc ack.
- `dashboard-backend/app/main.ts:278-317` -- circular-dependency: `wsUiAdapter` (dòng 287) khởi tạo TRƯỚC `channelStateService` (dòng 308) nhưng cần gọi vào nó — dùng 1 forwarder cục bộ implement `AckCommandPort` (giữ 1 biến `let` trỏ tới `channelStateService`, gán ngay sau dòng 308), truyền forwarder vào `startWsUiAdapter(...)` thay vì `channelStateService` trực tiếp.
- `dashboard-backend/tests/channelState.test.ts` -- mở rộng `FakeUiPort`/`ThrowingUiPort` (`publishAckChange`); test `handleAckCommand` (thành công/registry lạ) + auto-clear ở `applyCandidate`/`checkOneChannelHeartbeatTimeout`.
- `dashboard-backend/tests/wsUiAdapter.test.ts` -- test nhận `ack-command` từ client WS thật, forward đúng port (operatorLabel ĐÃ trim); broadcast `channel-ack-change`; envelope hỏng/operator_label rỗng-toàn-khoảng-trắng/quá 64 ký tự bị bỏ qua; **test replay `channel-ack-change` cho kênh đã acknowledged=true khi 1 client MỚI connect sau đó (nối tiếp thứ tự replay hiện có), và test KHÔNG replay gì khi chưa từng có ack nào**.
- `dashboard-backend/tests/main.test.ts` -- cập nhật wiring forwarder `AckCommandPort`.

**Frontend:**
- `dashboard-frontend/src/state/channelStore.ts:60-104,163-204` -- thêm `channelAck: ReadonlyMap<string, string>` vào `ChannelStoreState`+`EMPTY_STATE`; method `applyAckChange(channelId, ackLabel: string | null)` (set khi có giá trị, xoá khi `null`).
- `dashboard-frontend/src/services/uiWsClient.ts:12-268,295-370` -- parse `channel-ack-change` (mirror `isChannelStateChangeMessage`) gọi `store.applyAckChange`; đổi `connectUiWsClient` trả về `{ close, sendAckCommand }` (thay vì hàm cleanup thuần) — `sendAckCommand(channelId, operatorLabel)` build đúng envelope chung (`schema_version:1, channel_id, timestamp, event_type:'ack-command', payload:{operator_label}`), gửi qua `ws.send` nếu `readyState===OPEN`, no-op nếu không.
- `dashboard-frontend/src/components/DetailPanel.tsx:18,72-227` -- thêm prop `onAck?: (channelId, operatorLabel) => void`; đọc `state.channelDisplayStates.get(selectedChannelId)`/`state.channelAck.get(selectedChannelId)`; thêm `useState` cho input operator_label với `maxLength={64}` (khớp giới hạn backend); thêm block mới sau "Đầu mối liên hệ": input text + nút "Xác nhận đã tiếp nhận" (hiện khi displayState là `warning`/`critical`; disabled khi input rỗng/toàn khoảng trắng), `onClick` gọi `onAck(selectedChannelId, trimmedLabel)`.
- `dashboard-frontend/src/components/DetailPanel.module.css` -- thêm class cho input/nút ack mới (padding/radius/font theo token `body`/`rounded.md` hiện có trong file); class hiện trạng thái đã ack (`.ackStatus` hoặc tương đương) **PHẢI có `overflow-wrap: break-word; word-break: break-word;`** — mirror ĐÚNG rule đã áp dụng cho `.stationName`/`.contactName`/`.contactPhone` trong cùng file (**[Review round 1][patch]** thiếu ở lần implement trước — operator_label dài bất thường có thể tràn panel).
- `dashboard-frontend/src/components/ChannelGridCell.tsx:129-189,312-322` -- thêm prop `ackLabel?: string`; thêm `styles.acknowledged` vào `className` khi có `ackLabel`; render `<span>` ack-label cạnh `.badge` (góc khác, không đè lên) — **GATE render ack-label theo `loaded` (mirror cách `.channelName`/badge đã gate theo `loaded`/`effectiveDisplayState`, KHÔNG render khi `!loaded`) — [Review round 1][patch] thiếu ở lần implement trước, dù không reachable trong luồng UI bình thường hôm nay vẫn nên nhất quán với pattern gate hiện có của component.**
- `dashboard-frontend/src/components/ChannelGridCell.module.css` -- thêm `.acknowledged { border-style: dashed; }` (mirror cách `.skeleton` override border-style) + `.ackLabel` (vị trí góc trên-phải, `rounded.pill`, typography `body` 14px theo epic-3-context).
- `dashboard-frontend/src/components/ChannelGrid.tsx:13-97` -- thêm prop `channelAck: ReadonlyMap<string, string>`, forward `ackLabel={channelAck.get(channel.channelId)}`.
- `dashboard-frontend/app/page.tsx:28-87` -- lưu `sendAckCommand` từ `connectUiWsClient` qua `useRef`; truyền `channelAck={state.channelAck}` xuống `ChannelGrid`; truyền `onAck={(id, label) => sendAckCommandRef.current(id, label)}` xuống `DetailPanel`.
- `dashboard-frontend/tests/channelStore.test.ts`, `tests/uiWsClient.test.ts`, `tests/DetailPanel.test.tsx`, `tests/ChannelGridCell.test.tsx`, `tests/ChannelGrid.test.tsx`, `tests/page.test.tsx` -- test phần mở rộng tương ứng theo I/O matrix.

## Tasks & Acceptance

**Execution:**
- [x] `AckCommandPort.ts` -- MỚI -- hợp đồng inbound port cho core.
- [x] `UiOutboundPort.ts` -- thêm `publishAckChange` -- hợp đồng outbound broadcast.
- [x] `wsUiAdapter.ts` -- nhận `ackCommandPort`, xử lý message inbound (trim + giới hạn 64 ký tự `operator_label`), broadcast `channel-ack-change`, cache `lastAckState` + replay lúc connect, xoá comment stale -- điểm wiring WS UI duy nhất.
- [x] `wsTelemetryAdapter.ts` -- sửa comment stale về ack-command -- tránh hiểu nhầm định tuyến trong tương lai.
- [x] `channelState.ts` -- `acknowledged`/`ackLabel` + `handleAckCommand` + `clearAckIfAcknowledged` gọi ở ĐỦ 3 điểm commit (kể cả nhánh recovery machine-offline của `handleHeartbeat`) -- nguồn sự thật ack-state duy nhất.
- [x] `app/main.ts` -- forwarder giải quyết circular dependency -- production wiring thật.
- [x] `channelState.test.ts`, `wsUiAdapter.test.ts`, `main.test.ts` -- test backend theo I/O matrix + 3 fix mới (recovery auto-clear, trim, replay-on-connect).
- [x] `channelStore.ts` -- `channelAck` + `applyAckChange` -- state nền cho UI.
- [x] `uiWsClient.ts` -- parse `channel-ack-change` + `sendAckCommand` -- cầu nối WS hai chiều đầu tiên.
- [x] `DetailPanel.tsx` + `.module.css` -- nút + input ack (maxLength 64, overflow-wrap cho trạng thái đã ack) -- điểm nhập lệnh duy nhất.
- [x] `ChannelGridCell.tsx`, `.module.css`, `ChannelGrid.tsx` -- dashed border + ack-label (gate theo `loaded`) -- hiển thị trên lưới.
- [x] `app/page.tsx` -- wiring `sendAckCommand`/`channelAck`/`onAck` -- lắp vào cây UI thật.
- [x] Test frontend tương ứng theo I/O matrix + fix mới (maxLength, overflow-wrap, loaded-gate).

**Acceptance Criteria:**
- Given `detail-panel` của 1 kênh đang `warning`/`critical` đang mở, when tôi nhập tên tắt và bấm "Xác nhận đã tiếp nhận", then TẤT CẢ client dashboard-frontend đang mở thấy ô kênh đó đổi border sang dashed + hiện `ack-label`, KHÔNG đổi màu nền/viền gốc/badge.
- Given 1 kênh đang có `ack-label`, when kênh phục hồi `ok` HOẶC chuyển sang cảnh báo mới (vd warning→critical), then `ack-label` tự biến mất ở mọi client, KHÔNG cần thao tác gì thêm.
- Given nút ack chỉ tồn tại trong `detail-panel`, when tôi nhìn lưới tổng quan, then không có cách nào ack trực tiếp từ ô kênh.

### Review Findings

- [x] [Review][Patch] Ack state không tự sửa khi 1 client WS UI reconnect đúng lúc backend đã auto-clear ack (vi phạm AC2 cho client đó) — backend's replay-on-connect chỉ gửi lại `channel-ack-change` cho entry `acknowledged===true` (bỏ qua `false`), và frontend không reset `channelAck` ở mỗi lần connect mới (`applyRegistrySnapshot` chỉ ghi đè `channels`). 1 client rớt WS UI (network blip, fixed 2s retry) đúng lúc backend tự xoá ack (đổi trạng thái/machine-offline/phục hồi) sẽ KHÔNG nhận được tín hiệu "acknowledged=false" nào khi reconnect, tiếp tục hiện "✓ Đã nhận"/viền dashed cũ cho tới khi có 1 sự kiện ack khác đúng kênh đó phát sinh trong lúc nó đang mở kết nối — khác kịch bản "backend restart mất cache" đã defer từ Story 2.7 (đây là backend VẪN sống bình thường, tần suất cao hơn nhiều). **Fixed:** reset `channelAck` trong `channelStore.applyRegistrySnapshot()` (message luôn tới đầu tiên mỗi lần connect/reconnect) trước khi luồng replay `acknowledged===true` điền lại đúng dữ liệu hiện tại; test mới `channelStore.test.ts`'s "applyRegistrySnapshot (mô phỏng reconnect) -> reset channelAck về rỗng". [`dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:503`, `dashboard-frontend/src/state/channelStore.ts:149`, `dashboard-frontend/src/services/uiWsClient.ts:380-425`]
- [x] [Review][Patch] Log `envelope_invalid` ghi sai lý do "thiếu channel_id" khi channel_id có mặt nhưng sai kiểu — `envelopeChannelId = typeof envelope.channel_id === 'string' ? envelope.channel_id : ''` gộp chung case "thiếu" và "sai kiểu" nhưng log cứng "thiếu channel_id" (nhánh `operator_label` liền kề diễn đạt đúng hơn "thiếu/không hợp lệ"); không có test cho case sai kiểu. **Fixed:** đổi message thành "thiếu/không hợp lệ channel_id"; test mới `wsUiAdapter.test.ts`'s "ack-command envelope có channel_id sai kiểu (number)". [`dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:278`]
- [x] [Review][Defer] `checkOneChannelHeartbeatTimeout` không xoá ack khi kênh bị gỡ khỏi channel-registry (hot-reload) lúc đang `acknowledged=true` [`dashboard-backend/src/core/channelState.ts:374`] — deferred, pre-existing (đối xứng hành vi "đóng băng" sẵn có của `committed`/`machineOfflineActive`/`lastHeartbeatAt` khi channel bị gỡ registry, đã tracked nhiều lần từ Story 2.2/2.3/2.6/2.7; ngoài phạm vi 3 điểm auto-clear của Boundaries story 3.3)

## Spec Change Log

- 2026-09-12: Implemented toàn bộ Tasks & Acceptance (backend: `AckCommandPort` mới, `UiOutboundPort.publishAckChange`, `wsUiAdapter.ts` message inbound đầu tiên + broadcast, `wsTelemetryAdapter.ts` sửa comment stale, `channelState.ts` handleAckCommand + auto-clear ở `applyCandidate`/`checkOneChannelHeartbeatTimeout`, `main.ts` forwarder giải quyết circular dependency; frontend: `channelStore.ts` channelAck/applyAckChange, `uiWsClient.ts` parse channel-ack-change + sendAckCommand, `DetailPanel.tsx`/`.module.css` nút+input ack, `ChannelGridCell.tsx`/`.module.css`/`ChannelGrid.tsx` dashed border+ack-label, `app/page.tsx` wiring). Backend 172/173 test pass (`npm run build && node --test`) — 1 fail `installService.test.js` xác nhận pre-existing (IPC deserialize lỗi, tái hiện y hệt trên baseline commit trước khi có thay đổi story này, đã tracked ở `epic-2-retro-item-13`). Frontend 220/220 test pass (`npm test`), `npx tsc --noEmit` sạch, `next build` sạch. Không có Ask First nào phát sinh trong lúc implement.

- 2026-09-12 (review round 1 — bad_spec loopback, code đã revert về baseline_commit): 3 review layer song song (blind-hunter/edge-case-hunter/verification-gap) phát hiện 1 `bad_spec` (root cause ngoài `<frozen-after-approval>`, nằm ở Code Map thiếu cơ chế replay) + 5 `patch` gộp chung vào lần re-derive này để tránh làm 2 lần:
  1. **[bad_spec] Thiếu replay `channel-ack-change` khi client WS UI connect/reconnect** — client mới mở dashboard hoặc vừa reconnect sẽ KHÔNG thấy ack đã có cho tới khi có thay đổi ack tiếp theo, phá đúng mục đích cốt lõi của tính năng (tránh gọi trùng đầu mối liên hệ) cho bất kỳ ai không có mặt tại thời điểm ack. Trạng thái sai đã tránh: dashboard mất đồng bộ ack-state giữa các client, y hệt lý do `channel-seen`/`channel-state-change`/`channel-snapshot` đã có cơ chế replay-on-connect từ trước. Code Map đã bổ sung: cache `lastAckState` trong `wsUiAdapter.ts` (mirror `lastState`/`lastSnapshot`), replay sau `channel-snapshot` trong thứ tự connect hiện có.
  2. **[patch] `clearAckIfAcknowledged` thiếu ở nhánh recovery machine-offline của `handleHeartbeat`** — ack-label kẹt vô thời hạn sau khi máy trung tâm phục hồi dù hiển thị đã đổi khỏi critical/machine-offline. Đã thêm vào Code Map: gọi helper này ở điểm thứ 3 (tổng cộng 3 điểm, không phải 2).
  3. **[patch] `operatorLabel` chưa được `.trim()` trước khi forward vào port** dù đã validate theo bản trim — nhãn thừa khoảng trắng vẫn lưu/broadcast nếu 1 client WS UI khác (không phải dashboard-frontend) bỏ qua bước trim của UI.
  4. **[patch] Chưa giới hạn độ dài `operator_label`** ở cả 2 tầng — thêm cap 64 ký tự (`envelope_invalid` nếu vượt, `maxLength={64}` trên input).
  5. **[patch] `.ackStatus`/class hiện trạng thái đã ack thiếu `overflow-wrap`/`word-break`** — mirror rule đã có cho `.stationName`/`.contactName`/`.contactPhone` cùng file.
  6. **[patch] Ack-label ở `ChannelGridCell` chưa gate theo `loaded`** — mirror cách `.channelName`/badge đã gate, nhất quán pattern component dù chưa reachable trong luồng bình thường.

  **Reject/defer (không gộp vào lần re-derive — không ảnh hưởng code):** thiếu debounce nút ack, không nhớ tên tắt giữa các lần ack, không hỗ trợ Enter-submit, rủi ro log string với ký tự đặc biệt (mirror convention `reason` string hiện có toàn hệ thống, không riêng story này), thiếu `source` field ở 1-2 log call site mới (mirror đúng pattern `channelState.ts`'s log hiện có, không phải thiếu sót) → reject (noise/không chính xác/ngoài scope). Thiếu aria-live cho ack-label (a11y đầy đủ đã chốt dời sang Epic 5 theo epic-3-context.md, đúng tiền lệ Story 3.2) và ack-state chỉ in-memory/mất khi restart (đặc điểm toàn hệ thống, không riêng ack) → defer, ghi vào `deferred-work.md`.

  **KEEP instructions (giữ nguyên khi re-derive, đã đúng từ lần implement trước):** toàn bộ kiến trúc port (`AckCommandPort`, `UiOutboundPort.publishAckChange`), envelope parsing trong `wsUiAdapter.ts` (mirror `wsTelemetryAdapter.ts`'s `handleMessage`, kể cả `rawDataToString` helper), forwarder giải quyết circular-dependency ở `main.ts` (`ackCommandForwarder`/biến `let` gán sau khi `channelStateService` khởi tạo), toàn bộ UX frontend (input+nút trong `DetailPanel.tsx`, disabled khi rỗng, reset khi đổi kênh, hiện trạng thái đã ack), `.acknowledged`/ack-label trong `ChannelGridCell.tsx` (chỉ override border-style, không đổi màu), toàn bộ cấu trúc test hiện có (mirror pattern Fake port, test tích hợp WS thật) — chỉ MỞ RỘNG theo 6 điểm trên, không viết lại từ đầu.

- 2026-09-12 (implement từ baseline_commit, gộp đủ 6 điểm review round 1): Implemented toàn bộ Tasks & Acceptance. Backend: `AckCommandPort.ts` mới; `UiOutboundPort.publishAckChange`; `wsUiAdapter.ts` thêm `ackCommandPort` option, `ws.on('message', ...)` parse envelope `ack-command` (mirror `wsTelemetryAdapter.ts`'s `handleMessage`, thu hẹp cho 1 event_type), trim + cap 64 ký tự trước khi forward, cache `lastAckState` + replay `channel-ack-change` (chỉ entry `acknowledged===true`) NGAY SAU `channel-snapshot` replay, xoá comment stale; `wsTelemetryAdapter.ts` sửa comment stale về định tuyến `ack-command`; `channelState.ts` thêm `acknowledged`/`ackLabel` trên `ChannelRecord`, `handleAckCommand` (validate registry, KHÔNG check warning/critical), `clearAckIfAcknowledged` helper gọi ở ĐỦ 3 điểm (`applyCandidate`, `checkOneChannelHeartbeatTimeout`, `handleHeartbeat`'s nhánh recovery machine-offline); `app/main.ts` forwarder `ackCommandForwarder` (biến `let ackCommandTarget`, gán sau khi `channelStateService` khởi tạo) giải quyết circular-dependency. Frontend: `channelStore.ts` thêm `channelAck`/`applyAckChange`; `uiWsClient.ts` parse `channel-ack-change` + `sendAckCommand`, `connectUiWsClient` đổi trả về `{ close, sendAckCommand }`; `DetailPanel.tsx`/`.module.css` thêm block ack (input maxLength=64, nút "Xác nhận đã tiếp nhận" disabled khi rỗng/toàn khoảng trắng, `.ackStatus` overflow-wrap, reset input khi đổi kênh, hiện CHỈ khi displayState warning/critical); `ChannelGridCell.tsx`/`.module.css` thêm `ackLabel` prop, `.acknowledged` (chỉ border-style), `ack-label` góc trên-phải gate theo `loaded`; `ChannelGrid.tsx` forward `channelAck`; `app/page.tsx` wiring `sendAckCommand` qua `useRef` + `channelAck`/`onAck`. Backend 186/186 test pass (`npm run build && node --test "dist/tests/**/*.test.js"`, gồm 33 test mới cho ack-command/publishAckChange/replay/wiring forwarder qua `startApp()` thật). Frontend 218/218 test pass (`npm test`), `npx tsc --noEmit` sạch, `npx next build` sạch. Không có Ask First nào phát sinh trong lúc implement.
  Rủi ro đã biết, chưa xử lý (nằm ngoài I/O matrix hiện có, không tự ý mở rộng scope): backend KHÔNG reject `operator_label` rỗng/toàn khoảng trắng sau `.trim()` (chỉ frontend disable nút) - 1 client WS UI khác (không phải dashboard-frontend) gửi thẳng `payload.operator_label: "   "` sẽ khiến `ackLabel=""` được lưu/broadcast, hiện `"✓ Đã nhận: "` trống tên trên UI. I/O matrix hiện có chỉ định nghĩa hành vi này ở tầng frontend ("Nút disabled, không gửi ack-command"), không có dòng nào yêu cầu validate lại ở backend - cờ lên để nhân sự xem xét có cần bổ sung guard lớp 2 hay chấp nhận rủi ro.

- 2026-09-12 (review round 2 — 3 review layer song song: blind-hunter/edge-case-hunter/verification-gap trên diff đầy đủ so với `baseline_commit`): 0 `intent_gap`, 0 `bad_spec`. 1 `patch` áp dụng ngay (không loopback):
  - **[patch] `wsUiAdapter.ts`'s `handleAckMessage` thiếu nhánh reject cho `operator_label` rỗng/toàn khoảng trắng sau `.trim()`** — 2/3 review layer (edge-case-hunter, verification-gap) độc lập nêu lại đúng rủi ro mà implementer round trước đã tự flag nhưng chưa xử lý ("nằm ngoài I/O matrix hiện có"): 1 client WS UI khác dashboard-frontend gửi thẳng `payload.operator_label: "   "` sẽ khiến `ackLabel=""` được lưu/broadcast, hiện `"✓ Đã nhận: "` trống tên. Đã thêm nhánh reject qua `envelope_invalid` khi `operatorLabel.length === 0` (mirror ĐÚNG nhánh `>64 ký tự` liền kề) TRƯỚC nhánh giới hạn 64 ký tự — không đổi hành vi frontend (nút đã disable từ trước, nhánh này chỉ phòng thủ non-standard client). Test mới: `dashboard-backend/tests/wsUiAdapter.test.ts`'s "payload.operator_label TOÀN khoảng trắng (rỗng sau trim) -> bỏ qua, log envelope_invalid, KHÔNG forward". Backend 187/187 test pass sau patch (`npm run build && node --test`).
  - Còn lại (reject, không phải noise ngẫu nhiên mà đã cân nhắc từng điểm): thiếu response trực tiếp cho sender khi channel_unregistered/lỗi (mirror `handleHeartbeat`, đã có feedback gián tiếp qua chính `channel-ack-change` broadcast cho ack thành công); log `reason` chứa `operator_label` không escape (mirror convention `reason` string toàn hệ thống, đã reject y hệt ở review round 1); race window giữa `startWsUiAdapter` và gán `channelStateService` vào forwarder ở `main.ts` (xác nhận KHÔNG có `await` nào xen giữa 2 dòng — không có cửa sổ race thật, JS single-threaded); `ChannelAckChangeMessage`/`applyUiWsMessage` cho phép tổ hợp lý thuyết `acknowledged=true`+`ack_label=undefined` (KHÔNG có caller thật nào tạo ra tổ hợp này — `handleAckCommand` luôn truyền label thật, `clearAckIfAcknowledged` luôn `false`/`undefined`); `checkOneChannelHeartbeatTimeout` "NaN nếu chưa từng heartbeat" (SAI — dòng `if (record.lastHeartbeatAt === undefined) return;` đã guard từ Story 2.7, review edge-case-hunter nêu sai); trùng lặp hằng số `MAX_OPERATOR_LABEL_LENGTH=64`/chuỗi UI "✓ Đã nhận: " giữa FE-BE và giữa 2 component FE (cosmetic, không có shared-module convention sẵn có giữa 2 package); thiếu debounce nút/Enter-submit/rate-limit kênh ack-command (đã reject y hệt ở review round 1, LAN-only/no-auth đã chốt từ Story 2.3) → tất cả reject.
  - `AckCommandPort.ts` bị blind-hunter báo "thiếu, chỉ import không định nghĩa" — false positive do lệnh `git diff` dùng để tạo `{diff_output}` không show file MỚI chưa `git add`; đã xác nhận file tồn tại đúng nội dung trên đĩa, biên dịch sạch.

- 2026-09-12 (review round 3 — orchestrator-run độc lập, 3 review layer song song mới trên diff đầy đủ so với `baseline_commit`, KHÔNG dựa vào self-review round 2 của implementer ở trên): 0 `intent_gap`, 0 `bad_spec`. 1 `patch` áp dụng ngay (không loopback):
  - **[patch] `DetailPanel.tsx`'s trạng thái "✓ Đã nhận: {label}" bị gộp chung 1 gate `showAckControls` (warning/critical) với nút/input ack MỚI** — bug thật: `channelState.ts`'s `handleAckCommand` CỐ Ý không kiểm tra displayState trước khi áp dụng ack (Design Notes đã ghi rõ), và `ChannelGridCell`'s ack-label vốn đã hiện độc lập `effectiveDisplayState` — nhưng `DetailPanel` lại ẩn CẢ dòng trạng thái "đã ack" khi kênh không phải warning/critical, mâu thuẫn với chính 2 điểm trên. Phát hiện bởi verification-gap + edge-case-hunter độc lập (2/3 layer). Đã tách 2 điều kiện: dòng trạng thái ack hiện bất cứ khi nào có `ackLabel` (không phụ thuộc `showAckControls`); CHỈ nút+input ack MỚI mới gate theo warning/critical. Test mới: `DetailPanel.test.tsx`'s 2 case (`displayState='ok'` + chưa từng có displayState) xác nhận "✓ Đã nhận" vẫn hiện, nút/input vẫn ẩn đúng. Frontend 220/220 test pass sau patch (`npm test`), `npx tsc --noEmit` sạch, `next build` sạch.
  - Còn lại (reject, đã cân nhắc từng điểm): thiếu `source`/connection id ở audit log `ack_command_applied` (mirror đúng pattern `channelState.ts`'s log hiện có — không có field này ở BẤT KỲ log nào của file đó, không phải thiếu sót riêng ack); forwarder's nhánh "not ready" (race khởi động) không có test riêng (race lý thuyết, không xảy ra thực tế vì không có `await` nào xen giữa lúc khởi tạo, đã xác nhận ở round 2); thiếu rate-limit/throttle cho message inbound mới trên kênh WS UI (rủi ro kiến trúc ĐÃ được ghi nhận và chấp nhận ở `review-security.md` khi thiết kế AD-25/AD-13 — không phải gap mới của story này); input không tự clear sau khi ack thành công, không hỗ trợ Enter-submit, không có UI feedback khi gửi thất bại do mất kết nối (đều là UX nicety, đã reject cùng nhóm ở review round 1); `.trim()` không gộp khoảng trắng nội bộ/ký tự control (nitpick, rủi ro thấp cho tool nội bộ tin cậy); `timestampMs` dùng `Date.now()` thay vì parse `envelope.timestamp` gửi từ client (xác nhận đây là quyết định nhất quán, `AckCommandPort.ts`'s doc comment đã cập nhật khớp đúng "epoch ms tại thời điểm adapter nhận envelope", không phải bug); thiếu test cho `payload` hoàn toàn absent (chỉ test `payload:{}`, hành vi giống hệt, giá trị thấp); `styles.acknowledged ?? ''` fallback im lặng (mirror pattern `?? ''` đã dùng khắp `ChannelGridCell.tsx` do `noUncheckedIndexedAccess`, không phải rủi ro mới); độ dài đếm theo UTF-16 code unit thay vì grapheme cluster (nitpick, không đáng làm cho tên tắt tiếng Việt thực tế); thiếu aria-live (đã defer trùng lặp ở round 1); input không reset khi rời rồi quay lại đúng kênh cũ mà không đổi `selectedChannelId` (edge-case-hunter, UX nitpick low-severity, cùng nhóm với "input không nhớ giữa các lần ack" đã reject ở round 1); 1 finding về git working tree "vẫn đang dirty 4 file" xác nhận SAI/stale (đã verify `git status --short` sạch tại thời điểm review) → reject.
  - `MAX_OPERATOR_LABEL_LENGTH` trùng lặp 2 nơi (đã nêu ở round 2) → giữ nguyên phân loại defer, đã ghi bổ sung 1 entry `deferred-work.md` cho vòng review này (không trùng vì evidence khác: blind-hunter round 2 vs blind-hunter round 3 độc lập xác nhận lại).

- 2026-09-12 (code review round 4 — `/bmad-code-review`, 4 lớp song song trên diff đầy đủ so với `baseline_commit`, độc lập với 3 vòng review trước): 0 `decision_needed`. 2 `patch` áp dụng ngay:
  - **[patch] Ack state không tự sửa khi 1 client WS UI reconnect đúng lúc backend đã auto-clear ack** — bug thật do blind-hunter phát hiện: backend's replay-on-connect (round 1) chỉ gửi lại entry `acknowledged===true`, KHÔNG bao giờ gửi `false`; frontend không reset `channelAck` ở mỗi lần connect mới. 1 client rớt WS UI đúng lúc ack bị auto-clear ở backend sẽ giữ mãi ack-label cũ sau reconnect (vi phạm AC2 cho đúng client đó). Đã fix: `channelStore.applyRegistrySnapshot()` reset `channelAck` về rỗng (message này luôn tới đầu tiên mỗi lần connect/reconnect, đúng ngữ nghĩa "snapshot"). Test mới: `channelStore.test.ts`.
  - **[patch] Log `envelope_invalid` ghi sai "thiếu channel_id" khi field có mặt nhưng sai kiểu** — nitpick từ blind-hunter, đã sửa message + thêm test `wsUiAdapter.test.ts`.
  - 1 `defer` (không patch): `checkOneChannelHeartbeatTimeout` không xoá ack khi kênh bị gỡ khỏi registry lúc đang acknowledged=true (edge-case-hunter) — pre-existing/ngoài scope, ghi vào `deferred-work.md`.
  - 10 finding dismiss (đã cân nhắc, không phải noise ngẫu nhiên): type-looseness ack_label+acknowledged không có caller thật; double-click gửi ack trùng (idempotent, đã reject round 1/3); trùng lặp envelope-parsing/`rawDataToString` giữa 2 adapter (quyết định KEEP tường minh round 1); trùng hằng số `MAX_OPERATOR_LABEL_LENGTH` FE/BE (đã reject round 2); input không tự clear sau ack (đã reject round 1); thiếu feedback khi gửi lỗi lúc mất kết nối (đã reject round 3); audit log thiếu network origin (đã reject round 3); core không validate lại nội dung operatorLabel (quyết định kiến trúc tường minh ở Design Notes); thiếu sanitize nội dung tự do (rủi ro đã chấp nhận LAN-only); thiếu test tổ hợp ack-status+showAckControls (đã verify qua code, không có bug tương tác).
  - Backend 181/181 test pass sau patch (`npm run build && node --test "dist/tests/**/*.test.js"`; 1 fail pre-existing `installService.test.js` không liên quan, tracked `epic-2-retro-item-13`). Frontend 221/221 test pass (`npm test`), `npx tsc --noEmit` sạch, `npx next build` sạch.

## Design Notes

- Circular dependency ở `main.ts`: `wsUiAdapter` cần tồn tại TRƯỚC `channelStateService` (vì `channelStateService` cần `uiPort`), nhưng `wsUiAdapter` giờ cũng cần gọi VÀO `channelStateService` (ackCommandPort). Giải quyết bằng 1 forwarder cục bộ (biến `let` trỏ tới instance thật, gán ngay sau khi `channelStateService` khởi tạo) — không có pattern có sẵn để copy y hệt trong codebase, đây là port inbound ĐẦU TIÊN có caller là `wsUiAdapter.ts` thay vì `wsTelemetryAdapter.ts`.
- `handleAckCommand` KHÔNG kiểm tra kênh có đang `warning`/`critical` hay không trước khi áp dụng ack (chỉ validate registry, khớp đúng phạm vi AD-25) — tầng UI (nút disabled khi không phải warning/critical) là nơi enforce đúng AC's "Given", tránh over-engineer 1 rule không được kiến trúc yêu cầu.
- **Replay-on-connect (review round 1):** `lastAckState` là cache THUẦN cho mục đích replay (mirror `lastState`/`lastSnapshot`), KHÔNG phải nguồn sự thật — `channelState.ts`'s `ChannelRecord.acknowledged`/`ackLabel` vẫn là nguồn sự thật DUY NHẤT (AD-11). Cache này có thể tạm thời lệch nếu `publishAckChange` throw SAU khi đã cập nhật cache nhưng TRƯỚC khi broadcast thành công tới 1 client cụ thể — chấp nhận được vì lần commit trạng thái tiếp theo (hoặc ack tiếp theo) sẽ tự sửa qua broadcast mới, không có core nào đọc lại cache này.

## Verification

**Commands:**
- `cd dashboard-backend && npm run build && node --test "dist/tests/**/*.test.js"` -- expected: toàn bộ test pass.
- `cd dashboard-frontend && npm test` -- expected: toàn bộ test pass, gồm test ack mới.
- `cd dashboard-frontend && npx tsc --noEmit && npx next build` -- expected: sạch, không lỗi type/build.

**Manual checks (if no CLI):**
- Mở 2 tab dashboard-frontend, ack 1 kênh warning/critical ở tab 1, xác nhận tab 2 cũng thấy `ack-label` ngay (broadcast, không riêng theo tab đang mở panel).

## Suggested Review Order

**Port contracts (hexagonal boundary mới)**

- Inbound port mới cho `ack-command` — hợp đồng core nhận ack, mirror `HeartbeatInboundPort`.
  [`AckCommandPort.ts:25`](../../dashboard-backend/src/ports/AckCommandPort.ts#L25)

- Outbound port thêm `publishAckChange` — hợp đồng broadcast ack-state tới mọi client.
  [`UiOutboundPort.ts:42`](../../dashboard-backend/src/ports/UiOutboundPort.ts#L42)

**Inbound message parsing & validation (điểm mới nhất: WS UI lần đầu nhận message từ client)**

- `handleAckMessage` — parse envelope `ack-command`, entry point của luồng inbound hoàn toàn mới này.
  [`wsUiAdapter.ts:259`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L259)

- Patch review round 2: reject `operator_label` rỗng/toàn khoảng trắng sau `trim()` (validate lớp 2, mirror nhánh 64 ký tự).
  [`wsUiAdapter.ts:328`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L328)

**Core ack-state ownership & auto-clear (nguồn sự thật duy nhất)**

- `handleAckCommand` — validate registry rồi chốt `acknowledged`/`ackLabel` trên `ChannelRecord` hiện có.
  [`channelState.ts:414`](../../dashboard-backend/src/core/channelState.ts#L414)

- `clearAckIfAcknowledged` — helper dùng chung, xoá ack khi kênh chốt 1 candidate mới.
  [`channelState.ts:465`](../../dashboard-backend/src/core/channelState.ts#L465)

- Điểm gọi #1: `applyCandidate` chốt candidate mới (kể cả phục hồi `ok`).
  [`channelState.ts:253`](../../dashboard-backend/src/core/channelState.ts#L253)

- Điểm gọi #2: `handleHeartbeat`'s nhánh recovery machine-offline — review round 1 phát hiện thiếu, đã vá.
  [`channelState.ts:317`](../../dashboard-backend/src/core/channelState.ts#L317)

- Điểm gọi #3: `checkOneChannelHeartbeatTimeout` khi kích hoạt machine-offline.
  [`channelState.ts:390`](../../dashboard-backend/src/core/channelState.ts#L390)

**Replay-on-connect (review round 1 [bad_spec] — gap cốt lõi đã vá)**

- Cache `lastAckState` — nguồn replay THUẦN (không phải nguồn sự thật), mirror `lastState`/`lastSnapshot`.
  [`wsUiAdapter.ts:401`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L401)

- Replay `channel-ack-change` cho client connect muộn, NGAY SAU `channel-snapshot` replay.
  [`wsUiAdapter.ts:503`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L503)

**Wiring & circular-dependency (production composition root)**

- Forwarder `AckCommandPort` giải quyết circular-dependency — `wsUiAdapter` cần tồn tại trước `channelStateService`.
  [`main.ts:291`](../../dashboard-backend/app/main.ts#L291)

- Gán forwarder vào instance thật ngay sau khi `channelStateService` khởi tạo xong.
  [`main.ts:358`](../../dashboard-backend/app/main.ts#L358)

**Frontend: state & WS bridge hai chiều đầu tiên**

- `channelAck`/`applyAckChange` — state nền cho UI, set/xoá theo `ackLabel`.
  [`channelStore.ts:309`](../../dashboard-frontend/src/state/channelStore.ts#L309)

- Parse `channel-ack-change` từ server, gọi `store.applyAckChange`.
  [`uiWsClient.ts:297`](../../dashboard-frontend/src/services/uiWsClient.ts#L297)

- `sendAckCommand` — cầu nối WS hai chiều đầu tiên, build đúng envelope chung AD-25.
  [`uiWsClient.ts:438`](../../dashboard-frontend/src/services/uiWsClient.ts#L438)

**Frontend: điểm nhập lệnh (detail-panel)**

- Review round 3 patch: trạng thái "đã ack" hiện độc lập `showAckControls` — chỉ nút/input ack MỚI mới gate theo warning/critical.
  [`DetailPanel.tsx:264`](../../dashboard-frontend/src/components/DetailPanel.tsx#L264)

- Nút + input ack MỚI, disabled khi rỗng/toàn khoảng trắng.
  [`DetailPanel.tsx:277`](../../dashboard-frontend/src/components/DetailPanel.tsx#L277)

- `.ackStatus` — overflow-wrap/word-break (review round 1 patch), tránh tràn panel với label dài.
  [`DetailPanel.module.css:182`](../../dashboard-frontend/src/components/DetailPanel.module.css#L182)

**Frontend: hiển thị trên lưới tổng quan**

- `showAck` gate theo `loaded` (review round 1 patch) — dashed border + ack-label góc trên-phải.
  [`ChannelGridCell.tsx:190`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L190)

- Wiring `channelAck`/`onAck`/`sendAckCommand` từ store xuống cây UI thật.
  [`page.tsx:90`](../../dashboard-frontend/app/page.tsx#L90)

**Dọn dẹp (không đổi hành vi)**

- Sửa comment stale nhắc nhầm "ack-command" đi qua kênh WS telemetry.
  [`wsTelemetryAdapter.ts:87`](../../dashboard-backend/src/adapters/inbound/wsTelemetryAdapter.ts#L87)

**Tests**

- `dashboard-backend/tests/channelState.test.ts`, `wsUiAdapter.test.ts`, `main.test.ts` — theo I/O matrix + 3 fix review round 1 + 1 patch review round 2.
- `dashboard-frontend/tests/channelStore.test.ts`, `uiWsClient.test.ts`, `DetailPanel.test.tsx`, `ChannelGridCell.test.tsx`, `ChannelGrid.test.tsx`, `page.test.tsx` — theo I/O matrix + fix maxLength/overflow-wrap/loaded-gate + 2 case review round 3 (ack-status độc lập displayState).
