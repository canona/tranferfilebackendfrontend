// Acceptance Criteria: "vị trí ô khớp đúng tuyệt đối, không lấy từ thứ tự
// event/telemetry"; "toàn bộ 20 ô hiện skeleton; từng ô chuyển sang
// loaded-neutral ngay khi kênh đó có telemetry, không chờ đủ 20 kênh".

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChannelGrid } from '../src/components/ChannelGrid';
import type { ChannelRegistryEntry } from '../src/state/channelStore';

afterEach(cleanup);

function makeChannels(count: number): ChannelRegistryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    channelId: `chan-${i}`,
    stationName: `Đài ${i}`,
    contactName: `Người ${i}`,
    contactPhone: `090000000${i}`,
    gridPosition: i,
  }));
}

describe('ChannelGrid', () => {
  it('render đủ 20 ô, mỗi ô skeleton khi seenChannelIds rỗng (cold-load)', () => {
    render(<ChannelGrid channels={makeChannels(20)} seenChannelIds={new Set()} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(20);
    for (const cell of cells) {
      expect(cell).toHaveAttribute('data-state', 'skeleton');
    }
  });

  it('vị trí ô KHÔNG phụ thuộc thứ tự mảng channels - đảo ngược thứ tự vẫn cho ra đúng grid-row/grid-column', () => {
    const channels = makeChannels(20);
    const shuffled = [...channels].reverse();

    render(<ChannelGrid channels={shuffled} seenChannelIds={new Set()} />);

    for (const channel of channels) {
      const cell = screen.getByTestId(`channel-grid-cell-${channel.channelId}`);
      const expectedRow = Math.floor(channel.gridPosition / 5) + 1;
      const expectedCol = (channel.gridPosition % 5) + 1;
      expect(cell.style.gridRow).toBe(String(expectedRow));
      expect(cell.style.gridColumn).toBe(String(expectedCol));
    }
  });

  it('1 kênh có channel-seen ngay khi chỉ 1/20 kênh loaded -> đúng ô đó chuyển loaded-neutral, 19 ô còn lại VẪN skeleton', () => {
    const channels = makeChannels(20);
    render(<ChannelGrid channels={channels} seenChannelIds={new Set(['chan-7'])} />);

    const loadedCell = screen.getByTestId('channel-grid-cell-chan-7');
    expect(loadedCell).toHaveAttribute('data-state', 'loaded-neutral');
    expect(screen.getByText('Đài 7')).toBeInTheDocument();

    const skeletonCells = channels
      .filter((c) => c.channelId !== 'chan-7')
      .map((c) => screen.getByTestId(`channel-grid-cell-${c.channelId}`));
    expect(skeletonCells.length).toBe(19);
    for (const cell of skeletonCells) {
      expect(cell).toHaveAttribute('data-state', 'skeleton');
    }
  });

  it('registry chưa đủ 20 kênh (vd fixture dev/test 2 kênh) -> render đúng số ô hiện có, đúng vị trí, không crash', () => {
    render(<ChannelGrid channels={makeChannels(2)} seenChannelIds={new Set()} />);
    expect(screen.getAllByRole('gridcell').length).toBe(2);
  });

  // Code review [patch]: trạng thái ban đầu THẬT của app - trước khi client
  // nhận `registry-snapshot` đầu tiên (`channels=[]`, ChannelStore's
  // EMPTY_STATE lúc mount) - mọi test phía trên đều hard-code sẵn 20/2 kênh,
  // chưa từng verify khoảng chờ này. Trước patch: render 0 ô (trái AC "cold-
  // load -> toàn bộ 20 ô skeleton"). Sau patch: 20 ô placeholder skeleton.
  it('channels rỗng (trước khi registry-snapshot đầu tiên tới) -> vẫn render đủ 20 ô skeleton, không crash', () => {
    render(<ChannelGrid channels={[]} seenChannelIds={new Set()} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(20);
    for (const cell of cells) {
      expect(cell).toHaveAttribute('data-state', 'skeleton');
      expect(cell).toHaveAttribute('aria-label', 'Đang tải kênh');
    }
    // Vị trí vẫn đúng 0-19 dù chưa có dữ liệu registry thật.
    for (let position = 0; position < 20; position++) {
      const cell = screen.getByTestId(`channel-grid-cell-placeholder-${position}`);
      expect(cell.style.gridRow).toBe(String(Math.floor(position / 5) + 1));
      expect(cell.style.gridColumn).toBe(String((position % 5) + 1));
    }
  });
});
