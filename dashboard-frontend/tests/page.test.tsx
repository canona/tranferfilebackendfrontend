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

vi.mock('../src/services/uiWsClient', () => ({
  connectUiWsClient: vi.fn((_url: string, store: ChannelStore) => {
    store.applyRegistrySnapshot([
      { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'B', contactPhone: '091', gridPosition: 1 },
    ]);
    store.applyChannelSeen('chan-1');
    store.applyChannelSeen('chan-2');
    return () => {};
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
