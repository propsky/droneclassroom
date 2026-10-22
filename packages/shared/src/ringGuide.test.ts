import { describe, expect, it } from 'vitest';
import { RingGuide } from './ringGuide';

describe('RingGuide', () => {
  it('下一個圈、還沒輪到、已穿過三種狀態分開', () => {
    expect(RingGuide.phase([false, false, false], 0)).toBe('next');
    expect(RingGuide.phase([false, false, false], 1)).toBe('upcoming');
    expect(RingGuide.phase([false, false, false], 2)).toBe('upcoming');

    expect(RingGuide.phase([true, false, false], 0)).toBe('passed');
    expect(RingGuide.phase([true, false, false], 1)).toBe('next');
    expect(RingGuide.phase([true, false, false], 2)).toBe('upcoming');

    expect(RingGuide.phase([true, true, true], 2)).toBe('passed');
    expect(RingGuide.phase([true, false, false], 2)).toBe('upcoming');
  });

  it('編號從 1 起算', () => {
    expect(RingGuide.label(0)).toBe('1');
    expect(RingGuide.label(1)).toBe('2');
    expect(RingGuide.label(2)).toBe('3');
  });

  it('直線上的圈才把編號往旁錯開', () => {
    const line = [
      { x: 0, z: -5 },
      { x: 0, z: -10 },
      { x: 0, z: -15 },
    ];
    expect(RingGuide.lateralSpread(0, line)).toBe(0);
    expect(RingGuide.lateralSpread(1, line)).toBe(3);
    expect(RingGuide.lateralSpread(2, line)).toBe(6);

    const split = [
      { x: 5, z: 0 },
      { x: 5, z: -5 },
      { x: 0, z: -5 },
    ];
    expect(RingGuide.lateralSpread(0, split)).toBe(0);
    expect(RingGuide.lateralSpread(1, split)).toBe(3);
    expect(RingGuide.lateralSpread(2, split)).toBe(0);
  });

  it('只有下一個圈會亮、會脈衝；對準時機頭提示改綠', () => {
    const next = RingGuide.look('next');
    const aligned = RingGuide.look('next', true);
    const upcoming = RingGuide.look('upcoming');
    const passed = RingGuide.look('passed');

    expect(next.pulse).toBe(true);
    expect(next.color).toBe(0xfbbf24);
    expect(aligned.color).toBe(0x4ade80);
    expect(aligned.pulse).toBe(true);
    expect(upcoming.pulse).toBe(false);
    expect(upcoming.color).toBeNull();
    expect(passed.pulse).toBe(false);
    expect(passed.color).not.toBe(next.color);
    expect(passed.alpha).toBeLessThan(upcoming.alpha);
    expect(next.badgeScale).toBeGreaterThan(upcoming.badgeScale);
    expect(upcoming.badgeScale).toBeGreaterThan(passed.badgeScale);
  });
});
