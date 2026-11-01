// 關卡編輯：場地底圖比例。老師在照片上量兩點、輸入實際距離，就能把照片校正成真實大小；
// 物件可選擇跟著照片一起縮放，原本對準標線的圈換比例後仍然對得上。

import {
  clampWorld,
  FLOOR_SIZE_MAX,
  FLOOR_SIZE_MIN,
  type FlightBounds,
  type LevelDef,
  type PassZoneDef,
} from '@creafly/shared';

const round = (v: number): number => Math.round(v * 1000) / 1000;

export class FloorScale {
  /**
   * 兩點在目前比例下量到 measuredM 公尺，實際是 realM 公尺 → 照片長邊應該是幾公尺（還沒夾 10～30）。
   * 兩點太近（< 0.5m）或距離不是正數回 null：量不準，請老師重點。
   */
  static calibrate(currentSizeM: number, measuredM: number, realM: number): number | null {
    if (!(measuredM >= 0.5) || !(realM > 0) || !(currentSizeM > 0)) return null;
    // 點擊本身就有約 0.1m 誤差，結果取到 0.1m，欄位才不會出現 15.929 這種數字
    return Math.round(((currentSizeM * realM) / measuredM) * 10) / 10;
  }

  /**
   * 拉照片角落等比例縮放：照片中心 center 不動，原本在 corner 的角落跟著游標 pointer 走。
   * 回傳新的照片長邊（公尺，取到 0.1，夾在 10～60）。
   */
  static resizeByCorner(
    center: { x: number; z: number },
    corner: { x: number; z: number },
    sizeM: number,
    pointer: { x: number; z: number },
  ): number {
    const ax = corner.x - center.x;
    const az = corner.z - center.z;
    const len2 = ax * ax + az * az;
    if (!(len2 > 0)) return sizeM;
    // 游標投影到對角線上：拉出去放大、往中心推縮小
    const k = ((pointer.x - center.x) * ax + (pointer.z - center.z) * az) / len2;
    const next = Math.round(sizeM * k * 10) / 10;
    return Math.max(FLOOR_SIZE_MIN, Math.min(FLOOR_SIZE_MAX, next));
  }

  /** 場上有沒有要跟著縮放的物件（沒有就不必問老師）。 */
  static hasLayout(level: LevelDef): boolean {
    return (
      (level.rings?.length ?? 0) +
        (level.obstacles?.length ?? 0) +
        (level.balloons?.length ?? 0) +
        (level.passZones?.length ?? 0) +
        (level.guide?.length ?? 0) >
        0 || level.flightBounds != null
    );
  }

  /**
   * 物件位置以照片中心 center（沒移過照片＝起飛墊）為中心乘上 k，跟著照片一起放大縮小。
   * 高度、圈徑、障礙大小不變（那些是真實尺寸）；超出場地的收回場地邊。
   */
  static layout(level: LevelDef, k: number, center: { x: number; z: number } = { x: 0, z: 0 }): LevelDef {
    return FloorScale.map(
      level,
      (x) => center.x + (x - center.x) * k,
      (z) => center.z + (z - center.z) * k,
    );
  }

  /** 物件跟著照片平移 dx、dz 公尺（拖照片時對齊的標線不跑掉）。 */
  static shift(level: LevelDef, dx: number, dz: number): LevelDef {
    return FloorScale.map(level, (x) => x + dx, (z) => z + dz);
  }

  private static map(level: LevelDef, fx: (x: number) => number, fz: (z: number) => number): LevelDef {
    const mx = (v: number): number => round(clampWorld(fx(v)));
    const mz = (v: number): number => round(clampWorld(fz(v)));
    const optX = (v: number | undefined): number | undefined => (v === undefined ? undefined : mx(v));
    const optZ = (v: number | undefined): number | undefined => (v === undefined ? undefined : mz(v));
    const next: LevelDef = { ...level };
    if (level.rings) next.rings = level.rings.map((r) => ({ ...r, x: mx(r.x), z: mz(r.z) }));
    if (level.obstacles) next.obstacles = level.obstacles.map((o) => ({ ...o, x: mx(o.x), z: mz(o.z) }));
    if (level.balloons) next.balloons = level.balloons.map((b) => ({ ...b, x: mx(b.x), z: mz(b.z) }));
    if (level.passZones) {
      next.passZones = level.passZones.map((zone): PassZoneDef => {
        const moved = { ...zone, x: mx(zone.x), z: mz(zone.z) };
        if (moved.type !== 'position' && moved.type !== undefined) return moved;
        return { ...moved, minX: optX(moved.minX), maxX: optX(moved.maxX), minZ: optZ(moved.minZ), maxZ: optZ(moved.maxZ) };
      });
    }
    if (level.guide) next.guide = level.guide.map(([x, z]) => [mx(x), mz(z)]);
    if (level.flightBounds) {
      const b: FlightBounds = level.flightBounds;
      next.flightBounds = { minX: mx(b.minX), maxX: mx(b.maxX), minZ: mz(b.minZ), maxZ: mz(b.maxZ) };
    }
    return next;
  }
}
