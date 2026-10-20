// 關卡過關判定（純函數、無 DOM / 物理副作用）。
// 客戶端 core/level.ts 與任何重播都走這裡，避免前後端各寫一套。
//
// 旋轉：預設比「從本關開始的有號累積角」，不把角度折回 0–360。
// 因此 360° ≠ 0°、450° ≠ 90°；轉超過容差、或一路轉過去沒停住，都不算。
import { detHypot2 } from './detmath';
import type { HeadingYawMode, PassZoneDef } from './levels';
import { zoneTriggerRadius } from './levelObjectDefaults';
import { yawDiffDeg } from './math';

/** 累積轉角預設容差（度）。過關需落在目標 ± 此值，含邊界。 */
export const HEADING_TOLERANCE_DEG = 10;

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

/** 旋轉任務：累積角或（明確選用時）機頭朝向。 */
export class HeadingJudge {
  static tolerance(configured?: number): number {
    if (configured == null || !Number.isFinite(configured) || configured < 0) {
      return HEADING_TOLERANCE_DEG;
    }
    return configured;
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

/** 鑽圈：依序，且（若有 faceYaw）機頭朝向要對準。朝向用最短角差，不是累積轉角。 */
export class RingJudge {
  static inRange(distance: number, radius: number): boolean {
    return distance < radius;
  }

  static isNext(passed: readonly boolean[], index: number): boolean {
    return OrderJudge.isActive(passed, index);
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
        HeadingJudge.tolerance(zone.tolerance),
        zone.yawMode ?? 'accumulated',
      );
    }
    return false;
  }
}
