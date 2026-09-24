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

- `_bmad-output/implementation-artifacts/spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md` -- file duy nhất bị sửa (2 dòng: Spec Change Log dòng 142, Verification dòng 153)

## Tasks & Acceptance

**Execution:**
- [x] `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:142` -- sửa "181/181" → "180/181" -- khớp với "1 fail pre-existing" thừa nhận ngay sau đó trong cùng câu
- [x] `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:153` -- thêm caveat "trừ 1 fail pre-existing đã biết ... tracked epic-2-retro-item-13" -- `## Verification` trước đó ghi "expected: toàn bộ test pass", mâu thuẫn với chính Change Log ngay phía trên

**Acceptance Criteria:**
- Given dòng 142 và dòng 153 của spec-3-3, when đọc cùng lúc với dòng 110 (nơi lần đầu ghi nhận fail pre-existing), then không còn phát biểu nào tự mâu thuẫn về việc "toàn bộ test pass" hay "181/181".

## Spec Change Log

<!-- Empty — one-shot route, không qua review loopback. -->

## Verification

**Manual checks (if no CLI):**
- Đọc lại `spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md` dòng 110, 142, 153 — cả 3 chỗ nhắc tới `installService.test.js` phải nhất quán (1 fail pre-existing, không liên quan, tracked `epic-2-retro-item-13`).

## Suggested Review Order

**Số liệu test mâu thuẫn (Change Log + Verification)**

- Sửa "181/181" → "180/181" cho khớp 1 fail pre-existing thừa nhận ngay trong câu.
  [`spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:142`](spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md#L142)

- Thêm caveat pre-existing-fail vào expected-result của lệnh test backend, cho nhất quán với Change Log phía trên.
  [`spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md:153`](spec-3-3-xác-nhận-tiếp-nhận-cảnh-báo-ack.md#L153)
