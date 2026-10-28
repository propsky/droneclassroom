// 關卡過關判定（純函數、無 DOM / 物理副作用）。
// 客戶端 core/level.ts 與任何重播都走這裡，避免前後端各寫一套。
//
// 旋轉：預設比「從本關開始的有號累積角」，不把角度折回 0–360。
// 因此 360° ≠ 0°、450° ≠ 90°；轉超過容差、或一路轉過去沒停住，都不算。
import { detCos, detHypot2, detHypot3, detSin } from './detmath';
import type { HeadingYawMode, PassZoneDef, RingOrder } from './levels';
import { zoneTriggerRadius } from './levelObjectDefaults';
import { yawDiffDeg } from './math';

/** 累積轉角預設容差（度）。過關需落在目標 ± 此值，含邊界。 */
export const HEADING_TOLERANCE_DEG = 10;
/**
 * 沒寫 yawMode 的舊關卡（4e06238 以前老師自建、存在資料庫）原本的容差：
 * 舊判定是 `zone.tolerance || 20`，沒填或填 0 都當 20°。
 */
export const LEGACY_HEADING_TOLERANCE_DEG = 20;

/**
 * 單 tick 角變化小於此值（度）才算「停住」。
 * 鍵盤約 1.7°/tick、搖桿滿舵約 2.3°/tick，都高於這個門檻；
 * 程式旋轉在結尾減速時會低於門檻，所以「轉到就停」算過、「掃過去」不算。
 */
export const HEADING_SETTLE_DEG = 0.5;

/** 水平「大約 N 公尺」的預設容差（公尺），含邊界。 */
export const DISTANCE_TOLERANCE_M = 0.5;

/** 橫向偏離走廊的預設容差（公尺）。 */
export const CROSS_TRACK_TOLERANCE_M = 0.8;

/** 水平移動關要求保持的高度帶（公尺）。 */
export const CRUISE_ALTITUDE_MIN_M = 1.2;
export const CRUISE_ALTITUDE_MAX_M = 3;

/** 返航：起飛墊水平半徑（公尺）。必須小於這個距離，等於不算。 */
export const RETURN_PAD_RADIUS_M = 1.5;

/** 鑽圈機頭對準的預設容差（度）。這是朝向，不是累積轉角。 */
export const FACE_YAW_TOLERANCE_DEG = 35;

const RAD2DEG = 180 / Math.PI;

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** 從本關 0° 累加的有號轉角（度），可以超出 ±180 */
  accumulatedYawDeg: number;
  /** 上一 tick 的累積轉角，用來判斷這一 tick 有沒有停住 */
  previousYawDeg: number;
  grounded: boolean;
}

/** 累積有號轉角。不做 ±180 / 360 折疊。 */
export class YawAccumulator {
  static add(accumulatedDeg: number, deltaDeg: number): number {
    return accumulatedDeg + deltaDeg;
  }

  static sum(deltasDeg: readonly number[]): number {
    let total = 0;
    for (const delta of deltasDeg) total = YawAccumulator.add(total, delta);
    return total;
  }

  /** 物理層的 yaw（弧度，本身就不折疊）→ 度 */
  static fromRadians(yawRad: number): number {
    return yawRad * RAD2DEG;
  }
}

/** 旋轉任務：累積角或機頭朝向。 */
export class HeadingJudge {
  static tolerance(configured?: number): number {
    if (configured == null || !Number.isFinite(configured) || configured < 0) {
      return HEADING_TOLERANCE_DEG;
    }
    return configured;
  }

  /**
   * 這個旋轉區實際用哪種判定。沒寫 yawMode 的是舊關卡，當時一律比機頭朝向（facing）；
   * 官方關卡、關卡編輯器與範本都會寫明，不受影響。
   */
  static modeOf(zone: { yawMode?: HeadingYawMode }): HeadingYawMode {
    return zone.yawMode ?? 'facing';
  }

  /** 這個旋轉區實際的容差。舊關卡（沒寫 yawMode）沒填或填 0 時沿用當時的 20°。 */
  static toleranceOf(zone: { yawMode?: HeadingYawMode; tolerance?: number }): number {
    if (zone.yawMode === undefined && !(Number(zone.tolerance) > 0)) {
      return LEGACY_HEADING_TOLERANCE_DEG;
    }
    return HeadingJudge.tolerance(zone.tolerance);
  }

  /**
   * accumulated：|累積角 − 目標| ≤ 容差，不取模。
   * facing：最短朝向差 ≤ 容差（450° 與 90° 視為同一朝向）。
   */
  static matches(
    accumulatedDeg: number,
    targetDeg: number,
    toleranceDeg: number,
    mode: HeadingYawMode = 'accumulated',
  ): boolean {
    if (!Number.isFinite(accumulatedDeg) || !Number.isFinite(targetDeg) || toleranceDeg < 0) {
      return false;
    }
    if (mode === 'facing') return yawDiffDeg(accumulatedDeg, targetDeg) <= toleranceDeg;
    return Math.abs(accumulatedDeg - targetDeg) <= toleranceDeg;
  }

  static isSettled(deltaDeg: number, settleDeg = HEADING_SETTLE_DEG): boolean {
    return Number.isFinite(deltaDeg) && Math.abs(deltaDeg) <= settleDeg;
  }

  /** 停在容差帶裡才算達成。掃過目標、或停在容差外，都不算。 */
  static achieved(
    accumulatedDeg: number,
    previousDeg: number,
    targetDeg: number,
    toleranceDeg: number,
    mode: HeadingYawMode = 'accumulated',
  ): boolean {
    const delta = accumulatedDeg - previousDeg;
    return (
      HeadingJudge.isSettled(delta) &&
      HeadingJudge.matches(accumulatedDeg, targetDeg, toleranceDeg, mode)
    );
  }
}

export class AltitudeJudge {
  /** 高度落在 [minY, maxY]（缺的那側不限制），含邊界。 */
  static within(y: number, minY?: number, maxY?: number): boolean {
    if (!Number.isFinite(y)) return false;
    if (minY !== undefined && y < minY) return false;
    if (maxY !== undefined && y > maxY) return false;
    return true;
  }
}

export class PositionJudge {
  static within(
    pose: { x: number; y: number; z: number },
    box: {
      minX?: number;
      maxX?: number;
      minZ?: number;
      maxZ?: number;
      minY?: number;
      maxY?: number;
    },
  ): boolean {
    if (box.minX !== undefined && pose.x < box.minX) return false;
    if (box.maxX !== undefined && pose.x > box.maxX) return false;
    if (box.minZ !== undefined && pose.z < box.minZ) return false;
    if (box.maxZ !== undefined && pose.z > box.maxZ) return false;
    return AltitudeJudge.within(pose.y, box.minY, box.maxY);
  }
}

export class DistanceJudge {
  static horizontal(x1: number, z1: number, x2 = 0, z2 = 0): number {
    return detHypot2(x1 - x2, z1 - z2);
  }

  /** |距離 − 目標| ≤ 容差，含邊界。 */
  static withinTolerance(
    distance: number,
    target: number,
    tolerance = DISTANCE_TOLERANCE_M,
  ): boolean {
    return Number.isFinite(distance) && Math.abs(distance - target) <= tolerance;
  }
}

export class LandingJudge {
  /** 高度不高於上限（含等於）算落地高度。 */
  static atOrBelow(y: number, maxY: number): boolean {
    return Number.isFinite(y) && y <= maxY;
  }

  /**
   * 返航降落：人在起飛墊水平半徑內，而且已經著地。
   * 低空飛過墊子、或在墊子外落地，都不算。
   */
  /** 人在起飛墊水平範圍內（還沒看有沒有著地）。 */
  static overPad(
    x: number,
    z: number,
    radius = RETURN_PAD_RADIUS_M,
    homeX = 0,
    homeZ = 0,
  ): boolean {
    return DistanceJudge.horizontal(x, z, homeX, homeZ) < radius;
  }

  static onPad(
    x: number,
    z: number,
    grounded: boolean,
    radius = RETURN_PAD_RADIUS_M,
    homeX = 0,
    homeZ = 0,
  ): boolean {
    return grounded && LandingJudge.overPad(x, z, radius, homeX, homeZ);
  }
}

/** 步驟必須照順序：前一步沒完成，這一步不檢查。 */
export class OrderJudge {
  static isActive(done: readonly boolean[], index: number): boolean {
    if (index < 0 || index >= done.length || done[index]) return false;
    for (let i = 0; i < index; i++) {
      if (!done[i]) return false;
    }
    return true;
  }
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 一個 tick 最多移動這麼遠（公尺）。超過代表瞬移（重置、載入），不算穿圈。手動極速約 0.15m/tick。 */
export const RING_MAX_STEP_M = 1;
/** 離圈面這麼近（公尺）視為在圈面上 */
const PLANE_EPS_M = 1e-6;

/**
 * 穿圈的幾何判定：這一 tick 的移動線段穿過圈面，而且穿過點在圈內（離圈心 < 半徑）。
 * 從旁邊擦過、在圈前面晃、碰到圈邊都不算。正反兩個方向都算；順序由 RingJudge（依序穿圈）管。
 */
export class RingPassJudge {
  /** 圈面法線（水平）。和機頭方向同一套：yaw=0 → (0, -1)，正值往左轉。 */
  static normal(yawRad: number): { x: number; z: number } {
    return { x: -detSin(yawRad), z: -detCos(yawRad) };
  }

  /** 圈此刻的角度（弧度）：擺放角度 + 自轉（每 tick spin 弧度，用絕對模擬 tick，重播算得出同一個值）。 */
  static yawRadAt(yawDeg: number, spinPerTick: number, simTick: number): number {
    return (yawDeg * Math.PI) / 180 + spinPerTick * simTick;
  }

  static crossed(prev: Point3, curr: Point3, center: Point3, yawRad: number, radius: number): boolean {
    if (detHypot3(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z) > RING_MAX_STEP_M) return false;
    const n = RingPassJudge.normal(yawRad);
    const d0 = (prev.x - center.x) * n.x + (prev.z - center.z) * n.z;
    const d1 = (curr.x - center.x) * n.x + (curr.z - center.z) * n.z;
    // 圈面上（含沿著圈面飛、三角函數的捨入誤差）算在正面那一側：
    // 停在圈面上不會被算兩次，沿著圈面擦過也不會因為誤差被算成穿過
    if (d0 > -PLANE_EPS_M === d1 > -PLANE_EPS_M) return false;
    const t = d0 / (d0 - d1);
    const ix = prev.x + (curr.x - prev.x) * t;
    const iy = prev.y + (curr.y - prev.y) * t;
    const iz = prev.z + (curr.z - prev.z) * t;
    return detHypot3(ix - center.x, iy - center.y, iz - center.z) < radius;
  }
}

/** 鑽圈：依序，且（若有 faceYaw）機頭朝向要對準。朝向用最短角差，不是累積轉角。 */
export class RingJudge {
  static inRange(distance: number, radius: number): boolean {
    return distance < radius;
  }

  static isNext(passed: readonly boolean[], index: number): boolean {
    return OrderJudge.isActive(passed, index);
  }

  /**
   * 這個圈現在穿過去算不算數。關卡寫 ringOrder:'sequential' 才要照陣列順序；
   * 沒寫的舊關卡（老師自建）照舊任意順序都算。
   */
  static canPass(
    passed: readonly boolean[],
    index: number,
    order: RingOrder | undefined,
  ): boolean {
    if (index < 0 || index >= passed.length || passed[index]) return false;
    return order === 'sequential' ? RingJudge.isNext(passed, index) : true;
  }
}

export class FaceYawJudge {
  static tolerance(configured?: number): number {
    if (configured == null || !Number.isFinite(configured) || configured < 0) {
      return FACE_YAW_TOLERANCE_DEG;
    }
    return configured;
  }

  /** 機頭是否朝向目標。多轉幾圈只要最後面對該方向，仍然算對準。 */
  static aligned(yawDeg: number, targetDeg: number, toleranceDeg?: number): boolean {
    const tol = toleranceDeg ?? FACE_YAW_TOLERANCE_DEG;
    return yawDiffDeg(yawDeg, targetDeg) <= tol;
  }
}

export class PassZoneJudge {
  static insideTrigger(
    zone: { x: number; z: number; triggerRadius?: number },
    pose: { x: number; z: number },
  ): boolean {
    const radius = zoneTriggerRadius(zone);
    if (radius === null) return true;
    return DistanceJudge.horizontal(pose.x, pose.z, zone.x, zone.z) <= radius;
  }

  static satisfies(zone: PassZoneDef, pose: Pose): boolean {
    if (!PassZoneJudge.insideTrigger(zone, pose)) return false;
    if (zone.type === 'altitude') {
      return AltitudeJudge.within(pose.y, zone.minY, zone.maxY);
    }
    if (zone.type === 'position') {
      return PositionJudge.within(pose, zone);
    }
    if (zone.type === 'heading') {
      return HeadingJudge.achieved(
        pose.accumulatedYawDeg,
        pose.previousYawDeg,
        zone.targetYaw,
        HeadingJudge.toleranceOf(zone),
        HeadingJudge.modeOf(zone),
      );
    }
    return false;
  }
}

/** 一種任務的進度。total 為 0 代表這關沒有這種任務。 */
export interface TaskTally {
  done: number;
  total: number;
}

/**
 * 整關過關：關卡裡出現的每一種任務（圈、任務點、氣球）都要做完。
 * 一種任務都沒有的關卡（自由畫布）永遠不會自動過關。
 * 有勾「需返航降落」時，做完任務後還要降落在起飛墊上（由 core/level.ts 處理）。
 */
export class TaskJudge {
  static allDone(tallies: readonly TaskTally[]): boolean {
    const present = tallies.filter((t) => t.total > 0);
    return present.length > 0 && present.every((t) => t.done >= t.total);
  }
}
