// 關卡輸入錄製與伺服器重播驗證的線上格式（J-01 / J-02）。
// 零 runtime 依賴：僅資料結構與純函數校驗。
import type { LevelDef } from './levels';

export const INPUT_RECORDING_VERSION = 1 as const;

/** 單 tick 手動輸入快照（不含 anyInput — 重播不需要） */
export interface ControlFrameSnapshot {
  lift: number;
  forward: number;
  right: number;
  yawDelta: number;
  wantsTakeoff: boolean;
}

export interface InputRecordingV1 {
  v: typeof INPUT_RECORDING_VERSION;
  levelId: string;
  /** 嘗試開始時的關卡快照（老師改關後仍能重播當次物理） */
  level: LevelDef;
  /** cf_random 播種；重播前必須 seedRng(rngSeed) */
  rngSeed: number;
  /** 錄製 tick 數（= frames.length） */
  ticks: number;
  frames: ControlFrameSnapshot[];
  /** Blockly 生成碼；有值時重播走程式模式 */
  programCode?: string;
  /** 錄製期逐 tick 累積的 FNV-1a 狀態 hash（hex） */
  replayHash: string;
}

/** 單次 complete_level 可附帶的輸入紀錄（帳號模式；訪客不送） */
export type InputLogPayload = InputRecordingV1;

/** 錄製上限：10 分鐘 @ 60Hz（防 WS / localStorage 爆量） */
export const MAX_RECORDING_TICKS = 36_000;

export function isInputRecordingV1(v: unknown): v is InputRecordingV1 {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.v === INPUT_RECORDING_VERSION &&
    typeof r.levelId === 'string' &&
    typeof r.level === 'object' &&
    r.level !== null &&
    typeof r.rngSeed === 'number' &&
    typeof r.ticks === 'number' &&
    Array.isArray(r.frames) &&
    typeof r.replayHash === 'string'
  );
}

/** 壓縮傳輸前檢查：欄位齊全且 tick 數一致 */
export function validateRecording(rec: InputRecordingV1): string | null {
  if (rec.frames.length !== rec.ticks) return 'frames 與 ticks 不一致';
  if (rec.ticks > MAX_RECORDING_TICKS) return `超過錄製上限 ${MAX_RECORDING_TICKS} ticks`;
  if (rec.programCode !== undefined && typeof rec.programCode !== 'string') {
    return 'programCode 型別錯誤';
  }
  return null;
}
