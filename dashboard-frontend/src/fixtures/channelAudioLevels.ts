// Story 2.5: fixture giả lập `audioLevel` dao động theo thời gian dùng cho
// `app/page.tsx` (Boundaries: "dữ liệu audioLevel nguồn từ fixture MỚI dùng ở
// page.tsx, hàm thuần túy (không Math.random thật) để test được - không
// đọc/sửa uiWsClient.ts/channelStore.ts"). Never: "nối WebSocket/backend thật
// cho audioLevel" (chưa có story nào định nghĩa forward audioLevel qua
// WS-UI).
//
// Design Notes: "computeAudioLevelFixture nhận elapsedSeconds làm tham số
// (không tự đọc Date.now() bên trong) để hàm thuần túy, test được bằng giá
// trị cố định; page.tsx tự truyền elapsedSeconds từ interval."

import { hashString } from './hashString';

// Thang cố định -60..0 dBFS, khớp `ChannelGridCell.tsx`'s mapping dBFS->%
// (Boundaries: "khoảng hiển thị cố định -60 -> 0 dBFS").
const AUDIO_LEVEL_MIN_DBFS = -60;
const AUDIO_LEVEL_MAX_DBFS = 0;

// Biên độ dao động quanh baseline riêng/kênh - giá trị demo, không có ý nghĩa
// nghiệp vụ nào ngoài việc tạo chuyển động trực quan giả lập real-time.
const OSCILLATION_AMPLITUDE_DB = 15;
const RIGHT_CHANNEL_PHASE_OFFSET = Math.PI / 4;

// Code review [patch, finding #2]: baseline PHẢI nằm trong khoảng AN TOÀN
// [MIN + AMPLITUDE, MAX - AMPLITUDE] = [-45, -15] cho MỌI giá trị hash, để
// `baseline ± AMPLITUDE` không bao giờ vượt [MIN, MAX] trong điều kiện bình
// thường (clampDbfs bên dưới chỉ còn là phòng thủ lớp 2, không phải cơ chế
// chính chặn baseline sát biên). Công thức cũ `-60 + (hash % 40)` cho baseline
// tới -60, khiến ~37.5% kênh có baseline < -45 và bị clamp phẳng đáy trong
// một phần đáng kể chu kỳ sin - sai với ý đồ "dao động mượt liên tục".
const BASELINE_SAFE_MIN_DBFS = AUDIO_LEVEL_MIN_DBFS + OSCILLATION_AMPLITUDE_DB; // -45
const BASELINE_SAFE_RANGE_DB = AUDIO_LEVEL_MAX_DBFS - OSCILLATION_AMPLITUDE_DB - BASELINE_SAFE_MIN_DBFS; // 30

function clampDbfs(value: number): number {
  return Math.min(AUDIO_LEVEL_MAX_DBFS, Math.max(AUDIO_LEVEL_MIN_DBFS, value));
}

// Hàm thuần: cùng (channelId, elapsedSeconds) luôn ra đúng 1 kết quả - test
// được bằng giá trị cố định (Design Notes), KHÔNG Math.random/Date.now()
// thật (Boundaries).
export function computeAudioLevelFixture(
  channelId: string,
  elapsedSeconds: number,
): readonly [number, number] {
  const hash = hashString(channelId);
  // Baseline riêng/kênh, LUÔN trong [-45, -16] (xem finding #2 ở trên) - biên
  // độ dao động ±15dB quanh baseline không bao giờ chạm/clamp phẳng ở
  // trần/đáy thang đo trong điều kiện bình thường.
  const baseline = BASELINE_SAFE_MIN_DBFS + (hash % BASELINE_SAFE_RANGE_DB);
  const phase = ((hash % 100) / 100) * Math.PI * 2;

  const left = clampDbfs(baseline + Math.sin(elapsedSeconds + phase) * OSCILLATION_AMPLITUDE_DB);
  const right = clampDbfs(
    baseline + Math.sin(elapsedSeconds + phase + RIGHT_CHANNEL_PHASE_OFFSET) * OSCILLATION_AMPLITUDE_DB,
  );
  return [left, right];
}
