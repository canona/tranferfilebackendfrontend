// Bổ sung video-preview thật (AD-22): hexagonal outbound port MỚI, tách biệt
// hoàn toàn khỏi `UiOutboundPort`/`AlertOutboundPort` (mirror lý do
// `UiOutboundPort.ts` đã tách khỏi `AlertOutboundPort` ở Story 2.3 - mỗi
// semantic/timing khác nhau dùng 1 port riêng, tránh trộn lẫn). Gọi bởi
// `src/core/snapshotRelay.ts`'s `SnapshotRelayService` mỗi khi 1 snapshot hợp
// lệ (channel_id đã đăng ký) vừa nhận được - KHÔNG debounce, KHÔNG mapping,
// forward thô đúng nhịp transport-core tự gửi (~1.5s/kênh khi CONNECTED).
//
// Adapter thật duy nhất implement port này là
// `src/adapters/outbound/wsUiAdapter.ts` (cùng 1 object implement CẢ
// `UiOutboundPort`/`AlertOutboundPort`/`SnapshotOutboundPort` - mirror cách
// `WsUiAdapterHandle` đã implement 2 port trên 1 kết nối WS UI duy nhất).

export interface SnapshotOutboundPort {
  // `imageBase64`: forward nguyên văn từ `SnapshotInboundPort.handleSnapshot`
  // - adapter implement port này KHÔNG được diễn giải/xử lý ảnh (AD-22).
  publishSnapshot(channelId: string, imageBase64: string, timestamp: string): void;
}
