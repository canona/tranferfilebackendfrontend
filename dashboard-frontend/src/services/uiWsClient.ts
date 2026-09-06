// Story 2.3: `services/` - WebSocket client tới dashboard-backend (WS UI
// server MỚI của `wsUiAdapter.ts` - cổng riêng, KHÔNG auth, LAN-only).
// Boundaries: "Server-side data fetching/SSR cho dữ liệu kênh ở Next.js -
// toàn bộ qua WS client-side" - module này CHỈ chạy trong browser
// (`connectUiWsClient` dùng `WebSocket` global), gọi từ `app/page.tsx` trong
// `useEffect` ('use client'), không phải Server Component.
//
// Envelope nhận từ backend (mirror `wsUiAdapter.ts`'s snake_case message
// shape) - KHÔNG dùng chung envelope `schema_version`/`event_type` đóng của
// transport-core (đó là kênh máy trung tâm -> backend, khác kênh này).

import type { ChannelRegistryEntry, ChannelStore } from '../state/channelStore';
import type { DisplayState } from '../components/ChannelGridCell';

interface RawRegistrySnapshotChannel {
  channel_id: string;
  station_name: string;
  contact_name: string;
  contact_phone: string;
  grid_position: number;
}

interface RegistrySnapshotMessage {
  type: 'registry-snapshot';
  channels: RawRegistrySnapshotChannel[];
}

interface ChannelSeenMessage {
  type: 'channel-seen';
  channel_id: string;
  timestamp: string;
}

// Story 2.6: envelope nhận từ `wsUiAdapter.ts` - mirror snake_case shape của
// kênh này (KHÔNG dùng envelope schema_version/event_type đóng của
// transport-core, lý do đã ghi rõ trong comment đầu file). `sub_type` chỉ
// mang dữ liệu qua wire (Never: không render/xử lý subType trên UI ở story
// này) - field optional, không dùng ở store/UI.
interface ChannelStateChangeMessage {
  type: 'channel-state-change';
  channel_id: string;
  display_state: DisplayState;
  sub_type?: string;
  timestamp: string;
}

// Code review [patch]: phòng thủ lớp 2 (nhất quán tinh thần `channelState.ts`
// validate lại `connection_state` dù `wsTelemetryAdapter.ts` đã validate lớp
// 1) - `grid_position` không chỉ cần là `number`, phải là số nguyên 0-19
// (đúng khoảng hợp lệ theo `ChannelRegistryPort`/AD-26). 1 giá trị lệch (bug
// tương lai/envelope trôi dạt) sẽ khiến `gridPositionToRowCol` tính ra row/col
// âm hoặc ngoài lưới 5x4 mà không có cảnh báo nào nếu không chặn ở đây.
function isValidGridPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 19;
}

function isRawRegistrySnapshotChannel(value: unknown): value is RawRegistrySnapshotChannel {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.channel_id === 'string' &&
    typeof v.station_name === 'string' &&
    typeof v.contact_name === 'string' &&
    typeof v.contact_phone === 'string' &&
    isValidGridPosition(v.grid_position)
  );
}

function isRegistrySnapshotMessage(value: unknown): value is RegistrySnapshotMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'registry-snapshot' && Array.isArray(v.channels) && v.channels.every(isRawRegistrySnapshotChannel);
}

function isChannelSeenMessage(value: unknown): value is ChannelSeenMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'channel-seen' && typeof v.channel_id === 'string' && typeof v.timestamp === 'string';
}

// Story 2.6 (Boundaries): phòng thủ lớp 2 (mirror `isValidGridPosition`) -
// `display_state` phải đúng 1 trong 3 literal (`ok`/`warning`/`critical`),
// khớp `DisplayState` backend (`AlertOutboundPort.ts`'s AD-11 mapping). Giá
// trị lạ (vd 'unknown', field thiếu) khiến TOÀN BỘ message bị coi không hợp
// lệ, bỏ qua âm thầm - không throw, không đóng kết nối WS.
function isValidDisplayState(value: unknown): value is DisplayState {
  return value === 'ok' || value === 'warning' || value === 'critical';
}

function isChannelStateChangeMessage(value: unknown): value is ChannelStateChangeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'channel-state-change' &&
    typeof v.channel_id === 'string' &&
    isValidDisplayState(v.display_state) &&
    typeof v.timestamp === 'string' &&
    (v.sub_type === undefined || typeof v.sub_type === 'string')
  );
}

function toChannelRegistryEntry(raw: RawRegistrySnapshotChannel): ChannelRegistryEntry {
  return {
    channelId: raw.channel_id,
    stationName: raw.station_name,
    contactName: raw.contact_name,
    contactPhone: raw.contact_phone,
    gridPosition: raw.grid_position,
  };
}

// Tách khỏi `connectUiWsClient` để test được thuần (không cần WebSocket thật)
// - nhận đúng 1 chuỗi raw message + store, áp dụng đúng loại message hợp lệ,
// bỏ qua âm thầm mọi thứ khác (envelope hỏng/type lạ) - đối xứng cách backend
// xử lý `event_type_ignored`/`envelope_parse_error`, không throw để không
// làm chết kết nối WS vì 1 message lạ.
export function applyUiWsMessage(store: ChannelStore, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (isRegistrySnapshotMessage(parsed)) {
    store.applyRegistrySnapshot(parsed.channels.map(toChannelRegistryEntry));
    return;
  }
  if (isChannelSeenMessage(parsed)) {
    store.applyChannelSeen(parsed.channel_id);
    return;
  }
  if (isChannelStateChangeMessage(parsed)) {
    store.applyChannelDisplayStateChange(parsed.channel_id, parsed.display_state);
    return;
  }
  // type lạ khác (message tương lai chưa định nghĩa ở story này) - bỏ qua.
}

// Trả về hàm disconnect (gọi trong cleanup của `useEffect`). Code review: gắn
// listener 'message' NGAY lúc tạo `WebSocket` (đồng bộ, TRƯỚC 'open') - server
// gửi `registry-snapshot` NGAY khi 'connection' fires (`wsUiAdapter.ts`); nếu
// gắn listener SAU 'open' (2 tick riêng biệt), message đã tới có thể bị lỡ
// vĩnh viễn (đã xác nhận qua race thật khi viết test cho `wsUiAdapter.ts`).
//
// Code review [patch]: `new WebSocket(url)` throw ĐỒNG BỘ nếu `url` sai định
// dạng (vd `NEXT_PUBLIC_DASHBOARD_UI_WS_URL` cấu hình lỗi lúc deploy) - gọi
// trong `useEffect` của `app/page.tsx` mà không có ErrorBoundary nào bắt sẽ
// crash trắng toàn bộ React tree. Bọc try/catch, log lỗi rõ ràng, trả về 1
// disconnect no-op thay vì để lỗi thoát ra ngoài hàm này.
export function connectUiWsClient(url: string, store: ChannelStore): () => void {
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error(`connectUiWsClient: không tạo được WebSocket tới "${url}":`, err);
    return () => {
      // no-op - không có socket nào để đóng.
    };
  }
  ws.addEventListener('message', (event: MessageEvent) => {
    applyUiWsMessage(store, String(event.data));
  });
  return () => ws.close();
}
