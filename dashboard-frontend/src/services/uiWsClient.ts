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
// transport-core, lý do đã ghi rõ trong comment đầu file). `sub_type` chỉ có
// giá trị khi backend chốt `REJECTED` (AD-9: "nghi vấn cấu hình/bảo mật" -
// khác sub-type với mất tín hiệu `RECONNECTING` thường, dù cả 2 cùng hiển thị
// `critical`) - mirror đúng literal của backend (`AlertOutboundPort.ts`'s
// `ChannelStateChange['subType']`). `'config-or-security-suspected'` chỉ mang
// dữ liệu qua wire (Never: không render/xử lý subType đó trên UI) - KHÔNG
// dùng ở store/UI. Story 2.7 thêm `'machine-offline'` - subType MỚI DUY NHẤT
// thực sự được đọc ở `channelStore.ts` (`channelMachineOffline` set).
interface ChannelStateChangeMessage {
  type: 'channel-state-change';
  channel_id: string;
  display_state: DisplayState;
  sub_type?: 'config-or-security-suspected' | 'machine-offline';
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

// Code review [patch]: mirror `isValidDisplayState` ở trên - `sub_type` chỉ
// có đúng 2 literal hợp lệ (`'config-or-security-suspected'`/`'machine-offline'`
// - Story 2.7 thêm giá trị thứ 2), khớp backend. Trước đây chỉ check `typeof
// === 'string'`, chấp nhận bất kỳ chuỗi lạ nào lọt qua tới message đã được coi
// hợp lệ; giờ giá trị lạ khiến TOÀN BỘ message bị bỏ qua âm thầm, cùng tinh
// thần với `display_state` lạ.
function isValidSubType(value: unknown): value is 'config-or-security-suspected' | 'machine-offline' {
  return value === undefined || value === 'config-or-security-suspected' || value === 'machine-offline';
}

function isChannelStateChangeMessage(value: unknown): value is ChannelStateChangeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'channel-state-change' &&
    typeof v.channel_id === 'string' &&
    isValidDisplayState(v.display_state) &&
    typeof v.timestamp === 'string' &&
    isValidSubType(v.sub_type)
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
    store.applyChannelDisplayStateChange(parsed.channel_id, parsed.display_state, parsed.sub_type);
    return;
  }
  // type lạ khác (message tương lai chưa định nghĩa ở story này) - bỏ qua.
}

// Story 2.7 (Boundaries): "connectUiWsClient tự reconnect khi onclose/onerror
// (retry cố định, ví dụ 2000ms - LAN-only, không cần backoff luỹ thừa)".
// Design Notes: khác HẲN SRT reconnect vô hạn có backoff luỹ thừa của
// transport-core (Epic 1, môi trường WAN không đáng tin) - kênh WS UI này chỉ
// chạy trong LAN nội bộ ổn định, retry cố định đơn giản là đủ.
const RECONNECT_DELAY_MS = 2000;

// Trả về hàm disconnect (gọi trong cleanup của `useEffect`). Code review: gắn
// listener 'message' NGAY lúc tạo `WebSocket` (đồng bộ, TRƯỚC 'open') - server
// gửi `registry-snapshot` NGAY khi 'connection' fires (`wsUiAdapter.ts`); nếu
// gắn listener SAU 'open' (2 tick riêng biệt), message đã tới có thể bị lỡ
// vĩnh viễn (đã xác nhận qua race thật khi viết test cho `wsUiAdapter.ts`).
//
// Code review [patch]: `new WebSocket(url)` throw ĐỒNG BỘ nếu `url` sai định
// dạng (vd `NEXT_PUBLIC_DASHBOARD_UI_WS_URL` cấu hình lỗi lúc deploy) - gọi
// trong `useEffect` của `app/page.tsx` mà không có ErrorBoundary nào bắt sẽ
// crash trắng toàn bộ React tree. Bọc try/catch, log lỗi rõ ràng, thử lại sau
// RECONNECT_DELAY_MS thay vì để lỗi thoát ra ngoài hàm này (Story 2.7: lỗi
// tạo WebSocket cũng phải retry, cùng 1 cơ chế fixed-retry với onclose/onerror
// - không cần phân loại lỗi, giữ đơn giản đúng Boundaries).
//
// Boundaries: "Hàm dọn dẹp trả về PHẢI chặn mọi lần reconnect còn treo sau khi
// gọi (cờ disposed)" - `disposed` được kiểm tra ở MỌI điểm có thể lên lịch
// hoặc thực hiện 1 lần connect mới, tránh rò rỉ socket/timer sau unmount.
export function connectUiWsClient(url: string, store: ChannelStore): () => void {
  let disposed = false;
  let ws: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect(): void {
    if (disposed) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect(): void {
    if (disposed) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.error(`connectUiWsClient: không tạo được WebSocket tới "${url}":`, err);
      // Code review [patch]: mirror 'close'/'error' bên dưới - nếu KHÔNG báo
      // 'disconnected' ở đây, 1 URL cấu hình sai vĩnh viễn (vd
      // NEXT_PUBLIC_DASHBOARD_UI_WS_URL lỗi lúc deploy) sẽ khiến
      // connectionStatus kẹt mãi ở 'connected' lạc quan mặc định - banner/
      // grid-overlay không bao giờ hiện dù không hề có kết nối nào thành công.
      store.setConnectionStatus('disconnected');
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.addEventListener('message', (event: MessageEvent) => {
      applyUiWsMessage(store, String(event.data));
    });
    // I/O matrix "WS UI phục hồi": connectionStatus='connected' + refresh
    // lastConnectedAt NGAY khi 'open' - kể cả lần connect ĐẦU TIÊN (Boundaries:
    // "cập nhật mỗi lần ws.onopen"), không chỉ sau reconnect. `registry-snapshot`
    // mới sẽ tới ngay sau đó như 1 connect bình thường (server tự gửi lại).
    socket.addEventListener('open', () => {
      store.setConnectionStatus('connected', new Date().toISOString());
    });
    // I/O matrix "WS UI đứt": connectionStatus='disconnected' NGAY khi
    // 'close' fires, rồi tự thử reconnect (retry cố định, không throw).
    socket.addEventListener('close', () => {
      store.setConnectionStatus('disconnected');
      scheduleReconnect();
    });
    // 'error' luôn kèm 1 'close' ngay sau đó (đúng theo WebSocket spec) -
    // KHÔNG tự scheduleReconnect() ở đây (tránh double-schedule/2 lần
    // reconnect chồng nhau) - chỉ cập nhật trạng thái sớm, 'close' phía trên
    // sẽ lo phần reconnect.
    socket.addEventListener('error', () => {
      store.setConnectionStatus('disconnected');
    });
  }

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    ws?.close();
  };
}
