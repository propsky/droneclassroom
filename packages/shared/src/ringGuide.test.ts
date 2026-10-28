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

describe('圈的擺放角度', () => {
  it('圈面方向和機身右方同一套：0° 沿 X、往左轉 90° 沿 -Z', () => {
    const d0 = RingGuide.planeDir(0);
    expect(d0.x).toBeCloseTo(1);
    expect(d0.z).toBeCloseTo(0);
    const d90 = RingGuide.planeDir(90);
    expect(d90.x).toBeCloseTo(0);
    expect(d90.z).toBeCloseTo(-1);
  });

  it('依路線轉向：往前飛 0°、往左飛 90°、往右飛 -90°、往回飛 180°', () => {
    const straight = [{ x: 0, z: -5 }, { x: 0, z: -10 }];
    expect(RingGuide.routeYaw(straight, 0)).toBe(0);
    expect(RingGuide.routeYaw(straight, 1)).toBe(0);
    expect(RingGuide.routeYaw([{ x: -5, z: 0 }], 0)).toBe(90);
    expect(RingGuide.routeYaw([{ x: 5, z: 0 }], 0)).toBe(-90);
    expect(RingGuide.routeYaw([{ x: 0, z: 5 }], 0)).toBe(180);
  });

  it('八字左圈最外側那一點：路線沿 Z，圈面朝 Z', () => {
    // 左上 → 左外 → 左下：在左外側往 +Z 飛
    const eight = [{ x: -3, z: -9 }, { x: -6, z: -6 }, { x: -3, z: -3 }];
    expect(RingGuide.routeYaw(eight, 1)).toBe(180);
  });

  it('前後兩點重疊時退回用「前一點 → 自己」，全部重疊回 0', () => {
    expect(RingGuide.routeYaw([{ x: 0, z: -5 }, { x: 0, z: -5 }], 1)).toBe(0);
    expect(RingGuide.routeYaw([{ x: 0, z: 0 }], 0)).toBe(0);
    expect(RingGuide.routeYaw([], 0)).toBe(0);
  });
});

describe('同一地點只顯示一個步驟標記', () => {
  // 1-2：步驟 2 和步驟 4 都在原點
  const pts = [{ x: 0, z: -3 }, { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 0, z: 0 }];

  it('還沒做完：顯示編號最小的那個', () => {
    expect(RingGuide.shownAtSameSpot(pts, [false, false, false, false])).toEqual([true, true, true, false]);
  });

  it('前一個做完了：換顯示同一地點的下一個', () => {
    expect(RingGuide.shownAtSameSpot(pts, [true, true, false, false])).toEqual([true, false, true, true]);
  });

  it('全部做完：顯示最後一個', () => {
    expect(RingGuide.shownAtSameSpot(pts, [true, true, true, true])).toEqual([true, false, true, true]);
  });

  it('沒有地面標記的步驟（高度、轉角）不顯示', () => {
    expect(RingGuide.shownAtSameSpot([null, { x: 1, z: 1 }], [false, false])).toEqual([false, true]);
  });
});
