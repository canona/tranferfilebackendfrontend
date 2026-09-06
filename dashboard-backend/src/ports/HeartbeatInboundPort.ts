// Story 2.7: hexagonal inbound port cho heartbeat, mirror
// `TelemetryInboundPort.ts` (AD-11 tinh thần tương tự: transport-core phát
// heartbeat mỗi 5s/kênh qua envelope chung `event_type=heartbeat`, ĐỘC LẬP
// hoàn toàn `connection_state` - Epic 2 context: "Heartbeat: event_type=
// heartbeat, mỗi 5s, độc lập connection_state; backend theo dõi 'last
// heartbeat'/máy để suy ra machine-offline"). Tách port này khỏi
// `TelemetryInboundPort` (dù cùng adapter `wsTelemetryAdapter.ts` forward cả
// 2) vì 2 semantic khác nhau: telemetry mang state cần debounce 5s, heartbeat
// chỉ là "còn sống" thô, không debounce, không mapping ok/warning/critical.
//
// `src/core/channelState.ts` implement port này (cùng 1 class implement CẢ
// `TelemetryInboundPort` LẪN `HeartbeatInboundPort` - Boundaries: "channel_id
// CHÍNH LÀ định danh máy trung tâm (1-1) ... heartbeat track thẳng theo
// channelId, KHÔNG thêm field machineId/registry mới", nên cả 2 port tra cứu
// chung 1 Map theo channelId, không cần 2 core service riêng biệt).
// `src/adapters/inbound/wsTelemetryAdapter.ts` là caller duy nhất.

export interface HeartbeatInboundPort {
  // `channelId`: business identifier cố định theo đài (đã xác nhận 1-1 với
  // `center_main.exe`/máy trung tâm - KHÔNG có field machineId/registry riêng,
  // Boundaries). `timestamp`: ISO 8601 UTC lấy từ envelope gốc - CHỈ mang tính
  // tham khảo/log (mirror `TelemetryEvent.timestamp`'s quy ước); core dùng
  // Clock injectable của chính nó (KHÔNG dùng field này) để tính
  // `lastHeartbeatAt`/so sánh timeout, giữ nhất quán với debounce của
  // `handleTelemetry`.
  handleHeartbeat(channelId: string, timestamp: string): void;
}
