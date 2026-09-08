// Bổ sung video-preview thật (AD-22): hexagonal inbound port cho snapshot,
// mirror `HeartbeatInboundPort.ts` (Story 2.7) - cùng tinh thần "1 event_type
// thêm vào tập đóng, forward thô, không debounce/mapping gì thêm". Tách khỏi
// `TelemetryInboundPort`/`HeartbeatInboundPort` vì semantic hoàn toàn khác:
// đây không phải business logic đo lường (AD-22: "dashboard-backend chỉ cache
// khung mới nhất/kênh, relay cho frontend, không xử lý ảnh") - không cần đi
// qua `ChannelStateService`/debounce 5s như telemetry, cũng không cần theo
// dõi "còn sống" như heartbeat.
//
// `src/core/snapshotRelay.ts`'s `SnapshotRelayService` implement port này.
// `src/adapters/inbound/wsTelemetryAdapter.ts` là caller duy nhất.

export interface SnapshotInboundPort {
  // `channelId`: business identifier theo đài (mirror HeartbeatInboundPort -
  // KHÔNG có field máy riêng). `imageBase64`: nguyên văn base64 JPEG lấy từ
  // `payload.image_base64` (AD-22), KHÔNG có prefix `data:...` - backend giữ
  // format-agnostic hoàn toàn, không tự thêm/diễn giải gì thêm.
  // `timestamp`: ISO 8601 UTC lấy từ envelope gốc - chỉ mang tính tham khảo/
  // replay-cho-client-muộn (mirror HeartbeatInboundPort's timestamp), KHÔNG
  // dùng để debounce (snapshot không debounce - AD-22).
  handleSnapshot(channelId: string, imageBase64: string, timestamp: string): void;
}
