// 關卡輸入錄製與伺服器重播驗證的線上格式（J-01 / J-02）。
// 零 runtime 依賴：僅資料結構與純函數校驗。
//
// v2 重現模型（v1 的已知誤判來源全部補上）：
//   - frames：每 tick 的手動輸入（含 anyInput — 急停後解凍要用）
//   - actions：不經 ControlFrame、直接改狀態的離散操作（起降鍵 / 重置 / 急停 / 回家 /
//     模式切換 / 執行與停止程式），記錄發生在第幾 tick 前、是否在 tick 內觸發
//   - multiTickFrames：瀏覽器一個畫面連跑多個 tick 時，tick 之間不會排空微任務；
//     重播據此在相同時點排空，程式模式 async 指令鏈的推進時點才會一致
//   - initial / startTick / mode：錄製起點的無人機狀態、模擬 tick 與操控模式
import type { LevelDef } from './levels';

export const INPUT_RECORDING_VERSION = 2 as const;

/** 單 tick 輸入：[lift, forward, right, yawDelta, bits]；bits 見 FRAME_BIT_* */
export type RecordedFrame = [number, number, number, number, number];
export const FRAME_BIT_TAKEOFF = 1;
export const FRAME_BIT_ANY_INPUT = 2;

export type RecordedActionKind =
  | 'takeoff'
  | 'land'
  | 'home'
  | 'estop'
  | 'reset'
  | 'stop'
  | 'mode'
  | 'run';

export interface RecordedAction {
  /** 套用在第 t 個錄製 tick 的物理之前（t = 當時已錄 tick 數） */
  t: number;
  a: RecordedActionKind;
  /** true = 在 fixed tick 內（搖桿按鍵輪詢）觸發；false = tick 之間（鍵盤 / 點擊 / WS） */
  inTick: boolean;
  /** a='mode' */
  mode?: 'manual' | 'program';
  /** a='run' */
  code?: string;
}

export interface RecordedDroneState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number;
  isFlying: boolean;
  isGrounded: boolean;
  frozen: boolean;
}

export interface InputRecordingV2 {
  v: typeof INPUT_RECORDING_VERSION;
  levelId: string;
  /** 嘗試開始時的關卡快照（伺服器以自己的關卡定義重播，此欄只用於比對） */
  level: LevelDef;
  /** 前端模擬核心版本（core + shared + 官方關卡內容雜湊）；與驗證器不同 → 無法驗證 */
  simVersion: string;
  /** cf_random 播種；重播前必須 seedRng(rngSeed) */
  rngSeed: number;
  /** 錄製起點的模擬 tick（simTime.tick） */
  startTick: number;
  mode: 'manual' | 'program';
  initial: RecordedDroneState;
  /** 錄製 tick 數（= frames.length） */
  ticks: number;
  frames: RecordedFrame[];
  actions: RecordedAction[];
  /** [起始 tick, tick 數]：同一畫面內連跑 ≥2 tick 的區段 */
  multiTickFrames: [number, number][];
  /** 錄製期間發生無法重現的狀況（超過上限 / tick 進行中觸發操作）→ 伺服器判為無法驗證 */
  unverifiable?: string;
  /** 錄製期逐 tick 累積的 FNV-1a 狀態 hash（hex） */
  replayHash: string;
}

/** 單次 complete_level 可附帶的輸入紀錄（帳號模式；訪客不送） */
export type InputLogPayload = InputRecordingV2;

/** 錄製上限：10 分鐘 @ 60Hz（防上傳 / 記憶體爆量） */
export const MAX_RECORDING_TICKS = 36_000;

export function isInputRecordingV2(v: unknown): v is InputRecordingV2 {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.v === INPUT_RECORDING_VERSION &&
    typeof r.levelId === 'string' &&
    typeof r.level === 'object' &&
    r.level !== null &&
    typeof r.simVersion === 'string' &&
    typeof r.rngSeed === 'number' &&
    typeof r.startTick === 'number' &&
    (r.mode === 'manual' || r.mode === 'program') &&
    typeof r.initial === 'object' &&
    r.initial !== null &&
    typeof r.ticks === 'number' &&
    Array.isArray(r.frames) &&
    Array.isArray(r.actions) &&
    Array.isArray(r.multiTickFrames) &&
    typeof r.replayHash === 'string'
  );
}

const ACTION_KINDS: ReadonlySet<string> = new Set([
  'takeoff', 'land', 'home', 'estop', 'reset', 'stop', 'mode', 'run',
]);

/** 結構校驗：欄位齊全、tick 數一致、操作與區段落在錄製範圍內 */
export function validateRecording(rec: InputRecordingV2): string | null {
  if (rec.frames.length !== rec.ticks) return 'frames 與 ticks 不一致';
  if (rec.ticks > MAX_RECORDING_TICKS) return `超過錄製上限 ${MAX_RECORDING_TICKS} ticks`;
  for (const f of rec.frames) {
    if (!Array.isArray(f) || f.length !== 5 || !f.every((n) => typeof n === 'number')) {
      return 'frame 格式錯誤';
    }
  }
  let lastT = 0;
  for (const a of rec.actions) {
    if (!ACTION_KINDS.has(a.a)) return `未知操作 ${String(a.a)}`;
    if (typeof a.t !== 'number' || a.t < lastT || a.t > rec.ticks) return '操作 tick 超出範圍';
    if (a.a === 'run' && typeof a.code !== 'string') return 'run 操作缺 code';
    if (a.a === 'mode' && a.mode !== 'manual' && a.mode !== 'program') return 'mode 操作缺 mode';
    lastT = a.t;
  }
  for (const seg of rec.multiTickFrames) {
    const [start, n] = seg;
    if (!(n >= 2) || start < 0 || start + n > rec.ticks) return 'multiTickFrames 超出範圍';
  }
  return null;
}
