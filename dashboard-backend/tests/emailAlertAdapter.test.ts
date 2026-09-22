// Story 4.3: test toàn bộ I/O matrix của `EmailAlertAdapter` (mirror
// `telegramAlertAdapter.test.ts`'s pattern `FakeLogger`/`FakeClock` + dựng
// `ChannelStateChange` tay) - lọc chỉ `critical`, cooldown 60000ms ĐỘC LẬP
// theo từng `channelId` qua `FakeClock` injectable, lỗi gọi `sendMail` bị
// nuốt + log riêng, KHÔNG throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EmailAlertAdapter,
  EMAIL_COOLDOWN_MS,
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

test('constructor: dùng systemClock/defaultEmailSendMail mặc định khi omit (không đổi behavior khi không override)', () => {
  const logger = new FakeLogger();
  // Không truyền clock/sendMail - chỉ xác nhận constructor không throw, KHÔNG
  // gọi publishStateChange() (tránh gọi SMTP thật ra mạng trong test).
  assert.doesNotThrow(() => new EmailAlertAdapter({ ...SMTP_CONFIG, recipients: ['a@example.com'], logger }));
});
