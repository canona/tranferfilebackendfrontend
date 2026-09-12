// Acceptance Criteria: "vị trí ô khớp đúng tuyệt đối, không lấy từ thứ tự
// event/telemetry"; "toàn bộ 20 ô hiện skeleton; từng ô chuyển sang
// loaded-neutral ngay khi kênh đó có telemetry, không chờ đủ 20 kênh".

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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
    render(
      <ChannelGrid
        channels={makeChannels(20)}
        seenChannelIds={new Set()}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(20);
    for (const cell of cells) {
      expect(cell).toHaveAttribute('data-state', 'skeleton');
    }
  });

  it('vị trí ô KHÔNG phụ thuộc thứ tự mảng channels - đảo ngược thứ tự vẫn cho ra đúng grid-row/grid-column', () => {
    const channels = makeChannels(20);
    const shuffled = [...channels].reverse();

    render(
      <ChannelGrid
        channels={shuffled}
        seenChannelIds={new Set()}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

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
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-7'])}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

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
    render(
      <ChannelGrid
        channels={makeChannels(2)}
        seenChannelIds={new Set()}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );
    expect(screen.getAllByRole('gridcell').length).toBe(2);
  });

  // Code review [patch]: trạng thái ban đầu THẬT của app - trước khi client
  // nhận `registry-snapshot` đầu tiên (`channels=[]`, ChannelStore's
  // EMPTY_STATE lúc mount) - mọi test phía trên đều hard-code sẵn 20/2 kênh,
  // chưa từng verify khoảng chờ này. Trước patch: render 0 ô (trái AC "cold-
  // load -> toàn bộ 20 ô skeleton"). Sau patch: 20 ô placeholder skeleton.
  it('channels rỗng (trước khi registry-snapshot đầu tiên tới) -> vẫn render đủ 20 ô skeleton, không crash', () => {
    render(
      <ChannelGrid
        channels={[]}
        seenChannelIds={new Set()}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );
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

  // Story 2.4: `channelDisplayStates` truyền đúng giá trị xuống từng cell
  // theo channelId - vị trí ô không đổi theo trạng thái (Boundaries).
  it('truyền đúng displayState xuống từng cell theo channelId (channelDisplayStates)', () => {
    const channels = makeChannels(3);
    const channelDisplayStates = new Map([
      ['chan-0', 'ok' as const],
      ['chan-1', 'warning' as const],
      ['chan-2', 'critical' as const],
    ]);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1', 'chan-2'])}
        channelDisplayStates={channelDisplayStates}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

    expect(screen.getByTestId('channel-grid-cell-chan-0')).toHaveAttribute('data-display-state', 'ok');
    expect(screen.getByTestId('channel-grid-cell-chan-1')).toHaveAttribute('data-display-state', 'warning');
    expect(screen.getByTestId('channel-grid-cell-chan-2')).toHaveAttribute('data-display-state', 'critical');
    // Vị trí ô vẫn đúng gridPosition, không sắp xếp lại theo trạng thái.
    expect(screen.getByTestId('channel-grid-cell-chan-0').style.gridColumn).toBe('1');
    expect(screen.getByTestId('channel-grid-cell-chan-1').style.gridColumn).toBe('2');
    expect(screen.getByTestId('channel-grid-cell-chan-2').style.gridColumn).toBe('3');
  });

  it('channelDisplayStates thiếu entry cho 1 channelId đã loaded -> cell đó fallback loaded-neutral, không crash', () => {
    const channels = makeChannels(2);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1'])}
        channelDisplayStates={new Map([['chan-0', 'ok' as const]])}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

    expect(screen.getByTestId('channel-grid-cell-chan-0')).toHaveAttribute('data-display-state', 'ok');
    const cellWithoutState = screen.getByTestId('channel-grid-cell-chan-1');
    expect(cellWithoutState).toHaveAttribute('data-state', 'loaded-neutral');
    expect(cellWithoutState).not.toHaveAttribute('data-display-state');
  });

  // Story 2.5: `channelAudioLevels` truyền đúng xuống từng cell theo
  // channelId - độc lập hoàn toàn channelDisplayStates (Boundaries).
  it('truyền đúng audioLevel xuống từng cell theo channelId (channelAudioLevels)', () => {
    const channels = makeChannels(2);
    const channelAudioLevels = new Map<string, readonly [number, number]>([
      ['chan-0', [-30, -30]],
      ['chan-1', [-1, -1]],
    ]);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1'])}
        channelDisplayStates={new Map()}
        channelAudioLevels={channelAudioLevels}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

    expect(screen.getByTestId('vu-meter-left-chan-0')).toHaveAttribute('data-level-dbfs', '-30');
    expect(screen.getByTestId('vu-meter-left-chan-1')).toHaveAttribute('data-level-dbfs', '-1');
  });

  it('channelAudioLevels thiếu entry cho 1 channelId đã loaded -> cell đó không render vu-meter, không crash', () => {
    const channels = makeChannels(2);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1'])}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map([['chan-0', [-30, -30]]])}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

    expect(screen.getByTestId('vu-meter-row-chan-0')).toBeInTheDocument();
    expect(screen.queryByTestId('vu-meter-row-chan-1')).toBeNull();
  });

  // Bổ sung video-preview thật (AD-22): `channelSnapshots` truyền đúng xuống
  // từng cell theo channelId - mirror test channelAudioLevels ở trên.
  it('truyền đúng snapshotDataUri xuống từng cell theo channelId (channelSnapshots)', () => {
    const channels = makeChannels(2);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1'])}
        channelDisplayStates={new Map([['chan-0', 'ok' as const]])}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map([['chan-0', 'data:image/jpeg;base64,ZmFrZQ==']])}
      />,
    );

    expect(screen.getByTestId('thumbnail-chan-0').style.backgroundImage).toContain('data:image/jpeg;base64,ZmFrZQ==');
  });

  // Story 2.7: `channelMachineOffline` truyền đúng xuống từng cell theo
  // channelId dưới dạng prop `subType` - độc lập hoàn toàn channelDisplayStates.
  it('channelMachineOffline: channelId có trong set -> cell tương ứng nhận subType="machine-offline", channelId khác thì không', () => {
    const channels = makeChannels(2);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1'])}
        channelDisplayStates={new Map([['chan-0', 'critical' as const], ['chan-1', 'critical' as const]])}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set(['chan-0'])}
        channelSnapshots={new Map()}
      />,
    );

    expect(screen.getByTestId('channel-grid-cell-chan-0')).toHaveAttribute('data-sub-type', 'machine-offline');
    expect(screen.getByTestId('channel-grid-cell-chan-1')).not.toHaveAttribute('data-sub-type');
  });

  // Code review round 2 [patch #7, verification-gap]: `ChannelGrid` phải
  // forward `onSelect` xuống ĐÚNG cell đã click - trước patch này không test
  // nào đi qua chuỗi thật `ChannelGrid -> ChannelGridCell -> onSelect`
  // (mirror style "truyền đúng X xuống từng cell" đã có ở trên cho các prop
  // khác). Nếu tương lai `ChannelGrid.tsx` lỡ quên forward prop này, test này
  // là nơi DUY NHẤT bắt được.
  it('truyền đúng onSelect xuống từng cell - click 1 channel-grid-cell gọi onSelect với đúng channelId', () => {
    const channels = makeChannels(3);
    const onSelect = vi.fn();
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1', 'chan-2'])}
        channelDisplayStates={new Map()}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-1'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('chan-1');
  });

  it('channelMachineOffline rỗng -> không cell nào nhận subType', () => {
    const channels = makeChannels(2);
    render(
      <ChannelGrid
        channels={channels}
        seenChannelIds={new Set(['chan-0', 'chan-1'])}
        channelDisplayStates={new Map([['chan-0', 'critical' as const]])}
        channelAudioLevels={new Map()}
        channelMachineOffline={new Set()}
        channelSnapshots={new Map()}
      />,
    );

    expect(screen.getByTestId('channel-grid-cell-chan-0')).not.toHaveAttribute('data-sub-type');
    expect(screen.getByTestId('channel-grid-cell-chan-1')).not.toHaveAttribute('data-sub-type');
  });
});
