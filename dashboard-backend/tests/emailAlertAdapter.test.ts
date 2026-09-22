// Story 4.3: test toàn bộ I/O matrix của `EmailAlertAdapter` (mirror
// `telegramAlertAdapter.test.ts`'s pattern `FakeLogger`/`FakeClock` + dựng
// `ChannelStateChange` tay) - lọc chỉ `critical`, cooldown 60000ms ĐỘC LẬP
// theo từng `channelId` qua `FakeClock` injectable, lỗi gọi `sendMail` bị
// nuốt + log riêng, KHÔNG throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {
  EmailAlertAdapter,
  EMAIL_COOLDOWN_MS,
  defaultEmailSendMail,
  type EmailSendMail,
  type EmailSmtpConfig,
} from '../src/adapters/outbound/emailAlertAdapter.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';
import type { ChannelStateChange } from '../src/ports/AlertOutboundPort.js';
import type { Clock } from '../src/core/channelState.js';

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

// Mirror `telegramAlertAdapter.test.ts`'s `FakeClock` - `now()` chỉ đổi khi
// `advance()` được gọi tường minh (test được cooldown 60000ms mà không phải
// chờ 60s thật).
class FakeClock implements Clock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

const SMTP_CONFIG: EmailSmtpConfig = {
  host: 'smtp.example.com',
  port: 587,
  user: 'smtp-user',
  password: 'smtp-password',
  from: 'alerts@example.com',
};

function makeChange(overrides: Partial<ChannelStateChange> = {}): ChannelStateChange {
  return {
    channelId: 'chan-1',
    displayState: 'critical',
    timestamp: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeFakeSendMail(): {
  fn: EmailSendMail;
  calls: { smtpConfig: EmailSmtpConfig; to: string[]; subject: string; text: string }[];
} {
  const calls: { smtpConfig: EmailSmtpConfig; to: string[]; subject: string; text: string }[] = [];
  const fn: EmailSendMail = async (smtpConfig, to, subject, text) => {
    calls.push({ smtpConfig, to, subject, text });
  };
  return { fn, calls };
}

// Mirror `telegramAlertAdapter.test.ts`'s `waitUntil` - `publishStateChange`
// bọc `sendMail(...)` qua `Promise.resolve().then(...).then(logSuccess)
// .catch(logError)` (fire-and-forget) - poll điều kiện thật (log event đã
// xuất hiện) thay vì đếm tick cố định.
function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitUntil: timeout chờ điều kiện'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('publishStateChange: critical mới, không trong cooldown -> gửi Email đúng 1 lần tới đủ recipients, ghi lastSentAt=now', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({
    ...SMTP_CONFIG,
    recipients: ['doi-truc@example.com', 'lanh-dao@example.com'],
    logger,
    clock,
    sendMail,
  });

  adapter.publishStateChange(makeChange());
  await waitUntil((): boolean =>
    logger.events.some((e) => e.event_type === 'email_alert_sent' && e.channel_id === 'chan-1')
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.to, ['doi-truc@example.com', 'lanh-dao@example.com']);
  assert.equal(calls[0]?.smtpConfig.host, 'smtp.example.com');
  assert.equal(calls[0]?.smtpConfig.from, 'alerts@example.com');
  assert.match(calls[0]?.subject ?? '', /chan-1/);
  assert.match(calls[0]?.text ?? '', /chan-1/);
  assert.match(calls[0]?.text ?? '', /CRITICAL/);

  assert.ok(logger.events.some((e) => e.event_type === 'email_alert_sent'));
});

// Code review (patch): `formatCriticalEmailBody` gắn kèm `change.subType`
// (vd 'machine-offline') vào body email - mấu chốt để đội trực/lãnh đạo phân
// biệt được machine-offline vs config-or-security-suspected ngay từ email,
// nhưng chưa có test nào assert nó thực sự xuất hiện trong text gửi đi.
test('publishStateChange: change kèm subType -> text email gửi đi CHỨA subType (vd machine-offline)', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange({ subType: 'machine-offline' }));
  await waitUntil((): boolean => calls.length > 0);

  assert.match(calls[0]?.text ?? '', /machine-offline/);
});

test('publishStateChange: critical lặp lại cùng kênh trong <60s -> lần 2 KHÔNG gửi, log sự kiện cooldown skip', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange());
  clock.advance(EMAIL_COOLDOWN_MS - 1);
  adapter.publishStateChange(makeChange());
  await Promise.resolve();

  assert.equal(calls.length, 1, 'lần 2 không được thực sự gọi sendMail');
  assert.ok(
    logger.events.some((e) => e.event_type === 'email_alert_cooldown_skipped' && e.channel_id === 'chan-1'),
    'phải log 1 event riêng ghi nhận việc bỏ qua do cooldown'
  );
});

test('publishStateChange: critical kênh khác trong lúc kênh A đang cooldown -> vẫn gửi bình thường (cooldown độc lập/kênh)', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange({ channelId: 'chan-A' }));
  clock.advance(1000);
  adapter.publishStateChange(makeChange({ channelId: 'chan-B' }));
  await Promise.resolve();

  assert.equal(calls.length, 2, 'chan-B phải được gửi dù chan-A đang cooldown - key cooldown độc lập theo channelId');
});

test('publishStateChange: displayState warning -> bỏ qua hoàn toàn, không gọi sendMail, không tính cooldown', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange({ displayState: 'warning' }));
  await Promise.resolve();

  assert.equal(calls.length, 0);
  assert.equal(logger.events.length, 0, 'không được log gì (không gửi, không cooldown, không lỗi)');
});

test('publishStateChange: displayState ok -> bỏ qua hoàn toàn, không gọi sendMail, không tính cooldown', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange({ displayState: 'ok' }));
  await Promise.resolve();

  assert.equal(calls.length, 0);
  assert.equal(logger.events.length, 0);
});

test('publishStateChange: sendMail reject (SMTP lỗi) -> nuốt lỗi, log 1 event riêng, KHÔNG throw ra ngoài', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const failingSendMail: EmailSendMail = async () => {
    throw new Error('SMTP connect timeout giả lập');
  };
  const adapter = new EmailAlertAdapter({
    ...SMTP_CONFIG,
    recipients: ['a@example.com'],
    logger,
    clock,
    sendMail: failingSendMail,
  });

  assert.doesNotThrow(() => adapter.publishStateChange(makeChange()));
  await waitUntil((): boolean => logger.events.some((e) => e.event_type === 'email_alert_send_error'));

  const errorEvent = logger.events.find((e) => e.event_type === 'email_alert_send_error');
  assert.ok(errorEvent, 'phải log 1 event riêng cho lỗi gửi Email');
  assert.equal(errorEvent?.channel_id, 'chan-1');
  assert.match(errorEvent?.reason ?? '', /SMTP connect timeout giả lập/);
});

test('publishStateChange: sendMail reject với giá trị không phải Error -> vẫn nuốt lỗi, log message không phải "undefined"', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const failingSendMail: EmailSendMail = () => Promise.reject('535 Authentication failed');
  const adapter = new EmailAlertAdapter({
    ...SMTP_CONFIG,
    recipients: ['a@example.com'],
    logger,
    clock,
    sendMail: failingSendMail,
  });

  assert.doesNotThrow(() => adapter.publishStateChange(makeChange()));
  await waitUntil((): boolean => logger.events.some((e) => e.event_type === 'email_alert_send_error'));

  const errorEvent = logger.events.find((e) => e.event_type === 'email_alert_send_error');
  assert.ok(errorEvent);
  assert.match(errorEvent?.reason ?? '', /535 Authentication failed/);
  assert.doesNotMatch(errorEvent?.reason ?? '', /undefined/);
});

test('publishStateChange: lỗi gửi Email vẫn KHÔNG ngăn lastSentAt được ghi -> lần critical kế tiếp trong 60s vẫn bị cooldown chặn', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const failingSendMail: EmailSendMail = async () => {
    throw new Error('lỗi lần 1');
  };
  const adapter = new EmailAlertAdapter({
    ...SMTP_CONFIG,
    recipients: ['a@example.com'],
    logger,
    clock,
    sendMail: failingSendMail,
  });

  adapter.publishStateChange(makeChange());
  await Promise.resolve();
  await Promise.resolve();

  clock.advance(1000);
  adapter.publishStateChange(makeChange());
  await Promise.resolve();

  assert.ok(
    logger.events.some((e) => e.event_type === 'email_alert_cooldown_skipped'),
    'dù lần gửi trước bị lỗi SMTP, lastSentAt vẫn đã ghi ngay lúc gửi - lần 2 trong cooldown vẫn bị chặn'
  );
});

test('publishStateChange: critical cùng kênh sau khi cooldown đã hết (>=60000ms) -> gửi lại bình thường, cập nhật lastSentAt=now', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange());
  clock.advance(EMAIL_COOLDOWN_MS);
  adapter.publishStateChange(makeChange());
  await Promise.resolve();

  assert.equal(calls.length, 2, 'cooldown đã hết (>=60000ms) - lần 2 phải gửi lại bình thường');

  clock.advance(10);
  adapter.publishStateChange(makeChange());
  await Promise.resolve();
  assert.equal(calls.length, 2, 'lastSentAt phải đã cập nhật về lần 2 - lần 3 (10ms sau) vẫn phải bị cooldown chặn');
});

// Story 4.4: nhánh phục hồi - `displayState==='ok'` VÀ `previousDisplayState
// ==='critical'` -> gửi NGAY, bỏ qua HOÀN TOÀN cooldown Map.

test('publishStateChange (recovery): cooldown critical đang active -> email phục hồi vẫn gửi ngay, bỏ qua cooldown', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({
    ...SMTP_CONFIG,
    recipients: ['doi-truc@example.com', 'lanh-dao@example.com'],
    logger,
    clock,
    sendMail,
  });

  adapter.publishStateChange(makeChange({ displayState: 'critical' }));
  await waitUntil((): boolean => calls.length === 1);
  clock.advance(1000); // còn cách xa cooldown hết hạn

  adapter.publishStateChange(makeChange({ displayState: 'ok', previousDisplayState: 'critical' }));
  await waitUntil((): boolean => calls.length === 2);

  assert.equal(calls.length, 2, 'email phục hồi phải gửi ngay dù cooldown critical đang active');
  assert.deepEqual(calls[1]?.to, ['doi-truc@example.com', 'lanh-dao@example.com']);
  assert.match(calls[1]?.subject ?? '', /[Pp]hục hồi/);
  assert.match(calls[1]?.text ?? '', /PHỤC HỒI/);
  assert.ok(
    logger.events.some((e) => e.event_type === 'email_recovery_sent'),
    'phải log event riêng cho email phục hồi'
  );

  // Critical kế tiếp (không phải phục hồi) ngay sau đó vẫn phải bị cooldown
  // chặn - nhánh phục hồi không đụng `lastSentAt` của nhánh cảnh báo.
  adapter.publishStateChange(makeChange({ displayState: 'critical' }));
  await Promise.resolve();
  assert.equal(calls.length, 2, 'nhánh phục hồi không được set/reset lastSentAt của nhánh cảnh báo');
  assert.ok(logger.events.some((e) => e.event_type === 'email_alert_cooldown_skipped'));
});

test('publishStateChange (recovery): previousDisplayState !== "critical" (vd "warning" hoặc undefined) -> KHÔNG kích hoạt nhánh phục hồi', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(makeChange({ displayState: 'ok', previousDisplayState: 'warning' }));
  adapter.publishStateChange(makeChange({ displayState: 'ok' })); // previousDisplayState undefined
  await Promise.resolve();

  assert.equal(calls.length, 0);
  assert.equal(logger.events.length, 0);
});

test('publishStateChange (recovery): subType==="machine-offline" dù previousDisplayState==="critical" -> KHÔNG kích hoạt nhánh phục hồi (guard chống báo phục hồi giả)', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMail, calls } = makeFakeSendMail();
  const adapter = new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger, clock, sendMail });

  adapter.publishStateChange(
    makeChange({ displayState: 'ok', previousDisplayState: 'critical', subType: 'machine-offline' })
  );
  await Promise.resolve();

  assert.equal(calls.length, 0, 'dashboard vẫn hiển thị critical/machine-offline - gửi phục hồi lúc này là báo giả');
  assert.equal(logger.events.length, 0);
});

test('constructor: dùng systemClock/defaultEmailSendMail mặc định khi omit (không đổi behavior khi không override)', () => {
  const logger = new FakeLogger();
  // Không truyền clock/sendMail - chỉ xác nhận constructor không throw, KHÔNG
  // gọi publishStateChange() (tránh gọi SMTP thật ra mạng trong test).
  assert.doesNotThrow(() => new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger }));
});

// Code review (patch, vòng 2): `defaultEmailSendMail` (wiring nodemailer
// thật) chưa từng có test nào trước đây, khác `defaultTelegramSendMessage`
// vốn có test riêng - stub `nodemailer.createTransport` (KHÔNG phải
// `sendMail` injected qua `EmailAlertAdapter`) để chạy tới đúng logic thật
// bên trong, mirror cách `telegramAlertAdapter.test.ts` stub `global.fetch`.
test('defaultEmailSendMail: port=465 -> secure:true (implicit TLS) + timeout 10000ms được truyền vào createTransport; sendMail dùng đúng from/to/subject/text', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let capturedOptions: Record<string, unknown> | undefined;
  let capturedMail: Record<string, unknown> | undefined;
  (nodemailer as unknown as { createTransport: unknown }).createTransport = (options: Record<string, unknown>) => {
    capturedOptions = options;
    return {
      sendMail: async (mailOptions: Record<string, unknown>) => {
        capturedMail = mailOptions;
        return { rejected: [] };
      },
    };
  };

  try {
    await defaultEmailSendMail(
      { host: 'smtp.example.com', port: 465, user: 'smtp-user', password: 'smtp-password', from: 'from@example.com' },
      ['a@example.com', 'b@example.com'],
      '[VTCDigital] Cảnh báo CRITICAL - kênh chan-1',
      'nội dung email'
    );

    assert.equal(capturedOptions?.host, 'smtp.example.com');
    assert.equal(capturedOptions?.port, 465);
    assert.equal(capturedOptions?.secure, true, 'port 465 -> secure:true (implicit TLS)');
    assert.equal(capturedOptions?.connectionTimeout, 10000);
    assert.equal(capturedOptions?.greetingTimeout, 10000);
    assert.equal(capturedOptions?.socketTimeout, 10000);
    assert.deepEqual((capturedOptions?.auth as { user: string; pass: string })?.user, 'smtp-user');
    assert.deepEqual((capturedOptions?.auth as { user: string; pass: string })?.pass, 'smtp-password');

    assert.equal(capturedMail?.from, 'from@example.com');
    assert.deepEqual(capturedMail?.to, ['a@example.com', 'b@example.com']);
    assert.equal(capturedMail?.subject, '[VTCDigital] Cảnh báo CRITICAL - kênh chan-1');
    assert.equal(capturedMail?.text, 'nội dung email');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('defaultEmailSendMail: port khác 465 (587/25...) -> secure:false (STARTTLS)', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let capturedSecure: unknown;
  (nodemailer as unknown as { createTransport: unknown }).createTransport = (options: Record<string, unknown>) => {
    capturedSecure = options.secure;
    return { sendMail: async () => ({ rejected: [] }) };
  };

  try {
    await defaultEmailSendMail(
      { host: 'smtp.example.com', port: 587, user: 'smtp-user', password: 'smtp-password', from: 'from@example.com' },
      ['a@example.com'],
      'subject',
      'text'
    );
    assert.equal(capturedSecure, false, 'port khác 465 -> secure:false (STARTTLS)');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

// Code review (patch, vòng 2): lỗi connect/auth từ nodemailer không được
// chắc chắn KHÔNG chứa `smtpConfig.user`/`password` - `defaultEmailSendMail`
// phải thay bằng 1 message cố định, KHÔNG nhúng thông tin xác thực gốc,
// mirror biện pháp chống rò rỉ bot token của `defaultTelegramSendMessage`.
test('defaultEmailSendMail: transporter.sendMail() throw -> throw lại message CỐ ĐỊNH, KHÔNG chứa user/password gốc', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const secretPassword = 'super-secret-app-password';
  (nodemailer as unknown as { createTransport: unknown }).createTransport = () => ({
    sendMail: async () => {
      throw new Error(`535 Authentication failed for user smtp-user with password ${secretPassword}`);
    },
  });

  try {
    await assert.rejects(
      () =>
        defaultEmailSendMail(
          { host: 'smtp.example.com', port: 587, user: 'smtp-user', password: secretPassword, from: 'from@example.com' },
          ['a@example.com'],
          'subject',
          'text'
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.doesNotMatch(err.message, new RegExp(secretPassword));
        assert.match(err.message, /smtp\.example\.com/);
        return true;
      }
    );
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

// Code review (patch, vòng 2): `transporter.sendMail()` có thể resolve
// THÀNH CÔNG dù 1 phần recipient bị SMTP server từ chối (`info.rejected`) -
// trước đây bị bỏ qua hoàn toàn, event `email_alert_sent` sẽ báo "đã gửi đủ"
// dù thực tế thiếu người nhận.
test('defaultEmailSendMail: transporter.sendMail() resolve với info.rejected không rỗng -> throw (KHÔNG âm thầm coi là gửi đủ)', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  (nodemailer as unknown as { createTransport: unknown }).createTransport = () => ({
    sendMail: async () => ({ rejected: ['b@example.com'] }),
  });

  try {
    await assert.rejects(
      () =>
        defaultEmailSendMail(
          { host: 'smtp.example.com', port: 587, user: 'smtp-user', password: 'smtp-password', from: 'from@example.com' },
          ['a@example.com', 'b@example.com'],
          'subject',
          'text'
        ),
      /từ chối/
    );
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('defaultEmailSendMail: transporter.sendMail() resolve với info.rejected rỗng -> không throw', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  (nodemailer as unknown as { createTransport: unknown }).createTransport = () => ({
    sendMail: async () => ({ rejected: [] }),
  });

  try {
    await assert.doesNotReject(() =>
      defaultEmailSendMail(
        { host: 'smtp.example.com', port: 587, user: 'smtp-user', password: 'smtp-password', from: 'from@example.com' },
        ['a@example.com'],
        'subject',
        'text'
      )
    );
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});
