# dashboard-frontend

Story 2.3: lưới tổng quan 20 kênh cố định vị trí (cold-load) - Next.js (App
Router, 1 page duy nhất) + React 19.2 + TypeScript. Toàn bộ dữ liệu kênh đến
qua WebSocket client-side (kết nối tới WS UI server MỚI của dashboard-backend,
`src/adapters/outbound/wsUiAdapter.ts`) - không có server-side data
fetching/SSR nào cho dữ liệu kênh. Design tokens (dark-only, khớp
`DESIGN.md`) tại `src/styles/tokens.css`. Xem
`_bmad-output/implementation-artifacts/spec-2-3-design-tokens-lưới-tổng-quan-cố-định-vị-trí-cold-load.md`
cho đầy đủ Intent/Boundaries/I-O matrix (spec là nguồn sự thật, tài liệu này
chỉ tóm tắt phần vận hành).

## Cài đặt

```bash
npm install
npm run build   # Next.js production build
npm test        # Vitest + @testing-library/react
```

## Chạy dev

```bash
npm run dev     # http://localhost:3000, cần dashboard-backend đang chạy song song
```

`npm run start` chạy bản production đã `npm run build` (mirror `next start`).

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_DASHBOARD_UI_WS_URL` | không | `ws://localhost:8081` | URL WebSocket của WS UI server phía dashboard-backend (`wsUiAdapter.ts`, cổng riêng `DASHBOARD_UI_WS_PORT`, KHÔNG auth - LAN-only). Khi deploy LAN thật, đặt biến này trỏ đúng host:port của dashboard-backend (vd `ws://10.0.1.5:8081`) - đây là biến `NEXT_PUBLIC_*` nên được nhúng vào bundle lúc `npm run build`, phải set TRƯỚC khi build cho đúng môi trường đích. |

Đọc trong `app/page.tsx` lúc kết nối `connectUiWsClient` - nếu URL cấu hình
sai định dạng, `connectUiWsClient` bắt lỗi tạo `WebSocket` (log
`console.error`, không throw ra ngoài `useEffect`), tránh crash trắng toàn bộ
trang.

## Kiến trúc thư mục

Theo ARCHITECTURE-SPINE's Structural Seed (`dashboard-frontend/src/`):

- `src/components/` - `ChannelGrid`, `ChannelGridCell` (Story 2.3); các
  component khác (`detail-panel`, `alert-badge`, `vu-meter`, `ack-label`,
  `connection-banner`) thuộc các story sau.
- `src/state/` - `channelStore.ts`: store 20 kênh (registry-snapshot +
  channel-seen), render thuần trạng thái đã tính sẵn từ backend, không tự
  suy luận state.
- `src/services/` - `uiWsClient.ts`: WebSocket client tới dashboard-backend.
- `src/styles/tokens.css` - design tokens dark-only (màu/typography/
  spacing/rounded), copy đúng giá trị `DESIGN.md`.

`app/` chỉ đóng vai trò build/dev-server của Next.js + 1 `app/page.tsx` lắp
ráp component gốc DUY NHẤT - không có route nào khác (không file-based
routing đa trang).

## Trạng thái cold-load

Khi vừa mở, `ChannelGrid` render đủ số ô theo `registry-snapshot` (20 trong
triển khai thật) ở trạng thái `skeleton`; từng ô chuyển sang `loaded-neutral`
ngay khi backend phát `channel-seen` cho kênh đó (~1-2 giây/kênh có telemetry,
không chờ đủ 20 kênh). Vị trí ô lấy tuyệt đối từ `grid_position` trong
`registry-snapshot` (`Math.floor(pos/5)`/`pos%5`), không phụ thuộc thứ tự
event. Màu/badge trạng thái (`ok`/`warning`/`critical`) thuộc Story 2.4, chưa
có ở story này.
