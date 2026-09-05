// AD-30: log structured JSON lines cục bộ, cho cả handshake thành công VÀ
// reject, cho mỗi lần trạng thái hiển thị của 1 kênh đổi. Code Map: "mirror
// phong cách Logger 4-field của transport-core" (xem
// transport-core/src/logging/Logger.h/.cpp) - CHỦ Ý giữ đúng 4 field
// (channel_id, event_type, source, reason) + timestamp tự sinh, không thêm 1
// map "extra fields" tuỳ ý (transport-core's Logger.h giải thích rõ lý do:
// tránh vô tình log lọt dữ liệu nhạy cảm/bearer-token qua field tự do).

export interface LogEvent {
  channel_id: string;
  event_type: string;
  // optional; vd địa chỉ remote/nguồn kết nối, rỗng nếu không áp dụng
  source?: string;
  // optional; vd lý do reject/chi tiết state change, rỗng nếu không áp dụng
  reason?: string;
}

export interface Logger {
  log(event: LogEvent): void;
}

// Sink có thể thay thế được (mặc định: 1 dòng ra stderr, giống
// transport_core::logging::defaultLogger() ghi ra std::clog) - test dùng 1
// FakeLogger triển khai trực tiếp interface Logger, không cần override sink
// này.
export class JsonLinesLogger implements Logger {
  constructor(private readonly writeLine: (line: string) => void = defaultWriteLine) {}

  log(event: LogEvent): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      channel_id: event.channel_id,
      event_type: event.event_type,
      source: event.source ?? '',
      reason: event.reason ?? '',
    });
    this.writeLine(line);
  }
}

function defaultWriteLine(line: string): void {
  // Code review: dashboard-backend chạy 24/7 dưới dạng Windows Service -
  // logging tự nó KHÔNG được phép làm crash service (vd stderr bị đóng/EPIPE
  // vì winsw đang xoay log file, hoặc console bị đóng đột ngột). Nuốt lỗi ở
  // đây có chủ đích - không có nơi nào khác an toàn hơn để báo lỗi ghi log.
  try {
    process.stderr.write(line + '\n');
  } catch {
    // intentionally swallowed - xem comment trên
  }
}

let singleton: Logger | undefined;

// Process-wide default logger - mirror transport_core::logging::defaultLogger().
export function defaultLogger(): Logger {
  singleton ??= new JsonLinesLogger();
  return singleton;
}
