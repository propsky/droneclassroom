import { describe, expect, it } from 'vitest';
import { MotorSound, type Motion, type MotorMixInput } from './motorMix';

const still: Motion = { forward: 0, right: 0, climb: 0, turn: 0 };
const input = (over: Partial<MotorMixInput> = {}): MotorMixInput => ({
  motion: still,
  flying: true,
  enabled: true,
  paused: false,
  hidden: false,
  ...over,
});

describe('馬達聲：四顆馬達的負載', () => {
  it('懸停：四顆一樣', () => {
    expect(MotorSound.loads(still)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('上升四顆一起加，下降一起減', () => {
    const up = MotorSound.loads({ ...still, climb: 1 });
    const down = MotorSound.loads({ ...still, climb: -1 });
    expect(up.every((v) => v > 0.5)).toBe(true);
    expect(down.every((v) => v < 0.5)).toBe(true);
  });

  it('往前飛：後面兩顆比前面兩顆轉得快', () => {
    const [fl, fr, rl, rr] = MotorSound.loads({ ...still, forward: 1 });
    expect(rl!).toBeGreaterThan(fl!);
    expect(rr!).toBeGreaterThan(fr!);
  });

  it('往右飛：左邊兩顆比右邊快', () => {
    const [fl, fr, rl, rr] = MotorSound.loads({ ...still, right: 1 });
    expect(fl!).toBeGreaterThan(fr!);
    expect(rl!).toBeGreaterThan(rr!);
  });

  it('全部推滿也在 0.1..1 之間', () => {
    for (const v of MotorSound.loads({ forward: 1, right: 1, climb: 1, turn: 1 })) {
      expect(v).toBeGreaterThanOrEqual(0.1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('馬達聲：要不要出聲', () => {
  it('飛行中、開著才響', () => {
    expect(MotorSound.mix(input()).master).toBe(MotorSound.MASTER);
  });

  it('在地上、關掉、暫停、切走分頁都不響', () => {
    expect(MotorSound.mix(input({ flying: false })).master).toBe(0);
    expect(MotorSound.mix(input({ enabled: false })).master).toBe(0);
    expect(MotorSound.mix(input({ paused: true })).master).toBe(0);
    expect(MotorSound.mix(input({ hidden: true })).master).toBe(0);
  });

  it('上升時音調比懸停高，槳流也比較大聲', () => {
    const hover = MotorSound.mix(input());
    const climb = MotorSound.mix(input({ motion: { ...still, climb: 1 } }));
    expect(climb.voices[0]!.freq).toBeGreaterThan(hover.voices[0]!.freq);
    expect(climb.wash.gain).toBeGreaterThan(hover.wash.gain);
  });

  it('兩葉槳：葉片通過頻率（第 2 諧波）最強', () => {
    const h = MotorSound.harmonics(2);
    const strongest = Array.from(h).indexOf(Math.max(...h));
    expect(strongest).toBe(2);
  });
});
