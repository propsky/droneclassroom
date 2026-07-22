// ⚽ 「目前生效」的足球場地 — 資料驅動的核心（純 TS，不依賴 Babylon）。
//
// 多人對戰：伺服器在 soccer_go / soccer_state 下發 field: SoccerFieldDef，
// 場地渲染 / 門環 / 邊界 clamp / 進球判定 / 相機取景全部依這份「生效值」計算 —
// 之後老師調場地大小，客戶端零改動。
// 單人練習：沒有伺服器 → 進場時 resetSoccerField() 回 constants.ts 的 fallback。
import type { SoccerFieldDef } from '@creafly/shared';
import { SOCCER_FIELD, SOCCER_GOAL_INSET } from './constants';

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
  /** 球門環管徑（視覺；隨 goalR 比例衍生） */
  goalTube: number;
  /** 起始區中心 z（= halfZ / 2 衍生；單人練習用） */
  startZ: number;
}

/** 舊版伺服器線上格式可能帶 top / goalZ（新協定是 ceil、goalZ 由客戶端衍生）→ 都吃 */
type LooseFieldDef = SoccerFieldDef & { top?: number; goalZ?: number };

/** 門環管徑：隨半徑比例（goalR 1.2 → 0.11 對齊 legacy；下限防過細） */
function goalTubeOf(goalR: number): number {
  return Math.max(0.11, +(goalR * 0.09).toFixed(2));
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
    goalTube: goalTubeOf(def.goalR),
    startZ: def.halfZ / 2,
  };
  const changed =
    next.halfX !== current.halfX ||
    next.halfZ !== current.halfZ ||
    next.top !== current.top ||
    next.goalZ !== current.goalZ ||
    next.goalY !== current.goalY ||
    next.goalR !== current.goalR;
  current = next;
  return changed;
}

/** 回 fallback（單人練習進場 / 離開多人對戰時呼叫，避免殘留上一場的伺服器場地） */
export function resetSoccerField(): void {
  current = fromFallback();
}
