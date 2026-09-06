// Story 2.4: fixture giả lập trạng thái ok/warning/critical dùng cho
// `app/page.tsx` (Boundaries: "dữ liệu trạng thái nguồn từ fixture module
// MỚI ... KHÔNG nối WebSocket/channelStore thật (Story 2.6)"). Module này
// KHÔNG import/đọc `uiWsClient.ts` hay `channelStore.ts` - chỉ nhận vào 1
// danh sách channelId (page.tsx tự lấy từ `state.channels` đã có sẵn) và trả
// về map trạng thái tính thuần túy tại chỗ, không phụ thuộc backend/telemetry
// thật nào.
//
// Code review [round 1, finding #1]: gán trạng thái theo VỊ TRÍ/index trong
// mảng (`index % 3`) khiến 1 channelId đổi trạng thái hiển thị dù thực tế
// không đổi gì, chỉ vì `state.channels` đổi thứ tự phần tử giữa 2 lần
// `registry-snapshot` (cùng tập kênh, khác thứ tự mảng - hoàn toàn có thể xảy
// ra, registry không cam kết thứ tự ổn định). Fix: hash tại chỗ TRÊN CHÍNH
// chuỗi `channelId` (không phụ thuộc index/thứ tự mảng) - cùng 1 channelId
// luôn ra đúng 1 kết quả bất kể nó xuất hiện ở vị trí nào trong mảng đầu vào.

import type { DisplayState } from '../components/ChannelGridCell';

// Đúng 3 giá trị theo backend `AlertOutboundPort.ts` (Boundaries: "khớp đúng
// ... không tự đặt tên khác").
const DISPLAY_STATE_CYCLE: readonly DisplayState[] = ['ok', 'warning', 'critical'];

// Hash chuỗi đơn giản, deterministic, không phụ thuộc runtime/môi trường
// (thuần theo nội dung `channelId`) - đủ dùng cho mục đích demo/fixture, không
// cần chống collision mật mã học.
function hashChannelId(channelId: string): number {
  let hash = 0;
  for (let i = 0; i < channelId.length; i++) {
    hash = (hash * 31 + channelId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function buildChannelDisplayStatesFixture(
  channelIds: ReadonlyArray<string>,
): ReadonlyMap<string, DisplayState> {
  const map = new Map<string, DisplayState>();
  for (const channelId of channelIds) {
    // `noUncheckedIndexedAccess`: index luôn hợp lệ nhờ modulo theo đúng
    // length của mảng cố định 3 phần tử - non-null assertion an toàn.
    map.set(channelId, DISPLAY_STATE_CYCLE[hashChannelId(channelId) % DISPLAY_STATE_CYCLE.length]!);
  }
  return map;
}
