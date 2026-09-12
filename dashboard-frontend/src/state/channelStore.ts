// Story 2.3: `state/` - store 20 kênh + xử lý transition ĐÃ TÍNH SẴN từ
// backend (ARCHITECTURE-SPINE's Structural Seed: "không tự suy luận state").
// Store này chỉ giữ 2 mảnh dữ liệu đến từ `uiWsClient.ts` qua WS UI:
//   - `channels`: TOÀN BỘ danh sách kênh từ `registry-snapshot` (nguồn DUY
//     NHẤT cho `gridPosition` - Boundaries/AD-26, KHÔNG suy luận vị trí từ
//     nơi khác).
//   - `seenChannelIds`: tập channel_id đã nhận `channel-seen` (skeleton ->
//     loaded-neutral). CHƯA có mapping ok/warning/critical (Story 2.4) - Never
//     "đổi mapping trạng thái/alert-badge" của story này.
//
// Không dùng thư viện state management ngoài (Stack không liệt kê state lib
// nào cho dashboard-frontend) - 1 store subscribable tối giản +
// `useSyncExternalStore` (React 19, built-in) là đủ cho quy mô 20 kênh.

import { useSyncExternalStore } from 'react';
import type { DisplayState } from '../components/ChannelGridCell';

export interface ChannelRegistryEntry {
  channelId: string;
  stationName: string;
  contactName: string;
  contactPhone: string;
  // Số nguyên 0-19 (row-major, 5 cột x 4 hàng) - nguồn DUY NHẤT cho vị trí ô
  // (AD-26), KHÔNG lấy từ thứ tự mảng `channels`/event.
  gridPosition: number;
}

// Story 2.7: subType khả dĩ trên wire (mirror backend's `ChannelStateChange
// ['subType']`, `AlertOutboundPort.ts`). CHỈ 'machine-offline' thực sự được
// đọc ở store này (`channelMachineOffline`) - 'config-or-security-suspected'
// vẫn CHỈ mang dữ liệu qua wire (Never: không render/xử lý subType đó trên
// UI), nhưng vẫn cần có mặt trong type để `applyChannelDisplayStateChange`
// biết gỡ channelId khỏi `channelMachineOffline` đúng lúc (Boundaries: "mọi
// giá trị khác, kể cả undefined -> gỡ khỏi set").
export type DisplayStateSubType = 'config-or-security-suspected' | 'machine-offline';

// Story 3.2: 1 mẫu lịch sử bitrate (mirror backend's `BitrateHistoryPoint`,
// `HistoryPort.ts` - field/format wire giữ NGUYÊN, KHÔNG đổi timestamp sang
// ISO - Ask First đã chốt).
export interface HistoryPoint {
  timestampMs: number;
  bitratePct: number;
}

// Story 3.2: discriminated union 3 nhánh (mirror backend's `HistoryQueryResult`,
// `HistoryPort.ts`) - `loading` là trạng thái CHỈ tồn tại ở FRONTEND, trong
// khoảng ngắn ngay sau connect trước khi nhận `channel-history-snapshot`/kênh
// (Design Notes) - backend không bao giờ tự gửi nhánh này qua wire.
export type HistoryState =
  | { state: 'loading' }
  | { state: 'loaded'; points: readonly HistoryPoint[] }
  | { state: 'no-history-data' };

// Story 3.2: cùng cửa sổ retention với backend's `HISTORY_RETENTION_MS`
// (`bitrateHistory.ts`, ~15 phút) - `applyHistoryPoint` tự trim client-side
// theo đúng cửa sổ này (Code Map), tránh mảng phình to vô hạn nếu kênh sống
// lâu hơn nhiều phiên connect.
export const HISTORY_RETENTION_MS = 15 * 60 * 1000;

export interface ChannelStoreState {
  // Rỗng cho tới khi client nhận `registry-snapshot` lần đầu (I/O matrix:
  // "App vừa mở, WS UI connect" - snapshot tới gần như ngay lập tức).
  channels: ReadonlyArray<ChannelRegistryEntry>;
  // Kênh đã nhận >=1 `channel-seen` - CHỈ CỘNG THÊM, không bao giờ gỡ bỏ (1
  // ô đã rời skeleton không quay lại skeleton trong phạm vi story này).
  seenChannelIds: ReadonlySet<string>;
  // Story 2.6: trạng thái ok/warning/critical đã tính sẵn ở backend (nguồn
  // THẬT qua `channel-state-change`, thay fixture `buildChannelDisplayStatesFixture`
  // của Story 2.4) - GHI ĐÈ theo channelId mỗi lần đổi, KHÔNG idempotent-guard
  // như `seenChannelIds` (trạng thái đổi qua lại được, Boundaries).
  channelDisplayStates: ReadonlyMap<string, DisplayState>;
  // Story 2.7: trạng thái kênh WS UI (`uiWsClient.ts` <-> `wsUiAdapter.ts`) -
  // mặc định 'connected' (lạc quan lúc mount, Boundaries) - `page.tsx` hiện
  // `ConnectionBanner`/`grid-overlay` khi 'disconnected'.
  connectionStatus: 'connected' | 'disconnected';
  // ISO 8601 UTC - cập nhật MỖI LẦN `ws.onopen` (kể cả lần đầu). `null` cho
  // tới khi có ít nhất 1 lần connect thành công.
  lastConnectedAt: string | null;
  // Story 2.7: tập channelId đang `machine-offline` (máy trung tâm treo/chết,
  // ĐỘC LẬP hoàn toàn `connectionStatus`/`channelDisplayStates` ở trên - có
  // thể machine-offline dù WS UI vẫn 'connected' bình thường). Duy trì bởi
  // `applyChannelDisplayStateChange`'s `subType` param.
  channelMachineOffline: ReadonlySet<string>;
  // Bổ sung video-preview thật (AD-22): channelId -> data-URI JPEG sẵn dùng
  // (`data:image/jpeg;base64,...`) - build 1 LẦN ở `applyChannelSnapshot()`
  // (không phải lúc render, xem comment ở đó), GHI ĐÈ theo channelId mỗi lần
  // có khung mới (mirror `channelDisplayStates` - không idempotent-guard,
  // AD-22: transport-core tự kiểm soát nhịp gửi).
  channelSnapshots: ReadonlyMap<string, string>;
  // Story 3.2: kênh đang mở `detail-panel` - `null` = panel đóng (mặc định).
  // Overlay (không route) - `page.tsx` render `DetailPanel` đọc field này để
  // quyết định hiện/ẩn, KHÔNG điều hướng trang (Boundaries).
  selectedChannelId: string | null;
  // Story 3.2: lịch sử bitrate/kênh phía client - khởi tạo từ
  // `channel-history-snapshot` lúc connect, cập nhật tiếp bởi
  // `channel-history-point` (Design Notes: "Bitrate hiện tại" = mẫu MỚI NHẤT
  // client từng nhận qua snapshot HOẶC point, không phải trường riêng).
  // Thiếu entry cho 1 channelId = `loading` (mặc định, chưa nhận snapshot
  // của kênh đó) - KHÔNG lưu tường minh nhánh 'loading' trong Map này (Design
  // Notes: nhánh đó chỉ có ý nghĩa "chưa có entry", đọc qua `.get() ?? {
  // state: 'loading' }` ở nơi tiêu thụ, mirror cách `channelDisplayStates`
  // dùng `undefined` cho "chưa xác định").
  channelHistory: ReadonlyMap<string, HistoryState>;
}

type Listener = () => void;

const EMPTY_STATE: ChannelStoreState = {
  channels: [],
  seenChannelIds: new Set(),
  channelDisplayStates: new Map(),
  connectionStatus: 'connected',
  lastConnectedAt: null,
  channelMachineOffline: new Set(),
  channelSnapshots: new Map(),
  selectedChannelId: null,
  channelHistory: new Map(),
};

export class ChannelStore {
  private state: ChannelStoreState = EMPTY_STATE;
  private readonly listeners = new Set<Listener>();

  getState = (): ChannelStoreState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(next: ChannelStoreState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  // `registry-snapshot` là nguồn DUY NHẤT liệt kê kênh/vị trí (AD-26) - GHI
  // ĐÈ toàn bộ danh sách, không merge/patch từng phần (khớp đúng ngữ nghĩa
  // "snapshot": ảnh chụp toàn bộ tại thời điểm connect, không phải delta).
  applyRegistrySnapshot(channels: ReadonlyArray<ChannelRegistryEntry>): void {
    this.setState({ ...this.state, channels });
  }

  // `channel-seen` chỉ CỘNG THÊM vào tập đã seen - idempotent (gọi lại cho
  // cùng channelId không tạo object Set mới/không re-render thừa).
  applyChannelSeen(channelId: string): void {
    if (this.state.seenChannelIds.has(channelId)) return;
    const next = new Set(this.state.seenChannelIds);
    next.add(channelId);
    this.setState({ ...this.state, seenChannelIds: next });
  }

  // Story 2.6: `channel-state-change` GHI ĐÈ trạng thái/kênh - KHÔNG guard
  // idempotent như `applyChannelSeen` ở trên (Boundaries: "trạng thái đổi qua
  // lại được", khác ngữ nghĩa "đã thấy 1 lần là đủ" của seenChannelIds).
  //
  // Story 2.7: tham số `subType` MỚI (mở rộng, optional - KHÔNG phá vỡ caller
  // cũ) - Boundaries: "subType==='machine-offline' -> thêm channelId vào set;
  // mọi giá trị khác (kể cả undefined) -> gỡ khỏi set" (đối xứng cơ chế phục
  // hồi backend's `handleHeartbeat` re-publish `record.committed` không kèm
  // subType khi máy trung tâm hoạt động lại bình thường).
  applyChannelDisplayStateChange(channelId: string, displayState: DisplayState, subType?: DisplayStateSubType): void {
    const nextDisplayStates = new Map(this.state.channelDisplayStates);
    nextDisplayStates.set(channelId, displayState);

    // Code review: khai báo kiểu `ReadonlySet<string>` tường minh - `Set<T>`
    // là subtype hợp lệ để GÁN vào biến này (mutation chỉ xảy ra trên 1 biến
    // `Set<string>` cục bộ riêng `updated` bên dưới, KHÔNG gọi .add()/.delete()
    // thẳng trên biến `ReadonlySet` này).
    let nextMachineOffline: ReadonlySet<string> = this.state.channelMachineOffline;
    if (subType === 'machine-offline') {
      if (!nextMachineOffline.has(channelId)) {
        const updated = new Set(nextMachineOffline);
        updated.add(channelId);
        nextMachineOffline = updated;
      }
    } else if (nextMachineOffline.has(channelId)) {
      const updated = new Set(nextMachineOffline);
      updated.delete(channelId);
      nextMachineOffline = updated;
    }

    // CAP-5 (spec-cap-5-xoa-cache-snapshot-khi-critical): kênh chuyển sang
    // `critical` -> xoá cache snapshot của đúng kênh đó, tránh
    // `ChannelGridCell` hiện nhầm ảnh cũ nếu kênh phục hồi ok/warning trước
    // khi có khung mới (fallback gradient placeholder có sẵn). Check duy
    // nhất `displayState === 'critical'` - mirror pattern immutable-copy-
    // chỉ-khi-đổi của `nextMachineOffline` ở trên (không tạo Map mới nếu
    // không có entry để xoá).
    let nextSnapshots: ReadonlyMap<string, string> = this.state.channelSnapshots;
    if (displayState === 'critical' && nextSnapshots.has(channelId)) {
      const updated = new Map(nextSnapshots);
      updated.delete(channelId);
      nextSnapshots = updated;
    }

    this.setState({
      ...this.state,
      channelDisplayStates: nextDisplayStates,
      channelMachineOffline: nextMachineOffline,
      channelSnapshots: nextSnapshots,
    });
  }

  // Bổ sung video-preview thật (AD-22): build data-URI 1 LẦN ở đây (không
  // phải lúc render trong ChannelGridCell.tsx) - `ChannelGridCell` re-render
  // vì lý do khác (audioLevel tick ~300ms) thường xuyên hơn nhiều so với tần
  // suất snapshot thật tới (~1.5s/kênh), nối chuỗi base64 nhiều KB lại mỗi
  // lần render đó là lãng phí không cần thiết. GHI ĐÈ theo channelId (không
  // idempotent-guard, mirror applyChannelDisplayStateChange) - mỗi khung
  // transport-core gửi được coi là mới.
  applyChannelSnapshot(channelId: string, imageBase64: string): void {
    const next = new Map(this.state.channelSnapshots);
    next.set(channelId, `data:image/jpeg;base64,${imageBase64}`);
    this.setState({ ...this.state, channelSnapshots: next });
  }

  // Story 2.7: cập nhật bởi `uiWsClient.ts`'s `connectUiWsClient` mỗi khi
  // `onopen`/`onclose`/`onerror` fire. `lastConnectedAt` (ISO) chỉ truyền kèm
  // khi status='connected' (Design Notes: "lastConnectedAt chỉ cập nhật ở
  // onopen") - giữ nguyên giá trị cũ nếu omit (không có ý nghĩa gì khi
  // status='disconnected', banner vẫn hiện đúng mốc lần connect gần nhất).
  setConnectionStatus(status: 'connected' | 'disconnected', lastConnectedAt?: string): void {
    if (status === 'connected') {
      const nextLastConnectedAt = lastConnectedAt ?? this.state.lastConnectedAt;
      // Code review [patch]: mirror idempotent-guard của nhánh 'disconnected'
      // bên dưới - `onopen` lặp lại (hoặc gọi lại không đổi gì) không được
      // setState/re-render thừa khi đã 'connected' VÀ lastConnectedAt không đổi.
      if (this.state.connectionStatus === 'connected' && this.state.lastConnectedAt === nextLastConnectedAt) {
        return;
      }
      this.setState({
        ...this.state,
        connectionStatus: 'connected',
        lastConnectedAt: nextLastConnectedAt,
      });
      return;
    }
    // Idempotent-guard (mirror `applyChannelSeen`'s tinh thần tránh setState
    // thừa) - 'close' và 'error' có thể cùng fire cho 1 lần đứt kết nối, tránh
    // re-render kép không cần thiết.
    if (this.state.connectionStatus === 'disconnected') return;
    this.setState({ ...this.state, connectionStatus: 'disconnected' });
  }

  // Story 3.2: click `channel-grid-cell` gọi method này (qua `ChannelGrid`'s
  // `onSelect`) - mở `detail-panel` của đúng kênh đó. Idempotent-guard (mirror
  // `applyChannelSeen`) - click lặp lại cùng kênh đã đang mở không setState/
  // re-render thừa.
  selectChannel(channelId: string): void {
    if (this.state.selectedChannelId === channelId) return;
    this.setState({ ...this.state, selectedChannelId: channelId });
  }

  // Story 3.2: đóng `detail-panel` (Esc/click backdrop gọi method này) - lưới
  // phía sau giữ nguyên (Boundaries: state của lưới hoàn toàn độc lập field
  // này). Idempotent-guard - gọi lặp lại khi đã đóng không setState thừa.
  clearSelectedChannel(): void {
    if (this.state.selectedChannelId === null) return;
    this.setState({ ...this.state, selectedChannelId: null });
  }

  // Story 3.2: `channel-history-snapshot` (lúc connect/reconnect) - GHI ĐÈ
  // toàn bộ `HistoryState` của đúng channelId (mirror `applyRegistrySnapshot`:
  // "snapshot" = ảnh chụp toàn bộ tại thời điểm connect, không merge/patch).
  applyHistorySnapshot(channelId: string, historyState: HistoryState): void {
    const next = new Map(this.state.channelHistory);
    next.set(channelId, historyState);
    this.setState({ ...this.state, channelHistory: next });
  }

  // Story 3.2: `channel-history-point` - append 1 mẫu MỚI vào lịch sử hiện có
  // của đúng channelId (mirror backend's `BitrateHistoryService.recordBitrate`:
  // tín hiệu rời rạc, KHÔNG idempotent-guard, phát/áp dụng mọi lúc). Thiếu
  // entry hiện có (channel-history-point tới TRƯỚC channel-history-snapshot,
  // hoặc entry đang 'no-history-data'/'loading') -> khởi tạo mảng mới bắt đầu
  // từ đúng mẫu này (KHÔNG chờ snapshot mới coi là "loaded" - mẫu vừa nhận
  // chính là dữ liệu thật, không có gì phải chờ). Trim client-side theo ĐÚNG
  // cửa sổ retention `HISTORY_RETENTION_MS` (mirror `bitrateHistory.ts`:
  // "cũ hơn 15 phút" = strictly older, tính theo timestampMs của mẫu vừa
  // nhận).
  applyHistoryPoint(channelId: string, point: HistoryPoint): void {
    const current = this.state.channelHistory.get(channelId);
    const existingPoints = current?.state === 'loaded' ? current.points : [];
    const cutoff = point.timestampMs - HISTORY_RETENTION_MS;
    const trimmed = [...existingPoints, point].filter((p) => p.timestampMs >= cutoff);

    const next = new Map(this.state.channelHistory);
    next.set(channelId, { state: 'loaded', points: trimmed });
    this.setState({ ...this.state, channelHistory: next });
  }
}

export function createChannelStore(): ChannelStore {
  return new ChannelStore();
}

// Hook React - dùng `useSyncExternalStore` (built-in React 19, an toàn với
// concurrent rendering) thay vì tự quản lý `useState`/`useEffect` thủ công.
export function useChannelStore(store: ChannelStore): ChannelStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
