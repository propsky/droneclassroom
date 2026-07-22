// 搖桿校正精靈 — 8 步驟狀態機（對齊 legacy §6c）。
// 純邏輯與 UI 分離：狀態機只透過 bus 發事件，ui/calibrationOverlay.ts 訂閱渲染。
// 流程：rest 5s → 左桿置中 5s → 左桿畫圈 10s → 右桿置中 5s → 右桿畫圈 10s
//       → 起飛 / 降落 / 重置 3 個按鍵偵測（按下邊緣捕捉 + 完全放開才進下一步）。
// 置中步驟取平均為 center；畫圈步驟取 min/max 為 range；存 localStorage 沿用 legacy key。
import { bus, toast } from '../core/events';

// =============================================================================
// 搖桿設定（校正資料的載體；gamepad.ts 每 tick 讀取套用）
// =============================================================================
export interface GamepadConfig {
  deadzone: number;
  invertThrottle: boolean;
  invertPitch: boolean;
  /** 語意軸 → 實體 axes index（美國手 Mode 2：左Y=throttle 左X=yaw 右Y=pitch 右X=roll） */
  axes: { throttle: number; pitch: number; yaw: number; roll: number };
  buttonMap: { takeoff: number; land: number; reset: number };
  /** 每軸置中值（校正精靈量測） */
  center: number[];
  /** 每軸範圍（校正精靈量測；套用時 (raw - center) / range） */
  range: number[];
}

export const gamepadConfig: GamepadConfig = {
  deadzone: parseFloat(new URLSearchParams(location.search).get('dz') ?? '') || 0.1,
  invertThrottle: false,
  invertPitch: false,
  axes: { throttle: 1, pitch: 3, yaw: 0, roll: 2 },
  buttonMap: { takeoff: 0, land: 1, reset: 2 },
  center: [0, 0, 0, 0],
  range: [1, 1, 1, 1],
};

export const CALIB_LS_KEY = 'creafly_gamepad_calib';
const VERSION_LS_KEY = 'creafly_app_version';
// 沿用 legacy 的版本碼機制與現值（v1.5.x 校正資料格式相容）——
// 已在 legacy 校正過的裝置無痛沿用；未來校正資料格式改變時 bump 此值即自動清除舊資料。
export const CALIB_VERSION = '1.5.1';

/** 載入上次校正（版本碼不符自動清除）。initGamepad 時呼叫一次。 */
export function loadGamepadConfig(): void {
  try {
    const storedVer = localStorage.getItem(VERSION_LS_KEY);
    if (storedVer !== CALIB_VERSION) {
      localStorage.removeItem(CALIB_LS_KEY);
      localStorage.setItem(VERSION_LS_KEY, CALIB_VERSION);
      console.log(`[校正] 版本碼不符（stored: ${storedVer}）→ 已清掉舊校正資料`);
      return;
    }
    const saved = localStorage.getItem(CALIB_LS_KEY);
    if (saved) {
      const obj = JSON.parse(saved) as Partial<GamepadConfig>;
      Object.assign(gamepadConfig, obj);
      console.log('[校正] 載入上次的設定', gamepadConfig);
    }
  } catch (e) {
    console.warn('[校正] 載入校正設定失敗', e);
  }
}

export function saveGamepadConfig(): void {
  try {
    localStorage.setItem(CALIB_LS_KEY, JSON.stringify(gamepadConfig));
  } catch {
    /* ignore（無痕模式等） */
  }
}

// =============================================================================
// 校正步驟定義（與 legacy CALIB_STEPS 一致）
// =============================================================================
export type CalibPhase = 'rest' | 'center' | 'circle';
export type CalibButtonKey = 'takeoff' | 'land' | 'reset';

export interface CalibStep {
  id: string;
  label: string;
  hint: string;
  duration?: number;
  axes?: number[];
  phase?: CalibPhase;
  button?: CalibButtonKey;
}

export const CALIB_STEPS: CalibStep[] = [
  { id: 'rest',        label: '放開所有搖桿',   hint: '不要碰任何按鍵或推桿 — 5 秒後自動繼續',       duration: 5000,  axes: [0, 1, 2, 3], phase: 'rest' },
  { id: 'leftCenter',  label: '左搖桿置中',     hint: '完全放開左搖桿、不要動 — 5 秒',               duration: 5000,  axes: [0, 1],       phase: 'center' },
  { id: 'leftCircle',  label: '左搖桿畫大圈',   hint: '把左搖桿轉到最外圈、順時鐘畫大圈、撐 10 秒',   duration: 10000, axes: [0, 1],       phase: 'circle' },
  { id: 'rightCenter', label: '右搖桿置中',     hint: '完全放開右搖桿、不要動 — 5 秒',               duration: 5000,  axes: [2, 3],       phase: 'center' },
  { id: 'rightCircle', label: '右搖桿畫大圈',   hint: '把右搖桿轉到最外圈、順時鐘畫大圈、撐 10 秒',   duration: 10000, axes: [2, 3],       phase: 'circle' },
  { id: 'btnTakeoff',  label: '按「起飛」按鈕', hint: '按一個你想要的按鈕（A / X / START 都可）',    button: 'takeoff' },
  { id: 'btnLand',     label: '按「降落」按鈕', hint: '按一個你想要的按鈕',                          button: 'land' },
  { id: 'btnReset',    label: '按「重置」按鈕', hint: '按一個你想要的按鈕',                          button: 'reset' },
];

// =============================================================================
// 狀態機
// =============================================================================
export const calibration = {
  active: false,
  stepIdx: 0,
  startTime: 0,
  center: [0, 0, 0, 0] as number[],
  min: [0, 0, 0, 0] as number[],
  max: [0, 0, 0, 0] as number[],
  detectedButtons: { takeoff: null, land: null, reset: null } as Record<CalibButtonKey, number | null>,
  lastBtnSample: [] as boolean[],
  buttonCaptured: false,
  _sum: [0, 0, 0, 0] as number[],
  _cnt: [0, 0, 0, 0] as number[],
  _init: [false, false, false, false] as boolean[],
};

// gamepad 讀值來源（由 index.ts 注入，避免 calibration ↔ gamepad 循環依賴）
type PadSnapshot = { connected: boolean; axes: number[]; buttons: boolean[] };
let readPad: () => PadSnapshot = () => ({ connected: false, axes: [0, 0, 0, 0], buttons: [] });

export function initCalibration(padReader: () => PadSnapshot): void {
  readPad = padReader;
  loadGamepadConfig();
}

// timer 用獨立 setInterval 驅動（每 100ms），確保 rAF / 主迴圈卡住時進度條照走
let calibTimer: ReturnType<typeof setInterval> | null = null;

function emitStep(): void {
  const done = calibration.stepIdx >= CALIB_STEPS.length;
  const step = CALIB_STEPS[calibration.stepIdx];
  bus.emit('calib-step', {
    stepIdx: calibration.stepIdx,
    total: CALIB_STEPS.length,
    label: done ? '🎉 校正完成！' : step?.label ?? '',
    hint: done ? '按「儲存並套用」或「取消」' : step?.hint ?? '',
    hasTimer: !done && !!step?.axes,
    durationMs: step?.duration ?? 0,
    done,
  });
}

export function startCalibration(): void {
  const pad = readPad();
  if (!pad.connected) {
    toast('請先插上搖桿', 'error');
    return;
  }
  calibration.active = true;
  calibration.stepIdx = 0;
  calibration.center = [0, 0, 0, 0];
  calibration.min = [0, 0, 0, 0];
  calibration.max = [0, 0, 0, 0];
  calibration.detectedButtons = { takeoff: null, land: null, reset: null };
  calibration.lastBtnSample = pad.buttons.map(() => false);
  calibration.buttonCaptured = false;
  // 預先 init 暫存陣列（避免 tick 讀 undefined）
  calibration._sum = [0, 0, 0, 0];
  calibration._cnt = [0, 0, 0, 0];
  calibration._init = [false, false, false, false];
  calibration.startTime = Date.now();
  bus.emit('calib-show', { show: true });
  emitStep();
  if (calibTimer) clearInterval(calibTimer);
  calibTimer = setInterval(updateCalibTimer, 100);
}

/** save = true：結算 center/range + 按鍵映射並寫進 localStorage */
export function endCalibration(save: boolean): void {
  calibration.active = false;
  if (calibTimer) {
    clearInterval(calibTimer);
    calibTimer = null;
  }
  if (save) {
    // 每軸 range 取 center 兩側最大飄移；沒收集到的軸（min===max===0）保底 0.5
    const newRange = [1, 1, 1, 1];
    for (let i = 0; i < 4; i++) {
      const c = calibration.center[i] ?? 0;
      const downRange = Math.abs((calibration.min[i] ?? 0) - c);
      const upRange = Math.abs((calibration.max[i] ?? 0) - c);
      newRange[i] = Math.max(downRange, upRange, 0.5);
    }
    gamepadConfig.center = calibration.center.slice();
    gamepadConfig.range = newRange;
    (['takeoff', 'land', 'reset'] as const).forEach((k) => {
      const idx = calibration.detectedButtons[k];
      if (idx !== null) gamepadConfig.buttonMap[k] = idx;
    });
    saveGamepadConfig();
    toast('✓ 校正完成 — center/range 已套用', 'success');
    console.log('[校正結果]', {
      center: gamepadConfig.center,
      range: gamepadConfig.range,
      buttons: gamepadConfig.buttonMap,
    });
  } else {
    toast('校正取消');
  }
  bus.emit('calib-ended', { saved: save });
  bus.emit('calib-show', { show: false });
}

/** 跳過此步（UI「跳過此步」按鈕） */
export function skipCalibStep(): void {
  if (!calibration.active) return;
  // 清暫存，避免上一步收集到一半的資料污染下一步
  for (let i = 0; i < 4; i++) {
    calibration._sum[i] = 0;
    calibration._cnt[i] = 0;
    calibration._init[i] = false;
  }
  calibration.buttonCaptured = false;
  advanceStep();
}

function advanceStep(): void {
  calibration.stepIdx++;
  calibration.startTime = Date.now();
  emitStep();
}

function updateCalibTimer(): void {
  if (!calibration.active) return;
  const step = CALIB_STEPS[calibration.stepIdx];
  if (!step || !step.axes || !step.duration) return;
  const elapsed = Date.now() - calibration.startTime;
  bus.emit('calib-timer', {
    pct: Math.min(100, (elapsed / step.duration) * 100),
    remainSec: Math.max(0, Math.ceil((step.duration - elapsed) / 1000)),
  });
}

/** 每個物理 tick 由 input/index.ts 呼叫：收集軸資料 / 偵測按鍵邊緣 */
export function tickCalibration(): void {
  if (!calibration.active) return;
  const step = CALIB_STEPS[calibration.stepIdx];
  if (!step) return;

  const pad = readPad();
  const rawAxes = pad.axes;
  const btns = pad.buttons;
  bus.emit('calib-live', { axes: rawAxes.slice(0, 4), buttons: btns.slice(0, 17) });

  // ===== 軸資料收集步驟 =====
  if (step.axes && step.duration) {
    for (const i of step.axes) {
      const v = rawAxes[i] ?? 0;
      if (step.phase === 'rest' || step.phase === 'center') {
        // 累加 → 結算時取平均為 center
        calibration._sum[i] = (calibration._sum[i] ?? 0) + v;
        calibration._cnt[i] = (calibration._cnt[i] ?? 0) + 1;
      } else if (step.phase === 'circle') {
        // 畫圈取 min/max 為 range
        if (!calibration._init[i]) {
          calibration.min[i] = v;
          calibration.max[i] = v;
          calibration._init[i] = true;
        } else {
          if (v < (calibration.min[i] ?? 0)) calibration.min[i] = v;
          if (v > (calibration.max[i] ?? 0)) calibration.max[i] = v;
        }
      }
    }
    const elapsed = Date.now() - calibration.startTime;
    if (elapsed >= step.duration) {
      // 結算
      if (step.phase === 'rest' || step.phase === 'center') {
        for (const i of step.axes) {
          const cnt = calibration._cnt[i] || 1;
          calibration.center[i] = (calibration._sum[i] ?? 0) / cnt;
        }
      }
      for (let i = 0; i < 4; i++) {
        calibration._sum[i] = 0;
        calibration._cnt[i] = 0;
        calibration._init[i] = false;
      }
      advanceStep();
    }
    return;
  }

  // ===== 按鍵偵測步驟（按下邊緣捕捉；等「完全放開」才進下一步）=====
  if (step.button) {
    const anyPressed = btns.some((b) => b);
    if (anyPressed) {
      if (!calibration.buttonCaptured) {
        for (let i = 0; i < btns.length; i++) {
          if (btns[i] && !calibration.lastBtnSample[i]) {
            calibration.detectedButtons[step.button] = i;
            calibration.buttonCaptured = true;
            toast(`✓ 抓到 button ${i}（放開後進到下一步）`, 'success');
            break;
          }
        }
      }
      calibration.lastBtnSample = btns.slice();
    } else if (calibration.buttonCaptured) {
      calibration.buttonCaptured = false;
      calibration.lastBtnSample = btns.slice();
      advanceStep();
    } else {
      calibration.lastBtnSample = btns.slice();
    }
  }
}
