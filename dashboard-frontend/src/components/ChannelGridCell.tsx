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

import styles from './ChannelGridCell.module.css';

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
}

export function ChannelGridCell({
  channelId,
  stationName,
  gridPosition,
  loaded,
  displayState,
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
      {loaded ? <span className={styles.channelName}>{stationName}</span> : null}
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
