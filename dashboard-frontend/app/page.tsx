// Story 2.3: màn hình gốc DUY NHẤT (Boundaries: "Next.js App Router chỉ bọc
// ngoài 1 page duy nhất"). Client Component ('use client') - toàn bộ dữ liệu
// kênh đến qua WS client-side (Never: "Server-side data fetching/SSR cho dữ
// liệu kênh ở Next.js"), không fetch gì ở server.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChannelGrid } from '../src/components/ChannelGrid';
import { ConnectionBanner } from '../src/components/ConnectionBanner';
import { DetailPanel } from '../src/components/DetailPanel';
import { createChannelStore, useChannelStore } from '../src/state/channelStore';
import { connectUiWsClient } from '../src/services/uiWsClient';
import { playAlertBeep, primeAlertAudioContext, BEEP_DURATION_SEC } from '../src/services/alertSound';
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

  // Story 3.3: `connectUiWsClient` giờ trả về `{ close, sendAckCommand }`
  // (Code Map) - giữ `sendAckCommand` qua `useRef` (không phải state) vì gọi
  // nó không cần trigger re-render, chỉ cần tham chiếu ổn định cho `onAck`
  // truyền xuống `DetailPanel` bên dưới. Mặc định no-op TRƯỚC KHI effect chạy
  // lần đầu (SSR/lần render đầu tiên) - tránh throw nếu 1 sự kiện nào đó gọi
  // ref.current trước khi `useEffect` kịp gán instance thật.
  const sendAckCommandRef = useRef<(channelId: string, operatorLabel: string) => void>(() => {});

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_DASHBOARD_UI_WS_URL ?? DEFAULT_UI_WS_URL;
    const client = connectUiWsClient(url, store);
    sendAckCommandRef.current = client.sendAckCommand;
    return () => {
      client.close();
      sendAckCommandRef.current = () => {};
    };
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

  // Story 4.1 (code review round 1 [patch]): âm báo động tại chỗ (SM-1) -
  // theo dõi `alertSoundToken` (channelStore thuần, chỉ đếm transition thật)
  // và gọi `playAlertBeep()` ở ĐÂY (side-effect trình duyệt tập trung ở
  // page.tsx, mirror `sendAckCommandRef`).
  //
  // So sánh GIÁ TRỊ token (không phải cờ boolean "đã chạy chưa") - 2 lý do:
  // (1) React StrictMode (mặc định `true` ở Next.js App Router, `next dev`)
  // cố ý gọi effect 2 lần lúc mount (setup->cleanup->setup) để lộ side-effect
  // không idempotent; 1 cờ boolean bị "tiêu thụ" ở lần gọi ĐẦU sẽ khiến lần
  // gọi THỨ HAI phát bíp giả dù không có transition thật nào xảy ra (đã xác
  // nhận bằng thực nghiệm ở review round 1) - so sánh token thay vì cờ khiến
  // effect idempotent với chính giá trị token, sống sót qua double-invoke.
  // (2) Nếu React gộp (batch) nhiều lần tăng token thật vào cùng 1 commit
  // (vd 2 kênh cùng chuyển cảnh báo gần như đồng thời), effect chỉ chạy 1
  // lần/commit - phát đúng SỐ LẦN bằng độ lệch token (`delta`) thay vì luôn
  // đúng 1 tiếng, tránh im lặng bỏ sót cảnh báo.
  //
  // Khởi tạo `useRef(state.alertSoundToken)` - đối số khởi tạo của `useRef`
  // CHỈ được dùng ở lần render đầu tiên (React bỏ qua ở mọi lần render sau,
  // kể cả StrictMode double-render) - đúng ngữ nghĩa "mốc token lúc mount",
  // KHÔNG phải "0 cứng" (mount/reconnect có thể có kênh đã warning/critical
  // sẵn nhưng KHÔNG tăng token - `channelStore.ts` - nên token lúc mount có
  // thể khác 0 nếu tái sử dụng cùng 1 store qua re-render, dù thực tế
  // `createChannelStore()` luôn tạo store mới ở `useMemo` phía trên).
  const lastAlertTokenRef = useRef(state.alertSoundToken);
  useEffect(() => {
    const delta = state.alertSoundToken - lastAlertTokenRef.current;
    if (delta <= 0) return;
    lastAlertTokenRef.current = state.alertSoundToken;
    // Code review round 2 [patch]: lệch thời điểm bắt đầu mỗi beep theo
    // `i * BEEP_DURATION_SEC` - khi >=2 transition rơi vào CÙNG 1 commit
    // (delta>1), gọi `playAlertBeep()` không offset sẽ khiến các oscillator
    // cùng tần số/pha khởi động cùng lúc (ctx.currentTime không đổi giữa các
    // lệnh gọi đồng bộ) và chồng lấp thành 1 tiếng to hơn thay vì N tiếng
    // phân biệt được (Review Findings round 1).
    for (let i = 0; i < delta; i += 1) {
      playAlertBeep(i * BEEP_DURATION_SEC);
    }
  }, [state.alertSoundToken]);

  // Story 4.1: "prime" AudioContext ngay lần tương tác đầu tiên của người
  // dùng - trình duyệt giữ AudioContext mới tạo ở trạng thái 'suspended' cho
  // tới khi có gesture (Design Notes: rủi ro autoplay). `{once:true}` tự gỡ
  // listener sau lần đầu, không cần cleanup thủ công lúc unmount.
  useEffect(() => {
    const prime = () => primeAlertAudioContext();
    document.addEventListener('pointerdown', prime, { once: true });
    document.addEventListener('keydown', prime, { once: true });
    return () => {
      document.removeEventListener('pointerdown', prime);
      document.removeEventListener('keydown', prime);
    };
  }, []);

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
          channelSnapshots={state.channelSnapshots}
          channelAck={state.channelAck}
          onSelect={(channelId) => store.selectChannel(channelId)}
        />
        {state.connectionStatus === 'disconnected' ? (
          <div className={styles.gridOverlay} data-testid="grid-overlay" aria-hidden="true" />
        ) : null}
      </div>
      <DetailPanel store={store} onAck={(channelId, operatorLabel) => sendAckCommandRef.current(channelId, operatorLabel)} />
    </>
  );
}
