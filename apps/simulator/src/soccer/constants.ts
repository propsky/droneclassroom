// ⚽ 足球模式共用常數 — 純 TS（core / render / ui 皆可 import，不得依賴 Babylon）。
//
// 【尺寸只放這裡】F9A-A 與 F9A-B 兩組預設。多人對戰由伺服器下發同一組數字
// （soccer_go / soccer_state 的 field，見 soccer/field.ts）；這份預設只用在：
//   1. 單人練習（沒有伺服器）
//   2. 多人 fallback — 伺服器沒帶 field 時
// 伺服器的同一份在 apps/api/app/games/soccer_presets.py。預設子類 F9A-A。
//
// 依據：FAI SC4 Vol.F9 2026 Edition V2（F9A.1.1／2.2／3.1／3.2）
// 與 2025 WDSC Sporting Rules 1.4.2（內圈底部：A 為 3 m、B 為 2 m）。
import type { SoccerTeam } from '@creafly/shared';

export type SoccerClassCode = 'F9A-A' | 'F9A-B';

/** 一個子類的場地、圓環、護罩。管半徑由外半徑與內半徑算出，外緣才對得上建議外徑。 */
export interface SoccerClassPreset {
  id: SoccerClassCode;
  /** 半寬（全寬 = 2 × halfX） */
  halfX: number;
  /** 半長（全長 = 2 × halfZ，長軸 z） */
  halfZ: number;
  /** 天花板 */
  top: number;
  /** 內半徑（穿環） */
  goalR: number;
  /** 外半徑（圓環外緣） */
  outerR: number;
  /** 管半徑 = (外半徑 − 內半徑) / 2 */
  goalTube: number;
  /** 門面離底線、往場內 */
  goalInset: number;
  /** 內圈底部離地。圓心 = 底部 + 內半徑 */
  innerBottom: number;
  /** 圓心離地 */
  goalY: number;
  /** 護罩半徑 */
  shieldR: number;
  /**
   * F9A.3.1 標的最大厚度 T。
   * A 的 T 等於徑向跨距；B 的建議外徑／內徑跨距是 15 cm，T 上限 10 cm。
   * 畫出來的管子填滿內緣到外緣，所以 B 的視覺管徑是 15 cm，不是把洞縮小成 T。
   */
  thicknessMax: number;
}

function preset(
  spec: Omit<SoccerClassPreset, 'goalTube' | 'goalY'>,
): SoccerClassPreset {
  return {
    ...spec,
    goalTube: (spec.outerR - spec.goalR) / 2,
    goalY: spec.innerBottom + spec.goalR,
  };
}

/** F9A-A：外徑 1.00 m、內徑 0.60 m、厚 0.20 m、離底線 1.5 m、內圈底 3 m、護罩直徑 40 cm。 */
export const F9A_A: SoccerClassPreset = preset({
  id: 'F9A-A',
  halfX: 3.5,
  halfZ: 7,
  top: 5,
  goalR: 0.3,
  outerR: 0.5,
  goalInset: 1.5,
  innerBottom: 3,
  shieldR: 0.2,
  thicknessMax: 0.2,
});

/** F9A-B：場地 6×3×3、內半徑 0.20、外半徑 0.35、T 上限 0.10、離底線 1 m、內圈底 2 m、護罩半徑 0.10。 */
export const F9A_B: SoccerClassPreset = preset({
  id: 'F9A-B',
  halfX: 1.5,
  halfZ: 3,
  top: 3,
  goalR: 0.2,
  outerR: 0.35,
  goalInset: 1,
  innerBottom: 2,
  shieldR: 0.1,
  thicknessMax: 0.1,
});

export const SOCCER_PRESETS: Record<SoccerClassCode, SoccerClassPreset> = {
  'F9A-A': F9A_A,
  'F9A-B': F9A_B,
};

export const DEFAULT_SOCCER_CLASS: SoccerClassCode = 'F9A-A';

/** 起飛區進深（沿 z）。兩子類目前共用；人數與假人不在這次改。 */
export const SOCCER_START_DEPTH = 1;
/** 起飛區寬（沿 x） */
export const SOCCER_START_WIDTH = 1;

/**
 * 生效 fallback／單人練習場地：預設 F9A-A。
 * 長軸 z（兩門連線）、寬 x、中線 z=0。
 */
export const SOCCER_FIELD = {
  halfX: F9A_A.halfX,
  halfZ: F9A_A.halfZ,
  top: F9A_A.top,
  /** 球門面 |z| = halfZ − 離底線 */
  goalZ: F9A_A.halfZ - F9A_A.goalInset,
  goalY: F9A_A.goalY,
  goalR: F9A_A.goalR,
  goalTube: F9A_A.goalTube,
  /** 單人練習起飛區中心 z（貼 +z 底線內側） */
  startZ: F9A_A.halfZ - SOCCER_START_DEPTH / 2,
  shieldR: F9A_A.shieldR,
} as const;

/** 球門面離底線（與預設子類 goalInset 同一份） */
export const SOCCER_GOAL_INSET = F9A_A.goalInset;

/**
 * 球形護罩半徑。F9A-A 直徑 40 cm（F9A.1.1：40 cm +2 cm）。
 * 小於內半徑，中心才過得了洞；擦到框仍會被擋。
 * 多人若伺服器下發 shieldR，以 field.ts 的生效值為準，這份是 fallback。
 */
export const SOCCER_BALL_R = F9A_A.shieldR;

/**
 * 舊版教室機縮放係數。足球機體改由 createSoccerDrone 依護罩半徑畫，
 * 不再用這個係數決定護罩大小。
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

// ---- 機對機碰撞（對齊視覺護罩；互推與牆面反彈在 soccer/contact.ts）----
/** 護罩碰撞半徑（兩機最小間距 = 2×此值，與 SOCCER_BALL_R 相同才不會視覺穿模） */
export const SOCCER_CONTACT_R = SOCCER_BALL_R;
/** 舊版推出後的速度衰減。階段二改走彈性反彈，常數留著避免外部還引用時壞掉。 */
export const SOCCER_CONTACT_DAMP = 0.55;

/** 多人：窄邊隊伍視角的 z 端符號（紅站 +z 看 -z、藍站 -z 看 +z） */
export function soccerCameraSign(team: SoccerTeam | null): number {
  return team === 'red' ? 1 : -1;
}
