// Story 4.1: alertSound.ts - mock `AudioContext` toàn cục (jsdom không có
// Web Audio API thật), test gọi đúng API + nuốt lỗi (KHÔNG throw) khi
// AudioContext bị chặn/thiếu hoặc `.start()` lỗi (I/O matrix: "AudioContext
// bị trình duyệt chặn (chưa có gesture) -> catch, console.warn 1 lần").
//
// `vi.resetModules()` + dynamic `import()` mỗi test - module giữ
// `sharedAudioContext`/`hasWarnedOnce` dạng singleton module-scope, cần state
// SẠCH giữa các test để không lẫn AudioContext/cờ warn của test trước.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type MockOscillator = {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type MockGain = {
  gain: { setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
};

describe('alertSound (Story 4.1)', () => {
  let oscillator: MockOscillator;
  let gainNode: MockGain;
  let resume: ReturnType<typeof vi.fn>;
  let createOscillator: ReturnType<typeof vi.fn>;
  let createGain: ReturnType<typeof vi.fn>;
  // Code review round 2 [patch]: đếm số lần constructor `AudioContext` THẬT
  // SỰ được `new` - `createOscillator`/`createGain` là field gán = biến
  // ngoài dùng chung cho MỌI instance, nên assert qua chúng KHÔNG phát hiện
  // được regression bỏ cache singleton ở `getSharedAudioContext()` (Review
  // Findings round 1: "test không thực sự kiểm chứng singleton").
  let constructorCallCount = 0;
  const originalAudioContext = window.AudioContext;

  beforeEach(() => {
    vi.resetModules();
    constructorCallCount = 0;

    oscillator = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    gainNode = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    resume = vi.fn().mockResolvedValue(undefined);
    createOscillator = vi.fn(() => oscillator);
    createGain = vi.fn(() => gainNode);

    class MockAudioContext {
      currentTime = 0;
      destination = {};
      // Code review round 1 [patch]: mặc định 'running' - các test hiện có
      // (happy path) không nên tự động kích hoạt nhánh `tryResumeIfSuspended`
      // mới; test riêng cho nhánh 'suspended' khai báo state khác ở dưới.
      state: AudioContextState = 'running';
      createOscillator = createOscillator;
      createGain = createGain;
      resume = resume;

      constructor() {
        constructorCallCount += 1;
      }
    }

    // @ts-expect-error -- stub Web Audio API cho jsdom (không có sẵn)
    window.AudioContext = MockAudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it('playAlertBeep(): tạo đúng OscillatorNode sine + GainNode, connect oscillator->gain->destination, start/stop đúng 1 lần', async () => {
    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep();

    expect(createOscillator).toHaveBeenCalledTimes(1);
    expect(createGain).toHaveBeenCalledTimes(1);
    expect(oscillator.type).toBe('sine');
    expect(oscillator.frequency.value).toBe(880);
    expect(oscillator.connect).toHaveBeenCalledWith(gainNode);
    expect(gainNode.connect).toHaveBeenCalledTimes(1);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
  });

  it('primeAlertAudioContext(): gọi resume() trên AudioContext dùng chung', async () => {
    const { primeAlertAudioContext } = await import('../src/services/alertSound');
    primeAlertAudioContext();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  // Code review round 2 [patch]: nhánh happy-path phổ biến nhất
  // (`ctx.state === 'running'`, mock mặc định ở beforeEach) chưa từng được
  // assert là KHÔNG gọi resume() - trước đây chỉ nhánh 'suspended' có test.
  it('ctx.state="running" (mặc định) -> playAlertBeep() KHÔNG gọi resume()', async () => {
    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep();
    expect(resume).not.toHaveBeenCalled();
  });

  // Code review round 2 [patch]: nhánh "thiếu Web Audio API" đã test cho
  // playAlertBeep() nhưng chưa test cho primeAlertAudioContext() - entry
  // point thứ 2 cũng phải nuốt lỗi câm lặng tương tự.
  it('window.AudioContext không tồn tại -> primeAlertAudioContext() nuốt lỗi, không throw, không gọi resume', async () => {
    // @ts-expect-error -- xoá stub để mô phỏng thiếu Web Audio API
    window.AudioContext = undefined;
    const { primeAlertAudioContext } = await import('../src/services/alertSound');
    expect(() => primeAlertAudioContext()).not.toThrow();
    expect(resume).not.toHaveBeenCalled();
  });

  // Code review round 2 [patch]: `playAlertBeep(startOffsetSec)` lệch thời
  // điểm bắt đầu theo offset truyền vào - nền tảng cho stagger nhiều beep
  // trong CÙNG 1 batch React (page.tsx). `ctx.currentTime` mock = 0 nên
  // `start`/`stop` phải được gọi với đúng giá trị offset (Review Findings
  // round 1: "batched beeps chồng lấp").
  it('playAlertBeep(startOffsetSec): start/stop lệch đúng theo offset truyền vào', async () => {
    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep(0.6);

    expect(oscillator.start).toHaveBeenCalledWith(0.6);
    expect(oscillator.stop).toHaveBeenCalledWith(0.6 + 0.3);
    expect(gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 0.6);
  });

  it('playAlertBeep() gọi nhiều lần -> dùng lại CÙNG 1 AudioContext (lazy-singleton, Design Notes)', async () => {
    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep();
    playAlertBeep();
    playAlertBeep();
    // createOscillator gọi 3 lần (3 tiếng bíp)...
    expect(createOscillator).toHaveBeenCalledTimes(3);
    // ...nhưng constructor AudioContext chỉ được `new` ĐÚNG 1 lần (Code
    // review round 2 [patch]: assertion trực tiếp trên constructor call
    // count - trước đây chỉ verify gián tiếp qua createOscillator, vốn KHÔNG
    // phát hiện được nếu getSharedAudioContext() mất cache singleton).
    expect(constructorCallCount).toBe(1);
  });

  it('window.AudioContext không tồn tại (trình duyệt/jsdom thiếu Web Audio API) -> playAlertBeep() nuốt lỗi, không throw, không gọi createOscillator', async () => {
    // @ts-expect-error -- xoá stub để mô phỏng thiếu Web Audio API
    window.AudioContext = undefined;
    const { playAlertBeep } = await import('../src/services/alertSound');
    expect(() => playAlertBeep()).not.toThrow();
    expect(createOscillator).not.toHaveBeenCalled();
  });

  it('AudioContext constructor throw (bị trình duyệt chặn, chưa có gesture) -> playAlertBeep() nuốt lỗi, console.warn ĐÚNG 1 lần dù gọi lặp lại', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // @ts-expect-error -- stub constructor luôn throw
    window.AudioContext = class {
      constructor() {
        throw new Error('AudioContext blocked');
      }
    };

    const { playAlertBeep } = await import('../src/services/alertSound');
    expect(() => playAlertBeep()).not.toThrow();
    expect(() => playAlertBeep()).not.toThrow();
    expect(() => playAlertBeep()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('oscillator.start() throw -> playAlertBeep() nuốt lỗi, không throw ra ngoài', async () => {
    oscillator.start = vi.fn(() => {
      throw new Error('start failed');
    });
    const { playAlertBeep } = await import('../src/services/alertSound');
    expect(() => playAlertBeep()).not.toThrow();
  });

  // Code review round 1 [patch]: kịch bản THẬT phổ biến nhất của "bị trình
  // duyệt chặn" (I/O matrix) KHÔNG throw - context chỉ âm thầm ở 'suspended'.
  // playAlertBeep() phải chủ động gọi resume(), và KHÔNG warn nếu resume
  // thành công (state chuyển 'running').
  it('ctx.state="suspended" lúc gọi, resume() thành công (state->"running") -> playAlertBeep() tự gọi resume(), KHÔNG console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const contextState: { value: AudioContextState } = { value: 'suspended' };
    resume = vi.fn().mockImplementation(() => {
      contextState.value = 'running';
      return Promise.resolve();
    });
    class SuspendedThenRunningMockAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator = createOscillator;
      createGain = createGain;
      resume = resume;
      get state(): AudioContextState {
        return contextState.value;
      }
    }
    // @ts-expect-error -- stub Web Audio API cho jsdom
    window.AudioContext = SuspendedThenRunningMockAudioContext;

    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep();

    expect(resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // Ca "câm lặng" chính (không throw ở đâu cả) - resume() resolve nhưng
  // context VẪN 'suspended' sau đó (trình duyệt vẫn chặn, vd chưa có gesture
  // thật) - phải biến thành 1 console.warn quan sát được thay vì im lặng mãi.
  it('ctx.state VẪN "suspended" sau khi resume() resolve -> console.warn ĐÚNG 1 lần', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resume = vi.fn().mockResolvedValue(undefined);
    class StillSuspendedMockAudioContext {
      currentTime = 0;
      destination = {};
      state: AudioContextState = 'suspended';
      createOscillator = createOscillator;
      createGain = createGain;
      resume = resume;
    }
    // @ts-expect-error -- stub Web Audio API cho jsdom
    window.AudioContext = StillSuspendedMockAudioContext;

    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep();
    playAlertBeep();

    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('ctx.state="suspended", resume() reject -> console.warn ĐÚNG 1 lần', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resume = vi.fn().mockRejectedValue(new Error('resume blocked'));
    class RejectResumeMockAudioContext {
      currentTime = 0;
      destination = {};
      state: AudioContextState = 'suspended';
      createOscillator = createOscillator;
      createGain = createGain;
      resume = resume;
    }
    // @ts-expect-error -- stub Web Audio API cho jsdom
    window.AudioContext = RejectResumeMockAudioContext;

    const { playAlertBeep } = await import('../src/services/alertSound');
    playAlertBeep();

    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
