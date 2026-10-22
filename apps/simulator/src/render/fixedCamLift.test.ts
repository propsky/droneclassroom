import { describe, expect, it } from 'vitest';
import { FixedCamLift } from './fixedCamLift';

describe('FixedCamLift', () => {
  it('小誤差仍用原本 0.08，構圖不會突然跳', () => {
    const next = FixedCamLift.step(0, 3 + 8 + 0.2, 3, 8);
    expect(next).toBeCloseTo(0.2 * FixedCamLift.BASE_GAIN, 5);
  });

  it('手動滿舵爬升時落後不超過俯視餘裕', () => {
    // 終端爬升約 11 m/s。2-5 繪圖面 3m、餘裕 8m，再上去約 2m 就貼出畫面。
    let lift = 0;
    let y = 0.4;
    const climbPerFrame = 11 / 60;
    let maxLag = 0;
    for (let i = 0; i < 60 * 4; i++) {
      y += climbPerFrame;
      lift = FixedCamLift.step(lift, y, 3, 8);
      const want = FixedCamLift.wanted(y, 3, 8);
      maxLag = Math.max(maxLag, want - lift);
    }
    expect(maxLag).toBeLessThan(1.2);
    expect(y).toBeGreaterThan(20);
  });
});
