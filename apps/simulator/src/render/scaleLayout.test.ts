import { describe, expect, it } from 'vitest';
import type { LevelDef } from '@creafly/shared';
import { ScaleLayout } from './scaleLayout';

const level = (extra: Partial<LevelDef>): LevelDef => ({ id: 't', name: 't', ...extra }) as LevelDef;

describe('比例尺版面', () => {
  it('沒有關卡物件：以起飛墊為中心 30×30 m', () => {
    expect(ScaleLayout.extent(null)).toEqual({ minX: -15, maxX: 15, minZ: -15, maxZ: 15 });
  });

  it('關卡物件在外面：撐開並對齊到 5 m', () => {
    const r = ScaleLayout.extent(level({ rings: [{ x: 2, y: 2, z: -21 }] }));
    // -21 − 3 = -24 → 對齊到 -25
    expect(r.minZ).toBe(-25);
    expect(r.maxZ).toBe(15);
  });

  it('有飛行範圍就照它，不再撐到 30×30', () => {
    const r = ScaleLayout.extent(level({ flightBounds: { minX: -3, maxX: 3, minZ: -6, maxZ: 2 } }));
    expect(r).toEqual({ minX: -5, maxX: 5, minZ: -10, maxZ: 5 });
  });

  it('不鋪出 120×120 m 的地面', () => {
    const r = ScaleLayout.extent(level({ rings: [{ x: 0, y: 2, z: -200 }] }));
    expect(r.minZ).toBe(-60);
  });

  it('課桌椅預設在起飛墊左後方；那裡有障礙物就換到右邊', () => {
    expect(ScaleLayout.propSpot(null)).toEqual({ x: -3.5, z: 1.5 });
    const blocked = level({ obstacles: [{ type: 'cube', x: -3, y: 1, z: 1, size: 1 }] });
    expect(ScaleLayout.propSpot(blocked)).toEqual({ x: 3.5, z: 1.5 });
  });

  it('距離標籤每 5 m 一個，沿兩軸、不超出格線', () => {
    const marks = ScaleLayout.axisMarks({ minX: -5, maxX: 10, minZ: -10, maxZ: 5 });
    expect(marks).toContainEqual({ x: 0, z: -10, d: 10 });
    expect(marks).toContainEqual({ x: 10, z: 0, d: 10 });
    expect(marks).not.toContainEqual({ x: -10, z: 0, d: 10 });
    expect(marks).toHaveLength(6);
  });
});
