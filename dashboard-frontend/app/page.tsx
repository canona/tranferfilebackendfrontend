// Story 2.3: màn hình gốc DUY NHẤT (Boundaries: "Next.js App Router chỉ bọc
// ngoài 1 page duy nhất"). Client Component ('use client') - toàn bộ dữ liệu
// kênh đến qua WS client-side (Never: "Server-side data fetching/SSR cho dữ
// liệu kênh ở Next.js"), không fetch gì ở server.

'use client';

import { useEffect, useMemo } from 'react';
import { ChannelGrid } from '../src/components/ChannelGrid';
import { createChannelStore, useChannelStore } from '../src/state/channelStore';
import { connectUiWsClient } from '../src/services/uiWsClient';
import { buildChannelDisplayStatesFixture } from '../src/fixtures/channelDisplayStates';

// WS UI server mới (`wsUiAdapter.ts`, `DASHBOARD_UI_WS_PORT`, mặc định 8081
// theo `app/main.ts` phía dashboard-backend) - override qua biến môi trường
// build-time `NEXT_PUBLIC_DASHBOARD_UI_WS_URL` khi deploy LAN thật (host khác
// localhost).
const DEFAULT_UI_WS_URL = 'ws://localhost:8081';

export default function Page() {
  const store = useMemo(() => createChannelStore(), []);
  const state = useChannelStore(store);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_DASHBOARD_UI_WS_URL ?? DEFAULT_UI_WS_URL;
    const disconnect = connectUiWsClient(url, store);
    return disconnect;
  }, [store]);

  // Story 2.4: fixture giả lập (KHÔNG nối WebSocket/channelStore thật cho
  // displayState - đó là Story 2.6) - trộn ok/warning/critical theo channelId
  // đang hiển thị, tính lại mỗi khi danh sách kênh đổi (registry-snapshot mới
  // hoặc chuyển từ placeholder cold-load sang kênh thật).
  const channelDisplayStates = useMemo(
    () => buildChannelDisplayStatesFixture(state.channels.map((channel) => channel.channelId)),
    [state.channels],
  );

  return (
    <ChannelGrid
      channels={state.channels}
      seenChannelIds={state.seenChannelIds}
      channelDisplayStates={channelDisplayStates}
    />
  );
}
