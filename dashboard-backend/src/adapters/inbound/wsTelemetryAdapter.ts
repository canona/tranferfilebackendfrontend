// Story 2.1: adapter inbound WS - xác thực bearer-token/máy, parse + lọc
// envelope, forward event_type=telemetry vào domain core qua
// TelemetryInboundPort. Mirror phía nhận cho contract mà
// transport-core/src/telemetry/TelemetryWsClient.cpp phát (Authorization:
// Bearer <token> trên WS upgrade handshake; envelope chung
// schema_version/channel_id/timestamp/event_type/payload).
//
// Boundaries: "Chỉ ingest event_type=telemetry ... Mọi event_type khác nằm
// ngoài tập đóng {...} - bao gồm event `bitrate` riêng do ABR phát - bị bỏ
// qua âm thầm (log debug), không throw." Adapter này KHÔNG chứa business
// logic đo lường (mirror tinh thần TelemetryWsClient.h phía transport-core:
// "deliberately contains NO business logic of its own") - chỉ validate hình
// dạng JSON rồi forward.

import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CONNECTION_STATES, type TelemetryInboundPort, type TelemetryEvent, type ConnectionState } from '../../ports/TelemetryInboundPort.js';
import type { HeartbeatInboundPort } from '../../ports/HeartbeatInboundPort.js';
import type { Logger } from '../../logging/logger.js';

// Consistency Conventions / AD-30: tập đóng event_type - thêm giá trị mới
// phải tăng schema_version (ngoài phạm vi story này).
const CLOSED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'telemetry',
  'snapshot',
  'alert',
  'ack-command',
  'heartbeat',
  'handshake_reject',
  'handshake_success',
]);

// Code review: chặn frame WS quá khổ (vd client gửi payload khổng lồ) - chỉ
// cần giới hạn kích thước đơn thuần, KHÔNG xây rate-limiter/connection-cap
// đầy đủ (đã ghi vào deferred-work, ngoài scope story này). 1 MiB đủ rộng
// rãi cho snapshot JPEG độ phân giải thấp (AD-22, dù story 2.1 chưa xử lý
// business logic của event_type=snapshot) mà vẫn chặn được payload rác cỡ
// bất thường.
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface WsTelemetryAdapterOptions {
  port: number;
  host?: string;
  // Tập bearer-token hợp lệ (1 token/máy trung tâm - AD-13). Story 2.1 chưa
  // cần phân biệt token nào thuộc máy nào để xử lý nghiệp vụ (channel_id đã
  // tự khai báo trong envelope) - chỉ cần biết token có hợp lệ hay không.
  validBearerTokens: ReadonlySet<string>;
  telemetryPort: TelemetryInboundPort;
  // Story 2.7: port MỚI cho `event_type=heartbeat` (trước đây bị bỏ qua im
  // lặng trong tập đóng - xem nhánh `eventType !== 'telemetry'` bên dưới).
  heartbeatPort: HeartbeatInboundPort;
  logger: Logger;
}

export interface WsTelemetryAdapterHandle {
  readonly port: number;
  close(): Promise<void>;
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

// Code review [ưu tiên cao]: nếu client đã reset kết nối giữa chừng (vd đóng
// TCP đột ngột ngay sau khi mở), gọi socket.write()/destroy() mà KHÔNG có
// listener 'error' nào gắn trước sẽ khiến sự kiện 'error' không ai bắt ->
// Node coi là uncaught exception -> CRASH CẢ TIẾN TRÌNH. Đây là lỗ hổng có
// thể bị kích hoạt từ xa bởi BẤT KỲ client nào (không cần bearer-token đúng
// hay sai - lỗi xảy ra trước khi kịp xác thực). Gắn no-op error handler
// TRƯỚC mọi thao tác ghi/đóng socket.
function rejectHandshake(socket: Socket, logger: Logger, source: string, reason: string): void {
  socket.on('error', () => {
    // no-op có chủ đích - client đã rớt kết nối giữa chừng lúc ta đang reject,
    // không có gì để làm thêm, quan trọng là KHÔNG được để 'error' không ai bắt.
  });
  logger.log({ channel_id: '', event_type: 'ws_reject_auth', source, reason });
  // I/O matrix: "Bearer-token sai/thiếu -> Reject handshake, không tạo session
  // -> HTTP 401/403 + log ws_reject_auth". Trả 401 Unauthorized (thiếu/không
  // đúng credential) trước khi `wss.handleUpgrade` từng được gọi - không có
  // session/WebSocket nào được tạo ra cho request bị reject.
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

// Code review: chuẩn hoá dữ liệu message thô về string. Kiểu khai báo của
// `ws` cho sự kiện 'message' là `RawData = Buffer | ArrayBuffer | Buffer[]`
// (không phải luôn luôn là Buffer đơn) - `.toString()` ngầm định trên
// ArrayBuffer/Buffer[] KHÔNG cho ra JSON text đúng (vd Buffer[].toString()
// nối bằng dấu phẩy giữa các buffer, không phải nội dung nhị phân ghép lại).
function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString();
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString();
  }
  return Buffer.from(data).toString();
}

export function startWsTelemetryAdapter(options: WsTelemetryAdapterOptions): Promise<WsTelemetryAdapterHandle> {
  const { validBearerTokens, telemetryPort, heartbeatPort, logger } = options;

  const httpServer: HttpServer = createServer((_req, res) => {
    res.writeHead(404).end();
  });
  // Code review: `.once('error', reject)` bên dưới chỉ tồn tại để reject
  // Promise này lúc khởi động (vd EADDRINUSE) - sau khi listen() thành công,
  // 1 lỗi runtime sau đó (vd EMFILE hết file descriptor) cần 1 handler
  // THƯỜNG TRỰC để ít nhất LOG lại, không chỉ âm thầm bị nuốt bởi Promise đã
  // settle từ lâu.
  httpServer.on('error', (err: Error) => {
    logger.log({ channel_id: '', event_type: 'http_server_error', source: '', reason: err.message });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const source = req.socket.remoteAddress ?? '';
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      rejectHandshake(socket, logger, source, 'thiếu Authorization: Bearer <token>');
      return;
    }
    if (!validBearerTokens.has(token)) {
      rejectHandshake(socket, logger, source, 'bearer token không hợp lệ');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      logger.log({ channel_id: '', event_type: 'ws_accept', source, reason: '' });
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const source = req.socket.remoteAddress ?? '';
    ws.on('message', (data: RawData) => {
      handleMessage(rawDataToString(data), { telemetryPort, heartbeatPort, logger, source });
    });
    ws.on('error', (err: Error) => {
      logger.log({ channel_id: '', event_type: 'ws_disconnect', source, reason: err.message });
    });
    // Code review: trước đây chỉ log disconnect khi có 'error' - client đóng
    // kết nối GỌN GÀNG (close bình thường, không lỗi) không để lại dấu vết
    // audit nào (AD-30 yêu cầu log đủ vòng đời kết nối). 'close' luôn fire
    // (kể cả sau 'error'), nên có thể có 2 dòng log cho 1 lần rớt kết nối do
    // lỗi - chấp nhận được cho audit log (thừa còn hơn thiếu), không gộp lại
    // để tránh làm phức tạp state machine của handler này.
    ws.on('close', (code: number, reasonBuf: Buffer) => {
      const reasonText = reasonBuf.toString() || '(không có)';
      logger.log({
        channel_id: '',
        event_type: 'ws_disconnect',
        source,
        reason: `đóng kết nối, code=${code}, reason=${reasonText}`,
      });
    });
  });

  return new Promise<WsTelemetryAdapterHandle>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host ?? '0.0.0.0', () => {
      const address = httpServer.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((res) => {
            // Code review: đóng chủ động mọi client WS đang mở TRƯỚC khi
            // đóng server - tránh close() resolve trong khi client vẫn còn
            // kết nối treo (wss.close()/httpServer.close() chỉ ngừng NHẬN
            // kết nối mới, không tự đóng các kết nối đang mở).
            for (const client of wss.clients) {
              client.terminate();
            }
            // Code review: `httpServer.close()` chỉ ngừng NHẬN kết nối mới -
            // 1 kết nối HTTP keep-alive thô (không upgrade lên WS, vd health-
            // check/scanner gõ vào endpoint 404 mặc định) vẫn giữ callback
            // `close()` treo tới khi kết nối đó tự đóng. `closeAllConnections()`
            // (Node >=18.2, có sẵn trên Node 24 theo `engines`) chủ động đóng
            // luôn các kết nối HTTP đang mở, cùng tinh thần với việc terminate
            // `wss.clients` ở trên - `main.ts` vẫn còn timeout force-exit 10s
            // làm lưới an toàn cuối nếu có trường hợp khác chưa lường tới.
            httpServer.closeAllConnections();
            wss.close(() => {
              httpServer.close(() => res());
            });
          }),
      });
    });
  });
}

interface MessageContext {
  telemetryPort: TelemetryInboundPort;
  heartbeatPort: HeartbeatInboundPort;
  logger: Logger;
  source: string;
}

// Code review: validate kiểu dữ liệu THẬT SỰ trước khi coerce - `Number(x)`
// biến `null`/`false`/`""`/`[]` thành số hữu hạn (0) 1 cách âm thầm, khiến dữ
// liệu rác trông giống dữ liệu hợp lệ (vd tưởng bitrate=0% thật). Kiểm tra
// `typeof` trước, KHÔNG coerce.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function handleMessage(raw: string, ctx: MessageContext): void {
  let envelope: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('envelope không phải JSON object');
    }
    envelope = parsed as Record<string, unknown>;
  } catch (err) {
    ctx.logger.log({
      channel_id: '',
      event_type: 'envelope_parse_error',
      source: ctx.source,
      reason: (err as Error).message,
    });
    return;
  }

  const eventType = envelope.event_type;
  const envelopeChannelId = typeof envelope.channel_id === 'string' ? envelope.channel_id : '';

  if (typeof eventType !== 'string' || !CLOSED_EVENT_TYPES.has(eventType)) {
    // Boundaries: mọi event_type ngoài tập đóng (vd `bitrate` riêng của ABR)
    // bị bỏ qua âm thầm (log debug), không throw, không ảnh hưởng state.
    ctx.logger.log({
      channel_id: envelopeChannelId,
      event_type: 'event_type_ignored',
      source: ctx.source,
      reason: `event_type=${JSON.stringify(eventType)} ngoài tập đóng - bỏ qua`,
    });
    return;
  }

  if (eventType === 'heartbeat') {
    // Story 2.7: forward `channel_id` + timestamp envelope qua
    // `HeartbeatInboundPort` MỚI (trước đây rơi vào nhánh "bỏ qua có chủ đích"
    // bên dưới cùng snapshot/alert/ack-command/handshake_*). Payload heartbeat
    // không có field bắt buộc nào khác ngoài envelope chung (Epic 2 context:
    // "event_type=heartbeat, mỗi 5s, độc lập connection_state") - chỉ cần
    // channel_id hợp lệ, KHÔNG cần parse `payload`.
    if (!envelopeChannelId) {
      ctx.logger.log({
        channel_id: '',
        event_type: 'envelope_invalid',
        source: ctx.source,
        reason: 'heartbeat envelope thiếu channel_id',
      });
      return;
    }
    const heartbeatTimestamp = typeof envelope.timestamp === 'string' ? envelope.timestamp : new Date().toISOString();
    // Code review (mirror `telemetryPort.handleTelemetry` bên dưới): không để
    // 1 exception từ implementation của `HeartbeatInboundPort` thoát ra khỏi
    // handler 'message', crash cả tiến trình.
    try {
      ctx.heartbeatPort.handleHeartbeat(envelopeChannelId, heartbeatTimestamp);
    } catch (err) {
      ctx.logger.log({
        channel_id: envelopeChannelId,
        event_type: 'heartbeat_handler_error',
        source: ctx.source,
        reason: (err as Error).message,
      });
    }
    return;
  }

  if (eventType !== 'telemetry') {
    // Trong tập đóng nhưng KHÔNG phải telemetry/heartbeat (snapshot/alert/
    // ack-command/handshake_*) - thuộc scope story sau (Never: AckCommandPort/
    // HistoryPort thật ở Epic 3, snapshot cache ở Story 2.5...). Bỏ qua có chủ
    // đích, không throw.
    return;
  }

  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null) {
    ctx.logger.log({
      channel_id: envelopeChannelId,
      event_type: 'envelope_invalid',
      source: ctx.source,
      reason: 'telemetry envelope thiếu payload',
    });
    return;
  }
  if (!envelopeChannelId) {
    ctx.logger.log({
      channel_id: '',
      event_type: 'envelope_invalid',
      source: ctx.source,
      reason: 'telemetry envelope thiếu channel_id',
    });
    return;
  }

  const p = payload as Record<string, unknown>;
  const bitrateKbps = p.bitrate_kbps;
  const rttMs = p.rtt_ms;
  const connectionState = p.connection_state;
  const audioLevel = p.audio_level;

  const audioLevelValid = Array.isArray(audioLevel) && audioLevel.length === 2 && audioLevel.every(isFiniteNumber);

  if (
    !isFiniteNumber(bitrateKbps) ||
    !isFiniteNumber(rttMs) ||
    typeof connectionState !== 'string' ||
    !CONNECTION_STATES.has(connectionState as ConnectionState) ||
    !audioLevelValid
  ) {
    ctx.logger.log({
      channel_id: envelopeChannelId,
      event_type: 'telemetry_payload_invalid',
      source: ctx.source,
      reason: `payload không hợp lệ: ${JSON.stringify(payload)}`,
    });
    return;
  }

  // audioLevelValid đã xác nhận (qua isFiniteNumber, không coerce) mỗi phần
  // tử là number thật - an toàn để đọc trực tiếp, không cần Number(...) nữa.
  const audioLevelArray = audioLevel;
  const event: TelemetryEvent = {
    channelId: envelopeChannelId,
    timestamp: typeof envelope.timestamp === 'string' ? envelope.timestamp : new Date().toISOString(),
    bitrateKbps,
    rttMs,
    connectionState: connectionState as ConnectionState,
    audioLevel: [audioLevelArray[0] as number, audioLevelArray[1] as number],
  };

  // Code review: `handleTelemetry()` trước đây được gọi trực tiếp không
  // try/catch - 1 exception ném ra từ implementation của `TelemetryInboundPort`
  // (bug tương lai ở core, dù hiện tại `ChannelStateService` không throw cho
  // input đã validate) sẽ thoát ra ngoài handler 'message' của `ws`, thành
  // uncaught exception, CRASH CẢ TIẾN TRÌNH - cùng lớp lỗi remotely-triggerable
  // đã được vá riêng cho `socket.on('error')` ở `rejectHandshake()` phía trên.
  // Log lỗi rõ ràng, không throw, giữ connection sống - nhất quán với mọi
  // nhánh lỗi khác trong hàm này.
  try {
    ctx.telemetryPort.handleTelemetry(event);
  } catch (err) {
    ctx.logger.log({
      channel_id: envelopeChannelId,
      event_type: 'telemetry_handler_error',
      source: ctx.source,
      reason: (err as Error).message,
    });
  }
}
