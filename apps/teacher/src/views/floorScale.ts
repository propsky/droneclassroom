// 關卡編輯：場地底圖比例。老師在照片上量兩點、輸入實際距離，就能把照片校正成真實大小；
// 物件可選擇跟著照片一起縮放，原本對準標線的圈換比例後仍然對得上。

import { clampWorld, type FlightBounds, type LevelDef, type PassZoneDef } from '@creafly/shared';

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
   * 物件位置以起飛墊（原點）為中心乘上 k，跟著照片一起放大縮小。
   * 高度、圈徑、障礙大小不變（那些是真實尺寸）；超出 30m 場地的收回場地邊。
   */
  static layout(level: LevelDef, k: number): LevelDef {
    const xz = (v: number): number => round(clampWorld(v * k));
    const opt = (v: number | undefined): number | undefined => (v === undefined ? undefined : xz(v));
    const next: LevelDef = { ...level };
    if (level.rings) next.rings = level.rings.map((r) => ({ ...r, x: xz(r.x), z: xz(r.z) }));
    if (level.obstacles) next.obstacles = level.obstacles.map((o) => ({ ...o, x: xz(o.x), z: xz(o.z) }));
    if (level.balloons) next.balloons = level.balloons.map((b) => ({ ...b, x: xz(b.x), z: xz(b.z) }));
    if (level.passZones) {
      next.passZones = level.passZones.map((zone): PassZoneDef => {
        const moved = { ...zone, x: xz(zone.x), z: xz(zone.z) };
        if (moved.type !== 'position' && moved.type !== undefined) return moved;
        return { ...moved, minX: opt(moved.minX), maxX: opt(moved.maxX), minZ: opt(moved.minZ), maxZ: opt(moved.maxZ) };
      });
    }
    if (level.guide) next.guide = level.guide.map(([x, z]) => [xz(x), xz(z)]);
    if (level.flightBounds) {
      const b: FlightBounds = level.flightBounds;
      next.flightBounds = { minX: xz(b.minX), maxX: xz(b.maxX), minZ: xz(b.minZ), maxZ: xz(b.maxZ) };
    }
    return next;
  }
}
