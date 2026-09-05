// Story 2.1: hexagonal inbound port cho telemetry thô do transport-core phát
// (AD-11: transport-core chỉ phát telemetry thô, dashboard-backend là SINGLE
// SOURCE OF TRUTH cho debounce/ngưỡng/mapping trạng thái).
//
// `src/core/channelState.ts` implement port này; `src/adapters/inbound/
// wsTelemetryAdapter.ts` (và test giả lập) là caller duy nhất. Việc tách port
// này khỏi adapter WS là điều cho phép `src/core` test được bằng fake, không
// cần server WS/kết nối thật (Boundaries: "src/core hoàn toàn thuần").

// Tập giá trị đóng của ChannelActor's state machine (AD-9/AD-11) - KHÔNG rút
// gọn thành boolean. Khớp `toString(ConnectionState)` phía transport-core
// (transport-core/src/srt/ChannelActor.cpp).
export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'REJECTED';

// Nguồn sự thật DUY NHẤT cho tập đóng ở trên tại runtime (type ConnectionState
// chỉ tồn tại lúc biên dịch, không tự validate được dữ liệu từ JSON.parse).
// Dùng chung ở cả `wsTelemetryAdapter.ts` (validate trước khi tạo
// TelemetryEvent) lẫn `core/channelState.ts` (phòng thủ lớp 2 tại chính port
// - code review round: tránh 3 nơi tự định nghĩa lại cùng 1 tập giá trị rồi
// lệch nhau theo thời gian).
export const CONNECTION_STATES: ReadonlySet<ConnectionState> = new Set<ConnectionState>([
  'CONNECTING',
  'CONNECTED',
  'RECONNECTING',
  'REJECTED',
]);

// Đã được adapter inbound parse/validate từ EventEnvelope.payload
// (transport-core/src/telemetry/EventEnvelope.h) cho đúng event_type=telemetry:
// { bitrate_kbps: uint32, rtt_ms: double, connection_state, audio_level: [L,R] }.
export interface TelemetryEvent {
  channelId: string;
  // ISO 8601 UTC - lấy từ EventEnvelope.timestamp, chỉ mang tính tham khảo/log;
  // debounce dùng Clock injectable của core (xem channelState.ts), KHÔNG dùng
  // trường này làm nguồn thời gian debounce.
  timestamp: string;
  bitrateKbps: number;
  rttMs: number;
  connectionState: ConnectionState;
  // dBFS [L, R] - AD-23: field riêng, KHÔNG qua debounce 5s. Story 2.1 chỉ
  // forward giá trị này qua port; việc hiển thị VU meter thật thuộc Story 2.5.
  audioLevel: [number, number];
}

export interface TelemetryInboundPort {
  handleTelemetry(event: TelemetryEvent): void;
}
