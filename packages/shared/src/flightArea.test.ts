import { describe, expect, it } from 'vitest';
import { FlightArea } from './flightArea';

const box = { minX: -5, maxX: 5, minZ: -8, maxZ: 3 };

describe('飛行範圍設定', () => {
  it('沒設或欄位不完整：不限', () => {
    expect(FlightArea.of({})).toBeNull();
    expect(FlightArea.of({ flightBounds: { minX: -5, maxX: 5, minZ: -8 } })).toBeNull();
    expect(FlightArea.of({ flightBounds: { ...box, maxZ: Number.NaN } })).toBeNull();
  });

  it('正常的框原樣生效', () => {
    expect(FlightArea.of({ flightBounds: box })).toEqual(box);
  });

  it('左右寫反會自動對調；超出 30m 場地會收進場地內', () => {
    expect(FlightArea.of({ flightBounds: { minX: 5, maxX: -5, minZ: -40, maxZ: 40 } })).toEqual({
      minX: -5,
      maxX: 5,
      minZ: -15,
      maxZ: 15,
    });
  });

  it('框沒包住起飛墊：自動撐開到起飛墊四周 1m，學生才能起飛', () => {
    expect(FlightArea.of({ flightBounds: { minX: 3, maxX: 8, minZ: -8, maxZ: -4 } })).toEqual({
      minX: -1,
      maxX: 8,
      minZ: -8,
      maxZ: 1,
    });
  });
});

describe('飛到邊界', () => {
  it('在框內：位置速度都不動', () => {
    const p = { x: 1, z: -2 };
    const v = { x: 0.1, z: -0.1 };
    expect(FlightArea.keepInside(p, v, box, 0.6)).toBe(false);
    expect(p).toEqual({ x: 1, z: -2 });
    expect(v).toEqual({ x: 0.1, z: -0.1 });
  });

  it('衝出右邊：機身停在邊界內側，往外的速度歸零，另一軸照常', () => {
    const p = { x: 5.2, z: -2 };
    const v = { x: 0.3, z: -0.1 };
    expect(FlightArea.keepInside(p, v, box, 0.6)).toBe(true);
    expect(p.x).toBeCloseTo(4.4);
    expect(v).toEqual({ x: 0, z: -0.1 });
  });

  it('貼著邊界往回飛：不會被黏住', () => {
    const p = { x: -4.4, z: 0 };
    const v = { x: 0.2, z: 0 };
    FlightArea.keepInside(p, v, box, 0.6);
    expect(v.x).toBe(0.2);
  });

  it('衝出前方（-Z）：停在邊界內', () => {
    const p = { x: 0, z: -9 };
    const v = { x: 0, z: -0.4 };
    expect(FlightArea.keepInside(p, v, box, 0.6)).toBe(true);
    expect(p.z).toBeCloseTo(-7.4);
    expect(v.z).toBe(0);
  });

  it('框比機身還窄：停在中間', () => {
    const p = { x: 3, z: 0 };
    const v = { x: 0.2, z: 0 };
    FlightArea.keepInside(p, v, { minX: -0.5, maxX: 0.5, minZ: -8, maxZ: 3 }, 0.6);
    expect(p.x).toBe(0);
    expect(v.x).toBe(0);
  });

  it('框內判斷：邊上算在內', () => {
    expect(FlightArea.contains(box, 5, 3)).toBe(true);
    expect(FlightArea.contains(box, 5.1, 0)).toBe(false);
  });
});
