// 程式模式：cf_* Action API + 程式執行器。
// 指令產生 motion plan（起點/終點/時長/easing），由 60Hz 物理 tick 推進（tickProgram），
// 完成才 resolve Promise —— 與 legacy 的 rAF tween 對外行為等價，但狀態流單一。
import { DEG2RAD, randomInt } from '@creafly/shared';
import { droneState, HOME_POSITION, flags, forwardVec, rightVec, type Vec3 } from './droneState';
import { easeInOut } from './physics';
import { resetMission, checkProgramCompletion, levelState } from './level';
import { inkPenDown, inkPenUp, inkSetColor, inkRandomColor } from './pen';
import { bus, toast, sound, stateHud } from './events';

export const programState = {
  running: false,
  abort: false,
  /** cf_elapsed / cf_timerReset 的基準時間戳 */
  startTime: 0,
};

const ABORT_MSG = '使用者中斷';

// =============================================================================
// Motion plan（由物理 tick 推進，不在 rAF 另開 tween 迴圈）
// =============================================================================
interface MotionPlan {
  elapsed: number;
  duration: number;
  /** e = eased 進度 0→1 */
  apply: (e: number) => void;
  eased: boolean;
  resolve: () => void;
  reject: (e: Error) => void;
}

let activePlan: MotionPlan | null = null;

function startPlan(
  duration: number,
  apply: (e: number) => void,
  eased = true,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    activePlan = { elapsed: 0, duration, apply, eased, resolve, reject };
  });
}

/** 可中斷 sleep（同樣由 tick 推進） */
function sleep(ms: number): Promise<void> {
  return startPlan(ms, () => undefined, false);
}

/** 每個物理 tick 呼叫：推進當前 motion plan */
export function tickProgram(dtMs: number): void {
  if (!activePlan) return;
  if (programState.abort) {
    const plan = activePlan;
    activePlan = null;
    plan.reject(new Error(ABORT_MSG));
    return;
  }
  activePlan.elapsed += dtMs;
  const t = Math.min(activePlan.elapsed / activePlan.duration, 1);
  activePlan.apply(activePlan.eased ? easeInOut(t) : t);
  if (t >= 1) {
    const plan = activePlan;
    activePlan = null;
    plan.resolve();
  }
}

/** 生成碼的迴圈積木（cf_forever / cf_every）每輪呼叫：中斷時立即 throw 跳出 */
export function ensureRunning(): void {
  if (!programState.running) throw new Error('程式未執行');
  if (programState.abort) throw new Error(ABORT_MSG);
}

const lerpVec = (out: Vec3, a: Vec3, b: Vec3, t: number): void => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
};

// =============================================================================
// cf_* Action API（Blockly 積木的執行介面 — 語意與 legacy §8 完全相同）
// =============================================================================
export async function cf_takeoff(height = 8): Promise<void> {
  ensureRunning();
  const from = droneState.position.y;
  const to = Math.max(height, 1.5);
  droneState.isGrounded = false;
  droneState.isFlying = true;
  stateHud('起飛中...');
  await startPlan(1500, (e) => (droneState.position.y = from + (to - from) * e));
  // 繪圖關卡：起飛即自動下筆（學生不放 🖊️下筆 也能畫；抬筆/下筆積木仍可調整）
  if (levelState.current?.draw) inkPenDown();
  stateHud('飛行中');
}

export async function cf_land(): Promise<void> {
  ensureRunning();
  stateHud('降落中...');
  const from = droneState.position.y;
  const to = HOME_POSITION.y;
  await startPlan(1500, (e) => (droneState.position.y = from + (to - from) * e));
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.isFlying = false;
  droneState.isGrounded = true;
  stateHud('已降落');
}

/** 機頭方向水平位移（distance 可為負 = 後退） */
async function moveHorizontal(dir: Vec3, distance: number, label: string): Promise<void> {
  ensureRunning();
  const start: Vec3 = { ...droneState.position };
  const target: Vec3 = {
    x: start.x + dir.x * distance,
    y: start.y + dir.y * distance,
    z: start.z + dir.z * distance,
  };
  stateHud(label);
  const duration = Math.max(300, Math.abs(distance) * 500);
  await startPlan(duration, (e) => lerpVec(droneState.position, start, target, e));
  stateHud('飛行中');
}

export async function cf_forward(distance = 2): Promise<void> {
  return moveHorizontal(forwardVec(droneState.yaw), distance, `前進 ${distance}m`);
}

export async function cf_backward(distance = 2): Promise<void> {
  return moveHorizontal(forwardVec(droneState.yaw), -Math.abs(distance), `後退 ${distance}m`);
}

export async function cf_left(distance = 2): Promise<void> {
  return moveHorizontal(rightVec(droneState.yaw), -Math.abs(distance), `左飛 ${distance}m`);
}

export async function cf_right(distance = 2): Promise<void> {
  return moveHorizontal(rightVec(droneState.yaw), Math.abs(distance), `右飛 ${distance}m`);
}

export async function cf_up(distance = 1): Promise<void> {
  ensureRunning();
  const start: Vec3 = { ...droneState.position };
  const target: Vec3 = { x: start.x, y: start.y + distance, z: start.z };
  droneState.isGrounded = false;
  droneState.isFlying = true;
  stateHud(distance >= 0 ? `上升 ${distance}m` : `下降 ${-distance}m`);
  const duration = Math.max(250, Math.abs(distance) * 600);
  await startPlan(duration, (e) => lerpVec(droneState.position, start, target, e));
  stateHud('飛行中');
}

export async function cf_down(distance = 1): Promise<void> {
  return cf_up(-Math.abs(distance));
}

export async function cf_hover(seconds = 1): Promise<void> {
  ensureRunning();
  stateHud(`懸停 ${seconds}s`);
  await sleep(seconds * 1000);
  stateHud('飛行中');
}

export async function cf_wait(seconds = 1): Promise<void> {
  return cf_hover(seconds);
}

export async function cf_rotateClockwise(angle = 90): Promise<void> {
  ensureRunning();
  const from = droneState.yaw;
  const to = from - angle * DEG2RAD; // 順時針 = yaw 負方向（從上方看）
  stateHud(`順時針 ${angle}°`);
  await startPlan(800, (e) => (droneState.yaw = from + (to - from) * e));
  stateHud('飛行中');
}

export async function cf_rotateCounterClockwise(angle = 90): Promise<void> {
  ensureRunning();
  const from = droneState.yaw;
  const to = from + angle * DEG2RAD;
  stateHud(`逆時針 ${angle}°`);
  await startPlan(800, (e) => (droneState.yaw = from + (to - from) * e));
  stateHud('飛行中');
}

// 畫畫教室：畫筆動作（只在 draw 關卡有意義；非 draw 關卡呼叫不影響飛行）
export function cf_penDown(): void {
  ensureRunning();
  inkPenDown();
  stateHud('🖊️ 下筆');
}

export function cf_penUp(): void {
  ensureRunning();
  inkPenUp();
  stateHud('✋ 抬筆');
}

export function cf_penColor(c: string): void {
  ensureRunning();
  inkSetColor(c);
  stateHud('🎨 換色');
}

export function cf_penRandom(): void {
  ensureRunning();
  inkRandomColor();
  stateHud('🎲 隨機換色');
}

/** 從程式開始到現在的秒數（可用於「if elapsed > 5」條件） */
export function cf_elapsed(): number {
  if (!programState.startTime) return 0;
  return (Date.now() - programState.startTime) / 1000;
}

export function cf_timerReset(): void {
  programState.startTime = Date.now();
  stateHud('⏱ 計時器重設');
}

/** 隨機整數 A~B（含頭尾），A > B 自動對調 */
export function cf_random(a: number, b: number): number {
  return randomInt(Number(a), Number(b));
}

export function cf_log(msg: unknown): void {
  console.log('[CREAFLY]', msg);
}

/** 注入給生成碼的 API 物件（也掛在 window.CREAFLY 方便 debug） */
export const CREAFLY_API = {
  takeoff: cf_takeoff,
  land: cf_land,
  hover: cf_hover,
  wait: cf_wait,
  forward: cf_forward,
  backward: cf_backward,
  left: cf_left,
  right: cf_right,
  up: cf_up,
  down: cf_down,
  rotateClockwise: cf_rotateClockwise,
  rotateCounterClockwise: cf_rotateCounterClockwise,
  penDown: cf_penDown,
  penUp: cf_penUp,
  penColor: cf_penColor,
  penRandom: cf_penRandom,
  elapsed: cf_elapsed,
  timerReset: cf_timerReset,
  random: cf_random,
  log: cf_log,
  ensureRunning,
};

// =============================================================================
// 程式執行（new Function + 顯式 API 注入；不用 eval）
// =============================================================================
export function runProgram(code: string): void {
  if (programState.running) return;

  resetMission();
  programState.running = true;
  programState.abort = false;
  programState.startTime = Date.now();
  flags.programRunning = true;
  bus.emit('program-running', { running: true });

  let promise: Promise<void>;
  try {
    // 生成碼只看得到顯式注入的 CREAFLY API，包成 async IIFE 執行
    const fn = new Function(
      'CREAFLY',
      `"use strict";\nreturn (async () => {\n${code}\n})();`,
    ) as (api: typeof CREAFLY_API) => Promise<void>;
    promise = fn(CREAFLY_API);
  } catch (e) {
    toast(`編譯失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    finishProgram();
    return;
  }

  promise
    .then(() => {
      const r = checkProgramCompletion();
      if (r.passed) {
        const msg = r.allRings
          ? `🎉 完成！穿過 ${r.totalRings} 個圈，用時 ${(r.elapsedMs / 1000).toFixed(1)}s`
          : `🎉 完成！過關用時 ${(r.elapsedMs / 1000).toFixed(1)}s`;
        toast(msg, 'success');
        sound('complete');
      } else if (r.totalRings > 0) {
        toast(`程式結束，但只穿過 ${r.ringsCollected} 個圈`);
      } else {
        toast('程式執行結束');
      }
      finishProgram();
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== ABORT_MSG) {
        toast(`執行錯誤：${msg}`, 'error');
        console.error(e);
      } else {
        toast('已中斷');
      }
      finishProgram();
    });
}

export function stopProgram(): void {
  if (!programState.running) return;
  programState.abort = true;
}

function finishProgram(): void {
  programState.running = false;
  flags.programRunning = false;
  activePlan = null;
  bus.emit('program-running', { running: false });
}

// =============================================================================
// 模式切換（手動 ↔ 程式）
// =============================================================================
export function setMode(mode: 'manual' | 'program'): void {
  if (flags.mode === mode) return;
  if (programState.running) {
    toast('⏳ 程式執行中，無法切換模式', 'error');
    return;
  }
  flags.mode = mode;
  bus.emit('mode-changed', { mode });
}
