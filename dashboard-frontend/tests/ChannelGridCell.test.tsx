import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// Story 2.7: prop `subType` ('machine-offline') - badge label riêng, NGUYÊN
// style/token critical (Boundaries: "không thêm token màu mới").
describe('ChannelGridCell - subType machine-offline (Story 2.7)', () => {
  it('displayState="critical" + subType="machine-offline" -> badge label riêng, khác "✕ MẤT TÍN HIỆU", data-sub-type="machine-offline"', () => {
    render(
      <ChannelGridCell
        channelId="chan-mo-1"
        stationName="Đài MO 01"
        gridPosition={0}
        loaded={true}
        displayState="critical"
        subType="machine-offline"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-mo-1');
    expect(cell).toHaveAttribute('data-display-state', 'critical');
    expect(cell).toHaveAttribute('data-sub-type', 'machine-offline');
    const badge = screen.getByTestId('alert-badge-chan-mo-1');
    expect(badge).not.toHaveTextContent('✕ MẤT TÍN HIỆU');
    expect(badge.textContent).toBeTruthy();
  });

  it('displayState="critical" + subType="machine-offline" -> badge class VẪN dùng đúng token critical (không thêm class/token mới)', () => {
    render(
      <ChannelGridCell
        channelId="chan-mo-2"
        stationName="Đài MO 02"
        gridPosition={1}
        loaded={true}
        displayState="critical"
        subType="machine-offline"
      />,
    );
    const badgeMachineOffline = screen.getByTestId('alert-badge-chan-mo-2');

    cleanup();

    render(
      <ChannelGridCell
        channelId="chan-mo-3"
        stationName="Đài MO 03"
        gridPosition={2}
        loaded={true}
        displayState="critical"
      />,
    );
    const badgeRegularCritical = screen.getByTestId('alert-badge-chan-mo-3');

    expect(badgeMachineOffline.className).toBe(badgeRegularCritical.className);
  });

  it('subType="machine-offline" nhưng displayState KHÔNG phải "critical" (vd "warning") -> KHÔNG áp dụng label riêng, badge vẫn theo displayState thật, KHÔNG có data-sub-type', () => {
    render(
      <ChannelGridCell
        channelId="chan-mo-4"
        stationName="Đài MO 04"
        gridPosition={3}
        loaded={true}
        displayState="warning"
        subType="machine-offline"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-mo-4');
    expect(cell).not.toHaveAttribute('data-sub-type');
    expect(screen.getByTestId('alert-badge-chan-mo-4')).toHaveTextContent('⚠ ABR');
  });

  it('displayState="critical" KHÔNG có subType -> badge label mặc định "✕ MẤT TÍN HIỆU" như trước (không hồi quy)', () => {
    render(
      <ChannelGridCell
        channelId="chan-mo-5"
        stationName="Đài MO 05"
        gridPosition={4}
        loaded={true}
        displayState="critical"
      />,
    );
    expect(screen.getByTestId('alert-badge-chan-mo-5')).toHaveTextContent('✕ MẤT TÍN HIỆU');
    expect(screen.getByTestId('channel-grid-cell-chan-mo-5')).not.toHaveAttribute('data-sub-type');
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

// Bổ sung video-preview thật (AD-22): prop snapshotDataUri.
describe('ChannelGridCell - snapshotDataUri (video-preview thật)', () => {
  it('displayState="ok" kèm snapshotDataUri -> thumbnail dùng ảnh thật (url(...)), KHÔNG dùng gradient giả', () => {
    render(
      <ChannelGridCell
        channelId="chan-snap-1"
        stationName="Đài Snap 1"
        gridPosition={0}
        loaded={true}
        displayState="ok"
        snapshotDataUri="data:image/jpeg;base64,ZmFrZQ=="
      />,
    );
    const style = screen.getByTestId('thumbnail-chan-snap-1').style.backgroundImage;
    expect(style).toContain('data:image/jpeg;base64,ZmFrZQ==');
  });

  it('displayState="warning" kèm snapshotDataUri -> thumbnail dùng ảnh thật, VẪN giữ icon cảnh báo chồng lên', () => {
    render(
      <ChannelGridCell
        channelId="chan-snap-2"
        stationName="Đài Snap 2"
        gridPosition={1}
        loaded={true}
        displayState="warning"
        snapshotDataUri="data:image/jpeg;base64,ZmFrZQ=="
      />,
    );
    const style = screen.getByTestId('thumbnail-chan-snap-2').style.backgroundImage;
    expect(style).toContain('data:image/jpeg;base64,ZmFrZQ==');
    expect(screen.getByTestId('thumbnail-warning-icon-chan-snap-2')).toBeInTheDocument();
  });

  it('displayState="ok" KHÔNG có snapshotDataUri (chưa nhận snapshot đầu tiên) -> fallback gradient giả hiện có, không crash', () => {
    render(
      <ChannelGridCell channelId="chan-snap-3" stationName="Đài Snap 3" gridPosition={2} loaded={true} displayState="ok" />,
    );
    const style = screen.getByTestId('thumbnail-chan-snap-3').style.backgroundImage;
    expect(style).toContain('linear-gradient');
  });

  it('displayState="critical" kèm snapshotDataUri -> VẪN dùng color-bars, KHÔNG hiện ảnh thật (transport-core không gửi snapshot khi critical, nhưng UI phải an toàn kể cả khi có dữ liệu cũ)', () => {
    render(
      <ChannelGridCell
        channelId="chan-snap-4"
        stationName="Đài Snap 4"
        gridPosition={3}
        loaded={true}
        displayState="critical"
        snapshotDataUri="data:image/jpeg;base64,ZmFrZQ=="
      />,
    );
    expect(screen.getByTestId('color-bars-chan-snap-4')).toBeInTheDocument();
    expect(screen.queryByTestId('thumbnail-chan-snap-4')).toBeNull();
  });
});

describe('ChannelGridCell - onSelect (Story 3.2)', () => {
  it('click vào ô -> gọi onSelect(channelId) đúng 1 lần', () => {
    let selectedId: string | undefined;
    render(
      <ChannelGridCell
        channelId="chan-select-1"
        stationName="Đài Select 1"
        gridPosition={0}
        loaded={true}
        onSelect={(channelId) => {
          selectedId = channelId;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('channel-grid-cell-chan-select-1'));
    expect(selectedId).toBe('chan-select-1');
  });

  it('không truyền onSelect -> click không throw (an toàn, tương thích ngược)', () => {
    render(<ChannelGridCell channelId="chan-select-2" stationName="Đài Select 2" gridPosition={1} loaded={false} />);
    expect(() => fireEvent.click(screen.getByTestId('channel-grid-cell-chan-select-2'))).not.toThrow();
  });

  it('click nhiều lần -> onSelect gọi đúng số lần tương ứng', () => {
    let callCount = 0;
    render(
      <ChannelGridCell
        channelId="chan-select-3"
        stationName="Đài Select 3"
        gridPosition={2}
        loaded={true}
        onSelect={() => {
          callCount++;
        }}
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-select-3');
    fireEvent.click(cell);
    fireEvent.click(cell);
    expect(callCount).toBe(2);
  });

  // Code review round 2 [patch #4]: ô kênh có hành vi click mới (mở
  // detail-panel) nhưng trước patch KHÔNG thao tác được bằng bàn phím
  // (accessibility regression cho 1 control tương tác mới thêm vào - Epic 3
  // context's Accessibility: "cần tương thích ngay từ Epic 3").
  it('có onSelect -> tabIndex=0 (vào thứ tự Tab)', () => {
    render(
      <ChannelGridCell
        channelId="chan-select-4"
        stationName="Đài Select 4"
        gridPosition={3}
        loaded={true}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('channel-grid-cell-chan-select-4')).toHaveAttribute('tabIndex', '0');
  });

  it('không có onSelect -> KHÔNG có tabIndex (không đưa vào thứ tự Tab của 1 ô không tương tác)', () => {
    render(<ChannelGridCell channelId="chan-select-5" stationName="Đài Select 5" gridPosition={4} loaded={true} />);
    expect(screen.getByTestId('channel-grid-cell-chan-select-5')).not.toHaveAttribute('tabIndex');
  });

  it('nhấn Enter trên ô (có onSelect) -> gọi đúng onSelect(channelId)', () => {
    let selectedId: string | undefined;
    render(
      <ChannelGridCell
        channelId="chan-select-6"
        stationName="Đài Select 6"
        gridPosition={5}
        loaded={true}
        onSelect={(channelId) => {
          selectedId = channelId;
        }}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('channel-grid-cell-chan-select-6'), { key: 'Enter' });
    expect(selectedId).toBe('chan-select-6');
  });

  it('nhấn Space trên ô (có onSelect) -> gọi đúng onSelect(channelId), preventDefault (không cuộn trang)', () => {
    let selectedId: string | undefined;
    render(
      <ChannelGridCell
        channelId="chan-select-7"
        stationName="Đài Select 7"
        gridPosition={6}
        loaded={true}
        onSelect={(channelId) => {
          selectedId = channelId;
        }}
      />,
    );
    const event = fireEvent.keyDown(screen.getByTestId('channel-grid-cell-chan-select-7'), { key: ' ' });
    expect(selectedId).toBe('chan-select-7');
    // fireEvent.keyDown trả về `false` khi handler gọi preventDefault().
    expect(event).toBe(false);
  });

  it('nhấn phím khác Enter/Space -> KHÔNG gọi onSelect', () => {
    let callCount = 0;
    render(
      <ChannelGridCell
        channelId="chan-select-8"
        stationName="Đài Select 8"
        gridPosition={7}
        loaded={true}
        onSelect={() => {
          callCount++;
        }}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('channel-grid-cell-chan-select-8'), { key: 'Tab' });
    expect(callCount).toBe(0);
  });

  it('không truyền onSelect -> nhấn Enter/Space không throw (an toàn)', () => {
    render(<ChannelGridCell channelId="chan-select-9" stationName="Đài Select 9" gridPosition={8} loaded={false} />);
    const cell = screen.getByTestId('channel-grid-cell-chan-select-9');
    expect(() => fireEvent.keyDown(cell, { key: 'Enter' })).not.toThrow();
    expect(() => fireEvent.keyDown(cell, { key: ' ' })).not.toThrow();
  });
});

// Story 3.3 (Boundaries): `.acknowledged` CHỈ đổi border-style sang dashed +
// thêm `ack-label`, KHÔNG đổi màu nền/viền/badge gốc.
describe('ChannelGridCell - ackLabel (Story 3.3)', () => {
  it('ackLabel có giá trị + loaded=true -> render ack-label đúng nguyên văn "✓ Đã nhận: {label}", className kèm class acknowledged', () => {
    render(
      <ChannelGridCell
        channelId="chan-ack-1"
        stationName="Đài Ack 01"
        gridPosition={0}
        loaded={true}
        displayState="warning"
        ackLabel="NV.A"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-ack-1');
    expect(screen.getByTestId('ack-label-chan-ack-1')).toHaveTextContent('✓ Đã nhận: NV.A');
    expect(cell.className).toMatch(/acknowledged/);
  });

  it('ackLabel=undefined (chưa ack) -> KHÔNG render ack-label, KHÔNG có class acknowledged', () => {
    render(
      <ChannelGridCell
        channelId="chan-ack-2"
        stationName="Đài Ack 02"
        gridPosition={0}
        loaded={true}
        displayState="warning"
      />,
    );
    const cell = screen.getByTestId('channel-grid-cell-chan-ack-2');
    expect(screen.queryByTestId('ack-label-chan-ack-2')).toBeNull();
    expect(cell.className).not.toMatch(/acknowledged/);
  });

  it('ackLabel có giá trị NHƯNG loaded=false (skeleton) -> KHÔNG render ack-label (gate theo loaded, mirror channelName/badge)', () => {
    render(
      <ChannelGridCell
        channelId="chan-ack-3"
        stationName="Đài Ack 03"
        gridPosition={0}
        loaded={false}
        ackLabel="NV.A"
      />,
    );
    expect(screen.queryByTestId('ack-label-chan-ack-3')).toBeNull();
  });

  it('ackLabel có giá trị + displayState="critical" -> badge/border-color gốc KHÔNG đổi (chỉ thêm ack-label + border-style dashed)', () => {
    render(
      <ChannelGridCell
        channelId="chan-ack-4"
        stationName="Đài Ack 04"
        gridPosition={0}
        loaded={true}
        displayState="critical"
      />,
    );
    const badgeWithoutAck = screen.getByTestId('alert-badge-chan-ack-4').className;
    const cellWithoutAck = screen.getByTestId('channel-grid-cell-chan-ack-4').className;
    cleanup();

    render(
      <ChannelGridCell
        channelId="chan-ack-5"
        stationName="Đài Ack 05"
        gridPosition={0}
        loaded={true}
        displayState="critical"
        ackLabel="NV.A"
      />,
    );
    const badgeWithAck = screen.getByTestId('alert-badge-chan-ack-5').className;
    const cellWithAck = screen.getByTestId('channel-grid-cell-chan-ack-5').className;

    expect(badgeWithAck).toBe(badgeWithoutAck);
    // className chỉ THÊM đúng 1 class acknowledged, không đổi/xoá class trạng
    // thái critical đã có (Boundaries: "CHỈ override border-style").
    expect(cellWithAck.startsWith(cellWithoutAck)).toBe(true);
    expect(cellWithAck.slice(cellWithoutAck.length)).toMatch(/acknowledged/);
    expect(screen.getByTestId('alert-badge-chan-ack-5')).toHaveTextContent('✕ MẤT TÍN HIỆU');
  });
});

// Story 5.2 (spec-5-2): `--color-cell-border` mới thay `--color-border` gốc
// cho border của `.cell`/`.loaded`/`.ok`/`.skeleton` (AA >=3:1, xem
// tokens.css). jsdom/Vitest (css:false mặc định) không load stylesheet thật
// nên không thể đo giá trị màu render qua getComputedStyle - test ở đây chỉ
// khoá lại đúng CLASS trạng thái vẫn được áp dụng như trước (regression guard
// cho việc đổi nguồn token, không đổi logic chọn class). Đo contrast thực tế
// bằng công thức WCAG relative luminance được ghi ở Completion Notes.
describe('ChannelGridCell - cell border token (Story 5.2)', () => {
  it('loaded=true, displayState="ok" -> className vẫn kèm class "ok" (border dùng --color-cell-border qua .ok)', () => {
    render(
      <ChannelGridCell
        channelId="chan-border-1"
        stationName="Đài Border 01"
        gridPosition={0}
        loaded={true}
        displayState="ok"
      />,
    );
    expect(screen.getByTestId('channel-grid-cell-chan-border-1').className).toMatch(/ok/);
  });

  it('loaded=true, displayState=undefined -> className vẫn kèm class "loaded" (border dùng --color-cell-border qua .loaded)', () => {
    render(
      <ChannelGridCell channelId="chan-border-2" stationName="Đài Border 02" gridPosition={1} loaded={true} />,
    );
    expect(screen.getByTestId('channel-grid-cell-chan-border-2').className).toMatch(/loaded/);
  });

  it('loaded=false -> className vẫn kèm class "skeleton" (border-mix nguồn đổi sang --color-cell-border qua .skeleton)', () => {
    render(
      <ChannelGridCell channelId="chan-border-3" stationName="Đài Border 03" gridPosition={2} loaded={false} />,
    );
    expect(screen.getByTestId('channel-grid-cell-chan-border-3').className).toMatch(/skeleton/);
  });
});

// Code review [patch, Story 5.2]: 3 test ở trên chỉ khoá `className` có sẵn từ
// trước (ok/loaded/skeleton, không đổi trong diff), KHÔNG khoá giá trị token/
// tỉ lệ color-mix thực tế đã đổi - revert `--color-cell-border` hoặc tỉ lệ mix
// `.skeleton` (65%->55%) về giá trị cũ (mất AA) vẫn để 3 test đó pass 100%.
// jsdom/Vitest (css:false) không load stylesheet thật nên không đo được màu
// qua getComputedStyle (xem describe trên) - test ở đây đọc thẳng SOURCE TEXT
// của 2 file CSS để khoá đúng property/token/tỉ lệ, phát hiện được đúng loại
// revert mà 3 test className không phát hiện được.
describe('ChannelGridCell - cell border token wiring khoá qua CSS source (Story 5.2)', () => {
  const tokensCss = readFileSync(join(__dirname, '../src/styles/tokens.css'), 'utf-8');
  const cellCss = readFileSync(join(__dirname, '../src/components/ChannelGridCell.module.css'), 'utf-8');

  it('--color-cell-border alias var(--color-text-secondary) (đã đo AA 7.264:1/6.509:1)', () => {
    expect(tokensCss).toMatch(/--color-cell-border:\s*var\(--color-text-secondary\)/);
  });

  it('.cell/.loaded/.ok dùng var(--color-cell-border), KHÔNG còn var(--color-border) gốc cho border', () => {
    expect(cellCss).toMatch(/\.cell\s*\{[^}]*border:\s*1\.5px solid var\(--color-cell-border\)/);
    expect(cellCss).toMatch(/\.loaded\s*\{[^}]*border-color:\s*var\(--color-cell-border\)/);
    expect(cellCss).toMatch(/\n\.ok\s*\{[^}]*border-color:\s*var\(--color-cell-border\)/);
  });

  it('.skeleton dùng tỉ lệ color-mix 65% (không phải 55%, đo dưới AA) từ var(--color-cell-border)', () => {
    expect(cellCss).toMatch(/\.skeleton\s*\{[^}]*color-mix\(in srgb, var\(--color-cell-border\) 65%, transparent\)/);
  });
});

// Story 5.2 (spec-5-2): vu-meter marker phi-màu báo zone hiện tại (bổ sung
// cho gradient màu đã có) - I/O matrix: normal -> ẩn; [warning-mark,
// peak-mark) -> "⚠"; >= peak-mark -> "✕". Vị trí bám theo `percent` HIỆN TẠI
// (khác 2 vạch ngưỡng cố định warning-mark/peak-mark luôn hiện, không đổi).
describe('ChannelGridCell - vu-meter zone marker (Story 5.2)', () => {
  it('percent ở zone normal (< warning-mark 80%) -> KHÔNG render marker glyph', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-1"
        stationName="Đài Zone 01"
        gridPosition={0}
        loaded={true}
        audioLevel={[-30, -30]}
      />,
    );
    expect(screen.queryByTestId('vu-meter-left-zone-marker-chan-zone-1')).toBeNull();
    expect(screen.queryByTestId('vu-meter-right-zone-marker-chan-zone-1')).toBeNull();
  });

  it('percent trong zone warning ([80%,95%)) -> render marker "⚠", data-zone="warning"', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-2"
        stationName="Đài Zone 02"
        gridPosition={1}
        loaded={true}
        // (-10+60)/60*100 = 83.33...% -> trong [80,95)
        audioLevel={[-10, -10]}
      />,
    );
    const marker = screen.getByTestId('vu-meter-left-zone-marker-chan-zone-2');
    expect(marker).toHaveTextContent('⚠');
    expect(marker).toHaveAttribute('data-zone', 'warning');
    // Code review [patch #6]: warning KHÔNG được lây nhầm class critical
    // (chống hồi quy nếu ternary chọn class bị đảo/xoá).
    expect(marker.className).not.toMatch(/vuMeterZoneMarkerCritical/);
  });

  it('percent đúng bằng warning-mark (80%, biên dưới) -> zone="warning" (inclusive, khớp I/O matrix "[warning, peak)")', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-3"
        stationName="Đài Zone 03"
        gridPosition={2}
        loaded={true}
        // -12 dBFS = đúng AUDIO_LEVEL_WARNING_MARK_DBFS -> percent = 80% chẵn
        audioLevel={[-12, -12]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-zone-3');
    expect(left).toHaveAttribute('data-percent', '80');
    expect(screen.getByTestId('vu-meter-left-zone-marker-chan-zone-3')).toHaveAttribute('data-zone', 'warning');
  });

  it('percent trong zone critical (>= peak-mark 95%) -> render marker "✕", data-zone="critical"', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-4"
        stationName="Đài Zone 04"
        gridPosition={3}
        loaded={true}
        // (-2+60)/60*100 = 96.66...% -> >= 95
        audioLevel={[-2, -2]}
      />,
    );
    const marker = screen.getByTestId('vu-meter-left-zone-marker-chan-zone-4');
    expect(marker).toHaveTextContent('✕');
    expect(marker).toHaveAttribute('data-zone', 'critical');
    // Code review [patch #6]: critical PHẢI có class riêng cho hình dạng
    // to/đậm hơn (`.vuMeterZoneMarkerCritical`) - chống hồi quy nếu ternary
    // chọn class bị đảo/xoá (không còn phân biệt "bằng HÌNH DẠNG" như CSS
    // comment của `.vuMeterZoneMarkerCritical` yêu cầu).
    expect(marker.className).toMatch(/vuMeterZoneMarkerCritical/);
  });

  it('percent đúng bằng peak-mark (95%, biên) -> zone="critical" (không rơi vào warning)', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-5"
        stationName="Đài Zone 05"
        gridPosition={4}
        loaded={true}
        // -3 dBFS = đúng AUDIO_LEVEL_PEAK_MARK_DBFS -> percent = 95% chẵn
        audioLevel={[-3, -3]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-zone-5');
    expect(left).toHaveAttribute('data-percent', '95');
    expect(screen.getByTestId('vu-meter-left-zone-marker-chan-zone-5')).toHaveAttribute('data-zone', 'critical');
  });

  // Code review [patch #4]: percent gần/đúng 100% (audioLevel Infinity/
  // clipping) - marker's `bottom` style phải bị TRẦN ở 97% để nửa trên glyph
  // không tràn lên trên mép `.vuMeterWrapper` (rủi ro bị `.cell`'s
  // overflow:hidden cắt mất), NHƯNG `data-percent`/`data-zone` vẫn phải phản
  // ánh giá trị THẬT (100%/critical) - chỉ clamp phần HIỂN THỊ, không clamp
  // dữ liệu.
  it('percent=100 (audioLevel Infinity/clipping) -> marker bottom bị trần ở 97% để không tràn khỏi wrapper, nhưng data-percent/data-zone vẫn phản ánh giá trị thật', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-10"
        stationName="Đài Zone 10"
        gridPosition={9}
        loaded={true}
        audioLevel={[Infinity, Infinity]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-zone-10');
    const marker = screen.getByTestId('vu-meter-left-zone-marker-chan-zone-10');
    expect(left).toHaveAttribute('data-percent', '100');
    expect(marker).toHaveAttribute('data-zone', 'critical');
    expect(marker.style.bottom).toBe('97%');
  });

  it('vị trí marker (style.bottom) khớp đúng percent HIỆN TẠI, khác vị trí cố định của threshold-mark', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-6"
        stationName="Đài Zone 06"
        gridPosition={5}
        loaded={true}
        audioLevel={[-10, -10]}
      />,
    );
    const left = screen.getByTestId('vu-meter-left-chan-zone-6');
    const marker = screen.getByTestId('vu-meter-left-zone-marker-chan-zone-6');
    expect(marker.style.bottom).toBe(`${left.getAttribute('data-percent')}%`);
  });

  it('L và R độc lập nhau: L ở zone normal, R ở zone critical -> marker CHỈ hiện đúng cho R', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-7"
        stationName="Đài Zone 07"
        gridPosition={6}
        loaded={true}
        audioLevel={[-30, -2]}
      />,
    );
    expect(screen.queryByTestId('vu-meter-left-zone-marker-chan-zone-7')).toBeNull();
    expect(screen.getByTestId('vu-meter-right-zone-marker-chan-zone-7')).toHaveAttribute('data-zone', 'critical');
  });

  it('displayState="critical" nhưng audioLevel ở zone normal -> marker KHÔNG hiện (marker chỉ phụ thuộc percent, độc lập displayState)', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-8"
        stationName="Đài Zone 08"
        gridPosition={7}
        loaded={true}
        displayState="critical"
        audioLevel={[-30, -30]}
      />,
    );
    expect(screen.queryByTestId('vu-meter-left-zone-marker-chan-zone-8')).toBeNull();
    expect(screen.queryByTestId('vu-meter-right-zone-marker-chan-zone-8')).toBeNull();
  });

  it('audioLevel=[NaN,Infinity] (dữ liệu hỏng) -> percent 0/100 tương ứng, marker theo đúng zone suy ra (0%=normal ẩn, 100%=critical hiện), không crash', () => {
    render(
      <ChannelGridCell
        channelId="chan-zone-9"
        stationName="Đài Zone 09"
        gridPosition={8}
        loaded={true}
        audioLevel={[NaN, Infinity]}
      />,
    );
    expect(screen.queryByTestId('vu-meter-left-zone-marker-chan-zone-9')).toBeNull();
    expect(screen.getByTestId('vu-meter-right-zone-marker-chan-zone-9')).toHaveAttribute('data-zone', 'critical');
  });
});
