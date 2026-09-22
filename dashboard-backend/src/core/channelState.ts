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
import type { HeartbeatInboundPort } from '../ports/HeartbeatInboundPort.js';
import type { HistoryPort } from '../ports/HistoryPort.js';
import type { AckCommandPort } from '../ports/AckCommandPort.js';
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

// Story 2.7 (Intent/Epic 2 context): "1 máy trung tâm không gửi heartbeat quá
// 3x chu kỳ 5s" -> 15000ms. Hằng số riêng, ĐỘC LẬP hoàn toàn `DEBOUNCE_MS`
// (Boundaries: "KHÔNG đổi debounce 5s/bitrateThreshold.ts's mapping").
export const HEARTBEAT_TIMEOUT_MS = 15000;

interface PendingCandidate extends DisplayCandidate {
  // clock.now() tại lần đầu candidate này được quan sát liên tục (reset về
  // giá trị mới mỗi khi candidate đổi - xem I/O matrix "trạng thái dao động
  // <5s -> giữ nguyên giá trị cũ").
  since: number;
}

interface ChannelRecord {
  committed?: DisplayCandidate;
  pending?: PendingCandidate;
  // Story 2.7: epoch ms (Clock injectable, KHÔNG phải timestamp envelope) của
  // lần `handleHeartbeat` gần nhất/kênh - `undefined` nghĩa là kênh này CHƯA
  // từng nhận heartbeat nào (checkHeartbeatTimeouts() bỏ qua, tránh báo động
  // giả lúc mới khởi động trước khi có heartbeat đầu tiên).
  lastHeartbeatAt?: number;
  // Story 2.7: cờ "đang machine-offline" - Boundaries: field mới trên CHÍNH
  // ChannelRecord hiện có (Map theo channelId), KHÔNG Map riêng.
  machineOfflineActive?: boolean;
  // Story 3.3: `acknowledged`/`ackLabel` lưu trên CHÍNH `ChannelRecord` hiện có
  // (Boundaries: mirror `machineOfflineActive` - KHÔNG tạo Map riêng theo
  // channelId cho ack-state). `ackLabel` chỉ có ý nghĩa khi `acknowledged===true`
  // (undefined khi chưa từng ack/đã tự xoá).
  acknowledged?: boolean;
  ackLabel?: string;
}

export interface ChannelStateServiceOptions {
  registryPort: ChannelRegistryPort;
  alertPort: AlertOutboundPort;
  // Story 2.3: port MỚI, tách biệt hoàn toàn khỏi `alertPort` (xem
  // `UiOutboundPort.ts`'s comment đầu file) - phát tín hiệu "đã thấy kênh"
  // thô NGAY khi có telemetry đầu tiên/kênh, không qua debounce 5s.
  uiPort: UiOutboundPort;
  // Story 3.1: port MỚI, bắt buộc (mirror `uiPort`/`alertPort` - không optional,
  // composition root `main.ts` luôn phải wiring `BitrateHistoryService` thật).
  // Ghi lịch sử bitrate NGAY mỗi khi `handleTelemetry` nhận telemetry hợp lệ,
  // ĐỘC LẬP hoàn toàn debounce 5s/`committed` state (Boundaries).
  historyPort: HistoryPort;
  logger: Logger;
  clock?: Clock;
  debounceMs?: number;
}

function sameCandidate(a: DisplayCandidate | undefined, b: DisplayCandidate): boolean {
  return a !== undefined && a.state === b.state && a.subType === b.subType;
}

export class ChannelStateService implements TelemetryInboundPort, HeartbeatInboundPort, AckCommandPort {
  private readonly registryPort: ChannelRegistryPort;
  private readonly alertPort: AlertOutboundPort;
  private readonly uiPort: UiOutboundPort;
  private readonly historyPort: HistoryPort;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private readonly channels = new Map<string, ChannelRecord>();

  constructor(options: ChannelStateServiceOptions) {
    this.registryPort = options.registryPort;
    this.alertPort = options.alertPort;
    this.uiPort = options.uiPort;
    this.historyPort = options.historyPort;
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

    // Story 3.1 (Boundaries): ghi ring buffer NGAY mỗi khi telemetry hợp lệ
    // tới cho 1 channelId ĐÃ đăng ký - ĐỘC LẬP hoàn toàn debounce 5s/
    // `applyCandidate` bên dưới (mirror tinh thần `uiPort.publishChannelSeen`:
    // tín hiệu thô, không chờ chốt trạng thái. Khác: recordBitrate gọi cho
    // MỌI telemetry hợp lệ, không chỉ lần đầu/kênh). Mirror chính xác pattern
    // try/catch + log của `uiPort.publishChannelSeen` ở trên: 1 kênh lỗi (vd
    // `recordBitrate` throw) không được làm lỡ phần debounce/state phía sau
    // của chính telemetry event này.
    // Code review [patch]: giữ lại đúng 1 giá trị `timestampMs` truyền vào
    // `recordBitrate` để dùng lại trong log lỗi bên dưới nếu throw - tránh gọi
    // `this.clock.now()` lần 2 (có thể ra giá trị khác thời điểm gọi thực tế).
    const historyTimestampMs = this.clock.now();
    // Code review round 2 [patch]: try/catch này bọc CẢ 2 lệnh (`recordBitrate`
    // VÀ `publishHistoryPoint`) nhưng phải phân biệt rõ trong log lỗi lệnh nào
    // thực sự throw - nếu `recordBitrate` thành công (mẫu đã ghi vào ring
    // buffer) mà chỉ `publishHistoryPoint` throw, log cứng "recordBitrate
    // throw" sẽ gây hiểu nhầm khi debug (ring buffer thật ra vẫn ổn, chỉ mất
    // broadcast realtime). `step` đánh dấu lệnh đang chạy khi catch bắt lỗi.
    let step: 'recordBitrate' | 'publishHistoryPoint' = 'recordBitrate';
    try {
      this.historyPort.recordBitrate(event.channelId, bitratePct, historyTimestampMs);
      // Story 3.2 (Boundaries): `uiPort.publishHistoryPoint` chỉ gọi SAU KHI
      // `recordBitrate` thành công, trong CÙNG try/catch này - `recordBitrate`
      // throw thì dòng này không bao giờ chạy tới (không publish 1 mẫu chưa
      // chắc đã ghi được vào ring buffer). Dùng lại ĐÚNG `bitratePct`/
      // `historyTimestampMs` đã ghi, không tính/đọc lại.
      step = 'publishHistoryPoint';
      this.uiPort.publishHistoryPoint(event.channelId, bitratePct, historyTimestampMs);
    } catch (err) {
      // Code review [patch]: `err` không được đảm bảo là `Error` (mirror
      // `createCompositeAlertPort` ở `app/main.ts`) - `instanceof Error` guard
      // trước khi đọc `.message`, fallback `String(err)` tránh hiện "undefined"
      // khi historyPort/uiPort throw ra 1 giá trị không phải `Error`.
      const message = err instanceof Error ? err.message : String(err);
      const failedCall = step === 'recordBitrate' ? 'historyPort.recordBitrate' : 'uiPort.publishHistoryPoint';
      this.logger.log({
        channel_id: event.channelId,
        event_type: 'history_record_error',
        reason:
          `${failedCall} throw (bitrate_pct=${bitratePct.toFixed(1)}%, ` +
          `timestamp_ms=${historyTimestampMs}): ${message}`,
      });
    }

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
    // Story 3.3 (Boundaries): "tự xoá ack ở MỌI điểm commit 1 candidate MỚI
    // khác candidate đã chốt" - candidate vừa đổi (khác candidate cũ, đã qua
    // guard `sameCandidate` phía trên) đúng nghĩa "chuyển cảnh báo mới", kể cả
    // khi candidate mới là 'ok' (phục hồi).
    this.clearAckIfAcknowledged(channelId, record);
    this.channels.set(channelId, record);

    this.logger.log({
      channel_id: channelId,
      event_type: 'channel_state_change',
      reason:
        `${previous ? formatCandidate(previous) : '(chưa có)'} -> ${formatCandidate(candidate)} ` +
        `(bitrate_pct=${bitratePct.toFixed(1)}%, connection_state=${connectionState})`,
    });

    // Code review [patch]: nếu kênh đang `machineOfflineActive` (Story 2.7),
    // 1 commit telemetry bình thường (candidate đổi do bitrate/connection_state
    // - ĐỘC LẬP hoàn toàn heartbeat) KHÔNG được phép âm thầm "giải phóng" cờ
    // machine-offline phía frontend: `channelStore.applyChannelDisplayStateChange`
    // gỡ channelId khỏi `channelMachineOffline` cho BẤT KỲ publish nào thiếu
    // `subType:'machine-offline'`. Ép `subType` này lên `change` phát đi (KHÔNG
    // đụng `record.committed` - vẫn phải phản ánh đúng candidate telemetry thật,
    // như `getDisplayState()` đã test) để badge phía UI giữ đúng "máy trung tâm
    // lỗi" cho tới khi `handleHeartbeat` xác nhận resume thật sự.
    // Story 4.4: `previousDisplayState` = `previous?.state` (candidate ĐÃ CHỐT
    // trước đó, trước khi `record.committed` bị ghi đè ở trên) - cho phép
    // `TelegramAlertAdapter`/`EmailAlertAdapter` nhận diện nhánh phục hồi
    // (displayState 'ok' VÀ previousDisplayState khớp state instance phụ
    // trách) mà không đụng vào logic debounce/threshold ở đây.
    const change: ChannelStateChange = {
      channelId,
      displayState: candidate.state,
      previousDisplayState: previous?.state,
      timestamp: new Date(now).toISOString(),
      ...(record.machineOfflineActive
        ? { subType: 'machine-offline' as const }
        : candidate.subType
          ? { subType: candidate.subType }
          : {}),
    };
    this.alertPort.publishStateChange(change);
  }

  // Story 2.7: `HeartbeatInboundPort` - forward bởi `wsTelemetryAdapter.ts`
  // cho `event_type=heartbeat` (trước đây bị bỏ qua im lặng). ĐỘC LẬP hoàn
  // toàn debounce/mapping bitrate của `handleTelemetry` phía trên - chỉ cập
  // nhật `lastHeartbeatAt` + xử lý phục hồi nếu kênh đang `machineOfflineActive`.
  handleHeartbeat(channelId: string, timestamp: string): void {
    // I/O matrix: "Heartbeat cho channel_id lạ -> Bỏ qua, log
    // channel_unregistered (mirror telemetry)" - registry vẫn là nguồn xác
    // thực channel_id hợp lệ DUY NHẤT (Story 2.2), kể cả cho heartbeat.
    if (this.registryPort.getEntry(channelId) === undefined) {
      this.logger.log({
        channel_id: channelId,
        event_type: 'channel_unregistered',
        reason: `channel_id không có trong channel-registry - bỏ qua heartbeat này (timestamp=${timestamp})`,
      });
      return;
    }

    const record = this.channels.get(channelId) ?? {};
    const now = this.clock.now();
    record.lastHeartbeatAt = now;

    const wasOffline = record.machineOfflineActive === true;
    if (wasOffline) {
      record.machineOfflineActive = false;
      // Story 3.3 (Code Map/[patch] review round 1): máy trung tâm phục hồi ->
      // hiển thị UI đổi từ critical/machine-offline về lại `record.committed`
      // thật (vd warning/ok) NGAY DƯỚI ĐÂY dù `record.committed` không tự đổi
      // giá trị nào - đây VẪN là 1 lần "chuyển cảnh báo" theo góc nhìn người
      // xem (AC2), ack phải tự xoá theo, nếu không ack-label kẹt vô thời hạn
      // trên lưới dù kênh đã không còn ở đúng trạng thái lúc ack. Gọi TRƯỚC khi
      // re-publish record.committed bên dưới.
      this.clearAckIfAcknowledged(channelId, record);
    }
    this.channels.set(channelId, record);

    if (!wasOffline) return;

    // Boundaries: "clear flag, re-publish record.committed hiện tại (nếu có)
    // để badge trả về đúng trạng thái telemetry thật, không kẹt ở
    // machine-offline." Nếu chưa từng có `committed` nào (kênh mới, chưa đủ
    // 5s telemetry ổn định) - không có gì để re-publish, giữ nguyên (không tự
    // bịa 1 trạng thái mới).
    this.logger.log({
      channel_id: channelId,
      event_type: 'machine_offline_recovered',
      reason: `heartbeat resume sau machine-offline (timestamp=${timestamp})`,
    });
    if (record.committed) {
      // Story 4.4 (renegotiate review vòng 1): khi resume trả `record.committed.
      // state === 'ok'`, gán `previousDisplayState: 'critical'` CỐ ĐỊNH - KHÔNG
      // đọc giá trị telemetry nội bộ nào khác. `checkOneChannelHeartbeatTimeout`
      // luôn công bố machine-offline là `critical` (Story 2.7) nên "trạng thái
      // trước đó mà đội trực/lãnh đạo đã thực sự nhận cảnh báo" luôn là
      // `critical`, bất kể `record.committed` nội bộ lúc đó là gì. Không gán gì
      // khi resume KHÔNG về `ok` (vd vẫn warning/critical) - không phải nhánh
      // phục hồi, giữ nguyên hành vi cũ (previousDisplayState undefined).
      const change: ChannelStateChange = {
        channelId,
        displayState: record.committed.state,
        timestamp: new Date(now).toISOString(),
        ...(record.committed.state === 'ok' ? { previousDisplayState: 'critical' as const } : {}),
        ...(record.committed.subType ? { subType: record.committed.subType } : {}),
      };
      this.alertPort.publishStateChange(change);
    }
  }

  // Story 2.7 (Design Notes): "checkHeartbeatTimeouts() KHÔNG tự quản lý timer
  // nội bộ ... giữ src/core thuần/dễ test" - public, gọi từ ngoài (real
  // `setInterval` ở `main.ts` production, gọi trực tiếp ở test bằng FakeClock).
  // Duyệt TOÀN BỘ kênh có `lastHeartbeatAt` đã biết (bỏ qua kênh chưa từng
  // heartbeat - tránh báo động giả) - I/O matrix: "Không throw, không chặn
  // kênh khác" -> cô lập lỗi TỪNG kênh bằng try/catch riêng, 1 kênh lỗi không
  // được ngăn các kênh còn lại trong cùng lượt gọi.
  checkHeartbeatTimeouts(): void {
    const now = this.clock.now();
    for (const [channelId, record] of this.channels) {
      try {
        this.checkOneChannelHeartbeatTimeout(channelId, record, now);
      } catch (err) {
        this.logger.log({
          channel_id: channelId,
          event_type: 'heartbeat_timeout_check_error',
          reason: `lỗi khi kiểm tra heartbeat timeout: ${(err as Error).message}`,
        });
      }
    }
  }

  private checkOneChannelHeartbeatTimeout(channelId: string, record: ChannelRecord, now: number): void {
    if (record.lastHeartbeatAt === undefined) return; // chưa từng heartbeat - không đánh giá

    // Code review [patch round 2]: mirror ĐÚNG thứ tự check của `handleHeartbeat`
    // - registry TRƯỚC `machineOfflineActive` (trước đây ngược lại: early-return
    // của `machineOfflineActive` chặn mất nhánh registry bên dưới, khiến 1 kênh
    // ĐÃ machine-offline rồi mới bị gỡ khỏi channel-registry (hot-reload) không
    // bao giờ chạm nhánh log `channel_unregistered` này).
    if (this.registryPort.getEntry(channelId) === undefined) {
      this.logger.log({
        channel_id: channelId,
        event_type: 'channel_unregistered',
        reason: 'channel_id không còn trong channel-registry - bỏ qua đánh giá heartbeat timeout',
      });
      return;
    }

    if (record.machineOfflineActive) return; // đã kích hoạt rồi - không publish lặp lại

    if (now - record.lastHeartbeatAt < HEARTBEAT_TIMEOUT_MS) return;

    record.machineOfflineActive = true;
    // Story 3.3 (Boundaries): machine-offline "cũng là chuyển cảnh báo mới" -
    // ack phải tự xoá đúng lúc kênh chuyển sang critical/machine-offline.
    this.clearAckIfAcknowledged(channelId, record);
    this.channels.set(channelId, record);

    this.logger.log({
      channel_id: channelId,
      event_type: 'machine_offline_detected',
      reason: `im lặng heartbeat >= ${HEARTBEAT_TIMEOUT_MS}ms (lastHeartbeatAt=${record.lastHeartbeatAt}, now=${now})`,
    });

    // Boundaries: "ĐỘC LẬP hoàn toàn record.committed/debounce 5s hiện có" -
    // publish thẳng critical+machine-offline, không đọc/so sánh record.committed.
    const change: ChannelStateChange = {
      channelId,
      displayState: 'critical',
      subType: 'machine-offline',
      timestamp: new Date(now).toISOString(),
    };
    this.alertPort.publishStateChange(change);
  }

  // Story 3.3: `AckCommandPort` - caller duy nhất là `wsUiAdapter.ts` (kênh WS
  // UI, AD-25 - ngoại lệ chiều ngược DUY NHẤT frontend->backend). `operatorLabel`
  // ĐÃ được adapter `.trim()` + giới hạn <=64 ký tự TRƯỚC khi gọi vào đây (Code
  // Map) - core không validate lại nội dung chuỗi này, chỉ validate registry.
  handleAckCommand(channelId: string, operatorLabel: string, timestampMs: number): void {
    // I/O matrix: "Ack cho channel_id không có trong registry -> Bỏ qua, log
    // channel_unregistered (mirror heartbeat)" - registry vẫn là nguồn xác
    // thực channel_id hợp lệ DUY NHẤT (Story 2.2), kể cả cho ack-command.
    if (this.registryPort.getEntry(channelId) === undefined) {
      this.logger.log({
        channel_id: channelId,
        event_type: 'channel_unregistered',
        reason: `channel_id không có trong channel-registry - bỏ qua ack-command này (operator_label=${operatorLabel})`,
      });
      return;
    }

    // Design Notes: `handleAckCommand` KHÔNG kiểm tra kênh có đang
    // warning/critical hay không trước khi áp dụng ack (chỉ validate registry,
    // đúng phạm vi AD-25) - tầng UI (nút disabled khi không phải warning/
    // critical, `DetailPanel.tsx`) là nơi enforce đúng AC's "Given", tránh
    // over-engineer 1 rule mà kiến trúc không yêu cầu ở tầng core.
    const record = this.channels.get(channelId) ?? {};
    record.acknowledged = true;
    record.ackLabel = operatorLabel;
    this.channels.set(channelId, record);

    // AD-30: log audit ack_command_applied - reason chứa operator_label.
    this.logger.log({
      channel_id: channelId,
      event_type: 'ack_command_applied',
      reason: `operator_label=${operatorLabel} (timestamp_ms=${timestampMs})`,
    });

    // Mirror try/catch của `uiPort.publishChannelSeen`/`historyPort.recordBitrate`
    // ở `handleTelemetry` - 1 exception từ implementation của `UiOutboundPort`
    // (bug tương lai ở adapter) không được thoát ra khỏi `handleAckCommand`.
    try {
      this.uiPort.publishAckChange(channelId, true, operatorLabel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.log({
        channel_id: channelId,
        event_type: 'ui_publish_error',
        reason: `uiPort.publishAckChange throw: ${message}`,
      });
    }
  }

  // Story 3.3 (Boundaries): "tự xoá ack ở MỌI điểm commit 1 candidate MỚI khác
  // candidate đã chốt" - helper dùng chung ở ĐỦ 3 điểm: `applyCandidate`,
  // `checkOneChannelHeartbeatTimeout` (kích hoạt machine-offline), VÀ
  // `handleHeartbeat`'s nhánh recovery machine-offline. No-op nếu kênh chưa
  // từng ack (`record.acknowledged !== true`) - không publish/log thừa mỗi
  // lần commit bình thường của 1 kênh chưa ai ack.
  private clearAckIfAcknowledged(channelId: string, record: ChannelRecord): void {
    if (record.acknowledged !== true) return;
    record.acknowledged = false;
    record.ackLabel = undefined;
    try {
      this.uiPort.publishAckChange(channelId, false, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.log({
        channel_id: channelId,
        event_type: 'ui_publish_error',
        reason: `uiPort.publishAckChange throw (auto-clear): ${message}`,
      });
    }
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
