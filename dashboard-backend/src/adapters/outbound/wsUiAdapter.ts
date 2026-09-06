// Story 2.3: adapter outbound MỚI - WS server RIÊNG (cổng riêng
// `DASHBOARD_UI_WS_PORT`, KHÔNG auth - LAN-only theo ràng buộc kiến trúc,
// Boundaries/Never) phục vụ dashboard-frontend, tách biệt hoàn toàn khỏi WS
// server nhận telemetry từ máy trung tâm (`wsTelemetryAdapter.ts`, có bearer-
// token, hướng vào). Đây là adapter thật duy nhất implement `UiOutboundPort`.
//
// Boundaries: "Lúc client connect: gửi `registry-snapshot` (từ
// `listEntries()`) rồi replay `channel-seen` cho mọi kênh đã seen trước đó
// (Set nội bộ) - client connect muộn không bị kẹt skeleton." Giữ 1 Map nội bộ
// `channelId -> timestamp seen lần đầu` (hành xử như 1 Set kênh đã seen,
// nhưng giữ thêm timestamp gốc để replay đúng dữ liệu cho client connect
// muộn - không có "Set" thuần nào chứa đủ dữ liệu cần replay).
//
// I/O matrix: "WS UI client mất kết nối -> Adapter dọn khỏi danh sách
// broadcast, Log, không throw/crash" - `wss.clients` (built-in của thư viện
// `ws`) TỰ động dọn client khỏi danh sách khi 'close'/'terminate' xảy ra,
// không cần tự quản lý 1 danh sách riêng.

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../../ports/ChannelRegistryPort.js';
import type { UiOutboundPort } from '../../ports/UiOutboundPort.js';
import type { AlertOutboundPort, ChannelStateChange } from '../../ports/AlertOutboundPort.js';
import type { Logger } from '../../logging/logger.js';

// Code review (mirror wsTelemetryAdapter.ts): WS UI không auth (LAN-only,
// Boundaries/Never) nhưng vẫn cần chặn payload/khung dữ liệu bất thường -
// đủ rộng cho registry-snapshot 20 kênh, không cần business logic khác ở
// story này (client không gửi gì lên adapter này, chỉ nhận).
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface WsUiAdapterOptions {
  port: number;
  host?: string;
  registryPort: ChannelRegistryPort;
  logger: Logger;
}

// Story 2.6: `WsUiAdapterHandle` implement THÊM `AlertOutboundPort` - cùng 1
// adapter giờ phát cả `channel-seen` (UiOutboundPort, đã có từ Story 2.3) LẪN
// `channel-state-change` (AlertOutboundPort, MỚI) tới cùng tập client WS UI.
// 2 port vẫn tách biệt về TYPE/semantic (Design Notes/Ask First) - chỉ 1
// object implement CẢ HAI vì cả 2 đều broadcast tới cùng `wss.clients`.
export interface WsUiAdapterHandle extends UiOutboundPort, AlertOutboundPort {
  readonly port: number;
  close(): Promise<void>;
}

// Envelope gửi tới dashboard-frontend - snake_case để đối xứng với envelope
// telemetry chung (Consistency Conventions) dù đây là 1 kênh WS riêng biệt,
// không dùng chung schema_version/event_type đóng của transport-core (kênh
// này chỉ phục vụ backend -> frontend, không phải transport-core -> backend).
interface RegistrySnapshotChannel {
  channel_id: string;
  station_name: string;
  contact_name: string;
  contact_phone: string;
  grid_position: number;
}

interface RegistrySnapshotMessage {
  type: 'registry-snapshot';
  channels: RegistrySnapshotChannel[];
}

interface ChannelSeenMessage {
  type: 'channel-seen';
  channel_id: string;
  timestamp: string;
}

// Story 2.6: envelope `channel-state-change` - cùng phong cách snake_case
// đóng của kênh này (Boundaries: KHÔNG dùng envelope schema_version/event_type
// đóng của transport-core, lý do đã ghi ở comment đầu file). `sub_type` chỉ có
// mặt khi ChannelStateChange.subType có giá trị (undefined bị bỏ hẳn khỏi
// JSON qua object spread có điều kiện, mirror channelState.ts's ChannelStateChange
// build - KHÔNG gửi `sub_type: undefined` tường minh).
interface ChannelStateChangeMessage {
  type: 'channel-state-change';
  channel_id: string;
  display_state: ChannelStateChange['displayState'];
  sub_type?: ChannelStateChange['subType'];
  timestamp: string;
}

function toChannelStateChangeMessage(change: ChannelStateChange): ChannelStateChangeMessage {
  return {
    type: 'channel-state-change',
    channel_id: change.channelId,
    display_state: change.displayState,
    timestamp: change.timestamp,
    ...(change.subType ? { sub_type: change.subType } : {}),
  };
}

function toSnapshotChannel(entry: ChannelRegistryEntry & { channelId: string }): RegistrySnapshotChannel {
  return {
    channel_id: entry.channelId,
    station_name: entry.stationName,
    contact_name: entry.contactName,
    contact_phone: entry.contactPhone,
    grid_position: entry.gridPosition,
  };
}

function send(
  ws: WebSocket,
  message: RegistrySnapshotMessage | ChannelSeenMessage | ChannelStateChangeMessage
): void {
  // Code review: chỉ gửi khi socket còn ở trạng thái OPEN - client vừa
  // connect rồi rớt ngay lập tức (trước khi kịp gửi snapshot) không được
  // throw khi gọi ws.send() trên 1 socket đã CLOSING/CLOSED.
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export function startWsUiAdapter(options: WsUiAdapterOptions): Promise<WsUiAdapterHandle> {
  const { registryPort, logger } = options;

  // `channelId -> timestamp` của lần publishChannelSeen đầu tiên/kênh - dùng
  // để (a) chặn publish lặp lại cho cùng 1 kênh (idempotent theo đúng ngữ
  // nghĩa "đã thấy" - 1 lần là đủ) và (b) replay đúng dữ liệu cho client
  // connect muộn (Boundaries).
  const seenChannels = new Map<string, string>();

  // Story 2.6 (Design Notes): `lastState` là 1 Map ĐỘC LẬP với `seenChannels`
  // - khác semantic: `seenChannels` chỉ ghi 1 lần/kênh (idempotent theo đúng
  // nghĩa "đã thấy"), `lastState` GHI ĐÈ mỗi lần trạng thái đổi (không
  // idempotent-guard - Boundaries: "trạng thái đổi qua lại được"). Dùng để
  // replay `channel-state-change` mới nhất/kênh cho client connect muộn (nếu
  // không, ô sẽ kẹt vĩnh viễn ở loaded-neutral vì backend chỉ phát lại khi
  // trạng thái ĐỔI, không phát lặp khi ổn định).
  const lastState = new Map<string, ChannelStateChange>();

  const httpServer: HttpServer = createServer((_req, res) => {
    res.writeHead(404).end();
  });

  // Không auth (Boundaries/Never: "Thêm auth cho WS UI mới ... đã chốt:
  // không auth, LAN-only") - `{ server: httpServer }` để `ws` tự xử lý toàn
  // bộ upgrade handshake, không cần tự viết logic 401 như wsTelemetryAdapter.
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

  // Root-cause fix (code review): `ws`'s `WebSocketServer` constructor, khi
  // nhận `options.server`, TỰ ĐỘNG gắn 1 listener 'error' lên chính
  // `httpServer` để re-emit lỗi đó thành `wss.emit('error', err)` (xem
  // `node_modules/ws/lib/websocket-server.js`: `error: this.emit.bind(this,
  // 'error')`). Listener này được gắn NGAY LÚC CONSTRUCT (dòng trên) - TRƯỚC
  // `httpServer.once('error', reject)` bên dưới (thêm sau, trong Promise
  // executor). Node's EventEmitter gọi mọi listener 'error' theo ĐÚNG thứ tự
  // đăng ký - khi bind thất bại (vd EADDRINUSE): listener của `ws` chạy
  // TRƯỚC, gọi `wss.emit('error', err)`; `wss` KHÔNG có listener 'error' nào
  // -> Node THROW đồng bộ ngay tại đó (hành vi đặc biệt của EventEmitter cho
  // event 'error' không ai lắng nghe) - throw này xảy ra TRƯỚC KHI kịp chạy
  // tới listener `reject` của chính `startWsUiAdapter` (đăng ký sau), khiến
  // Promise của hàm này KHÔNG BAO GIỜ settle (không resolve/không reject) và
  // trở thành uncaught exception - vừa làm test/caller không bắt được lỗi
  // qua `assert.rejects`/try-catch, vừa để lại `httpServer`/`wss` treo vĩnh
  // viễn (nguồn gốc thật của cả 2 triệu chứng: test fail sai cách + process
  // không tự thoát). Gắn 1 listener 'error' TRÊN CHÍNH `wss` NGAY LẬP TỨC
  // (trước khi listen()) để event 'error' luôn có người nhận - loại bỏ hoàn
  // toàn nhánh throw-vì-không-ai-nghe này; lỗi khởi động vẫn được báo đúng
  // qua `httpServer.once('error', reject)` như cũ (2 listener độc lập, không
  // xung đột).
  wss.on('error', (err: Error) => {
    logger.log({ channel_id: '', event_type: 'ui_ws_server_error', reason: err.message });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const source = req.socket.remoteAddress ?? '';
    logger.log({ channel_id: '', event_type: 'ui_ws_connect', source, reason: '' });

    // I/O matrix "App vừa mở, WS UI connect": gửi registry-snapshot NGAY.
    send(ws, { type: 'registry-snapshot', channels: registryPort.listEntries().map(toSnapshotChannel) });
    // I/O matrix "Frontend connect muộn": replay channel-seen cho MỌI kênh
    // đã seen trước đó, NGAY SAU registry-snapshot, cùng 1 lần connect.
    for (const [channelId, timestamp] of seenChannels) {
      send(ws, { type: 'channel-seen', channel_id: channelId, timestamp });
    }
    // Story 2.6 (Design Notes): thứ tự replay là registry-snapshot ->
    // channel-seen (đã có, không đổi) -> channel-state-change (MỚI, nối
    // thêm bước 3) - replay trạng thái ĐÃ CHỐT gần nhất/kênh để client connect
    // muộn hiện đúng màu ngay, không chờ backend đổi trạng thái lần nữa.
    for (const change of lastState.values()) {
      send(ws, toChannelStateChangeMessage(change));
    }

    // Adapter này chỉ PHÁT tới frontend (outbound) - story 2.3 không định
    // nghĩa message nào frontend gửi lên qua kênh này (ack-command dùng WS
    // telemetry theo AD-25, ngoài scope story này) nên không cần handler
    // 'message'. Vẫn cần 'error' để tránh uncaught exception (cùng lớp lỗi
    // remotely-triggerable đã vá ở wsTelemetryAdapter.ts).
    ws.on('error', (err: Error) => {
      logger.log({ channel_id: '', event_type: 'ui_ws_disconnect', source, reason: err.message });
    });
    ws.on('close', (code: number, reasonBuf: Buffer) => {
      const reasonText = reasonBuf.toString() || '(không có)';
      logger.log({
        channel_id: '',
        event_type: 'ui_ws_disconnect',
        source,
        reason: `đóng kết nối, code=${code}, reason=${reasonText}`,
      });
    });
  });

  return new Promise<WsUiAdapterHandle>((resolve, reject) => {
    // Code review [patch]: KHÔNG gắn 1 listener 'error' thường trực (log
    // `ui_http_server_error`) TRƯỚC khi bind - lúc khởi động, lỗi bind (vd
    // EADDRINUSE) sẽ fire CẢ `once('error', reject)` (đúng, dùng để reject
    // Promise này) LẪN 1 listener thường trực nếu có, ra 1 dòng log thừa gây
    // nhiễu khi điều tra sự cố khởi động. Chỉ gắn listener log thường trực
    // SAU KHI `.listen()` xác nhận bind THÀNH CÔNG (trong callback bên dưới)
    // - lỗi runtime sau đó (vd EMFILE) vẫn được log đúng, lỗi khởi động chỉ
    // reject Promise, không log trùng.
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host ?? '0.0.0.0', () => {
      // Bind thành công - từ đây 1 lỗi runtime (không còn là lỗi khởi động)
      // cần 1 handler THƯỜNG TRỰC để ít nhất LOG lại (mirror wsTelemetryAdapter.ts).
      httpServer.on('error', (err: Error) => {
        logger.log({ channel_id: '', event_type: 'ui_http_server_error', reason: err.message });
      });
      const address = httpServer.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port: boundPort,

        // Boundaries: "channelState.ts ... gọi uiPort.publishChannelSeen
        // NGAY (không chờ debounce 5s)" - broadcast tới TOÀN BỘ client đang
        // mở kết nối, ghi nhớ vào seenChannels để replay cho client tương
        // lai. Idempotent: kênh đã seen rồi không publish/broadcast lặp lại
        // (đúng ngữ nghĩa "đã thấy", tránh spam broadcast mỗi telemetry).
        publishChannelSeen(channelId: string, timestamp: string): void {
          if (seenChannels.has(channelId)) return;
          seenChannels.set(channelId, timestamp);
          const message: ChannelSeenMessage = { type: 'channel-seen', channel_id: channelId, timestamp };
          for (const client of wss.clients) {
            send(client, message);
          }
        },

        // Story 2.6: gọi bởi composite alertPort tại composition root
        // (`main.ts`) mỗi khi `channelState.ts` chốt xong 1 debounce >=5s
        // (Boundaries) - KHÔNG idempotent-guard (khác `publishChannelSeen` ở
        // trên - `channelState.ts`'s `applyCandidate` đã tự đảm bảo chỉ gọi
        // khi trạng thái THỰC SỰ đổi, xem `sameCandidate` guard ở đó; ghi đè
        // `lastState` vô điều kiện ở đây để hỗ trợ trạng thái đổi qua lại).
        publishStateChange(change: ChannelStateChange): void {
          lastState.set(change.channelId, change);
          const message = toChannelStateChangeMessage(change);
          for (const client of wss.clients) {
            send(client, message);
          }
        },

        close: () =>
          new Promise<void>((res) => {
            // Mirror wsTelemetryAdapter.ts's close(): đóng chủ động mọi
            // client đang mở + mọi kết nối HTTP keep-alive thô trước khi
            // đóng server, tránh close() resolve trong khi vẫn còn kết nối
            // treo.
            for (const client of wss.clients) {
              client.terminate();
            }
            httpServer.closeAllConnections();
            wss.close(() => {
              httpServer.close(() => res());
            });
          }),
      });
    });
  });
}
