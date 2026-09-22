// Story 4.2: test toàn bộ I/O matrix của `TelegramAlertAdapter` (mirror
// `logAlertAdapter.test.ts`'s pattern `FakeLogger` + dựng `ChannelStateChange`
// tay) - lọc chỉ `warning`, cooldown 60000ms ĐỘC LẬP theo từng `channelId` qua
// `FakeClock` injectable, lỗi gọi Telegram bị nuốt + log riêng, KHÔNG throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TelegramAlertAdapter,
  TELEGRAM_COOLDOWN_MS,
  defaultTelegramSendMessage,
  type TelegramSendMessage,
} from '../src/adapters/outbound/telegramAlertAdapter.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';
import type { ChannelStateChange } from '../src/ports/AlertOutboundPort.js';
import type { Clock } from '../src/core/channelState.js';

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

// Mirror `main.test.ts`'s `FakeClock` - `now()` chỉ đổi khi `advance()` được
// gọi tường minh, không bao giờ đọc `Date.now()` thật (test được cooldown
// 60000ms mà không phải chờ 60s thật).
class FakeClock implements Clock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

function makeChange(overrides: Partial<ChannelStateChange> = {}): ChannelStateChange {
  return {
    channelId: 'chan-1',
    displayState: 'warning',
    timestamp: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeFakeSendMessage(): { fn: TelegramSendMessage; calls: { botToken: string; chatId: string; text: string }[] } {
  const calls: { botToken: string; chatId: string; text: string }[] = [];
  const fn: TelegramSendMessage = async (botToken, chatId, text) => {
    calls.push({ botToken, chatId, text });
  };
  return { fn, calls };
}

// Code review [patch round 2]: `publishStateChange` bọc `sendMessage(...)` qua
// `Promise.resolve().then(() => this.sendMessage(...)).then(logSuccess).catch(logError)`
// - đếm tick cố định (`flushMicrotasks`) để đợi chuỗi này chạy xong là brittle
// (giòn nếu implementation đổi shape Promise chain). Mirror `main.test.ts`'s
// `waitUntil()`: poll điều kiện thật (log event đã xuất hiện) thay vì đếm hop
// nội bộ - không phụ thuộc số lượng `.then()` bên trong adapter.
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

test('publishStateChange: warning mới, không trong cooldown -> gửi Telegram đúng 1 lần, ghi lastSentAt=now', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange());
  // `sendMessage` là fire-and-forget (Promise) bên trong `publishStateChange`
  // đồng bộ - poll tới khi log "đã gửi" xuất hiện thay vì đếm tick cố định
  // (xem comment `waitUntil`).
  await waitUntil((): boolean =>
    logger.events.some((e) => e.event_type === 'telegram_alert_sent' && e.channel_id === 'chan-1')
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.botToken, 'bot-token');
  assert.equal(calls[0]?.chatId, 'chat-id');
  assert.match(calls[0]?.text ?? '', /chan-1/);
  assert.match(calls[0]?.text ?? '', /WARNING/);

  assert.ok(logger.events.some((e) => e.event_type === 'telegram_alert_sent' && e.channel_id === 'chan-1'));
});

test('publishStateChange: warning lặp lại cùng kênh trong <60s -> lần 2 KHÔNG gửi, log sự kiện bỏ qua do cooldown', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange());
  clock.advance(TELEGRAM_COOLDOWN_MS - 1); // vẫn còn trong cooldown (59999ms < 60000ms)
  adapter.publishStateChange(makeChange());
  await Promise.resolve();

  assert.equal(calls.length, 1, 'lần 2 không được thực sự gọi Telegram');
  assert.ok(
    logger.events.some((e) => e.event_type === 'telegram_alert_cooldown_skipped' && e.channel_id === 'chan-1'),
    'phải log 1 event riêng ghi nhận việc bỏ qua do cooldown'
  );
});

test('publishStateChange: warning kênh khác trong lúc kênh A đang cooldown -> vẫn gửi bình thường (cooldown độc lập/kênh)', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange({ channelId: 'chan-A' }));
  clock.advance(1000); // chan-A còn cách xa cooldown hết hạn (59000ms còn lại)
  adapter.publishStateChange(makeChange({ channelId: 'chan-B' }));
  await Promise.resolve();

  assert.equal(calls.length, 2, 'chan-B phải được gửi dù chan-A đang cooldown - key cooldown độc lập theo channelId');
  assert.ok(calls.some((c) => c.text.includes('chan-A')));
  assert.ok(calls.some((c) => c.text.includes('chan-B')));
});

test('publishStateChange: displayState critical -> bỏ qua hoàn toàn, không gọi Telegram, không tính cooldown', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange({ displayState: 'critical' }));
  await Promise.resolve();

  assert.equal(calls.length, 0);
  assert.equal(logger.events.length, 0, 'không được log gì (không gửi, không cooldown, không lỗi)');
});

test('publishStateChange: displayState ok -> bỏ qua hoàn toàn, không gọi Telegram, không tính cooldown', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange({ displayState: 'ok' }));
  await Promise.resolve();

  assert.equal(calls.length, 0);
  assert.equal(logger.events.length, 0);
});

test('publishStateChange: displayState critical/ok xen giữa 2 lần warning -> KHÔNG ảnh hưởng cooldown của warning (chỉ warning mới tính key)', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange({ displayState: 'warning' }));
  clock.advance(10);
  adapter.publishStateChange(makeChange({ displayState: 'critical' }));
  clock.advance(10); // tổng 20ms << 60000ms - vẫn phải còn cooldown cho warning
  adapter.publishStateChange(makeChange({ displayState: 'warning' }));
  await Promise.resolve();

  assert.equal(calls.length, 1, 'warning lần 2 vẫn phải bị chặn bởi cooldown - critical xen giữa không reset gì');
});

test('publishStateChange: sendMessage reject (network throw) -> nuốt lỗi, log 1 event riêng, KHÔNG throw ra ngoài', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const failingSendMessage: TelegramSendMessage = async () => {
    throw new Error('network lỗi giả lập');
  };
  const adapter = new TelegramAlertAdapter({
    botToken: 'bot-token',
    chatId: 'chat-id',
    logger,
    clock,
    sendMessage: failingSendMessage,
  });

  assert.doesNotThrow(() => adapter.publishStateChange(makeChange()));
  // Poll tới khi `.catch` của chuỗi Promise nội bộ chạy xong (log lỗi xuất
  // hiện) - `publishStateChange` trả về ngay (đồng bộ), reject xảy ra sau đó
  // bất đồng bộ (xem comment `waitUntil`).
  await waitUntil((): boolean => logger.events.some((e) => e.event_type === 'telegram_alert_send_error'));

  const errorEvent = logger.events.find((e) => e.event_type === 'telegram_alert_send_error');
  assert.ok(errorEvent, 'phải log 1 event riêng cho lỗi gọi Telegram API');
  assert.equal(errorEvent?.channel_id, 'chan-1');
  assert.match(errorEvent?.reason ?? '', /network lỗi giả lập/);
});

test('publishStateChange: sendMessage reject với giá trị không phải Error (vd HTTP status != 2xx ném string) -> vẫn nuốt lỗi, log message không phải "undefined"', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  // eslint nếu có sẽ không chặn - mirror `createCompositeAlertPort`'s guard
  // `err instanceof Error` test case (1 port/hàm có thể reject với string).
  const failingSendMessage: TelegramSendMessage = () => Promise.reject('HTTP 500');
  const adapter = new TelegramAlertAdapter({
    botToken: 'bot-token',
    chatId: 'chat-id',
    logger,
    clock,
    sendMessage: failingSendMessage,
  });

  assert.doesNotThrow(() => adapter.publishStateChange(makeChange()));
  await waitUntil((): boolean => logger.events.some((e) => e.event_type === 'telegram_alert_send_error'));

  const errorEvent = logger.events.find((e) => e.event_type === 'telegram_alert_send_error');
  assert.ok(errorEvent);
  assert.match(errorEvent?.reason ?? '', /HTTP 500/);
  assert.doesNotMatch(errorEvent?.reason ?? '', /undefined/);
});

test('publishStateChange: lỗi gọi Telegram API vẫn KHÔNG ngăn lastSentAt được ghi -> lần warning kế tiếp trong 60s vẫn bị cooldown chặn', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const failingSendMessage: TelegramSendMessage = async () => {
    throw new Error('lỗi lần 1');
  };
  const adapter = new TelegramAlertAdapter({
    botToken: 'bot-token',
    chatId: 'chat-id',
    logger,
    clock,
    sendMessage: failingSendMessage,
  });

  adapter.publishStateChange(makeChange());
  await Promise.resolve();
  await Promise.resolve();

  clock.advance(1000);
  adapter.publishStateChange(makeChange());
  await Promise.resolve();

  assert.ok(
    logger.events.some((e) => e.event_type === 'telegram_alert_cooldown_skipped'),
    'dù lần gửi trước bị lỗi API, lastSentAt vẫn đã ghi ngay lúc gửi - lần 2 trong cooldown vẫn bị chặn'
  );
});

test('publishStateChange: warning cùng kênh sau khi cooldown đã hết (>=60000ms) -> gửi lại bình thường, cập nhật lastSentAt=now', async () => {
  const logger = new FakeLogger();
  const clock = new FakeClock();
  const { fn: sendMessage, calls } = makeFakeSendMessage();
  const adapter = new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger, clock, sendMessage });

  adapter.publishStateChange(makeChange());
  clock.advance(TELEGRAM_COOLDOWN_MS); // đúng bằng ngưỡng - "now - lastSentAt >= 60000ms"
  adapter.publishStateChange(makeChange());
  await Promise.resolve();

  assert.equal(calls.length, 2, 'cooldown đã hết (>=60000ms) - lần 2 phải gửi lại bình thường');

  // Gửi lần 3 ngay sau lần 2 (chưa đủ 60s kể từ lần 2) - phải lại bị chặn,
  // xác nhận lastSentAt đã CẬP NHẬT về mốc lần 2 (không phải mốc lần 1 cũ).
  clock.advance(10);
  adapter.publishStateChange(makeChange());
  await Promise.resolve();
  assert.equal(calls.length, 2, 'lastSentAt phải đã cập nhật về lần 2 - lần 3 (10ms sau) vẫn phải bị cooldown chặn');
});

test('constructor: dùng systemClock/defaultTelegramSendMessage mặc định khi omit (không đổi behavior khi không override)', () => {
  const logger = new FakeLogger();
  // Không truyền clock/sendMessage - chỉ xác nhận constructor không throw,
  // KHÔNG gọi publishStateChange() (tránh gọi fetch() thật ra mạng trong test).
  assert.doesNotThrow(() => new TelegramAlertAdapter({ botToken: 'bot-token', chatId: 'chat-id', logger }));
});

// Code review [patch]: test trên chỉ xác nhận constructor không throw, KHÔNG
// bao giờ chạy logic thật bên trong `defaultTelegramSendMessage` (check
// `res.ok`, đọc `res.text()` khi lỗi) - stub `global.fetch` (KHÔNG phải
// `sendMessage` injected) để chạy tới đúng nhánh đó, gọi `defaultTelegramSendMessage`
// trực tiếp.
test('defaultTelegramSendMessage: res.ok=false -> throw Error chứa status + body Telegram trả về', async () => {
  const originalFetch = global.fetch;
  let capturedUrl: string | undefined;
  global.fetch = (async (url: string) => {
    capturedUrl = String(url);
    return {
      ok: false,
      status: 401,
      text: async () => '{"description":"Unauthorized"}',
    } as Response;
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => defaultTelegramSendMessage('bot-token', 'chat-id', 'hello'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /401/);
        assert.match(err.message, /Unauthorized/);
        return true;
      }
    );
    assert.match(capturedUrl ?? '', /^https:\/\/api\.telegram\.org\/botbot-token\/sendMessage$/);
  } finally {
    global.fetch = originalFetch;
  }
});

// Code review [patch #6]: nếu `fetch()` tự nó throw (network/TLS/proxy/timeout,
// TRƯỚC KHI có response) - message rethrow phải CỐ ĐỊNH, KHÔNG chứa URL/token,
// để không rò rỉ bot token thật (nằm ngay trong URL) vào log JSON qua
// `telegram_alert_send_error`.
test('defaultTelegramSendMessage: fetch() tự throw (network error) -> throw Error message CỐ ĐỊNH, KHÔNG chứa URL/token', async () => {
  const originalFetch = global.fetch;
  const secretToken = 'super-secret-bot-token-should-not-leak';
  global.fetch = (async () => {
    throw new TypeError(`fetch failed: could not connect to https://api.telegram.org/bot${secretToken}/sendMessage`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => defaultTelegramSendMessage(secretToken, 'chat-id', 'hello'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.doesNotMatch(err.message, new RegExp(secretToken));
        assert.doesNotMatch(err.message, /api\.telegram\.org/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
