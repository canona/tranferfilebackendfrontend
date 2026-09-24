---
title: 'Story 4.1: Âm báo động tại chỗ khi có cảnh báo mới'
type: 'feature'
created: '2026-09-22'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'f64dfeb9d1fb4a3b06f72c26f4b948b676a58d6d'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Đội trực không luôn nhìn TV wall nên có thể bỏ lỡ lúc 1 ô vừa đổi màu sang `warning`/`critical` — tín hiệu thị giác đơn thuần chưa đủ bắt sự chú ý ngay (SM-1).

**Approach:** Frontend tự phát hiện thời điểm 1 kênh chuyển sang `warning`/`critical` (so sánh giá trị cũ/mới ngay trong `channelStore`, không sửa backend) và phát 1 tiếng bíp tổng hợp qua Web Audio API — không thêm file audio vào repo.

## Boundaries & Constraints

**Always:**
- Chỉ phát âm khi `displayState` 1 kênh **thực sự đổi** sang `warning`/`critical` (mọi cặp: `ok`→`warning`, `ok`→`critical`, `warning`→`critical`, `critical`→`warning` đều là cảnh báo mới).
- Đúng 1 lần/transition — không lặp, không cooldown 60s (khác Telegram/Email ở Story 4.2/4.3).
- Chuyển về `ok` không kích hoạt âm báo.
- `subType: 'machine-offline'` (2.7) vẫn hiển thị `critical` — áp dụng đúng rule trên, không cần logic riêng.

**Ask First:**
- Nếu cần đổi tần số/thời lượng/kiểu bíp khác gợi ý ở Design Notes.

**Never:**
- Không thêm nút/toggle tắt âm báo vĩnh viễn ở UI chính (AC bắt buộc).
- Không thêm cooldown/debounce riêng cho âm báo.
- Không sửa `dashboard-backend`/wire schema — toàn bộ ở `dashboard-frontend`.
- Không dùng file audio nhị phân (mp3/wav) — tổng hợp bằng Web Audio API.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|---------------------------|----------------|
| `ok`→`warning` | previous=ok, next=warning | Phát 1 tiếng bíp | N/A |
| `warning`→`critical` | previous=warning, next=critical | Phát 1 tiếng bíp | N/A |
| Phục hồi `critical`→`ok` | previous=critical, next=ok | Không phát âm | N/A |
| Mount/reconnect, kênh ĐÃ warning/critical (replay lúc connect) | previous=undefined, next=warning/critical | Không phát âm — công bố trạng thái hiện tại, không phải transition mới | N/A |
| `AudioContext` bị trình duyệt chặn (chưa có gesture) | Gọi phát bíp trước tương tác đầu | Nuốt lỗi, không crash | catch, `console.warn` 1 lần |

</frozen-after-approval>

## Code Map

- `dashboard-frontend/src/state/channelStore.ts:184-225` -- `applyChannelDisplayStateChange`, nơi DUY NHẤT nhận `displayState` mới; đọc `previous = channelDisplayStates.get(channelId)` TRƯỚC khi ghi đè.
- `dashboard-frontend/src/state/channelStore.ts:60-126` -- `ChannelStoreState`/`EMPTY_STATE` -- thêm `alertSoundToken: number` (0, tăng mỗi transition hợp lệ; store vẫn thuần, không tự phát âm).
- `dashboard-frontend/app/page.tsx:28-48` -- effect mount `connectUiWsClient` (pattern `sendAckCommandRef`) -- thêm side-effect âm thanh ở đây (store thuần, side-effect trình duyệt tập trung ở page.tsx).
- `dashboard-backend/src/ports/AlertOutboundPort.ts:9` -- `DisplayState = 'ok'|'warning'|'critical'` -- chỉ tham chiếu, KHÔNG sửa.
- Pattern test tham khảo: `dashboard-frontend/tests/channelStore.test.ts`, `tests/page.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-frontend/src/services/alertSound.ts` (MỚI) -- tổng hợp tiếng bíp qua Web Audio API (`AudioContext`+`OscillatorNode`+`GainNode` envelope ngắn); export `playAlertBeep()` (lazy-init context dùng chung, nuốt lỗi) + `primeAlertAudioContext()` (`.resume()`) -- tách side-effect âm thanh khỏi store, dễ mock.
- [x] `dashboard-frontend/src/state/channelStore.ts` -- thêm `alertSoundToken`; trong `applyChannelDisplayStateChange` tăng token khi `previous !== undefined && previous !== displayState && (displayState==='warning'||displayState==='critical')`.
- [x] `dashboard-frontend/app/page.tsx` -- `useEffect`+`useRef` theo dõi `alertSoundToken`, gọi `playAlertBeep()` khi tăng (bỏ qua mount đầu); gắn listener `pointerdown`/`keydown` `{once:true}` trên `document` gọi `primeAlertAudioContext()`.
- [x] `dashboard-frontend/tests/channelStore.test.ts` -- test `alertSoundToken` tăng đúng cho các cặp transition hợp lệ, KHÔNG tăng cho `critical`→`ok` và khi `previous` chưa có entry.
- [x] `dashboard-frontend/tests/alertSound.test.ts` (MỚI) -- mock `AudioContext` toàn cục, test gọi đúng API, không throw khi `AudioContext`/`.start()` lỗi.
- [x] `dashboard-frontend/tests/page.test.tsx` -- test `playAlertBeep` gọi đúng 1 lần khi `alertSoundToken` đổi, KHÔNG gọi lúc mount dù đã có kênh warning/critical sẵn.

**Acceptance Criteria:**
- Given dashboard đang mở, when không có `channel-state-change` mới, then không âm báo nào tự phát (không polling/interval kích hoạt).
- Given UI chính (grid/detail-panel/header), when kiểm tra thủ công, then không có control tắt âm báo vĩnh viễn.

### Review Findings

- [x] [Review][Patch] Batched multi-transition beeps chồng lấp thành 1 tiếng thay vì N tiếng phân biệt — stagger thời điểm bắt đầu mỗi beep (offset `start`/`stop` theo `i * BEEP_DURATION_SEC` khi gọi lặp trong for-loop ở `page.tsx`), kèm test xác nhận thời điểm start lệch nhau giữa các lần gọi trong cùng 1 delta>1. (Quyết định người dùng: chọn "Stagger thời điểm bắt đầu mỗi beep" thay vì giữ nguyên.) [dashboard-frontend/app/page.tsx:99-107, dashboard-frontend/src/services/alertSound.ts:157-179]
- [x] [Review][Patch] `warnOnce` dùng 1 cờ boolean vĩnh viễn cho MỌI loại lỗi khác nhau [dashboard-frontend/src/services/alertSound.ts:20-24]
- [x] [Review][Patch] Test "dùng lại CÙNG 1 AudioContext" không thực sự kiểm chứng singleton (mock `createOscillator` bị chia sẻ ngoài constructor, nên regression bỏ cache singleton vẫn pass) [dashboard-frontend/tests/alertSound.test.ts:92-102]
- [x] [Review][Patch] Thiếu test cho 2 nhánh: `resume()` KHÔNG được gọi khi `ctx.state==='running'`; `primeAlertAudioContext()` khi thiếu `window.AudioContext` [dashboard-frontend/tests/alertSound.test.ts]

## Spec Change Log

## Design Notes

Beep tổng hợp thay vì file asset — tránh thêm binary vào repo (chưa có `public/` ở dashboard-frontend) và vấn đề license. Gợi ý: `OscillatorNode` sine ~880Hz, `GainNode` envelope ngắn (~250-350ms), 1 `AudioContext` lazy-singleton dùng chung trong `alertSound.ts`.

Rủi ro autoplay: trình duyệt giữ `AudioContext` `suspended` tới lần tương tác đầu — `primeAlertAudioContext()` resume sớm nhất có thể; nếu tiếng bíp đầu phiên xảy ra trước mọi tương tác, có thể bị nuốt âm thầm (chấp nhận được — đã có bù thị giác từ Epic 2/3; rủi ro phần cứng loa là gap biết trước OQ-9, ngoài scope).

## Verification

**Commands:**
- `cd dashboard-frontend && npm test` -- expected: pass toàn bộ, gồm 3 file mới/sửa.

**Manual checks:**
- Giả lập 1 kênh chuyển warning/critical → nghe đúng 1 tiếng bíp, không lặp khi trạng thái giữ nguyên.
- Rà soát UI chính → không có nút/toggle tắt âm báo.

## Suggested Review Order

**Phát hiện transition (store thuần)**

- Entry point: đọc `previous` TRƯỚC khi ghi đè map, nền tảng của toàn bộ rule.
  [`channelStore.ts:197`](../../dashboard-frontend/src/state/channelStore.ts#L197)

- Rule "đúng 1 lần/transition sang warning/critical" - loại trừ replay/set-lại-cùng-giá-trị.
  [`channelStore.ts:238`](../../dashboard-frontend/src/state/channelStore.ts#L238)

- Field mới `alertSoundToken` trên state/EMPTY_STATE.
  [`channelStore.ts:117`](../../dashboard-frontend/src/state/channelStore.ts#L117)
  [`channelStore.ts:133`](../../dashboard-frontend/src/state/channelStore.ts#L133)

**Wiring effect ở page.tsx (patch review round 1)**

- So sánh GIÁ TRỊ token (không phải cờ boolean) - sống sót qua React StrictMode double-invoke và phát đúng số lần khi nhiều transition gộp 1 batch.
  [`page.tsx:99`](../../dashboard-frontend/app/page.tsx#L99)

- Gắn gesture đầu tiên (`pointerdown`/`keydown`, `{once:true}`) để prime AudioContext sớm nhất có thể.
  [`page.tsx:113`](../../dashboard-frontend/app/page.tsx#L113)

**Tổng hợp âm thanh + phục hồi AudioContext suspended (patch review round 1)**

- `playAlertBeep()`: sine ~880Hz qua OscillatorNode/GainNode, chủ động thử resume nếu context đang suspended.
  [`alertSound.ts:84`](../../dashboard-frontend/src/services/alertSound.ts#L84)

- `tryResumeIfSuspended()`: biến ca "chặn câm lặng" (không throw) thành 1 console.warn quan sát được.
  [`alertSound.ts:66`](../../dashboard-frontend/src/services/alertSound.ts#L66)

- `primeAlertAudioContext()`: resume ngay lúc gesture đầu tiên.
  [`alertSound.ts:44`](../../dashboard-frontend/src/services/alertSound.ts#L44)

**Test (peripheral)**

- `channelStore.test.ts` - 13 case `alertSoundToken` phủ toàn bộ I/O matrix.
  [`channelStore.test.ts`](../../dashboard-frontend/tests/channelStore.test.ts)

- `page.test.tsx` - wiring + regression StrictMode/batch (patch review round 1).
  [`page.test.tsx`](../../dashboard-frontend/tests/page.test.tsx)

- `alertSound.test.ts` - mock Web Audio API, gồm 3 case `suspended`/resume mới.
  [`alertSound.test.ts`](../../dashboard-frontend/tests/alertSound.test.ts)
