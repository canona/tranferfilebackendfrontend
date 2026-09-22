// Story 4.2: `TelegramAlertAdapter` implement `AlertOutboundPort` - đẩy tin
// nhắn Telegram tới 1 chat khi 1 kênh chuyển sang 1 `displayState` cụ thể -
// trước đây chỉ có `LogAlertAdapter` ghi log nội bộ, không ai được chủ động
// báo (Intent). Áp cooldown 60s ĐỘC LẬP theo từng `channelId` qua `Clock`
// injectable (test được bằng fake clock, mirror `channelState.ts`).
//
// Story 4.3: tổng quát hoá - `displayState` ('warning'|'critical') giờ là
// tham số BẮT BUỘC của constructor (không hardcode `'warning'` nữa), để 1
// pipeline duy nhất phục vụ được cả instance warning (Story 4.2, hành vi
// KHÔNG đổi khi `displayState: 'warning'`) LẪN 2 instance critical mới (đội
// trực + lãnh đạo, `app/main.ts`) - tránh trùng lặp code giữa 2 story (Design
// Notes spec-4-3). Mỗi INSTANCE có `lastSentAt` Map riêng (field instance,
// không static/module-level) nên cooldown độc lập tuyệt đối giữa các instance
// dù dùng chung `chatId` (Boundaries spec-4-3: "instance critical không dùng
// chung bộ đếm với instance warning hiện có, dù dùng chung chatId đội trực").
//
// Boundaries: lỗi gọi Telegram Bot API (network throw/HTTP status != 2xx)
// phải bị NUỐT + log qua `Logger`, KHÔNG throw ra ngoài - adapter TỰ chịu
// trách nhiệm nuốt lỗi này, không dựa hoàn toàn vào `createCompositeAlertPort`'s
// catch chung (`app/main.ts`): catch đó chỉ bắt exception THROW ĐỒNG BỘ từ
// `publishStateChange()`, không bắt Promise reject của lời gọi `sendMessage`
// bất đồng bộ bên trong (interface `AlertOutboundPort.publishStateChange` trả
// về `void`, không phải `Promise<void>` - không thể `await` ở đây).

import type { AlertOutboundPort, ChannelStateChange, DisplayState } from '../../ports/AlertOutboundPort.js';
import type { Logger } from '../../logging/logger.js';
import { systemClock, type Clock } from '../../core/channelState.js';

// Boundaries: "cooldown tối thiểu 60000ms, độc lập theo từng channelId" -
// hằng số RIÊNG của adapter này, KHÔNG liên quan `DEBOUNCE_MS` (5s) hay
// `HEARTBEAT_TIMEOUT_MS` (15s) của `channelState.ts` (Never: "không đổi
// debounce 5s/mapping bitrate ở channelState.ts/bitrateThreshold.ts").
export const TELEGRAM_COOLDOWN_MS = 60000;

// Design Notes/Never: "không thêm dependency HTTP client mới (axios/node-fetch)
// - dùng fetch built-in của Node >=24". Tách hàm gửi thật ra khỏi logic
// cooldown/lọc warning để test toàn bộ nhánh lỗi/cooldown không cần gọi mạng
// thật (mirror `Clock` injectable).
export type TelegramSendMessage = (botToken: string, chatId: string, text: string) => Promise<void>;

// Ask First trong spec đã chốt mặc định: "KHÔNG retry - gửi 1 lần, lỗi thì log
// và bỏ qua" - implementation mặc định dưới đây gọi `fetch` đúng 1 lần, không
// tự retry/backoff.
export const defaultTelegramSendMessage: TelegramSendMessage = async (botToken, chatId, text) => {
  let res: Response;
  try {
    // Code review [patch]: timeout 10s qua `AbortSignal.timeout` - không có
    // timeout, 1 kết nối treo (network partition, firewall âm thầm drop) khiến
    // Promise fire-and-forget này treo vô thời hạn, không bao giờ log lỗi.
    res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Code review [patch]: URL Telegram API chứa bot token
    // (`https://api.telegram.org/bot<token>/sendMessage`) - nếu `fetch()` tự nó
    // throw (lỗi network/TLS/proxy/timeout, TRƯỚC KHI có response), message lỗi
    // 1 số trường hợp có thể echo lại URL đầy đủ. `publishStateChange`'s catch
    // handler log `err.message` verbatim - rethrow 1 Error CỐ ĐỊNH không chứa
    // URL/token để tránh rò rỉ token thật vào log JSON. Nhánh `!res.ok` bên
    // dưới giữ nguyên message gốc (chỉ chứa status + body Telegram trả về,
    // không chứa token).
    throw new Error('Telegram sendMessage network error (chi tiết lược bỏ để tránh lộ bot token qua URL)');
  }
  if (!res.ok) {
    // Đọc body để log lỗi rõ ràng hơn (vd Telegram trả `{"description":"..."}`
    // khi bot_token/chat_id sai) - `.catch` phòng trường hợp `res.text()` tự
    // nó throw (mirror tinh thần nuốt lỗi phòng thủ trong toàn bộ codebase này).
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage trả HTTP ${res.status}: ${body}`);
  }
};

// Story 4.3: chỉ 'warning'/'critical' hợp lệ cho adapter này ('ok' KHÔNG bao
// giờ có instance riêng - Never: "Không gửi Email/Telegram lãnh đạo ở mức
// warning ... không xử lý thông báo phục hồi").
export type TelegramAlertDisplayState = Extract<DisplayState, 'warning' | 'critical'>;

export interface TelegramAlertAdapterOptions {
  botToken: string;
  chatId: string;
  // Story 4.3: BẮT BUỘC (không có default) - 1 instance chỉ phục vụ ĐÚNG 1
  // displayState (mirror 3 instance ở `app/main.ts`: warning đội trực, critical
  // đội trực, critical lãnh đạo).
  displayState: TelegramAlertDisplayState;
  logger: Logger;
  clock?: Clock;
  sendMessage?: TelegramSendMessage;
  cooldownMs?: number;
}

export class TelegramAlertAdapter implements AlertOutboundPort {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly displayState: TelegramAlertDisplayState;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly sendMessage: TelegramSendMessage;
  private readonly cooldownMs: number;
  // Key `${channelId}:${displayState}` (Story 4.3: trước đây hardcode
  // `:warning`) -> epoch ms (Clock injectable) của lần GỬI gần nhất cho key
  // này. Field INSTANCE (không static/module-level) - 2 instance khác nhau
  // (vd critical đội trực vs critical lãnh đạo, dùng chung chatId đội trực)
  // luôn có Map RIÊNG, cooldown không bao giờ lẫn giữa 2 instance. In-memory
  // thuần, không cần bền vững qua restart (Design Notes: "restart hiếm và
  // epic context đã chấp nhận không có escalation/persistence phức tạp ở epic
  // này").
  private readonly lastSentAt = new Map<string, number>();

  constructor(options: TelegramAlertAdapterOptions) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.displayState = options.displayState;
    this.logger = options.logger;
    this.clock = options.clock ?? systemClock;
    this.sendMessage = options.sendMessage ?? defaultTelegramSendMessage;
    this.cooldownMs = options.cooldownMs ?? TELEGRAM_COOLDOWN_MS;
  }

  publishStateChange(change: ChannelStateChange): void {
    // Boundaries (Story 4.2/4.3): "Chỉ gửi khi change.displayState ===
    // this.displayState" - 1 instance warning bỏ qua critical/ok, 1 instance
    // critical bỏ qua warning/ok. I/O matrix: bỏ qua hoàn toàn, không gọi
    // Telegram, KHÔNG tính cooldown (early-return TRƯỚC khi đụng `lastSentAt`).
    if (change.displayState !== this.displayState) return;

    const key = `${change.channelId}:${this.displayState}`;
    const now = this.clock.now();
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      // I/O matrix: "Lần 2 KHÔNG gửi (cooldown), log sự kiện bỏ qua" - event
      // riêng biệt với event gửi thành công, không đụng `lastSentAt` (giữ mốc
      // của lần GỬI thật gần nhất, không phải lần bị bỏ qua).
      this.logger.log({
        channel_id: change.channelId,
        event_type: 'telegram_alert_cooldown_skipped',
        reason:
          `Bỏ qua gửi Telegram ${this.displayState} (chat_id=${this.chatId}, đang trong cooldown ` +
          `${this.cooldownMs}ms, lần gửi trước cách đây ${now - last}ms)`,
      });
      return;
    }

    // Ghi `lastSentAt` NGAY (trước khi Promise của `sendMessage` resolve/
    // reject) - 1 thay đổi kế tiếp cùng channelId/displayState tới trong lúc
    // request đang bay vẫn phải bị chặn bởi cooldown ngay lập tức, không phải
    // chờ tới khi request thật sự xong mới có hiệu lực.
    this.lastSentAt.set(key, now);

    const text = formatAlertMessage(change, this.displayState);
    // `publishStateChange()` là API ĐỒNG BỘ (AlertOutboundPort) - không thể
    // `await` `sendMessage()` ở đây. Fire-and-forget + `.catch` riêng (xem
    // comment đầu file: adapter TỰ nuốt lỗi async này, `createCompositeAlertPort`'s
    // catch không bắt được Promise reject).
    //
    // Code review [patch]: `Promise.resolve().then(() => this.sendMessage(...))`
    // thay vì gọi `this.sendMessage(...)` trực tiếp rồi `.catch` - nếu 1
    // implementation `TelegramSendMessage` (test double/override tương lai)
    // throw ĐỒNG BỘ thay vì reject Promise, gọi trực tiếp sẽ tự throw ngay tại
    // đây (đồng bộ, trong `publishStateChange()`), bỏ lỡ hoàn toàn log
    // `telegram_alert_send_error` riêng của adapter này. Bọc trong
    // `Promise.resolve().then(...)` đảm bảo throw đồng bộ cũng biến thành
    // rejection, bắt được bởi `.catch` bên dưới.
    //
    // Code review [patch]: log `telegram_alert_sent` chỉ được ghi trong nhánh
    // `.then()` SAU KHI `sendMessage` thật sự resolve thành công - trước đây
    // log này chạy ĐỒNG BỘ ngay sau khi gọi `sendMessage(...).catch(...)`,
    // TRƯỚC KHI promise settle, khiến 1 lần gửi sau đó lỗi vẫn bị log là "đã
    // gửi" (telegram_alert_sent + telegram_alert_send_error cùng lúc cho cùng
    // 1 attempt).
    Promise.resolve()
      .then(() => this.sendMessage(this.botToken, this.chatId, text))
      .then(() => {
        this.logger.log({
          channel_id: change.channelId,
          event_type: 'telegram_alert_sent',
          reason: `Đã gửi cảnh báo ${this.displayState} tới Telegram (chat_id=${this.chatId})`,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.log({
          channel_id: change.channelId,
          event_type: 'telegram_alert_send_error',
          reason: `Gọi Telegram Bot API lỗi (displayState=${this.displayState}, chat_id=${this.chatId}), đã nuốt (KHÔNG throw): ${message}`,
        });
      });
  }
}

// Story 4.3: tổng quát hoá `formatWarningMessage` cũ thành 1 formatter theo
// `displayState` - nhánh warning giữ NGUYÊN VĂN text cũ (Boundaries: "hành vi
// warning Story 4.2 không đổi"), thêm nhánh critical mới (kèm `subType` nếu
// có - `config-or-security-suspected`/`machine-offline` - để đội trực/lãnh
// đạo phân biệt được ngay trong tin nhắn Telegram).
function formatAlertMessage(change: ChannelStateChange, displayState: TelegramAlertDisplayState): string {
  if (displayState === 'warning') {
    return `⚠️ Kênh ${change.channelId} chuyển sang WARNING (ABR hạ bitrate) lúc ${change.timestamp}`;
  }
  const subTypeNote = change.subType ? ` (${change.subType})` : '';
  return `🚨 Kênh ${change.channelId} chuyển sang CRITICAL (mất tín hiệu hoàn toàn)${subTypeNote} lúc ${change.timestamp}`;
}
