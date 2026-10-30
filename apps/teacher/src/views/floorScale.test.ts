import { describe, expect, it } from 'vitest';
import type { LevelDef } from '@creafly/shared';
import { FloorScale } from './floorScale';

describe('兩點量比例', () => {
  it('照片鋪 30m 時量到 12m，實際是 6m：照片長邊應為 15m', () => {
    expect(FloorScale.calibrate(30, 12, 6)).toBe(15);
  });

  it('結果取到 0.1m', () => {
    expect(FloorScale.calibrate(30, 11.3, 6)).toBe(15.9);
  });

  it('量到的比實際短：照片要放大', () => {
    expect(FloorScale.calibrate(20, 4, 6)).toBe(30);
  });

  it('兩點太近或距離不合理：不校正', () => {
    expect(FloorScale.calibrate(30, 0.2, 6)).toBeNull();
    expect(FloorScale.calibrate(30, 10, 0)).toBeNull();
    expect(FloorScale.calibrate(30, 10, Number.NaN)).toBeNull();
  });
});

describe('物件跟著照片縮放', () => {
  const level: LevelDef = {
    id: 't',
    name: 't',
    rings: [{ x: 6, y: 2.5, z: -10, diameter: 3 }],
    obstacles: [{ type: 'cube', x: -4, y: 1, z: 2, size: 1 }],
    passZones: [
      { type: 'position', x: 0, z: -6, label: '門', minX: -2, maxX: 2, maxZ: -5 },
      { type: 'altitude', x: 4, z: 4, label: '高', minY: 2 },
    ],
    guide: [
      [0, 0],
      [10, -10],
    ],
    flightBounds: { minX: -12, maxX: 12, minZ: -14, maxZ: 6 },
  };

  it('位置以起飛墊為中心縮放，高度與大小不變', () => {
    const half = FloorScale.layout(level, 0.5);
    expect(half.rings?.[0]).toMatchObject({ x: 3, y: 2.5, z: -5, diameter: 3 });
    expect(half.obstacles?.[0]).toMatchObject({ x: -2, y: 1, z: 1, size: 1 });
    expect(half.guide).toEqual([
      [0, 0],
      [5, -5],
    ]);
    expect(half.flightBounds).toEqual({ minX: -6, maxX: 6, minZ: -7, maxZ: 3 });
  });

  it('任務點的判定框一起縮放，沒設的邊仍然不限', () => {
    const half = FloorScale.layout(level, 0.5);
    expect(half.passZones?.[0]).toMatchObject({ x: 0, z: -3, minX: -1, maxX: 1, maxZ: -2.5 });
    expect(half.passZones?.[0] && 'minZ' in half.passZones[0] ? half.passZones[0].minZ : undefined).toBeUndefined();
    expect(half.passZones?.[1]).toMatchObject({ type: 'altitude', x: 2, z: 2, minY: 2 });
  });

  it('放大超出 30m 場地的收回場地邊', () => {
    expect(FloorScale.layout(level, 2).rings?.[0]).toMatchObject({ x: 12, z: -15 });
  });

  it('沒有物件就不必問', () => {
    expect(FloorScale.hasLayout({ id: 'e', name: 'e', rings: [], obstacles: [] })).toBe(false);
    expect(FloorScale.hasLayout(level)).toBe(true);
  });
});
