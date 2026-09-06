// Code review [patch, finding #6]: thuật toán hash chuỗi (`hash * 31 +
// charCodeAt`) bị copy-paste giống hệt độc lập ở `channelAudioLevels.ts` và
// `ChannelGridCell.tsx` (thumbnail) - trích xuất về 1 nơi để dùng chung, tránh
// lệch hành vi nếu sau này chỉ sửa 1 bản. (`channelDisplayStates.ts` cũng
// từng dùng bản copy-paste này nhưng đã bị xoá ở Story 2.6, thay bằng dữ liệu
// thật qua WebSocket.)
//
// Hash chuỗi đơn giản, deterministic, thuần theo nội dung `s` (không phụ
// thuộc runtime/môi trường) - đủ dùng cho mục đích demo/fixture/placeholder
// thị giác, KHÔNG cần chống collision mật mã học.
export function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
