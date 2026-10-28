import { describe, expect, it } from 'vitest';
import type { PassZoneDef, RingDef } from '@creafly/shared';
import { ItemOrder, RingAngle } from './levelOrder';

const ring = (label?: string): RingDef => ({ x: 0, y: 2, z: 0, label });
const zone = (label: string): PassZoneDef => ({ type: 'position', x: 0, z: 0, label });

describe('圈與步驟的順序', () => {
  it('往前、往後各挪一格，選取跟著走', () => {
    expect(ItemOrder.move(['a', 'b', 'c'], 1, -1)).toEqual({ list: ['b', 'a', 'c'], index: 0 });
    expect(ItemOrder.move(['a', 'b', 'c'], 1, 1)).toEqual({ list: ['a', 'c', 'b'], index: 2 });
  });

  it('已經在最前或最後：挪不動', () => {
    expect(ItemOrder.move(['a', 'b'], 0, -1)).toBeNull();
    expect(ItemOrder.move(['a', 'b'], 1, 1)).toBeNull();
    expect(ItemOrder.move([], 0, 1)).toBeNull();
  });

  it('不改到原本的陣列', () => {
    const list = ['a', 'b'];
    ItemOrder.move(list, 0, 1);
    expect(list).toEqual(['a', 'b']);
  });

  it('圈的預設編號照新位置重編，老師取的名字不動', () => {
    const rings = [ring('2'), ring('起點'), ring('1'), ring()];
    expect(ItemOrder.renumberRings(rings).map((r) => r.label)).toEqual(['1', '起點', '3', undefined]);
  });

  it('步驟的預設名字照新位置重編，老師取的名字不動', () => {
    const zones = [zone('步驟 3'), zone('交叉點'), zone('步驟 1')];
    expect(ItemOrder.renumberZones(zones).map((z) => z.label)).toEqual(['步驟 1', '交叉點', '步驟 3']);
  });
});

describe('圈的擺放角度', () => {
  it('角度換成 -180～180', () => {
    expect(RingAngle.normalize(270)).toBe(-90);
    expect(RingAngle.normalize(-180)).toBe(180);
    expect(RingAngle.normalize(540)).toBe(180);
    expect(RingAngle.normalize(-45)).toBe(-45);
    expect(RingAngle.normalize(Number.NaN)).toBe(0);
  });

  it('依路線轉向：每個圈面對路線、停止自轉，0° 不寫進關卡', () => {
    const rings: RingDef[] = [
      { x: 0, y: 2, z: -5, yaw: 30 },
      { x: 0, y: 2, z: -10 },
      { x: -5, y: 2, z: -10 },
    ];
    const out = RingAngle.alongRoute(rings);
    expect(out.map((r) => r.yaw)).toEqual([undefined, 45, 90]);
    expect('yaw' in out[0]!).toBe(false);
    expect(out.every((r) => r.spin === 0)).toBe(true);
    expect(rings[0]!.yaw).toBe(30);
  });
});
