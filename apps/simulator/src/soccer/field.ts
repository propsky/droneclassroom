// ⚽ 「目前生效」的足球場地 — 資料驅動的核心（純 TS，不依賴 Babylon）。
//
// 多人對戰：伺服器在 soccer_go / soccer_state 下發 field: SoccerFieldDef，
// 場地渲染 / 門環 / 邊界 clamp / 進球判定 / 相機取景全部依這份「生效值」計算 —
// 之後老師調場地大小，客戶端零改動。
// 單人練習：沒有伺服器 → 進場時 resetSoccerField() 回 constants.ts 的 fallback。
import type { SoccerFieldDef } from '@creafly/shared';
import { SOCCER_BALL_R, SOCCER_FIELD, SOCCER_GOAL_INSET, SOCCER_START_DEPTH } from './constants';

/** 生效場地：協定 SoccerFieldDef + 客戶端衍生欄位（goalZ / goalTube / startZ） */
export interface ActiveSoccerField {
  /** 半寬（x 邊界 ±halfX） */
  halfX: number;
  /** 半長（z 邊界 ±halfZ） */
  halfZ: number;
  /** 天花板高度（協定欄位名 ceil；內部沿用 top） */
  top: number;
  /** 球門面 z（伺服器有帶就用；沒帶 → halfZ - SOCCER_GOAL_INSET 衍生） */
  goalZ: number;
  /** 球門中心高度 */
  goalY: number;
  /** 球門環半徑 */
  goalR: number;
  /** 球門環管半徑（視覺；伺服器有帶 goalTube 就用，否則按舊比例衍生） */
  goalTube: number;
  /** 護罩半徑（伺服器有帶 shieldR 就用，否則 F9A-A fallback） */
  shieldR: number;
  /** 起飛區進深（沿 z） */
  startDepth: number;
  /** 起飛區長度（沿 x）= 人數 × 球徑 */
  startWidth: number;
  /** 起飛區中心 |z|（貼底線內側 = halfZ - 進深/2） */
  startZ: number;
}

/** 舊版伺服器可能帶 top / goalZ / goalTube（新協定一併下發 goalZ、goalTube、shieldR）→ 都吃 */
type LooseFieldDef = SoccerFieldDef & {
  top?: number;
  goalZ?: number;
  goalTube?: number;
  shieldR?: number;
  startDepth?: number;
  startWidth?: number;
};

/** 舊伺服器沒帶管半徑時的衍生（下限防過細）；F9A 預設會直接下發 0.1 */
function goalTubeOf(goalR: number): number {
  return Math.max(0.08, +(goalR * 0.09).toFixed(2));
}

function fromFallback(): ActiveSoccerField {
  return {
    halfX: SOCCER_FIELD.halfX,
    halfZ: SOCCER_FIELD.halfZ,
    top: SOCCER_FIELD.top,
    goalZ: SOCCER_FIELD.goalZ,
    goalY: SOCCER_FIELD.goalY,
    goalR: SOCCER_FIELD.goalR,
    goalTube: SOCCER_FIELD.goalTube,
    shieldR: SOCCER_FIELD.shieldR,
    startDepth: SOCCER_START_DEPTH,
    startWidth: SOCCER_BALL_R * 2,
    startZ: SOCCER_FIELD.startZ,
  };
}

let current: ActiveSoccerField = fromFallback();

/** 取得目前生效的場地（render / 邏輯 / 相機統一從這裡讀） */
export function activeSoccerField(): ActiveSoccerField {
  return current;
}

/**
 * 套用伺服器下發的場地定義；回傳「是否有變」（有變 → 呼叫端發 soccer-field-changed
 * 讓 render 重建場地）。欄位缺漏 / 非數字 → 整份忽略（保持現值，等同 fallback）。
 */
export function setSoccerFieldFromServer(def: SoccerFieldDef | null | undefined): boolean {
  if (
    !def ||
    typeof def.halfX !== 'number' ||
    typeof def.halfZ !== 'number' ||
    typeof def.goalY !== 'number' ||
    typeof def.goalR !== 'number'
  ) {
    return false;
  }
  const loose = def as LooseFieldDef;
  const next: ActiveSoccerField = {
    halfX: def.halfX,
    halfZ: def.halfZ,
    top: typeof def.ceil === 'number' ? def.ceil : (loose.top ?? SOCCER_FIELD.top),
    goalZ: typeof loose.goalZ === 'number' ? loose.goalZ : def.halfZ - SOCCER_GOAL_INSET,
    goalY: def.goalY,
    goalR: def.goalR,
    goalTube: typeof loose.goalTube === 'number' ? loose.goalTube : goalTubeOf(def.goalR),
    shieldR: typeof loose.shieldR === 'number' ? loose.shieldR : SOCCER_BALL_R,
    startDepth: typeof loose.startDepth === 'number' ? loose.startDepth : SOCCER_START_DEPTH,
    startWidth: typeof loose.startWidth === 'number' ? loose.startWidth : SOCCER_BALL_R * 2,
    startZ: def.halfZ - (typeof loose.startDepth === 'number' ? loose.startDepth : SOCCER_START_DEPTH) / 2,
  };
  const changed =
    next.halfX !== current.halfX ||
    next.halfZ !== current.halfZ ||
    next.top !== current.top ||
    next.goalZ !== current.goalZ ||
    next.goalY !== current.goalY ||
    next.goalR !== current.goalR ||
    next.goalTube !== current.goalTube ||
    next.shieldR !== current.shieldR ||
    next.startDepth !== current.startDepth ||
    next.startWidth !== current.startWidth ||
    next.startZ !== current.startZ;
  current = next;
  return changed;
}

/** 回 fallback（單人練習進場 / 離開多人對戰時呼叫，避免殘留上一場的伺服器場地） */
export function resetSoccerField(): void {
  current = fromFallback();
}
