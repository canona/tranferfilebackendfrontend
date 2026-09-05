// Story 2.2: thay `BitrateBaselinePort` (Story 2.1) - tên đúng theo
// ARCHITECTURE-SPINE `ports/` (`BitrateBaselinePort` chỉ là interface tạm
// của riêng Story 2.1, không nằm trong danh sách port kiến trúc chính thức).
//
// Registry là nguồn xác thực `channel_id` hợp lệ DUY NHẤT (Intent) - không
// chỉ tra `baseline_kbps` như port cũ, mà trả về đầy đủ record 1 kênh (bao
// gồm metadata dùng cho Epic 2-3/detail-panel: station_name/contact_name/
// contact_phone/grid_position). Vẫn giữ đúng tinh thần "1 method, không tự ý
// thêm method riêng cho baseline" (Boundaries) - `getEntry()` là điểm truy
// vấn duy nhất, `undefined` nghĩa là channel_id CHƯA ĐĂNG KÝ trong registry
// (khác `baseline_missing` cũ của Story 2.1 - naming đổi thành
// `channel_unregistered` ở `channelState.ts`).
//
// `src/adapters/outbound/fileChannelRegistryAdapter.ts` là adapter thật duy
// nhất implement port này (hot-reload từ 1 file JSON, xem Design Notes/
// Boundaries của spec Story 2.2).

export interface ChannelRegistryEntry {
  stationName: string;
  contactName: string;
  contactPhone: string;
  // Số nguyên 0-19 (row-major, 5 cột x 4 hàng) - KHÔNG phải {row, col}. Xem
  // Design Notes spec Story 2.2: quyết định kỹ thuật trong phạm vi story
  // này, Story 2.3 tự suy `Math.floor(pos/5)`/`pos%5`.
  gridPosition: number;
  baselineKbps: number;
}

export interface ChannelRegistryPort {
  // Trả về `undefined` khi channel_id không có trong registry hiện tại -
  // KHÔNG bao giờ trả về 1 giá trị fallback ngầm định. Registry là nguồn
  // liệt kê channel_id hợp lệ DUY NHẤT (Intent) - `undefined` ở đây nghĩa là
  // "kênh chưa đăng ký", caller (`channelState.ts`) log `channel_unregistered`
  // và bỏ qua, không tự chọn chính sách khác.
  getEntry(channelId: string): ChannelRegistryEntry | undefined;

  // Story 2.3 (Boundaries): nguồn dữ liệu DUY NHẤT cho `registry-snapshot`
  // gửi lúc dashboard-frontend cold-load - liệt kê TOÀN BỘ kênh đang đăng ký
  // (đủ 20 trong triển khai thật) kèm `channelId` (record của `getEntry()`
  // không tự mang channel_id, phải gắn thêm ở đây). CHỈ thêm method này -
  // không đổi signature/hành vi `getEntry()` hiện có (Boundaries "Always").
  listEntries(): ReadonlyArray<ChannelRegistryEntry & { channelId: string }>;
}
