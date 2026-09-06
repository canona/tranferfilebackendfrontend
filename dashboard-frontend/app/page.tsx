// Story 2.3: màn hình gốc DUY NHẤT (Boundaries: "Next.js App Router chỉ bọc
// ngoài 1 page duy nhất"). Client Component ('use client') - toàn bộ dữ liệu
// kênh đến qua WS client-side (Never: "Server-side data fetching/SSR cho dữ
// liệu kênh ở Next.js"), không fetch gì ở server.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChannelGrid } from '../src/components/ChannelGrid';
import { ConnectionBanner } from '../src/components/ConnectionBanner';
import { createChannelStore, useChannelStore } from '../src/state/channelStore';
import { connectUiWsClient } from '../src/services/uiWsClient';
import { computeAudioLevelFixture } from '../src/fixtures/channelAudioLevels';
import styles from './page.module.css';

// WS UI server mới (`wsUiAdapter.ts`, `DASHBOARD_UI_WS_PORT`, mặc định 8081
// theo `app/main.ts` phía dashboard-backend) - override qua biến môi trường
// build-time `NEXT_PUBLIC_DASHBOARD_UI_WS_URL` khi deploy LAN thật (host khác
// localhost).
const DEFAULT_UI_WS_URL = 'ws://localhost:8081';

// Story 2.5: tick giả lập real-time cho `audioLevel` (Boundaries: "KHÔNG nối
// WebSocket/backend thật cho audioLevel"). ~300ms đủ mượt để thấy dao động
// trên vu-meter mà không tạo tải re-render quá dày.
const AUDIO_LEVEL_TICK_MS = 300;

export default function Page() {
  const store = useMemo(() => createChannelStore(), []);
  const state = useChannelStore(store);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_DASHBOARD_UI_WS_URL ?? DEFAULT_UI_WS_URL;
    const disconnect = connectUiWsClient(url, store);
    return disconnect;
  }, [store]);

  // Story 2.5: fixture audioLevel dao động theo thời gian (Boundaries: "hàm
  // thuần, độc lập hoàn toàn displayState/debounce" - đây là state RIÊNG,
  // không dùng chung useEffect/useMemo với `state.channelDisplayStates` (Story
  // 2.6: đọc thẳng từ store, không còn tính qua fixture/useMemo local nào).
  // `elapsedSeconds` tự tính từ mốc mount (Date.now() CHỈ đọc ở page.tsx,
  // KHÔNG bên trong computeAudioLevelFixture - Design Notes) qua interval
  // ~300ms, cleanup khi unmount.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - startedAt) / 1000);
    }, AUDIO_LEVEL_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const channelAudioLevels = useMemo(() => {
    const map = new Map<string, readonly [number, number]>();
    for (const channel of state.channels) {
      map.set(channel.channelId, computeAudioLevelFixture(channel.channelId, elapsedSeconds));
    }
    return map;
  }, [state.channels, elapsedSeconds]);

  // Story 2.7: `ConnectionBanner` (full-width, trên mọi layer) + `grid-overlay`
  // (phủ CHÍNH `channel-grid` khi disconnected, DESIGN.md's `connection-banner`
  // dòng 227) - overlay là 1 div riêng đè lên `ChannelGrid` (KHÔNG tự nội
  // suy/đổi số liệu bên dưới, số liệu tự đứng yên vì không còn message mới
  // tới - Boundaries).
  return (
    <>
      <ConnectionBanner connectionStatus={state.connectionStatus} lastConnectedAt={state.lastConnectedAt} />
      <div className={styles.gridWrapper}>
        <ChannelGrid
          channels={state.channels}
          seenChannelIds={state.seenChannelIds}
          channelDisplayStates={state.channelDisplayStates}
          channelAudioLevels={channelAudioLevels}
          channelMachineOffline={state.channelMachineOffline}
        />
        {state.connectionStatus === 'disconnected' ? (
          <div className={styles.gridOverlay} data-testid="grid-overlay" aria-hidden="true" />
        ) : null}
      </div>
    </>
  );
}
