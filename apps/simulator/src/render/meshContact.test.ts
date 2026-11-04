import { describe, expect, it } from 'vitest';
import { MeshContact } from './meshContact';

describe('網格碰撞速度反應', () => {
  it('正面撞牆：撞進去的速度消掉，回傳撞擊速度', () => {
    const v = { x: 0, y: 0, z: -0.1 };
    const hit = MeshContact.removeInward(v, { x: 0, y: 0, z: 1 });
    expect(hit).toBeCloseTo(0.1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it('斜撞：只消法向，沿牆速度保留（不再整個 ×0.4）', () => {
    const v = { x: 0.1, y: 0, z: -0.05 };
    const hit = MeshContact.removeInward(v, { x: 0, y: 0, z: 1 });
    expect(hit).toBeCloseTo(0.05, 12);
    expect(v.x).toBeCloseTo(0.1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it('往外飛或平行滑：速度不動、撞擊 0', () => {
    const away = { x: 0.02, y: 0, z: 0.1 };
    expect(MeshContact.removeInward(away, { x: 0, y: 0, z: 1 })).toBe(0);
    expect(away).toEqual({ x: 0.02, y: 0, z: 0.1 });
    const slide = { x: 0.1, y: 0, z: 0 };
    expect(MeshContact.removeInward(slide, { x: 0, y: 0, z: 1 })).toBe(0);
    expect(slide).toEqual({ x: 0.1, y: 0, z: 0 });
  });

  it('摩擦：沿牆速度少掉 μ × 撞擊速度，擦邊幾乎不掉', () => {
    const v = { x: 0.1, y: 0, z: 0 };
    MeshContact.applyFriction(v, { x: 0, y: 0, z: 1 }, 0.05);
    expect(v.x).toBeCloseTo(0.1 - MeshContact.FRICTION * 0.05, 12);
    const graze = { x: 0.1, y: 0, z: 0 };
    MeshContact.applyFriction(graze, { x: 0, y: 0, z: 1 }, 0.001);
    expect(graze.x).toBeGreaterThan(0.099);
  });

  it('摩擦最多讓沿牆速度停住，不會反向；法向分量不動', () => {
    const v = { x: 0.01, y: 0, z: 0.03 };
    MeshContact.applyFriction(v, { x: 0, y: 0, z: 1 }, 1);
    expect(v.x).toBe(0);
    expect(v.z).toBeCloseTo(0.03, 12);
  });

  it('貼著牆推桿滑行：每 tick 都接觸也不會黏住', () => {
    // 往 +x 滑、同時一直往牆（-z）推：每 tick 推力 0.012、阻力 0.92
    const n = { x: 0, y: 0, z: 1 };
    const v = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 300; i++) {
      v.x += 0.012;
      v.z -= 0.012;
      v.x *= 0.92;
      v.z *= 0.92;
      const hit = MeshContact.removeInward(v, n);
      MeshContact.applyFriction(v, n, hit);
    }
    // 不接觸時極速約 0.138 m/tick；貼牆滑行仍有一半以上（舊的 ×0.4 會壓到 0.03 以下）
    expect(v.x).toBeGreaterThan(0.07);
  });
});

describe('防穿模掃掠切分', () => {
  const r = 0.1; // F9A-B 護罩半徑

  it('移動不到半個護罩半徑：只查終點', () => {
    expect(MeshContact.sweepSteps({ x: 0, y: 0, z: 0 }, { x: 0.04, y: 0, z: 0 }, 0.04, r)).toBe(1);
  });

  it('極速 0.14 m / tick：切成每步 ≤ 5 cm', () => {
    const steps = MeshContact.sweepSteps({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -0.14 }, 0.13, r);
    expect(steps).toBe(3);
    expect(0.14 / steps).toBeLessThanOrEqual(r * MeshContact.SWEEP_STEP);
  });

  it('剛掛上（沒有上一 tick 位置）：只查終點', () => {
    expect(MeshContact.sweepSteps(null, { x: 1, y: 1, z: 1 }, 0.2, r)).toBe(1);
  });

  it('瞬移（回家、重置、發球）不掃：距離超過門檻或速度對不上', () => {
    expect(MeshContact.sweepSteps({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 3, r)).toBe(1);
    // 重置位置 1 m 外、速度歸零
    expect(MeshContact.sweepSteps({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0, r)).toBe(1);
  });

  it('步數有上限', () => {
    expect(MeshContact.sweepSteps({ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }, 1.5, 0.01)).toBe(
      MeshContact.MAX_STEPS,
    );
  });
});
