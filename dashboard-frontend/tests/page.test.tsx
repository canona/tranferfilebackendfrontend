// Code review [patch, finding #3]: `app/page.tsx`'s wiring audioLevel MỚI
// (Story 2.5) - useEffect/setInterval 300ms, cleanup khi unmount, build Map
// `channelAudioLevels` đúng key theo channelId - chưa có test nào exercise.
//
// Mock `connectUiWsClient` (đã được test đầy đủ với WS thật ở
// `uiWsClient.test.ts`) để store nhận NGAY registry-snapshot + channel-seen,
// không phụ thuộc mạng/WS thật - tránh test giòn/chậm và tránh xung đột với
// `vi.useFakeTimers()` dùng để lái interval audioLevel bên dưới.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ChannelStore } from '../src/state/channelStore';
import { computeAudioLevelFixture } from '../src/fixtures/channelAudioLevels';
// Vitest hoist `vi.mock(...)` lên TRƯỚC mọi import trong cùng file (kể cả
// import này) - Page sẽ dùng đúng bản mock `connectUiWsClient` khai báo dưới.
import Page from '../app/page';
import { connectUiWsClient } from '../src/services/uiWsClient';

vi.mock('../src/services/uiWsClient', () => ({
  connectUiWsClient: vi.fn((_url: string, store: ChannelStore) => {
    store.applyRegistrySnapshot([
      { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'B', contactPhone: '091', gridPosition: 1 },
    ]);
    store.applyChannelSeen('chan-1');
    store.applyChannelSeen('chan-2');
    // Story 2.6: mirror `channel-state-change` (đã test đầy đủ qua
    // `uiWsClient.test.ts`/`channelStore.test.ts`) - page.tsx phải đọc thẳng
    // `state.channelDisplayStates` (bỏ fixture `buildChannelDisplayStatesFixture`
    // của Story 2.4, đã xoá).
    store.applyChannelDisplayStateChange('chan-1', 'warning');
    return () => {};
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Page - channelDisplayStates từ store thật (Story 2.6, thay fixture)', () => {
  it('đọc state.channelDisplayStates trực tiếp, KHÔNG dùng fixture -> cell tương ứng hiện đúng displayState', () => {
    render(<Page />);
    expect(screen.getByTestId('channel-grid-cell-chan-1')).toHaveAttribute('data-display-state', 'warning');
    // chan-2 chưa có channel-state-change nào -> fallback loaded-neutral,
    // KHÔNG có data-display-state (khác hành vi fixture cũ vốn LUÔN gán 1
    // trong 3 giá trị cho mọi channelId).
    expect(screen.getByTestId('channel-grid-cell-chan-2')).not.toHaveAttribute('data-display-state');
    cleanup();
  });
});

describe('Page - audioLevel interval wiring (Story 2.5, code review patch #3)', () => {
  it('vu-meter (data-level-dbfs) đổi giá trị sau nhiều lần tick 300ms (vi.advanceTimersByTime)', () => {
    vi.useFakeTimers();
    render(<Page />);

    const initial = screen.getByTestId('vu-meter-left-chan-1').getAttribute('data-level-dbfs');

    // 10 tick x 300ms = 3s trôi qua - đủ để sin() cho ra giá trị khác rõ rệt,
    // tránh false-negative do trùng pha ngẫu nhiên ở đúng 1 tick. Bọc trong
    // `act()` để React flush đồng bộ setState của interval callback (không
    // có act(), commit có thể bị hoãn sang microtask chưa kịp chạy trước khi
    // test đọc DOM ngay sau đây).
    act(() => {
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(300);
      }
    });

    const after = screen.getByTestId('vu-meter-left-chan-1').getAttribute('data-level-dbfs');
    expect(after).not.toBe(initial);

    // Dọn interval đang chạy TRƯỚC khi unmount trong afterEach (tránh setState
    // sau unmount khi chuyển lại real timers).
    cleanup();
  });

  it('channelAudioLevels build đúng key theo channelId - KHÔNG lẫn/swap tham số giữa các kênh', () => {
    vi.useFakeTimers();
    render(<Page />);

    // 1 tick đúng 300ms -> elapsedSeconds bên trong page.tsx = 0.3s CHÍNH XÁC
    // (Date.now() bị fake, advance rời rạc theo đúng lượng gọi) - tính lại
    // giá trị kỳ vọng bằng CHÍNH `computeAudioLevelFixture` (hàm thuần) với
    // đúng channelId + elapsedSeconds này để verify map không bị lẫn tham số
    // (vd đưa channelId/side sai vào hàm tính). Bọc `act()` - lý do xem test
    // trên.
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const expectedChan1 = computeAudioLevelFixture('chan-1', 0.3);
    const expectedChan2 = computeAudioLevelFixture('chan-2', 0.3);

    expect(screen.getByTestId('vu-meter-left-chan-1')).toHaveAttribute(
      'data-level-dbfs',
      String(expectedChan1[0]),
    );
    expect(screen.getByTestId('vu-meter-right-chan-1')).toHaveAttribute(
      'data-level-dbfs',
      String(expectedChan1[1]),
    );
    expect(screen.getByTestId('vu-meter-left-chan-2')).toHaveAttribute(
      'data-level-dbfs',
      String(expectedChan2[0]),
    );
    expect(screen.getByTestId('vu-meter-right-chan-2')).toHaveAttribute(
      'data-level-dbfs',
      String(expectedChan2[1]),
    );

    cleanup();
  });

  it('unmount -> cleanup interval, KHÔNG throw/crash (dọn setInterval đúng)', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Page />);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(() => unmount()).not.toThrow();

    // Sau unmount, tiếp tục advance timers KHÔNG được gây lỗi (interval đã
    // clearInterval trong cleanup của useEffect).
    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
  });
});

// Story 2.7: ConnectionBanner + grid-overlay wiring end-to-end tại page.tsx.
// AC: "banner+overlay hiện ngay khi disconnected; ẩn ngay khi reconnect,
// không cần reload".
describe('Page - ConnectionBanner + grid-overlay (Story 2.7)', () => {
  it('connectionStatus mặc định "connected" (mock không gọi setConnectionStatus) -> KHÔNG render banner/grid-overlay', () => {
    render(<Page />);
    expect(screen.queryByTestId('connection-banner')).toBeNull();
    expect(screen.queryByTestId('grid-overlay')).toBeNull();
    cleanup();
  });

  it('store.setConnectionStatus("disconnected") (mirror uiWsClient onclose) -> banner + grid-overlay hiện NGAY', () => {
    const lastConnectedIso = '2026-09-06T08:15:00.000Z';
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.setConnectionStatus('connected', lastConnectedIso);
      store.setConnectionStatus('disconnected');
      return () => {};
    });

    render(<Page />);

    // `ConnectionBanner` hiện giờ ĐỊA PHƯƠNG (wall-clock) - tính kỳ vọng qua
    // chính `Date` API để không phụ thuộc múi giờ máy chạy test (mirror
    // `ConnectionBanner.test.tsx`).
    const expected = new Date(lastConnectedIso);
    const expectedText = `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`;

    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();
    expect(screen.getByTestId('connection-banner')).toHaveTextContent(expectedText);
    expect(screen.getByTestId('grid-overlay')).toBeInTheDocument();
    cleanup();
  });

  it('store.setConnectionStatus("connected") sau khi đã "disconnected" (mirror reconnect thành công) -> banner/grid-overlay ẩn NGAY, không cần reload/re-render thủ công', () => {
    let capturedStore: ChannelStore | undefined;
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      capturedStore = store;
      store.setConnectionStatus('disconnected');
      return () => {};
    });

    render(<Page />);
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();

    act(() => {
      capturedStore?.setConnectionStatus('connected', '2026-09-06T09:00:00.000Z');
    });

    expect(screen.queryByTestId('connection-banner')).toBeNull();
    expect(screen.queryByTestId('grid-overlay')).toBeNull();
    cleanup();
  });
});

// Story 2.7: `channelMachineOffline` wiring - badge riêng nhưng vẫn style
// critical, ĐỘC LẬP connectionStatus/channelDisplayStates.
describe('Page - channelMachineOffline badge (Story 2.7)', () => {
  it('channel-state-change với subType="machine-offline" -> cell tương ứng nhận data-sub-type, badge "✕ TRUNG TÂM LỖI", vẫn style critical', () => {
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      return () => {};
    });

    render(<Page />);

    const cell = screen.getByTestId('channel-grid-cell-chan-1');
    expect(cell).toHaveAttribute('data-display-state', 'critical');
    expect(cell).toHaveAttribute('data-sub-type', 'machine-offline');
    expect(screen.getByTestId('alert-badge-chan-1')).toHaveTextContent('✕ TRUNG TÂM LỖI');
    cleanup();
  });

  it('heartbeat resume (channel-state-change KHÔNG subType) sau machine-offline -> badge trả về đúng trạng thái telemetry thật, hết data-sub-type', () => {
    let capturedStore: ChannelStore | undefined;
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      capturedStore = store;
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'critical', 'machine-offline');
      return () => {};
    });

    render(<Page />);
    expect(screen.getByTestId('channel-grid-cell-chan-1')).toHaveAttribute('data-sub-type', 'machine-offline');

    act(() => {
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'warning');
    });

    const cell = screen.getByTestId('channel-grid-cell-chan-1');
    expect(cell).toHaveAttribute('data-display-state', 'warning');
    expect(cell).not.toHaveAttribute('data-sub-type');
    expect(screen.getByTestId('alert-badge-chan-1')).toHaveTextContent('⚠ ABR');
    cleanup();
  });
});

// Bổ sung video-preview thật (AD-22): channel-snapshot wiring end-to-end qua
// Page -> ChannelGrid -> ChannelGridCell.
describe('Page - channelSnapshots wiring (video-preview thật)', () => {
  it('channel-snapshot qua store -> cell tương ứng dùng ảnh thật thay gradient giả', () => {
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'ok');
      store.applyChannelSnapshot('chan-1', 'ZmFrZS1qcGVn');
      return () => {};
    });

    render(<Page />);

    const style = screen.getByTestId('thumbnail-chan-1').style.backgroundImage;
    expect(style).toContain('data:image/jpeg;base64,ZmFrZS1qcGVn');
    cleanup();
  });
});
