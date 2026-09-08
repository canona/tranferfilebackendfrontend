// Bổ sung video-preview thật (AD-22): `SnapshotRelayService` implement
// `SnapshotInboundPort` - validate (channel_id đã đăng ký trong registry) rồi
// forward NGUYÊN VĂN qua `SnapshotOutboundPort`, KHÔNG giữ state/cache riêng
// (Design Notes: cache "khung mới nhất/kênh" phục vụ replay-cho-client-muộn
// đặt ở `wsUiAdapter.ts` cạnh `lastState`/`seenChannels` - mirror pattern đã
// có cho `channel-state-change`/`channel-seen`, tránh tạo 2 nguồn sự thật
// khác nhau cho cùng 1 khái niệm "giá trị mới nhất/kênh"). KHÔNG debounce -
// AD-22: "dashboard-backend chỉ cache khung mới nhất/kênh (không xử lý ảnh),
// relay cho frontend" - transport-core tự kiểm soát nhịp gửi (~1.5s khi
// CONNECTED, tự ngừng khi RECONNECTING/critical).
//
// Tách khỏi `ChannelStateService` (dù cùng semantic "tra registry rồi
// forward" như `handleHeartbeat`) vì snapshot KHÔNG tương tác với debounce/
// `committed`/`pending`/`machineOfflineActive` của telemetry - bolt thêm vào
// đó chỉ làm phình to 1 class đã lớn mà không có lợi ích ghép nối nào (khác
// hẳn heartbeat, vốn thực sự đọc/ghi chung `machineOfflineActive` với
// telemetry qua cùng `ChannelRecord`).

import type { SnapshotInboundPort } from '../ports/SnapshotInboundPort.js';
import type { SnapshotOutboundPort } from '../ports/SnapshotOutboundPort.js';
import type { ChannelRegistryPort } from '../ports/ChannelRegistryPort.js';
import type { Logger } from '../logging/logger.js';

export interface SnapshotRelayServiceOptions {
  registryPort: ChannelRegistryPort;
  snapshotOutboundPort: SnapshotOutboundPort;
  logger: Logger;
}

export class SnapshotRelayService implements SnapshotInboundPort {
  private readonly registryPort: ChannelRegistryPort;
  private readonly snapshotOutboundPort: SnapshotOutboundPort;
  private readonly logger: Logger;

  constructor(options: SnapshotRelayServiceOptions) {
    this.registryPort = options.registryPort;
    this.snapshotOutboundPort = options.snapshotOutboundPort;
    this.logger = options.logger;
  }

  handleSnapshot(channelId: string, imageBase64: string, timestamp: string): void {
    // Mirror `channelState.ts`'s `handleHeartbeat`/`handleTelemetry`: registry
    // là nguồn xác thực channel_id hợp lệ DUY NHẤT (Story 2.2 Intent) - kênh
    // chưa đăng ký bị bỏ qua có chủ đích, log rõ ràng, không throw, không
    // forward (chặn 1 channel_id rác/không xác định làm phình cache replay ở
    // wsUiAdapter.ts vô thời hạn).
    if (this.registryPort.getEntry(channelId) === undefined) {
      this.logger.log({
        channel_id: channelId,
        event_type: 'channel_unregistered',
        reason: 'channel_id không có trong channel-registry - bỏ qua snapshot này',
      });
      return;
    }

    // Code review (mirror channelState.ts's handleTelemetry/handleHeartbeat
    // gọi alertPort/uiPort): 1 exception từ implementation của
    // SnapshotOutboundPort (bug tương lai ở wsUiAdapter.ts) không được thoát
    // ra ngoài, thoát ra tới tận wsTelemetryAdapter.ts's 'message' handler sẽ
    // crash cả tiến trình - log lỗi rõ ràng, không throw, giữ connection sống.
    try {
      this.snapshotOutboundPort.publishSnapshot(channelId, imageBase64, timestamp);
    } catch (err) {
      this.logger.log({
        channel_id: channelId,
        event_type: 'snapshot_publish_error',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
