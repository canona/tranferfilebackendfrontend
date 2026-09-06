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

// Story 2.5: `audioLevel` (VU meter) + thumbnail/color-bars theo I/O matrix.
describe('ChannelGridCell - audioLevel / vu-meter (Story 2.5)', () => {
  it('audioLevel=[-30,-30] -> vu-meter L/R hiện đúng % theo mapping -60..0 (dưới warning-mark)', () => {
    render(
      <ChannelGridCell
        channelId="chan-1"
        stationName="Đài 01"
        gridPosition={0}
        loaded={true}
        audioLevel={[-30, -30]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-1');
    const right = screen.getByTestId('vu-meter-right-chan-1');
    // (level - (-60)) / (0 - (-60)) * 100 = (-30+60)/60*100 = 50
    expect(left).toHaveAttribute('data-percent', '50');
    expect(right).toHaveAttribute('data-percent', '50');
    expect(left).toHaveAttribute('data-level-dbfs', '-30');
  });

  it('audioLevel=[-1,-1] -> thanh gần đầy, 2 vạch ngưỡng cố định vẫn hiện đúng vị trí (80%/95%) không đổi', () => {
    render(
      <ChannelGridCell
        channelId="chan-2"
        stationName="Đài 02"
        gridPosition={1}
        loaded={true}
        audioLevel={[-1, -1]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-2');
    // (-1+60)/60*100 = 98.33...
    expect(Number(left.getAttribute('data-percent'))).toBeCloseTo((59 / 60) * 100, 5);

    const warningMark = screen.getByTestId('vu-meter-left-warning-mark-chan-2');
    const peakMark = screen.getByTestId('vu-meter-left-peak-mark-chan-2');
    expect(warningMark.style.bottom).toBe('80%');
    expect(peakMark.style.bottom).toBe('95%');
  });

  it('audioLevel ngoài khoảng thực tế [-70,3] -> clamp về 0%/100%, không NaN/crash', () => {
    render(
      <ChannelGridCell
        channelId="chan-3"
        stationName="Đài 03"
        gridPosition={2}
        loaded={true}
        audioLevel={[-70, 3]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-3');
    const right = screen.getByTestId('vu-meter-right-chan-3');
    expect(left).toHaveAttribute('data-percent', '0');
    expect(right).toHaveAttribute('data-percent', '100');
  });

  // Code review [patch, finding #4]: guard NaN của `dbfsToPercent` chưa từng
  // được exercise bằng input thực sự NaN/Infinity (test trên chỉ dùng giá trị
  // hữu hạn ngoài khoảng). NaN -> guard tường minh trả 0 (Boundaries: "không
  // NaN/crash" - không để lộ "NaN%" ra UI); Infinity clamp tự nhiên về 100%
  // qua chính công thức Math.min/Math.max hiện có (không cần guard riêng,
  // giống hệt cách giá trị hữu hạn ngoài khoảng ở trên clamp về 100%).
  it('audioLevel chứa NaN/Infinity (dữ liệu telemetry hỏng) -> data-percent là "0"/"100", không phải chuỗi "NaN", không crash', () => {
    render(
      <ChannelGridCell
        channelId="chan-3b"
        stationName="Đài 03b"
        gridPosition={2}
        loaded={true}
        audioLevel={[NaN, Infinity]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-3b');
    const right = screen.getByTestId('vu-meter-right-chan-3b');
    expect(left).toHaveAttribute('data-percent', '0');
    expect(right).toHaveAttribute('data-percent', '100');
  });

  it('displayState="critical" vẫn có audioLevel -> vu-meter VẪN hiển thị đúng mức, KHÔNG bị ẩn/khoá theo trạng thái', () => {
    render(
      <ChannelGridCell
        channelId="chan-4"
        stationName="Đài 04"
        gridPosition={3}
        loaded={true}
        displayState="critical"
        audioLevel={[-40, -5]}
      />,
    );
    expect(screen.getByTestId('vu-meter-row-chan-4')).toBeInTheDocument();
    const left = screen.getByTestId('vu-meter-left-chan-4');
    const right = screen.getByTestId('vu-meter-right-chan-4');
    expect(left).toHaveAttribute('data-level-dbfs', '-40');
    expect(right).toHaveAttribute('data-level-dbfs', '-5');
    // Đồng thời vẫn thay thumbnail bằng color-bars đúng theo trạng thái.
    expect(screen.getByTestId('color-bars-chan-4')).toBeInTheDocument();
    expect(screen.queryByTestId('thumbnail-chan-4')).toBeNull();
  });

  // Code review [patch]: Boundaries yêu cầu vu-meter độc lập với MỌI
  // displayState, nhưng trước đây chỉ có 1 test kết hợp cho `critical` - thêm
  // case `ok`/`warning` để phủ đủ cả 3 trạng thái cùng lúc có `audioLevel`.
  it('displayState="ok" vẫn có audioLevel -> vu-meter hiển thị đúng mức, đồng thời vẫn giữ thumbnail (không color-bars/icon cảnh báo)', () => {
    render(
      <ChannelGridCell
        channelId="chan-4b"
        stationName="Đài 04b"
        gridPosition={3}
        loaded={true}
        displayState="ok"
        audioLevel={[-30, -20]}
      />,
    );
    expect(screen.getByTestId('vu-meter-row-chan-4b')).toBeInTheDocument();
    expect(screen.getByTestId('vu-meter-left-chan-4b')).toHaveAttribute('data-level-dbfs', '-30');
    expect(screen.getByTestId('vu-meter-right-chan-4b')).toHaveAttribute('data-level-dbfs', '-20');
    expect(screen.getByTestId('thumbnail-chan-4b')).toBeInTheDocument();
    expect(screen.queryByTestId('thumbnail-warning-icon-chan-4b')).toBeNull();
    expect(screen.queryByTestId('color-bars-chan-4b')).toBeNull();
  });

  it('displayState="warning" vẫn có audioLevel -> vu-meter hiển thị đúng mức, đồng thời vẫn giữ thumbnail + icon cảnh báo', () => {
    render(
      <ChannelGridCell
        channelId="chan-4c"
        stationName="Đài 04c"
        gridPosition={3}
        loaded={true}
        displayState="warning"
        audioLevel={[-15, -10]}
      />,
    );
    expect(screen.getByTestId('vu-meter-row-chan-4c')).toBeInTheDocument();
    expect(screen.getByTestId('vu-meter-left-chan-4c')).toHaveAttribute('data-level-dbfs', '-15');
    expect(screen.getByTestId('vu-meter-right-chan-4c')).toHaveAttribute('data-level-dbfs', '-10');
    expect(screen.getByTestId('thumbnail-chan-4c')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-warning-icon-chan-4c')).toBeInTheDocument();
    expect(screen.queryByTestId('color-bars-chan-4c')).toBeNull();
  });

  // Code review [patch, finding #1]: `.cell` là flex row + `.vuMeterRow` có
  // `margin-left: auto` - margin đó hấp thụ khoảng trống bên TRÁI CHÍNH NÓ,
  // đẩy chính nó và MỌI flex item đứng SAU nó trong DOM sang phải. `channelName`
  // phải đứng TRƯỚC `vuMeterRow` trong DOM để neo trái đúng ý đồ thiết kế (tên
  // đài trái, vu-meter phải) - test này KHÔNG đo layout CSS thật (Testing
  // Library/jsdom không tính layout), chỉ verify thứ tự childNodes để chống
  // hồi quy nếu ai đó vô tình đảo lại thứ tự JSX.
  it('channelName render TRƯỚC vuMeterRow trong DOM (chống hồi quy layout margin-left:auto)', () => {
    render(
      <ChannelGridCell
        channelId="chan-order"
        stationName="Đài Order"
        gridPosition={0}
        loaded={true}
        audioLevel={[-30, -30]}
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-order');
    const channelNameEl = screen.getByText('Đài Order');
    const vuMeterRowEl = screen.getByTestId('vu-meter-row-chan-order');

    const children = Array.from(cell.childNodes);
    const channelNameIndex = children.indexOf(channelNameEl);
    const vuMeterRowIndex = children.indexOf(vuMeterRowEl);

    expect(channelNameIndex).toBeGreaterThanOrEqual(0);
    expect(vuMeterRowIndex).toBeGreaterThanOrEqual(0);
    expect(channelNameIndex).toBeLessThan(vuMeterRowIndex);
  });

  it('loaded=false (skeleton) -> KHÔNG render vu-meter/thumbnail dù có audioLevel/displayState', () => {
    render(
      <ChannelGridCell
        channelId="chan-6"
        stationName="Đài 06"
        gridPosition={5}
        loaded={false}
        displayState="warning"
        audioLevel={[-20, -20]}
      />,
    );
    expect(screen.queryByTestId('vu-meter-row-chan-6')).toBeNull();
    expect(screen.queryByTestId('thumbnail-chan-6')).toBeNull();
    expect(screen.queryByTestId('color-bars-chan-6')).toBeNull();
  });

  it('loaded=true không có audioLevel (undefined) -> KHÔNG render vu-meter, không crash', () => {
    render(<ChannelGridCell channelId="chan-7" stationName="Đài 07" gridPosition={6} loaded={true} />);
    expect(screen.queryByTestId('vu-meter-row-chan-7')).toBeNull();
  });

  it('displayState="warning" -> thumbnail placeholder + icon cảnh báo chồng lên', () => {
    render(
      <ChannelGridCell
        channelId="chan-8"
        stationName="Đài 08"
        gridPosition={7}
        loaded={true}
        displayState="warning"
      />,
    );
    expect(screen.getByTestId('thumbnail-chan-8')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-warning-icon-chan-8')).toBeInTheDocument();
    expect(screen.queryByTestId('color-bars-chan-8')).toBeNull();
  });

  it('displayState="ok" -> thumbnail placeholder, KHÔNG có icon cảnh báo', () => {
    render(
      <ChannelGridCell channelId="chan-9" stationName="Đài 09" gridPosition={8} loaded={true} displayState="ok" />,
    );
    expect(screen.getByTestId('thumbnail-chan-9')).toBeInTheDocument();
    expect(screen.queryByTestId('thumbnail-warning-icon-chan-9')).toBeNull();
  });

  it('displayState="critical" -> thumbnail thay hoàn toàn bằng color-bars tĩnh', () => {
    render(
      <ChannelGridCell
        channelId="chan-10"
        stationName="Đài 10"
        gridPosition={9}
        loaded={true}
        displayState="critical"
      />,
    );
    expect(screen.getByTestId('color-bars-chan-10')).toBeInTheDocument();
    expect(screen.queryByTestId('thumbnail-chan-10')).toBeNull();
  });

  it('displayState=undefined (loaded-neutral) -> KHÔNG render vùng thumbnail; vu-meter vẫn hiện nếu có audioLevel', () => {
    render(
      <ChannelGridCell
        channelId="chan-11"
        stationName="Đài 11"
        gridPosition={10}
        loaded={true}
        audioLevel={[-25, -25]}
      />,
    );
    expect(screen.queryByTestId('thumbnail-chan-11')).toBeNull();
    expect(screen.queryByTestId('color-bars-chan-11')).toBeNull();
    expect(screen.getByTestId('vu-meter-row-chan-11')).toBeInTheDocument();
  });

  it('cùng 1 channelId luôn ra cùng background thumbnail (pattern xác định theo hash channelId)', () => {
    const { unmount } = render(
      <ChannelGridCell channelId="chan-12" stationName="Đài 12" gridPosition={11} loaded={true} displayState="ok" />,
    );
    const firstStyle = screen.getByTestId('thumbnail-chan-12').style.backgroundImage;
    unmount();

    render(
      <ChannelGridCell channelId="chan-12" stationName="Đài 12" gridPosition={11} loaded={true} displayState="ok" />,
    );
    const secondStyle = screen.getByTestId('thumbnail-chan-12').style.backgroundImage;
    expect(secondStyle).toBe(firstStyle);
  });
});
