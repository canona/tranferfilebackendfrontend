---
title: 'Epic 2 hardening (item-10): dọn Map orphan khi gỡ kênh khỏi channel-registry'
type: 'chore'
created: '2026-09-24'
status: 'in-progress'
baseline_commit: '8506ab953db2350726b9e76813d35832ff19b720'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi 1 `channel_id` bị gỡ khỏi `channel-registry` qua hot-reload, 5 Map theo-channelId không bao giờ được dọn: backend `ChannelStateService.channels`, `BitrateHistoryService.history`, `wsUiAdapter.ts`'s `seenChannels`/`lastState`/`lastSnapshot`/`lastAckState`; frontend `channelStore.ts`'s `channelDisplayStates`/`channelMachineOffline`/`channelSnapshots`/`channelHistory`/`channelAck`/`seenChannelIds`. Rò rỉ bộ nhớ dài hạn khi vận hành 24/7 (epic-2-retro-item-10).

**Approach:** `FileChannelRegistryAdapter.reload()` diff registry cũ/mới lúc hoán đổi thành công, phát `channel_id` bị gỡ qua listener mới `onEntriesRemoved()`. `main.ts` wiring listener này gọi `pruneChannel(channelId)` mới trên `ChannelStateService`/`BitrateHistoryService`/`WsUiAdapterHandle`. Frontend không cần push riêng: `channelStore.ts`'s `applyRegistrySnapshot()` (đã là full snapshot mỗi lần connect) tự lọc bỏ state của channelId không còn trong danh sách mới.

## Boundaries & Constraints

**Always:**
- Thêm method vào CONCRETE class (`FileChannelRegistryAdapter`/`ChannelStateService`/`BitrateHistoryService`), KHÔNG đổi interface `ChannelRegistryPort`/`HistoryPort` — `main.ts` đã giữ biến kiểu concrete cho cả 3, gọi thẳng không qua interface, không phá fakes trong test khác. Riêng `WsUiAdapterHandle` PHẢI đổi interface (biến `ui` ở `main.ts` khai kiểu interface này).
- `FileChannelRegistryAdapter.onEntriesRemoved(listener: (ids: readonly string[]) => void): void` — đăng ký listener (hỗ trợ nhiều). Trong `reload()`, sau khi hoán đổi `this.registry` thành công: `removed = [...previousRegistry.keys()].filter(id => !next.has(id))`; gọi mọi listener nếu `removed.length > 0`. Nhánh lỗi validate (giữ registry cũ) KHÔNG gọi listener.
- `channelState.ts`: thêm `pruneChannel(channelId): void` (cạnh `getDisplayState()`) -- `this.channels.delete(channelId)`.
- `bitrateHistory.ts`: thêm `pruneChannel(channelId): void` -- `this.history.delete(channelId)`.
- `wsUiAdapter.ts`: `WsUiAdapterHandle` + implementation thêm `pruneChannel(channelId): void`, xoá `channelId` khỏi cả 4 Map (`seenChannels`/`lastState`/`lastSnapshot`/`lastAckState`); không broadcast gì (client tự đồng bộ qua `registry-snapshot` lần connect kế tiếp).
- `main.ts`: sau khi `channelStateService`/`ui`/`bitrateHistoryService` khởi tạo xong, wiring `registryPort.onEntriesRemoved(ids => { for (id of ids) { channelStateService.pruneChannel(id); bitrateHistoryService.pruneChannel(id); ui.pruneChannel(id); } log 1 dòng `registry_channel_pruned`/id })`.
- `channelStore.ts`'s `applyRegistrySnapshot(channels)`: build `nextIds = new Set(channels.map(c => c.channelId))`; lọc bỏ key ngoài `nextIds` khỏi `channelDisplayStates`/`channelMachineOffline`/`channelSnapshots`/`channelHistory`/`channelAck`/`seenChannelIds` -- chỉ tạo bản sao mới cho Map/Set nào THỰC SỰ có key bị lọc (tránh re-render thừa); giữ nguyên reset `channelAck` hiện có.

**Never:** Đổi `ChannelRegistryPort`/`HistoryPort` interface, debounce/mapping trạng thái, giao thức WS/envelope. Prune theo TTL/polling định kỳ mới (chỉ event-driven đúng lúc registry gỡ kênh). Đụng 3 hằng số kích thước lưới (epic-2-retro-item-12, tách deferred riêng).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reload gỡ 1 channel_id đang có state đầy đủ | File registry mới thiếu channel_id X, reload OK | 3 backend service xoá record X; log `registry_channel_pruned` | Không throw, 1 kênh lỗi không chặn kênh khác |
| Reload chỉ đổi metadata, không gỡ kênh | reload OK, `removed.length===0` | Không gọi listener/log gì thêm | N/A |
| Reload lỗi validate (giữ registry cũ) | `reload()` vào catch | Không tính diff, không gọi listener | Giữ nguyên `registry_reload_error` hiện có |
| Frontend nhận snapshot mới thiếu channel_id Y đã có state | `applyRegistrySnapshot` chạy | Lọc bỏ Y khỏi mọi Map/Set liên quan, 1 lượt `setState` | N/A |
| Frontend nhận snapshot giữ nguyên tập channel_id | `applyRegistrySnapshot` chạy | Không tạo Map/Set mới nào | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-backend/src/adapters/outbound/fileChannelRegistryAdapter.ts` -- `onEntriesRemoved()` + diff trong `reload()`.
- `dashboard-backend/src/core/channelState.ts:499` -- `pruneChannel()` cạnh `getDisplayState()`.
- `dashboard-backend/src/core/bitrateHistory.ts:26` -- `pruneChannel()` cạnh `private readonly history`.
- `dashboard-backend/src/adapters/outbound/wsUiAdapter.ts:68` -- `pruneChannel()` trên `WsUiAdapterHandle` + implementation.
- `dashboard-backend/app/main.ts:665-671` -- wiring `onEntriesRemoved` gọi 3 `pruneChannel`.
- `dashboard-frontend/src/state/channelStore.ts:170-172` -- lọc 6 Map/Set trong `applyRegistrySnapshot`.
- Tests: `fileChannelRegistryAdapter.test.ts`, `channelState.test.ts`, `bitrateHistory.test.ts`, `wsUiAdapter.test.ts`, `main.test.ts` (backend); `channelStore.test.ts` (frontend).

## Tasks & Acceptance

**Execution:**
- [ ] `fileChannelRegistryAdapter.ts` -- `onEntriesRemoved()` + diff -- điểm phát hiện duy nhất khi gỡ kênh.
- [ ] `channelState.ts` -- `pruneChannel()` -- dọn Map core debounce/heartbeat/ack.
- [ ] `bitrateHistory.ts` -- `pruneChannel()` -- dọn ring buffer bitrate.
- [ ] `wsUiAdapter.ts` -- `pruneChannel()` -- dọn 4 Map cache replay-on-connect.
- [ ] `main.ts` -- wiring gọi 3 `pruneChannel` -- kích hoạt cơ chế production.
- [ ] `channelStore.ts` -- lọc 6 Map/Set -- dọn phía frontend.
- [ ] Test theo I/O matrix cả 2 phía.

**Acceptance Criteria:**
- Given 1 channel_id có đầy đủ state rồi bị gỡ khỏi registry, when hot-reload thành công, then cả 3 service backend không còn record của channel_id đó.
- Given frontend nhận snapshot mới thiếu 1 channel_id đã có state, when `applyRegistrySnapshot` chạy, then mọi field state liên quan tự lọc bỏ channel_id đó.
- Given reload chỉ đổi metadata (không gỡ kênh), when reload thành công, then không `pruneChannel`/log nào bị gọi.

## Design Notes

Frontend không cần cơ chế push riêng vì `registry-snapshot` vốn đã full snapshot mỗi lần connect (AD-26) — lọc ngay tại điểm nhận snapshot là đủ.

`seenChannelIds` (Story 2.3) có Boundary cũ "chỉ cộng thêm" — spec này diễn giải hẹp lại: chỉ áp dụng cho `applyChannelSeen()`, không áp dụng khi registry thực sự gỡ hẳn 1 channel_id (tình huống Story 2.3 chưa xét).

## Verification

**Commands:**
- `cd dashboard-backend && npm test` -- pass, cover `pruneChannel`/`onEntriesRemoved` diff (gỡ kênh, đổi metadata, reload lỗi).
- `cd dashboard-frontend && npm test` -- pass, cover `applyRegistrySnapshot` pruning.
- `cd dashboard-backend && npm run build && cd ../dashboard-frontend && npm run build` -- build sạch cả 2 phía.
