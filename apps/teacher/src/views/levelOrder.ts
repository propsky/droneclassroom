// 關卡編輯：圈與任務步驟的先後順序。
// 依序穿圈（ringOrder）與任務步驟都照陣列順序判定，學生端圈上的編號也是陣列順序，
// 所以老師要能直接調順序，不必刪掉重放。

import { RingGuide, type PassZoneDef, type RingDef } from '@creafly/shared';

/** 放置時給的預設名字；老師自己改過的名字不跟著重編。 */
const DEFAULT_RING_LABEL = /^\d+$/;
const DEFAULT_ZONE_LABEL = /^步驟 \d+$/;

export class ItemOrder {
  /** 第 index 項往前（-1）或往後（+1）挪一格。已在頭尾挪不動回 null。 */
  static move<T>(list: readonly T[], index: number, delta: -1 | 1): { list: T[]; index: number } | null {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return null;
    const next = [...list];
    [next[index], next[to]] = [next[to]!, next[index]!];
    return { list: next, index: to };
  }

  /** 圈的預設編號（「1」「2」…）跟著目前位置重編。 */
  static renumberRings(rings: readonly RingDef[]): RingDef[] {
    return rings.map((r, i) =>
      r.label !== undefined && DEFAULT_RING_LABEL.test(r.label) ? { ...r, label: String(i + 1) } : r,
    );
  }

  /** 任務步驟的預設名字（「步驟 1」…）跟著目前位置重編。 */
  static renumberZones(zones: readonly PassZoneDef[]): PassZoneDef[] {
    return zones.map((z, i) => (DEFAULT_ZONE_LABEL.test(z.label) ? { ...z, label: `步驟 ${i + 1}` } : z));
  }
}

export class RingAngle {
  /** 角度換成 -180（不含）～ 180；不是數字當 0。 */
  static normalize(deg: number): number {
    if (!Number.isFinite(deg)) return 0;
    const n = ((((deg + 180) % 360) + 360) % 360) - 180;
    return n === -180 ? 180 : n + 0;
  }

  /**
   * 依飛行順序把每個圈轉成面對路線，並停止自轉（會轉的圈角度沒意義）。
   * 0° 不寫進關卡，維持舊關卡的 JSON 樣子。
   */
  static alongRoute(rings: readonly RingDef[]): RingDef[] {
    return rings.map((r, i) => {
      const yaw = RingGuide.routeYaw(rings, i);
      const next: RingDef = { ...r, spin: 0 };
      if (yaw === 0) delete next.yaw;
      else next.yaw = yaw;
      return next;
    });
  }
}
