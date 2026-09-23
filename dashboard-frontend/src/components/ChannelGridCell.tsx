// Story 2.3: `channel-grid-cell` - 1 ô kênh trong lưới tổng quan. Boundaries:
// "channel-grid-cell suy row/col từ grid_position qua Math.floor(pos/5)/
// pos%5; luôn render đủ 20 ô đúng vị trí, không phụ thuộc thứ tự event."
//
// Story 2.3 CHỈ có 2 trạng thái thị giác: `skeleton` (chưa nhận telemetry
// nào) và `loaded-neutral` (đã nhận `channel-seen`, CHƯA có màu trạng thái
// ok/warning/critical/badge). `loaded-neutral` dùng ĐÚNG token của state `ok`
// trong DESIGN.md's `channel-grid-cell.states.ok` (border={colors.border},
// background={colors.surface-raised}) - đây vốn là style "trung tính" mặc
// định của DESIGN.md, không phải màu ngữ nghĩa "OK".
//
// Story 2.4: thêm prop `displayState` (ok/warning/critical, tính sẵn ở
// backend - Never: "đổi mapping tính toán ok/warning/critical ở backend").
// `displayState` chỉ có hiệu lực khi `loaded=true` (Boundaries) - đổi màu
// viền/nền theo đúng token DESIGN.md + luôn render `alert-badge` (nền màu +
// text, KHÔNG bao giờ chỉ 1 khối màu trơn - DESIGN.md's alert-badge). Thiếu
// `displayState` dù đã loaded -> fallback style loaded-neutral hiện có của
// Story 2.3, KHÔNG render badge (I/O matrix).
//
// Story 2.5: thêm prop `audioLevel` (dBFS [L, R], độc lập HOÀN TOÀN
// `displayState`/debounce - Boundaries: "vu-meter render + cập nhật bất kể
// displayState/debounce 5s ... chỉ ẩn khi loaded=false"). Thêm vùng
// thumbnail/color-bars gate theo `effectiveDisplayState` (KHÔNG render khi
// loaded-neutral - I/O matrix: "displayState chưa xác định -> KHÔNG render
// vùng thumbnail").

import styles from './ChannelGridCell.module.css';
import { hashString } from '../fixtures/hashString';
import { AUDIO_LEVEL_MIN_DBFS, AUDIO_LEVEL_MAX_DBFS } from '../fixtures/audioLevelRange';

const GRID_COLUMNS = 5;

// Đúng 3 giá trị theo backend `AlertOutboundPort.ts`'s `DisplayState` (AD-11
// mapping) - Boundaries: "khớp đúng ... không tự đặt tên khác" để Story 2.6
// tái sử dụng nguyên type này khi nối WebSocket/channelStore thật.
export type DisplayState = 'ok' | 'warning' | 'critical';

// DESIGN.md's `alert-badge`: "luôn có cả màu nền VÀ chữ/icon" - literal đúng
// nguyên văn, dùng ký tự Unicode có sẵn trong string (⚠/✕), không icon-lib.
const BADGE_LABEL: Record<DisplayState, string> = {
  ok: 'OK',
  warning: '⚠ ABR',
  critical: '✕ MẤT TÍN HIỆU',
};

// Story 2.7 (Boundaries): "khi effectiveDisplayState==='critical' VÀ
// subType==='machine-offline', badge dùng label riêng (khác '✕ MẤT TÍN HIỆU')
// nhưng NGUYÊN style/token critical" - phân biệt rõ "máy trung tâm treo/chết"
// (lỗi phần cứng/phần mềm tại trung tâm) với "mất tín hiệu SRT" thường
// (RECONNECTING/REJECTED), dù cả 2 cùng hiển thị màu critical.
const MACHINE_OFFLINE_BADGE_LABEL = '✕ TRUNG TÂM LỖI';

// `noUncheckedIndexedAccess` khiến truy cập qua index signature của CSS
// Modules (`styles.xyz`) trả về `string | undefined` dù luôn có giá trị thật
// (class được định nghĩa cứng trong `ChannelGridCell.module.css`) - fallback
// `?? ''` chỉ để thỏa kiểu, không thay đổi hành vi runtime.
const BADGE_CLASS: Record<DisplayState, string> = {
  ok: styles.badgeOk ?? '',
  warning: styles.badgeWarning ?? '',
  critical: styles.badgeCritical ?? '',
};

const CELL_STATE_CLASS: Record<DisplayState, string> = {
  ok: styles.ok ?? '',
  warning: styles.warning ?? '',
  critical: styles.critical ?? '',
};

// Design Notes: "Mapping dBFS→%: percent = clamp((level - (-60)) / (0 -
// (-60)), 0, 1) * 100" - thang cố định -60..0 dBFS (Boundaries: "khoảng hiển
// thị cố định -60 -> 0 dBFS"), ngoài khoảng clamp về 0%/100%, không NaN/crash.
// Code review [patch]: hằng số thang đo (`AUDIO_LEVEL_MIN_DBFS`/`MAX_DBFS`)
// dùng chung `fixtures/audioLevelRange.ts` - trước đây định nghĩa lặp lại
// độc lập tại đây và `channelAudioLevels.ts`.
// Boundaries: "warning-mark cố định tại -12 dBFS, peak-mark cố định tại -3
// dBFS (đã chốt với người dùng)" - 2 mốc dùng chung công thức map dBFS->% ở
// dưới, tính 1 LẦN (hằng số module-level), không phụ thuộc audioLevel hiện
// tại của bất kỳ ô nào.
const AUDIO_LEVEL_WARNING_MARK_DBFS = -12;
const AUDIO_LEVEL_PEAK_MARK_DBFS = -3;

// Hàm thuần map dBFS -> % chiều cao hiển thị trên vu-meter. `±Infinity` tự
// clamp đúng về 0%/100% qua chính công thức Math.min/Math.max bên dưới (dùng
// chung logic clamp, không cần case riêng) - CHỈ `NaN` cần guard tường minh:
// Math.max(0, NaN)/Math.min(1, NaN) đều trả về NaN (theo spec ECMAScript,
// mọi so sánh với NaN là false), nếu không chặn sớm sẽ lộ ra "NaN%" trên UI
// thay vì clamp về 0 (Boundaries: "không NaN/crash").
function dbfsToPercent(level: number): number {
  if (Number.isNaN(level)) {
    return 0;
  }
  const ratio = (level - AUDIO_LEVEL_MIN_DBFS) / (AUDIO_LEVEL_MAX_DBFS - AUDIO_LEVEL_MIN_DBFS);
  return Math.min(1, Math.max(0, ratio)) * 100;
}

// Vị trí 2 vạch ngưỡng cố định (tính 1 lần từ hằng số dBFS ở trên, KHÔNG phụ
// thuộc audioLevel hiện tại - Boundaries: "vị trí cố định, không đổi theo giá
// trị hiện tại"). Design Notes: warning-mark = 80%, peak-mark = 95%.
const AUDIO_LEVEL_WARNING_MARK_PERCENT = dbfsToPercent(AUDIO_LEVEL_WARNING_MARK_DBFS);
const AUDIO_LEVEL_PEAK_MARK_PERCENT = dbfsToPercent(AUDIO_LEVEL_PEAK_MARK_DBFS);

const VU_METER_SIDES = ['left', 'right'] as const;
type VuMeterSide = (typeof VU_METER_SIDES)[number];

// Story 5.2 (spec-5-2): vu-meter fill hiện chỉ báo mức âm bằng gradient màu
// (audio-normal->state-warning->state-critical) - KHÔNG có tín hiệu phi-màu
// nào phân biệt zone hiện tại (AA gap, epic-5-context's UX gap). 3 zone tính
// từ `percent` so với đúng 2 ngưỡng cố định đã có (`AUDIO_LEVEL_WARNING_MARK_
// PERCENT`/`AUDIO_LEVEL_PEAK_MARK_PERCENT`, dòng ~99-100) - I/O matrix: "percent
// trong [warning, peak) -> warning; percent >= peak -> critical", check
// critical TRƯỚC (>= peak) để không rơi nhầm vào nhánh warning.
type VuMeterZone = 'normal' | 'warning' | 'critical';

function vuMeterZone(percent: number): VuMeterZone {
  if (percent >= AUDIO_LEVEL_PEAK_MARK_PERCENT) {
    return 'critical';
  }
  if (percent >= AUDIO_LEVEL_WARNING_MARK_PERCENT) {
    return 'warning';
  }
  return 'normal';
}

// Design Notes: "glyph Unicode nhỏ (mirror alert-badge's ⚠/✕)" thay vì numeric
// readout dBFS/% - giữ mật độ thị giác thấp trên lưới 20 ô. Glyph giống hệt
// ký tự dùng trong `BADGE_LABEL` (⚠/✕) nhưng khai báo hằng riêng ở đây vì
// `BADGE_LABEL`'s giá trị là cả cụm text ('⚠ ABR', '✕ MẤT TÍN HIỆU'), không
// phải chỉ glyph - không thể tái dùng trực tiếp literal đó cho marker nhỏ này.
const VU_METER_ZONE_MARKER_LABEL: Record<'warning' | 'critical', string> = {
  warning: '⚠',
  critical: '✕',
};

// Design Notes: "dùng lại kiểu hash chuỗi thuần (mirror `channelDisplayStates.ts`
// cũ của Story 2.4, đã xoá ở Story 2.6) để chọn 1 màu/gradient cố định theo
// channelId - chỉ mục đích phân biệt trực quan các ô, KHÔNG mô phỏng ảnh
// camera thật." Code review [patch, finding #6]: thuật toán hash dùng chung
// `fixtures/hashString.ts` (trước đây định nghĩa lại y hệt tại đây -
// copy-paste 3 nơi độc lập, rủi ro lệch hành vi nếu chỉ sửa 1 bản).
//
// Gradient tĩnh 2 tông hue lệch nhau, xác định hoàn toàn theo channelId - chỉ
// để phân biệt ô bằng mắt (Boundaries: "KHÔNG phải ảnh JPEG thật"), không
// dùng token màu trạng thái app (2 hệ ngữ nghĩa tách biệt).
function thumbnailBackground(channelId: string): string {
  const hash = hashString(channelId);
  const hueA = hash % 360;
  const hueB = (hueA + 40) % 360;
  return `linear-gradient(135deg, hsl(${hueA}, 40%, 24%), hsl(${hueB}, 35%, 15%))`;
}

export function gridPositionToRowCol(gridPosition: number): { row: number; col: number } {
  return {
    row: Math.floor(gridPosition / GRID_COLUMNS),
    col: gridPosition % GRID_COLUMNS,
  };
}

export interface ChannelGridCellProps {
  channelId: string;
  stationName: string;
  gridPosition: number;
  // false = skeleton (chưa nhận telemetry); true = loaded-neutral (đã nhận
  // channel-seen NGAY khi có telemetry đầu tiên, không chờ đủ 20 kênh).
  loaded: boolean;
  // Story 2.4: trạng thái ok/warning/critical đã tính sẵn (fixture ở story
  // này, backend/WS thật ở Story 2.6). Chỉ có hiệu lực khi loaded=true.
  displayState?: DisplayState;
  // Story 2.5: dBFS [L, R] - độc lập HOÀN TOÀN displayState/debounce (Never:
  // "nối WebSocket/backend thật cho audioLevel" - đến từ fixture mới ở
  // page.tsx). Thiếu (undefined) -> không render vu-meter (component vẫn hoạt
  // động bình thường không có prop này, tương thích ngược với test cũ).
  audioLevel?: readonly [number, number];
  // Story 2.7: CHỈ có giá trị 'machine-offline' (Never: "Render/xử lý subType
  // 'config-or-security-suspected' trên UI" - vẫn treo Ask First từ Story
  // 2.4/2.6, ngoài scope). Chỉ có hiệu lực khi effectiveDisplayState==='critical'.
  subType?: 'machine-offline';
  // Bổ sung video-preview thật (AD-22): data-URI JPEG sẵn dùng
  // (`data:image/jpeg;base64,...`, đã build sẵn ở channelStore.ts). Thiếu
  // (undefined) -> fallback gradient placeholder hiện có (thumbnailBackground)
  // - trạng thái "đang tải ảnh" trước khi kênh có snapshot thật đầu tiên,
  // không phải trạng thái lỗi. Chỉ có hiệu lực khi effectiveDisplayState là
  // 'ok'/'warning' (nhánh 'critical' luôn dùng color-bars, bất kể prop này).
  snapshotDataUri?: string;
  // Story 3.3: nhãn ack hiện tại (`channelStore.ts`'s `channelAck.get(channelId)`).
  // Có mặt (string) -> đổi border sang dashed + hiện `ack-label` góc trên-phải
  // (Boundaries: KHÔNG đổi màu nền/viền/badge gốc). Thiếu (undefined) -> ô
  // hiển thị hoàn toàn như cũ (chưa ack/đã tự xoá).
  ackLabel?: string;
  // Story 3.2: click BẤT KỲ đâu trên ô gọi `onSelect(channelId)` - mở đúng
  // `detail-panel` của kênh đó (Boundaries/Epic 3 context). Optional - thiếu
  // (undefined) giữ nguyên hành vi cũ (không click được), tương thích ngược
  // với test cũ.
  onSelect?: (channelId: string) => void;
}

export function ChannelGridCell({
  channelId,
  stationName,
  gridPosition,
  loaded,
  displayState,
  audioLevel,
  subType,
  snapshotDataUri,
  ackLabel,
  onSelect,
}: ChannelGridCellProps) {
  const { row, col } = gridPositionToRowCol(gridPosition);
  // `displayState` chỉ có hiệu lực khi đã loaded (Boundaries) - undefined khi
  // skeleton hoặc khi thiếu displayState dù đã loaded (fallback loaded-neutral).
  const effectiveDisplayState = loaded ? displayState : undefined;
  // Story 2.7: chỉ thực sự "machine-offline" khi ĐANG hiển thị critical (badge
  // riêng không có ý nghĩa gì ở ok/warning/loaded-neutral/skeleton).
  const isMachineOffline = effectiveDisplayState === 'critical' && subType === 'machine-offline';
  // Story 3.3: gate theo `loaded` (mirror cách `.channelName`/badge đã gate) -
  // dù `ackLabel` không reachable thực tế khi `!loaded` (ack chỉ tới sau khi
  // kênh đã warning/critical, tức đã loaded từ lâu), giữ nhất quán pattern gate
  // hiện có của component thay vì để 1 ngoại lệ ngầm.
  const showAck = loaded && ackLabel !== undefined;

  const cellStateClass = !loaded
    ? styles.skeleton
    : effectiveDisplayState
      ? CELL_STATE_CLASS[effectiveDisplayState]
      : styles.loaded;

  return (
    <div
      className={`${styles.cell} ${cellStateClass}${showAck ? ` ${styles.acknowledged ?? ''}` : ''}`}
      // DESIGN.md's channel-grid: "vị trí theo đài không đổi" - đặt tường
      // minh grid-row/grid-column theo gridPosition (KHÔNG dựa vào thứ tự
      // DOM/mảng channels), CSS Grid tự đặt đúng ô bất kể thứ tự render.
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
      role="gridcell"
      // Story 3.2: click BẤT KỲ đâu trên ô mở detail-panel của đúng kênh đó
      // (Boundaries) - `onSelect` optional, thiếu thì không gắn gì thêm (no-op
      // an toàn qua `?.`).
      onClick={() => onSelect?.(channelId)}
      // Code review round 2 [patch #4]: ô kênh giờ có hành vi click mới (mở
      // detail-panel) nên phải thao tác được bằng bàn phím (Epic 3 context's
      // Accessibility: "cần tương thích ngay từ Epic 3") - `tabIndex={0}` chỉ
      // khi có `onSelect` (thiếu onSelect = ô không tương tác, giữ nguyên
      // hành vi cũ, không đưa vào thứ tự Tab để tránh dừng vô nghĩa).
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                // Space mặc định cuộn trang - phải preventDefault trước khi
                // kích hoạt onSelect (mirror hành vi nút bấm chuẩn).
                event.preventDefault();
                onSelect(channelId);
              }
            }
          : undefined
      }
      // `stationName` rỗng = placeholder chưa có dữ liệu registry thật (code
      // review [patch], xem `ChannelGrid.tsx`'s `placeholderChannels()`) -
      // dùng nhãn chung "Đang tải kênh" thay vì " - đang tải" (leading space
      // vô nghĩa khi station_name rỗng).
      aria-label={loaded ? stationName : stationName ? `${stationName} - đang tải` : 'Đang tải kênh'}
      aria-busy={!loaded}
      data-testid={`channel-grid-cell-${channelId}`}
      data-channel-id={channelId}
      data-grid-position={gridPosition}
      data-state={loaded ? 'loaded-neutral' : 'skeleton'}
      data-display-state={effectiveDisplayState}
      data-sub-type={isMachineOffline ? 'machine-offline' : undefined}
    >
      {/* I/O matrix: "displayState=undefined (loaded-neutral) -> KHÔNG render
          vùng thumbnail (tránh ngụ ý 'ok' khi backend chưa phân loại)" -
          effectiveDisplayState đã là undefined khi !loaded, nên gate này tự
          động cũng ẩn khi skeleton. */}
      {effectiveDisplayState === 'critical' ? (
        <div className={styles.colorBars} data-testid={`color-bars-${channelId}`} aria-hidden="true" />
      ) : effectiveDisplayState ? (
        <div
          className={styles.thumbnail}
          data-testid={`thumbnail-${channelId}`}
          // Bổ sung video-preview thật (AD-22): dùng ảnh thật khi đã có
          // (`data:image/jpeg;base64,...`, build sẵn ở channelStore.ts) -
          // KHÔNG có (chưa nhận snapshot đầu tiên/kênh) -> fallback gradient
          // giả hiện có, đóng vai trò "đang tải ảnh" thay vì thêm 1 trạng
          // thái/nhánh render mới.
          style={{ backgroundImage: snapshotDataUri ? `url("${snapshotDataUri}")` : thumbnailBackground(channelId) }}
          aria-hidden="true"
        >
          {effectiveDisplayState === 'warning' ? (
            <span
              className={styles.thumbnailWarningIcon}
              data-testid={`thumbnail-warning-icon-${channelId}`}
            >
              ⚠
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Code review [patch, finding #1]: `channelName` phải render TRƯỚC
          `vuMeterRow` trong JSX. `.cell` là flex row + `.vuMeterRow` có
          `margin-left: auto` - margin đó hấp thụ khoảng trống bên TRÁI chính
          nó, đẩy CHÍNH NÓ và mọi flex item đứng SAU nó trong DOM sang phải.
          Nếu vuMeterRow render trước, channelName (đứng sau) cũng bị đẩy dồn
          sang phải theo, để trống toàn bộ khoảng trái ô thay vì "tên đài neo
          trái/vu-meter neo phải" như ý đồ thiết kế. `badge` không bị ảnh
          hưởng vì đã `position: absolute` (thoát khỏi flow flex). */}
      {loaded ? <span className={styles.channelName}>{stationName}</span> : null}

      {/* Boundaries: "vu-meter render + cập nhật bất kể displayState/debounce
          5s - kể cả khi critical; chỉ ẩn khi loaded=false" - gate CHỈ theo
          `loaded`/`audioLevel`, độc lập hoàn toàn effectiveDisplayState. */}
      {loaded && audioLevel ? (
        <div className={styles.vuMeterRow} data-testid={`vu-meter-row-${channelId}`}>
          {VU_METER_SIDES.map((side: VuMeterSide, index) => {
            // Code review [patch]: `noUncheckedIndexedAccess` khiến truy cập
            // qua index trả về `T | undefined` dù kiểu tuple [number, number]
            // đảm bảo tĩnh luôn có 2 phần tử. `audioLevel[index]!` trước đây
            // giả định đúng điều đó vô điều kiện - an toàn với dữ liệu từ
            // fixture thuần hiện tại, nhưng Story 2.6 sẽ nối `audioLevel` qua
            // WebSocket thật (dữ liệu mạng/JSON.parse có thể không khớp kiểu
            // tĩnh). Guard tường minh ở đây để giá trị non-number lộ ra thành
            // "0%"/"NaN" có kiểm soát qua `dbfsToPercent`, không phải crash im
            // lặng do đọc `undefined` đã bị ép kiểu `number`.
            const rawLevel = audioLevel[index];
            const safeLevel = typeof rawLevel === 'number' ? rawLevel : NaN;
            const percent = dbfsToPercent(safeLevel);
            const zone = vuMeterZone(percent);
            return (
              // Story 5.2: wrapper mới (`.vuMeterWrapper`, KHÔNG overflow:
              // hidden) bọc ngoài `.vuMeter` - marker zone là SIBLING của
              // `.vuMeter` (không phải con) để không bị chính overflow:hidden
              // của `.vuMeter` cắt mất khi tràn ra ngoài bề rộng 6px cố định.
              // `.vuMeter` giữ NGUYÊN testid/data-* hiện có (không đổi hành vi
              // test cũ).
              <div key={side} className={styles.vuMeterWrapper}>
                <div
                  className={styles.vuMeter}
                  data-testid={`vu-meter-${side}-${channelId}`}
                  data-level-dbfs={safeLevel}
                  data-percent={percent}
                >
                  <div className={styles.vuMeterFill} style={{ height: `${percent}%` }} />
                  <span
                    className={styles.thresholdMark}
                    data-testid={`vu-meter-${side}-warning-mark-${channelId}`}
                    style={{ bottom: `${AUDIO_LEVEL_WARNING_MARK_PERCENT}%` }}
                  />
                  <span
                    className={`${styles.thresholdMark} ${styles.thresholdMarkPeak ?? ''}`}
                    data-testid={`vu-meter-${side}-peak-mark-${channelId}`}
                    style={{ bottom: `${AUDIO_LEVEL_PEAK_MARK_PERCENT}%` }}
                  />
                </div>
                {/* I/O matrix: zone='normal' -> KHÔNG hiện marker (chỉ fill +
                    2 vạch ngưỡng cố định như hiện tại). zone='warning'/
                    'critical' -> hiện glyph phi-màu, vị trí bám theo `percent`
                    hiện tại (khác 2 vạch ngưỡng cố định ở trên). */}
                {zone !== 'normal' ? (
                  <span
                    // Code review [patch]: nền/màu riêng theo zone (thay
                    // `color: text-primary` cố định) - mirror cách
                    // `BADGE_CLASS`/`CELL_STATE_CLASS` tra theo trạng thái ở
                    // trên, đảm bảo contrast bất kể marker đang đè lên dải
                    // màu nào của `.vuMeterFill` (xem module.css).
                    className={`${styles.vuMeterZoneMarker ?? ''} ${zone === 'critical' ? (styles.vuMeterZoneMarkerCritical ?? '') : (styles.vuMeterZoneMarkerWarning ?? '')}`}
                    data-testid={`vu-meter-${side}-zone-marker-${channelId}`}
                    data-zone={zone}
                    // Code review [patch #4]: CHỈ clamp vị trí HIỂN THỊ của
                    // marker (bottom style), KHÔNG đụng `percent`/`zone` dùng
                    // để tính `.vuMeterFill`'s height hay `data-zone` - ở mức
                    // gần/đúng 100% (vd audioLevel Infinity/clipping),
                    // `bottom:100%` cộng `translateY(50%)` vẫn đẩy glyph
                    // chồm lên trên mép `.vuMeterWrapper`, có thể bị `.cell`'s
                    // `overflow:hidden` cắt mất. Trần 97% chừa đủ chỗ cho nửa
                    // trên glyph (font-size 9-11px) nằm trong wrapper.
                    style={{ bottom: `${Math.min(percent, 97)}%` }}
                  >
                    {VU_METER_ZONE_MARKER_LABEL[zone]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {effectiveDisplayState ? (
        <span
          // Story 2.7 (Boundaries): "vẫn NGUYÊN style/token critical" - class
          // luôn tra theo `effectiveDisplayState` (không đổi khi machine-offline),
          // CHỈ label text khác.
          className={`${styles.badge} ${BADGE_CLASS[effectiveDisplayState]}`}
          data-testid={`alert-badge-${channelId}`}
        >
          {isMachineOffline ? MACHINE_OFFLINE_BADGE_LABEL : BADGE_LABEL[effectiveDisplayState]}
        </span>
      ) : null}

      {/* Story 3.3 (Boundaries): "✓ Đã nhận: {operator_label}" nguyên văn, góc
          trên-phải (khác góc của `.badge`, không đè lên) - CHỈ đổi border-style
          sang dashed + hiện nhãn này, KHÔNG đổi màu nền/viền/badge gốc. */}
      {showAck ? (
        <span className={styles.ackLabel} data-testid={`ack-label-${channelId}`}>
          ✓ Đã nhận: {ackLabel}
        </span>
      ) : null}
    </div>
  );
}
