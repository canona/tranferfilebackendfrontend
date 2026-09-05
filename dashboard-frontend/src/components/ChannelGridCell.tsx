// Story 2.3: `channel-grid-cell` - 1 ô kênh trong lưới tổng quan. Boundaries:
// "channel-grid-cell suy row/col từ grid_position qua Math.floor(pos/5)/
// pos%5; luôn render đủ 20 ô đúng vị trí, không phụ thuộc thứ tự event."
//
// Story này CHỈ có 2 trạng thái thị giác: `skeleton` (chưa nhận telemetry
// nào) và `loaded-neutral` (đã nhận `channel-seen`, CHƯA có màu trạng thái
// ok/warning/critical/badge - Never: "đổi mapping trạng thái/alert-badge",
// thuộc Story 2.4). `loaded-neutral` dùng ĐÚNG token của state `ok` trong
// DESIGN.md's `channel-grid-cell.states.ok` (border={colors.border},
// background={colors.surface-raised}) - đây vốn là style "trung tính" mặc
// định của DESIGN.md, không phải màu ngữ nghĩa "OK" (màu ngữ nghĩa đến từ
// alert-badge riêng, Story 2.4).

import styles from './ChannelGridCell.module.css';

const GRID_COLUMNS = 5;

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
}

export function ChannelGridCell({ channelId, stationName, gridPosition, loaded }: ChannelGridCellProps) {
  const { row, col } = gridPositionToRowCol(gridPosition);

  return (
    <div
      className={`${styles.cell} ${loaded ? styles.loaded : styles.skeleton}`}
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
    >
      {loaded ? <span className={styles.channelName}>{stationName}</span> : null}
    </div>
  );
}
