// ⚽ 足球模式共用常數 — 純 TS（core / render / ui 皆可 import，不得依賴 Babylon）。
//
// 【場地資料驅動】多人對戰的場地尺寸由伺服器下發（soccer_go / soccer_state 的
// field: SoccerFieldDef，見 soccer/field.ts）；這裡的 SOCCER_FIELD 只在兩種情況使用：
//   1. 單人練習場（沒有伺服器）
//   2. 多人 fallback — 伺服器「未下發」field 時才用（例如舊版伺服器）
// 數值對齊 FAI F9A-A 階段一：14×7×5m、圓環內徑 70cm。與 apps/api 的 config 預設同一套。
import type { SoccerTeam } from '@creafly/shared';

/**
 * 場地（fallback / 單人練習）：長軸 z（兩門連線）、寬 x、中線 z=0。
 * 長 14m = 2 × 寬 7m，天花板 5m。
 */
export const SOCCER_FIELD = {
  /** 半寬（x 邊界 ±3.5，全寬 7m） */
  halfX: 3.5,
  /** 半長（z 邊界 ±7，全長 14m） */
  halfZ: 7,
  /** 天花板高度（與伺服器預設 soccer_ceil 一致） */
  top: 5,
  /** 球門面 z（兩端 ±5 = halfZ - 離底線 2m） */
  goalZ: 5,
  /** 球門中心離地高度 */
  goalY: 3.25,
  /**
   * 球門內半徑（穿門判定：hypot(x, y-goalY) < goalR）。
   * 內徑 70cm → 半徑 35cm。外徑與厚度見 goalTube。
   */
  goalR: 0.35,
  /**
   * 球門環管半徑。厚度 20cm = 管直徑，故半徑 10cm。
   * 外徑 = 內徑 + 2×厚度 = 70 + 40 = 110cm。
   */
  goalTube: 0.1,
  /** 單人練習起飛區中心 z（貼 +z 底線內側；= halfZ - 起飛帶進深/2） */
  startZ: 6.5,
} as const;

/** 球門面離底線、往場內的距離（goalZ = halfZ - 此值；與伺服器 soccer_goal_inset 預設一致） */
export const SOCCER_GOAL_INSET = 2;

/** 起飛區：底線中段窄帶。寬沿 x、進深沿 z，兩隊各一條（與伺服器出生點同一套） */
export const SOCCER_START_WIDTH = 1;
export const SOCCER_START_DEPTH = 1;

/**
 * 機體外的球形保護框半徑（約 20cm 級：直徑 24cm）。
 * 必須小於圓環內半徑，中心才過得了 70cm 的洞；擦到框仍會被擋，所以穿環有難度。
 * 階段一不做「整顆護罩都要過洞」的判定，計分仍看機體中心。
 */
export const SOCCER_BALL_R = 0.12;

/**
 * 足球模式縮小飛機，讓視覺落進上面的保護框（不改推力／阻力手感）。
 * 未縮放機臂約到 1.6m，0.05 倍後對角約 11cm，與 12cm 框同量級。
 */
export const SOCCER_DRONE_SCALE = 0.05;

/** 隊色（與 legacy SOCCER_TEAM_COLORS 相同） */
export const SOCCER_TEAM_COLORS: Record<SoccerTeam, number> = {
  blue: 0x3b82f6,
  red: 0xff4444,
};

/** 隊色 hex（未知 / 未分隊 → 灰） */
export function soccerTeamColorHex(team: SoccerTeam | null | undefined): number {
  return (team && SOCCER_TEAM_COLORS[team]) || 0x9aa0a6;
}

/** 內徑（m） */
export function soccerGoalInnerDiameter(goalR: number = SOCCER_FIELD.goalR): number {
  return goalR * 2;
}

/** 環管厚度（m）= 管直徑 */
export function soccerGoalThickness(tubeR: number = SOCCER_FIELD.goalTube): number {
  return tubeR * 2;
}

/** 外徑（m）= 內徑 + 兩側管厚 */
export function soccerGoalOuterDiameter(
  goalR: number = SOCCER_FIELD.goalR,
  tubeR: number = SOCCER_FIELD.goalTube,
): number {
  return (goalR + tubeR * 2) * 2;
}

/** Babylon torus 的 diameter：環心圓直徑（內半徑 + 管半徑）× 2 */
export function soccerGoalTorusDiameter(
  goalR: number = SOCCER_FIELD.goalR,
  tubeR: number = SOCCER_FIELD.goalTube,
): number {
  return (goalR + tubeR) * 2;
}

/** Babylon torus 的 thickness：管直徑 */
export function soccerGoalTorusThickness(tubeR: number = SOCCER_FIELD.goalTube): number {
  return soccerGoalThickness(tubeR);
}

// ---- 機對機碰撞（既有；本階段不改推擠手感）----
/** 縮放後機身的碰撞半徑（兩機最小間距 = 2×此值） */
export const SOCCER_CONTACT_R = 0.7;
/** 碰撞推出後的速度衰減 */
export const SOCCER_CONTACT_DAMP = 0.55;

/** 多人：窄邊隊伍視角的 z 端符號（紅站 +z 看 -z、藍站 -z 看 +z） */
export function soccerCameraSign(team: SoccerTeam | null): number {
  return team === 'red' ? 1 : -1;
}
