import { describe, expect, it } from 'vitest';
import { ImpactWatch } from './impact';
import { SimpleBackend } from './physicsBackend';

describe('撞擊速度提示', () => {
  it('剛撞上才提示；貼著牆推的後續 tick 不重複', () => {
    const w = new ImpactWatch();
    expect(w.wall(true, 0.05)).toBeCloseTo(3);
    expect(w.wall(true, 0.05)).toBeNull();
    expect(w.wall(false, 0)).toBeNull();
    expect(w.wall(true, 0.05)).toBeCloseTo(3);
  });

  it('太慢不提示：擦到牆、正常降落', () => {
    const w = new ImpactWatch();
    expect(w.wall(true, 0.005)).toBeNull();
    expect(ImpactWatch.floor(0.01)).toBeNull();
    expect(ImpactWatch.floor(0.05)).toBeCloseTo(3);
  });

  it('方塊碰撞回報撞進去的速度；往外飛不算撞擊', () => {
    const b = new SimpleBackend();
    b.addStaticBox('a', { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    // 從 -x 側撞進去
    const r = b.resolveCollisions({ x: -1.5, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, 0.6);
    expect(r.bumped).toBe(true);
    expect(r.impact).toBeCloseTo(0.1);
    // 在裡面但往外飛
    const out = b.resolveCollisions({ x: -1.5, y: 0, z: 0 }, { x: -0.1, y: 0, z: 0 }, 0.6);
    expect(out.bumped).toBe(true);
    expect(out.impact).toBe(0);
  });
});
