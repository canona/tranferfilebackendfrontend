import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DetailPanel } from '../src/components/DetailPanel';
import { createChannelStore } from '../src/state/channelStore';

afterEach(cleanup);

function setupChannel(store: ReturnType<typeof createChannelStore>) {
  act(() => {
    store.applyRegistrySnapshot([
      {
        channelId: 'chan-1',
        stationName: 'Đài Huế',
        contactName: 'Trần Văn Hùng',
        contactPhone: '0905123456',
        gridPosition: 8,
      },
    ]);
  });
}

describe('DetailPanel', () => {
  it('selectedChannelId=null (panel đóng) -> KHÔNG render gì cả', () => {
    const store = createChannelStore();
    render(<DetailPanel store={store} />);
    expect(screen.queryByTestId('detail-panel')).toBeNull();
  });

  it('mở panel TRƯỚC KHI nhận channel-history-snapshot -> trạng thái loading, skeleton số liệu + biểu đồ, vẫn hiện tên đài/đầu mối liên hệ', () => {
    const store = createChannelStore();
    setupChannel(store);
    render(<DetailPanel store={store} />);

    act(() => store.selectChannel('chan-1'));

    const panel = screen.getByTestId('detail-panel');
    expect(panel.getAttribute('data-state')).toBe('loading');
    expect(screen.getByTestId('detail-panel-bitrate-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('detail-panel-chart-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-panel-bitrate')).toBeNull();
    expect(screen.getByTestId('detail-panel-station-name').textContent).toBe('Đài Huế');
    expect(screen.getByTestId('detail-panel-contact-name').textContent).toBe('Trần Văn Hùng');
    expect(screen.getByTestId('detail-panel-contact-phone').textContent).toBe('0905123456');
  });

  it('đã nhận snapshot/point (state=loaded) -> hiện bitrate MẪU MỚI NHẤT + biểu đồ đường SVG', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyHistorySnapshot('chan-1', {
        state: 'loaded',
        points: [
          { timestampMs: 1000, bitratePct: 80 },
          { timestampMs: 2000, bitratePct: 62.3 },
        ],
      });
    });
    render(<DetailPanel store={store} />);

    const panel = screen.getByTestId('detail-panel');
    expect(panel.getAttribute('data-state')).toBe('loaded');
    // Bitrate hiện tại = mẫu MỚI NHẤT (điểm cuối mảng), không phải điểm đầu.
    expect(screen.getByTestId('detail-panel-bitrate').textContent).toBe('62%');
    expect(screen.getByTestId('detail-panel-chart-svg')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-panel-no-history')).toBeNull();
    expect(screen.queryByTestId('detail-panel-chart-skeleton')).toBeNull();
  });

  it('channel-history-point mới tới trong lúc panel đang mở -> bitrate hiện tại cập nhật ngay theo điểm mới (không cần đóng/mở lại panel)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyHistorySnapshot('chan-1', { state: 'loaded', points: [{ timestampMs: 1000, bitratePct: 80 }] });
    });
    render(<DetailPanel store={store} />);
    expect(screen.getByTestId('detail-panel-bitrate').textContent).toBe('80%');

    act(() => store.applyHistoryPoint('chan-1', { timestampMs: 2000, bitratePct: 33 }));
    expect(screen.getByTestId('detail-panel-bitrate').textContent).toBe('33%');
  });

  it('snapshot trả no-history-data (kênh chưa từng có mẫu) -> bitrate hiện "—", vùng biểu đồ hiện thông báo thiếu dữ liệu (KHÔNG phải biểu đồ trống)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyHistorySnapshot('chan-1', { state: 'no-history-data' });
    });
    render(<DetailPanel store={store} />);

    const panel = screen.getByTestId('detail-panel');
    expect(panel.getAttribute('data-state')).toBe('no-history-data');
    expect(screen.getByTestId('detail-panel-bitrate').textContent).toBe('—');
    expect(screen.getByTestId('detail-panel-no-history')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-panel-chart-svg')).toBeNull();
  });

  it('nhấn Esc -> đóng panel (store.selectedChannelId trở về null), lưới phía sau (channels/channelDisplayStates) giữ nguyên', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'critical');
    });
    render(<DetailPanel store={store} />);
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByTestId('detail-panel')).toBeNull();
    expect(store.getState().selectedChannelId).toBeNull();
    expect(store.getState().channelDisplayStates.get('chan-1')).toBe('critical');
  });

  it('click backdrop (ngoài panel) -> đóng panel', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => store.selectChannel('chan-1'));
    render(<DetailPanel store={store} />);

    act(() => {
      fireEvent.click(screen.getByTestId('detail-panel-backdrop'));
    });

    expect(screen.queryByTestId('detail-panel')).toBeNull();
  });

  it('click BÊN TRONG panel -> KHÔNG đóng panel (không lan lên backdrop)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => store.selectChannel('chan-1'));
    render(<DetailPanel store={store} />);

    act(() => {
      fireEvent.click(screen.getByTestId('detail-panel'));
    });

    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
  });

  it('phím khác Escape -> KHÔNG đóng panel', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => store.selectChannel('chan-1'));
    render(<DetailPanel store={store} />);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
  });

  // Code review round 2 [patch #2]: state=loaded với ĐÚNG 1 điểm (kịch bản
  // thật - mẫu bitrate ĐẦU TIÊN của 1 kênh) - polyline 1 điểm không vẽ ra gì,
  // dễ nhầm với trạng thái trống/no-history-data. Phải render 1 marker nhìn
  // thấy được thay vì để trống.
  it('state=loaded với ĐÚNG 1 điểm -> vẫn render marker/đường nhìn thấy được (không chỉ text bitrate)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyHistorySnapshot('chan-1', { state: 'loaded', points: [{ timestampMs: 1000, bitratePct: 45 }] });
    });
    render(<DetailPanel store={store} />);

    expect(screen.getByTestId('detail-panel-bitrate').textContent).toBe('45%');
    expect(screen.getByTestId('detail-panel-chart-svg')).toBeInTheDocument();
    expect(screen.getByTestId('detail-panel-chart-single-point-marker')).toBeInTheDocument();
    expect(screen.queryByTestId('detail-panel-no-history')).toBeNull();
  });

  // Code review round 2 [patch #3]: trục X phải tỉ lệ theo `timestampMs` THỰC
  // TẾ, KHÔNG theo chỉ số mảng - mẫu đến không đều nhịp phải vẽ đúng khoảng
  // cách tương ứng thời gian thực, không coi mọi khoảng cách giữa 2 điểm liên
  // tiếp là bằng nhau.
  it('điểm đến không đều nhịp -> vị trí X trên polyline tỉ lệ đúng theo timestampMs thực tế (không theo chỉ số mảng)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      // 3 điểm: t=0, t=100 (rất gần điểm đầu), t=1000 (xa nhất) - nếu vẽ theo
      // index, 3 điểm cách đều nhau 1/3 chiều rộng; theo timestampMs thực tế,
      // điểm giữa (t=100) phải nằm RẤT GẦN điểm đầu (t=0), không phải ở giữa.
      store.applyHistorySnapshot('chan-1', {
        state: 'loaded',
        points: [
          { timestampMs: 0, bitratePct: 50 },
          { timestampMs: 100, bitratePct: 50 },
          { timestampMs: 1000, bitratePct: 50 },
        ],
      });
    });
    render(<DetailPanel store={store} />);

    const polyline = screen.getByTestId('detail-panel-chart-svg').querySelector('polyline');
    expect(polyline).not.toBeNull();
    const xs = (polyline!.getAttribute('points') ?? '')
      .trim()
      .split(' ')
      .map((pair) => Number(pair.split(',')[0]));
    expect(xs.length).toBe(3);
    expect(xs[0]).toBe(0);
    // Điểm giữa (t=100/1000 = 10% khoảng cách) phải RẤT GẦN điểm đầu, cách xa
    // vị trí "cách đều" theo index (1/2 chiều rộng == 150).
    expect(xs[1]).toBeLessThan(xs[2]! * 0.2);
    expect(xs[2]).toBeCloseTo(300, 1); // CHART_WIDTH = 300, điểm cuối luôn ở max
  });

  it('selectedChannelId trỏ tới channelId KHÔNG có trong channels (edge case) -> không crash, tên đài/liên hệ rỗng thay vì lỗi', () => {
    const store = createChannelStore();
    act(() => store.selectChannel('chan-unknown'));
    expect(() => render(<DetailPanel store={store} />)).not.toThrow();
    expect(screen.getByTestId('detail-panel-station-name').textContent).toBe('');
  });
});
