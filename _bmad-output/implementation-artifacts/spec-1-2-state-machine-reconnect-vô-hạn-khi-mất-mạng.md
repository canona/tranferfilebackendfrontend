---
title: 'Story 1.2: State machine reconnect vô hạn khi mất mạng'
type: 'feature'
created: '2026-09-01'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi mất mạng, `ChannelActor` (Story 1.1) không tự phục hồi — `runStation()`/`runCenter()` chỉ chạy 1 lần, mọi đường thoát (kể cả mất kết nối) đều kết thúc thread hẳn (`finished_=true`). Kênh "give up" vĩnh viễn, phải restart thủ công.

**Approach:** Bọc phần connect/accept + I/O trong vòng lặp reconnect vô hạn: mất kết nối (không do `stop()`) → `RECONNECTING` ngay + backoff 1s→2s→4s...trần 30s (counter riêng actor) → thử lại; thành công → về `CONNECTED`, reset backoff.

## Boundaries & Constraints

**Always:**
- `setState(RECONNECTING)` + log ngay khi mất kết nối giữa phiên CONNECTED, backoff riêng của actor (không chia sẻ với nhánh khác, kể cả REJECTED tương lai — 1.4), reset về 1s mỗi khi đạt lại CONNECTED.
- Backoff sleep chia nhỏ, check `stopRequested_` định kỳ — `stop()` luôn thắng ngay, không chờ hết backoff.
- REJECTED cho lần connect đầu tiên của station (chưa từng CONNECTED) giữ nguyên như Story 1.1; mọi lỗi connect/accept SAU KHI đã từng CONNECTED coi là mất mạng → RECONNECTING, không set REJECTED.
- `run()`'s outer try/catch vẫn là boundary chống crash duy nhất; loop reconnect mới nằm trong `runStation()`/`runCenter()`.

**Ask First:** Không có — giá trị 1s/30s theo AC epics.md, hard-code.

**Never:** Không thêm field backoff vào `ChannelConfig`; không implement REJECTED/audit cho center (1.4), color bars (1.3), ABR/telemetry (1.7/1.8).

</frozen-after-approval>

## Code Map

- `transport-core/src/srt/ChannelActor.h:151` -- `state_`/`setState()`; thêm backoff member (non-atomic) + `sleepInterruptible`/`nextBackoff` + test-only setter rút ngắn base.
- `transport-core/src/srt/ChannelActor.cpp:160-246,248-324` -- `runStation()`/`runCenter()` return thẳng khi peer đóng — điểm rẽ nhánh reconnect; `catch(SrtError)`→REJECTED (177-189) chỉ giữ lần đầu; `ActiveSocketScope` (18-25) tái dùng.
- `transport-core/src/logging/Logger.h` -- schema `{channel_id, event_type, source, reason}`, dùng lại cho event RECONNECTING.
- `transport-core/tests/test_srt_loopback_e2e.cpp:62-70` -- helper `waitForState()` tái dùng cho test mới.
- `transport-core/tests/CMakeLists.txt` -- test mới phải khai báo thủ công (không tự glob).

## Tasks & Acceptance

### Review Findings

- [x] [Review][Patch] Nhánh `connectFailed`/`acceptFailed` (exception thật sau khi đã CONNECTED) chưa có test nào ép ra exception thật — test mới `StationRole_PeerDisconnectMidSession...` tự nhận cover nhánh này nhưng cơ chế dùng (`conn1->close()`) thực chất đi qua nhánh `connectionLost`/`sendAccessUnit` không liên quan; không test nào khiến `applyChannelOptions()`/`connectTo()`/`bindAndListen()`/`accept()` ném `SrtError` thật sau một phiên đã CONNECTED. [src/srt/ChannelActor.cpp:244, src/srt/ChannelActor.cpp:413] — đã thêm 2 test mới (`Center_AcceptPhaseSrtErrorAfterPriorConnected_RetriesInsteadOfFailing`, `StationRole_ConnectFailsAfterPriorConnected_ReconnectsInsteadOfRejecting`) ép ra `SrtError` thật (port collision / wrong-passphrase listener) sau CONNECTED cho cả 2 role
- [x] [Review][Patch] `runStation()` gộp `applyChannelOptions()` và `connectTo()` chung 1 try/catch — lỗi từ `applyChannelOptions()` (option cục bộ) ở lần connect đầu tiên bị log nhầm là `"handshake_reject"`/set `REJECTED`, dù không phải lỗi bắt tay thật. [src/srt/ChannelActor.cpp:236] — tách 2 try/catch riêng, log `"channel_option_error"` cho lỗi applyChannelOptions(), giữ `"handshake_reject"` chỉ cho connectTo() thật
- [x] [Review][Patch] `setBackoffParamsForTesting()` không validate input: `initial > max` khiến lần sleep RECONNECTING đầu tiên vượt trần (chỉ giá trị *kế tiếp* mới bị `std::min` cap); `initial`/`max` = 0 khiến vòng reconnect busy-spin không delay. [src/srt/ChannelActor.h:66] — thêm assert + clamp phòng thủ (`std::min`/`std::max`) đảm bảo bất biến kể cả build NDEBUG
- [x] [Review][Patch] Các hook chỉ-dùng-cho-test (`setBackoffParamsForTesting`, `setSourceFactoryForTesting`, `advanceBackoffForTesting`) ghi rõ precondition "chỉ gọi trước start()/khi thread không chạy" trong comment nhưng không enforce (VD `assert(!thread_.joinable())`) — dùng sai sẽ race ngầm thay vì fail rõ ràng. [src/srt/ChannelActor.h:66] — đã thêm `assert(!thread_.joinable())` vào cả 3 hook
- [x] [Review][Patch] `setSourceFactoryForTesting()`'s factory nếu trả về `nullptr` sẽ bị dereference thẳng (`*sourceOwner`) trong `runStation()`, gây null-deref crash thay vì lỗi rõ ràng. [src/srt/ChannelActor.cpp:291] — thêm null-check, throw `std::logic_error` rõ ràng thay vì crash
- [x] [Review][Patch] `ChannelActor.h` include toàn bộ `source/Source.h` chỉ để đặt tên `std::unique_ptr<source::Source>` trong alias `SourceFactory` (chỉ dùng cho test) — forward-declare `class Source;` trong `namespace source` là đủ, tránh phụ thuộc compile không cần thiết cho production header. [src/srt/ChannelActor.h:15] — đã đổi sang forward-declare; đã kiểm tra không có translation unit nào khác dựa vào include gián tiếp này
- [x] [Review][Patch] Comment doc của `advanceBackoffForTesting()` viết "capped at backoffMax_/backoffInitial_" — đọc như bị cap bởi cả hai, thực tế chỉ cap bởi `backoffMax_`, gây hiểu nhầm. [src/srt/ChannelActor.h:84] — đã sửa comment
- [x] [Review][Patch] Test helper `acceptWithTimeout()`'s worker thread chỉ catch `SrtError`; một exception type khác từ `listener.accept()` sẽ thoát khỏi thread entry point và gọi `std::terminate()`, crash toàn bộ test binary thay vì chỉ fail 1 test case. [tests/test_channel_actor_reconnect.cpp:133] — đổi sang `catch (const std::exception&)`
- [x] [Review][Patch] Comment của test `StationRole_PeerDisconnectMidSession_...` (dòng 241-253) mô tả sai nhánh nó thực sự cover — tự nhận test nhánh `everConnected`-gated `connectFailed`/RECONNECTING nhưng cơ chế (`conn1->close()`) thực chất đi qua nhánh `connectionLost` không liên quan. [tests/test_channel_actor_reconnect.cpp:284] — đã sửa comment, trỏ sang test mới thực sự cover nhánh này
- [x] [Review][Patch] Comment của `waitForConnectedOrPast()` khẳng định "RECONNECTING is only ever reachable after a real CONNECTED session" — đúng với Station (có gate `everConnected`) nhưng sai với Center (có thể vào RECONNECTING ngay từ lần `accept()` đầu tiên thất bại, không cần từng CONNECTED). Chưa gây bug thật trong test hiện tại nhưng phát biểu tổng quát sai. [tests/test_srt_loopback_e2e.cpp:97] — đã sửa comment, giới hạn phát biểu đúng phạm vi Station
- [x] [Review][Defer] Local resource re-open failures (Source/encoder/decoder) trên reconnect cycle ≥2 làm actor chết vĩnh viễn thay vì retry — `runStation()`'s `source.open()`/`H264Encoder` ctor+`open()` (`ChannelActor.cpp:294-298`) và `runCenter()`'s `H264Decoder::open()` (`ChannelActor.cpp:471-472`) đều nằm NGOÀI try/catch cho `connectFailed`/`acceptFailed` — một exception ở đây thoát thẳng tới `run()`'s outer catch, kết thúc actor thay vì RECONNECTING. [src/srt/ChannelActor.cpp:294] — deferred, pre-existing (đã ghi nhận & defer ở vòng review trước cùng ngày, xem `deferred-work.md` mục "Deferred from: code review of spec-1-2..." dòng 27 — hành vi có từ Story 1.1, Story 1.2 không đổi; câu hỏi "coi lỗi mở resource cục bộ là mất mạng hay actor failure" vẫn ngoài scope, giữ nguyên quyết định defer)
- [x] [Review][Defer] Backoff không có jitter — nhiều actor mất mạng đồng loạt sẽ retry đồng bộ 1s/2s/4s/…/30s, rủi ro thundering herd khi mở rộng nhiều kênh. [src/srt/ChannelActor.cpp:298] — deferred, pre-existing (giá trị 1s/30s hard-code theo spec's Ask First, ngoài phạm vi story này)
- [x] [Review][Defer] Log `actor_state_change`/RECONNECTING không mang theo giá trị backoff sắp sleep hay số lần reconnect — khó đối chiếu log. [src/srt/ChannelActor.cpp:351] — deferred, pre-existing (Logger schema tái dùng nguyên trạng theo Code Map, mở rộng schema ngoài phạm vi story này)
- [x] [Review][Defer] Chưa có test cho kịch bản `stop()` rồi `start()` lại thật, xác nhận `currentBackoff_` reset đúng về `backoffInitial_` ở run mới. [src/srt/ChannelActor.cpp:204] — deferred, pre-existing (code đã reset đúng vị trí, chỉ thiếu test riêng cho kịch bản restart)
- [x] [Review][Defer] Test mới hardcode cổng cụ thể (41101, 41103-41105, 41107-41108) không có cơ chế điều phối chung với các file test khác. [tests/test_channel_actor_reconnect.cpp:229] — deferred, pre-existing (chưa đụng cổng thật với các range hiện có 40xxx/41001-41003; chỉ là rủi ro tương lai)

### Review Findings (Round 2)

- [x] [Review][Patch] Round-2 patches (vòng 1 review) chưa từng build/test thật — file `.obj`/`.exe` trong `build/` cũ hơn source hiện tại (mtime trước các patch mới nhất), và spec không có mục Completion Notes ghi rõ điều này như spec's `## Verification` yêu cầu ("Nếu sandbox không có toolchain... ghi rõ trong Completion Notes"). [spec file, mục Verification] — đã thêm mục `## Completion Notes` ghi rõ tình trạng chưa build/test thật ở cả 2 vòng
- [x] [Review][Patch] Test `Center_AcceptPhaseSrtErrorAfterPriorConnected_RetriesInsteadOfFailing` (thêm ở vòng 1) có race thật: center's own reconnect loop có thể rebind lại port TRƯỚC khi `portBlocker.bindAndListen(kPort)` của test kịp chiếm — khi đó `ASSERT_TRUE(portBlocker.bindAndListen(kPort))` fail fatal, test abort thay vì chạy assertion thật. Xác nhận độc lập bởi cả blind-hunter và verification-gap. [tests/test_channel_actor_reconnect.cpp:406] — tăng backoff đầu 60ms→300ms + retry bind với socket mới mỗi lần thay vì assert 1 lần
- [x] [Review][Patch] Test `StationRole_ConnectFailsAfterPriorConnected_ReconnectsInsteadOfRejecting` (thêm ở vòng 1) có khoảng hở timing giữa lúc đóng listener đúng passphrase và dựng listener sai passphrase — 1 lần retry của station rơi đúng khoảng hở này sẽ block theo connect-timeout thật của libsrt ("multiple seconds" theo comment `tryConnectOnce()` trong cùng file), có thể vượt budget poll 5000ms hiện tại → false failure. [tests/test_channel_actor_reconnect.cpp:494] — tăng budget poll 5000ms→20000ms
- [x] [Review][Patch] Comment doc của `setSourceFactoryForTesting()` (`ChannelActor.h`) viết "runStation() only reads this once, right after reaching CONNECTED" — đã lỗi thời từ khi có vòng lặp reconnect: factory được gọi lại mỗi lần CONNECTED thành công, không chỉ 1 lần duy nhất trong đời actor. [src/srt/ChannelActor.h:86] — đã sửa comment
- [x] [Review][Patch] Comment của 3 `assert(!thread_.joinable())` (thêm ở vòng 1) khẳng định misuse "fails loudly... rather than racing silently" — chỉ đúng ở build có bật assert; build NDEBUG/release thì assert bị compile out, quay lại race ngầm y như cũ. Comment overclaim. [src/srt/ChannelActor.h:66] — thêm caveat NDEBUG rõ ràng vào `setSourceFactoryForTesting()`'s assert comment (2 chỗ còn lại đã có caveat sẵn, không cần sửa)
- [x] [Review][Patch] Comment của `acceptWithTimeout()` ghi "same... technique... (see ChannelActor::stop(), tryConnectOnce() above)" nhưng `tryConnectOnce()` thực ra định nghĩa PHÍA DƯỚI `acceptWithTimeout()` trong file, không phải phía trên. [tests/test_channel_actor_reconnect.cpp:104] — sửa "above" → "further below in this file"
- [x] [Review][Patch] `setSourceFactoryForTesting()` gọi trên actor role Center sẽ âm thầm không có tác dụng gì (chỉ `runStation()` đọc `sourceFactoryForTesting_`) — không có cảnh báo nào cho test author. [src/srt/ChannelActor.cpp:36] — thêm `assert(role_ == ActorRole::Station)`
- [x] [Review][Patch] Log RECONNECTING (nhánh `connectFailed` sau `everConnected`) không phân biệt `optionsFailed` như nhánh REJECTED đã làm — cả 2 loại lỗi (option cục bộ vs connectTo() thật) đều chung 1 prefix "connect failed after a prior CONNECTED session", chỉ khác ở raw reason text nhúng theo sau. [src/srt/ChannelActor.cpp:404] — thêm tag `(channel_option_error)`/`(connectTo)` vào message, giữ nguyên substring cũ để không phá test hiện có
- [x] [Review][Defer] Production catch blocks (`runStation()`/`runCenter()`'s connect/accept-phase try/catch) chỉ catch `SrtError`, không rộng như test helper `acceptWithTimeout()` đã sửa ở vòng 1 — một exception khác `SrtError` (VD `bad_alloc`) vẫn không được retry. [src/srt/ChannelActor.cpp:263] — deferred, pre-existing (đã đánh giá ở vòng 1: `SrtSocket`'s API chỉ ném `SrtError` theo hợp đồng đã document; `run()`'s outer catch-all vẫn chặn crash — actor chỉ không retry cho lớp exception này, không escalate thành crash. Khác bản chất so với test helper: helper chạy trên `std::thread` trần không có outer catch-all, production code thì có)
- [x] [Review][Defer] `setSourceFactoryForTesting()`'s null-guard và `setBackoffParamsForTesting()`'s clamp (thêm ở vòng 1) chưa có test riêng exercise. [src/srt/ChannelActor.cpp:36] — deferred (chỉ bảo vệ test author khỏi tự dùng sai, giá trị thấp, không production-reachable)
- [x] [Review][Defer] `std::ostringstream logOut` dùng chung giữa actor thread (ghi qua `Logger`'s mutex) và test thread (đọc `.str()` không khoá) — data race hẹp về mặt lý thuyết. [tests/test_channel_actor_reconnect.cpp] — deferred, pre-existing (convention dùng xuyên suốt toàn bộ test suite, không riêng diff này; sửa cần đổi cách đồng bộ Logger/test cho tất cả test file, ngoài scope patch nhỏ)
- [x] [Review][Defer] `waitForState(RECONNECTING)` rồi check `logOut.str()` ngay không đảm bảo thứ tự với `logger_.log()` (chạy sau `setState()` trên actor thread) — TOCTOU hẹp về lý thuyết. [tests/test_channel_actor_reconnect.cpp:255] — deferred, pre-existing (từ vòng 0, cửa sổ race cực hẹp, rủi ro flake thực tế thấp)
- [x] [Review][Defer] `advanceBackoffForTesting()` định nghĩa inline trong header trong khi 2 hook anh em định nghĩa ở .cpp — không nhất quán chỗ đặt code. [src/srt/ChannelActor.h:84] — deferred (thuần stylistic)
- [x] [Review][Defer] `nextBackoff()` có thể overflow (UB) nếu `setBackoffParamsForTesting()` được gọi với `max` gần giá trị lớn nhất của `chrono::milliseconds::rep`. [src/srt/ChannelActor.cpp:63] — deferred (chỉ test-only misuse cực đoan, không ai gọi giá trị này trong thực tế)
- [x] [Review][Defer] `Backoff_ResetsToBaseAfterSuccessfulReconnect` dùng ngưỡng thời gian thực (`gap2Ms < 2500`) trên socket thật — biên độ có thể không đạt "không flake qua 3 lần chạy" theo spec's Verification. [tests/test_channel_actor_reconnect.cpp] — deferred, pre-existing (test có từ vòng 0, tự nhận biết rủi ro trong comment; cần chạy `ctest` thật để đánh giá, không thể fix bằng cách đoán biên độ)

**Execution:**
- [x] `transport-core/src/srt/ChannelActor.h` -- thêm `currentBackoff_`, `sleepInterruptible()`, `nextBackoff()` (nhân đôi, cap 30s), test-only setter rút ngắn base
- [x] `transport-core/src/srt/ChannelActor.cpp` -- bọc thân `runStation()`/`runCenter()` trong `while(!stopRequested_)`; mất mạng (không do stop) → RECONNECTING+log+backoff sleep+retry (không map REJECTED); thành công → CONNECTED+reset backoff
- [x] `transport-core/tests/test_channel_actor_reconnect.cpp` (mới) -- test mất mạng→RECONNECTING+backoff tăng dần→tự CONNECTED khi peer mở lại; backoff cap tại trần; `stop()` giữa lúc sleep thoát ngay
- [x] `transport-core/tests/CMakeLists.txt` -- thêm file test mới vào `add_executable(transport_core_tests ...)`

**Acceptance Criteria:**
- Given CONNECTED, when peer đóng đột ngột (không `stop()`), then RECONNECTING ngay, backoff từ 1s.
- Given RECONNECTING với nhiều lần thất bại liên tiếp, when backoff tính lại, then tăng gấp đôi tới trần 30s rồi giữ nguyên — thử vô hạn.
- Given RECONNECTING, when reconnect thành công, then về CONNECTED, backoff reset 1s.
- Given đang sleep backoff, when `stop()`, then thoát ngay, không chờ hết backoff.
- Given sai passphrase lần connect đầu (station, chưa từng CONNECTED), when handshake fail, then REJECTED như Story 1.1 — không vào loop reconnect.

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->

## Design Notes

- Cờ `everConnected` phân nhánh: lỗi khi chưa từng CONNECTED → REJECTED (như cũ); lỗi sau khi đã CONNECTED → RECONNECTING+log+backoff+loop lại; thành công → CONNECTED+reset backoff.
- `sleepInterruptible` chia backoff thành đoạn ~100ms, check `stopRequested_` mỗi đoạn thay vì `sleep_for` nguyên khối.
- `runCenter()` chưa có khái niệm REJECTED — mọi lỗi `accept()` xử lý như mất mạng → RECONNECTING, không lấn scope 1.4.

## Verification

**Commands:**
- `cmake --build --preset windows-vcpkg && ctest --preset windows-vcpkg --output-on-failure` -- build sạch, toàn bộ test cũ + mới pass, không flake qua 3 lần chạy.

**Manual checks (if no CLI):** Nếu sandbox không có toolchain: trace logic theo Code Map, đối chiếu từng AC; ghi rõ trong Completion Notes là build/test thật chưa chạy trong phiên này.

## Completion Notes

**Code review round 1 + round 2 (2026-09-01):** Sandbox review này KHÔNG có toolchain (`cmake`/`ninja`/`cl` không có trên PATH, xác nhận qua cả Bash lẫn PowerShell) — `cmake --build ... && ctest ...` chưa từng chạy thật trong phiên này ở cả 2 vòng review. Toàn bộ patch (round 1: 10 mục; round 2: 8 mục) được áp dụng dựa trên trace logic theo Code Map + đối chiếu API thật của `SrtSocket.h/.cpp` (đọc trực tiếp, không đoán), đối chiếu từng AC trong Acceptance Criteria, và kiểm tra chéo bằng 4 review layer (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) — nhưng **chưa có xác nhận build/test thật**. File `.obj`/`.exe` trong `build/` (nếu còn) là artifact CŨ, từ trước round 2, không phản ánh code hiện tại.

**Bắt buộc trước khi merge:** chạy `cmake --build --preset windows-vcpkg && ctest --preset windows-vcpkg --output-on-failure` trên máy có toolchain thật, lặp lại ≥3 lần để xác nhận không flake — đặc biệt chú ý 2 test mới thêm ở round 1 (`Center_AcceptPhaseSrtErrorAfterPriorConnected_RetriesInsteadOfFailing`, `StationRole_ConnectFailsAfterPriorConnected_ReconnectsInsteadOfRejecting`) và test timing-sensitive có sẵn từ trước (`Backoff_ResetsToBaseAfterSuccessfulReconnect`) — cả 3 đều có race/margin đã ghi nhận và giảm thiểu ở round 2 nhưng chưa được xác nhận bằng lần chạy thật nào.

## Suggested Review Order

**Vòng lặp reconnect vô hạn (lõi story)**

- Điểm vào: cờ `everConnected` phân nhánh REJECTED (lần đầu) vs RECONNECTING (sau khi đã CONNECTED) — quyết định thiết kế trung tâm của story.
  [`ChannelActor.cpp:194-206`](../../transport-core/src/srt/ChannelActor.cpp#L194)

- Nhánh catch quyết định REJECTED (giữ nguyên Story 1.1) hay `connectFailed`→RECONNECTING (mới).
  [`ChannelActor.cpp:244-262`](../../transport-core/src/srt/ChannelActor.cpp#L244)

- `runCenter()` không có khái niệm REJECTED — mọi lỗi accept() đều là mất mạng (đối xứng khác Station, có chủ đích).
  [`ChannelActor.cpp:365-373`](../../transport-core/src/srt/ChannelActor.cpp#L365)

- Đóng vòng lặp: setState(RECONNECTING) + log ngay + backoff sleep + loop lại, không return.
  [`ChannelActor.cpp:336-361`](../../transport-core/src/srt/ChannelActor.cpp#L336)

**Backoff & khả năng bị `stop()` ngắt ngay lập tức**

- `sleepInterruptible` chia nhỏ 100ms/lần thay vì sleep nguyên khối, để `stop()` luôn thắng gần như ngay.
  [`ChannelActor.cpp:44-61`](../../transport-core/src/srt/ChannelActor.cpp#L44)

- `nextBackoff()` — nhân đôi, cap tại `backoffMax_`, counter riêng của actor.
  [`ChannelActor.cpp:63-67`](../../transport-core/src/srt/ChannelActor.cpp#L63)

**Patch từ code review: lỗi có thể giết actor vĩnh viễn thay vì reconnect**

- `applyChannelOptions()`/`connectTo()` gộp chung try/catch (Station) — tránh SrtError văng thẳng ra ngoài vòng lặp.
  [`ChannelActor.cpp:227-243`](../../transport-core/src/srt/ChannelActor.cpp#L227)

- `applyChannelOptions()`/`bindAndListen()`/`accept()` gộp chung try/catch (Center) — Center bind lại listener MỚI mỗi vòng nên bề mặt lỗi này lặp lại liên tục, nghiêm trọng hơn phía Station.
  [`ChannelActor.cpp:402-439`](../../transport-core/src/srt/ChannelActor.cpp#L402)

**Vòng đời socket khi backoff (tránh "phantom accept")**

- `listener`/`conn` bị huỷ TRƯỚC khi backoff sleep bắt đầu — nếu không, 1 caller kết nối đúng lúc backoff sẽ handshake thành công vào 1 listener đã "chết", mất kết nối âm thầm.
  [`ChannelActor.cpp:379-394`](../../transport-core/src/srt/ChannelActor.cpp#L379)

**Test-only seam**

- `setSourceFactoryForTesting()` — cho phép test đưa Station tới CONNECTED thật mà không cần file mp4.
  [`ChannelActor.h:86-97`](../../transport-core/src/srt/ChannelActor.h#L86)

- `setBackoffParamsForTesting()`/`advanceBackoffForTesting()` — rút ngắn backoff cho test, verify arithmetic tách biệt khỏi socket thật.
  [`ChannelActor.h:59-84`](../../transport-core/src/srt/ChannelActor.h#L59)

**Test**

- Test chính: mất mạng giữa phiên (Center) → RECONNECTING → tự CONNECTED lại khi peer quay lại.
  [`test_channel_actor_reconnect.cpp:228`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L228)

- Test đối xứng cho Station (patch từ verification-gap) — dùng `FakeLoopingSource`, chứng minh nhánh `everConnected==true` không phải REJECTED.
  [`test_channel_actor_reconnect.cpp:284`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L284)

- Backoff nhân đôi/cap tại trần — arithmetic thuần, tách khỏi socket thật.
  [`test_channel_actor_reconnect.cpp:366`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L366)

- Backoff reset về base sau khi reconnect thành công (patch từ verification-gap) — chạy 2 chu kỳ mất kết nối liên tiếp, bound thời gian chu kỳ 2.
  [`test_channel_actor_reconnect.cpp:418`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L418)

- `stop()` giữa lúc sleep backoff thoát gần như ngay, không chờ hết backoff dài.
  [`test_channel_actor_reconnect.cpp:480`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L480)

- Assertion nới lỏng (CONNECTED hoặc RECONNECTING) trong test Story 1.1 vì center giờ có thể tự chuyển RECONNECTING trước khi test kịp poll.
  [`test_srt_loopback_e2e.cpp:82-105`](../../transport-core/tests/test_srt_loopback_e2e.cpp#L82)

- Đăng ký file test mới vào build.
  [`tests/CMakeLists.txt:12`](../../transport-core/tests/CMakeLists.txt#L12)
