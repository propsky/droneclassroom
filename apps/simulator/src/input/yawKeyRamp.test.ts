import { describe, expect, it } from 'vitest';
import { YawKeyRamp } from './yawKeyRamp';

describe('方向鍵轉向漸進', () => {
  it('剛按下給一部分，按住 15 tick 到滿速，之後維持滿速', () => {
    const r = new YawKeyRamp();
    expect(r.next(1)).toBeCloseTo(YawKeyRamp.START);
    for (let i = 1; i < YawKeyRamp.RAMP_TICKS; i++) r.next(1);
    expect(r.next(1)).toBe(1);
    expect(r.next(1)).toBe(1);
  });

  it('越按越快，不會倒退', () => {
    const r = new YawKeyRamp();
    let prev = 0;
    for (let i = 0; i < 20; i++) {
      const k = r.next(1);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it('右轉是負的；放開歸零；換方向從頭開始', () => {
    const r = new YawKeyRamp();
    for (let i = 0; i < 30; i++) r.next(1);
    expect(r.next(-1)).toBeCloseTo(-YawKeyRamp.START);
    expect(r.next(0)).toBe(0);
    expect(r.next(-1)).toBeCloseTo(-YawKeyRamp.START);
  });

  it('同時按左右（抵銷）當沒按', () => {
    const r = new YawKeyRamp();
    expect(r.next(0)).toBe(0);
  });
});
