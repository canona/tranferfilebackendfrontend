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

export interface ChannelRegistryEntry {
  channelId: string;
  stationName: string;
  contactName: string;
  contactPhone: string;
  // Số nguyên 0-19 (row-major, 5 cột x 4 hàng) - nguồn DUY NHẤT cho vị trí ô
  // (AD-26), KHÔNG lấy từ thứ tự mảng `channels`/event.
  gridPosition: number;
}

export interface ChannelStoreState {
  // Rỗng cho tới khi client nhận `registry-snapshot` lần đầu (I/O matrix:
  // "App vừa mở, WS UI connect" - snapshot tới gần như ngay lập tức).
  channels: ReadonlyArray<ChannelRegistryEntry>;
  // Kênh đã nhận >=1 `channel-seen` - CHỈ CỘNG THÊM, không bao giờ gỡ bỏ (1
  // ô đã rời skeleton không quay lại skeleton trong phạm vi story này).
  seenChannelIds: ReadonlySet<string>;
}

type Listener = () => void;

const EMPTY_STATE: ChannelStoreState = { channels: [], seenChannelIds: new Set() };

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
}

export function createChannelStore(): ChannelStore {
  return new ChannelStore();
}

// Hook React - dùng `useSyncExternalStore` (built-in React 19, an toàn với
// concurrent rendering) thay vì tự quản lý `useState`/`useEffect` thủ công.
export function useChannelStore(store: ChannelStore): ChannelStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
