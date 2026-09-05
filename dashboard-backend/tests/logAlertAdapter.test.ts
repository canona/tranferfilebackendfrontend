// Code review: LogAlertAdapter là adapter outbound THẬT duy nhất của story
// này (adapter outbound Telegram/Email/WS->React là stories sau) nhưng trước
// đây chỉ được test gián tiếp qua FakeAlertPort ở channelState.test.ts -
// formatter thật (`reason` string) chưa từng được assert trực tiếp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogAlertAdapter } from '../src/adapters/outbound/logAlertAdapter.js';
import type { Logger, LogEvent } from '../src/logging/logger.js';
import type { ChannelStateChange } from '../src/ports/AlertOutboundPort.js';

class FakeLogger implements Logger {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

test('publishStateChange: có subType -> reason chứa sub_type=<giá trị>', () => {
  const logger = new FakeLogger();
  const adapter = new LogAlertAdapter(logger);

  const change: ChannelStateChange = {
    channelId: 'chan-1',
    displayState: 'critical',
    subType: 'config-or-security-suspected',
    timestamp: '2026-09-03T00:00:00.000Z',
  };
  adapter.publishStateChange(change);

  assert.equal(logger.events.length, 1);
  const [event] = logger.events;
  assert.equal(event?.channel_id, 'chan-1');
  assert.equal(event?.event_type, 'alert_state_change');
  assert.match(event?.reason ?? '', /display_state=critical/);
  assert.match(event?.reason ?? '', /sub_type=config-or-security-suspected/);
});

test('publishStateChange: không có subType -> reason KHÔNG chứa "sub_type="', () => {
  const logger = new FakeLogger();
  const adapter = new LogAlertAdapter(logger);

  const change: ChannelStateChange = {
    channelId: 'chan-2',
    displayState: 'ok',
    timestamp: '2026-09-03T00:00:00.000Z',
  };
  adapter.publishStateChange(change);

  assert.equal(logger.events.length, 1);
  const [event] = logger.events;
  assert.match(event?.reason ?? '', /display_state=ok/);
  assert.doesNotMatch(event?.reason ?? '', /sub_type=/);
});

test('publishStateChange: warning không có subType -> reason đúng display_state=warning', () => {
  const logger = new FakeLogger();
  const adapter = new LogAlertAdapter(logger);

  adapter.publishStateChange({
    channelId: 'chan-3',
    displayState: 'warning',
    timestamp: '2026-09-03T00:00:00.000Z',
  });

  assert.match(logger.events[0]?.reason ?? '', /display_state=warning/);
  assert.doesNotMatch(logger.events[0]?.reason ?? '', /sub_type=/);
});
