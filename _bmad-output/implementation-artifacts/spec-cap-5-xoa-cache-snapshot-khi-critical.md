---
title: 'CAP-5: Xoá cache snapshot khi kênh chuyển sang critical'
type: 'feature'
created: '2026-09-08'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2976b6892587c0b6602a01a8365bdf4e5d123833'
context: ['{project-root}/_bmad-output/specs/spec-video-preview-snapshot-thật/SPEC.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi 1 kênh chuyển `displayState` sang `critical`, cache khung-mới-nhất (backend `wsUiAdapter`'s `lastSnapshot`, frontend `channelStore`'s `channelSnapshots`) vẫn giữ ảnh cũ. Kênh phục hồi về ok/warning trước khi transport-core gửi khung mới (~1.5s) sẽ hiện nhầm ảnh cũ thay vì gradient placeholder.

**Approach:** `publishStateChange` (backend) và `applyChannelDisplayStateChange` (frontend), khi nhận `displayState === 'critical'`, xoá `channelId` đó khỏi cache snapshot tương ứng — cùng chỗ xử lý hiện có, không thêm cơ chế mới.

## Boundaries & Constraints

**Always:** Chỉ xoá đúng `channelId` vừa nhận `critical`. Check duy nhất `displayState === 'critical'` — không cần điều kiện riêng cho `subType='machine-offline'` (subtype này chỉ có hiệu lực khi đã là `critical`). Giữ nguyên mọi hành vi hiện có của 2 hàm — chỉ thêm, không sửa.

**Ask First:** Không có — `SPEC-video-preview-snapshot-thật` (CAP-5) đã chốt đầy đủ, 2 open-question đã resolve.

**Never:** Không thêm giới hạn/backpressure kích thước message (đã quyết định không cần). Không định nghĩa backfill/gửi lại snapshot khi phục hồi. Không đổi signature của `ChannelStateChange`/`applyChannelDisplayStateChange`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backend: có cache, chuyển critical (kèm/không kèm subType machine-offline) | `lastSnapshot` có entry, `publishStateChange({channelId, displayState:'critical'})` | entry bị xoá; client connect sau đó không replay `channel-snapshot` cho kênh này | N/A |
| Backend: KHÔNG có cache, chuyển critical | `lastSnapshot` không có entry | không throw, no-op | N/A |
| Backend: critical rồi phục hồi ok trước khung mới | Sau xoá cache, `publishStateChange({channelId, displayState:'ok'})`, chưa `publishSnapshot` mới | client connect muộn không replay ảnh cũ | N/A |
| Frontend: có `channelSnapshots` entry, chuyển critical | `applyChannelDisplayStateChange(channelId, 'critical')` | entry bị xoá; `ChannelGridCell` fallback gradient khi phục hồi (logic có sẵn) | N/A |
| Frontend: KHÔNG có entry, chuyển critical | `channelSnapshots` không có entry | không throw, size không đổi | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:284-290` -- `publishStateChange()` -- thêm `lastSnapshot.delete(change.channelId)` khi `change.displayState === 'critical'`. `lastSnapshot` khai báo dòng 163.
- `dashboard-backend/tests/wsUiAdapter.test.ts` -- test hiện có cho `publishSnapshot`/`publishStateChange` -- thêm case theo I/O matrix backend.
- `dashboard-frontend/src/state/channelStore.ts:124-150` -- `applyChannelDisplayStateChange()` -- thêm xoá `channelId` khỏi `channelSnapshots` khi `displayState === 'critical'`, mirror pattern immutable-copy-chỉ-khi-đổi của `nextMachineOffline` (dòng 132-143).
- `dashboard-frontend/tests/channelStore.test.ts` -- test hiện có -- thêm case theo I/O matrix frontend.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts` -- thêm `lastSnapshot.delete(change.channelId)` khi critical -- CAP-5 backend.
- [x] `dashboard-backend/tests/wsUiAdapter.test.ts` -- test 2 case backend trong I/O matrix.
- [x] `dashboard-frontend/src/state/channelStore.ts` -- thêm xoá `channelSnapshots` entry khi critical, mirror `nextMachineOffline` -- CAP-5 frontend.
- [x] `dashboard-frontend/tests/channelStore.test.ts` -- test 2 case frontend trong I/O matrix (đã thêm 5 case: 2 theo matrix + 3 case AC bổ sung).

**Acceptance Criteria:**
- Given kênh có snapshot cache ở cả 2 phía, when chuyển `critical`, then cache của đúng kênh đó bị xoá cả backend lẫn frontend, không ảnh hưởng kênh khác.
- Given kênh vừa chuyển critical (cache đã xoá), when phục hồi ok/warning trước khung mới, then UI hiện gradient placeholder, không phải ảnh cũ.
- Given test suite hiện có (130 backend + 125 frontend, tính đến commit `d14ba9c`), when chạy lại, then tất cả pass cộng test mới cho CAP-5.

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- expected: pass, gồm test mới cho `publishStateChange`.
- `cd dashboard-frontend && npm test` -- expected: pass, gồm test mới cho `applyChannelDisplayStateChange`.

## Suggested Review Order

**Backend — xoá cache khi vào critical**

- Entry point: điều kiện `critical` mới trong `publishStateChange()`, xoá `lastSnapshot` của đúng channel trước khi broadcast.
  [`wsUiAdapter.ts:293`](../../dashboard-backend/src/adapters/outbound/wsUiAdapter.ts#L293)

**Frontend — mirror hành vi backend**

- Cùng logic phía store, dùng pattern immutable-copy-chỉ-khi-đổi sẵn có của `nextMachineOffline`.
  [`channelStore.ts:153`](../../dashboard-frontend/src/state/channelStore.ts#L153)

**Test — backend**

- Case chính: critical xoá cache, phục hồi ok trước khung mới -> không replay ảnh cũ cho client connect sau.
  [`wsUiAdapter.test.ts:328`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L328)

- Biến thể subType='machine-offline' -> vẫn xoá (không cần check subType riêng).
  [`wsUiAdapter.test.ts:361`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L361)

- Round-trip: khung mới sau phục hồi populate lại cache bình thường (CAP-5 không khoá vĩnh viễn).
  [`wsUiAdapter.test.ts:399`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L399)

- No-op khi không có cache.
  [`wsUiAdapter.test.ts:388`](../../dashboard-backend/tests/wsUiAdapter.test.ts#L388)

**Test — frontend**

- Case chính + cô lập đúng channelId, không ảnh hưởng kênh khác.
  [`channelStore.test.ts:280`](../../dashboard-frontend/tests/channelStore.test.ts#L280)

- Biến thể subType='machine-offline'.
  [`channelStore.test.ts:289`](../../dashboard-frontend/tests/channelStore.test.ts#L289)

- Round-trip repopulate sau phục hồi.
  [`channelStore.test.ts:319`](../../dashboard-frontend/tests/channelStore.test.ts#L319)
