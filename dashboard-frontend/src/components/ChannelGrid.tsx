// Story 2.3: `channel-grid` - lưới tổng quan, render 1 `ChannelGridCell`/kênh
// từ `channels` (nguồn DUY NHẤT: `registry-snapshot`, AD-26). DESIGN.md:
// "lưới cố định 20 ô, 5 cột x 4 hàng, không có ô dự phòng, vị trí theo đài
// không đổi khi có cảnh báo." Vị trí THẬT SỰ do từng `ChannelGridCell` tự đặt
// (CSS Grid `grid-row`/`grid-column` từ `gridPosition`) - thứ tự phần tử
// trong `channels`/DOM KHÔNG ảnh hưởng vị trí hiển thị (Boundaries: "không
// phụ thuộc thứ tự event").

import { useMemo } from 'react';
import type { ChannelRegistryEntry } from '../state/channelStore';
import { ChannelGridCell, type DisplayState } from './ChannelGridCell';
import styles from './ChannelGrid.module.css';

export interface ChannelGridProps {
  channels: ReadonlyArray<ChannelRegistryEntry>;
  seenChannelIds: ReadonlySet<string>;
  // Story 2.4: trạng thái ok/warning/critical theo channelId (nguồn fixture ở
  // story này - Never: "nối WebSocket/channelStore thật", đó là Story 2.6).
  // Thiếu entry cho 1 channelId -> ChannelGridCell fallback loaded-neutral.
  channelDisplayStates: ReadonlyMap<string, DisplayState>;
  // Story 2.5: dBFS [L, R] theo channelId (nguồn fixture MỚI
  // `fixtures/channelAudioLevels.ts` - độc lập hoàn toàn channelDisplayStates/
  // debounce). Thiếu entry cho 1 channelId -> ChannelGridCell không render
  // vu-meter cho ô đó (prop `audioLevel` optional, xem ChannelGridCell.tsx).
  channelAudioLevels: ReadonlyMap<string, readonly [number, number]>;
  // Story 2.7: tập channelId đang machine-offline (`channelStore.ts`'s
  // `channelMachineOffline`, ĐỘC LẬP channelDisplayStates) - truyền xuống mỗi
  // cell dưới dạng prop `subType` (chỉ có giá trị khi channel có trong set).
  channelMachineOffline: ReadonlySet<string>;
  // Bổ sung video-preview thật (AD-22): data-URI JPEG sẵn dùng theo channelId
  // (`channelStore.ts`'s `channelSnapshots`). Thiếu entry cho 1 channelId ->
  // ChannelGridCell fallback gradient placeholder (xem ChannelGridCell.tsx).
  channelSnapshots: ReadonlyMap<string, string>;
  // Story 3.3: ack-label hiện tại theo channelId (`channelStore.ts`'s
  // `channelAck`). Thiếu entry cho 1 channelId -> ChannelGridCell không render
  // ack-label/dashed-border cho ô đó (prop `ackLabel` optional ở
  // ChannelGridCell.tsx).
  channelAck: ReadonlyMap<string, string>;
  // Story 3.2: forward xuống mỗi `ChannelGridCell` - click ô mở detail-panel
  // của đúng kênh đó (Boundaries). Optional - thiếu thì các ô không click
  // được gì (tương thích ngược với test cũ không truyền prop này).
  onSelect?: (channelId: string) => void;
}

// Code review [patch]: trước khi client nhận `registry-snapshot` ĐẦU TIÊN
// (channels rỗng - `ChannelStore`'s EMPTY_STATE lúc mount, chưa biết
// channel_id/vị trí thật nào), `channels.map(...)` render 0 ô - trái AC "app
// vừa mở (cold-load) -> toàn bộ 20 ô hiện skeleton". Vị trí 0-19 luôn CỐ ĐỊNH
// (lưới 5x4, Boundaries) bất kể registry chứa gì, nên render trước được mà
// không cần chờ dữ liệu registry thật - không vi phạm AD-26 (vị trí vẫn là
// gridPosition tường minh, không suy từ thứ tự event/mảng).
const GRID_SIZE = 20;

function placeholderChannels(): ChannelRegistryEntry[] {
  return Array.from({ length: GRID_SIZE }, (_, gridPosition) => ({
    channelId: `placeholder-${gridPosition}`,
    stationName: '',
    contactName: '',
    contactPhone: '',
    gridPosition,
  }));
}

export function ChannelGrid({
  channels,
  seenChannelIds,
  channelDisplayStates,
  channelAudioLevels,
  channelMachineOffline,
  channelSnapshots,
  channelAck,
  onSelect,
}: ChannelGridProps) {
  // `channels` rỗng CHỈ xảy ra trước lần `registry-snapshot` đầu tiên (snapshot
  // rỗng thật sự không thể xảy ra - fileChannelRegistryAdapter chặn registry
  // 0 kênh ngay lúc load, xem `loadAndValidate`) - an toàn để coi length===0
  // là tín hiệu duy nhất "chưa có dữ liệu thật", không lẫn với 1 registry hợp
  // lệ nhưng nhỏ hơn 20 kênh (vẫn render đúng số ô hiện có, không độn thêm).
  //
  // Story 5.1 (Boundaries): "DOM order của 20 channel-grid-cell phải khớp
  // gridPosition tăng dần (0->19), bất kể thứ tự phần tử trong mảng channels
  // nhận từ registry-snapshot" - `channelStore.ts`'s `applyRegistrySnapshot`
  // lưu `channels` nguyên trạng từ backend, KHÔNG đảm bảo thứ tự. DOM order
  // = thứ tự Tab thực tế (native tabIndex=0, không roving-tabindex - Never)
  // nên phải sort 1 bản SAO (không mutate `channels` gốc/prop) trước `.map()`,
  // độc lập hoàn toàn việc CSS Grid đặt vị trí thị giác qua gridRow/gridColumn
  // (ChannelGridCell.tsx) - 2 cơ chế tách biệt, sort ở đây chỉ đổi thứ tự Tab.
  //
  // Code review [patch]: bọc `useMemo` - component re-render trên MỌI đổi
  // prop khác (channelAudioLevels/channelDisplayStates/channelSnapshots... từ
  // WebSocket, tick liên tục) không liên quan gì tới `channels`/thứ tự Tab;
  // không nhớ lại thì spread+sort 20 phần tử chạy lại vô ích mỗi render đó.
  // Dependency đúng là `channels` (không phải channels.length hay biến trung
  // gian nào khác) - `placeholderChannels()` chỉ dùng khi `channels.length===0`,
  // tức bản thân là hàm thuần không phụ thuộc gì ngoài `channels`.
  const displayChannels = useMemo(
    () => [...(channels.length > 0 ? channels : placeholderChannels())].sort((a, b) => a.gridPosition - b.gridPosition),
    [channels],
  );

  return (
    <div className={styles.grid} role="grid" aria-label="Lưới tổng quan 20 kênh">
      {displayChannels.map((channel) => (
        <ChannelGridCell
          // Code review [patch, vòng 2]: key theo `gridPosition` (0-19, CỐ
          // ĐỊNH, không đổi qua mọi trạng thái - Boundaries), KHÔNG theo
          // `channelId` (khác hoàn toàn giữa placeholder "placeholder-N" và
          // channel thật khi `registry-snapshot` đầu tiên tới). Key khác nhau
          // sẽ khiến React unmount/remount toàn bộ 20 node DOM đúng lúc
          // chuyển cold-load - epic-2-context.md: "Không animation/transition
          // gây xao nhãng khi đổi trạng thái trên lưới". Key theo gridPosition
          // giữ nguyên node DOM, chỉ đổi props (channelId/stationName/loaded).
          key={channel.gridPosition}
          channelId={channel.channelId}
          stationName={channel.stationName}
          gridPosition={channel.gridPosition}
          loaded={seenChannelIds.has(channel.channelId)}
          displayState={channelDisplayStates.get(channel.channelId)}
          audioLevel={channelAudioLevels.get(channel.channelId)}
          subType={channelMachineOffline.has(channel.channelId) ? 'machine-offline' : undefined}
          snapshotDataUri={channelSnapshots.get(channel.channelId)}
          ackLabel={channelAck.get(channel.channelId)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
