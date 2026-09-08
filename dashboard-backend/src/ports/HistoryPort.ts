// Story 3.1: hexagonal port MỚI cho ring buffer lịch sử bitrate/kênh (Epic 3
// context: "HistoryPort là 1 trong các port của hexagonal core dashboard-
// backend ... trả discriminated result tường minh (state + data), test được
// độc lập bằng fake port"). Intent: thay thế "mảng rỗng/giá trị 0" (dễ hiểu
// nhầm bitrate=0 là sự cố) bằng 1 discriminated union tường minh 3 nhánh.
//
// `src/core/bitrateHistory.ts`'s `BitrateHistoryService` là implementation
// domain thuần DUY NHẤT của port này (ring buffer in-memory, KHÔNG time-series
// DB - Never/AD-14). `src/core/channelState.ts` gọi `recordBitrate()` ở mỗi
// lần `handleTelemetry` nhận telemetry hợp lệ (Boundaries) - method ghi, tách
// biệt hoàn toàn `getHistory()` (method đọc, Story 3.2 dùng sau này qua
// WebSocket, KHÔNG wiring ra ngoài ở story này - Never).

export interface BitrateHistoryPoint {
  timestampMs: number;
  bitratePct: number;
}

// Design Notes: `loading` là 1 nhánh hợp lệ của type này (hợp đồng dùng chung
// BE/FE cho Story 3.2, nơi frontend chờ phản hồi qua WebSocket) nhưng
// `BitrateHistoryService.getHistory()` đồng bộ/thuần in-memory - KHÔNG có I/O
// nào để chờ, nên implementation của story này không bao giờ tự tạo ra nhánh
// `loading`. Không phải gap - là quyết định thiết kế đã ghi rõ ở Design Notes
// spec Story 3.1.
export type HistoryQueryResult =
  | { state: 'loading' }
  | { state: 'loaded'; data: readonly BitrateHistoryPoint[] }
  | { state: 'no-history-data' };

export interface HistoryPort {
  // Ghi 1 mẫu bitrate hợp lệ cho `channelId` - gọi NGAY mỗi khi
  // `ChannelStateService.handleTelemetry` nhận telemetry cho 1 channelId ĐÃ có
  // trong channel-registry (Boundaries), ĐỘC LẬP hoàn toàn debounce 5s/
  // `committed` state hiện có (mirror tinh thần `uiPort.publishChannelSeen`:
  // tín hiệu thô, không chờ chốt trạng thái). `bitratePct`: giá trị ĐÃ tính
  // qua `computeBitratePct` (cùng giá trị dùng để mapping trạng thái hiển thị)
  // - KHÔNG phải `bitrateKbps` thô, để nhất quán với con số "Bitrate: NN%" đã
  // hiển thị ở nơi khác. `timestampMs`: epoch ms từ Clock injectable của core
  // (KHÔNG Date.now() trực tiếp - cùng quy ước `ChannelStateChange.timestamp`,
  // khác ở đây là số ms thô, không phải chuỗi ISO, vì dùng nội bộ để so sánh
  // retention window).
  recordBitrate(channelId: string, bitratePct: number, timestampMs: number): void;

  // `no-history-data` khi channelId chưa từng có mẫu nào được ghi (KHÔNG phải
  // mảng rỗng/giá trị 0 - Intent). `loaded` kèm mảng mẫu theo thứ tự thời gian
  // TĂNG DẦN khi đã có ít nhất 1 mẫu còn nằm trong retention window (~15
  // phút/kênh - mẫu cũ hơn đã bị trim, xem `bitrateHistory.ts`).
  getHistory(channelId: string): HistoryQueryResult;
}
