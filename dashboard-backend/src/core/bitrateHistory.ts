// Story 3.1: ring buffer in-memory ~15 phút/kênh cho lịch sử bitrate (Never/
// AD-14: KHÔNG time-series DB/lưu đĩa cho MVP#1). Thuần domain logic - KHÔNG
// import ws/fs/network (Boundaries "src/core hoàn toàn thuần"), test được
// bằng fake `Clock` injectable (mirror `ChannelStateServiceOptions`).

import type { BitrateHistoryPoint, HistoryPort, HistoryQueryResult } from '../ports/HistoryPort.js';

// Intent: "Retention ~15 phút/kênh: mẫu cũ hơn 15 phút bị loại bỏ dần mỗi lần
// ghi mới cho đúng kênh đó (không cần timer riêng)".
export const HISTORY_RETENTION_MS = 15 * 60 * 1000;

// Code review [patch]: `BitrateHistoryServiceOptions`/field `clock` đã bị xoá
// hẳn - dead code, không method nào (`recordBitrate`/`getHistory`) từng đọc
// `this.clock`; `recordBitrate` chỉ dùng tham số `timestampMs` do caller
// (`channelState.ts`) truyền vào - timestamp nhất quán đã đạt được hoàn toàn
// nhờ `channelState.ts` truyền thẳng `this.clock.now()` làm tham số đó, không
// nhờ `BitrateHistoryService` tự có clock riêng. Không còn options nào khác -
// bỏ luôn constructor tuỳ biến, dùng default constructor (`new
// BitrateHistoryService()`).
export class BitrateHistoryService implements HistoryPort {
  // Map<channelId, mẫu theo thứ tự thời gian TĂNG DẦN> - mirror `channels` Map
  // ở `channelState.ts:79` (keyed channelId, không có timer riêng dọn kênh
  // chết - Never: "chấp nhận rò rỉ bounded tối đa ~15 phút dữ liệu cho kênh
  // ngừng gửi hẳn, tương tự cách `channels` Map hiện có không tự xoá kênh
  // chết").
  private readonly history = new Map<string, BitrateHistoryPoint[]>();

  recordBitrate(channelId: string, bitratePct: number, timestampMs: number): void {
    const points = this.history.get(channelId) ?? [];
    points.push({ timestampMs, bitratePct });

    // Trim mẫu cũ hơn retention window - tính theo `timestampMs` của mẫu vừa
    // ghi (không phải `this.clock.now()` riêng - cùng 1 giá trị, tránh gọi
    // clock 2 lần/mismatch nếu caller truyền timestampMs khác thời điểm gọi
    // thực tế, vd test dồn nhiều mẫu cùng 1 lượt).
    // "cũ hơn 15 phút" = strictly older than retention - 1 mẫu đúng tuổi
    // retention (age === HISTORY_RETENTION_MS) vẫn được giữ.
    const cutoff = timestampMs - HISTORY_RETENTION_MS;
    let firstKeepIndex = 0;
    while (firstKeepIndex < points.length && points[firstKeepIndex]!.timestampMs < cutoff) {
      firstKeepIndex++;
    }
    const trimmed = firstKeepIndex > 0 ? points.slice(firstKeepIndex) : points;

    this.history.set(channelId, trimmed);
  }

  getHistory(channelId: string): HistoryQueryResult {
    const points = this.history.get(channelId);
    if (points === undefined || points.length === 0) {
      // Intent: "no-history-data khi kênh chưa từng có mẫu nào được ghi" -
      // KHÔNG phải mảng rỗng/giá trị 0 (tránh hiểu nhầm bitrate=0 là sự cố).
      return { state: 'no-history-data' };
    }
    // Code review [patch]: `points` là CHÍNH mảng nội bộ trong `this.history` -
    // trả thẳng nó phá vỡ ngữ nghĩa snapshot-tại-thời-điểm-gọi mà kiểu
    // `readonly BitrateHistoryPoint[]` ngụ ý (lần `recordBitrate()` kế tiếp
    // cho đúng channelId này `.push()` vào CHÍNH mảng đó, âm thầm phình to
    // `data` mà 1 caller đã giữ lại từ lần gọi trước). Trả bản sao.
    // Code review [patch, round 2]: copy nông mảng (`[...points]`) chỉ tạo
    // mảng mới - các phần tử bên trong vẫn là CHÍNH các object điểm dữ liệu
    // nằm trong `this.history`; sửa 1 field trên 1 điểm đã lấy ra (vd
    // `data[0].bitratePct = ...`) vẫn âm thầm làm hỏng dữ liệu nội bộ. Copy
    // từng điểm (`{ ...p }`) để `data` hoàn toàn độc lập với state nội bộ.
    return { state: 'loaded', data: points.map((p) => ({ ...p })) };
  }

  // spec-epic2-item-10-12: dọn ring buffer bitrate của 1 channel_id VỪA bị
  // gỡ khỏi channel-registry (hot-reload) - caller duy nhất là `main.ts`'s
  // `registryPort.onEntriesRemoved()` wiring (mirror `channelState.ts`'s
  // `pruneChannel()`).
  pruneChannel(channelId: string): void {
    this.history.delete(channelId);
  }
}
