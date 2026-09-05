// Story 2.1: adapter outbound TẠM - chỉ log, đủ để wiring domain core hoàn
// chỉnh mà không cần chờ adapter thật (Telegram/Email/WebSocket->React) của
// các story sau (Never: "Implement adapter outbound thật ... stories sau").

import type { AlertOutboundPort, ChannelStateChange } from '../../ports/AlertOutboundPort.js';
import type { Logger } from '../../logging/logger.js';

export class LogAlertAdapter implements AlertOutboundPort {
  constructor(private readonly logger: Logger) {}

  publishStateChange(change: ChannelStateChange): void {
    this.logger.log({
      channel_id: change.channelId,
      event_type: 'alert_state_change',
      reason: `display_state=${change.displayState}` + (change.subType ? ` sub_type=${change.subType}` : ''),
    });
  }
}
