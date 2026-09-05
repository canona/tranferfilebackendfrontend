// Story 2.1: lõi nghiệp vụ duy nhất tính debounce >=5s/kênh + chốt trạng thái
// hiển thị (AD-11: dashboard-backend là SINGLE SOURCE OF TRUTH). Thuần domain
// - không import ws/fs/network; nhận telemetry qua TelemetryInboundPort, phát
// thay đổi qua AlertOutboundPort, tra registry qua ChannelRegistryPort - cả 3
// đều là interface, cho phép test bằng fake (Boundaries).
//
// Story 2.2: `BitrateBaselinePort` (chỉ tra baseline_kbps) đổi thành
// `ChannelRegistryPort` (trả về đầy đủ record 1 kênh, bao gồm baselineKbps) -
// registry là nguồn xác thực channel_id hợp lệ DUY NHẤT.

import { CONNECTION_STATES, type TelemetryEvent, type TelemetryInboundPort, type ConnectionState } from '../ports/TelemetryInboundPort.js';
import type { AlertOutboundPort, ChannelStateChange, DisplayState } from '../ports/AlertOutboundPort.js';
import type { ChannelRegistryPort } from '../ports/ChannelRegistryPort.js';
import type { UiOutboundPort } from '../ports/UiOutboundPort.js';
import type { Logger } from '../logging/logger.js';
import { computeBitratePct, mapToDisplayState, type DisplayCandidate } from './bitrateThreshold.js';

// Boundaries: "dùng clock injectable (không Date.now() trực tiếp trong core)
// để test được không cần chờ thật".
export interface Clock {
  now(): number; // epoch ms
}

export const systemClock: Clock = { now: () => Date.now() };

// Intent: "chỉ chốt sau khi trạng thái mới liên tục ổn định >=5s tính theo
// per-channel".
export const DEBOUNCE_MS = 5000;

interface PendingCandidate extends DisplayCandidate {
  // clock.now() tại lần đầu candidate này được quan sát liên tục (reset về
  // giá trị mới mỗi khi candidate đổi - xem I/O matrix "trạng thái dao động
  // <5s -> giữ nguyên giá trị cũ").
  since: number;
}

interface ChannelRecord {
  committed?: DisplayCandidate;
  pending?: PendingCandidate;
}

export interface ChannelStateServiceOptions {
  registryPort: ChannelRegistryPort;
  alertPort: AlertOutboundPort;
  // Story 2.3: port MỚI, tách biệt hoàn toàn khỏi `alertPort` (xem
  // `UiOutboundPort.ts`'s comment đầu file) - phát tín hiệu "đã thấy kênh"
  // thô NGAY khi có telemetry đầu tiên/kênh, không qua debounce 5s.
  uiPort: UiOutboundPort;
  logger: Logger;
  clock?: Clock;
  debounceMs?: number;
}

function sameCandidate(a: DisplayCandidate | undefined, b: DisplayCandidate): boolean {
  return a !== undefined && a.state === b.state && a.subType === b.subType;
}

export class ChannelStateService implements TelemetryInboundPort {
  private readonly registryPort: ChannelRegistryPort;
  private readonly alertPort: AlertOutboundPort;
  private readonly uiPort: UiOutboundPort;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private readonly channels = new Map<string, ChannelRecord>();

  constructor(options: ChannelStateServiceOptions) {
    this.registryPort = options.registryPort;
    this.alertPort = options.alertPort;
    this.uiPort = options.uiPort;
    this.logger = options.logger;
    this.clock = options.clock ?? systemClock;
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  }

  handleTelemetry(event: TelemetryEvent): void {
    // Code review - phòng thủ lớp 2 (lớp 1 là wsTelemetryAdapter.ts validate
    // trước khi tạo TelemetryEvent; lớp 3 là mapToDisplayState's exhaustive
    // switch default-branch): `TelemetryInboundPort` là 1 interface public,
    // 1 caller tương lai khác (không phải wsTelemetryAdapter) có thể gọi
    // thẳng handleTelemetry() với 1 connectionState không hợp lệ (vd ép kiểu
    // `as ConnectionState` từ dữ liệu chưa validate). Bắt lỗi NGAY tại cửa
    // vào của port, log rõ ràng, không throw crash process - cùng tinh thần
    // "log lỗi rõ ràng, không throw" như channel_unregistered bên dưới.
    if (!CONNECTION_STATES.has(event.connectionState)) {
      this.logger.log({
        channel_id: event.channelId,
        event_type: 'connection_state_invalid',
        reason: `connection_state không hợp lệ nhận được qua TelemetryInboundPort: ${JSON.stringify(event.connectionState)} - bỏ qua telemetry này`,
      });
      return;
    }

    const entry = this.registryPort.getEntry(event.channelId);
    if (entry === undefined) {
      // Story 2.2 Intent: registry là nguồn xác thực channel_id hợp lệ DUY
      // NHẤT - channel_id không có trong registry nghĩa là "chưa đăng ký"
      // (`channel_unregistered`, thay `baseline_missing` cũ của Story 2.1 -
      // vẫn giữ nguyên chính sách "log rõ ràng, bỏ qua đúng lần telemetry
      // này, không throw, không tạo/đổi state kênh" đã được người dùng duyệt
      // ở Story 2.1, chỉ đổi tên event_type cho khớp nguồn dữ liệu mới).
      this.logger.log({
        channel_id: event.channelId,
        event_type: 'channel_unregistered',
        reason:
          `channel_id không có trong channel-registry - bỏ qua telemetry này ` +
          `(bitrate_kbps=${event.bitrateKbps}, connection_state=${event.connectionState})`,
      });
      return;
    }

    // Story 2.3 (Boundaries): "khi nhận telemetry cho channel_id CHƯA từng có
    // record nội bộ -> gọi uiPort.publishChannelSeen NGAY (không chờ debounce
    // 5s); không đổi mapping/debounce hiện có." `this.channels` CHƯA có entry
    // cho channelId này đúng nghĩa "chưa từng có record nội bộ" - kiểm tra
    // TRƯỚC khi `applyCandidate()` bên dưới tạo record đầu tiên cho kênh này
    // (nếu không sẽ luôn thấy record đã tồn tại). Chỉ chạm nhánh này sau khi
    // đã xác nhận channel_id có trong registry (nhánh channel_unregistered ở
    // trên đã return sớm) - khớp I/O matrix "channel_id lạ -> KHÔNG publish
    // channel-seen".
    // Code review [patch]: `uiPort.publishChannelSeen` là 1 interface public
    // (adapter thật `wsUiAdapter.ts`) - nếu implementation throw (bug tương
    // lai ở adapter), không được để exception thoát khỏi `handleTelemetry` và
    // làm lỡ luôn phần debounce/state phía dưới của CHÍNH telemetry event này
    // (dù lớp ngoài `wsTelemetryAdapter.ts` đã catch nên không crash process
    // - vẫn mất xử lý sớm hơn cần thiết). Cùng tinh thần phòng thủ với nhánh
    // `channel_unregistered` ngay phía trên: log rõ ràng, không rethrow, tiếp
    // tục xử lý bình thường.
    if (!this.channels.has(event.channelId)) {
      try {
        this.uiPort.publishChannelSeen(event.channelId, new Date(this.clock.now()).toISOString());
      } catch (err) {
        this.logger.log({
          channel_id: event.channelId,
          event_type: 'ui_publish_error',
          reason: `uiPort.publishChannelSeen throw: ${(err as Error).message}`,
        });
      }
    }

    const bitratePct = computeBitratePct(event.bitrateKbps, entry.baselineKbps);
    const candidate = mapToDisplayState(event.connectionState, bitratePct);
    this.applyCandidate(event.channelId, candidate, bitratePct, event.connectionState);
  }

  private applyCandidate(
    channelId: string,
    candidate: DisplayCandidate,
    bitratePct: number,
    connectionState: ConnectionState
  ): void {
    const record = this.channels.get(channelId) ?? {};
    const now = this.clock.now();

    const pending = record.pending;
    if (pending === undefined || !sameCandidate(pending, candidate)) {
      // Candidate vừa đổi (lần đầu quan sát HOẶC khác candidate đang pending)
      // - reset đồng hồ debounce, KHÔNG đổi trạng thái đã chốt.
      record.pending = { ...candidate, since: now };
      this.channels.set(channelId, record);
      return;
    }

    const stableForMs = now - pending.since;
    if (stableForMs < this.debounceMs) {
      return; // chưa đủ debounce - giữ nguyên trạng thái đã chốt (có thể chưa có)
    }

    if (sameCandidate(record.committed, candidate)) {
      return; // đã chốt đúng giá trị này rồi - không log/publish lặp lại
    }

    const previous = record.committed;
    record.committed = candidate;
    this.channels.set(channelId, record);

    this.logger.log({
      channel_id: channelId,
      event_type: 'channel_state_change',
      reason:
        `${previous ? formatCandidate(previous) : '(chưa có)'} -> ${formatCandidate(candidate)} ` +
        `(bitrate_pct=${bitratePct.toFixed(1)}%, connection_state=${connectionState})`,
    });

    const change: ChannelStateChange = {
      channelId,
      displayState: candidate.state,
      timestamp: new Date(now).toISOString(),
      ...(candidate.subType ? { subType: candidate.subType } : {}),
    };
    this.alertPort.publishStateChange(change);
  }

  // Test/diagnostic: trạng thái hiển thị ĐÃ CHỐT hiện tại của 1 kênh (không
  // phải candidate đang chờ debounce). `undefined` nghĩa là chưa từng chốt
  // trạng thái nào cho kênh này (chưa đủ 5s ổn định kể từ telemetry đầu tiên).
  getDisplayState(channelId: string): DisplayCandidate | undefined {
    return this.channels.get(channelId)?.committed;
  }
}

function formatCandidate(candidate: DisplayCandidate): string {
  return candidate.subType ? `${candidate.state}[${candidate.subType}]` : candidate.state;
}

export type { DisplayState };
