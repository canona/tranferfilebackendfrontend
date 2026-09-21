// Story 4.1: âm báo động tại chỗ khi có cảnh báo mới (SM-1) - tổng hợp 1
// tiếng bíp qua Web Audio API (Never: "không dùng file audio nhị phân" - toàn
// bộ waveform sinh runtime bằng OscillatorNode/GainNode, KHÔNG thêm asset vào
// repo). Side-effect trình duyệt tách khỏi `channelStore` (store vẫn thuần,
// chỉ đếm `alertSoundToken`) - `app/page.tsx` gọi các hàm ở đây khi token đổi
// (Code Map).

const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_SEC = 0.3;
const BEEP_PEAK_GAIN = 0.2;

// AudioContext 1 lần dùng chung cho toàn phiên (Design Notes:
// "lazy-singleton") - trình duyệt giới hạn số lượng AudioContext đồng thời,
// và tái tạo mỗi lần phát sẽ mất luôn trạng thái 'suspended' đã được
// `primeAlertAudioContext()` resume sớm.
let sharedAudioContext: AudioContext | null = null;

// I/O matrix: "AudioContext bị trình duyệt chặn -> nuốt lỗi, console.warn 1
// lần" - tránh spam console nếu nhiều transition liên tiếp đều bị chặn.
let hasWarnedOnce = false;

function warnOnce(context: string, err: unknown): void {
  if (hasWarnedOnce) return;
  hasWarnedOnce = true;
  console.warn(`alertSound: ${context} thất bại - bỏ qua âm báo`, err);
}

function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  if (typeof window === 'undefined') return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  sharedAudioContext = new AudioContextCtor();
  return sharedAudioContext;
}

// Gọi sớm nhất có thể ngay sau tương tác đầu tiên của người dùng
// (`pointerdown`/`keydown` `{once:true}` ở page.tsx) - trình duyệt giữ
// AudioContext mới tạo ở trạng thái 'suspended' cho tới khi có gesture, nếu
// không resume sớm tiếng bíp đầu phiên có thể bị nuốt âm thầm (Design Notes,
// chấp nhận được - đã có bù thị giác từ Epic 2/3).
export function primeAlertAudioContext(): void {
  try {
    const ctx = getSharedAudioContext();
    ctx?.resume().catch(() => {
      // resume() reject (vd context đã closed) - vẫn không được crash, không
      // cần warn riêng vì playAlertBeep() sẽ tự retry/nuốt lỗi ở lần phát kế.
    });
  } catch (err) {
    warnOnce('primeAlertAudioContext', err);
  }
}

// Code review round 1 [patch]: kịch bản THẬT phổ biến nhất của "AudioContext
// bị trình duyệt chặn" (I/O matrix) KHÔNG throw - trình duyệt chỉ âm thầm giữ
// context ở trạng thái 'suspended' cho tới khi có gesture, `createOscillator`/
// `.start()`/`.stop()` vẫn chạy "thành công" nhưng không phát ra âm thanh
// nào. Cơ chế try/catch+warnOnce cũ chỉ bắt được lỗi THROW (vd constructor bị
// chặn hẳn) - không bắt được ca 'suspended' câm lặng này. Hàm này chủ động
// kiểm tra `ctx.state` và thử `resume()` + warn (đúng 1 lần, dùng chung
// `warnOnce`) nếu context vẫn không chạy sau khi thử - biến ca lỗi câm lặng
// thành 1 cảnh báo console quan sát được, đúng tinh thần Error Handling của
// I/O matrix.
function tryResumeIfSuspended(ctx: AudioContext): void {
  if (ctx.state === 'running') return;
  ctx
    .resume()
    .then(() => {
      if (ctx.state !== 'running') {
        warnOnce('playAlertBeep (AudioContext vẫn không chạy sau resume)', new Error(`state=${ctx.state}`));
      }
    })
    .catch((err) => {
      warnOnce('playAlertBeep (resume AudioContext suspended)', err);
    });
}

// Đúng 1 tiếng bíp tổng hợp (sine ~880Hz, envelope ngắn ~300ms) - gọi từ
// page.tsx mỗi lần `channelStore`'s `alertSoundToken` tăng (Boundaries: "đúng
// 1 lần/transition - không lặp, không cooldown"). Nuốt lỗi triệt để - KHÔNG
// được làm crash UI dù AudioContext bị trình duyệt chặn/không hỗ trợ.
export function playAlertBeep(): void {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    tryResumeIfSuspended(ctx);

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = BEEP_FREQUENCY_HZ;

    const now = ctx.currentTime;
    // Envelope ngắn: attack gần như tức thời (tránh click nghe được ở 0),
    // decay theo hàm mũ về gần 0 trước khi oscillator dừng.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(BEEP_PEAK_GAIN, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_DURATION_SEC);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + BEEP_DURATION_SEC);
  } catch (err) {
    warnOnce('playAlertBeep', err);
  }
}
