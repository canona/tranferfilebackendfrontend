---
title: 'Story 1.4: Nhánh reject riêng khi sai passphrase + log audit'
type: 'feature'
created: '2026-09-01'
status: 'done'
baseline_commit: '39e5fdf6977ad7c1297fbbcf00c01cfcb2739ab4'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelActor` (Station) hiện coi MỌI lỗi connect ở lần đầu tiên (kể cả sai passphrase) là `REJECTED` rồi **kết thúc actor luôn** (throw ra `run()`), không phân biệt được với lỗi cấu hình/mất mạng thoáng qua, và không backoff/log/emit theo đúng contract audit.

**Approach:** Dùng `srt_getrejectreason()` (đã có sẵn ở `SrtSocket::connectTo()`) để phân loại đúng `SRT_REJ_BADSECRET`/`SRT_REJ_UNSECURE` thành 1 exception riêng. `ChannelActor` route riêng loại này sang `REJECTED` với backoff độc lập (5s→60s, nhân đôi), **retry vô hạn như RECONNECTING chứ không còn chết**; mọi lỗi connect khác (kể cả reject reason khác, lỗi cấu hình cục bộ) giữ nguyên đi vào `RECONNECTING` hiện có, bất kể đã từng `CONNECTED` hay chưa. Mỗi lần `REJECTED` build 1 `EventEnvelope` (schema chung AD-30) bên cạnh log JSON-lines hiện có.

## Boundaries & Constraints

**Always:**
- Chỉ `ActorRole::Station` (caller). `runCenter()` (listener) giữ nguyên 100% hành vi hiện tại.
- Chỉ `SRT_REJ_BADSECRET`/`SRT_REJ_UNSECURE` (đọc ngay sau `SRT_ECONNREJ`) route sang `REJECTED`; mọi reject reason khác + lỗi `applyChannelOptions()` cục bộ + mất kết nối giữa phiên vẫn → `RECONNECTING`, không còn phân biệt theo `everConnected`.
- `REJECTED` không còn là trạng thái kết thúc actor: backoff riêng `rejectBackoffInitial_{5s}`/`rejectBackoffMax_{60s}`/`currentRejectBackoff_`, nhân đôi mỗi lần (mirror `nextBackoff()`), retry vô hạn.
- Khi đạt lại `CONNECTED`: reset cả `currentBackoff_` VÀ `currentRejectBackoff_` về base.
- Mỗi lần vào `REJECTED`: giữ nguyên `logger_.log(...)` 5-field hiện có (`event_type="handshake_reject"`) VÀ build thêm 1 `EventEnvelope` (schema_version/channel_id/timestamp/event_type/payload), snapshot qua getter test-only. Passphrase thật không bao giờ xuất hiện trong log hay payload.
- `handshake_success` tiếp tục được log như hiện có (`ChannelActor.cpp:414`) — không regress.

**Ask First:** Không có — các quyết định (bỏ nhánh `!everConnected`, gộp lỗi cấu hình cục bộ vào `RECONNECTING`) đã chốt qua khảo sát code thật.

**Never:** Không đụng `runCenter()`/Center role — center-side detect reject (cần `srt_listen_callback`) defer sang story sau. Không dựng transport mạng thật để gửi `EventEnvelope` đi đâu (WebSocket là Story 1.8) — story này chỉ cần chứng minh envelope tạo đúng schema, verify qua getter. Không đổi format 5-field cố định của `LogEvent`/`Logger::log()`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Passphrase sai lần đầu | Station connect, `SRT_REJ_BADSECRET` | `state()==REJECTED`, backoff bắt đầu 5s, log + envelope tạo ra, actor vẫn sống | N/A |
| Reject liên tiếp | Đang `REJECTED`, backoff 5s | Backoff nhân đôi 10s→20s→40s→60s rồi giữ trần | N/A |
| Passphrase sửa đúng sau nhiều lần reject | Đang `REJECTED`, backoff > base | Connect thành công → `CONNECTED`; `currentBackoff_` VÀ `currentRejectBackoff_` reset về base | N/A |
| Reject reason khác (vd `SRT_REJ_TIMEOUT`) hoặc lỗi cấu hình cục bộ | Connect thất bại không do passphrase | `state()==RECONNECTING` (không phải `REJECTED`), dùng backoff 1s→30s hiện có | N/A |
| Mất kết nối giữa phiên sau khi đã `CONNECTED` | `connectionLost` | Vẫn `RECONNECTING` như Story 1.2, không đổi | N/A |

</frozen-after-approval>

## Code Map

- `transport-core/src/telemetry/EventEnvelope.h/.cpp` (MỚI) -- struct `EventEnvelope{schema_version,channel_id,timestamp,event_type,payload(nlohmann::json)}` + `toJsonString()` -- envelope dùng chung AD-30, Story 1.8 tái dùng.
- `transport-core/src/srt/SrtSocket.h:19` (cạnh `SrtError`), `SrtSocket.cpp:173-181` (`connectTo`) -- thêm `SrtHandshakeRejectedError : public SrtError` với `isPassphraseRejection()`, set dựa `srt_getrejectreason()==SRT_REJ_BADSECRET/SRT_REJ_UNSECURE`.
- `transport-core/src/srt/ChannelActor.h:153-186` (getters), `:257-291` (members), `:331-333` (backoff) -- thêm `rejectBackoffInitial_/rejectBackoffMax_/currentRejectBackoff_`, `nextRejectBackoff()`, `setRejectBackoffParamsForTesting()`, `lastHandshakeRejectEnvelope()` getter + storage (mirror `lastError_`/`negotiatedPbkeylenBytes_` pattern).
- `transport-core/src/srt/ChannelActor.cpp:353-517` (`runStation`) -- bắt `SrtHandshakeRejectedError` riêng (trước `SrtError`); xoá nhánh `!everConnected`-throw cũ; passphrase-reject → `REJECTED` + `nextRejectBackoff()` + loop tiếp; mọi lỗi khác (kể cả `optionsFailed`) → nhánh `RECONNECTING` hiện có (`:490-517`) không phân biệt `everConnected`; reset cả 2 backoff tại `:412`.
- `transport-core/src/CMakeLists.txt:6-16` -- thêm `telemetry/EventEnvelope.cpp`.
- `transport-core/tests/test_srt_loopback_e2e.cpp:223-291` -- sửa 2 test wrong-passphrase: assert `state()==REJECTED` + actor còn sống (không còn `hasFailed()`/`hasFinished()`).
- `transport-core/tests/test_channel_actor_rejected.cpp` (MỚI, port 41150-41155) -- test toàn bộ I/O Matrix.
- `transport-core/tests/CMakeLists.txt` -- đăng ký file test mới.
- `transport-core/tests/test_actor_crash_isolation.cpp` -- `ActorAThrowing_DoesNotAffectActorB`, `StopThenStart_RestartsCleanly` -- sửa vì dựa giả định cũ đã bỏ.
- `transport-core/tests/test_channel_actor_reconnect.cpp` -- 1 test đổi tên+hành vi (`StationRole_WrongPassphraseAfterPriorConnected_RoutesToRejectedNotReconnecting`).

## Tasks & Acceptance

**Execution:**
- [x] `transport-core/src/telemetry/EventEnvelope.h/.cpp` -- tạo struct + serialize -- nền tảng wire-envelope.
- [x] `transport-core/src/srt/SrtSocket.h/.cpp` -- `SrtHandshakeRejectedError` phân loại reject reason có cấu trúc -- bỏ heuristic string-match.
- [x] `transport-core/src/srt/ChannelActor.h` -- backoff/getter riêng cho REJECTED -- tách biệt hoàn toàn RECONNECTING.
- [x] `transport-core/src/srt/ChannelActor.cpp` -- route theo lý do reject thật, REJECTED không còn chết -- hiện thực AC chính.
- [x] `transport-core/src/CMakeLists.txt` -- đăng ký file mới -- build không thiếu symbol.
- [x] `transport-core/tests/test_srt_loopback_e2e.cpp` -- cập nhật 2 test theo hành vi mới -- không còn assert sai.
- [x] `transport-core/tests/test_channel_actor_rejected.cpp` -- test I/O Matrix + không lộ passphrase -- verify AC bằng test thật.
- [x] `transport-core/tests/CMakeLists.txt` -- đăng ký test mới.
- [x] `transport-core/tests/test_actor_crash_isolation.cpp` -- sửa 2 test dựa giả định cũ ("connect thất bại lần đầu bất kỳ lý do -> REJECTED-rồi-chết") -- hệ quả bắt buộc của việc bỏ nhánh `!everConnected`, không nằm trong Code Map gốc.
- [x] `transport-core/tests/test_channel_actor_reconnect.cpp` -- đổi 1 test cũ (`StationRole_ConnectFailsAfterPriorConnected_ReconnectsInsteadOfRejecting`) thành `StationRole_WrongPassphraseAfterPriorConnected_RoutesToRejectedNotReconnecting` -- hành vi lật ngược đúng theo thiết kế mới (reject do passphrase giờ luôn -> REJECTED, bất kể `everConnected`).

**Acceptance Criteria:**
- Given Station connect với passphrase sai, when `SRT_ECONNREJ` với reason BADSECRET/UNSECURE, then actor vào `REJECTED` ngay, không tạo kết nối một phần, không rơi về plaintext.
- Given đang `REJECTED`, when tiếp tục bị reject, then `currentRejectBackoff_` tăng gấp đôi 5s→60s trần, hoàn toàn tách biệt `currentBackoff_`.
- Given đang `REJECTED`, when passphrase phía peer sửa đúng, then tự phục hồi `CONNECTED` không cần restart, cả 2 backoff reset base.
- Given bất kỳ lần `REJECTED`, then log JSON-lines (timestamp/channel_id/event_type=handshake_reject/source/reason) VÀ 1 `EventEnvelope` đúng schema được tạo, không field nào chứa passphrase thật.
- Given handshake thành công, then `event_type=handshake_success` vẫn được log như hiện có.

### Review Findings

- [x] [Review][Patch] Test không assert giá trị field `payload` (source/reason) của EventEnvelope, chỉ check substring `"payload"` tồn tại + passphrase vắng mặt [tests/test_channel_actor_rejected.cpp:177] — **Fixed:** thêm assert `payload["source"]==remote_ip` + `payload["reason"]` chứa "REJECT"
- [x] [Review][Patch] Không có test capture log để verify message `"RECONNECTING: connect failed (...)"` sau khi assertion cũ (kiểm log text) bị xoá khi sửa test — đổi tag/message sai sẽ không có test nào fail [tests/test_channel_actor_rejected.cpp:384] — **Fixed:** thêm `Logger`/`ostringstream` + assert log text vào `NonPassphraseRejectFromInjectedError_RoutesToReconnectingNotRejected`
- [x] [Review][Patch] Comment sai sự thật: claim `failureReason` "embeds only srt_rejectreason_str()'s fixed enum-name string" nhưng thực tế là toàn bộ `e.what()` (có tiền tố tiếng Việt + enum name) [src/srt/ChannelActor.cpp:547] — **Fixed:** sửa lại comment đúng sự thật (đã verify qua test thật: libsrt trả "Incorrect passphrase", không phải "BADSECRET")
- [x] [Review][Patch] Comment stale: nói split `channel_option_error`/`connectTo` "already made at the REJECTED log site below" — không còn đúng vì REJECTED log site giờ không thể nhận `optionsFailed==true` (passphraseRejected đã ngụ ý `!optionsFailed`) [src/srt/ChannelActor.cpp:447] — **Fixed:** viết lại comment mô tả đúng thực tế
- [x] [Review][Patch] 4 method test-only hook (`setConnectToOverrideForTesting`, `setRejectBackoffParamsForTesting`, `advanceRejectBackoffForTesting`, `setBackoffParamsForTesting`/`advanceBackoffForTesting`) lặp lại y hệt pattern `assert(!thread_.joinable())` + `throw std::logic_error(...)` — nên gộp thành 1 helper `ensureNotRunning(const char* who)` để 2 message không lệch nhau khi sửa sau [src/srt/ChannelActor.h:118,152 + .cpp] — **Fixed:** thêm `ChannelActor::ensureNotRunning()`, thay thế tất cả 7 call site (kể cả 2 pre-existing `advanceBackoffForTesting`/`setBackoffParamsForTesting` từ Story 1.2)
- [x] [Review][Defer] `currentIso8601Utc()` không check kết quả `gmtime_s`/`gmtime_r` [src/telemetry/EventEnvelope.cpp:16] — deferred, pre-existing (mirror y hệt pattern có sẵn ở `Logger.cpp`'s `isoTimestampUtc()`, không phải lỗi mới của story này)
- [x] [Review][Defer] `EventEnvelope::toJsonString()` dùng `nlohmann::json::dump()` không có `error_handler` — chuỗi UTF-8 không hợp lệ sẽ throw uncaught [src/telemetry/EventEnvelope.cpp:29] — deferred, chưa có consumer production nào gọi (chỉ test), sẽ liên quan khi Story 1.8 làm transport thật
- [x] [Review][Defer] Không có test cho nhánh `applyChannelOptions()` lỗi cục bộ → RECONNECTING (`channel_option_error`) end-to-end [src/srt/ChannelActor.cpp:447] — deferred, pre-existing gap từ Story 1.2, comment đã ghi nhận "unreachable in practice" (gated bởi `ChannelConfig::validate()`)

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->

- [x] [Review][Patch] "handshake_reject" event_type literal trùng lặp (`logger_.log(...)` và `envelope.event_type`) không dùng chung constant — rủi ro desync khi rename. **Fixed:** thêm `kHandshakeRejectEventType` dùng chung cả 2 nơi.
- [x] [Review][Patch] Thiếu test xác nhận `lastHandshakeRejectEnvelope()` trả `nullptr` trước khi có lần REJECTED nào. **Fixed:** thêm `LastHandshakeRejectEnvelope_IsNullBeforeAnyRejectedTransition`.
- [x] [Review][Patch] Comment `bool connectFailed` mô tả thiếu chính xác (không nói rõ cũng cover cả lỗi `applyChannelOptions()` cục bộ). **Fixed:** sửa lại comment.
- [x] [Review][Patch] Verification-gap: nhánh routing thật trong `ChannelActor` cho 1 `SrtHandshakeRejectedError` với `isPassphraseRejection()==false` chưa từng được test end-to-end (`NonPassphraseConnectFailure_RoutesToReconnectingNotRejected` cũ chỉ hit lỗi "nothing listening", không đi qua `catch (const SrtHandshakeRejectedError&)`) — chỉ free-function `isPassphraseRejectReason()` được test riêng. **Fixed:** thêm seam test-only `setConnectToOverrideForTesting()` (mirror `setSourceFactoryForTesting()`) + 2 test mới (`NonPassphraseRejectFromInjectedError_RoutesToReconnectingNotRejected`, `PassphraseRejectFromInjectedError_RoutesToRejected`) xác nhận đúng routing tại `ChannelActor`.
- 11 finding khác từ blind-hunter (build/link nlohmann_json cho `transport_core`, envelope chỉ latch 1 bản, chưa migrate `handshake_success`/`actor_state_change` sang envelope, backoff không reset khi interleave, dropped log substring, `waitForFailed()` bị xoá có an toàn không, không rate-limit REJECTED, gộp BADSECRET/UNSECURE, comment "60s", `advanceRejectBackoffForTesting()` có test không, thread-safety `currentIso8601Utc()`, mix ngôn ngữ comment, `schema_version` không có hằng số) — **reject**: verify chéo với code/test thật (build 83/83 pass, đọc trực tiếp `src/CMakeLists.txt`/`EventEnvelope.h/.cpp`/test file) cho thấy đều đã đúng theo spec hoặc đã được code xử lý, không phải defect thật.
- 1 finding "Other" từ verification-gap (app entrypoint không còn tín hiệu `hasFailed()` cho kênh kẹt REJECTED vĩnh viễn) — **defer**, ghi vào `deferred-work.md` (thuộc phạm vi Story 1.8/Epic 2 telemetry+alerting, không phải transport-core story này).

## Design Notes

- `REJECTED` chỉ áp dụng `ActorRole::Station`: `runCenter()` (listener) không quan sát được reject vì libsrt lọc bad-passphrase trước khi tới `srt_accept()`. Detect phía Center cần `srt_listen_callback` — deferred, đã ghi `deferred-work.md`.
- `EventEnvelope` chưa có transport mạng thật (Story 1.8 mới làm) — story này chỉ chứng minh envelope tạo đúng schema qua getter test-only `lastHandshakeRejectEnvelope()`.
- Bỏ hẳn nhánh `!everConnected` cũ (coi mọi lỗi connect đầu tiên là REJECTED-rồi-chết) — thay bằng phân loại theo lý do reject thật, áp dụng nhất quán bất kể `everConnected`, đơn giản hoá `runStation()`.

## Verification

**Commands:**
- `cmake --build build --config RelWithDebInfo && ctest --test-dir build --output-on-failure` -- build sạch, toàn bộ test cũ (đã sửa) + mới pass, chạy lại 3 lần không flake.

## Completion Notes

**Implementation (2026-09-01):** Subagent implement không có toolchain (không có `cmake`/`cl` trên PATH trong sandbox riêng của nó) nên chỉ trace logic, không build/test thật. Orchestrator (phiên này) sau đó tự build+test thật bằng toolchain có sẵn (`C:\Program Files\CMake\bin`, MSVC qua `D:\VSBuildTools2\VC\Auxiliary\Build\vcvars64.bat`, `VCPKG_ROOT=D:\ThucHanhAI\TranferFiles\vcpkg`).

- `cmake --build build --config RelWithDebInfo` -- build sạch, không lỗi/warning liên quan thay đổi (16 target, gồm `telemetry/EventEnvelope.cpp.obj` và `test_channel_actor_rejected.cpp.obj` mới).
- `ctest --test-dir build --output-on-failure` -- **80/80 test pass** (74 cũ, trong đó có sửa 5 test theo hành vi mới, + 6 test mới `ChannelActorRejectedTest.*`).
- Chạy lại `ctest` thêm 2 lần nữa (tổng 3 lần) -- pass cả 3 lần, không flake.

**Phạm vi thực tế so với Code Map:** Đúng theo Code Map, cộng 2 file test không nằm trong Code Map gốc nhưng bắt buộc phải sửa (`test_actor_crash_isolation.cpp`, `test_channel_actor_reconnect.cpp`) vì cả hai đều assert theo giả định cũ ("bất kỳ lỗi connect đầu tiên nào cũng REJECTED-rồi-chết") mà spec này cố ý bỏ.

**I/O Matrix audit:** Cả 5 dòng đều có test cụ thể, đã chạy pass: dòng 1 → `ChannelActorRejectedTest.WrongPassphraseFirstAttempt_RoutesToRejectedAndBuildsEnvelope`; dòng 2 → `RejectBackoff_DoublesThenCapsAtCeiling`; dòng 3 → `PassphraseFixedAfterRejects_RecoversToConnectedAndResetsBothBackoffs`; dòng 4 → `NonPassphraseConnectFailure_RoutesToReconnectingNotRejected` + `IsPassphraseRejectReason_ClassifiesOnlyBadSecretAndUnsecure` (reject reason khác được verify bằng unit test trực tiếp trên hàm phân loại, vì ép libsrt trả reject reason khác BADSECRET/UNSECURE qua loopback thật không khả thi ổn định); dòng 5 → các test `ChannelActorReconnectTest.*`/`ChannelActorIOTest.*` hiện có, không regress.

**Không có gì incomplete/risky đáng kể** ngoài 2 điểm đã ghi vào `deferred-work.md`: dải port 41156-41169 dự kiến trong Code Map ban đầu không dùng hết, và khoảng trống quan sát vận hành cho kênh kẹt REJECTED vĩnh viễn (thuộc Story 1.8/Epic 2).

**Code review (2026-09-01, 3 layer song song — blind-hunter, edge-case-hunter, verification-gap):** không có finding nào thuộc `intent_gap`/`bad_spec` (không loopback, `review_loop_iteration` giữ nguyên 0). 4 finding `patch` đã áp dụng và verify lại bằng build+test thật (83/83 pass, chạy 3 lần không flake) — xem chi tiết trong `## Spec Change Log`. 11 finding còn lại của blind-hunter bị reject sau khi verify chéo với code/test thật. 1 finding "Other" của verification-gap được defer.

## Suggested Review Order

**Phân loại reject reason + routing REJECTED-vs-RECONNECTING (lõi story)**

- Entry point — quyết định thật: passphrase-reject → `REJECTED`, mọi lỗi connect khác → `RECONNECTING`, không còn phân biệt theo `everConnected`.
  [`ChannelActor.cpp:473`](../../transport-core/src/srt/ChannelActor.cpp#L473)

- Bắt `SrtHandshakeRejectedError` riêng trước `SrtError` để lấy cờ `isPassphraseRejection()`.
  [`ChannelActor.cpp:457`](../../transport-core/src/srt/ChannelActor.cpp#L457)

- Phân loại có cấu trúc tại nguồn: `SRT_ECONNREJ` → luôn `SrtHandshakeRejectedError`, cờ tính qua `isPassphraseRejectReason()`.
  [`SrtSocket.cpp:200`](../../transport-core/src/srt/SrtSocket.cpp#L200)

- Chỉ `SRT_REJ_BADSECRET`/`SRT_REJ_UNSECURE` được coi là passphrase-reject — hằng số pin bằng `static_assert` chống libsrt đổi enum.
  [`SrtSocket.h:60`](../../transport-core/src/srt/SrtSocket.h#L60)

**Backoff riêng cho REJECTED (không còn kết thúc actor)**

- Vòng lặp REJECTED tự retry vô hạn với `nextRejectBackoff()`, không `throw`/không kết thúc actor (khác Story 1.1/1.2).
  [`ChannelActor.cpp:595`](../../transport-core/src/srt/ChannelActor.cpp#L595)

- Backoff riêng biệt hoàn toàn: `rejectBackoffInitial_{5s}`/`rejectBackoffMax_{60s}`/`currentRejectBackoff_`.
  [`ChannelActor.h:440`](../../transport-core/src/srt/ChannelActor.h#L440)

**Audit envelope (AD-30)**

- Build `EventEnvelope` + log JSON-lines hiện có tại đúng thời điểm vào `REJECTED`.
  [`ChannelActor.cpp:479`](../../transport-core/src/srt/ChannelActor.cpp#L479)

- Struct envelope dùng chung schema — nền tảng Story 1.8 tái dùng.
  [`EventEnvelope.h:1`](../../transport-core/src/telemetry/EventEnvelope.h#L1)

- Getter test-only snapshot envelope gần nhất, copy ra khỏi lock để tránh alias với lần REJECTED sau.
  [`ChannelActor.cpp:281`](../../transport-core/src/srt/ChannelActor.cpp#L281)

**Patch từ code review (seam test + DRY)**

- Seam `setConnectToOverrideForTesting()` (mirror `setSourceFactoryForTesting()`) — cho phép test ép `SrtHandshakeRejectedError` bất kỳ để verify routing thật ở `ChannelActor`, không chỉ ở free-function.
  [`ChannelActor.cpp:76`](../../transport-core/src/srt/ChannelActor.cpp#L76)

- Hằng số dùng chung `kHandshakeRejectEventType`, tránh desync giữa log và envelope.
  [`ChannelActor.cpp:21`](../../transport-core/src/srt/ChannelActor.cpp#L21)

**Test (I/O Matrix + patch verification)**

- Test đóng đúng gap review: `SrtHandshakeRejectedError` với `isPassphraseRejection()==false` phải ra `RECONNECTING`, không phải `REJECTED`.
  [`test_channel_actor_rejected.cpp:384`](../../transport-core/tests/test_channel_actor_rejected.cpp#L384)

- Test đối chứng: cùng seam nhưng `isPassphraseRejection()==true` phải ra `REJECTED` + envelope.
  [`test_channel_actor_rejected.cpp:414`](../../transport-core/tests/test_channel_actor_rejected.cpp#L414)

- Passphrase sai lần đầu → `REJECTED`, log + envelope đúng, không lộ passphrase thật.
  [`test_channel_actor_rejected.cpp:177`](../../transport-core/tests/test_channel_actor_rejected.cpp#L177)

- Backoff nhân đôi 5s→60s trần, và reset cả 2 backoff khi phục hồi `CONNECTED`.
  [`test_channel_actor_rejected.cpp:279`](../../transport-core/tests/test_channel_actor_rejected.cpp#L279)
  [`test_channel_actor_rejected.cpp:449`](../../transport-core/tests/test_channel_actor_rejected.cpp#L449)

- 2 test wrong-passphrase cũ (Story 1.1) cập nhật: assert `REJECTED` + actor còn sống, không còn `hasFailed()`.
  [`test_srt_loopback_e2e.cpp:215`](../../transport-core/tests/test_srt_loopback_e2e.cpp#L215)

- Test reconnect cũ đổi hành vi: passphrase-reject SAU khi đã từng `CONNECTED` giờ cũng ra `REJECTED`, không còn `RECONNECTING`.
  [`test_channel_actor_reconnect.cpp:484`](../../transport-core/tests/test_channel_actor_reconnect.cpp#L484)

- Đăng ký file mới + link `nlohmann_json` cho test binary.
  [`CMakeLists.txt:37`](../../transport-core/tests/CMakeLists.txt#L37)
