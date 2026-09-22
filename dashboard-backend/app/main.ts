// Story 2.1: bootstrap/wiring - nối adapters<->core, đọc config bearer-token/
// máy + đường dẫn channel-registry, start WS server. Đây là "Composition
// Root" duy nhất biết cả interface (ports) lẫn implementation (adapters) -
// core/ports không import ngược lại file này.
//
// Story 2.2: `baselineFilePath`/`DASHBOARD_BASELINE_FILE`/
// `FileBitrateBaselineAdapter` đổi thành `channelRegistryFilePath`/
// `DASHBOARD_CHANNEL_REGISTRY_FILE`/`FileChannelRegistryAdapter` - thêm
// `registryPort.start()`/`stop()` để hot-reload không restart process.
//
// Story 2.3: thêm `DASHBOARD_UI_WS_PORT`/`WsUiAdapter` - WS server RIÊNG
// (không auth) phục vụ dashboard-frontend, khởi tạo/`start()`/`stop()` song
// song `WsTelemetryAdapter`; wiring `uiPort` vào `ChannelStateService`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelStateService, type Clock } from '../src/core/channelState.js';
import { SnapshotRelayService } from '../src/core/snapshotRelay.js';
import { BitrateHistoryService } from '../src/core/bitrateHistory.js';
import { LogAlertAdapter } from '../src/adapters/outbound/logAlertAdapter.js';
import { TelegramAlertAdapter, type TelegramSendMessage } from '../src/adapters/outbound/telegramAlertAdapter.js';
import { FileChannelRegistryAdapter } from '../src/adapters/outbound/fileChannelRegistryAdapter.js';
import { startWsTelemetryAdapter, type WsTelemetryAdapterHandle } from '../src/adapters/inbound/wsTelemetryAdapter.js';
import { startWsUiAdapter, type WsUiAdapterHandle } from '../src/adapters/outbound/wsUiAdapter.js';
import type { AlertOutboundPort, ChannelStateChange } from '../src/ports/AlertOutboundPort.js';
import type { HistoryPort } from '../src/ports/HistoryPort.js';
import type { AckCommandPort } from '../src/ports/AckCommandPort.js';
import { defaultLogger, type Logger } from '../src/logging/logger.js';
import { isDirectRunEntrypoint } from './isDirectRun.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Code review [test coverage]: export để test trực tiếp không cần start cả
// `startApp()` (không cần mở cổng WS/đọc channel-registry file thật).
export function parseBearerTokens(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
  );
}

// Code review: DASHBOARD_WS_PORT trước đây đi thẳng qua `Number(...)` rồi
// vào `httpServer.listen()` không qua kiểm tra gì - 1 giá trị cấu hình sai
// (rỗng, chữ, số âm, số thập phân, >65535) sẽ tạo ra `NaN`/số không hợp lệ
// lọt vào `listen()`, gây lỗi khó hiểu ở tầng dưới thay vì 1 lỗi khởi động rõ
// ràng ngay tại điểm đọc config.
//
// Code review [edge case]: `Number('')`/`Number('   ')` === 0 - trước đây lọt
// qua guard bên dưới như 1 giá trị "0 = để OS tự cấp port" hợp lệ, khiến biến
// môi trường bị set NHẦM thành rỗng (vd lỗi template khi deploy) im lặng biến
// thành "tự động chọn port ngẫu nhiên" thay vì lỗi cấu hình rõ ràng. Chặn
// rỗng/toàn khoảng trắng tường minh TRƯỚC khi coerce - chỉ literal "0" mới
// được hiểu là "để OS tự cấp port".
// Code review [patch, vòng 2]: `varName` để thông báo lỗi nêu đúng tên biến
// môi trường đang được validate (`DASHBOARD_WS_PORT` hay `DASHBOARD_UI_WS_PORT`
// - Story 2.3 thêm biến thứ 2 dùng chung hàm này) - trước đây hardcode cứng
// "DASHBOARD_WS_PORT" trong cả 2 thông báo lỗi dù được gọi cho biến nào, khiến
// lỗi cấu hình sai `DASHBOARD_UI_WS_PORT` hiển thị nhầm tên biến, gây khó chẩn
// đoán hơn cần thiết lúc khởi động. Mặc định giữ nguyên "DASHBOARD_WS_PORT" -
// không đổi hành vi/test hiện có gọi `parsePort(raw)` không kèm tên biến.
export function parsePort(raw: string, varName = 'DASHBOARD_WS_PORT'): number {
  if (raw.trim() === '') {
    throw new Error(
      `${varName} không hợp lệ: rỗng/chỉ có khoảng trắng - phải là số nguyên trong khoảng ` +
        `0-65535 (0 = để OS tự cấp 1 port trống, nếu muốn vậy hãy set rõ "0").`
    );
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(
      `${varName} không hợp lệ: "${raw}" - phải là số nguyên trong khoảng 0-65535 ` +
        `(0 = để OS tự cấp 1 port trống).`
    );
  }
  return parsed;
}

// Story 2.6: composite `AlertOutboundPort` tại composition root - fan-out 1
// `ChannelStateChange` (chốt sau debounce >=5s ở `channelState.ts`) tới CẢ
// audit log (`LogAlertAdapter`, Story 2.1, giữ nguyên) LẪN broadcast WS UI
// (`WsUiAdapter.publishStateChange`, MỚI). Design Notes: "không cần 1
// port/type mới riêng (CompositeAlertOutboundPort) - 1 object literal
// implement AlertOutboundPort ngay tại composition root là đủ cho đúng 2
// consumer, tránh over-abstract cho use-case chưa cần tái sử dụng nơi khác."
// Vẫn export riêng (mirror `parsePort`/`parseBearerTokens` phía trên) để test
// được hành vi fan-out + cô lập lỗi từng nhánh mà không cần start cả
// `startApp()`/chờ debounce 5s thật.
//
// Boundaries: "lỗi ở 1 nhánh không được chặn nhánh còn lại (try/catch độc lập
// mỗi nhánh)" - 1 port throw không được ngăn các port còn lại trong danh sách
// nhận đúng `change` này.
export function createCompositeAlertPort(ports: readonly AlertOutboundPort[], logger: Logger): AlertOutboundPort {
  return {
    publishStateChange(change: ChannelStateChange): void {
      for (const [index, port] of ports.entries()) {
        try {
          port.publishStateChange(change);
        } catch (err) {
          // Code review [patch]: `err` không được đảm bảo là `Error` (1 port
          // có thể throw string/object/undefined) - `instanceof Error` guard
          // trước khi đọc `.message`, fallback `String(err)` để vẫn giữ nội
          // dung lỗi thật thay vì "undefined".
          const message = err instanceof Error ? err.message : String(err);
          // Code review [patch]: `logger.log(...)` tự nó CŨNG có thể throw (vd
          // sink tuỳ biến) - phải cô lập RIÊNG bằng try/catch của chính nó,
          // nếu không exception sẽ thoát khỏi vòng `for` và chặn luôn các
          // port còn lại nhận `change`, vi phạm đúng invariant "1 nhánh throw
          // không được ngăn nhánh còn lại" (Boundaries ở trên). Mirror cách
          // `defaultWriteLine()` (logger.ts) tự swallow lỗi ghi log.
          try {
            logger.log({
              channel_id: change.channelId,
              event_type: 'alert_publish_error',
              reason: `port[${index}] throw, các nhánh còn lại vẫn tiếp tục nhận change: ${message}`,
            });
          } catch {
            // intentionally swallowed - xem comment trên
          }
        }
      }
    },
  };
}

export interface AppHandle {
  ws: WsTelemetryAdapterHandle;
  ui: WsUiAdapterHandle;
  channelStateService: ChannelStateService;
  // Code review [test coverage]: instance THẬT wiring vào `channelStateService`
  // làm `historyPort` - trước đây không có seam nào để 1 test integration thật
  // (start cả `startApp()`) quan sát được `historyPort` thật đã wiring đúng;
  // 1 người lỡ tay thay `historyPort: bitrateHistoryService` bằng 1 stub rỗng
  // vẫn compile sạch và mọi test cũ vẫn xanh. Expose thẳng instance để test
  // gọi `getHistory()` xác nhận.
  // Code review [patch, round 2]: khai báo qua interface `HistoryPort` (không
  // phải concrete class `BitrateHistoryService`) - `AppHandle` là 1 boundary
  // hexagonal public, giữ đúng nguyên tắc chỉ lộ port ra ngoài composition
  // root, không lộ implementation cụ thể (mirror `channelStateService` field
  // phía trên vẫn lộ class cụ thể vì đó là chính service điều phối, khác
  // `historyPort` chỉ là 1 port phụ trợ được gọi qua interface ở mọi nơi khác).
  bitrateHistoryService: HistoryPort;
  stop(): Promise<void>;
}

// Tách khỏi `main()` (auto-start) để test/CLI khác có thể start/stop app
// trong-process với config tuỳ biến, không phải luôn đọc từ process.env.
export async function startApp(config?: {
  port?: number;
  host?: string;
  // Story 2.3: cổng/host riêng cho WS UI (dashboard-frontend) - mặc định
  // dùng chung `host` với WS telemetry nếu không set riêng (không thêm biến
  // môi trường host riêng ngoài scope Boundaries "env DASHBOARD_UI_WS_PORT").
  uiPort?: number;
  uiHost?: string;
  validBearerTokens?: Set<string>;
  channelRegistryFilePath?: string;
  // Code review [patch]: override cho test - cho phép test integration thật
  // (start cả `startApp()`) không phải chờ debounce 5s thật (`ChannelStateService`
  // đã tự default `debounceMs=5000`/`clock=systemClock` khi omit - KHÔNG đổi
  // behavior mặc định production).
  debounceMs?: number;
  clock?: Clock;
  // Story 4.2: override cho test - mirror `validBearerTokens`/
  // `channelRegistryFilePath` (config ?? env, fail-fast nếu rỗng bên dưới).
  // Cho phép test/CLI khác bơm bot token/chat_id/sendMessage giả mà không cần
  // set biến môi trường thật/gọi mạng Telegram thật.
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramSendMessage?: TelegramSendMessage;
  // Code review [patch]: override cho test - `startApp()` trước đây LUÔN dùng
  // `defaultLogger()` singleton nội bộ, không có seam nào để 1 test integration
  // thật (start cả `startApp()`, không phải fake) quan sát được `LogAlertAdapter`
  // có thực sự nhận `publishStateChange` qua đúng dòng wiring composite
  // (`createCompositeAlertPort([logAlertPort, ui], logger)`) hay không - lỗ
  // hổng verification: nếu dòng wiring đó bị sửa nhầm bớt `logAlertPort`, âm
  // thầm tắt luôn audit log (Boundaries: "giữ nguyên LogAlertAdapter ... broadcast
  // WS là THÊM, không thay thế"), không test nào phát hiện được. Mặc định
  // KHÔNG đổi (`config?.logger ?? defaultLogger()`) - production luôn dùng
  // singleton như cũ.
  logger?: Logger;
}): Promise<AppHandle> {
  const logger = config?.logger ?? defaultLogger();

  const port =
    config?.port ?? (process.env.DASHBOARD_WS_PORT !== undefined ? parsePort(process.env.DASHBOARD_WS_PORT, 'DASHBOARD_WS_PORT') : 8080);
  const host = config?.host ?? process.env.DASHBOARD_WS_HOST ?? '0.0.0.0';
  const uiPort =
    config?.uiPort ??
    (process.env.DASHBOARD_UI_WS_PORT !== undefined ? parsePort(process.env.DASHBOARD_UI_WS_PORT, 'DASHBOARD_UI_WS_PORT') : 8081);
  const uiHost = config?.uiHost ?? host;
  const validBearerTokens = config?.validBearerTokens ?? parseBearerTokens(process.env.DASHBOARD_BEARER_TOKENS);
  // Code review [patch]: `??` chỉ bắt `undefined`, không bắt chuỗi rỗng - 1
  // biến môi trường bị set NHẦM thành rỗng/toàn khoảng trắng (lỗi template
  // deploy, cùng lớp rủi ro với `DASHBOARD_WS_PORT` ở `parsePort()` phía
  // trên) sẽ lọt qua `??` rồi đi thẳng vào `FileChannelRegistryAdapter` với
  // path="" - vẫn ra lỗi khởi động (nhờ try/catch bên dưới) nhưng path hiển
  // thị trong thông báo sẽ rỗng, kém rõ ràng hơn. Chặn tường minh TRƯỚC,
  // cùng tinh thần `parsePort()`.
  const envChannelRegistryFilePath = process.env.DASHBOARD_CHANNEL_REGISTRY_FILE;
  if (envChannelRegistryFilePath !== undefined && envChannelRegistryFilePath.trim() === '') {
    throw new Error(
      'DASHBOARD_CHANNEL_REGISTRY_FILE không hợp lệ: rỗng/chỉ có khoảng trắng - phải là 1 đường dẫn file, ' +
        'hoặc bỏ hẳn biến này để dùng default "config/channel-registry.json".'
    );
  }
  const channelRegistryFilePath =
    config?.channelRegistryFilePath ??
    envChannelRegistryFilePath ??
    // Code review [QUAN TRỌNG] (giữ nguyên tinh thần từ Story 2.1): default
    // KHÔNG được trỏ vào `channel-registry.example.json` (dữ liệu demo) -
    // nếu vận hành quên set DASHBOARD_CHANNEL_REGISTRY_FILE, production sẽ
    // ÂM THẦM không bao giờ nạp được channel_id thật nào (rơi vào
    // `channel_unregistered` vĩnh viễn mà không ai biết tại sao). Default
    // trỏ tới 1 file THẬT riêng biệt (`channel-registry.json`, không phải
    // `.example.json`) - file này KHÔNG được ship kèm repo (xem .gitignore),
    // phải tự tạo từ `channel-registry.example.json` khi deploy (xem
    // README.md) - fail-fast rõ ràng bên dưới nếu thiếu, thay vì âm thầm
    // dùng demo data.
    //
    // currentDir sau biên dịch là <project-root>/dist/app - config/ nằm ở
    // project root (KHÔNG được tsc biên dịch/copy vào dist), nên phải lùi 2
    // cấp (dist/app -> dist -> root), không phải 1 cấp.
    path.resolve(currentDir, '..', '..', 'config', 'channel-registry.json');

  // Code review [QUAN TRỌNG]: trước đây chỉ log 1 `config_warning` rồi vẫn
  // tiếp tục start bình thường (kể cả log `app_started` sau đó) - dashboard-
  // backend "chạy thành công" trong log nhưng thực chất reject 100% kết nối
  // WS (không máy trung tâm nào xác thực được), 1 kiểu outage im lặng cho
  // đúng dịch vụ có nhiệm vụ giám sát uptime của 40 máy khác. Fail-fast ngay
  // tại composition root, cùng tinh thần với lỗi channel-registry file thiếu/
  // hỏng bên dưới - không có bearer-token nào nghĩa là service này vô dụng,
  // không đáng để start "thành công".
  if (validBearerTokens.size === 0) {
    throw new Error(
      'Không có bearer token hợp lệ nào được cấu hình (DASHBOARD_BEARER_TOKENS trống hoặc chưa set) - ' +
        'mọi kết nối WS từ máy trung tâm sẽ bị reject 401. Set biến môi trường DASHBOARD_BEARER_TOKENS ' +
        '(danh sách token cách nhau bởi dấu phẩy) trước khi khởi động.'
    );
  }

  // Code review: bọc rõ ràng để đưa ra 1 lỗi khởi động dễ hiểu (nêu path đã
  // resolve + gợi ý copy từ file example) thay vì để lộ raw stack trace Node
  // (ENOENT/SyntaxError...) khi cấu hình sai/thiếu file channel-registry.
  // Đây là lỗi lúc KHỞI ĐỘNG (constructor đọc/parse/validate đồng bộ, throw
  // fail-fast) - khác lỗi RELOAD sau khi đã chạy (adapter tự log
  // `registry_reload_error`, không throw - xem `fileChannelRegistryAdapter.ts`).
  let registryPort: FileChannelRegistryAdapter;
  try {
    registryPort = new FileChannelRegistryAdapter(channelRegistryFilePath, logger);
  } catch (err) {
    throw new Error(
      `Không đọc được channel-registry config tại "${channelRegistryFilePath}". ` +
        `Nếu đây là lần deploy đầu tiên: copy "config/channel-registry.example.json" thành ` +
        `"config/channel-registry.json" rồi điền đúng channel_id/station_name/contact_name/` +
        `contact_phone/grid_position/baseline_kbps THẬT của từng kênh, hoặc set biến môi trường ` +
        `DASHBOARD_CHANNEL_REGISTRY_FILE trỏ tới 1 file khác. Lỗi gốc: ${(err as Error).message}`
    );
  }
  // start() SAU khi constructor đã load thành công lần đầu - watch để hot-
  // reload không cần restart process (Intent).
  //
  // Code review [patch]: bọc try/catch cùng tinh thần khối catch phía trên -
  // `start()` gọi `fs.watch()` đồng bộ, có thể throw (vd race hiếm: file bị
  // xoá đúng lúc giữa constructor load xong và dòng gọi start() này) - không
  // bọc sẽ để lộ raw stack trace thay vì 1 lỗi khởi động dễ hiểu.
  try {
    registryPort.start();
  } catch (err) {
    throw new Error(
      `Không bật được theo dõi thay đổi channel-registry tại "${channelRegistryFilePath}": ${(err as Error).message}`
    );
  }

  const logAlertPort = new LogAlertAdapter(logger);

  // Story 4.2 (Boundaries): "Thiếu DASHBOARD_TELEGRAM_BOT_TOKEN/
  // DASHBOARD_TELEGRAM_CHAT_ID lúc khởi động -> fail-fast, throw Error rõ
  // ràng (mirror pattern DASHBOARD_BEARER_TOKENS) - không âm thầm start
  // thiếu kênh cảnh báo." Đặt SAU khi registryPort đã load/start thành công
  // (mirror vị trí `logAlertPort` ở Code Map) - registryPort lỗi cấu hình
  // (file thiếu/hỏng) vẫn phải báo ĐÚNG lỗi channel-registry của nó trước,
  // không bị che bởi lỗi Telegram nếu cả 2 cùng thiếu.
  // Code review [patch]: gán biến bằng giá trị ĐÃ `.trim()` (không phải giá
  // trị thô) - trước đây chỉ VALIDATE bằng `.trim() === ''` nhưng giá trị thật
  // lưu lại/dùng để build URL Telegram API vẫn là bản CHƯA trim. 1 giá trị có
  // khoảng trắng/newline thừa (vd đọc từ file secret mount) qua được validate
  // nhưng bị dùng nguyên trong URL, gây lỗi khó chẩn đoán hơn hẳn.
  const telegramBotToken = (config?.telegramBotToken ?? process.env.DASHBOARD_TELEGRAM_BOT_TOKEN)?.trim();
  const telegramChatId = (config?.telegramChatId ?? process.env.DASHBOARD_TELEGRAM_CHAT_ID)?.trim();
  // Code review [patch]: gộp validate cả 2 biến - khi THIẾU CẢ 2 (kịch bản
  // deploy lần đầu rất thường gặp), throw 1 Error liệt kê TÊN CẢ 2 biến còn
  // thiếu trong cùng 1 message, thay vì throw riêng lẻ theo thứ tự (trước đây
  // operator chỉ thấy lỗi bot-token, sửa, restart, rồi MỚI thấy lỗi chat-id -
  // mất 1 vòng lặp sửa/restart không cần thiết).
  if (
    telegramBotToken === undefined ||
    telegramBotToken === '' ||
    telegramChatId === undefined ||
    telegramChatId === ''
  ) {
    const missingTelegramVars: string[] = [];
    if (telegramBotToken === undefined || telegramBotToken === '') {
      missingTelegramVars.push('DASHBOARD_TELEGRAM_BOT_TOKEN');
    }
    if (telegramChatId === undefined || telegramChatId === '') {
      missingTelegramVars.push('DASHBOARD_TELEGRAM_CHAT_ID');
    }
    // Code review [patch round 3]: mirror 2 nhánh throw khác cùng hàm (bind UI
    // thất bại / bind telemetry thất bại) - registryPort đã start() thành công
    // ở trên, throw ở đây mà không dọn sẽ rò rỉ watcher/debounce timer nếu
    // startApp() được gọi lại trong-process (test/CLI).
    registryPort.stop();
    throw new Error(
      `${missingTelegramVars.join(', ')} không hợp lệ: thiếu/rỗng - phải set bot token + chat_id Telegram thật ` +
        'để đẩy cảnh báo warning (ABR hạ bitrate) tới đội trực sóng (Story 4.2, AD-17 - 1 chat chung duy nhất, ' +
        'không gửi lãnh đạo). Không được âm thầm start thiếu kênh cảnh báo này.'
    );
  }
  // TS narrows `telegramBotToken`/`telegramChatId` xuống `string` (loại bỏ
  // `undefined`/`''`) từ điều kiện throw phía trên - `telegramAlertPort` bên
  // dưới nhận đúng giá trị ĐÃ trim.
  const telegramAlertPort = new TelegramAlertAdapter({
    botToken: telegramBotToken,
    chatId: telegramChatId,
    logger,
    clock: config?.clock,
    sendMessage: config?.telegramSendMessage,
  });

  // Story 3.1: ring buffer in-memory lịch sử bitrate/kênh (Never/AD-14: KHÔNG
  // time-series DB). Tạo TRƯỚC `startWsUiAdapter` (Story 3.2: adapter cần
  // `historyPort` ngay trong constructor để gửi `channel-history-snapshot`
  // lúc connect). Code review [patch]: `BitrateHistoryService` không tự có
  // clock riêng (dead code đã bị xoá) - timestamp ghi vào ring buffer nhất
  // quán với timestamp debounce/state hoàn toàn nhờ `channelState.ts` truyền
  // thẳng `this.clock.now()` làm tham số `timestampMs` mỗi lần gọi
  // `historyPort.recordBitrate(...)`, không nhờ service này tự đọc clock.
  const bitrateHistoryService = new BitrateHistoryService();

  // Story 3.3 (Design Notes): circular-dependency - `wsUiAdapter` (khối bên
  // dưới) cần tồn tại TRƯỚC `channelStateService` (vì `channelStateService`
  // cần `uiPort` ngay ở constructor), nhưng `wsUiAdapter` giờ CŨNG cần gọi VÀO
  // `channelStateService` (`AckCommandPort.handleAckCommand`, cho envelope
  // `ack-command` từ client WS UI - AD-25). Không có pattern có sẵn để copy y
  // hệt trong codebase (port inbound ĐẦU TIÊN có caller là `wsUiAdapter.ts`
  // thay vì `wsTelemetryAdapter.ts`) - giải quyết bằng 1 forwarder cục bộ: biến
  // `let` trỏ tới instance THẬT, gán NGAY SAU KHI `channelStateService` khởi
  // tạo xong (bên dưới) - `startWsUiAdapter(...)` nhận forwarder này, KHÔNG
  // phải `channelStateService` trực tiếp.
  let ackCommandTarget: AckCommandPort | undefined;
  const ackCommandForwarder: AckCommandPort = {
    handleAckCommand(channelId: string, operatorLabel: string, timestampMs: number): void {
      if (!ackCommandTarget) {
        // Không nên xảy ra ở production - `channelStateService` được gán vào
        // forwarder này ngay sau khi khởi tạo xong, TRƯỚC KHI `wsUiAdapter` có
        // cơ hội nhận bất kỳ `ack-command` thật nào từ client (WS UI chỉ mới
        // bind cổng, chưa accept connection nào ở thời điểm đó). Log rõ ràng
        // thay vì throw/mất âm thầm nếu thứ tự này bị phá vỡ trong tương lai.
        logger.log({
          channel_id: channelId,
          event_type: 'ack_command_forwarder_not_ready',
          reason: 'ackCommandForwarder nhận ack-command trước khi channelStateService khởi tạo xong - bỏ qua',
        });
        return;
      }
      ackCommandTarget.handleAckCommand(channelId, operatorLabel, timestampMs);
    },
  };

  // Story 2.3: WS UI khởi động TRƯỚC `ChannelStateService` (`uiPort` là
  // dependency bắt buộc của constructor) - cùng tinh thần dọn dẹp lỗi khởi
  // động của khối `ws` bên dưới: nếu bind cổng UI thất bại (vd EADDRINUSE),
  // phải dọn `registryPort` đã start() trước khi rethrow, tránh rò rỉ
  // watcher/debounce timer khi `startApp()` được gọi lại trong-process.
  let ui: WsUiAdapterHandle;
  try {
    ui = await startWsUiAdapter({
      port: uiPort,
      host: uiHost,
      registryPort,
      historyPort: bitrateHistoryService,
      ackCommandPort: ackCommandForwarder,
      logger,
    });
  } catch (err) {
    registryPort.stop();
    throw err;
  }

  // Story 2.6: `ui` implement CẢ `UiOutboundPort` (channel-seen, Story 2.3)
  // LẪN `AlertOutboundPort` (channel-state-change, MỚI) - composite fan-out
  // audit log hiện có + broadcast WS UI mới, KHÔNG thay thế `LogAlertAdapter`.
  // Code review [patch]: thứ tự phần tử trong mảng KHÔNG mang ý nghĩa
  // ordering/invariant nào - `logAlertPort`/`ui` độc lập hoàn toàn với nhau
  // (không có yêu cầu "log trước WS" hay ngược lại), chỉ tình cờ liệt kê theo
  // thứ tự khai báo phía trên.
  // Story 4.2: thêm `telegramAlertPort` vào composite - THÊM, không thay thế
  // `logAlertPort`/`ui` hiện có (mirror comment Story 2.6 phía trên: thứ tự
  // phần tử không mang ý nghĩa ordering/invariant nào).
  const alertPort = createCompositeAlertPort([logAlertPort, telegramAlertPort, ui], logger);

  // Bổ sung video-preview thật (AD-22): `ui` implement THÊM `SnapshotOutboundPort`
  // (cùng object, mirror cách `ui` đã implement UiOutboundPort/AlertOutboundPort
  // ở trên) - `SnapshotRelayService` không có timer/watcher riêng (stateless),
  // không cần dọn gì thêm ở stop() bên dưới.
  const snapshotRelay = new SnapshotRelayService({ registryPort, snapshotOutboundPort: ui, logger });

  const channelStateService = new ChannelStateService({
    registryPort,
    alertPort,
    uiPort: ui,
    historyPort: bitrateHistoryService,
    logger,
    debounceMs: config?.debounceMs,
    clock: config?.clock,
  });
  // Story 3.3: gán forwarder NGAY SAU khi channelStateService khởi tạo xong -
  // từ đây `ackCommandForwarder` (đã truyền vào `startWsUiAdapter` ở trên) định
  // tuyến đúng vào instance thật này.
  ackCommandTarget = channelStateService;

  // Story 2.7 (Design Notes): "checkHeartbeatTimeouts() KHÔNG tự quản lý timer
  // nội bộ ... production tự gọi định kỳ từ composition root" - đây CHÍNH là
  // composition root đó. 1s (khớp Code Map) - đủ mịn so với ngưỡng 15000ms
  // (HEARTBEAT_TIMEOUT_MS) để độ trễ phát hiện không đáng kể.
  const heartbeatTimeoutTimer = setInterval(() => {
    channelStateService.checkHeartbeatTimeouts();
  }, 1000);

  // Code review [patch]: nếu bind WS thất bại (vd EADDRINUSE) sau khi
  // `registryPort.start()` đã chạy thành công ở trên, `startApp()` throw
  // thẳng ra ngoài mà không ai gọi `registryPort.stop()` - watcher/debounce
  // timer đang mở bị rò rỉ. Vô hại với tiến trình chạy trực tiếp (`main()`
  // bắt lỗi rồi `process.exit(1)`, OS tự dọn), nhưng `startApp()` được thiết
  // kế để gọi lại nhiều lần trong-process (comment dòng ~69-70: test/CLI) -
  // dọn registryPort trước khi rethrow để không tích luỹ watcher rò rỉ.
  let ws: WsTelemetryAdapterHandle;
  try {
    ws = await startWsTelemetryAdapter({
      port,
      host,
      validBearerTokens,
      telemetryPort: channelStateService,
      // Story 2.7: `channelStateService` implement CẢ 2 port (mirror
      // `TelemetryInboundPort` ở dòng trên) - cùng 1 object, khác interface.
      heartbeatPort: channelStateService,
      // Bổ sung video-preview thật (AD-22): port riêng, KHÁC object với
      // channelStateService (SnapshotRelayService không tương tác gì với
      // debounce/machineOfflineActive của telemetry/heartbeat).
      snapshotPort: snapshotRelay,
      logger,
    });
  } catch (err) {
    clearInterval(heartbeatTimeoutTimer);
    registryPort.stop();
    // Story 2.3: WS UI cũng đã bind cổng thành công ở khối phía trên - dọn
    // luôn, cùng lý do với `registryPort.stop()` ở dòng trên.
    await ui.close();
    throw err;
  }

  logger.log({
    channel_id: '',
    event_type: 'app_started',
    reason: `WS telemetry listening on ${host}:${ws.port}, WS UI listening on ${uiHost}:${ui.port}`,
  });

  return {
    ws,
    ui,
    channelStateService,
    bitrateHistoryService,
    stop: async () => {
      logger.log({ channel_id: '', event_type: 'app_stopping', reason: '' });
      clearInterval(heartbeatTimeoutTimer);
      registryPort.stop();
      await ui.close();
      await ws.close();
    },
  };
}

// Code review: chờ `app.stop()` xong trước khi force-exit, tối đa 10s - nếu
// `ws.close()` bên trong treo (vd 1 client không bao giờ đóng), process
// không được phép treo vô thời hạn theo (dashboard-backend chạy dưới Windows
// Service, `net stop`/SCM cần process thoát trong thời gian hợp lý).
const SHUTDOWN_FORCE_EXIT_MS = 10000;

export async function main(): Promise<void> {
  const app = await startApp();
  const logger = defaultLogger();

  // Code review: guard chống gọi lặp - SIGINT rồi SIGTERM liên tiếp (hoặc
  // cùng tín hiệu gửi 2 lần) trước khi `stop()` xong trước đây sẽ gọi
  // `app.stop()` nhiều lần chồng chéo. `shuttingDown` đảm bảo chỉ 1 lần
  // shutdown thực sự chạy.
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    // signal được log thật (không chỉ giữ trong biến rồi bỏ qua) để biết rõ
    // nguồn gốc shutdown (SIGINT thủ công vs SIGTERM từ SCM/`net stop`) khi
    // tra log sau này.
    logger.log({ channel_id: '', event_type: 'app_shutdown_signal', reason: `nhận tín hiệu ${signal}` });

    const forceExitTimer = setTimeout(() => {
      logger.log({
        channel_id: '',
        event_type: 'app_shutdown_timeout',
        reason: `stop() không hoàn tất sau ${SHUTDOWN_FORCE_EXIT_MS}ms - force exit`,
      });
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);

    // Code review: trước đây LUÔN `process.exit(0)` dù `app.stop()` reject -
    // 1 shutdown thất bại (vd `ws.close()` throw giữa chừng) bị báo cáo như
    // thành công tới bất kỳ ai theo dõi exit code (winsw/SCM/monitoring),
    // che giấu lỗi thật thay vì để nó hiện ra qua exit code khác 0.
    app
      .stop()
      .then(
        () => {
          clearTimeout(forceExitTimer);
          process.exit(0);
        },
        (err: unknown) => {
          console.error('lỗi khi dừng dashboard-backend:', err);
          clearTimeout(forceExitTimer);
          process.exit(1);
        }
      );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Chỉ tự khởi động khi file này được chạy trực tiếp (node dist/app/main.js) -
// installService.ts/test có thể import startApp()/main() mà không tự động
// mở cổng WS.
if (isDirectRunEntrypoint(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error('dashboard-backend fatal khi khởi động:', err);
    process.exit(1);
  });
}
