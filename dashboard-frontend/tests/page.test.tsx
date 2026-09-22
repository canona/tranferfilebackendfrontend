// Code review [patch, finding #3]: `app/page.tsx`'s wiring audioLevel MỚI
// (Story 2.5) - useEffect/setInterval 300ms, cleanup khi unmount, build Map
// `channelAudioLevels` đúng key theo channelId - chưa có test nào exercise.
//
// Mock `connectUiWsClient` (đã được test đầy đủ với WS thật ở
// `uiWsClient.test.ts`) để store nhận NGAY registry-snapshot + channel-seen,
// không phụ thuộc mạng/WS thật - tránh test giòn/chậm và tránh xung đột với
// `vi.useFakeTimers()` dùng để lái interval audioLevel bên dưới.

import { StrictMode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChannelStore } from '../src/state/channelStore';
import { computeAudioLevelFixture } from '../src/fixtures/channelAudioLevels';
// Vitest hoist `vi.mock(...)` lên TRƯỚC mọi import trong cùng file (kể cả
// import này) - Page sẽ dùng đúng bản mock `connectUiWsClient` khai báo dưới.
import Page from '../app/page';
import { connectUiWsClient } from '../src/services/uiWsClient';
import { playAlertBeep, primeAlertAudioContext, BEEP_DURATION_SEC } from '../src/services/alertSound';

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
    return { close: () => {}, sendAckCommand: () => {} };
  }),
}));

// Story 4.1: mock module âm thanh (đã test riêng đầy đủ ở `alertSound.test.ts`
// với `AudioContext` mock) - ở đây chỉ verify WIRING page.tsx <-> alertSoundToken/
// gesture listener, không đụng Web Audio API thật.
vi.mock('../src/services/alertSound', () => ({
  playAlertBeep: vi.fn(),
  primeAlertAudioContext: vi.fn(),
  // Code review round 2 [patch]: module mock đầy đủ (không passthrough) -
  // phải khai báo lại const này để page.tsx's `import { BEEP_DURATION_SEC }`
  // không undefined khi test import cùng module thật để so sánh giá trị.
  BEEP_DURATION_SEC: 0.3,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(playAlertBeep).mockClear();
  vi.mocked(primeAlertAudioContext).mockClear();
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
      return { close: () => {}, sendAckCommand: () => {} };
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
      return { close: () => {}, sendAckCommand: () => {} };
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
      return { close: () => {}, sendAckCommand: () => {} };
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
      return { close: () => {}, sendAckCommand: () => {} };
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

// Story 3.2 (code review round 2 [patch #7, verification-gap]): chuỗi thật
// AC #1 "click 1 channel-grid-cell -> detail-panel mở" - trước patch này
// KHÔNG có test nào đi qua ĐÚNG chuỗi Page -> ChannelGrid -> ChannelGridCell ->
// store.selectChannel -> DetailPanel (mirror style "channelSnapshots wiring"
// ở dưới, cùng file này). Nếu tương lai `ChannelGrid.tsx` lỡ quên forward
// `onSelect` xuống `ChannelGridCell`, hoặc `page.tsx` quên wiring `onSelect`
// vào `store.selectChannel`, test này là nơi DUY NHẤT bắt được - các unit test
// khác (`ChannelGridCell.test.tsx` tự truyền onSelect trực tiếp,
// `DetailPanel.test.tsx` luôn mở panel bằng gọi thẳng `store.selectChannel`)
// đều không đi qua đường dây thật này.
describe('Page - detail-panel click wiring (Story 3.2, verification-gap)', () => {
  it('click 1 channel-grid-cell thật -> detail-panel mở, đúng nội dung kênh đó (tên đài/đầu mối liên hệ)', () => {
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'Người A', contactPhone: '0900000001', gridPosition: 0 },
        { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'Người B', contactPhone: '0900000002', gridPosition: 1 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelSeen('chan-2');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);

    // Panel chưa mở - chưa click gì cả.
    expect(screen.queryByTestId('detail-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-2'));

    const panel = screen.getByTestId('detail-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-channel-id', 'chan-2');
    expect(screen.getByTestId('detail-panel-station-name')).toHaveTextContent('Đài 2');
    expect(screen.getByTestId('detail-panel-contact-name')).toHaveTextContent('Người B');
    expect(screen.getByTestId('detail-panel-contact-phone')).toHaveTextContent('0900000002');
    cleanup();
  });

  // Code review round 3 [patch, decision]: user chốt cho phép click 1
  // `channel-grid-cell` KHÁC trong khi panel đang mở để chuyển thẳng sang kênh
  // đó, KHÔNG cần đóng panel trước (trước patch này, backdrop full-viewport
  // bắt mọi click chỉ để đóng panel - không cách nào click-through xuống 1 ô
  // kênh khác trong 1 lần click). Test chuỗi thật qua đúng
  // Page -> ChannelGrid -> ChannelGridCell -> window click-capture listener
  // (DetailPanel.tsx) -> store.selectChannel.
  it('click 1 channel-grid-cell KHÁC trong khi detail-panel đang mở -> chuyển thẳng sang kênh đó, không cần đóng panel trước', () => {
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'Người A', contactPhone: '0900000001', gridPosition: 0 },
        { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'Người B', contactPhone: '0900000002', gridPosition: 1 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelSeen('chan-2');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);

    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-1'));
    expect(screen.getByTestId('detail-panel')).toHaveAttribute('data-channel-id', 'chan-1');

    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-2'));

    const panel = screen.getByTestId('detail-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-channel-id', 'chan-2');
    expect(screen.getByTestId('detail-panel-station-name')).toHaveTextContent('Đài 2');
    expect(screen.getByTestId('detail-panel-contact-phone')).toHaveTextContent('0900000002');
    cleanup();
  });

  it('click nền trống (không phải channel-grid-cell, không phải panel) trong khi panel đang mở -> đóng panel', () => {
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);
    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-1'));
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('detail-panel-backdrop'));

    expect(screen.queryByTestId('detail-panel')).toBeNull();
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
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);

    const style = screen.getByTestId('thumbnail-chan-1').style.backgroundImage;
    expect(style).toContain('data:image/jpeg;base64,ZmFrZS1qcGVn');
    cleanup();
  });
});

// Story 3.3: ack-command wiring end-to-end qua
// Page -> DetailPanel (bấm nút) -> sendAckCommand thật (từ connectUiWsClient) VÀ
// Page -> store.applyAckChange (channel-ack-change) -> ChannelGrid -> ChannelGridCell.
describe('Page - Ack wiring (Story 3.3)', () => {
  it('bấm "Xác nhận đã tiếp nhận" trong detail-panel -> gọi ĐÚNG sendAckCommand trả về từ connectUiWsClient với channelId/operatorLabel đã trim()', () => {
    const sendAckCommand = vi.fn();
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
      return { close: () => {}, sendAckCommand };
    });

    render(<Page />);

    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-1'));
    fireEvent.change(screen.getByTestId('detail-panel-ack-input'), { target: { value: '  NV.A  ' } });
    fireEvent.click(screen.getByTestId('detail-panel-ack-button'));

    expect(sendAckCommand).toHaveBeenCalledTimes(1);
    expect(sendAckCommand).toHaveBeenCalledWith('chan-1', 'NV.A');
    cleanup();
  });

  it('channel-ack-change (qua store.applyAckChange, mirror uiWsClient) -> ô kênh tương ứng hiện ack-label, border đổi dashed; ack tự xoá -> ack-label biến mất', () => {
    let capturedStore: ChannelStore | undefined;
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      capturedStore = store;
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);
    expect(screen.queryByTestId('ack-label-chan-1')).toBeNull();

    act(() => {
      capturedStore?.applyAckChange('chan-1', 'NV.A');
    });
    expect(screen.getByTestId('ack-label-chan-1')).toHaveTextContent('✓ Đã nhận: NV.A');

    // Kênh chuyển cảnh báo mới (warning -> critical) - mirror backend auto-clear
    // (channel-ack-change acknowledged=false) áp dụng qua applyAckChange(null).
    act(() => {
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'critical');
      capturedStore?.applyAckChange('chan-1', null);
    });
    expect(screen.queryByTestId('ack-label-chan-1')).toBeNull();
    cleanup();
  });
});

// Story 4.1: âm báo động tại chỗ khi có cảnh báo mới (SM-1) - wiring
// alertSoundToken (channelStore) -> playAlertBeep() (alertSound.ts, mocked ở
// trên). Test riêng đầy đủ hành vi Web Audio API thật ở `alertSound.test.ts`.
describe('Page - alertSoundToken wiring (Story 4.1)', () => {
  it('alertSoundToken đổi (kênh chuyển warning/critical thật, KHÔNG phải mount) -> playAlertBeep() gọi ĐÚNG 1 lần', () => {
    let capturedStore: ChannelStore | undefined;
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      capturedStore = store;
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'ok');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);
    expect(playAlertBeep).not.toHaveBeenCalled();

    act(() => {
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'warning');
    });

    expect(playAlertBeep).toHaveBeenCalledTimes(1);
    cleanup();
  });

  // I/O matrix: "Mount/reconnect, kênh ĐÃ warning/critical (replay lúc
  // connect) -> Không phát âm - công bố trạng thái hiện tại, không phải
  // transition mới".
  it('mount với kênh ĐÃ warning/critical sẵn (replay lúc connect) -> KHÔNG gọi playAlertBeep() lúc mount', () => {
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'critical');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);

    expect(playAlertBeep).not.toHaveBeenCalled();
    cleanup();
  });

  it('nhiều transition liên tiếp (ok->warning->critical->ok->warning) -> playAlertBeep() gọi đúng 2 lần (bằng số transition thật tăng token), KHÔNG gọi lúc phục hồi về ok', () => {
    let capturedStore: ChannelStore | undefined;
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      capturedStore = store;
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'ok');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);

    act(() => {
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'warning'); // +1
    });
    act(() => {
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'critical'); // +1
    });
    act(() => {
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'ok'); // phục hồi, +0
    });

    expect(playAlertBeep).toHaveBeenCalledTimes(2);
    cleanup();
  });

  // Code review round 1 [patch]: React StrictMode (mặc định true ở Next.js
  // App Router, `next dev`) cố ý double-invoke effect lúc mount để lộ
  // side-effect không idempotent - cờ boolean cũ ("đã chạy chưa") bị tiêu thụ
  // ở lần gọi đầu, khiến lần gọi thứ 2 phát bíp giả dù không có transition
  // thật (thực nghiệm xác nhận ở review). So sánh GIÁ TRỊ token (fix) phải
  // idempotent qua double-invoke này.
  it('mount dưới React.StrictMode, kênh ĐÃ warning/critical sẵn (double-invoke effect) -> VẪN KHÔNG gọi playAlertBeep()', () => {
    // 2x `mockImplementationOnce` (KHÔNG `mockImplementation` - tránh đổi
    // permanent default behavior của mock dùng chung cho các test khác trong
    // file) - StrictMode double-invoke effect nối WS đúng 2 lần; cần CẢ 2 lần
    // set CÙNG 1 trạng thái 'critical' để cô lập đúng kịch bản "mount lặp lại
    // không đổi gì thật". Nếu chỉ mock 1 lần, lần gọi thứ 2 sẽ rơi về mock
    // mặc định (set chan-1='warning', khác 'critical') và tạo ra 1 transition
    // THẬT (critical->warning), gây false-positive không liên quan bug đang
    // test.
    const setupCritical = (_url: string, store: ChannelStore) => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'critical');
      return { close: () => {}, sendAckCommand: () => {} };
    };
    vi.mocked(connectUiWsClient).mockImplementationOnce(setupCritical).mockImplementationOnce(setupCritical);

    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );

    expect(playAlertBeep).not.toHaveBeenCalled();
    cleanup();
  });

  // Code review round 1 [patch]: nếu 2 kênh khác nhau tăng `alertSoundToken`
  // trong CÙNG 1 lệnh gọi `act()` (React 18 tự động batch thành 1 commit -
  // token nhảy thẳng 0->2), effect chỉ chạy 1 lần/commit - phải phát ĐÚNG số
  // lần bằng độ lệch token, không được gộp còn 1 tiếng (im lặng bỏ sót 1
  // cảnh báo).
  it('2 kênh cùng transition trong CÙNG 1 batch React (token nhảy 0->2 trong 1 commit) -> playAlertBeep() gọi đúng 2 lần, không gộp còn 1', () => {
    let capturedStore: ChannelStore | undefined;
    vi.mocked(connectUiWsClient).mockImplementationOnce((_url: string, store: ChannelStore) => {
      capturedStore = store;
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
        { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'B', contactPhone: '091', gridPosition: 1 },
      ]);
      store.applyChannelSeen('chan-1');
      store.applyChannelSeen('chan-2');
      store.applyChannelDisplayStateChange('chan-1', 'ok');
      store.applyChannelDisplayStateChange('chan-2', 'ok');
      return { close: () => {}, sendAckCommand: () => {} };
    });

    render(<Page />);
    expect(playAlertBeep).not.toHaveBeenCalled();

    act(() => {
      // Cả 2 lệnh trong CÙNG 1 callback act() -> React 18 tự động batch
      // thành 1 commit duy nhất.
      capturedStore?.applyChannelDisplayStateChange('chan-1', 'warning');
      capturedStore?.applyChannelDisplayStateChange('chan-2', 'critical');
    });

    expect(playAlertBeep).toHaveBeenCalledTimes(2);
    // Code review round 2 [patch]: xác nhận wiring truyền ĐÚNG offset stagger
    // (i * BEEP_DURATION_SEC) cho từng lệnh gọi trong batch - trước đây test
    // chỉ kiểm tra SỐ LẦN gọi, không kiểm tra tham số, nên không phát hiện
    // được nếu quay lại gọi playAlertBeep() không offset (Review Findings
    // round 1: "batched beeps chồng lấp thành 1 tiếng").
    expect(playAlertBeep).toHaveBeenNthCalledWith(1, 0);
    expect(playAlertBeep).toHaveBeenNthCalledWith(2, BEEP_DURATION_SEC);
    cleanup();
  });
});

// Story 4.1: prime AudioContext ở tương tác đầu tiên của người dùng.
describe('Page - primeAlertAudioContext wiring (Story 4.1)', () => {
  it('pointerdown đầu tiên trên document -> gọi primeAlertAudioContext() đúng 1 lần, lần 2 KHÔNG gọi lại ({once:true})', () => {
    render(<Page />);
    expect(primeAlertAudioContext).not.toHaveBeenCalled();

    fireEvent.pointerDown(document);
    expect(primeAlertAudioContext).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document);
    expect(primeAlertAudioContext).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('keydown đầu tiên trên document -> gọi primeAlertAudioContext() đúng 1 lần', () => {
    render(<Page />);
    fireEvent.keyDown(document);
    expect(primeAlertAudioContext).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
