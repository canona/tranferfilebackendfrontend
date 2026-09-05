// Story 2.1: tính bitrate_pct + mapping connection_state/bitrate_pct ->
// trạng thái hiển thị. Thuần domain logic - KHÔNG import ws/fs/network (xem
// Boundaries "src/core hoàn toàn thuần").

import type { ConnectionState } from '../ports/TelemetryInboundPort.js';
import type { DisplayState } from '../ports/AlertOutboundPort.js';

// Intent: "bitrate_pct = bitrate_kbps hiện tại / baseline_kbps(channel_id)".
// Guard NaN/Inf/<=0 phòng dữ liệu bất thường từ nguồn upstream (mirror tinh
// thần ChannelActor.cpp's "never let a NaN/negative stat propagate" đã áp
// dụng phía transport-core cho chính field này) - trả 0% thay vì NaN/Infinity
// lan sang mapping bên dưới.
export function computeBitratePct(bitrateKbps: number, baselineKbps: number): number {
  if (!Number.isFinite(baselineKbps) || baselineKbps <= 0) {
    return 0;
  }
  if (!Number.isFinite(bitrateKbps) || bitrateKbps < 0) {
    return 0;
  }
  return (bitrateKbps / baselineKbps) * 100;
}

export interface DisplayCandidate {
  state: DisplayState;
  subType?: 'config-or-security-suspected';
}

// Intent's bảng mapping (frozen):
//   CONNECTED + bitrate_pct>=70%  -> ok
//   CONNECTED + bitrate_pct<70%   -> warning
//   RECONNECTING                  -> critical
//   REJECTED                      -> critical, sub-type "config-or-security-suspected"
//
// CONNECTING (AD-9's 4th giá trị đóng, trạng thái transient trước khi đạt
// CONNECTED lần đầu/sau reconnect) không được nêu tường minh trong bảng gốc ở
// trên dù AC yêu cầu "nhận đủ 4 giá trị connection_state khả dĩ, mapping đúng
// ok/warning/critical". Đã XÁC NHẬN VỚI NGƯỜI DÙNG: giữ nguyên xử lý CONNECTING
// như RECONNECTING (critical, không sub-type) vì cùng bản chất "chưa có tín
// hiệu ổn định để đo bitrate" - không còn là assumption tạm, đây là quyết định
// đã chốt.
export function mapToDisplayState(connectionState: ConnectionState, bitratePct: number): DisplayCandidate {
  switch (connectionState) {
    case 'CONNECTED':
      return bitratePct >= 70 ? { state: 'ok' } : { state: 'warning' };
    case 'RECONNECTING':
      return { state: 'critical' };
    case 'REJECTED':
      return { state: 'critical', subType: 'config-or-security-suspected' };
    case 'CONNECTING':
      return { state: 'critical' };
    default: {
      // Exhaustiveness guard - ConnectionState là tập đóng 4 giá trị; nếu
      // TypeScript còn cho phép rơi vào đây nghĩa là type đã bị mở rộng mà
      // quên cập nhật mapping này.
      //
      // Code review: nhánh này KHÔNG được throw - nguyên tắc "log lỗi rõ
      // ràng, không throw crash process" áp dụng nhất quán mọi nơi trong
      // story này (vd baseline_missing ở channelState.ts). TS's exhaustive
      // switch + ConnectionState's closed union đã chặn việc chạm nhánh này
      // qua đường gọi hợp lệ hiện tại (wsTelemetryAdapter đã validate
      // connection_state trước khi tạo TelemetryEvent, channelState.ts validate
      // lại lần 2 qua CONNECTION_STATES trước khi gọi hàm này) - đây là lớp
      // phòng thủ THỨ 3, chỉ có thể chạm tới nếu 1 caller tương lai tự ép kiểu
      // (`as ConnectionState`) 1 giá trị lạ rồi gọi thẳng hàm thuần này, bỏ
      // qua cả 2 lớp validate trên. Trả về 1 candidate an toàn thay vì throw
      // để không sập tiến trình vì lỗi của caller khác - hàm này không có
      // logger (giữ đúng "src/core hoàn toàn thuần"), nên việc log lại bất
      // thường là trách nhiệm của caller (channelState.ts đã tự validate và
      // log ở lớp phòng thủ thứ 2 phía trên, trước khi gọi tới đây).
      const exhaustiveCheck: never = connectionState;
      void exhaustiveCheck;
      return { state: 'critical' };
    }
  }
}
