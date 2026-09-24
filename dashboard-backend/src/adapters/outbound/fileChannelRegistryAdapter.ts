// Story 2.2: adapter thật duy nhất implement `ChannelRegistryPort` - thay
// `FileBitrateBaselineAdapter` (Story 2.1, đọc 1 lần lúc khởi động, không
// reload). Lõi của story này: hot-reload không restart process (Intent -
// vi phạm AD-24/AD-26 nếu thêm/sửa 1 kênh bắt buộc restart, gián đoạn các
// kênh khác đang giám sát tốt).
//
// - Khởi động (constructor): đọc + parse + validate ĐỒNG BỘ, throw rõ ràng
//   nếu lỗi (fail-fast tại composition root - `app/main.ts` bọc lỗi này
//   thành 1 thông báo dễ hiểu hơn, xem `startApp()`).
// - `start()`: watch file bằng `chokidar` (code review vòng 2: `fs.watch`
//   built-in đã bị 2 layer review độc lập phát hiện đúng rủi ro mà Ask First
//   của Boundaries/Design Notes cảnh báo trước - atomic-rename save có thể
//   khiến watch mất tracking mà không phát 'error' nào, và watcher không tự
//   tái tạo sau 1 lần 'error' thật - hot-reload "chết lặng" vĩnh viễn tới
//   khi restart process, đi ngược thẳng Intent của story. Người dùng đã
//   được hỏi và CHỌN thêm dependency `chokidar` để xử lý đúng atomic-rename
//   + có `'error'` event vẫn được log như cũ), debounce >=300ms coalesce
//   nhiều fs event của cùng 1 lần lưu file (debounce vẫn tự triển khai ở
//   đây, không dựa vào `awaitWriteFinish` của chokidar, để giữ nguyên hành
//   vi/test đã có).
// - Reload (sau debounce): validate TOÀN BỘ nội dung mới; hợp lệ -> hoán
//   đổi tham chiếu Map mới (KHÔNG mutate Map cũ, tránh lookup đang chạy
//   song song thấy Map nửa-vời) rồi mới log `registry_reload_success`; lỗi
//   -> GIỮ NGUYÊN Map đang phục vụ, log `registry_reload_error`, không
//   throw/crash process.
// - `stop()`: đóng watcher + huỷ debounce timer đang chờ (nếu có).

import { readFileSync } from 'node:fs';
import { watch as watchFile, type FSWatcher } from 'chokidar';
import type { ChannelRegistryEntry, ChannelRegistryPort } from '../../ports/ChannelRegistryPort.js';
import type { Logger } from '../../logging/logger.js';

const GRID_POSITION_MIN = 0;
const GRID_POSITION_MAX = 19;

// Boundaries: "Debounce watcher (>=300ms)". Configurable qua options CHỈ để
// test (Code Map: "trigger reload qua gọi trực tiếp method internal thay vì
// chờ debounce thật" cho test hot-reload success/error - test debounce
// coalescing riêng dùng 1 giá trị nhỏ hơn qua option này để không phải chờ
// thật 300ms+, tránh flaky theo thời gian mà vẫn test được cơ chế thật).
const DEFAULT_DEBOUNCE_MS = 300;

export interface FileChannelRegistryAdapterOptions {
  debounceMs?: number;
}

interface RawRegistryEntry {
  station_name?: unknown;
  contact_name?: unknown;
  contact_phone?: unknown;
  grid_position?: unknown;
  baseline_kbps?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  // Code review [patch]: `length > 0` chấp nhận chuỗi toàn khoảng trắng (vd
  // " ") như 1 giá trị hợp lệ - trim() trước khi check để đúng tinh thần
  // "non-empty" (dữ liệu trắng-nhìn-như-rỗng không nên lọt qua validate).
  return typeof value === 'string' && value.trim().length > 0;
}

// Code review [patch]: `JSON.parse` âm thầm ghi đè khi gặp key trùng ở CÙNG
// 1 object (chỉ giữ giá trị cuối, entry trước mất) - không có cách nào phát
// hiện điều này từ kết quả `parsed` (đã bị dedupe). Scan trực tiếp trên text
// gốc, chỉ xét key ở độ sâu 1 (top-level, tức các channel_id) - bỏ qua field
// bên trong từng entry (station_name/contact_name/...) vốn không phải nơi
// cần phát hiện trùng lặp.
function findDuplicateTopLevelKey(raw: string): string | undefined {
  const seen = new Set<string>();
  let depth = 0;
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch === '"') {
      const start = i + 1;
      i++;
      while (i < raw.length && raw.charAt(i) !== '"') {
        if (raw.charAt(i) === '\\') i++;
        i++;
      }
      const key = raw.slice(start, i);
      i++; // bỏ qua dấu " đóng
      if (depth === 1) {
        let j = i;
        while (j < raw.length && /\s/.test(raw.charAt(j))) j++;
        if (raw.charAt(j) === ':') {
          if (seen.has(key)) return key;
          seen.add(key);
        }
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return undefined;
}

// Validate + parse TOÀN BỘ file - throw ngay tại entry đầu tiên sai, không
// trả về 1 Map một-phần (Boundaries: "Toàn bộ file bị từ chối nếu >=1 entry
// sai (không load một phần)"). Dùng chung cho cả load lúc khởi động lẫn mỗi
// lần reload - đúng yêu cầu "Validate mỗi entry lúc load (khởi động lẫn
// reload)".
function loadAndValidate(filePath: string): Map<string, ChannelRegistryEntry> {
  // Code review [patch]: `readFileSync(..., 'utf8')` KHÔNG tự strip BOM
  // (U+FEFF) - 1 file lưu bằng Notepad trên Windows (môi trường triển khai
  // thực tế của dịch vụ này) thường có BOM ở đầu file. `JSON.parse` coi ký tự
  // này là token lạ và throw ngay, dẫn tới lỗi "không phải JSON hợp lệ" chung
  // chung dù nội dung JSON phía sau hoàn toàn hợp lệ. Strip trước khi parse -
  // không ảnh hưởng file không có BOM (regex không khớp gì, raw giữ nguyên).
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Channel-registry config tại "${filePath}" không phải JSON hợp lệ: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Channel-registry config tại "${filePath}" phải là 1 JSON object dạng {channel_id: {...}}`);
  }

  const duplicateChannelId = findDuplicateTopLevelKey(raw);
  if (duplicateChannelId !== undefined) {
    throw new Error(
      `Channel-registry config tại "${filePath}": channel_id="${duplicateChannelId}" xuất hiện nhiều hơn 1 lần ` +
        `trong cùng file - JSON.parse chỉ giữ giá trị cuối cùng và âm thầm bỏ giá trị trước, không được phép.`
    );
  }

  const registry = new Map<string, ChannelRegistryEntry>();
  // Boundaries: "grid_position ... KHÔNG trùng giữa các kênh trong cùng
  // file" - theo dõi vị trí đã dùng để phát hiện trùng lặp trong 1 lần load.
  const usedGridPositions = new Map<number, string>();

  for (const [channelId, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isNonEmptyString(channelId)) {
      throw new Error(`Channel-registry config tại "${filePath}": channel_id rỗng không hợp lệ.`);
    }
    if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
      throw new Error(
        `Channel-registry config tại "${filePath}": entry cho channel_id="${channelId}" phải là 1 JSON object ` +
          `{station_name, contact_name, contact_phone, grid_position, baseline_kbps}.`
      );
    }
    const entry = rawValue as RawRegistryEntry;

    if (!isNonEmptyString(entry.station_name)) {
      throw new Error(`Channel-registry: channel_id="${channelId}" thiếu/rỗng station_name (phải là string non-empty).`);
    }
    if (!isNonEmptyString(entry.contact_name)) {
      throw new Error(`Channel-registry: channel_id="${channelId}" thiếu/rỗng contact_name (phải là string non-empty).`);
    }
    if (!isNonEmptyString(entry.contact_phone)) {
      throw new Error(`Channel-registry: channel_id="${channelId}" thiếu/rỗng contact_phone (phải là string non-empty).`);
    }

    const gridPosition = entry.grid_position;
    if (
      typeof gridPosition !== 'number' ||
      !Number.isInteger(gridPosition) ||
      gridPosition < GRID_POSITION_MIN ||
      gridPosition > GRID_POSITION_MAX
    ) {
      throw new Error(
        `Channel-registry: channel_id="${channelId}" có grid_position không hợp lệ: ${JSON.stringify(gridPosition)} ` +
          `(phải là số nguyên ${GRID_POSITION_MIN}-${GRID_POSITION_MAX}).`
      );
    }
    const conflictingChannelId = usedGridPositions.get(gridPosition);
    if (conflictingChannelId !== undefined) {
      throw new Error(
        `Channel-registry: grid_position=${gridPosition} bị trùng giữa channel_id="${conflictingChannelId}" ` +
          `và channel_id="${channelId}" - mỗi vị trí lưới chỉ được gán cho đúng 1 kênh.`
      );
    }
    usedGridPositions.set(gridPosition, channelId);

    const baselineKbps = entry.baseline_kbps;
    if (typeof baselineKbps !== 'number' || !Number.isFinite(baselineKbps) || baselineKbps <= 0) {
      throw new Error(
        `Channel-registry: channel_id="${channelId}" có baseline_kbps không hợp lệ: ${JSON.stringify(baselineKbps)} ` +
          `(phải là số hữu hạn > 0, đơn vị kbps).`
      );
    }

    registry.set(channelId, {
      stationName: entry.station_name,
      contactName: entry.contact_name,
      contactPhone: entry.contact_phone,
      gridPosition,
      baselineKbps,
    });
  }

  // Code review [patch]: AC#1 "Given file tồn tại với >=1 kênh hợp lệ" -
  // 1 file `{}` (JSON object rỗng) trước đây lọt qua mọi validate ở trên
  // (vòng lặp for...of trên 0 entry không throw gì) và tạo ra 1 registry 0
  // kênh "hợp lệ" - lúc khởi động nghĩa là service start "thành công" nhưng
  // không giám sát được channel_id nào; lúc reload nghĩa là 1 lần lưu file
  // rỗng do nhầm lẫn sẽ ÂM THẦM xoá sạch toàn bộ 20 kênh đang giám sát. Chặn
  // tường minh - áp dụng cho cả khởi động (throw ra composition root, đúng
  // fail-fast hiện có) lẫn reload (đã được `reload()` catch sẵn -> log
  // `registry_reload_error`, giữ nguyên registry cũ).
  if (registry.size === 0) {
    throw new Error(`Channel-registry config tại "${filePath}" không có kênh nào - phải có ít nhất 1 channel_id.`);
  }

  return registry;
}

export class FileChannelRegistryAdapter implements ChannelRegistryPort {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly debounceMs: number;
  // Không `readonly` - đây CHÍNH LÀ tham chiếu Map "đang phục vụ" được hoán
  // đổi nguyên tử mỗi lần reload thành công (Boundaries: "hoán đổi tham
  // chiếu Map mới, không mutate Map cũ").
  private registry: Map<string, ChannelRegistryEntry>;
  private watcher: FSWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  // spec-epic2-item-10-12: listener(s) gọi khi 1 lần reload() THÀNH CÔNG gỡ
  // bỏ >=1 channel_id khỏi registry (hoán đổi Map cũ -> mới) - dọn Map
  // theo-channelId ở nơi khác (ChannelStateService/BitrateHistoryService/
  // WsUiAdapterHandle) không bao giờ tự biết registry vừa gỡ kênh nào nếu
  // không có điểm phát tín hiệu duy nhất này. Mảng thường (không Set) - hỗ
  // trợ đăng ký nhiều listener, giữ đúng thứ tự đăng ký.
  private readonly entriesRemovedListeners: Array<(ids: readonly string[]) => void> = [];

  constructor(filePath: string, logger: Logger, options?: FileChannelRegistryAdapterOptions) {
    this.filePath = filePath;
    this.logger = logger;
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    // Khởi động: lỗi đọc/parse/validate -> throw thẳng ra caller (composition
    // root fail-fast, giữ đúng hành vi Story 2.1) - KHÔNG log-and-continue.
    this.registry = loadAndValidate(filePath);
  }

  getEntry(channelId: string): ChannelRegistryEntry | undefined {
    return this.registry.get(channelId);
  }

  // Story 2.3: đọc THÊM từ đúng Map nội bộ đang phục vụ (`this.registry`) -
  // không cần đổi cấu trúc lưu trữ (đã là Map<channelId, entry>, đủ để liệt
  // kê toàn bộ mà không cần Ask First). Snapshot tại thời điểm gọi - nếu
  // reload() hoán đổi `this.registry` ngay sau đó, mảng trả về ở đây KHÔNG
  // bị ảnh hưởng (đã copy ra Array, không giữ tham chiếu Map).
  listEntries(): ReadonlyArray<ChannelRegistryEntry & { channelId: string }> {
    return Array.from(this.registry.entries()).map(([channelId, entry]) => ({ channelId, ...entry }));
  }

  // spec-epic2-item-10-12: đăng ký listener nhận danh sách channel_id vừa bị
  // gỡ khỏi registry (chỉ gọi từ `reload()`, nhánh THÀNH CÔNG, khi
  // `removed.length > 0` - nhánh lỗi validate/giữ registry cũ KHÔNG bao giờ
  // gọi). Hỗ trợ đăng ký nhiều listener (`main.ts` là caller duy nhất hiện
  // tại, nhưng không giới hạn 1).
  onEntriesRemoved(listener: (ids: readonly string[]) => void): void {
    this.entriesRemovedListeners.push(listener);
  }

  // Watch file bằng `chokidar` (code review vòng 2 - xem comment đầu file) -
  // mọi fs event ('add'/'change'/'unlink') coalesce qua debounce trước khi
  // thực sự reload (`scheduleReload`). Idempotent nếu gọi lại (đóng watcher
  // cũ nếu có, tránh rò rỉ 2 watcher cùng lúc).
  start(): void {
    void this.watcher?.close();
    // `ignoreInitial: true` - constructor đã load nội dung hiện tại đồng bộ
    // rồi, không cần chokidar tự bắn 1 event 'add' ngay lúc watch() để rồi
    // reload lại y hệt nội dung vừa load (vừa lãng phí vừa log 1 dòng
    // `registry_reload_success` giả ngay lúc khởi động).
    this.watcher = watchFile(this.filePath, { ignoreInitial: true });
    this.watcher.on('all', () => this.scheduleReload());
    // Code review [patch]: `FSWatcher` (chokidar) là 1 EventEmitter - nếu
    // watcher gặp lỗi hệ thống (file bị xoá, đổi quyền, filesystem không hỗ
    // trợ...) mà KHÔNG có listener 'error' nào gắn, Node coi đây là unhandled
    // exception -> CRASH CẢ TIẾN TRÌNH. Vi phạm thẳng Boundaries "Sau khi đã
    // chạy... KHÔNG throw, KHÔNG crash process" - log rõ ràng, giữ nguyên
    // registry đang phục vụ, không throw (cùng tinh thần `reload()`'s catch
    // bên dưới).
    this.watcher.on('error', (err: unknown) => {
      this.logger.log({
        channel_id: '',
        event_type: 'registry_watch_error',
        reason: String((err as Error)?.message ?? err),
      });
    });
  }

  stop(): void {
    // chokidar's close() trả về Promise - không await (stop() giữ nguyên
    // signature đồng bộ như trước, phù hợp cách main.ts gọi `registryPort.
    // stop()` không chờ trong `AppHandle.stop()`); best-effort đóng handle,
    // không có gì phải chờ ở đây lúc shutdown.
    void this.watcher?.close();
    this.watcher = undefined;
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.reload();
    }, this.debounceMs);
  }

  // Test hook (Code Map/Boundaries: "test hot-reload ... trigger reload qua
  // gọi trực tiếp method internal thay vì chờ debounce thật, tránh flaky
  // theo thời gian") - production chỉ gọi qua `scheduleReload()` (watcher
  // callback, sau debounce). Public để test import trực tiếp không cần chờ
  // timer thật.
  reload(): void {
    try {
      const previousRegistry = this.registry;
      const next = loadAndValidate(this.filePath);
      // Hoán đổi tham chiếu - Map cũ (`this.registry` trước dòng này) không
      // bị mutate, lookup đang chạy song song giữ tham chiếu Map cũ vẫn đọc
      // được dữ liệu nhất quán tới khi nào chúng tự đọc lại field này.
      this.registry = next;
      this.logger.log({
        channel_id: '',
        event_type: 'registry_reload_success',
        reason: String(next.size),
      });

      // spec-epic2-item-10-12: diff registry CŨ (trước hoán đổi) với registry
      // MỚI (`next`, đã hoán đổi ở trên) - channel_id nào có ở cũ nhưng không
      // còn ở mới nghĩa là VỪA bị gỡ khỏi lần reload thành công này. Chỉ tính
      // toán/gọi listener khi thực sự có kênh bị gỡ (Boundaries: "Reload chỉ
      // đổi metadata, không gỡ kênh -> không gọi listener/log gì thêm").
      const removed = [...previousRegistry.keys()].filter((id) => !next.has(id));
      if (removed.length > 0) {
        for (const listener of this.entriesRemovedListeners) {
          listener(removed);
        }
      }
    } catch (err) {
      // Sau khi đã chạy: lỗi -> GIỮ NGUYÊN Map đang phục vụ (`this.registry`
      // không đổi), chỉ log, KHÔNG throw/crash process.
      this.logger.log({
        channel_id: '',
        event_type: 'registry_reload_error',
        reason: `${(err as Error).message} (path="${this.filePath}")`,
      });
    }
  }
}
