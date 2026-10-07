// 關卡輸入錄製（J-01）：從計時開始到過關，記錄每 tick 輸入、離散操作與畫面切分，並累積 replayHash。
// 格式說明見 @creafly/shared inputRecording.ts（v2）。
import type {
  InputRecordingV2,
  LevelDef,
  RecordedAction,
  RecordedFrame,
} from '@creafly/shared';
import { FRAME_BIT_ANY_INPUT, FRAME_BIT_TAKEOFF, MAX_RECORDING_TICKS } from '@creafly/shared';
import type { ControlFrame } from './physics';
import { droneState, flags, simTime } from './droneState';
import { FNV_OFFSET, hashDroneTick, hashToHex } from './simHash';
import { seedRng } from './rng';
import { SIM_VERSION } from './simVersion';

export function encodeFrame(f: ControlFrame): RecordedFrame {
  const bits = (f.wantsTakeoff ? FRAME_BIT_TAKEOFF : 0) | (f.anyInput ? FRAME_BIT_ANY_INPUT : 0);
  return [f.lift, f.forward, f.right, f.yawDelta, bits];
}

export function decodeFrame(r: RecordedFrame): ControlFrame {
  return {
    lift: r[0],
    forward: r[1],
    right: r[2],
    yawDelta: r[3],
    wantsTakeoff: (r[4] & FRAME_BIT_TAKEOFF) !== 0,
    anyInput: (r[4] & FRAME_BIT_ANY_INPUT) !== 0,
  };
}

interface ActiveRecording {
  rec: Omit<InputRecordingV2, 'ticks' | 'replayHash'>;
  hash: bigint;
}

let active: ActiveRecording | null = null;
/** 每開始一段錄製 +1：畫面切分標記據此判斷錄製是否在畫面中途開始 */
let epoch = 0;
/** 目前是否在 fixed tick 內（主迴圈 / 重播設定）— 操作的 inTick 與 startTick 依此推算 */
let inFixedTick = false;
/** 本 tick 輸入已記、hash 尚未混入（過關可能發生在 tick 中途） */
let tickOpen = false;

export function setInFixedTick(v: boolean): void {
  inFixedTick = v;
}

function taint(reason: string): void {
  if (active && !active.rec.unverifiable) active.rec.unverifiable = reason;
}

/** 計時開始（level-timing-started）時呼叫 */
export function startInputRecording(level: LevelDef): void {
  const rngSeed = ((Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
  seedRng(rngSeed);
  epoch++;
  tickOpen = false;
  const p = droneState.position;
  const v = droneState.velocity;
  active = {
    rec: {
      v: 2,
      levelId: level.id,
      level: structuredClone(level),
      simVersion: SIM_VERSION,
      rngSeed,
      // tick 內開始：本 tick 已 advance、物理未跑 → 重播從前一 tick 起算
      startTick: inFixedTick ? simTime.tick - 1 : simTime.tick,
      mode: flags.mode,
      initial: {
        position: { x: p.x, y: p.y, z: p.z },
        velocity: { x: v.x, y: v.y, z: v.z },
        yaw: droneState.yaw,
        isFlying: droneState.isFlying,
        isGrounded: droneState.isGrounded,
        frozen: droneState.frozen,
      },
      frames: [],
      actions: [],
      multiTickFrames: [],
    },
    hash: FNV_OFFSET,
  };
  // 自動駕駛 plan 是 physics 模組內部狀態，錄不進起點 → 無法重現
  if (droneState.returning) taint('錄製開始時正在自動回家 / 降落');
}

/** 不經 ControlFrame 直接改狀態的操作（起降鍵 / 重置 / 急停 / 回家 / 模式 / 程式） */
export function recordAction(action: Omit<RecordedAction, 't' | 'inTick'>): void {
  if (!active) return;
  if (tickOpen) {
    taint('操作發生在 tick 物理途中');
    return;
  }
  active.rec.actions.push({ ...action, t: active.rec.frames.length, inTick: inFixedTick });
}

/** 一般關卡 tick 物理之前：記下本 tick 輸入 */
export function beginRecordedTick(frame: ControlFrame): void {
  if (!active || active.rec.unverifiable) return;
  if (active.rec.frames.length >= MAX_RECORDING_TICKS) {
    taint(`超過錄製上限 ${MAX_RECORDING_TICKS} ticks`);
    return;
  }
  active.rec.frames.push(encodeFrame(frame));
  tickOpen = true;
}

/** 一般關卡 tick 結束：混入本 tick 結束時的狀態 hash */
export function endRecordedTick(): void {
  if (!active || !tickOpen) return;
  active.hash = hashDroneTick(active.hash);
  tickOpen = false;
}

export interface FrameMark {
  epoch: number;
  start: number;
}

/** 渲染畫面開始（跑 fixed tick 迴圈之前） */
export function beginFrame(): FrameMark {
  return { epoch, start: active ? active.rec.frames.length : 0 };
}

/** 渲染畫面結束：本畫面跑了 ≥2 個錄製 tick → 記下（tick 之間沒有排空微任務） */
export function endFrame(mark: FrameMark): void {
  if (!active) return;
  const start = mark.epoch === epoch ? mark.start : 0;
  const n = active.rec.frames.length - start;
  if (n >= 2) active.rec.multiTickFrames.push([start, n]);
}

export function isRecording(): boolean {
  return active !== null;
}

/** 過關時結束錄製；若未在錄製則回 null */
export function finishInputRecording(): InputRecordingV2 | null {
  if (!active) return null;
  // tick 途中過關（tickLevel 判定）：該 tick 的物理已完成，直接收尾
  endRecordedTick();
  const rec: InputRecordingV2 = {
    ...active.rec,
    ticks: active.rec.frames.length,
    replayHash: hashToHex(active.hash),
  };
  active = null;
  return rec;
}

/** 關卡重置 / 離開時丟棄 */
export function cancelInputRecording(): void {
  active = null;
  tickOpen = false;
}
