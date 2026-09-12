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

import type { ChannelRegistryEntry, ChannelStore, HistoryPoint, HistoryState } from '../state/channelStore';
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

// Bổ sung video-preview thật (AD-22): envelope nhận từ `wsUiAdapter.ts` -
// mirror snake_case shape của kênh này. `image_base64` là base64 JPEG THÔ
// (KHÔNG có prefix `data:...`) - `channelStore.ts`'s `applyChannelSnapshot`
// là nơi build data-URI, không phải ở đây (giữ layer transport chỉ validate
// hình dạng message, không diễn giải nội dung).
interface ChannelSnapshotMessage {
  type: 'channel-snapshot';
  channel_id: string;
  image_base64: string;
  timestamp: string;
}

// Story 3.2: envelope nhận từ `wsUiAdapter.ts` - mirror snake_case shape của
// kênh này. `state` chỉ có đúng 2 giá trị backend thực sự gửi (`loaded`/
// `no-history-data` - 'loading' là trạng thái CHỈ tồn tại ở frontend, Design
// Notes). `points` chỉ có mặt khi `state==='loaded'`.
interface RawChannelHistorySnapshotPoint {
  timestamp_ms: number;
  bitrate_pct: number;
}

interface ChannelHistorySnapshotMessage {
  type: 'channel-history-snapshot';
  channel_id: string;
  state: 'loaded' | 'no-history-data';
  points?: RawChannelHistorySnapshotPoint[];
}

// Story 3.2: envelope nhận từ `wsUiAdapter.ts` - broadcast realtime mỗi khi
// backend ghi thành công 1 mẫu bitrate mới (mirror `channel-snapshot`'s
// broadcast timing, khác hoàn toàn `channel-history-snapshot` chỉ gửi 1
// lần/kênh lúc connect).
interface ChannelHistoryPointMessage {
  type: 'channel-history-point';
  channel_id: string;
  bitrate_pct: number;
  timestamp_ms: number;
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

// Bổ sung video-preview thật (AD-22): mirror isChannelSeenMessage - chỉ
// validate hình dạng thô (channel_id/image_base64 là string không rỗng),
// KHÔNG validate nội dung base64 có phải JPEG hợp lệ hay không (đó là việc
// của trình duyệt khi gán vào backgroundImage/img src, không phải layer này -
// mirror tinh thần "src/core hoàn toàn thuần" phía backend: layer transport
// không xử lý/diễn giải nội dung ảnh).
function isChannelSnapshotMessage(value: unknown): value is ChannelSnapshotMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'channel-snapshot' &&
    typeof v.channel_id === 'string' &&
    v.channel_id.length > 0 &&
    typeof v.image_base64 === 'string' &&
    v.image_base64.length > 0 &&
    typeof v.timestamp === 'string'
  );
}

// Story 3.2: phòng thủ lớp 2 (mirror `isValidGridPosition`/`isValidDisplayState`)
// - `state` chỉ chấp nhận đúng 2 literal backend thực sự gửi qua wire.
function isValidHistorySnapshotState(value: unknown): value is 'loaded' | 'no-history-data' {
  return value === 'loaded' || value === 'no-history-data';
}

function isRawHistorySnapshotPoint(value: unknown): value is RawChannelHistorySnapshotPoint {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.timestamp_ms === 'number' && typeof v.bitrate_pct === 'number';
}

function isChannelHistorySnapshotMessage(value: unknown): value is ChannelHistorySnapshotMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== 'channel-history-snapshot' || typeof v.channel_id !== 'string' || !isValidHistorySnapshotState(v.state)) {
    return false;
  }
  // `points` bắt buộc là mảng hợp lệ khi state='loaded' (đúng ngữ nghĩa wire
  // của backend - `no-history-data` không kèm points, xem `wsUiAdapter.ts`).
  if (v.state === 'loaded') {
    return Array.isArray(v.points) && v.points.every(isRawHistorySnapshotPoint);
  }
  return true;
}

function isChannelHistoryPointMessage(value: unknown): value is ChannelHistoryPointMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'channel-history-point' &&
    typeof v.channel_id === 'string' &&
    typeof v.bitrate_pct === 'number' &&
    typeof v.timestamp_ms === 'number'
  );
}

function toHistoryState(raw: ChannelHistorySnapshotMessage): HistoryState {
  if (raw.state === 'loaded') {
    // `raw.points` đã được `isChannelHistorySnapshotMessage` xác nhận là mảng
    // hợp lệ khi state='loaded' - `?? []` chỉ để thoả kiểu tĩnh (optional).
    const points: HistoryPoint[] = (raw.points ?? []).map((p) => ({ timestampMs: p.timestamp_ms, bitratePct: p.bitrate_pct }));
    return { state: 'loaded', points };
  }
  return { state: 'no-history-data' };
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
  if (isChannelSnapshotMessage(parsed)) {
    store.applyChannelSnapshot(parsed.channel_id, parsed.image_base64);
    return;
  }
  if (isChannelHistorySnapshotMessage(parsed)) {
    store.applyHistorySnapshot(parsed.channel_id, toHistoryState(parsed));
    return;
  }
  if (isChannelHistoryPointMessage(parsed)) {
    store.applyHistoryPoint(parsed.channel_id, { timestampMs: parsed.timestamp_ms, bitratePct: parsed.bitrate_pct });
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
    // Code review [patch round 2]: guard idempotent - 'close' và 'error' có
    // thể cùng fire cho 1 lần đứt kết nối (nhánh 'error' bên dưới giờ cũng
    // gọi hàm này như 1 lớp phòng thủ) - không được lên lịch 2 timer reconnect
    // chồng nhau (sẽ mở 2 kết nối WebSocket song song khi cả 2 cùng bắn).
    if (reconnectTimer !== undefined) return;
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
    // Code review [patch round 2]: 'error' luôn kèm 1 'close' ngay sau đó
    // (đúng theo WebSocket spec/mọi browser thật) - nhưng vẫn tự gọi
    // scheduleReconnect() ở đây làm lớp phòng thủ (guard idempotent trong
    // scheduleReconnect() chặn double-schedule khi cả 'error' và 'close' cùng
    // fire) phòng khi giả định đó bị phá vỡ ở 1 runtime/polyfill không chuẩn -
    // tránh client kẹt 'disconnected' vĩnh viễn không tự hồi phục.
    socket.addEventListener('error', () => {
      store.setConnectionStatus('disconnected');
      scheduleReconnect();
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
