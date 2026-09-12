// Story 3.3: hexagonal inbound port MỚI cho `ack-command`, mirror
// `HeartbeatInboundPort.ts` (Design Notes: "Ack-command đi qua AckCommandPort
// riêng ở tầng adapter inbound"). Khác MỌI inbound port khác của dashboard-
// backend: caller duy nhất là `wsUiAdapter.ts` (kênh WS UI, KHÔNG phải
// `wsTelemetryAdapter.ts`) - AD-25: "ngoại lệ chiều ngược DUY NHẤT cho
// giao tiếp frontend->backend, chỉ giữa frontend<->backend, không đụng
// transport-core".
//
// `src/core/channelState.ts` implement port này (cùng lớp `ChannelStateService`
// đã implement `TelemetryInboundPort`/`HeartbeatInboundPort` - Boundaries:
// "acknowledged/ackLabel lưu trên CHÍNH ChannelRecord hiện có, KHÔNG tạo Map
// riêng" - cả 3 port tra cứu chung 1 Map theo channelId).

export interface AckCommandPort {
  // `channelId`: `channel_id` trong envelope `ack-command` (AD-25) - validate
  // qua registry TRƯỚC khi áp dụng (mirror `handleHeartbeat`; channel lạ ->
  // log `channel_unregistered`, bỏ qua, không throw).
  // `operatorLabel`: ĐÃ được `wsUiAdapter.ts` `.trim()` VÀ giới hạn <=64 ký tự
  // TRƯỚC khi forward vào đây (Code Map - KHÔNG forward giá trị thô/chưa cắt).
  // `timestampMs`: epoch ms tại thời điểm adapter nhận envelope - CHỈ mang
  // tính tham khảo (mirror quy ước `timestamp` của `HeartbeatInboundPort`: core
  // không dùng tham số này để tính toán gì, `Logger`/`JsonLinesLogger` tự stamp
  // thời điểm log riêng) - giữ lại để log audit `ack_command_applied` (AD-30)
  // có đủ ngữ cảnh nếu cần tra cứu sau này.
  handleAckCommand(channelId: string, operatorLabel: string, timestampMs: number): void;
}
