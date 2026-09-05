/** @type {import('next').NextConfig} */
// Boundaries: "Server-side data fetching/SSR cho dữ liệu kênh ở Next.js -
// toàn bộ qua WS client-side." Next.js ở đây CHỈ đóng vai trò build/dev-
// server + 1 app/page.tsx lắp ráp component (Design Notes) - không cấu hình
// gì thêm ngoài mặc định.
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
