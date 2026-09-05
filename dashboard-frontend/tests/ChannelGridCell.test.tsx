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
