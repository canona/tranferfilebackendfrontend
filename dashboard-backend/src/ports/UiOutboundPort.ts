// Story 2.3: hexagonal outbound port MỚI, tách biệt hoàn toàn khỏi
// `AlertOutboundPort` (Design Notes: "channel-seen" là tín hiệu thô "đã nhận
// >=1 event/kênh", phát NGAY (~1s, khớp tần suất telemetry thật);
// `AlertOutboundPort.publishStateChange` chỉ phát sau debounce 5s và chỉ khi
// trạng thái thực sự đổi - dùng chung 1 port sẽ trộn 2 timing/semantic khác
// nhau. Cell "loaded" của Story 2.3 chưa cần biết ok/warning/critical, đó là
// Story 2.4).
//
// `src/core/channelState.ts` gọi port này ở nhánh "first-seen" của
// `handleTelemetry` (Boundaries). Adapter thật duy nhất implement port này là
// `src/adapters/outbound/wsUiAdapter.ts`.

export interface UiOutboundPort {
  // `channelId`: kênh vừa nhận telemetry LẦN ĐẦU (chưa từng có record nội bộ
  // trong `ChannelStateService`). `timestamp`: ISO 8601 UTC tại thời điểm
  // phát hiện (lấy từ Clock injectable của core, KHÔNG dùng Date.now() trực
  // tiếp - cùng quy ước với `ChannelStateChange.timestamp`).
  publishChannelSeen(channelId: string, timestamp: string): void;

  // Story 3.2: phát 1 mẫu bitrate MỚI ghi thành công vào ring buffer
  // (`HistoryPort.recordBitrate`) tới mọi client WS UI đang mở - mirror tinh
  // thần `publishChannelSeen` (tín hiệu thô, phát NGAY, KHÔNG debounce/
  // idempotent-guard - khác `publishChannelSeen` ở chỗ gọi cho MỌI mẫu, không
  // chỉ lần đầu/kênh). `channelState.ts` CHỈ gọi method này SAU KHI
  // `historyPort.recordBitrate` thành công, trong CÙNG try/catch hiện có -
  // record throw thì KHÔNG publish (Boundaries). `bitratePct`/`timestampMs`:
  // ĐÚNG giá trị đã truyền vào `recordBitrate` (không tính lại/không đọc lại
  // clock), giữ nhất quán tuyệt đối giữa ring buffer nội bộ và những gì
  // client nhận qua wire.
  publishHistoryPoint(channelId: string, bitratePct: number, timestampMs: number): void;
}
