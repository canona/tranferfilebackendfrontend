// Story 2.1: hexagonal outbound port mà `src/core/channelState.ts` gọi mỗi
// khi trạng thái hiển thị của 1 kênh vừa CHỐT (sau debounce >=5s). Adapter
// outbound thật (Telegram/Email/WebSocket->React) là các story sau (Never:
// "Implement adapter outbound thật ... - chỉ cần adapter log tạm để wiring
// domain core hoàn chỉnh") - `src/adapters/outbound/logAlertAdapter.ts` là
// adapter tạm duy nhất implement port này ở story này.

// Trạng thái hiển thị đã tính - đúng 3 giá trị theo AD-11/Intent's mapping.
export type DisplayState = 'ok' | 'warning' | 'critical';

export interface ChannelStateChange {
  channelId: string;
  displayState: DisplayState;
  // Chỉ có giá trị khi REJECTED (AD-9: "nghi vấn cấu hình/bảo mật" - khác
  // sub-type với mất tín hiệu RECONNECTING thường, dù cả 2 cùng hiển thị
  // critical). undefined cho mọi trường hợp khác.
  subType?: 'config-or-security-suspected';
  // ISO 8601 UTC tại thời điểm debounce chốt xong (không phải timestamp của
  // envelope telemetry gốc) - lấy từ Clock injectable của core.
  timestamp: string;
}

export interface AlertOutboundPort {
  publishStateChange(change: ChannelStateChange): void;
}
