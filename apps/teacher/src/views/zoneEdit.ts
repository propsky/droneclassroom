// 關卡編輯：任務點的編輯規則（換類型、移動、讀邊界欄位、編輯器畫框）。
// 判定規則見 @creafly/shared PassZoneJudge：位置框沒設的邊＝不限。

import { HEADING_TOLERANCE_DEG, LEVEL_KIT_BOUNDS, type PassZoneDef } from '@creafly/shared';

type ZoneType = PassZoneDef['type'];

const round = (v: number): number => Math.round(v * 1000) / 1000;

export class ZoneEdit {
  /**
   * 換任務類型：保留位置、名字、觸發半徑，判定條件換成新類型的預設值。
   * 不沿用畫面上的舊欄位：換成高度若沒有條件會一開始就過關，換成轉角若容差是 0 永遠過不了。
   */
  static convert(zone: PassZoneDef, type: ZoneType): PassZoneDef {
    if ((zone.type ?? 'position') === type) return zone;
    const base = { x: zone.x, z: zone.z, label: zone.label, triggerRadius: zone.triggerRadius };
    if (type === 'altitude') return { ...base, type, minY: 1 };
    if (type === 'heading') {
      return { ...base, type, targetYaw: 90, tolerance: HEADING_TOLERANCE_DEG, yawMode: 'accumulated' };
    }
    return {
      ...base,
      type: 'position',
      minX: round(zone.x - 1),
      maxX: round(zone.x + 1),
      minZ: round(zone.z - 1),
      maxZ: round(zone.z + 1),
    };
  }

  /** 移到 (x, z)：位置框跟著一起平移，學生端的地面圈和判定框才會在同一個地方。 */
  static translate(zone: PassZoneDef, x: number, z: number): PassZoneDef {
    if (zone.type !== 'position' && zone.type !== undefined) return { ...zone, x, z };
    const dx = x - zone.x;
    const dz = z - zone.z;
    const shift = (v: number | undefined, d: number): number | undefined =>
      v === undefined ? undefined : round(v + d);
    return {
      ...zone,
      x,
      z,
      minX: shift(zone.minX, dx),
      maxX: shift(zone.maxX, dx),
      minZ: shift(zone.minZ, dz),
      maxZ: shift(zone.maxZ, dz),
    };
  }

  /** 邊界欄位：空白或不是數字＝不限（undefined），不能當 0。 */
  static readBound(raw: string): number | undefined {
    const t = raw.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }

  /** 編輯器俯視畫框用：沒設的邊畫到場地邊緣，和判定的「不限」一致。 */
  static drawBox(zone: { minX?: number; maxX?: number; minZ?: number; maxZ?: number }): {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  } {
    const edge = LEVEL_KIT_BOUNDS;
    return {
      minX: zone.minX ?? -edge,
      maxX: zone.maxX ?? edge,
      minZ: zone.minZ ?? -edge,
      maxZ: zone.maxZ ?? edge,
    };
  }

  /** 位置框至少有一邊有設（全部沒設＝整個場地都算，編輯器改畫小方塊提示）。 */
  static hasBox(zone: { minX?: number; maxX?: number; minZ?: number; maxZ?: number }): boolean {
    return zone.minX != null || zone.maxX != null || zone.minZ != null || zone.maxZ != null;
  }
}
