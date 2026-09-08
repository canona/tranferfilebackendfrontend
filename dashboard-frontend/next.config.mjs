/** @type {import('next').NextConfig} */
// Boundaries: "Server-side data fetching/SSR cho dữ liệu kênh ở Next.js -
// toàn bộ qua WS client-side." Next.js ở đây CHỈ đóng vai trò build/dev-
// server + 1 app/page.tsx lắp ráp component (Design Notes) - không cấu hình
// gì thêm ngoài mặc định.
const nextConfig = {
  reactStrictMode: true,
  // Truy cập dev-server qua IP LAN (không phải localhost) để xem trên nhiều
  // máy/màn hình — Next.js 15+ chặn HMR/asset request từ origin lạ theo mặc
  // định (bảo mật). Thêm đúng IP LAN của máy chạy `npm run dev` vào đây nếu
  // đổi máy/IP.
  allowedDevOrigins: ['192.168.121.21'],
};

export default nextConfig;
