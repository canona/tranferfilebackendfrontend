import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChannelGridCell, gridPositionToRowCol } from '../src/components/ChannelGridCell';

afterEach(cleanup);

describe('gridPositionToRowCol', () => {
  it('suy đúng row/col qua Math.floor(pos/5)/pos%5 (Boundaries)', () => {
    expect(gridPositionToRowCol(0)).toEqual({ row: 0, col: 0 });
    expect(gridPositionToRowCol(4)).toEqual({ row: 0, col: 4 });
    expect(gridPositionToRowCol(5)).toEqual({ row: 1, col: 0 });
    expect(gridPositionToRowCol(19)).toEqual({ row: 3, col: 4 });
    expect(gridPositionToRowCol(12)).toEqual({ row: 2, col: 2 });
  });
});

describe('ChannelGridCell', () => {
  it('loaded=false -> data-state="skeleton", KHÔNG hiển thị tên đài', () => {
    render(<ChannelGridCell channelId="chan-1" stationName="Đài Thí Nghiệm 01" gridPosition={0} loaded={false} />);
    const cell = screen.getByTestId('channel-grid-cell-chan-1');
    expect(cell).toHaveAttribute('data-state', 'skeleton');
    expect(cell).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Đài Thí Nghiệm 01')).toBeNull();
  });

  it('loaded=true -> data-state="loaded-neutral", hiển thị tên đài', () => {
    render(<ChannelGridCell channelId="chan-1" stationName="Đài Thí Nghiệm 01" gridPosition={0} loaded={true} />);
    const cell = screen.getByTestId('channel-grid-cell-chan-1');
    expect(cell).toHaveAttribute('data-state', 'loaded-neutral');
    expect(cell).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText('Đài Thí Nghiệm 01')).toBeInTheDocument();
  });

  it('style grid-row/grid-column khớp đúng gridPosition (không phụ thuộc thứ tự render)', () => {
    render(<ChannelGridCell channelId="chan-mid" stationName="Đài giữa" gridPosition={12} loaded={false} />);
    const cell = screen.getByTestId('channel-grid-cell-chan-mid');
    expect(cell.style.gridRow).toBe('3'); // row=2 -> CSS grid 1-indexed
    expect(cell.style.gridColumn).toBe('3'); // col=2 -> CSS grid 1-indexed
    expect(cell).toHaveAttribute('data-grid-position', '12');
  });
});

// Story 2.4: `displayState` (ok/warning/critical) + `alert-badge`. I/O
// matrix: chỉ có hiệu lực khi loaded=true; luôn kèm đồng thời nền màu VÀ
// text; skeleton/thiếu displayState KHÔNG render badge.
describe('ChannelGridCell - displayState (Story 2.4)', () => {
  it('loaded=true, displayState="ok" -> data-display-state="ok", badge text "OK"', () => {
    render(
      <ChannelGridCell
        channelId="chan-1"
        stationName="Đài Thí Nghiệm 01"
        gridPosition={0}
        loaded={true}
        displayState="ok"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-1');
    expect(cell).toHaveAttribute('data-display-state', 'ok');
    const badge = screen.getByTestId('alert-badge-chan-1');
    expect(badge).toHaveTextContent('OK');
  });

  it('loaded=true, displayState="warning" -> data-display-state="warning", badge text "⚠ ABR"', () => {
    render(
      <ChannelGridCell
        channelId="chan-2"
        stationName="Đài Thí Nghiệm 02"
        gridPosition={1}
        loaded={true}
        displayState="warning"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-2');
    expect(cell).toHaveAttribute('data-display-state', 'warning');
    expect(screen.getByTestId('alert-badge-chan-2')).toHaveTextContent('⚠ ABR');
  });

  it('loaded=true, displayState="critical" -> data-display-state="critical", badge text "✕ MẤT TÍN HIỆU"', () => {
    render(
      <ChannelGridCell
        channelId="chan-3"
        stationName="Đài Thí Nghiệm 03"
        gridPosition={2}
        loaded={true}
        displayState="critical"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-3');
    expect(cell).toHaveAttribute('data-display-state', 'critical');
    expect(screen.getByTestId('alert-badge-chan-3')).toHaveTextContent('✕ MẤT TÍN HIỆU');
  });

  it('loaded=false (skeleton) dù có displayState -> KHÔNG render badge, giữ nguyên data-state="skeleton"', () => {
    render(
      <ChannelGridCell
        channelId="chan-4"
        stationName="Đài Thí Nghiệm 04"
        gridPosition={3}
        loaded={false}
        displayState="critical"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-4');
    expect(cell).toHaveAttribute('data-state', 'skeleton');
    expect(cell).not.toHaveAttribute('data-display-state');
    expect(screen.queryByTestId('alert-badge-chan-4')).toBeNull();
  });

  it('loaded=true, displayState thiếu (undefined) -> fallback loaded-neutral, KHÔNG render badge, không crash', () => {
    render(
      <ChannelGridCell channelId="chan-5" stationName="Đài Thí Nghiệm 05" gridPosition={4} loaded={true} />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-5');
    expect(cell).toHaveAttribute('data-state', 'loaded-neutral');
    expect(cell).not.toHaveAttribute('data-display-state');
    expect(screen.queryByTestId('alert-badge-chan-5')).toBeNull();
    expect(screen.getByText('Đài Thí Nghiệm 05')).toBeInTheDocument();
  });
});
