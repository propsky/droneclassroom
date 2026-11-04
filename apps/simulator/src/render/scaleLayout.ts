// 比例尺的版面：格線要鋪多大、課桌椅和學生剪影放哪裡。純函式（不碰 Babylon），Node 測得到。
import { FlightArea, type LevelDef } from '@creafly/shared';

/** 地面上的矩形（公尺，x 往右、z 往後；機頭朝 -Z）。 */
export interface GroundRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface GroundSpot {
  x: number;
  z: number;
}

/** 沒有任何關卡物件時，以起飛墊為中心鋪 30×30 m。 */
const DEFAULT_HALF_M = 15;
/** 關卡物件外再多鋪一點，物件不會剛好壓在格線邊上。 */
const OBJECT_MARGIN_M = 3;
/** 地面是 120×120 m（render/scene.ts），格線不鋪出地面。 */
const GROUND_HALF_M = 60;
/** 粗線間距：範圍對齊到這個倍數，粗線才會落在邊上。 */
export const MAJOR_STEP_M = 5;

/** 課桌椅＋剪影要留的半徑（桌椅含剪影約 1.6 m 寬）。 */
const PROP_CLEAR_M = 2.5;

const roundOut = (v: number, step: number): number =>
  v < 0 ? -Math.ceil(-v / step) * step : Math.ceil(v / step) * step;
const clampGround = (v: number): number => Math.max(-GROUND_HALF_M, Math.min(GROUND_HALF_M, v));

/** 關卡裡所有看得到的物件的地面座標（圈、方塊、氣球、通過區）。 */
function objectSpots(level: LevelDef | null): GroundSpot[] {
  if (!level) return [];
  return [
    ...(level.rings ?? []),
    ...(level.obstacles ?? []),
    ...(level.balloons ?? []),
    ...(level.passZones ?? []),
  ].map((o) => ({ x: o.x, z: o.z }));
}

export class ScaleLayout {
  /**
   * 格線範圍：有飛行範圍就照它；沒有就以起飛墊為中心 30×30 m，再撐開到包住所有關卡物件與場地底圖。
   * 四邊對齊到 5 m，粗線剛好在邊上；不超出 120×120 m 的地面。
   */
  static extent(level: LevelDef | null): GroundRect {
    const bounds = level ? FlightArea.of(level) : null;
    let r: GroundRect = bounds
      ? { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ }
      : { minX: -DEFAULT_HALF_M, maxX: DEFAULT_HALF_M, minZ: -DEFAULT_HALF_M, maxZ: DEFAULT_HALF_M };
    if (!bounds) {
      for (const o of objectSpots(level)) {
        r = {
          minX: Math.min(r.minX, o.x - OBJECT_MARGIN_M),
          maxX: Math.max(r.maxX, o.x + OBJECT_MARGIN_M),
          minZ: Math.min(r.minZ, o.z - OBJECT_MARGIN_M),
          maxZ: Math.max(r.maxZ, o.z + OBJECT_MARGIN_M),
        };
      }
      // 場地底圖：長邊 floorSize，比例未知 → 以正方形估，寧可多鋪
      if (level?.floorImage && level.floorSize) {
        const half = level.floorSize / 2;
        const cx = level.floorOffset?.x ?? 0;
        const cz = level.floorOffset?.z ?? 0;
        r = {
          minX: Math.min(r.minX, cx - half),
          maxX: Math.max(r.maxX, cx + half),
          minZ: Math.min(r.minZ, cz - half),
          maxZ: Math.max(r.maxZ, cz + half),
        };
      }
    }
    return {
      minX: clampGround(roundOut(r.minX, MAJOR_STEP_M)),
      maxX: clampGround(roundOut(r.maxX, MAJOR_STEP_M)),
      minZ: clampGround(roundOut(r.minZ, MAJOR_STEP_M)),
      maxZ: clampGround(roundOut(r.maxZ, MAJOR_STEP_M)),
    };
  }

  /**
   * 課桌椅與剪影的位置：起飛墊（半徑 1.8 m）左側、略後方 —— 第三人稱鏡頭在機尾正後方，
   * 這裡在畫面左邊看得到、又不在飛行路線上。附近有關卡物件或在飛行範圍外就換下一個候選位置。
   */
  static propSpot(level: LevelDef | null): GroundSpot {
    const candidates: GroundSpot[] = [
      { x: -3.5, z: 1.5 },
      { x: 3.5, z: 1.5 },
      { x: -3.5, z: 4 },
      { x: 3.5, z: 4 },
      { x: 0, z: 4.5 },
    ];
    const objs = objectSpots(level);
    const bounds = level ? FlightArea.of(level) : null;
    const fits = (c: GroundSpot): boolean => {
      if (bounds) {
        const m = 0.8;
        if (c.x < bounds.minX + m || c.x > bounds.maxX - m || c.z < bounds.minZ + m || c.z > bounds.maxZ - m) {
          return false;
        }
      }
      return objs.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= PROP_CLEAR_M);
    };
    return candidates.find(fits) ?? candidates[0]!;
  }

  /** 從起飛墊沿兩軸的距離標籤（每 5 m）：[x, z, 公尺]。不含 0，不超出格線。 */
  static axisMarks(r: GroundRect): { x: number; z: number; d: number }[] {
    const marks: { x: number; z: number; d: number }[] = [];
    for (let d = MAJOR_STEP_M; d <= GROUND_HALF_M; d += MAJOR_STEP_M) {
      if (-d >= r.minZ) marks.push({ x: 0, z: -d, d });
      if (d <= r.maxZ) marks.push({ x: 0, z: d, d });
      if (d <= r.maxX) marks.push({ x: d, z: 0, d });
      if (-d >= r.minX) marks.push({ x: -d, z: 0, d });
    }
    return marks;
  }
}
