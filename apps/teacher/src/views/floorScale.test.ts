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

describe('拉角落縮放照片', () => {
  const c = { x: 2, z: -1 };
  const corner = { x: 17, z: 7 }; // 30m × 16m 照片的右下角

  it('拉到兩倍遠：長邊兩倍', () => {
    expect(FloorScale.resizeByCorner(c, corner, 30, { x: 32, z: 15 })).toBe(60);
  });

  it('往中心推：縮小，偏離對角線也照投影算', () => {
    expect(FloorScale.resizeByCorner(c, corner, 30, { x: 8.7, z: 4.5 })).toBe(15);
  });

  it('夾在 10～60 公尺', () => {
    expect(FloorScale.resizeByCorner(c, corner, 30, { x: 2, z: -1 })).toBe(10);
    expect(FloorScale.resizeByCorner(c, corner, 30, { x: 62, z: 31 })).toBe(60);
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

  it('放大超出 60m 場地的收回場地邊', () => {
    expect(FloorScale.layout(level, 4).rings?.[0]).toMatchObject({ x: 24, z: -30 });
  });

  it('照片移過位置：以照片中心縮放，物件仍對得上照片', () => {
    const half = FloorScale.layout(level, 0.5, { x: 2, z: -2 });
    expect(half.rings?.[0]).toMatchObject({ x: 4, z: -6 });
    expect(half.flightBounds).toEqual({ minX: -5, maxX: 7, minZ: -8, maxZ: 2 });
  });

  it('跟著照片平移：判定框與飛行範圍一起移，高度不變', () => {
    const moved = FloorScale.shift(level, 3, -1);
    expect(moved.rings?.[0]).toMatchObject({ x: 9, y: 2.5, z: -11 });
    expect(moved.passZones?.[0]).toMatchObject({ x: 3, z: -7, minX: 1, maxX: 5, maxZ: -6 });
    expect(moved.guide?.[1]).toEqual([13, -11]);
    expect(moved.flightBounds).toEqual({ minX: -9, maxX: 15, minZ: -15, maxZ: 5 });
  });

  it('沒有物件就不必問', () => {
    expect(FloorScale.hasLayout({ id: 'e', name: 'e', rings: [], obstacles: [] })).toBe(false);
    expect(FloorScale.hasLayout(level)).toBe(true);
  });
});
