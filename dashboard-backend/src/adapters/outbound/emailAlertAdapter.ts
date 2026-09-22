// Story 4.3: `EmailAlertAdapter` implement `AlertOutboundPort` - đẩy 1 email
// chung (gộp danh sách người nhận đội trực + lãnh đạo, Design Notes spec-4-3:
// "nội dung giống hệt nhau, tách theo audience chỉ có ý nghĩa với Telegram")
// khi 1 kênh chuyển sang `critical` (mất tín hiệu hoàn toàn) - trước đây
// codebase chưa có bất kỳ cơ chế gửi Email nào (Intent). Mirror gần như y hệt
// pattern `telegramAlertAdapter.ts` (Code Map spec-4-3): cooldown 60000ms qua
// `Clock` injectable (`Map` theo `channelId`, ĐỘC LẬP hoàn toàn với
// `TelegramAlertAdapter` - 2 adapter khác class, không share state gì), lỗi
// gửi bị NUỐT + log qua `Logger`, KHÔNG throw ra ngoài.
//
// Boundaries: "EmailAlertAdapter dùng nodemailer qua SMTP; lỗi gửi (connect/
// auth/timeout) phải bị nuốt + log qua Logger, KHÔNG throw ra ngoài - mirror
// pattern TelegramAlertAdapter" + "Không tự viết SMTP client qua net/tls -
// dùng nodemailer".
//
// Mirror `telegramAlertAdapter.ts`'s comment đầu file: lỗi gọi `sendMail`
// (connect/auth/timeout SMTP) phải bị NUỐT + log - adapter TỰ chịu trách
// nhiệm nuốt lỗi này, không dựa vào `createCompositeAlertPort`'s catch chung
// (`app/main.ts`): catch đó chỉ bắt exception THROW ĐỒNG BỘ từ
// `publishStateChange()`, không bắt Promise reject của `sendMail` bất đồng bộ
// bên trong (interface `AlertOutboundPort.publishStateChange` trả về `void`,
// không phải `Promise<void>` - không thể `await` ở đây).

import nodemailer from 'nodemailer';
import type { AlertOutboundPort, ChannelStateChange } from '../../ports/AlertOutboundPort.js';
import type { Logger } from '../../logging/logger.js';
import { systemClock, type Clock } from '../../core/channelState.js';

// Boundaries: "Cooldown tối thiểu 60000ms độc lập theo từng (channelId,
// alert_type)" - hằng số RIÊNG của adapter này (mirror `TELEGRAM_COOLDOWN_MS`),
// KHÔNG liên quan `DEBOUNCE_MS`/`HEARTBEAT_TIMEOUT_MS` của `channelState.ts`.
export const EMAIL_COOLDOWN_MS = 60000;

export interface EmailSmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

// Tách hàm gửi thật ra khỏi logic cooldown/lọc critical để test toàn bộ nhánh
// lỗi/cooldown không cần kết nối SMTP thật (mirror `TelegramSendMessage`
// injectable).
export type EmailSendMail = (
  smtpConfig: EmailSmtpConfig,
  to: string[],
  subject: string,
  text: string
) => Promise<void>;

// Ask First (mirror Story 4.2 đã chốt): KHÔNG retry - gửi 1 lần, lỗi thì log
// và bỏ qua. Tạo 1 transporter MỚI mỗi lần gửi (cảnh báo critical hiếm khi dồn
// dập tới mức cần pool connection) - đơn giản, không giữ state kết nối sống
// giữa các lần gửi.
export const defaultEmailSendMail: EmailSendMail = async (smtpConfig, to, subject, text) => {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    // Quy ước phổ biến: port 465 dùng TLS ngay từ đầu (implicit TLS), các
    // port khác (587/25...) dùng STARTTLS (nodemailer tự thương lượng khi
    // `secure: false`).
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.password },
    // Code review (patch): mirror `defaultTelegramSendMessage`'s
    // `AbortSignal.timeout(10000)` - không có timeout, 1 SMTP host không phản
    // hồi (network partition, firewall âm thầm drop, host chết) khiến
    // Promise fire-and-forget này treo vô thời hạn, không bao giờ log lỗi
    // trong lúc đúng 1 sự cố critical thật đang cần gửi cảnh báo. 10000ms,
    // khớp timeout Telegram.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  await transporter.sendMail({ from: smtpConfig.from, to, subject, text });
};

export interface EmailAlertAdapterOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  // Danh sách người nhận GỘP (đội trực + lãnh đạo) - 1 email chung tới cả 2
  // nhóm (Design Notes: SMTP hỗ trợ multiple recipients native, không cần 2
  // lần gửi cho Email khác Telegram).
  recipients: string[];
  logger: Logger;
  clock?: Clock;
  sendMail?: EmailSendMail;
  cooldownMs?: number;
}

export class EmailAlertAdapter implements AlertOutboundPort {
  private readonly smtpConfig: EmailSmtpConfig;
  private readonly recipients: string[];
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly sendMail: EmailSendMail;
  private readonly cooldownMs: number;
  // Key = `channelId` thuần (KHÁC `TelegramAlertAdapter`'s `${channelId}:
  // ${displayState}` - adapter này chỉ phản ứng ĐÚNG 1 displayState (critical)
  // nên không cần phân biệt thêm theo state trong key). Field INSTANCE, Map
  // RIÊNG của adapter này - không share với bất kỳ `TelegramAlertAdapter`
  // instance nào (Boundaries: cooldown độc lập theo từng kênh gửi).
  private readonly lastSentAt = new Map<string, number>();

  constructor(options: EmailAlertAdapterOptions) {
    this.smtpConfig = {
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      from: options.from,
    };
    this.recipients = options.recipients;
    this.logger = options.logger;
    this.clock = options.clock ?? systemClock;
    this.sendMail = options.sendMail ?? defaultEmailSendMail;
    this.cooldownMs = options.cooldownMs ?? EMAIL_COOLDOWN_MS;
  }

  publishStateChange(change: ChannelStateChange): void {
    // Boundaries: "Cả 2 Telegram instance mới và EmailAlertAdapter chỉ kích
    // hoạt khi change.displayState === 'critical'". I/O matrix: bỏ qua hoàn
    // toàn (warning/ok), không gọi SMTP, KHÔNG tính cooldown (early-return
    // TRƯỚC khi đụng `lastSentAt`).
    if (change.displayState !== 'critical') return;

    const key = change.channelId;
    const now = this.clock.now();
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < this.cooldownMs) {
      // I/O matrix: "Không gửi lại (cả Telegram lẫn Email), log cooldown skip"
      // - event riêng biệt với event gửi thành công, không đụng `lastSentAt`.
      this.logger.log({
        channel_id: change.channelId,
        event_type: 'email_alert_cooldown_skipped',
        reason:
          `Bỏ qua gửi Email critical (đang trong cooldown ${this.cooldownMs}ms, ` +
          `lần gửi trước cách đây ${now - last}ms)`,
      });
      return;
    }

    // Ghi `lastSentAt` NGAY (trước khi Promise của `sendMail` resolve/reject)
    // - mirror `TelegramAlertAdapter`: 1 critical kế tiếp cùng channelId tới
    // trong lúc request đang bay vẫn phải bị chặn bởi cooldown ngay lập tức.
    this.lastSentAt.set(key, now);

    const subject = `[VTCDigital] Cảnh báo CRITICAL - kênh ${change.channelId}`;
    const text = formatCriticalEmailBody(change);

    // `publishStateChange()` là API ĐỒNG BỘ (AlertOutboundPort) - không thể
    // `await` `sendMail()` ở đây. Fire-and-forget qua `Promise.resolve().then`
    // (mirror `TelegramAlertAdapter`: đảm bảo throw ĐỒNG BỘ từ 1 implementation
    // `EmailSendMail` test double cũng biến thành rejection, bắt được bởi
    // `.catch` bên dưới) + log `email_alert_sent` CHỈ sau khi resolve thành
    // công (tránh log "đã gửi" trước khi biết kết quả thật).
    Promise.resolve()
      .then(() => this.sendMail(this.smtpConfig, this.recipients, subject, text))
      .then(() => {
        this.logger.log({
          channel_id: change.channelId,
          event_type: 'email_alert_sent',
          reason: `Đã gửi email cảnh báo critical tới ${this.recipients.length} người nhận`,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.log({
          channel_id: change.channelId,
          event_type: 'email_alert_send_error',
          reason: `Gửi Email qua SMTP lỗi, đã nuốt (KHÔNG throw): ${message}`,
        });
      });
  }
}

function formatCriticalEmailBody(change: ChannelStateChange): string {
  const subTypeNote = change.subType ? ` (${change.subType})` : '';
  return (
    `Kênh ${change.channelId} chuyển sang CRITICAL (mất tín hiệu hoàn toàn)${subTypeNote} lúc ${change.timestamp}.\n\n` +
    'Đây là email tự động từ dashboard-backend VTCDigital - vui lòng kiểm tra kênh ngay.'
  );
}
