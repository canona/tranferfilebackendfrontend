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
}

type Listener = () => void;

const EMPTY_STATE: ChannelStoreState = {
  channels: [],
  seenChannelIds: new Set(),
  channelDisplayStates: new Map(),
  connectionStatus: 'connected',
  lastConnectedAt: null,
  channelMachineOffline: new Set(),
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

    this.setState({
      ...this.state,
      channelDisplayStates: nextDisplayStates,
      channelMachineOffline: nextMachineOffline,
    });
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
}

export function createChannelStore(): ChannelStore {
  return new ChannelStore();
}

// Hook React - dùng `useSyncExternalStore` (built-in React 19, an toàn với
// concurrent rendering) thay vì tự quản lý `useState`/`useEffect` thủ công.
export function useChannelStore(store: ChannelStore): ChannelStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
