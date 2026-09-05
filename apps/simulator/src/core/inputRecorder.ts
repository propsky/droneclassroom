// 關卡輸入錄製（J-01）：從計時開始到過關，每 tick 記錄 ControlFrame 並累積 replayHash。
import type { ControlFrameSnapshot, InputRecordingV1, LevelDef } from '@creafly/shared';
import { MAX_RECORDING_TICKS } from '@creafly/shared';
import type { ControlFrame } from './physics';
import { FNV_OFFSET, hashDroneTick, hashToHex } from './simHash';
import { rng, seedRng } from './rng';

function snapshotFrame(f: ControlFrame): ControlFrameSnapshot {
  return {
    lift: f.lift,
    forward: f.forward,
    right: f.right,
    yawDelta: f.yawDelta,
    wantsTakeoff: f.wantsTakeoff,
  };
}

function frameFromSnapshot(s: ControlFrameSnapshot): ControlFrame {
  return { ...s, anyInput: false };
}

export { frameFromSnapshot };

interface ActiveRecording {
  levelId: string;
  level: LevelDef;
  rngSeed: number;
  frames: ControlFrameSnapshot[];
  hash: bigint;
  programCode?: string;
}

let active: ActiveRecording | null = null;

/** 計時開始（level-timing-started）時呼叫 */
export function startInputRecording(level: LevelDef): void {
  const rngSeed = (Date.now() >>> 0) ^ (Math.random() * 0xffffffff) >>> 0;
  seedRng(rngSeed);
  active = {
    levelId: level.id,
    level: structuredClone(level),
    rngSeed,
    frames: [],
    hash: FNV_OFFSET,
  };
}

/** Blockly 程式開始執行時附帶原始碼 */
export function attachProgramCode(code: string): void {
  if (active) active.programCode = code;
}

/** 每 physics tick 呼叫（主迴圈） */
export function recordInputTick(frame: ControlFrame): void {
  if (!active) return;
  if (active.frames.length >= MAX_RECORDING_TICKS) return;
  active.frames.push(snapshotFrame(frame));
  active.hash = hashDroneTick(active.hash);
}

export function isRecording(): boolean {
  return active !== null;
}

/** 過關時結束錄製；若未在錄製則回 null */
export function finishInputRecording(): InputRecordingV1 | null {
  if (!active) return null;
  const rec: InputRecordingV1 = {
    v: 1,
    levelId: active.levelId,
    level: active.level,
    rngSeed: active.rngSeed,
    ticks: active.frames.length,
    frames: active.frames,
    programCode: active.programCode,
    replayHash: hashToHex(active.hash),
  };
  active = null;
  return rec;
}

/** 關卡重置 / 離開時丟棄 */
export function cancelInputRecording(): void {
  active = null;
}

/** 測試用：目前累積 hash（hex） */
export function peekRecordingHash(): string | null {
  return active ? hashToHex(active.hash) : null;
}
