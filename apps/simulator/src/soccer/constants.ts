// ⚽ 足球模式共用常數 — 純 TS（core / render / ui 皆可 import，不得依賴 Babylon）。
//
// 【場地已改資料驅動】多人對戰的場地尺寸由伺服器下發（soccer_go / soccer_state 的
// field: SoccerFieldDef，見 soccer/field.ts）；這裡的 SOCCER_FIELD 只在兩種情況使用：
//   1. 單人練習場（沒有伺服器）
//   2. 多人 fallback — 伺服器「未下發」field 時才用（例如舊版伺服器）
// 之後老師要調場地大小，只改伺服器設定即可，客戶端零改動。
// 數值已放大到與新多人預設一致（halfX=10 / halfZ=20 / goalY=4.5 / goalR=3.0），
// 讓單人練習與多人比賽的手感一致。
import type { SoccerTeam } from '@creafly/shared';

/** 場地（fallback / 單人練習）：長軸 z（兩門連線）、寬 x、中線 z=0 */
export const SOCCER_FIELD = {
  /** 半寬（x 邊界 ±10） */
  halfX: 10,
  /** 半長（z 邊界 ±20） */
  halfZ: 20,
  /** 天花板高度 */
  top: 12,
  /** 球門面 z（兩端 ±16 = halfZ - GOAL_INSET；門後留退場空間） */
  goalZ: 16,
  /** 球門中心高度 */
  goalY: 4.5,
  /** 球門環半徑（穿門判定：|x|<goalR 且 |y-goalY|<goalR） */
  goalR: 3.0,
  /** 球門環管徑（視覺 + 門框碰撞的實心部分；隨 goalR 放大） */
  goalTube: 0.27,
  /** 單人練習起始區中心 z（藍隊 +z 端；= halfZ / 2） */
  startZ: 10,
} as const;

/** 球門面對端線的內縮距離（goalZ = halfZ - 此值；比例沿用 legacy 14→10） */
export const SOCCER_GOAL_INSET = 4;

/** 機體外的球形保護框半徑（像真實無人機足球的球；也當牆面 / 門框碰撞半徑） */
export const SOCCER_BALL_R = 0.8;

/** 足球模式把飛機縮小 → 場地相對變大、比例正確（單人與多人一致） */
export const SOCCER_DRONE_SCALE = 0.65;

/** 隊色（與 legacy SOCCER_TEAM_COLORS 相同） */
export const SOCCER_TEAM_COLORS: Record<SoccerTeam, number> = {
  blue: 0x3b82f6,
  red: 0xff4444,
};

/** 隊色 hex（未知 / 未分隊 → 灰） */
export function soccerTeamColorHex(team: SoccerTeam | null | undefined): number {
  return (team && SOCCER_TEAM_COLORS[team]) || 0x9aa0a6;
}

// ---- 機對機碰撞（本版新增，legacy 沒有 — Havok 進場後的實體對抗手感）----
/** 縮放後機身的碰撞半徑（≈ 機身 2.4m × 0.65 / 2 取整；兩機最小間距 = 2×此值） */
export const SOCCER_CONTACT_R = 0.5;
/** 碰撞推出後的速度衰減（撞人 / 被卡位會明顯減速，「擋」得有實感） */
export const SOCCER_CONTACT_DAMP = 0.55;

/** 多人：窄邊隊伍視角的 z 端符號（紅站 +z 看 -z、藍站 -z 看 +z） */
export function soccerCameraSign(team: SoccerTeam | null): number {
  return team === 'red' ? 1 : -1;
}
