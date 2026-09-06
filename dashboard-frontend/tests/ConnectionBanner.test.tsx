// Story 2.7: `ConnectionBanner` - I/O matrix "WS UI đứt"/"WS UI phục hồi".

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConnectionBanner } from '../src/components/ConnectionBanner';

afterEach(cleanup);

describe('ConnectionBanner', () => {
  it('connectionStatus="connected" -> KHÔNG render gì (ẩn hoàn toàn)', () => {
    render(<ConnectionBanner connectionStatus="connected" lastConnectedAt="2026-09-06T08:15:00.000Z" />);
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });

  it('connectionStatus="disconnected" -> render banner, role="alert"', () => {
    render(<ConnectionBanner connectionStatus="disconnected" lastConnectedAt="2026-09-06T08:15:00.000Z" />);
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
  });

  // Code review: `formatHHmm` hiển thị giờ ĐỊA PHƯƠNG (wall-clock của đội
  // trực, không phải UTC) - test tính giá trị kỳ vọng qua CHÍNH `Date` API
  // (getHours/getMinutes) thay vì hard-code 1 giờ UTC cụ thể, để không phụ
  // thuộc múi giờ của máy chạy test (CI có thể ở múi giờ khác máy dev).
  it('lastConnectedAt hợp lệ -> hiện đúng giờ:phút ĐỊA PHƯƠNG dạng HH:mm', () => {
    const iso = '2026-09-06T08:05:00.000Z';
    const expected = new Date(iso);
    const expectedText = `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`;
    render(<ConnectionBanner connectionStatus="disconnected" lastConnectedAt={iso} />);
    expect(screen.getByTestId('connection-banner')).toHaveTextContent(expectedText);
  });

  it('lastConnectedAt=null (chưa từng connect) -> fallback "--:--", không crash', () => {
    render(<ConnectionBanner connectionStatus="disconnected" lastConnectedAt={null} />);
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('--:--');
  });

  it('lastConnectedAt là chuỗi ISO không hợp lệ (dữ liệu hỏng) -> fallback "--:--", không crash', () => {
    render(<ConnectionBanner connectionStatus="disconnected" lastConnectedAt="khong-phai-iso" />);
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('--:--');
  });
});
