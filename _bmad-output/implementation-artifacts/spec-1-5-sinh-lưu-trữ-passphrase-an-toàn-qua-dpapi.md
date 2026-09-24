---
title: 'Story 1.5: Sinh & lưu trữ passphrase an toàn qua DPAPI'
type: 'feature'
created: '2026-09-01'
status: 'done'
baseline_commit: '3cf689fcdebd7f636258f439e1eded53f3b27b0b'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ChannelConfig.passphrase` hiện là plaintext do người tự gõ vào file JSON (`configs/example_*.json`: `"change-me-per-channel-10chars-min"`) — đúng anti-pattern AC#1 cấm (không ngẫu nhiên, không mã hoá tại chỗ). AD-7 (DPAPI) chưa có 1 dòng code nào trong repo.

**Approach:** Thêm `PassphraseGenerator` (CSPRNG `BCryptGenRandom`, 24 byte → base64, 192-bit entropy, vẫn khớp bounds `[10,79]` hiện có) + `ConfigEncryption` (DPAPI `CryptProtectData`/`CryptUnprotectData`, scope `CRYPTPROTECT_LOCAL_MACHINE`). `ChannelConfig::loadFromFile()` (đường production duy nhất) đổi sang LUÔN yêu cầu file là DPAPI blob — không còn đọc plaintext. Thêm tool CLI mới `transport-provision-config` (đọc seed JSON không-bí-mật + tự sinh hoặc nhận passphrase đã thoả thuận, ghi ra file DPAPI-encrypted) vì không còn cách nào "chỉnh tay" 1 ciphertext.

## Boundaries & Constraints

**Always:**
- Passphrase mới luôn sinh qua CSPRNG thật (`BCryptGenRandom`), không có API nào cho phép người dùng tự đặt giá trị làm passphrase MỚI — `--passphrase <value>` của tool chỉ dùng để PAIR máy thứ 2 với giá trị đã sinh sẵn ở máy thứ 1 (cùng kênh phải cùng 1 khoá).
- Passphrase sinh ra ≥128-bit entropy thật (24 byte ngẫu nhiên = 192-bit → base64 ~32 ký tự), luôn nằm trong `[10,79]` — không đổi `validate()` hiện có.
- `ChannelConfig::loadFromFile()` LUÔN decrypt DPAPI trước khi parse JSON — không còn nhánh đọc plaintext nào trong đường production (khớp triết lý "không rơi về chế độ kém an toàn hơn" đã áp dụng nhất quán từ AD-6 tới Story 1.4). Không phải bug scope — đây là thay đổi hành vi CỐ Ý, kéo theo phải sửa toàn bộ fixture-writer của `test_channel_config.cpp` (hiện ghi plaintext) sang ghi DPAPI-encrypted.
- `ChannelConfig::saveEncrypted()` luôn gọi `validate(cfg)` trước khi mã hoá/ghi đĩa.
- `aes_key_length=0`/rỗng vẫn bị chặn tại `validate()` như Story 1.1 (AC#3) — không đổi logic đó, chỉ xác nhận không regress.

**Ask First:** Không có — thiết kế tool provisioning tối giản + quyết định "không fallback plaintext" đã chốt qua khảo sát code/triết lý hiện có của codebase.

**Never:** Không tự động truyền passphrase qua mạng giữa 2 máy — chỉ in ra console 1 lần khi tool tự sinh, phân phối thủ công là quy trình RACI (AD-7), ngoài scope code. Không thêm entropy phụ/HSM cho `CryptProtectData`. Không tạo UI/prompt tương tác (`CRYPTPROTECT_UI_FORBIDDEN` luôn bật — headless, tương thích Windows Service tương lai).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Provisioning kênh mới, không truyền `--passphrase` | seed JSON hợp lệ (không có field `passphrase`) | Sinh passphrase ngẫu nhiên, in ra console 1 lần, ghi file DPAPI-encrypted | N/A |
| Provisioning máy thứ 2 cùng kênh | seed JSON + `--passphrase <giá trị đã sinh ở máy 1>` | Dùng đúng giá trị đó (qua `validate()` bounds), ghi file DPAPI-encrypted, KHÔNG in lại | Giá trị sai bounds → `ConfigError` |
| `loadFromFile()` trên file DPAPI hợp lệ (cùng máy đã encrypt) | Đúng blob | Decrypt + parse + validate thành công, trả `ChannelConfig` như trước | N/A |
| `loadFromFile()` trên file KHÔNG phải DPAPI blob của máy này (plaintext, hoặc blob máy khác) | Bytes bất kỳ khác | `ConfigError` rõ ràng, không parse mù, không trả config rỗng | Không crash, không phân biệt nhầm với lỗi JSON |
| `loadFromFile()` trên DPAPI blob decrypt được nhưng nội dung không phải JSON hợp lệ | Blob decrypt ok, payload là rác | `ConfigError` báo JSON không hợp lệ (giữ nguyên hành vi cũ của `MalformedJson_ThrowsConfigError`) | N/A |
| Sinh passphrase nhiều lần liên tiếp | Gọi `generateRandomPassphrase()` N lần | Mỗi lần 1 giá trị khác nhau, không dùng chung khoá giữa các kênh | N/A |

</frozen-after-approval>

## Code Map

- `transport-core/src/config/PassphraseGenerator.h/.cpp` (MỚI) -- `generateRandomPassphrase()`: `BCryptGenRandom` 24 byte + base64 encode nội bộ (không thêm dependency) -- AC#1.
- `transport-core/src/config/ConfigEncryption.h/.cpp` (MỚI) -- `encryptConfigBytes(std::string)->std::vector<uint8_t>` / `decryptConfigBytes(std::vector<uint8_t>)->std::string`, `CryptProtectData`/`CryptUnprotectData` (`CRYPTPROTECT_LOCAL_MACHINE|CRYPTPROTECT_UI_FORBIDDEN`), throw `ConfigError` khi decrypt fail -- AC#2.
- `transport-core/src/config/ChannelConfig.h:38-41,54,61` -- xoá comment "plaintext this story"; thêm `static ChannelConfig loadSeedFromFile(path)` (parse 6 field không-bí-mật, KHÔNG đụng `passphrase`, không gọi `validate()`) + `static void saveEncrypted(const ChannelConfig&, path)` (validate + serialize JSON + `encryptConfigBytes` + ghi file binary).
- `transport-core/src/config/ChannelConfig.cpp:99-208` (`loadFromFile`) -- tách phần parse 6 field không-bí-mật hiện có thành helper nội bộ dùng chung với `loadSeedFromFile()`; `loadFromFile()` đổi bước đầu: đọc raw bytes → `decryptConfigBytes()` → `json::parse()` (thay `file >> root` trực tiếp) → giữ nguyên phần còn lại (đọc `passphrase`, gọi `validate()`).
- `transport-core/app/provision_channel_config.cpp` (MỚI) -- CLI: `<seed.json> <output-encrypted-path> [--passphrase <value>]`; `loadSeedFromFile()` → gán passphrase (sinh mới hoặc dùng arg) → `saveEncrypted()`; in passphrase ra stdout CHỈ khi tự sinh.
- `transport-core/app/CMakeLists.txt` -- thêm `add_executable(transport-provision-config provision_channel_config.cpp)` + link `transport_core` (mirror 2 executable hiện có).
- `transport-core/src/CMakeLists.txt:6-20,33-39` -- thêm 2 file `.cpp` mới vào `add_library`; thêm khối `if(WIN32) target_link_libraries(transport_core PRIVATE Crypt32 Bcrypt) endif()` (mirror khối `if(WIN32)` compile-definitions hiện có).
- `transport-core/configs/example_station.json`, `example_center.json` -- xoá field `passphrase` (giờ là seed cho tool, không còn passphrase thủ công).
- `transport-core/tests/test_channel_config.cpp` -- **~19 test case hiện có**: đổi fixture-writer từ ghi plaintext trực tiếp sang 1 helper dùng chung gọi `encryptConfigBytes()` trước khi ghi file (vì `loadFromFile()` không còn nhận plaintext); `MalformedJson_ThrowsConfigError` giữ nguyên Ý ĐỊNH (JSON rác SAU KHI decrypt) bằng cách encrypt chính nội dung rác đó; thêm test mới cho row 4 (blob không hợp lệ/không decrypt được); thêm test cho `PassphraseGenerator`/`ConfigEncryption`/`loadSeedFromFile`/`saveEncrypted`.
- `transport-core/tests/CMakeLists.txt` -- cập nhật comment block; không cần thêm file test mới nếu gộp vào `test_channel_config.cpp` (không cần link `Crypt32`/`Bcrypt` riêng vì test chỉ gọi qua API `config::` công khai, không include `<wincrypt.h>`/`<bcrypt.h>` trực tiếp).
- `transport-core/README.md:54-68`, `transport-core/docs/DEPLOY-2-MACHINES.md` (kiến trúc diagram, C.3, C.5, D.1, D.2, troubleshooting, danh sách binary đóng gói) -- không nằm trong Code Map gốc, nhưng hướng dẫn cũ (chỉnh tay `passphrase` vào JSON, chạy exe thẳng vào file plaintext) giờ SAI hoàn toàn (`loadFromFile()` sẽ báo `ConfigError`) -- cập nhật sang quy trình `transport-provision-config` + đóng gói thêm exe mới.
- `transport-core/src/config/ConfigEncryption.cpp:8-10`, `PassphraseGenerator.cpp:9-11` -- guard `#ifndef WIN32_LEAN_AND_MEAN`/`NOMINMAX` -- 2 macro này CMake đã define qua command-line (`add_compile_definitions` toàn cục hoặc tương tự), `#define` lại không điều kiện gây warning C4005 (vô hại nhưng nên dọn).

## Tasks & Acceptance

**Execution:**
- [x] `transport-core/src/config/PassphraseGenerator.h/.cpp` -- sinh passphrase CSPRNG -- AC#1.
- [x] `transport-core/src/config/ConfigEncryption.h/.cpp` -- DPAPI encrypt/decrypt whole-file -- AC#2.
- [x] `transport-core/src/config/ChannelConfig.h/.cpp` -- `loadFromFile()` yêu cầu DPAPI, thêm `loadSeedFromFile()`/`saveEncrypted()` -- nền tảng cho tool + test.
- [x] `transport-core/app/provision_channel_config.cpp` -- CLI provisioning duy nhất tạo ra file deploy được -- không còn cách "chỉnh tay" ciphertext.
- [x] `transport-core/app/CMakeLists.txt`, `transport-core/src/CMakeLists.txt` -- đăng ký file/target mới + link `Crypt32`/`Bcrypt` -- build không thiếu symbol.
- [x] `transport-core/configs/example_*.json` -- bỏ `passphrase` -- không còn gợi ý sai là tự đặt được.
- [x] `transport-core/tests/test_channel_config.cpp` -- migrate fixture sang DPAPI + test mới cho generator/encryption/seed/save -- verify AC bằng test thật, không regress 19 test cũ.
- [x] `transport-core/README.md`, `transport-core/docs/DEPLOY-2-MACHINES.md` -- cập nhật hướng dẫn build/deploy (chạy `transport-provision-config` thay vì chỉnh tay `passphrase`; đóng gói thêm exe mới) -- hệ quả bắt buộc, không nằm trong Code Map gốc nhưng docs sẽ sai/gây lỗi startup nếu không sửa.
- [x] `transport-core/src/config/ConfigEncryption.cpp`, `PassphraseGenerator.cpp` -- guard `#ifndef` cho `WIN32_LEAN_AND_MEAN`/`NOMINMAX` -- hết warning macro-redefinition (đã có sẵn qua CMake command-line define).

**Acceptance Criteria:**
- Given sinh passphrase mới, when gọi `generateRandomPassphrase()`, then kết quả ≥128-bit entropy (192-bit thực tế), độ dài trong `[10,79]`, khác nhau giữa các lần gọi.
- Given 1 `ChannelConfig` hợp lệ, when `saveEncrypted()`, then file ghi ra là DPAPI ciphertext (`CRYPTPROTECT_LOCAL_MACHINE`) -- không phải JSON đọc được trực tiếp.
- Given file đã `saveEncrypted()` trên máy hiện tại, when `loadFromFile()`, then decrypt + parse + validate thành công, trả đúng field như đã ghi.
- Given file KHÔNG phải DPAPI blob hợp lệ của máy này, when `loadFromFile()`, then `ConfigError` rõ ràng, không crash, không trả config rỗng/mặc định.
- Given `aes_key_length=0` hoặc rỗng, when `validate()`, then vẫn bị chặn như Story 1.1 -- không regress AC#3.

### Review Findings

**Code review (2026-09-02, 4 layer song song — blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor)** trên diff `3cf689f..d72d90e` — chạy sau vòng review nội bộ (2026-09-01) đã ghi trong Spec Change Log/deferred-work.md; các finding trùng với quyết định trước đó được giữ nguyên (không mở lại), chỉ finding mới hoặc có evidence sắc hơn mới được xử lý ở đây.

- [x] [Review][Patch] `PassphraseGenerator.h` comment trỏ sai tên flag `--passphrase` (thực tế là `--pair` sau patch review vòng trước) [transport-core/src/config/PassphraseGenerator.h:14] — **Fixed:** sửa comment thành `--pair`.
- [x] [Review][Patch] README.md/DEPLOY-2-MACHINES.md thiếu bước copy/rename `example_*.json` → `*-seed.json` trước khi chạy `transport-provision-config` — ví dụ dùng thẳng tên `center-seed.json`/`station-seed.json` không rõ nguồn gốc [transport-core/README.md:56, transport-core/docs/DEPLOY-2-MACHINES.md:252] — **Fixed:** thêm bước `Copy-Item`/hướng dẫn đặt tên tường minh ở cả 2 file.
- [x] [Review][Patch] Guard `seedPath == outputPath` trong `provision_channel_config.cpp` so sánh lexical, không canonicalize — 2 path khác cách viết cùng trỏ 1 file (khác case, relative/absolute) sẽ lọt guard [transport-core/app/provision_channel_config.cpp:56] — **Fixed:** đổi sang `std::filesystem::weakly_canonical()` trước khi so sánh; verify thủ công `.\seed.json` vs `seed.json` nay bị guard chặn đúng (trước patch sẽ lọt qua).
- [x] [Review][Patch] Nhánh tương tác `--pair` (không pipe) không tắt echo console khi đọc passphrase qua `std::getline(std::cin, ...)` — giá trị gõ tay hiện rõ trên màn hình [transport-core/app/provision_channel_config.cpp:82-83] — **Fixed:** thêm `ScopedConsoleEchoOff` (tắt `ENABLE_ECHO_INPUT` quanh lần đọc, tự khôi phục kể cả khi đọc lỗi; no-op an toàn khi stdin bị pipe).
- [x] [Review][Patch] Docs chưa có hướng dẫn khi mất passphrase (không cách khôi phục, DPAPI không cho xem lại) hoặc khi máy bị reimage (khoá DPAPI `LOCAL_MACHINE` mất theo OS, mọi file `.enc` vĩnh viễn không giải mã được — cần re-provision toàn bộ) [transport-core/README.md, transport-core/docs/DEPLOY-2-MACHINES.md] — **Fixed:** thêm 2 dòng troubleshooting trong `DEPLOY-2-MACHINES.md` Phần E.
- [x] [Review][Patch] Cú pháp `--pair` được document là `echo <giá trị> | transport-provision-config ... --pair` — ghi passphrase vào lịch sử shell (PSReadLine), đúng vector mà comment header của chính file đó nói đã tránh được qua thiết kế stdin; rủi ro thực tế thấp vì DPAPI scope `LOCAL_MACHINE` đã cho phép mọi process cùng máy tự decrypt được passphrase mà không cần đọc lịch sử shell [transport-core/README.md:15-26, transport-core/docs/DEPLOY-2-MACHINES.md:337-346] — **Fixed:** thêm cảnh báo + gợi ý dùng cách gõ tay không pipe nếu muốn tránh hẳn dấu vết, ở cả README.md và DEPLOY-2-MACHINES.md D.1.
- [x] [Review][Patch] `base64Encode()`'s 2 nhánh padding (`remaining==1`, `remaining==2`) là dead code không test — caller duy nhất luôn truyền đúng 24 byte (bội số 3) [transport-core/src/config/PassphraseGenerator.cpp:52,58] — **Fixed:** thêm comment ghi rõ đây là dead code với caller hiện tại, giữ logic cho khả năng tái sử dụng sau này (hàm nằm trong anonymous namespace, không expose được để unit-test riêng).
- [x] [Review][Patch] `--pair` đọc passphrase qua stdin không trim `\r`/whitespace cuối dòng — lệch 1 khoảng trắng/CR giữa 2 máy chỉ lộ ra gián tiếp qua lỗi bound hoặc `BADSECRET` sau này [transport-core/app/provision_channel_config.cpp:83] — **Fixed:** thêm `trimTrailingWhitespace()`. **Verify thủ công phát hiện thêm 1 bug thật khi test fix này**: pipe qua PowerShell (`"value" | exe`, tương đương cú pháp `echo <value> | ... --pair` mà docs khuyến nghị) chèn BOM UTF-8 (3 byte `EF BB BF`) vào ĐẦU stdin — round-trip DPAPI thật cho thấy passphrase lưu ra dài 11 byte thay vì 10 khi pipe `"abcdefghij"`. Đã thêm `stripLeadingUtf8Bom()` xử lý cùng lúc; verify lại round-trip DPAPI thật cho kết quả đúng 10 byte, khớp giá trị gốc.
- [x] [Review][Patch] Comment `saveEncrypted()` trong `ChannelConfig.h` không nói rõ hàm này SẼ ghi đè file đã tồn tại (khác với chính sách "never overwrite" mà CLI quảng bá) [transport-core/src/config/ChannelConfig.h:121] — **Fixed:** thêm đoạn "CONTRACT NOTE" nói rõ hành vi ghi đè và ranh giới trách nhiệm CLI vs library.
- [x] [Review][Patch] `remove(tmpPath)` trong `saveEncrypted()` bỏ qua error code khi cleanup thất bại sau khi ghi file tạm cũng đã thất bại — double-fault im lặng, không log cảnh báo [transport-core/src/config/ChannelConfig.cpp:383] — **Fixed:** gộp lỗi cleanup (nếu có) vào cùng message `ConfigError` đã throw, áp dụng cho cả 2 nhánh lỗi (ghi file tạm thất bại, rename thất bại).
- [x] [Review][Defer] Chưa có test tự động mức CLI cho `provision_channel_config.exe` (nhánh `--pair` đọc stdin-không-argv, guard `seed==output`, guard chặn ghi đè) [transport-core/app/provision_channel_config.cpp] — deferred, đã ghi nhận từ vòng review trước (2026-09-01, xem `deferred-work.md`); vòng này bổ sung evidence sắc hơn (xem `deferred-work.md`) nhưng giữ nguyên quyết định defer, không mở lại thành patch.

**Verify sau khi áp patch (2026-09-02):** build target `transport-provision-config` sạch, không lỗi (`cmake --build --preset windows-vcpkg --target transport-provision-config`, MSVC 14.51 qua `D:\VSBuildTools2`). Verify thủ công thật qua DPAPI round-trip: (1) guard `seed==output` nay chặn đúng `.\seed.json` vs `seed.json`; (2) guard chặn ghi đè vẫn hoạt động đúng; (3) `--pair` qua pipe PowerShell round-trip đúng 10 byte sau khi thêm cả trim lẫn BOM-strip. Không chạy được `ctest` toàn bộ suite lần này — `transport_core_tests.exe` link fail vì thiếu `AbrController` (Story 1.7, đang có 1 phiên khác chỉnh sửa live cùng thư mục `transport-core/` — `git status` cho thấy `src/pipeline/AbrController.*`, `src/srt/ChannelActor.*`, `src/pipeline/H264Encoder.*`, `tests/test_channel_actor_abr.cpp` đang dở dang, không liên quan đến patch của story 1.5 này). Không đụng tới các file đó.

**Dismissed (4):**
- `saveEncrypted()` không có guard chống ghi đè nội bộ / TOCTOU giữa `exists()` check và write của CLI — theo thiết kế: test `SaveEncrypted_OverwritesExistingFile_NoLeftoverTmp` tự khẳng định overwrite là hành vi cố ý ở tầng thư viện; CLI là điểm vào duy nhất cần guard và đã có; rủi ro race không đáng kể cho 1 tool chạy tay, 1 operator, không có concurrent writer.
- Passphrase đi qua nhiều bản copy trong bộ nhớ không được `SecureZeroMemory` — trùng finding đã ghi trong `deferred-work.md` từ vòng review trước (2026-09-01), không có evidence mới.
- Code Map của chính spec này (dòng ~51) còn ghi flag cũ `--passphrase <value>` — vấn đề tài liệu hoá của spec, không phải defect code, ngoài phạm vi code review.
- Completion Notes ghi "18 test mới" nhưng đếm thực tế trong diff là 19 — sai số tường thuật, không ảnh hưởng hành vi.

## Spec Change Log

<!-- Append-only, populated by step-04 review loops. -->

- [x] [Review][Patch] `--passphrase <value>` lộ secret qua argv (Task Manager command line, `wmic process get commandline`, lịch sử shell) — undermine chính mục tiêu bảo mật của story. **Fixed:** đổi sang flag `--pair` không mang giá trị, đọc qua stdin (`std::getline`); cập nhật README.md/DEPLOY-2-MACHINES.md sang cú pháp `echo <value> | ... --pair`.
- [x] [Review][Patch] `provision_channel_config.cpp`/`saveEncrypted()` không có bảo vệ ghi đè — chạy nhầm phá 1 file `.enc` đang chạy tốt, không guard `seed==output`. **Fixed:** thêm check tồn tại trước khi ghi (fail loud, không tự overwrite) + check `seedPath != outputPath`.
- [x] [Review][Patch] `saveEncrypted()` ghi trực tiếp (`trunc`), không atomic — lỗi giữa chừng để lại file hỏng. **Fixed:** ghi ra `path + ".tmp"` rồi `std::filesystem::rename()` (atomic), dọn temp file nếu lỗi. Thêm test `SaveEncrypted_OverwritesExistingFile_NoLeftoverTmp`.
- [x] [Review][Patch] `main()` chỉ bắt `ConfigError`, exception khác thoát ra ngoài không kiểm soát. **Fixed:** thêm `catch (const std::exception&)` bao ngoài, mirror `station_main.cpp`/`center_main.cpp`.
- [x] [Review][Patch] `encryptConfigBytes()`/`decryptConfigBytes()` cast `size_t`→`DWORD` không kiểm tra tràn. **Fixed:** thêm guard `size() > DWORD::max()` trước khi cast, khớp phong cách bound-check của `bitrate`/`latency_ms`.
- 4 finding khác (blind-hunter: secure-wipe cho bản copy passphrase trung gian, ACL file `.enc`; blind-hunter: chưa có migration path từ config plaintext cũ; verification-gap: chưa có test CLI-level cho `provision_channel_config.exe`) — **defer**, ghi vào `deferred-work.md`.
- Các finding còn lại (không có transport mạng an toàn để truyền passphrase giữa 2 máy, không versioning marker cho định dạng blob, typo field name không phân biệt được với field thiếu, channel_id có thể lệch giữa 2 máy nếu không đặt tên file nhất quán) — **reject**: hoặc đã explicitly out-of-scope theo Boundaries "Never" (RACI thủ công), hoặc pre-existing/không đổi bởi story này, hoặc thuần tuý speculative không có yêu cầu cụ thể.

## Design Notes

- "Mỗi máy chỉ giữ ĐÚNG 1 file cấu hình của kênh mình phụ trách" (AD-7) là kỷ luật vận hành, không code-enforce được (tool không biết máy có bao nhiêu file khác) -- ghi nhận, không phải gap.
- DPAPI `CRYPTPROTECT_LOCAL_MACHINE` không cho phép copy ciphertext giữa 2 máy khác nhau (khoá gắn máy) -- đây là LÝ DO tool cần chạy riêng trên từng máy với cùng giá trị `--passphrase`, không phải hạn chế của thiết kế.
- Không dùng optional entropy param của `CryptProtectData` (giữ tối giản, không cần lưu thêm bí mật nào khác ngoài chính OS-managed machine key).
- `loadSeedFromFile()` KHÔNG gọi `validate()` (vì `passphrase` cố ý để trống) -- caller (`provision_channel_config.cpp`) phải gán passphrase trước khi `saveEncrypted()` tự validate.

## Verification

**Commands:**
- `cmake --build build --config RelWithDebInfo && ctest --test-dir build --output-on-failure` -- build sạch, 19 test cũ (đã migrate) + test mới pass, chạy lại 3 lần không flake.

## Completion Notes

**Implementation (2026-09-01):** Subagent implement không có toolchain trong sandbox riêng (không `cmake`/`cl`) nên chỉ trace logic + review kỹ include order/type cast, không build/test thật. Orchestrator (phiên này) tự build+test thật bằng toolchain có sẵn (`C:\Program Files\CMake\bin`, MSVC qua `vcvars64.bat`, `VCPKG_ROOT`).

- `cmake --build build --config RelWithDebInfo` -- build sạch (19 target), không lỗi. Vòng đầu có 4 warning C4005 (macro redefinition `WIN32_LEAN_AND_MEAN`/`NOMINMAX`, vô hại) -- đã patch `#ifndef` guard, build lại sạch hoàn toàn không warning.
- `ctest --test-dir build --output-on-failure` -- **101/101 test pass** (83 cũ + 18 test mới: `PassphraseGeneratorTest` x4, `ConfigEncryptionTest` x3, `ChannelConfigTest`/`ChannelConfigValidateTest` mở rộng x11 gồm `LoadSeedFromFile_*`, `SaveEncrypted_*`, `PlaintextJsonIsNotADpapiBlob_ThrowsConfigError`, `ArbitraryGarbageBytes_ThrowsConfigError_NotCrash`, `HandBuiltConfigWithAesKeyLengthZero_Throws`). Chạy lại thêm 2 lần nữa (tổng 3 lần) -- pass cả 3, không flake.
- **Verify thủ công thật (không chỉ unit test)**: chạy `transport-provision-config.exe configs\example_station.json build\dai-01-encrypted.bin` -- in ra passphrase 32 ký tự, file output đúng là DPAPI blob thật (header GUID `01 00 00 00 D0 8C 9D DF...` chuẩn DPAPI). Chạy `transport-station.exe` với file `.enc` này -- load thành công, tiến vào vòng connect (không có `ConfigError`). Chạy lại với file seed plaintext gốc (`configs/example_station.json`, không qua provisioning) -- đúng như spec: `Config error: ... không phải DPAPI blob hợp lệ trên máy này`, exit 1, không crash.

**Phạm vi thực tế so với Code Map:** Đúng theo Code Map, cộng 2 hạng mục không nằm trong Code Map gốc nhưng bắt buộc: (1) `README.md`/`docs/DEPLOY-2-MACHINES.md` -- hướng dẫn build/deploy cũ dạy chỉnh tay `passphrase` vào JSON rồi chạy thẳng, giờ sai hoàn toàn (gây `ConfigError` ngay khi làm theo) -- đã cập nhật toàn bộ (kiến trúc diagram, C.3, C.5, D.1, D.2, troubleshooting, danh sách binary đóng gói `transport-provision-config.exe`); (2) guard `#ifndef` cho 2 macro Windows -- dọn warning phát sinh từ chính code mới.

**Không có gì incomplete/risky đáng kể.** Passphrase phân phối thủ công giữa 2 máy (in ra console 1 lần, operator tự copy) là quyết định CỐ Ý theo AD-7's RACI process, không phải thiếu sót.

**Code review (2026-09-01, 3 layer song song — blind-hunter, edge-case-hunter, verification-gap):** không có finding nào thuộc `intent_gap`/`bad_spec` (không loopback, `review_loop_iteration` giữ nguyên 0). 5 finding `patch` đã áp dụng và verify lại bằng build+test thật (102/102 pass, chạy 3 lần không flake) **cộng verify thủ công trực tiếp cả 5 patch qua CLI thật** (sinh mới, chặn ghi đè, chặn seed==output, `--pair` qua stdin không lộ argv, `--pair` sai bounds không để lại file) — xem chi tiết `## Spec Change Log`. 4 finding `defer` ghi vào `deferred-work.md`. Các finding còn lại bị reject (out-of-scope theo Boundaries, pre-existing, hoặc speculative).

## Suggested Review Order

**Sinh passphrase (CSPRNG)**

- CSPRNG thật (`BCryptGenRandom`) 24 byte → base64 nội bộ, 192-bit entropy — không cho phép giá trị tự chọn.
  [`PassphraseGenerator.cpp:71`](../../transport-core/src/config/PassphraseGenerator.cpp#L71)

**DPAPI encrypt/decrypt whole-file + guard tràn (patch review)**

- `encryptConfigBytes()`: bound-check `size_t`→`DWORD` trước khi narrow (patch), rồi `CryptProtectData` scope `LOCAL_MACHINE`.
  [`ConfigEncryption.cpp:35`](../../transport-core/src/config/ConfigEncryption.cpp#L35)

- `decryptConfigBytes()`: cùng guard tràn, `CryptUnprotectData` — không có nhánh fallback plaintext nào.
  [`ConfigEncryption.cpp:62`](../../transport-core/src/config/ConfigEncryption.cpp#L62)

**`ChannelConfig` đổi hành vi lõi (không còn plaintext)**

- Entry point — `loadFromFile()` giờ đọc raw bytes → decrypt → mới parse JSON, không còn `file >> root` trực tiếp.
  [`ChannelConfig.cpp:199`](../../transport-core/src/config/ChannelConfig.cpp#L199)

- `loadSeedFromFile()`: đọc seed plaintext không bí mật, cố ý KHÔNG đụng `passphrase`/không validate.
  [`ChannelConfig.cpp:239`](../../transport-core/src/config/ChannelConfig.cpp#L239)

- `saveEncrypted()`: validate trước, ghi atomic qua file `.tmp` + `rename()` (patch review).
  [`ChannelConfig.cpp:263`](../../transport-core/src/config/ChannelConfig.cpp#L263)
  [`ChannelConfig.cpp:305`](../../transport-core/src/config/ChannelConfig.cpp#L305)

**CLI provisioning mới (patch review: an toàn hoá)**

- `--pair` đọc passphrase qua stdin (không qua argv) — tránh lộ qua Task Manager/lịch sử shell.
  [`provision_channel_config.cpp:83`](../../transport-core/app/provision_channel_config.cpp#L83)

- Guard chặn ghi đè file output đã tồn tại (patch review) — fail loud, không tự overwrite.
  [`provision_channel_config.cpp:66`](../../transport-core/app/provision_channel_config.cpp#L66)

- `catch (const std::exception&)` bao ngoài `main()` (patch review) — không còn crash không kiểm soát.
  [`provision_channel_config.cpp:111`](../../transport-core/app/provision_channel_config.cpp#L111)

**Test (migrate 19 case cũ + test mới)**

- Helper dùng chung: mọi fixture `loadFromFile()` giờ ghi DPAPI ciphertext qua `encryptConfigBytes()`.
  [`test_channel_config.cpp:41`](../../transport-core/tests/test_channel_config.cpp#L41)

- Round-trip `saveEncrypted()` → `loadFromFile()`, và ciphertext không chứa passphrase/remote_ip dạng đọc được.
  [`test_channel_config.cpp:478`](../../transport-core/tests/test_channel_config.cpp#L478)

- Test đóng đúng patch review: ghi đè file cũ vẫn round-trip đúng, không để lại `.tmp` mồ côi.
  [`test_channel_config.cpp:531`](../../transport-core/tests/test_channel_config.cpp#L531)

- `loadFromFile()` trên plaintext/garbage bytes (không phải DPAPI blob của máy này) → `ConfigError`, không parse mù.
  [`test_channel_config.cpp:229`](../../transport-core/tests/test_channel_config.cpp#L229)

**Peripherals**

- Đăng ký file/target mới + link `Crypt32`/`Bcrypt`.
  [`src/CMakeLists.txt`](../../transport-core/src/CMakeLists.txt#L53)

- Bỏ field `passphrase` khỏi seed mẫu — không còn gợi ý sai là tự đặt được.
  [`configs/example_station.json`](../../transport-core/configs/example_station.json#L1)

- README/DEPLOY-2-MACHINES cập nhật quy trình `transport-provision-config` thay chỉnh tay `passphrase`.
  [`README.md`](../../transport-core/README.md#L54)

