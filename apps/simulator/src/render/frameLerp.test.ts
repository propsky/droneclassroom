import { describe, expect, it } from 'vitest';
import { FrameLerp } from './frameLerp';

describe('跟拍鏡頭平滑依時間換算', () => {
  it('60fps：與原本每幀固定比例完全相同', () => {
    expect(FrameLerp.alpha(0.06, 1000 / 60)).toBeCloseTo(0.06, 10);
    expect(FrameLerp.alpha(0.28, 1000 / 60)).toBeCloseTo(0.28, 10);
  });

  it('30fps 走一張 = 60fps 走兩張：一秒後離目標一樣遠', () => {
    const left = (fps: number): number => {
      let gap = 1;
      for (let i = 0; i < fps; i++) gap *= 1 - FrameLerp.alpha(0.06, 1000 / fps);
      return gap;
    };
    expect(left(30)).toBeCloseTo(left(60), 10);
    expect(left(20)).toBeCloseTo(left(60), 10);
  });

  it('卡很久只當 100ms，不會瞬間跳到位；時間為 0 或負不動', () => {
    expect(FrameLerp.alpha(0.06, 5000)).toBeCloseTo(FrameLerp.alpha(0.06, 100), 10);
    expect(FrameLerp.alpha(0.06, 5000)).toBeLessThan(0.4);
    expect(FrameLerp.alpha(0.06, 0)).toBe(0);
    expect(FrameLerp.alpha(0.06, -3)).toBe(0);
  });
});
