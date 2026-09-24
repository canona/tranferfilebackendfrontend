---
title: 'Story 3.1: Ring buffer lịch sử bitrate & HistoryPort tri-state'
type: 'feature'
created: '2026-09-08'
status: 'done'
baseline_commit: '92ebed10fa3ce3a29345effdd46c4f4a206bba2b'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `dashboard-backend` hiện chỉ giữ trạng thái hiển thị ĐÃ CHỐT (committed) mỗi kênh, không giữ lịch sử bitrate theo thời gian — Story 3.2 (detail-panel/biểu đồ) không có dữ liệu để vẽ, và không có cách nào phân biệt "kênh mới chưa đủ dữ liệu" với "đã có dữ liệu nhưng đang tải", dễ khiến panel hiểu nhầm kênh mới là đang gặp sự cố.

**Approach:** Thêm 1 ring buffer in-memory ~15 phút/kênh (không dùng time-series DB), ghi mỗi mẫu bitrate hợp lệ NGAY khi telemetry tới (độc lập debounce 5s hiện có), và 1 `HistoryPort` mới trả discriminated result tường minh (`loading` | `loaded` | `no-history-data`) thay vì mảng rỗng/giá trị 0.

## Boundaries & Constraints

**Always:**
- Ghi vào ring buffer NGAY mỗi khi `ChannelStateService.handleTelemetry` nhận telemetry cho 1 `channelId` ĐÃ có trong channel-registry (mirror đúng policy `channel_unregistered` hiện có — kênh chưa đăng ký không được ghi lịch sử) — ĐỘC LẬP hoàn toàn debounce 5s/`committed` state (mirror tinh thần AD-23/`uiPort.publishChannelSeen`: tín hiệu thô, không chờ chốt trạng thái).
- Giá trị ghi vào ring buffer là `bitratePct` (đã tính qua `computeBitratePct`, cùng giá trị dùng để mapping trạng thái hiển thị) — KHÔNG ghi `bitrateKbps` thô, để nhất quán với con số "Bitrate: NN%" đã hiển thị ở nơi khác.
- Retention ~15 phút/kênh: mẫu cũ hơn 15 phút bị loại bỏ dần mỗi lần ghi mới cho đúng kênh đó (không cần timer riêng).
- `HistoryPort.getHistory(channelId)` trả `no-history-data` khi kênh chưa từng có mẫu nào được ghi; trả `loaded` kèm mảng mẫu (thời gian + bitratePct, theo thứ tự thời gian tăng dần) khi đã có ít nhất 1 mẫu.
- 1 kênh lỗi (vd `recordBitrate` throw) không được làm lỡ phần debounce/state phía sau của chính telemetry event đó trong `handleTelemetry` — mirror try/catch + log đã áp dụng cho `uiPort.publishChannelSeen`.
- Toàn bộ ring buffer + `HistoryPort` implementation là domain thuần (`src/core/`), test được bằng fake/`Clock` injectable, không import ws/fs/network.

**Ask First:** Không có mục nào trong phạm vi story này cần dừng lại hỏi thêm.

**Never:**
- KHÔNG dùng time-series DB hay lưu xuống đĩa cho MVP#1 (AD-14) — chỉ in-memory.
- KHÔNG expose `HistoryPort` qua WebSocket/API cho frontend ở story này — đó là việc của Story 3.2. Story này CHỈ dựng port + ring buffer + test, chưa wiring ra ngoài.
- KHÔNG tự ý đổi `DEBOUNCE_MS`/`HEARTBEAT_TIMEOUT_MS`/mapping trạng thái hiện có.
- KHÔNG chủ động dọn ring buffer của kênh mất kết nối hoàn toàn bằng timer riêng — mẫu cũ chỉ bị trim khi có mẫu mới ghi vào đúng kênh đó (chấp nhận rò rỉ bounded tối đa ~15 phút dữ liệu cho kênh ngừng gửi hẳn, tương tự cách `channels` Map hiện có không tự xoá kênh chết).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kênh mới, chưa từng có telemetry | `getHistory('chan-x')`, chưa ghi mẫu nào | `{ state: 'no-history-data' }` | N/A |
| Đã có >=1 mẫu | 3 mẫu ghi tại t=0s,5s,10s | `{ state: 'loaded', data: [...3 điểm, tăng dần theo thời gian] }` | N/A |
| Mẫu cũ hơn 15 phút | Ghi mẫu tại t=0, rồi t=16 phút | Mẫu t=0 bị loại khỏi kết quả `getHistory` sau khi ghi mẫu t=16' | N/A |
| Telemetry cho channel_id chưa đăng ký | `handleTelemetry` với `channelId` không có trong registry | KHÔNG ghi vào ring buffer (giữ nguyên policy `channel_unregistered` đã log) | N/A |
| Port ghi lịch sử throw | `recordBitrate` ném lỗi | Log lỗi (event riêng), debounce/`applyCandidate` của telemetry event đó vẫn chạy tiếp bình thường | Không rethrow, không crash process |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/ports/HistoryPort.ts` -- MỚI. Interface `HistoryPort` (2 method: `recordBitrate(channelId, bitratePct, timestampMs)`, `getHistory(channelId): HistoryQueryResult`), type `HistoryQueryResult` (discriminated union `loading`/`loaded`/`no-history-data`), type `BitrateHistoryPoint`. Mirror style comment Intent/Boundaries như `dashboard-backend/src/ports/ChannelRegistryPort.ts:1-15`.
- `dashboard-backend/src/core/bitrateHistory.ts` -- MỚI. Hằng số `HISTORY_RETENTION_MS = 15 * 60 * 1000` (mirror style `channelState.ts:29,34`); class `BitrateHistoryService implements HistoryPort` (options: `{ clock?: Clock }`, mirror `ChannelStateServiceOptions` ở `channelState.ts:56-66`), nội bộ `Map<string, BitrateHistoryPoint[]>` keyed channelId (mirror `channels` Map ở `channelState.ts:79`), trim mẫu cũ hơn retention mỗi lần `recordBitrate` được gọi cho đúng key đó.
- `dashboard-backend/src/core/channelState.ts` -- SỬA. `ChannelStateServiceOptions` (dòng 56-66) thêm field bắt buộc `historyPort: HistoryPort`; constructor lưu field; `handleTelemetry` (dòng 90, ngay sau `computeBitratePct` ở dòng 155) gọi `this.historyPort.recordBitrate(event.channelId, bitratePct, this.clock.now())` trong try/catch + `logger.log` khi throw -- mirror chính xác pattern `uiPort.publishChannelSeen` ở dòng 143-153 (khác: recordBitrate gọi cho MỌI telemetry hợp lệ, không chỉ lần đầu/kênh).
- `dashboard-backend/app/main.ts` -- SỬA. Thêm `import { BitrateHistoryService } from '../src/core/bitrateHistory.js';` (mirror import `SnapshotRelayService` dòng 18); khởi tạo `const bitrateHistoryService = new BitrateHistoryService({ clock: config?.clock });` trước `new ChannelStateService(...)` (dòng 283); truyền `historyPort: bitrateHistoryService` vào options của `ChannelStateService`.
- `dashboard-backend/tests/bitrateHistory.test.ts` -- MỚI. Test `BitrateHistoryService` độc lập bằng `FakeClock` (copy pattern `dashboard-backend/tests/channelState.test.ts:13-21`).
- `dashboard-backend/tests/channelState.test.ts` -- SỬA. Thêm `FakeHistoryPort implements HistoryPort` + `ThrowingHistoryPort` (mirror `FakeUiPort`/`ThrowingUiPort` dòng 61-74); cập nhật 3 call site `new ChannelStateService({...})` (dòng 101, 265, 455) truyền thêm `historyPort`.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/ports/HistoryPort.ts` -- tạo interface `HistoryPort` + type `HistoryQueryResult`/`BitrateHistoryPoint` -- hợp đồng tri-state cho Story 3.2 dùng sau này.
- [x] `dashboard-backend/src/core/bitrateHistory.ts` -- tạo `BitrateHistoryService` (ring buffer + implement `HistoryPort`) -- domain thuần, test bằng fake `Clock`.
- [x] `dashboard-backend/src/core/channelState.ts` -- wiring `historyPort` vào `handleTelemetry` -- điểm ghi mẫu duy nhất, tái dùng `bitratePct` đã tính, không duplicate registry check.
- [x] `dashboard-backend/app/main.ts` -- wiring `BitrateHistoryService` vào composition root -- production thực sự ghi lịch sử khi chạy thật.
- [x] `dashboard-backend/tests/bitrateHistory.test.ts` -- test I/O matrix (no-history-data, loaded, prune 15 phút) -- phủ đúng AC tri-state.
- [x] `dashboard-backend/tests/channelState.test.ts` -- test wiring (gọi đúng tham số, bỏ qua kênh chưa đăng ký, throw không làm lỡ debounce) -- phủ I/O matrix wiring.

**Acceptance Criteria:**
- Given kênh gửi telemetry liên tục, when `dashboard-backend` nhận, then ring buffer in-memory giữ mẫu bitrate ~15 phút gần nhất/kênh, không dùng time-series DB.
- Given kênh chưa từng gửi telemetry, when gọi `HistoryPort.getHistory(channelId)`, then trả `{ state: 'no-history-data' }` — không phải mảng rỗng hay giá trị 0.
- Given kênh đã có mẫu, when gọi `getHistory`, then trả `{ state: 'loaded', data }` với `data` là mảng bitratePct theo thời gian tăng dần.

### Review Findings

- [x] [Review][Patch] `getHistory()` chỉ copy nông mảng, không copy sâu từng điểm — sửa 1 field trên object điểm dữ liệu trả về vẫn làm hỏng dữ liệu nội bộ [bitrateHistory.ts:60]
- [x] [Review][Patch] `AppHandle.bitrateHistoryService` expose thẳng class cụ thể `BitrateHistoryService` thay vì interface `HistoryPort` — rò rỉ ranh giới hexagonal ra ngoài `app/main.ts` [main.ts:129-132]
- [x] [Review][Defer] `recordBitrate` giả định `timestampMs` luôn tăng dần theo từng lần gọi cho cùng 1 kênh; không có phòng vệ trước lệch đồng hồ hệ thống (NTP step-back) làm mẫu đến sau có `timestampMs` nhỏ hơn mẫu trước — deferred, re-confirm từ vòng review trước (2026-09-09), pre-existing pattern (toàn bộ `src/core` đã dựa vào `Clock` injectable monotonic-assumed, giống debounce `applyCandidate` hiện có) [bitrateHistory.ts:38-42]
- [x] [Review][Defer] `BitrateHistoryService`'s `history` Map không xoá key khi 1 channel_id bị gỡ khỏi channel-registry qua hot-reload — deferred, re-confirm từ vòng review trước (2026-09-09), thuộc nhóm "epic-2-retro-item-10" (Map thứ 5 cùng lớp chưa prune theo registry, gộp fix chung) [bitrateHistory.ts]

## Spec Change Log

## Design Notes

`loading` là 1 nhánh hợp lệ của `HistoryQueryResult` (theo đúng AC epic) nhưng `BitrateHistoryService.getHistory()` là đồng bộ, hoàn toàn in-memory — KHÔNG có I/O nào để phải chờ, nên implementation của story này không bao giờ tự tạo ra nhánh `loading`. Nhánh này tồn tại trong type để Story 3.2 (frontend chờ phản hồi qua WebSocket) dùng — không phải gap, là quyết định thiết kế: hợp đồng type dùng chung giữa BE/FE, nhưng BE chỉ hiện thực 2/3 nhánh ở story này.

## Verification

**Commands:**
- `cd dashboard-backend && npm run build && node --test "dist/tests/**/*.test.js"` -- expected: toàn bộ test pass, gồm `bitrateHistory.test.ts` mới và `channelState.test.ts` đã cập nhật.

**Manual checks (if no CLI):**
- Đọc `dist/app/main.js` sau build, xác nhận `historyPort` được truyền vào `ChannelStateService` (không bị quên wiring, khác lỗi runtime âm thầm vì TS interface optional).

## Suggested Review Order

**Hợp đồng tri-state (`HistoryPort`)**

- Interface 2 method, tách ghi (`recordBitrate`) khỏi đọc (`getHistory`) — entry point thiết kế.
  [`HistoryPort.ts:30`](../../dashboard-backend/src/ports/HistoryPort.ts#L30)

- Discriminated union 3 nhánh thay thế mảng rỗng/giá trị 0 (Intent chính của story).
  [`HistoryPort.ts:48`](../../dashboard-backend/src/ports/HistoryPort.ts#L48)

**Ring buffer in-memory (`BitrateHistoryService`)**

- Ghi mẫu + trim theo cửa sổ 15 phút ngay tại thời điểm ghi, không cần timer riêng.
  [`bitrateHistory.ts:28`](../../dashboard-backend/src/core/bitrateHistory.ts#L28)

- Cutoff "cũ hơn" (strict `<`) giữ đúng mẫu ở biên tuổi retention, không trim quá tay.
  [`bitrateHistory.ts:38`](../../dashboard-backend/src/core/bitrateHistory.ts#L38)

- Trả bản sao nông (code review patch) — tránh caller giữ tham chiếu bị phình sau ghi mới.
  [`bitrateHistory.ts:60`](../../dashboard-backend/src/core/bitrateHistory.ts#L60)

**Wiring vào ingestion telemetry (`ChannelStateService`)**

- Ghi lịch sử NGAY mỗi telemetry hợp lệ, độc lập hoàn toàn debounce 5s hiện có.
  [`channelState.ts:176`](../../dashboard-backend/src/core/channelState.ts#L176)

- Cô lập lỗi `historyPort` bằng try/catch — không làm lỡ debounce/state phía sau event đó.
  [`channelState.ts:178`](../../dashboard-backend/src/core/channelState.ts#L178)

- Log lỗi kèm giá trị mẫu bị mất (code review patch) để chẩn đoán được khi throw.
  [`channelState.ts:187`](../../dashboard-backend/src/core/channelState.ts#L187)

**Wiring composition root (`main.ts`)**

- Khởi tạo `BitrateHistoryService` thật, expose qua `startApp()` để test quan sát wiring (patch — verification gap).
  [`main.ts:297`](../../dashboard-backend/app/main.ts#L297)

- Truyền `historyPort` thật vào `ChannelStateService` — điểm wiring production duy nhất.
  [`main.ts:303`](../../dashboard-backend/app/main.ts#L303)

**Tests**

- I/O matrix ring buffer: no-history-data, loaded, prune 15 phút, snapshot-copy (patch coverage).
  [`bitrateHistory.test.ts:122`](../../dashboard-backend/tests/bitrateHistory.test.ts#L122)

- Wiring unit test: throw không làm lỡ debounce, ghi cho mọi telemetry hợp lệ.
  [`channelState.test.ts:549`](../../dashboard-backend/tests/channelState.test.ts#L549)

- Integration test WS thật: khoá lại wiring production, phát hiện được nếu ai thay bằng stub rỗng.
  [`main.test.ts:681`](../../dashboard-backend/tests/main.test.ts#L681)
