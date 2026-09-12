// Story 3.2: `detail-panel` - overlay mở khi click 1 `channel-grid-cell`
// (Boundaries: overlay, KHÔNG route/điều hướng trang; đóng bằng Esc hoặc
// click backdrop; không chặn thao tác lưới phía sau - lưới vẫn render/nhận
// update WS bình thường phía sau panel).
//
// 3 trạng thái đúng I/O matrix (Story 3.2 AC):
//  - `loading`: skeleton số liệu + biểu đồ - mặc định TRƯỚC KHI nhận
//    `channel-history-snapshot` của đúng kênh này (chưa có entry trong
//    `channelHistory`).
//  - `loaded`: bitrate hiện tại (mẫu MỚI NHẤT, Design Notes) + biểu đồ đường
//    SVG thuần (KHÔNG dùng thư viện chart ngoài - Ask First đã chốt).
//  - `no-history-data`: bitrate hiện tại = "—", vùng biểu đồ hiện thông báo
//    thiếu dữ liệu (KHÔNG phải mảng rỗng/biểu đồ trống).
//
// Tên đài/đầu mối liên hệ lấy từ `channels` đã có sẵn trong store (Story
// 2.2/2.3) - KHÔNG thêm field registry mới (Boundaries).

import { useEffect } from 'react';
import type { ChannelStore, HistoryPoint } from '../state/channelStore';
import { useChannelStore } from '../state/channelStore';
import styles from './DetailPanel.module.css';

const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;
// Biểu đồ SVG thuần chỉ để quan sát XU HƯỚNG lịch sử bitrate (không phải số
// liệu chính xác - bitrate hiện tại đã hiện riêng bằng số ở trên) - clamp
// hiển thị vào khoảng 0-120% (bitrate có thể vượt 100% khi ABR đẩy lên trên
// baseline) để 1 điểm bất thường không kéo méo toàn bộ trục còn lại.
const CHART_DISPLAY_MAX_PCT = 120;

function clampForChart(bitratePct: number): number {
  if (Number.isNaN(bitratePct)) return 0;
  return Math.min(CHART_DISPLAY_MAX_PCT, Math.max(0, bitratePct));
}

// Code review round 2 [patch #6]: nhãn số bitrate hiện tại đọc CÙNG 1 giá trị
// (`latestPoint.bitratePct`) như chart nhưng trước đây không guard NaN trong
// khi chart (`clampForChart`) đã guard - 2 nơi cùng đọc 1 input bất thường
// nhưng xử lý không nhất quán, số nhãn có thể ra "NaN%". Dùng CHUNG guard/
// fallback với chart (0) trước khi làm tròn hiển thị.
function safeBitratePctForLabel(bitratePct: number): number {
  return Number.isNaN(bitratePct) ? 0 : bitratePct;
}

// Code review round 2 [patch #3]: trục X phải tỉ lệ theo `timestampMs` THỰC
// TẾ của từng điểm (khoảng [min, max] của mảng), KHÔNG theo chỉ số mảng - nếu
// dùng index, mẫu đến không đều nhịp (network jitter/gap dữ liệu) sẽ vẽ méo
// xu hướng thật (khoảng thời gian dài/ngắn giữa 2 mẫu bị coi như bằng nhau).
function xForTimestamp(timestampMs: number, minTimestampMs: number, maxTimestampMs: number): number {
  const span = maxTimestampMs - minTimestampMs;
  if (span <= 0) return 0;
  return ((timestampMs - minTimestampMs) / span) * CHART_WIDTH;
}

function buildPolylinePoints(points: readonly HistoryPoint[]): string {
  const n = points.length;
  if (n === 0) return '';
  const timestamps = points.map((p) => p.timestampMs);
  const minTimestampMs = Math.min(...timestamps);
  const maxTimestampMs = Math.max(...timestamps);
  return points
    .map((p) => {
      // n===1 (hoặc mọi điểm cùng timestampMs, span===0) -> x=0 qua
      // `xForTimestamp`'s guard `span<=0` (mirror hành vi cũ cho 1 điểm).
      const x = xForTimestamp(p.timestampMs, minTimestampMs, maxTimestampMs);
      const y = CHART_HEIGHT - (clampForChart(p.bitratePct) / CHART_DISPLAY_MAX_PCT) * CHART_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export interface DetailPanelProps {
  store: ChannelStore;
}

export function DetailPanel({ store }: DetailPanelProps) {
  const state = useChannelStore(store);
  const { selectedChannelId } = state;
  const isOpen = selectedChannelId !== null;

  // Boundaries: "đóng bằng Esc (window keydown) ... bắt buộc, không chỉ
  // click-outside" - listener gắn TRÊN window, chỉ khi panel đang mở (tránh
  // lắng nghe thừa khi đóng).
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        store.clearSelectedChannel();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, store]);

  if (selectedChannelId === null) return null;

  const channel = state.channels.find((c) => c.channelId === selectedChannelId);
  const historyState = state.channelHistory.get(selectedChannelId) ?? { state: 'loading' as const };

  const latestPoint =
    historyState.state === 'loaded' && historyState.points.length > 0
      ? historyState.points[historyState.points.length - 1]
      : undefined;
  const bitrateLabel =
    historyState.state === 'loaded' && latestPoint ? `${Math.round(safeBitratePctForLabel(latestPoint.bitratePct))}%` : '—';

  return (
    <div
      className={styles.backdrop}
      data-testid="detail-panel-backdrop"
      onClick={() => store.clearSelectedChannel()}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={channel?.stationName || 'Chi tiết kênh'}
        data-testid="detail-panel"
        data-state={historyState.state}
        data-channel-id={selectedChannelId}
        // Click BÊN TRONG panel không được lan lên backdrop (không tự đóng).
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.stationName} data-testid="detail-panel-station-name">
            {channel?.stationName ?? ''}
          </h2>
        </div>

        <div className={styles.block}>
          <div className={styles.label}>Bitrate hiện tại</div>
          {historyState.state === 'loading' ? (
            <div className={styles.skeletonLine} data-testid="detail-panel-bitrate-skeleton" />
          ) : (
            <div className={styles.bitrateValue} data-testid="detail-panel-bitrate">
              {bitrateLabel}
            </div>
          )}
        </div>

        <div className={styles.chartBlock} data-testid="detail-panel-chart">
          {historyState.state === 'loading' ? (
            <div className={styles.skeletonChart} data-testid="detail-panel-chart-skeleton" />
          ) : historyState.state === 'no-history-data' ? (
            <div className={styles.noHistoryMessage} data-testid="detail-panel-no-history">
              Chưa có dữ liệu lịch sử
            </div>
          ) : (
            <svg
              className={styles.chartSvg}
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
              data-testid="detail-panel-chart-svg"
            >
              {/* Code review round 2 [patch #2]: `points.length === 1` (mẫu
                  bitrate ĐẦU TIÊN của 1 kênh - kịch bản thật, không phải edge
                  case hiếm) -> polyline 1 điểm không vẽ ra gì, trông giống hệt
                  trạng thái trống/no-history-data (đúng nhầm lẫn story này
                  phải tránh: "tránh hiểu nhầm bitrate=0 là sự cố"/thiếu dữ
                  liệu). Vẽ 1 marker tròn rõ ràng tại điểm đó thay vì để trống -
                  polyline vẫn giữ nguyên (rỗng khi n===1, không ảnh hưởng khi
                  n>=2). */}
              {historyState.points.length === 1 && historyState.points[0] ? (
                <circle
                  cx={0}
                  cy={CHART_HEIGHT - (clampForChart(historyState.points[0].bitratePct) / CHART_DISPLAY_MAX_PCT) * CHART_HEIGHT}
                  r={3}
                  className={styles.chartPointMarker}
                  data-testid="detail-panel-chart-single-point-marker"
                />
              ) : null}
              <polyline points={buildPolylinePoints(historyState.points)} fill="none" className={styles.chartLine} />
            </svg>
          )}
        </div>

        <div className={styles.block}>
          <div className={styles.label}>Đầu mối liên hệ</div>
          <div className={styles.contactName} data-testid="detail-panel-contact-name">
            {channel?.contactName ?? ''}
          </div>
          <div className={styles.contactPhone} data-testid="detail-panel-contact-phone">
            {channel?.contactPhone ?? ''}
          </div>
        </div>
      </div>
    </div>
  );
}
