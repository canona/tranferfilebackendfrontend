---
title: 'Story 2.5: VU meter & thumbnail/color-bars theo trạng thái'
type: 'feature'
created: '2026-09-06'
status: 'done'
baseline_commit: '32f71a7ec3989c33327b855cf8d624b26e2e40a4'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelGridCell` (Story 2.3/2.4) mới có viền/nền/`alert-badge` theo `displayState`; thân ô hoàn toàn trống — đội trực không thấy mức âm thanh thực tế hay hình ảnh kênh mà không mở panel chi tiết (chưa có ở Epic 3).

**Approach:** Thêm prop `audioLevel?: readonly [number, number]` (dBFS L/R, độc lập hoàn toàn `displayState`/debounce) cho `ChannelGridCell`, render 2 `vu-meter` với 2 vạch ngưỡng cố định; thêm vùng thumbnail hiển thị placeholder "hình thật" (chưa có pipeline snapshot thật từ backend) cho `ok`/`warning` (kèm icon cảnh báo khi `warning`), thay bằng color-bars tĩnh khi `critical`. Dữ liệu `audioLevel` đến từ fixture mới dao động theo thời gian (giả lập real-time) — giống pattern fixture của Story 2.4, KHÔNG nối WebSocket/backend thật (chưa có story nào định nghĩa forward `audioLevel`/snapshot qua WS-UI).

## Boundaries & Constraints

**Always:**
- Thang đo `audioLevel`: dBFS, khoảng hiển thị cố định **-60 → 0 dBFS**; `warning-mark` cố định tại **-12 dBFS**, `peak-mark` cố định tại **-3 dBFS** (đã chốt với người dùng) — map tuyến tính dBFS→% chiều cao; giá trị ngoài khoảng clamp về 0%/100%, không NaN/crash.
- `vu-meter` render + cập nhật bất kể `displayState`/debounce 5s — kể cả khi `critical`; chỉ ẩn khi `loaded=false` (skeleton, giữ nguyên convention Story 2.3). 2 vạch ngưỡng luôn hiển thị, vị trí cố định, không đổi theo giá trị hiện tại.
- Gradient `vu-meter` đúng 3 mốc màu DESIGN.md: `--color-audio-normal` (dưới warning-mark) → `--color-state-warning` (giữa 2 vạch) → `--color-state-critical` (trên peak-mark). KHÔNG dùng `--color-audio-normal` cho bất kỳ trạng thái kênh nào khác (2 hệ ngữ nghĩa tách biệt, DESIGN.md).
- Thumbnail: `ok`/`warning` dùng chung 1 placeholder thị giác (pattern xác định theo hash `channelId`, KHÔNG phải ảnh JPEG thật — chưa có pipeline snapshot qua WS-UI); `warning` chồng thêm icon cảnh báo lên trên; `critical` thay hoàn toàn bằng color-bars tĩnh (không chờ snapshot, không animation).
- `displayState` chưa xác định (loaded-neutral, Story 2.4 fallback) → KHÔNG render vùng thumbnail (tránh ngụ ý "ok" khi backend chưa phân loại); `vu-meter` vẫn render bình thường nếu có `audioLevel` (độc lập `displayState`).
- Không animation/transition trên lưới tổng quan (Epic 2 context) — vu-meter/thumbnail cập nhật giá trị tức thời.
- Dữ liệu `audioLevel` nguồn từ fixture MỚI dùng ở `page.tsx`, hàm thuần túy (không `Math.random` thật) để test được — không đọc/sửa `uiWsClient.ts`/`channelStore.ts`.
- Test mirror convention hiện có: Vitest + Testing Library, assert qua `data-*`/`getByTestId`, không assert class CSS Module.

**Ask First:** Nếu cần phân biệt thumbnail/color-bars riêng cho `subType: 'config-or-security-suspected'` (khác color-bars thường của `critical`) — DESIGN.md hiện chỉ định nghĩa 1 dạng color-bars duy nhất — HALT hỏi trước khi tự đặt biến thể mới.

**Never:** Nối WebSocket/backend thật cho `audioLevel`/snapshot (chưa có story nào định nghĩa forward qua WS-UI). Ảnh JPEG thật/snapshot thật. Đổi mapping ok/warning/critical (Story 2.1) hay component `alert-badge` (Story 2.4). Trạng thái `acknowledged` (Epic 3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mức âm bình thường | `loaded=true, audioLevel=[-30,-30]` | 2 thanh vu-meter hiện đúng % theo mapping -60..0, dưới `warning-mark` | N/A |
| Mức âm vượt peak | `audioLevel=[-1,-1]` | Thanh gần đầy, vẫn hiện đúng 2 vạch ngưỡng cố định không đổi vị trí | N/A |
| `audioLevel` ngoài khoảng thực tế | `audioLevel=[-70,3]` | Clamp về 0%/100% | Không crash/NaN |
| Kênh `critical` vẫn có âm | `displayState='critical', audioLevel=[-40,-5]` | vu-meter vẫn hiển thị đúng mức, KHÔNG bị ẩn/khoá theo trạng thái | N/A |
| `loaded=false` (skeleton) | `loaded=false` | Không render vu-meter/thumbnail, giữ skeleton hiện có | N/A |
| `displayState='warning'` | `loaded=true, displayState='warning'` | Thumbnail placeholder + icon cảnh báo chồng lên | N/A |
| `displayState='critical'` | `loaded=true, displayState='critical'` | Thumbnail thay hoàn toàn bằng color-bars tĩnh | N/A |
| `displayState=undefined` (loaded-neutral) | `loaded=true, displayState=undefined` | Không render thumbnail; vu-meter vẫn hiện nếu có `audioLevel` | N/A |

</frozen-after-approval>

## Code Map

- `dashboard-frontend/src/components/ChannelGridCell.tsx:60-121` -- thêm prop `audioLevel?: readonly [number, number]`; thêm hằng số ngưỡng (`-60/-12/-3/0` dBFS) + hàm map dBFS→%; render `.thumbnail`/`.colorBars` (gate theo `effectiveDisplayState`) và `.vuMeterRow` gồm 2 `.vuMeter` (gate theo `loaded`, độc lập `displayState`).
- `dashboard-frontend/src/components/ChannelGridCell.module.css:1-115` -- thêm `.thumbnail`, `.thumbnailWarningIcon`, `.colorBars`, `.vuMeterRow`, `.vuMeter`, `.vuMeterFill`, `.thresholdMark`, dùng token `--color-audio-normal`, `--color-state-warning`, `--color-state-critical` (`tokens.css:18-24`), `--radius-sm`, `--spacing-*`.
- `dashboard-frontend/src/components/ChannelGrid.tsx:13-71` -- thêm prop `channelAudioLevels: ReadonlyMap<string, readonly [number, number]>`, truyền `audioLevel={channelAudioLevels.get(channel.channelId)}` xuống mỗi cell (dòng 66).
- `dashboard-frontend/src/fixtures/channelAudioLevels.ts` (MỚI) -- hàm thuần `computeAudioLevelFixture(channelId, elapsedSeconds): readonly [number, number]`, dao động xác định (hash channelId + sin theo elapsedSeconds), clamp `[-60,0]`, không `Math.random` thật.
- `dashboard-frontend/app/page.tsx:1-46` -- thêm `useState`/`useEffect` với `setInterval` (~300ms) gọi `computeAudioLevelFixture` cho từng `channelId` hiện có → `channelAudioLevels`, cleanup interval; truyền xuống `ChannelGrid`.
- Tests: `dashboard-frontend/tests/ChannelGridCell.test.tsx`, `ChannelGrid.test.tsx` -- thêm case vu-meter/thumbnail/color-bars theo I/O matrix; test mới `dashboard-frontend/tests/channelAudioLevels.test.ts`.
- Tham chiếu (không sửa): `dashboard-backend/src/ports/TelemetryInboundPort.ts:31-43` (nguồn định dạng `audioLevel` dBFS [L,R]), DESIGN.md's `vu-meter`/`channel-grid-cell` (dòng 90-116, 218-223, 240).

## Tasks & Acceptance

**Execution:**
- [x] `ChannelGridCell.tsx` -- thêm prop `audioLevel`, render vu-meter + thumbnail/color-bars -- lõi hiển thị của story.
- [x] `ChannelGridCell.module.css` -- style vu-meter/thumbnail/color-bars theo token DESIGN.md -- khớp gradient 3 mốc + vạch ngưỡng.
- [x] `ChannelGrid.tsx` -- prop `channelAudioLevels`, truyền xuống cell -- wiring theo `channelId`.
- [x] `fixtures/channelAudioLevels.ts` -- hàm thuần dao động dBFS -- giả lập real-time, testable, không random thật.
- [x] `app/page.tsx` -- interval tick cập nhật `channelAudioLevels` -- cấp dữ liệu demo thời gian thực vì chưa nối WS thật.
- [x] Tests -- cover I/O matrix + `computeAudioLevelFixture` (clamp biên, deterministic) -- verify không hồi quy Story 2.3/2.4.

**Acceptance Criteria:**
- Given ô đã loaded và có `audioLevel`, when render, then 2 vu-meter cập nhật độc lập với debounce trạng thái, đúng gradient 3 mốc theo token.
- Given bất kỳ `audioLevel` nào, when render vu-meter, then 2 vạch ngưỡng cố định (-12dBFS, -3dBFS trên thang -60→0) luôn hiển thị, không di chuyển theo giá trị hiện tại.
- Given `displayState` đổi giữa `ok`/`warning`/`critical`, when re-render, then thumbnail đổi đúng theo bảng trạng thái, không animation/transition.

## Design Notes

Mapping dBFS→%: `percent = clamp((level - (-60)) / (0 - (-60)), 0, 1) * 100`; `warning-mark` = 80%, `peak-mark` = 95% (giá trị cố định, tính 1 lần, không phụ thuộc `audioLevel` hiện tại). Vu-meter fill dùng `linear-gradient` 3 dải màu cố định theo %, chiều cao fill thực tế che phủ theo `percent` hiện tại (giống LED bar cổ điển) — không cần đo pixel chính xác, chỉ cần đúng thứ tự màu/vị trí 2 vạch.

Thumbnail placeholder: dùng lại kiểu hash chuỗi thuần (như `channelDisplayStates.ts`) để chọn 1 màu/gradient cố định theo `channelId` — chỉ mục đích phân biệt trực quan các ô, KHÔNG mô phỏng ảnh camera thật. Color-bars: dải màu tĩnh dạng sọc dọc (kiểu test-pattern broadcast cổ điển), không dùng token màu trạng thái của app (đây là placeholder "mất tín hiệu", không phải UI theme).

`computeAudioLevelFixture` nhận `elapsedSeconds` làm tham số (không tự đọc `Date.now()` bên trong) để hàm thuần túy, test được bằng giá trị cố định; `page.tsx` tự truyền `elapsedSeconds` từ interval.

## Verification

**Commands:**
- `cd dashboard-frontend && npm test` -- expected: Vitest pass, cover đủ I/O matrix + `channelAudioLevels.test.ts`.
- `cd dashboard-frontend && npm run build` -- expected: Next.js production build sạch.

**Manual checks:**
- `npm run dev`, xác nhận vu-meter dao động mượt theo thời gian, 2 vạch ngưỡng đứng yên; thumbnail đổi đúng theo trạng thái (ok/warning giữ placeholder, warning có icon, critical là color-bars); không thấy animation/transition khi đổi trạng thái.

### Review Findings

- [x] [Review][Patch] `channelName` không đủ tương phản khi đè lên `.colorBars` ở trạng thái `critical` — `.channelName` dùng `--color-text-primary` (#eaf1fb, gần trắng), đứng z-index:1 trên `.colorBars` (7 dải SMPTE, dải đầu tiên #c0c0c0 xám sáng — RGB(192,192,192)). Contrast ratio ước tính ~1.6:1 (dưới AA 4.5:1 rất xa). `channelName` neo trái theo flex layout của `.cell`, đúng vị trí dải xám đầu tiên (0–14.28%) → tên đài gần như không đọc được đúng lúc kênh mất tín hiệu (`critical`). **Quyết định (code review):** thêm scrim/nền mờ phía sau `channelName`. **Đã fix:** thêm `background: color-mix(in srgb, var(--color-surface-base) 70%, transparent)` + padding/border-radius nhỏ. [`ChannelGridCell.module.css:63`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L63)
- [x] [Review][Patch] Thiếu test kết hợp `audioLevel` với `displayState='ok'`/`'warning'` — I/O matrix/Boundaries yêu cầu vu-meter độc lập với MỌI `displayState`, nhưng test suite chỉ có 1 case kết hợp cho `critical` (`chan-4`), không có case cho `ok`/`warning` cùng lúc có `audioLevel`. **Đã fix:** thêm 2 test case (`chan-4b` ok, `chan-4c` warning). [`ChannelGridCell.test.tsx:220-254`](../../dashboard-frontend/tests/ChannelGridCell.test.tsx#L220)
- [x] [Review][Patch] Hằng số `AUDIO_LEVEL_MIN_DBFS`/`AUDIO_LEVEL_MAX_DBFS` (-60/0) định nghĩa lặp lại độc lập ở 2 file — cùng loại trùng lặp mà PR này vừa fix cho hash (`hashString.ts`, finding #6 cũ), nhưng thang đo dBFS lại chưa gom về 1 module dùng chung; rủi ro lệch nếu sau này đổi khoảng đo mà chỉ sửa 1 bản. **Đã fix:** gom về `fixtures/audioLevelRange.ts` dùng chung. [`ChannelGridCell.tsx:64`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L64), [`channelAudioLevels.ts:13`](../../dashboard-frontend/src/fixtures/channelAudioLevels.ts#L13)
- [x] [Review][Patch] NaN-guard chưa nhất quán trong pipeline audioLevel — `clampDbfs` (`channelAudioLevels.ts`) không có guard `NaN` tường minh như `dbfsToPercent` (sibling), và `audioLevel[index]!` (`ChannelGridCell.tsx`) giả định tuple luôn đủ 2 phần tử hợp lệ. Hiện chưa thể kích hoạt được (Never: chưa nối WS/backend thật trong story này, `elapsedSeconds` luôn hữu hạn từ `Date.now()`), nhưng nên thêm guard nhất quán trước khi Story 2.6 nối `audioLevel` qua WS thật (dữ liệu mạng có thể malformed). **Đã fix:** thêm guard `Number.isNaN` trong `clampDbfs`; thay `audioLevel[index]!` bằng kiểm tra `typeof === 'number'` tường minh. [`channelAudioLevels.ts:34`](../../dashboard-frontend/src/fixtures/channelAudioLevels.ts#L34), [`ChannelGridCell.tsx:224`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L224)

## Suggested Review Order

**Mapping dBFS → % & 2 vạch ngưỡng cố định (lõi thuật toán vu-meter)**

- Entry point: `dbfsToPercent` — thang cố định -60→0 dBFS, guard `NaN` (patch review: hẹp lại từ `!isFinite` để `±Infinity` clamp đúng 0%/100% thay vì luôn về 0).
  [`ChannelGridCell.tsx:79`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L79)

- Hằng số ngưỡng dBFS đã chốt cùng người dùng (-12/-3) và vị trí % tính 1 lần, không phụ thuộc `audioLevel` hiện tại.
  [`ChannelGridCell.tsx:70`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L70)

- Render 2 vu-meter — gate CHỈ theo `loaded`/`audioLevel`, độc lập hoàn toàn `effectiveDisplayState`/debounce.
  [`ChannelGridCell.tsx:213`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L213)

- Gradient 3 mốc màu + 2 vạch ngưỡng, neo `background-size`/height qua 1 custom property dùng chung (code review [patch, finding #5] — trước đây `44px` lặp lại rời rạc 3 nơi).
  [`ChannelGridCell.module.css:160`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L160)

**Thumbnail/color-bars theo trạng thái**

- Gate thumbnail/color-bars theo `effectiveDisplayState` — `critical` thay hoàn toàn bằng color-bars, `undefined` (loaded-neutral) không render gì.
  [`ChannelGridCell.tsx:180`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L180)

- Color-bars tĩnh (7 dải SMPTE hard-code), KHÔNG dùng token màu trạng thái app.
  [`ChannelGridCell.module.css:127`](../../dashboard-frontend/src/components/ChannelGridCell.module.css#L127)

**Layout fix (code review [patch, finding #1])**

- `channelName` phải render TRƯỚC `vuMeterRow` trong JSX — `.vuMeterRow`'s `margin-left:auto` từng kéo dồn cả tên đài sang phải khi đứng sau.
  [`ChannelGridCell.tsx:208`](../../dashboard-frontend/src/components/ChannelGridCell.tsx#L208)

**Fixture giả lập real-time (audioLevel)**

- Baseline PHẢI nằm trong khoảng an toàn `[MIN+AMPLITUDE, MAX-AMPLITUDE]` (code review [patch, finding #2] — công thức cũ để ~37.5% kênh clamp phẳng đáy 1 phần chu kỳ).
  [`channelAudioLevels.ts:31`](../../dashboard-frontend/src/fixtures/channelAudioLevels.ts#L31)

- Hàm thuần `computeAudioLevelFixture` — dao động sin xác định theo hash + elapsedSeconds, không `Math.random`/`Date.now()` nội bộ.
  [`channelAudioLevels.ts:49`](../../dashboard-frontend/src/fixtures/channelAudioLevels.ts#L49)

- Thuật toán hash chuỗi dùng CHUNG (code review [patch, finding #6] — trước đây copy-paste độc lập 3 nơi).
  [`hashString.ts:9`](../../dashboard-frontend/src/fixtures/hashString.ts#L9)

- `page.tsx`: interval ~300ms tính `elapsedSeconds`, cleanup khi unmount, build `channelAudioLevels` Map theo đúng `channelId`.
  [`page.tsx:60`](../../dashboard-frontend/app/page.tsx#L60)

**Wiring qua `ChannelGrid`**

- Prop `channelAudioLevels` truyền xuống đúng cell theo `channelId`, độc lập `channelDisplayStates`.
  [`ChannelGrid.tsx:77`](../../dashboard-frontend/src/components/ChannelGrid.tsx#L77)

**Peripherals**

- Test mới xác nhận wiring `page.tsx` qua fake timers (code review [patch, finding #3]) — `elapsedSeconds` đổi theo tick, map đúng `channelId`, cleanup khi unmount.
  [`page.test.tsx:1`](../../dashboard-frontend/tests/page.test.tsx#L1)

- Test `computeAudioLevelFixture`: deterministic, clamp biên, dao động theo thời gian, lệch pha L/R.
  [`channelAudioLevels.test.ts:10`](../../dashboard-frontend/tests/channelAudioLevels.test.ts#L10)

- Test I/O matrix đầy đủ cho vu-meter/thumbnail/color-bars + case `NaN`/`Infinity` (code review [patch, finding #4]) + case thứ tự DOM `channelName`/`vuMeterRow` (finding #1).
  [`ChannelGridCell.test.tsx:123`](../../dashboard-frontend/tests/ChannelGridCell.test.tsx#L123)

- Test `ChannelGrid` truyền đúng `channelAudioLevels` xuống từng cell theo `channelId`.
  [`ChannelGrid.test.tsx:171`](../../dashboard-frontend/tests/ChannelGrid.test.tsx#L171)
