# dashboard-backend

Story 2.1: ranh giới telemetry thô (transport-core) -> trạng thái hiển thị đã
tính (`ok`/`warning`/`critical`). Hexagonal core + adapter inbound WS + adapter
outbound log tạm. Story 2.2: nguồn liệt kê `channel_id`/vị trí lưới chính
thức - `ChannelRegistryPort` hot-reload từ 1 file JSON, không cần restart
process. Xem
`_bmad-output/implementation-artifacts/spec-2-1-dashboard-backend-...md` và
`spec-2-2-channel-registry-hot-reload-...md` cho đầy đủ Intent/Boundaries/I-O
matrix (spec là nguồn sự thật, tài liệu này chỉ tóm tắt phần vận hành). Story
4.2 (đẩy cảnh báo Telegram khi kênh chuyển `warning`, thêm 2 biến môi trường
Telegram + hành vi fail-fast mới bên dưới): xem
`_bmad-output/implementation-artifacts/spec-4-2-đẩy-telegram-cho-mức-chú-ý-abr-warning-tới-đội-trực.md`.

## Cài đặt

```bash
npm install
npm run build
npm test
```

## Biến môi trường

Đọc bởi `app/main.ts` (`startApp()`) lúc khởi động (`npm start` /
`node dist/app/main.js`):

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `DASHBOARD_WS_PORT` | không | `8080` | Port TCP cho WS server nhận telemetry từ máy trung tâm. Phải là số nguyên 0-65535 (`0` = để OS tự cấp port trống) - giá trị khác sẽ bị từ chối với lỗi khởi động rõ ràng, không âm thầm lọt qua. |
| `DASHBOARD_WS_HOST` | không | `0.0.0.0` | Địa chỉ bind của WS server. |
| `DASHBOARD_BEARER_TOKENS` | **có** (thực tế) | *(rỗng)* | Danh sách bearer-token hợp lệ, phân tách bởi dấu phẩy - 1 token/máy trung tâm (AD-13). Để trống thì mọi kết nối WS đều bị reject 401 (an toàn theo mặc định, nhưng vô dụng cho production - luôn phải set). |
| `DASHBOARD_CHANNEL_REGISTRY_FILE` | không | `config/channel-registry.json` | Đường dẫn tới file JSON channel-registry `{channel_id: {station_name, contact_name, contact_phone, grid_position, baseline_kbps}}` - nguồn liệt kê `channel_id` hợp lệ DUY NHẤT + dữ liệu dùng để tính `bitrate_pct`/render lưới. **KHÔNG** mặc định vào `channel-registry.example.json` (dữ liệu demo) - xem mục dưới. |
| `DASHBOARD_TELEGRAM_BOT_TOKEN` | **có** | *(không có)* | Bot token Telegram (Story 4.2) dùng để đẩy cảnh báo `warning` (ABR hạ bitrate) tới 1 chat chung của đội trực sóng. Thiếu/rỗng -> fail-fast lúc khởi động, không âm thầm start thiếu kênh cảnh báo này. |
| `DASHBOARD_TELEGRAM_CHAT_ID` | **có** | *(không có)* | `chat_id` Telegram của đội trực sóng (Story 4.2, AD-17) - 1 chat chung DUY NHẤT, không gửi lãnh đạo. Thiếu/rỗng -> fail-fast lúc khởi động cùng lý do với `DASHBOARD_TELEGRAM_BOT_TOKEN`. |

## Tạo `config/channel-registry.json` (channel-registry THẬT)

`config/channel-registry.example.json` chỉ là file MẪU (2 channel_id rõ ràng
là ví dụ: `example-channel-01`, `example-channel-02`) - **không dùng trực
tiếp cho production**. `ChannelRegistryPort`/`FileChannelRegistryAdapter`
(Story 2.2) đọc 1 file JSON tĩnh dạng:

```json
{
  "channel_id": {
    "station_name": "...",
    "contact_name": "...",
    "contact_phone": "...",
    "grid_position": 0,
    "baseline_kbps": 4000
  }
}
```

- `station_name`/`contact_name`/`contact_phone`: string non-empty.
- `grid_position`: số nguyên 0-19 (row-major, 5 cột x 4 hàng), KHÔNG được
  trùng giữa các kênh trong cùng file.
- `baseline_kbps`: số hữu hạn > 0 (đơn vị kbps), dùng để tính `bitrate_pct`.

Toàn bộ file bị từ chối nếu >=1 entry sai định dạng trên (không load một
phần).

Trước khi chạy dashboard-backend thật:

```bash
cp config/channel-registry.example.json config/channel-registry.json
# rồi sửa config/channel-registry.json: điền đúng channel_id (mã đài cố định,
# khớp EventEnvelope.channel_id transport-core gửi lên) và metadata/
# baseline_kbps thật của từng kênh.
```

`config/channel-registry.json` bị `.gitignore` - đây là dữ liệu vận hành
riêng của từng lần deploy, không commit vào repo.

**Khởi động:** lỗi đọc/parse/validate (thiếu file/JSON hỏng/entry sai) ->
`startApp()` **fail-fast** ngay lúc khởi động với 1 thông báo lỗi nêu rõ
đường dẫn đã resolve + gợi ý copy từ file example ở trên - không bao giờ âm
thầm rơi về dữ liệu demo.

**Hot-reload (đang chạy):** dashboard-backend watch file này bằng `chokidar`
(debounce >=300ms) - sửa file (thêm/sửa 1 kênh) áp dụng ngay, **không
cần restart process**, các kênh khác không bị gián đoạn. Nội dung mới không
hợp lệ -> registry cũ được giữ nguyên, log 1 dòng `registry_reload_error`
(không throw/crash); nội dung mới hợp lệ -> log `registry_reload_success`.
Nếu bản thân watcher gặp lỗi hệ thống (file bị xoá, đổi quyền, filesystem
không hỗ trợ...) -> log `registry_watch_error`, registry đang phục vụ giữ
nguyên, không throw/crash.

Nếu 1 `telemetry` đến với `channel_id` không có trong channel-registry:
dashboard-backend log 1 dòng `channel_unregistered` rõ ràng và bỏ qua đúng
lần telemetry đó (không throw, không tự chọn 1 kênh/baseline mặc định thay).

## Windows Service

`app/installService.ts` đăng ký dashboard-backend như 1 Windows Service thật
qua `node-windows` (wrapper `winsw.exe`, auto-restart khi crash - xem Design
Notes trong spec).

```bash
npm run build              # bắt buộc trước - installService kiểm tra
                            # dist/app/main.js tồn tại, báo lỗi rõ nếu chưa build
npm run service:install    # cần quyền Administrator
npm run service:uninstall  # cần quyền Administrator
```

`node-windows` nằm trong `optionalDependencies` (không chặn `npm install`/
`npm run build`/`npm test` nếu vì lý do gì đó không cài được) và chỉ được
`import()` LAZY bên trong 2 lệnh trên - không ảnh hưởng phần còn lại của
dashboard-backend.

Sau khi cài, service tự start; kiểm tra trong `services.msc` hoặc
`net start "DashboardBackend"` / `net stop "DashboardBackend"`. Auto-restart
khi crash do winsw tự giám sát tiến trình con (không phải SCM recovery action
native) - kill process để xác nhận winsw tự khởi động lại là bước kiểm tra
thủ công duy nhất chưa tự động hoá được (xem Verification/Manual checks trong
spec).
