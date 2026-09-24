---
title: 'Xác thực & hoàn thiện accessibility không phụ thuộc màu đơn lẻ (AA)'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md']
baseline_commit: '5d69c52ef12199ae408d5c59ff635500946c86d8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khảo sát code cho thấy hầu hết state trên dashboard (alert-badge, channel-grid-cell, connection-banner) đã có icon/text kèm màu từ Epic 2/3, nhưng còn 2 khoảng trống AA cụ thể: (1) vu-meter fill bar chỉ báo mức âm hiện tại bằng gradient màu, không có tín hiệu phi-màu phân biệt zone normal/warning/critical; (2) viền `channel-grid-cell` ở trạng thái ok/loaded/skeleton chỉ đạt contrast ~1.33–1.49:1 so với nền (đo bằng công thức WCAG relative luminance) — dưới ngưỡng AA ≥3:1 cho ranh giới UI component, trong khi đây là dấu hiệu DUY NHẤT phân tách ô khỏi nền xung quanh.

**Approach:** Thêm marker glyph phi-màu (mirror cách alert-badge dùng icon+text) cho vu-meter khi mức âm vượt ngưỡng warning/peak. Thêm token màu riêng `--color-cell-border` đủ sáng (≥3:1 với cả `--color-surface-base` và `--color-surface-raised`) áp dụng cho border của `.cell`/`.ok`/`.loaded`/`.skeleton`, không đổi `--color-border` dùng ở nơi khác (ackLabel, detail-panel). Đo và ghi lại contrast thực tế của toàn bộ token màu đang dùng ở 4 component trong scope để xác nhận AA.

## Boundaries & Constraints

**Always:** Mọi state/cảnh báo hiện có (alert-badge, ChannelGridCell states, connection-banner) giữ nguyên hành vi/style, chỉ bổ sung phần còn thiếu. Token `--color-cell-border` mới phải đạt ≥3:1 với CẢ `surface-base` và `surface-raised`, tính bằng công thức WCAG relative luminance. Không tải font ngoài, không thêm animation/transition.

**Ask First:** Nếu không tìm được 1 giá trị cho `--color-cell-border` vừa đạt ≥3:1 với cả 2 nền vừa giữ tông xanh-xám nhất quán với `--color-border`/`--color-text-secondary` hiện có (ví dụ nếu buộc phải lệch hẳn sang tông màu khác) — HALT và hỏi người dùng trước khi đổi hue.

**Never:** Không đổi `--color-border` gốc (vẫn dùng ở ackLabel, detail-panel's `.panel`, `.skeleton`'s border-mix) — các nơi này biết vẫn <3:1, chấp nhận là gap ngoài scope, đã ghi ở `deferred-work.md`. Không thêm thư viện/tooling contrast-checking mới (axe, jest-axe...). Không đo/đổi font-size cho TV wall thật (đã defer, xem `deferred-work.md`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Audio level ở zone normal | percent < `AUDIO_LEVEL_WARNING_MARK_PERCENT` | Không hiện marker zone, chỉ fill gradient + 2 vạch ngưỡng cố định như hiện tại | N/A |
| Audio level vào zone warning | percent trong [warning, peak) | Marker/glyph phi-màu cho zone "warning" hiện cạnh vu-meter | N/A |
| Audio level vào zone critical/peak | percent ≥ `AUDIO_LEVEL_PEAK_MARK_PERCENT` | Marker/glyph khác hình dạng cho zone "critical" hiện | N/A |
| Cell trạng thái ok/loaded/skeleton | displayState='ok' hoặc chưa có state | Border dùng `--color-cell-border` mới, đạt ≥3:1 với nền | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-frontend/src/components/ChannelGridCell.tsx:283-321` -- vòng lặp render 2 vu-meter/kênh; `percent` (dòng 297) đã tính sẵn qua `dbfsToPercent`, `AUDIO_LEVEL_WARNING_MARK_PERCENT`/`AUDIO_LEVEL_PEAK_MARK_PERCENT` (dòng ~79-100) đã có sẵn để so sánh zone -- nơi thêm logic tính zone hiện tại + render marker glyph mới.
- `dashboard-frontend/src/components/ChannelGridCell.module.css:214-256` -- `.vuMeterFill` (gradient màu, dòng 214-237), `.thresholdMark`/`.thresholdMarkPeak` (dòng 245-256, luôn hiện, đánh dấu VỊ TRÍ ngưỡng chứ không phải trạng thái hiện tại) -- nơi thêm style cho marker zone mới, mirror pattern `.thresholdMarkPeak` phân biệt bằng hình dạng.
- `dashboard-frontend/src/components/ChannelGridCell.module.css:10-81` -- `.cell` (dòng 10-32, border hiện `var(--color-border)`), `.loaded`/`.ok` (dòng 47-53, 68-71, cùng border-color), `.skeleton` (dòng 55-62, border-mix từ `--color-border`) -- đổi border-color 3 rule này sang token mới; KHÔNG đổi `.warning`/`.critical` (dòng 73-81, đã dùng state-color riêng, đạt yêu cầu khác).
- `dashboard-frontend/src/styles/tokens.css:14` -- `--color-border: #223247` hiện có (L relative luminance ≈0.0308, contrast ~1.33-1.49:1 với 2 nền) -- nơi thêm token mới `--color-cell-border` cạnh token này, không sửa giá trị gốc.
- `dashboard-frontend/tests/ChannelGridCell.test.tsx:204-460` -- describe block "audioLevel / vu-meter (Story 2.5)", pattern RTL/Vitest sẵn có (`data-percent`, `data-testid` theo `channelId`/`side`) -- mở rộng test marker zone mới.

## Tasks & Acceptance

**Execution:**
- [x] `dashboard-frontend/src/styles/tokens.css` -- thêm `--color-cell-border` (giá trị đạt ≥3:1 với cả `surface-base` và `surface-raised`; cân nhắc tái dùng giá trị `--color-text-secondary` `#8ca0be` đã đo 7.26:1/6.51:1 thay vì bịa hex mới) -- fix AA cho ranh giới UI component duy nhất của channel-grid-cell.
- [x] `dashboard-frontend/src/components/ChannelGridCell.module.css` -- đổi border-color của `.cell`/`.loaded`/`.ok` và border-mix nguồn của `.skeleton` sang `var(--color-cell-border)`.
- [x] `dashboard-frontend/src/components/ChannelGridCell.tsx` -- tính zone (`normal`/`warning`/`critical`) từ `percent` so với 2 ngưỡng hiện có, render glyph marker phi-màu tương ứng cạnh mỗi vu-meter khi zone khác `normal`.
- [x] `dashboard-frontend/src/components/ChannelGridCell.module.css` -- style marker mới (vị trí theo `percent`, hình dạng phân biệt warning vs critical, mirror `.thresholdMarkPeak`).
- [x] `dashboard-frontend/tests/ChannelGridCell.test.tsx` -- test marker xuất hiện đúng khi `audioLevel` vượt ngưỡng warning/peak, ẩn khi ở zone normal; test border-color mới áp dụng trên cell `ok`/`loaded`.

**Acceptance Criteria:**
- Given mọi trạng thái ở alert-badge/vu-meter/channel-grid-cell/connection-banner, when kiểm tra, then đều có icon hoặc chữ kèm màu — không nơi nào chỉ dựa vào màu (kể cả vu-meter sau khi bổ sung marker).
- Given toàn bộ token màu đang dùng ở 4 component trong scope, when đo contrast theo công thức WCAG relative luminance, then đạt AA (chữ thường ≥4.5:1, đồ hoạ/border/focus-ring ≥3:1); `on-state-critical` xác nhận đúng 5.94:1.
- Given token `--color-cell-border` mới, when đo so với cả `surface-base` và `surface-raised`, then cả 2 đều ≥3:1.

### Review Findings

- [x] [Review][Patch] Marker zone vu-meter có thể che vạch ngưỡng cố định (`.thresholdMark`/`.thresholdMarkPeak`) khi `percent` đúng bằng 80%/95% (đúng 2 giá trị dBFS ngưỡng thật -12/-3 map ra) — marker (9-11px) paint sau trong DOM, đè lên vạch 1-2px cùng vị trí. Quyết định (2026-09-23): dịch marker lệch trục ngang khỏi vạch ngưỡng. Đã sửa: tách `.thresholdMark` (nửa trái cột) / `.vuMeterZoneMarker` (nửa phải cột) qua `--vu-meter-width` mới — 2 tín hiệu không còn chiếm cùng 1 điểm. [ChannelGridCell.module.css:199-206,268-279,297-330]
- [x] [Review][Dismissed] Marker zone vu-meter dùng lại đúng glyph `⚠`/`✕` của `alert-badge` — Quyết định (2026-09-23): giữ nguyên glyph, đúng theo Design Notes "mirror pattern" của spec, không cần đổi.
- [x] [Review][Patch] Màu marker zone cố định `var(--color-text-primary)` không đạt AA khi đè lên đúng nền màu warning/critical của `.vuMeterFill` tại vị trí nó luôn render (~1.55:1 đo được ở zone warning, ~3.09:1 sát ngưỡng chưa hề đo/ghi ở zone critical) — đúng loại lỗi AA mà chính story này sinh ra để vá. Đã sửa: nền/màu riêng theo zone (`--color-on-state-warning`/`--color-state-warning`, `--color-on-state-critical`/`--color-state-critical`, mirror `.badgeWarning`/`.badgeCritical`) qua class mới `.vuMeterZoneMarkerWarning`. [ChannelGridCell.module.css:297-330, ChannelGridCell.tsx:358-380]
- [x] [Review][Patch] Test mới "cell border token (Story 5.2)" chỉ khoá lại `className` có sẵn từ trước (`ok`/`loaded`/`skeleton`, không đổi trong diff), không khoá giá trị token/tỉ lệ color-mix thực tế đã đổi — revert `--color-cell-border`/tỉ lệ mix 65% về giá trị cũ vẫn 100% test xanh. Đã sửa: thêm describe "khoá qua CSS source" (3 test đọc thẳng source text `tokens.css`/`ChannelGridCell.module.css`). [ChannelGridCell.test.tsx:733-786]
- [x] [Review][Patch] AC2 yêu cầu đo & xác nhận contrast "toàn bộ token màu đang dùng ở 4 component" (kể cả câu xác nhận rõ "on-state-critical xác nhận đúng 5.94:1") nhưng Completion Notes hiện chỉ ghi 2/4 phép đo (channel-grid-cell border + skeleton mix) — thiếu xác nhận lại alert-badge/connection-banner và con số 5.94:1 theo đúng câu chữ AC2. Đã sửa: bổ sung bullet xác nhận đủ 4 component vào Completion Notes. [spec Completion Notes]
- [x] [Review][Patch] `6px` (bề rộng cột vu-meter) lặp lại độc lập ở 3 nơi (`.vuMeterWrapper`/`.vuMeter`/`.vuMeterZoneMarker`) — đúng loại lặp mà chính file này vừa tự sửa cho `--vu-meter-height` (comment dòng ~199-206); `.vuMeterZoneMarker` cũng set dư thừa cả `left`/`right`/`width` cùng lúc. Đã sửa: gộp về biến `--vu-meter-width` mới. [ChannelGridCell.module.css:199-235,297-330]

## Spec Change Log

## Design Notes

Chọn tạo token riêng `--color-cell-border` thay vì brighten `--color-border` toàn cục, để tránh ảnh hưởng `ackLabel`/detail-panel's `.panel` (đã ổn định qua nhiều story, ngoài scope AC của story này — xem `deferred-work.md` cho gap còn lại ở các nơi đó). Gợi ý tái dùng giá trị `--color-text-secondary` (`#8ca0be`) cho token mới: đã đo sẵn 7.26:1 (surface-base) / 6.51:1 (surface-raised), vượt xa ngưỡng 3:1, tránh phình thêm màu mới vào bảng token.

VU-meter marker dùng glyph Unicode nhỏ (mirror cách `alert-badge` dùng `⚠`/`✕`, `BADGE_LABEL`/`ChannelGridCell.tsx:38-44`) thay vì numeric readout dBFS/%, để giữ mật độ thị giác thấp trên lưới 20 ô.

## Verification

**Commands:**
- `cd dashboard-frontend && npm test` -- expected: toàn bộ test hiện có + test mới (marker zone, border token) pass.

**Manual checks:**
- Chạy `npm run dev`, xác nhận viền ô `ok`/`loaded` rõ hơn hẳn so với nền xung quanh (trước đây gần như vô hình). **[Chưa làm -- agent không có browser, cần người dùng tự xác nhận cảm quan.]**
- Kéo `audioLevel` qua ngưỡng warning/peak (qua fixture/dev tool hiện có), xác nhận marker xuất hiện và đổi hình dạng đúng zone. Đã cover qua test tự động (9 test case, xem Completion Notes); xác nhận cảm quan trên browser thật vẫn nên làm.
- Tính tay (hoặc dùng browser devtools contrast checker) xác nhận `--color-cell-border` đạt ≥3:1 với cả `surface-base` và `surface-raised`; ghi lại số đo trong Completion Notes khi đóng story. **[Đã làm, xem Completion Notes.]**

**Completion Notes:**
- Đo contrast `--color-cell-border` (alias `var(--color-text-secondary)`, `#8ca0be`) bằng công thức WCAG relative luminance: **7.264:1** so với `surface-base` (`#0a0e14`), **6.509:1** so với `surface-raised` (`#121b27`) -- cả 2 vượt ngưỡng AA ≥3:1.
- `.skeleton`'s border-mix (65%, sau patch review round 1): **3.674:1** so với `surface-base` -- 55% ban đầu chỉ đạt 2.953:1 (dưới AA), phát hiện qua code review, đã sửa.
- Code review round 1 (blind-hunter + edge-case-hunter + verification-gap, 3 layer song song): 8 finding patch được áp dụng (alias token thay vì literal hex trùng lặp; sửa comment overclaim reuse `BADGE_LABEL`; sửa comment lệch code (translateY); clamp marker's `bottom` ở 97% tránh tràn `overflow:hidden` khi percent≈100%; neo marker trong đúng cột 6px tránh 2 marker L/R đè nhau; thêm test khoá `className` `vuMeterZoneMarkerCritical`; tăng tỉ lệ color-mix skeleton 55%→65%; bổ sung entry `deferred-work.md` cho claim trước đó chưa có entry thật). 2 finding khác (thiếu aria-label cho marker; chưa đo phân biệt thị giác warning/critical trên TV wall thật) được defer -- cùng nhóm gap accessibility/TV-wall đã defer trước đó cho các component khác, ngoài AC của story này.
- `npm test`: 273/273 pass (9 test file, +1 test bổ sung cho clamp 97%). `npx tsc --noEmit`: sạch.
- Chưa xác nhận trực quan trên browser thật (không có môi trường browser lúc build) -- xem mục Manual checks phía trên.
- Code review round 2 (blind-hunter + edge-case-hunter + verification-gap + acceptance-auditor, 4 layer song song): 5 finding patch áp dụng thêm -- (1) marker zone vu-meter đè lên vạch ngưỡng cố định khi `percent` đúng bằng 80%/95%: tách `.thresholdMark` (nửa trái cột) và `.vuMeterZoneMarker` (nửa phải cột, qua `--vu-meter-width` mới) để 2 tín hiệu không còn chiếm cùng 1 điểm; (2) marker dùng `color: var(--color-text-primary)` cố định trong khi luôn đè lên đúng dải màu warning/critical của `.vuMeterFill` (đo được ~1.55:1 ở warning, dưới AA rất xa) -- đổi sang nền/màu riêng theo zone (`--color-on-state-warning`/`--color-state-warning`, `--color-on-state-critical`/`--color-state-critical`, mirror `.badgeWarning`/`.badgeCritical`); (3) test "cell border token" chỉ khoá `className` có sẵn, không khoá token/tỉ lệ CSS thực tế -- bổ sung 3 test đọc thẳng source text của `tokens.css`/`ChannelGridCell.module.css`; (4) hoàn thiện xác nhận AC2 (xem bullet dưới); (5) gộp `6px` (bề rộng cột vu-meter, lặp lại độc lập 3 nơi) về 1 biến `--vu-meter-width`. 1 finding dismiss theo quyết định người dùng (giữ nguyên glyph `⚠`/`✕` cho marker, đúng theo Design Notes "mirror pattern" -- không đổi glyph dù trùng với `BADGE_LABEL`).
- Xác nhận đầy đủ AC2 ("toàn bộ token màu đang dùng ở 4 component") bằng công thức WCAG relative luminance: `on-state-critical` (`#000000`) vs `state-critical` (`#ff3b3b`) = **5.94:1** (dùng ở `.badgeCritical` của alert-badge VÀ `ConnectionBanner.module.css`'s `.banner`, cả 2 cùng nền solid -- xác nhận đúng con số AC2 nêu). `on-state-warning` (`#241a00`) vs `state-warning` (`#f5b915`) = **9.68:1** (dùng ở `.badgeWarning`/`.thumbnailWarningIcon`). `on-state-ok` (`#eaf1fb`) vs `state-ok` solid (`#2f8fff`) chỉ **~2.8:1** (dưới AA) -- đây là lý do `.badgeOk` (code có sẵn từ Story 2.4, ngoài scope thay đổi của story này) cố ý dùng nền pha loãng 25% thay vì solid, đạt **~10.46:1** qua nền pha loãng đó (số liệu đã có sẵn trong comment tại `ChannelGridCell.module.css`'s `.badgeOk`).

## Suggested Review Order

**Border contrast token**

- Token mới alias `--color-text-secondary` (đã đo AA) thay vì literal hex riêng -- không thể lệch nhau âm thầm.
  [`tokens.css:26`](../../dashboard-frontend/src/styles/tokens.css#L26)

- `.cell` dùng token mới cho border -- ranh giới UI component duy nhất phân tách ô khỏi nền, trước đó chỉ ~1.33-1.49:1.
  [`ChannelGridCell.module.css:16`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L16)

- `.skeleton` dùng tỉ lệ mix 65% (không phải 55%) vì nền tối hơn (`surface-base`) cần đậm hơn để giữ AA.
  [`ChannelGridCell.module.css:71`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L71)

- `.ok` dùng cùng token -- không đụng `.warning`/`.critical` (đã có state-color riêng).
  [`ChannelGridCell.module.css:80`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L80)

**VU-meter zone marker (non-color indicator)**

- 3 zone tính từ `percent` so với 2 ngưỡng cố định có sẵn, check critical trước để không rơi nhầm nhánh warning.
  [`ChannelGridCell.tsx:114`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L114)

- Marker render tại vị trí `percent` hiện tại, `bottom` bị trần ở 97% để không tràn khỏi `overflow:hidden` của `.cell`.
  [`ChannelGridCell.tsx:360`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L360)

- Marker neo cứng trong đúng cột 6px (không tràn tự do) -- tránh 2 marker L/R đè nhau khi cả 2 kênh cùng vượt ngưỡng.
  [`ChannelGridCell.module.css:297`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L297)

- Class riêng cho critical -- to/đậm hơn warning để phân biệt bằng HÌNH DẠNG, không chỉ ký tự.
  [`ChannelGridCell.module.css:313`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L313)

**Test coverage**

- Test khoá border-class regression + 9 test case zone marker (biên inclusive, L/R độc lập, độc lập displayState, NaN/Infinity, className critical).
  [`ChannelGridCell.test.tsx:733`](../../dashboard-frontend/tests/ChannelGridCell.test.tsx#L733)
