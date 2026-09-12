import { describe, it, expect, afterEach, vi } from 'vitest';
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

  // Code review round 3 [patch, decision]: `station_name` không được validate
  // unique ở registry - hiện `channel_id` dưới tên đài để đội trực phân biệt
  // đúng kênh đang xem khi 2 kênh trùng tên đài.
  it('header hiện đúng channel_id (data-testid detail-panel-channel-id) để phân biệt khi trùng tên đài', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => store.selectChannel('chan-1'));
    render(<DetailPanel store={store} />);

    expect(screen.getByTestId('detail-panel-channel-id').textContent).toBe('chan-1');
  });

  it('selectedChannelId trỏ tới channelId KHÔNG có trong channels (edge case) -> không crash, tên đài/liên hệ rỗng thay vì lỗi', () => {
    const store = createChannelStore();
    act(() => store.selectChannel('chan-unknown'));
    expect(() => render(<DetailPanel store={store} />)).not.toThrow();
    expect(screen.getByTestId('detail-panel-station-name').textContent).toBe('');
  });
});

// Story 3.3: nút "Xác nhận đã tiếp nhận" + input tên tắt - CHỈ hiện khi kênh
// đang warning/critical (Boundaries: đọc channelDisplayStates, KHÔNG phải
// historyState).
describe('DetailPanel - Ack (Story 3.3)', () => {
  it('displayState="ok" -> KHÔNG render nút/input ack', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'ok');
    });
    render(<DetailPanel store={store} />);

    expect(screen.queryByTestId('detail-panel-ack-button')).toBeNull();
    expect(screen.queryByTestId('detail-panel-ack-input')).toBeNull();
  });

  it('displayState="warning" -> render nút "Xác nhận đã tiếp nhận" (nguyên văn) + input, nút disabled khi input rỗng', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    render(<DetailPanel store={store} />);

    expect(screen.getByTestId('detail-panel-ack-button')).toHaveTextContent('Xác nhận đã tiếp nhận');
    expect(screen.getByTestId('detail-panel-ack-button')).toBeDisabled();
    expect(screen.getByTestId('detail-panel-ack-input')).toBeInTheDocument();
  });

  it('displayState="critical" -> nút ack cũng render (không chỉ warning)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'critical');
    });
    render(<DetailPanel store={store} />);

    expect(screen.getByTestId('detail-panel-ack-button')).toBeInTheDocument();
  });

  it('nhập tên tắt (không rỗng) -> nút hết disabled; xoá hết về rỗng -> disabled lại', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    render(<DetailPanel store={store} />);

    const input = screen.getByTestId('detail-panel-ack-input');
    fireEvent.change(input, { target: { value: 'NV.A' } });
    expect(screen.getByTestId('detail-panel-ack-button')).not.toBeDisabled();

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('detail-panel-ack-button')).toBeDisabled();
  });

  it('input TOÀN khoảng trắng -> nút vẫn disabled (I/O matrix: rỗng/toàn khoảng trắng)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    render(<DetailPanel store={store} />);

    fireEvent.change(screen.getByTestId('detail-panel-ack-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('detail-panel-ack-button')).toBeDisabled();
  });

  it('input có maxLength=64 (khớp giới hạn backend)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    render(<DetailPanel store={store} />);

    expect(screen.getByTestId('detail-panel-ack-input')).toHaveAttribute('maxlength', '64');
  });

  it('bấm nút (input không rỗng, có khoảng trắng đầu/cuối) -> gọi onAck(channelId, label ĐÃ trim())', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    const onAck = vi.fn();
    render(<DetailPanel store={store} onAck={onAck} />);

    fireEvent.change(screen.getByTestId('detail-panel-ack-input'), { target: { value: '  NV.A  ' } });
    fireEvent.click(screen.getByTestId('detail-panel-ack-button'));

    expect(onAck).toHaveBeenCalledTimes(1);
    expect(onAck).toHaveBeenCalledWith('chan-1', 'NV.A');
  });

  it('không truyền prop onAck -> bấm nút KHÔNG throw (tương thích ngược)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    render(<DetailPanel store={store} />);

    fireEvent.change(screen.getByTestId('detail-panel-ack-input'), { target: { value: 'NV.A' } });
    expect(() => fireEvent.click(screen.getByTestId('detail-panel-ack-button'))).not.toThrow();
  });

  it('kênh đang acknowledged (channelAck có entry) -> hiện "✓ Đã nhận: {label}" (nguyên văn)', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
      store.applyAckChange('chan-1', 'NV.A');
    });
    render(<DetailPanel store={store} />);

    expect(screen.getByTestId('detail-panel-ack-status')).toHaveTextContent('✓ Đã nhận: NV.A');
  });

  it('kênh CHƯA ack -> KHÔNG hiện trạng thái ack-status', () => {
    const store = createChannelStore();
    setupChannel(store);
    act(() => {
      store.selectChannel('chan-1');
      store.applyChannelDisplayStateChange('chan-1', 'warning');
    });
    render(<DetailPanel store={store} />);

    expect(screen.queryByTestId('detail-panel-ack-status')).toBeNull();
  });

  it('chuyển sang xem kênh KHÁC -> input reset về rỗng (không giữ nguyên text đã gõ của kênh trước)', () => {
    const store = createChannelStore();
    act(() => {
      store.applyRegistrySnapshot([
        { channelId: 'chan-1', stationName: 'Đài 1', contactName: 'A', contactPhone: '090', gridPosition: 0 },
        { channelId: 'chan-2', stationName: 'Đài 2', contactName: 'B', contactPhone: '091', gridPosition: 1 },
      ]);
      store.applyChannelDisplayStateChange('chan-1', 'warning');
      store.applyChannelDisplayStateChange('chan-2', 'critical');
      store.selectChannel('chan-1');
    });
    render(<DetailPanel store={store} />);

    fireEvent.change(screen.getByTestId('detail-panel-ack-input'), { target: { value: 'NV.A' } });
    expect(screen.getByTestId('detail-panel-ack-input')).toHaveValue('NV.A');

    act(() => store.selectChannel('chan-2'));

    expect(screen.getByTestId('detail-panel-ack-input')).toHaveValue('');
  });
});
