// Story 2.7: `connection-banner` (MỚI) - banner cảnh báo toàn cục khi kênh WS
// UI (dashboard-frontend <-> dashboard-backend) đứt kết nối (Boundaries/
// DESIGN.md dòng 141-146/227: full-width, `position: fixed; top:0`, nền
// `state-critical`/chữ `on-state-critical`, hiện giờ `lastConnectedAt` dạng
// `HH:mm`; ẩn hoàn toàn khi `connectionStatus==='connected'`). Component
// thuần - không tự biết gì về `grid-overlay` (đó là `page.tsx`, phủ lên
// CHÍNH `channel-grid`, không phải lên banner này).

import styles from './ConnectionBanner.module.css';

export interface ConnectionBannerProps {
  connectionStatus: 'connected' | 'disconnected';
  lastConnectedAt: string | null;
}

// `lastConnectedAt` có thể là `null` (chưa từng connect thành công lần nào -
// về lý thuyết không xảy ra trong thực tế vì banner chỉ hiện SAU khi đã từng
// 'connected' rồi 'disconnected' sau đó, nhưng vẫn guard tường minh) hoặc 1
// chuỗi ISO không parse được (dữ liệu hỏng) - cả 2 fallback về '--:--' thay vì
// "Invalid Date"/crash.
function formatHHmm(iso: string | null): string {
  if (!iso) return '--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function ConnectionBanner({ connectionStatus, lastConnectedAt }: ConnectionBannerProps) {
  // Boundaries: "ẩn hoàn toàn khi connectionStatus==='connected'" - không
  // render gì (không phải render rồi ẩn bằng CSS - tránh mọi khả năng layout
  // trống/ảnh hưởng screen reader khi ẩn).
  if (connectionStatus === 'connected') return null;

  return (
    <div className={styles.banner} role="alert" data-testid="connection-banner">
      Mất kết nối dữ liệu giám sát - cập nhật lần cuối lúc {formatHHmm(lastConnectedAt)}
    </div>
  );
}
