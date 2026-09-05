// Story 2.3 (Boundaries): "Next.js App Router chỉ bọc ngoài 1 page duy nhất."
// Layout này CHỈ set up shell HTML + design tokens (`globals.css` import
// `src/styles/tokens.css`) - không có logic dữ liệu kênh nào ở đây (đó là
// `app/page.tsx`'s client component).

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'VTCDigital - Giám sát truyền dẫn',
  description: 'Lưới tổng quan 20 kênh truyền dẫn SDI->SRT->SDI',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
