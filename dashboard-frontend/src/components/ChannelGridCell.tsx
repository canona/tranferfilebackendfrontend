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
const AUDIO_LEVEL_MIN_DBFS = -60;
const AUDIO_LEVEL_MAX_DBFS = 0;
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

// Design Notes: "dùng lại kiểu hash chuỗi thuần (như channelDisplayStates.ts)
// để chọn 1 màu/gradient cố định theo channelId - chỉ mục đích phân biệt trực
// quan các ô, KHÔNG mô phỏng ảnh camera thật." Code review [patch, finding
// #6]: thuật toán hash dùng chung `fixtures/hashString.ts` (trước đây định
// nghĩa lại y hệt tại đây - copy-paste 3 nơi độc lập, rủi ro lệch hành vi nếu
// chỉ sửa 1 bản).
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
}

export function ChannelGridCell({
  channelId,
  stationName,
  gridPosition,
  loaded,
  displayState,
  audioLevel,
}: ChannelGridCellProps) {
  const { row, col } = gridPositionToRowCol(gridPosition);
  // `displayState` chỉ có hiệu lực khi đã loaded (Boundaries) - undefined khi
  // skeleton hoặc khi thiếu displayState dù đã loaded (fallback loaded-neutral).
  const effectiveDisplayState = loaded ? displayState : undefined;

  const cellStateClass = !loaded
    ? styles.skeleton
    : effectiveDisplayState
      ? CELL_STATE_CLASS[effectiveDisplayState]
      : styles.loaded;

  return (
    <div
      className={`${styles.cell} ${cellStateClass}`}
      // DESIGN.md's channel-grid: "vị trí theo đài không đổi" - đặt tường
      // minh grid-row/grid-column theo gridPosition (KHÔNG dựa vào thứ tự
      // DOM/mảng channels), CSS Grid tự đặt đúng ô bất kể thứ tự render.
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
      role="gridcell"
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
          style={{ backgroundImage: thumbnailBackground(channelId) }}
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
            // `noUncheckedIndexedAccess`: index 0/1 luôn hợp lệ vì audioLevel
            // là tuple [number, number] cố định 2 phần tử.
            const rawLevel = audioLevel[index]!;
            const percent = dbfsToPercent(rawLevel);
            return (
              <div
                key={side}
                className={styles.vuMeter}
                data-testid={`vu-meter-${side}-${channelId}`}
                data-level-dbfs={rawLevel}
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
            );
          })}
        </div>
      ) : null}

      {effectiveDisplayState ? (
        <span
          className={`${styles.badge} ${BADGE_CLASS[effectiveDisplayState]}`}
          data-testid={`alert-badge-${channelId}`}
        >
          {BADGE_LABEL[effectiveDisplayState]}
        </span>
      ) : null}
    </div>
  );
}
