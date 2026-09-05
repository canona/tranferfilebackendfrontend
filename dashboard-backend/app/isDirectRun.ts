// Code review [DRY]: `main.ts` và `installService.ts` đều cần biết "file này
// có đang được chạy trực tiếp (`node dist/app/xxx.js`) hay chỉ đang bị
// import (test, hoặc file kia import lẫn nhau)" - logic so sánh
// `process.argv[1]` với `import.meta.url` bị lặp y hệt ở 2 nơi trước đây,
// tách ra 1 helper dùng chung để tránh lệch nhau nếu 1 bên sửa mà quên bên kia.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `moduleUrl` truyền vào phải là `import.meta.url` của chính file gọi hàm
// này - không tự đọc `import.meta.url` bên trong helper vì nó sẽ luôn trỏ
// tới file này (isDirectRun.ts), không phải file caller.
export function isDirectRunEntrypoint(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}
