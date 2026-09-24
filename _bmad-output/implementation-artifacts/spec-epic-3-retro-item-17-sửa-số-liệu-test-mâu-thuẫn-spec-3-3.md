---
title: 'Sửa số liệu test mâu thuẫn trong spec-3-3 (epic-3-retro-item-17)'
type: 'chore'
created: '2026-09-24'
status: 'done'
route: 'one-shot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md` dòng 142 tự mâu thuẫn — công bố "Backend 181/181 test pass sau patch" trong khi cùng câu thừa nhận "1 fail pre-existing `installService.test.js`" — hai vế không thể cùng đúng (`epic-3-retro-item-17`, `epic-3-retro-2026-09-12.md`).

**Approach:** Sửa "181/181" thành "180/181" cho khớp với 1 fail pre-existing đã biết ngay trong cùng câu; bổ sung caveat tương ứng vào `## Verification` (dòng 153) để nhất quán xuyên suốt file.

</frozen-after-approval>

## Code Map

- `_bmad-output/implementation-artifacts/spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md` -- dòng 142/153 sửa lại theo số liệu thật đã xác nhận thực nghiệm (188 test, không phải 180/181)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mục CONFIRMED (2026-09-24) ghi root cause flaky test
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- action_item mới `story-3-3-fix-flaky-installservice-test-timeout-50ms`

## Tasks & Acceptance

**Execution:**
- [x] `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:142` -- sửa "181/181" → "180/181" -- khớp với "1 fail pre-existing" thừa nhận ngay sau đó trong cùng câu
- [x] `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:153` -- thêm caveat "trừ 1 fail pre-existing đã biết ... tracked epic-2-retro-item-13" -- `## Verification` trước đó ghi "expected: toàn bộ test pass", mâu thuẫn với chính Change Log ngay phía trên
- [x] Điều tra sâu (git worktree riêng, chạy `node --test` 10 lần tại 2 commit) -- phát hiện "180/181" vẫn SAI (số thật 188), `installService.test.js` flaky chứ không phải pre-existing ổn định -- sửa lại dòng 142/153 lần 2, ghi root cause vào `deferred-work.md` + action_item fix thật vào `sprint-status.yaml`

**Acceptance Criteria:**
- Given dòng 142 và dòng 153 của spec-3-3, when đọc cùng lúc với dòng 110 (nơi lần đầu ghi nhận fail pre-existing), then không còn phát biểu nào tự mâu thuẫn về việc "toàn bộ test pass" hay tổng số test.
- Given số liệu test backend được công bố trong spec-3-3, when đối chiếu với kết quả chạy thật tại commit tương ứng, then khớp (188 test, không phải 180/181 hay 181/181).

## Spec Change Log

- **2026-09-24 (điều tra sâu theo yêu cầu người dùng, sau khi review layer nghi ngờ số liệu)**: patch đầu ("181/181"→"180/181") vẫn SAI — dựng git worktree riêng, chạy `node --test` thật 10 lần tại 2 commit Story 3.3 (`b652faf`, `f64dfeb`): 8 file test khác luôn 178/178 ổn định tuyệt đối; `installService.test.js` (9 test) dao động 1-9 test báo cáo mỗi lần chạy CÙNG 1 commit — flaky thật, không phải "pre-existing fail" ổn định như mọi entry Change Log của spec-3-3 mô tả từ trước. Số thật tại commit cuối: **188 test tổng** (187 ổn định + 9 của installService.test.js). Root cause: test đầu tiên của `installService.test.js` (dòng 83-104) đua giữa 2 `setImmediate` lồng nhau với `startTimeoutMs=50ms` — quá chặt khi chạy cùng 187 test khác tranh CPU. Sửa lại dòng 142/153 lần 2 cho khớp số thật; ghi chi tiết root cause vào `deferred-work.md` (mục CONFIRMED); thêm action_item `story-3-3-fix-flaky-installservice-test-timeout-50ms` đề xuất fix thật (tăng timeout hoặc bỏ wall-clock timing).

## Verification

**Manual checks (if no CLI):**
- Đọc lại `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md` dòng 110, 142, 153 — cả 3 chỗ nhắc tới `installService.test.js` phải nhất quán (1 fail pre-existing, không liên quan, tracked `epic-2-retro-item-13`).

## Suggested Review Order

**Số liệu test mâu thuẫn (Change Log + Verification)**

- Sửa "181/181" → "180/181" cho khớp 1 fail pre-existing thừa nhận ngay trong câu.
  [`spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:142`](spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md#L142)

- Thêm caveat pre-existing-fail vào expected-result của lệnh test backend, cho nhất quán với Change Log phía trên.
  [`spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:153`](spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md#L153)
