// Code review [patch]: `AUDIO_LEVEL_MIN_DBFS`/`AUDIO_LEVEL_MAX_DBFS` (-60/0)
// từng định nghĩa lặp lại độc lập ở `ChannelGridCell.tsx` và
// `channelAudioLevels.ts` - cùng loại trùng lặp mà PR gốc đã fix cho thuật
// toán hash (xem `hashString.ts`). Gom về 1 module dùng chung để tránh lệch
// thang đo nếu sau này đổi khoảng hiển thị dBFS mà chỉ sửa 1 bản.
//
// Boundaries: "Thang đo audioLevel: dBFS, khoảng hiển thị cố định -60 -> 0
// dBFS" - hằng số này là nguồn duy nhất cho cả mapping dBFS->% (component)
// lẫn clamp của fixture giả lập real-time.
export const AUDIO_LEVEL_MIN_DBFS = -60;
export const AUDIO_LEVEL_MAX_DBFS = 0;
