// 飛行範圍（LevelDef.flightBounds）：無人機飛不出老師畫的框。
// 學生端物理、伺服器重播與編輯器都用這一份規則，邊界才會一致。

import { EDITOR_HALF } from './levelEditorUtils';
import type { FlightBounds } from './levels';

/** 起飛墊（原點）四周至少留的空間（公尺）：框再小也要能起飛、降落。 */
export const FLIGHT_AREA_HOME_MARGIN = 1;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class FlightArea {
  /**
   * 關卡設定 → 實際生效的範圍；沒設或欄位不完整回 null（不限）。
   * 會整理成：min < max、不超出編輯場地、一定包住起飛墊。
   */
  static of(level: { flightBounds?: Partial<FlightBounds> | null }): FlightBounds | null {
    const b = level.flightBounds;
    if (!b || !finite(b.minX) || !finite(b.maxX) || !finite(b.minZ) || !finite(b.maxZ)) return null;
    const m = FLIGHT_AREA_HOME_MARGIN;
    const lo = (a: number, c: number): number => Math.max(-EDITOR_HALF, Math.min(-m, Math.min(a, c)));
    const hi = (a: number, c: number): number => Math.min(EDITOR_HALF, Math.max(m, Math.max(a, c)));
    return { minX: lo(b.minX, b.maxX), maxX: hi(b.minX, b.maxX), minZ: lo(b.minZ, b.maxZ), maxZ: hi(b.minZ, b.maxZ) };
  }

  /**
   * 把機身（半徑 radius 的球）推回範圍內，撞到的那個軸速度歸零（停住、不反彈）。
   * 範圍比機身還窄的軸就停在中間。回傳這次有沒有碰到邊界。
   */
  static keepInside(
    p: { x: number; z: number },
    v: { x: number; z: number },
    b: FlightBounds,
    radius: number,
  ): boolean {
    let hit = false;
    const axis = (pos: number, vel: number, min: number, max: number): [number, number] => {
      const a = min + radius;
      const c = max - radius;
      if (a > c) {
        hit = true;
        return [(min + max) / 2, 0];
      }
      if (pos < a) {
        hit = true;
        return [a, vel < 0 ? 0 : vel];
      }
      if (pos > c) {
        hit = true;
        return [c, vel > 0 ? 0 : vel];
      }
      return [pos, vel];
    };
    [p.x, v.x] = axis(p.x, v.x, b.minX, b.maxX);
    [p.z, v.z] = axis(p.z, v.z, b.minZ, b.maxZ);
    return hit;
  }

  /** 物件是否在範圍內（編輯器提示：圈或任務點放在框外學生到不了）。 */
  static contains(b: FlightBounds, x: number, z: number): boolean {
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }
}
