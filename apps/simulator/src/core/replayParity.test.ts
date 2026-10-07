// 錄製 ↔ 重播一致性：線上端走與 main.ts 相同的 tickRecordedLevel / 畫面切分 / 操作入口，
// 重播端走伺服器驗證用的 replayRecording —— 兩邊 hash 必須相同、該過關的必須過關。
// 每個情境都對應一個曾經造成誠實學生被誤判的真實操作。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InputRecordingV2, LevelDef } from '@creafly/shared';
import { advanceSimTick, flags, simNowMs, simTime } from './droneState';
import { applyLoadLevel, armLevelStart, levelState, resetMission } from './level';
import { emergencyStop, goHome, padTakeoff, autoLand, type ControlFrame } from './physics';
import { programState, runProgram, setMode, stopProgram } from './program';
import { bus } from './events';
import {
  beginFrame,
  endFrame,
  finalizeRecording,
  initRecordingSession,
  isRecording,
  setInFixedTick,
} from './recordingSession';
import { tickRecordedLevel } from './simTick';
import { replayRecording } from './replayRunner';
import { verifyRecording } from './replayVerify';
import { FNV_OFFSET, hashToHex } from './simHash';
import { levelElapsedMs } from './level';

const ch1 = JSON.parse(readFileSync(join(__dirname, '../../public/levels/chapter1.json'), 'utf-8'));
const levels: LevelDef[] = Array.isArray(ch1) ? ch1 : ch1.levels;

const idle: ControlFrame = { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false };
const up: ControlFrame = { ...idle, lift: 1, wantsTakeoff: true, anyInput: true };
const down: ControlFrame = { ...idle, lift: -1, anyInput: true };
const fwd: ControlFrame = { ...idle, forward: 1, anyInput: true };
const turn: ControlFrame = { ...idle, yawDelta: 0.03, anyInput: true };

let completedLog: InputRecordingV2 | undefined;
/** 本關 level-complete 次數（每次嘗試只能上報一次成績） */
let completeCount = 0;
beforeAll(() => {
  initRecordingSession(() => levelState.current, () => true);
  bus.on('level-complete', ({ inputLog }) => {
    completeCount++;
    if (inputLog) completedLog = inputLog;
  });
});

const drain = (): Promise<void> => new Promise((r) => setImmediate(r));

/** 一個渲染畫面：照 main.ts render loop 跑 n 個 tick；inTick(i) = 該 tick 的搖桿按鍵輪詢 */
async function renderFrame(
  frames: ControlFrame[],
  inTick?: (i: number) => void,
): Promise<void> {
  const mark = beginFrame();
  frames.forEach((f, i) => {
    advanceSimTick();
    setInFixedTick(true);
    try {
      inTick?.(i);
      tickRecordedLevel(simNowMs(), f);
    } finally {
      setInFixedTick(false);
    }
  });
  endFrame(mark);
  await drain(); // 畫面之間瀏覽器排空微任務
}

async function fly(frame: ControlFrame, ticks: number, perFrame = 1): Promise<void> {
  for (let i = 0; i < ticks; i += perFrame) {
    await renderFrame(new Array(Math.min(perFrame, ticks - i)).fill(frame));
  }
}

async function untilProgramDone(perFrame: number[] = [1]): Promise<void> {
  for (let f = 0; f < 3000 && programState.running; f++) {
    await renderFrame(new Array(perFrame[f % perFrame.length]).fill(idle));
  }
  expect(programState.running).toBe(false);
}

function load(id: string): void {
  levelState.levels = levels;
  simTime.tick = 12_345; // 錄製起點不在 0（startTick 必須被正確還原）
  completedLog = undefined;
  completeCount = 0;
  applyLoadLevel(id);
}

/** 按「開始」→ 倒數結束（計時 / 錄製開始） */
function startTiming(): void {
  levelState.armed = true;
  levelState.startTime = Date.now();
  bus.emit('level-timing-started', { levelId: levelState.current!.id });
}

async function expectReplayMatches(rec: InputRecordingV2 | undefined, mustComplete = false) {
  expect(rec).toBeDefined();
  expect(rec!.unverifiable).toBeUndefined();
  if (mustComplete) {
    // 過關後再多跑幾個畫面：不得重複上報
    await fly(idle, 10);
    expect(completeCount).toBe(1);
  }
  const r = await replayRecording(structuredClone(rec!));
  expect(r.replayHash).toBe(rec!.replayHash);
  if (mustComplete) expect(r.completed).toBe(true);
  return r;
}

beforeEach(async () => {
  if (programState.running) {
    stopProgram();
    await untilProgramDone();
  }
  setMode('manual');
  flags.countdownActive = false;
  flags.paused = false;
});

describe('錄製 ↔ 重播一致', () => {
  it('純推桿飛行', async () => {
    load('1-2');
    startTiming();
    await fly(up, 60);
    await fly(fwd, 60, 3);
    await fly(turn, 30, 2);
    await expectReplayMatches(finalizeRecording());
  });

  it('搖桿 A 起飛 / B 降落（tick 內觸發）', async () => {
    load('1-2');
    startTiming();
    await fly(idle, 10);
    await renderFrame([idle], () => padTakeoff());
    await fly(fwd, 60, 2);
    await renderFrame([idle, idle], (i) => i === 1 && autoLand());
    await fly(idle, 120);
    await expectReplayMatches(finalizeRecording());
  });

  it('飛行中按重置（tick 之間）', async () => {
    load('1-2');
    startTiming();
    await fly(up, 60);
    resetMission();
    await fly(up, 30);
    await expectReplayMatches(finalizeRecording());
  });

  it('Space 急停後推桿恢復', async () => {
    load('1-2');
    startTiming();
    await fly(up, 60);
    emergencyStop();
    await fly(idle, 20);
    await fly(fwd, 30);
    await expectReplayMatches(finalizeRecording());
  });

  it('一鍵回家', async () => {
    load('1-2');
    startTiming();
    await fly(up, 60);
    await fly(fwd, 60);
    goHome();
    await fly(idle, 200, 3);
    await expectReplayMatches(finalizeRecording());
  });

  it('手動飛到過關：錄製含過關那一 tick、重播確實過關', async () => {
    load('1-0');
    startTiming();
    for (let i = 0; i < 200 && !completedLog; i++) await renderFrame([up]);
    for (let i = 0; i < 400 && !completedLog; i++) await renderFrame([down]);
    expect(isRecording()).toBe(false);
    await expectReplayMatches(completedLog, true);
  });

  it('程式模式：每畫面 tick 數不一（1 / 2 / 3）仍一致並過關', async () => {
    load('1-4');
    startTiming();
    setMode('program');
    runProgram(
      'await CREAFLY.takeoff(3);\nawait CREAFLY.forward(5);\nawait CREAFLY.forward(5);\n' +
        'await CREAFLY.forward(5);\nawait CREAFLY.backward(15);\nawait CREAFLY.land();',
    );
    await untilProgramDone([2, 1, 3, 2]);
    await expectReplayMatches(completedLog, true);
  });

  it('沒按開始直接跑程式：照樣錄製並一致', async () => {
    load('1-0');
    setMode('program');
    runProgram('await CREAFLY.takeoff(2);\nawait CREAFLY.land();');
    expect(isRecording()).toBe(true);
    await untilProgramDone([2]);
    await expectReplayMatches(completedLog, true);
  });

  it('先手動飛、再切程式模式執行', async () => {
    load('1-4');
    startTiming();
    await fly(up, 40);
    await fly(fwd, 40, 2);
    setMode('program');
    runProgram('await CREAFLY.takeoff(3);\nawait CREAFLY.forward(15);\nawait CREAFLY.land();');
    await untilProgramDone([1, 2]);
    await expectReplayMatches(completedLog, true);
  });

  it('程式跑到一半停止、再執行一次', async () => {
    load('1-4');
    startTiming();
    setMode('program');
    runProgram('await CREAFLY.takeoff(3);\nawait CREAFLY.forward(15);');
    await fly(idle, 100, 2);
    stopProgram();
    await untilProgramDone();
    runProgram('await CREAFLY.takeoff(3);\nawait CREAFLY.forward(15);\nawait CREAFLY.land();');
    await untilProgramDone([3]);
    await expectReplayMatches(completedLog, true);
  });

  it('tick 內開始計時（freeplay 關搖桿按開始）', async () => {
    load('1-6');
    await renderFrame([idle, up], (i) => i === 0 && armLevelStart());
    expect(isRecording()).toBe(true);
    await fly(up, 60);
    await fly(fwd, 60);
    await expectReplayMatches(finalizeRecording());
  });

  it('竄改任一 frame → hash 不一致（重播確實會抓到）', async () => {
    load('1-2');
    startTiming();
    await fly(up, 60);
    await fly(fwd, 60);
    const rec = finalizeRecording()!;
    rec.frames[70]![1] = 2;
    const r = await replayRecording(rec);
    expect(r.replayHash).not.toBe(rec.replayHash);
  });
});

describe('伺服器判定（verifyRecording）', () => {
  const level10 = levels.find((l) => l.id === '1-0')!;

  /** 誠實學生：手動飛完 1-0 */
  async function honest(): Promise<{ rec: InputRecordingV2; timeMs: number }> {
    load('1-0');
    startTiming();
    for (let i = 0; i < 200 && !completedLog; i++) await renderFrame([up]);
    for (let i = 0; i < 400 && !completedLog; i++) await renderFrame([down]);
    // 測試跑得比牆鐘快：用模擬時間當宣告用時（真實瀏覽器裡牆鐘 ≥ 模擬時間）
    return { rec: completedLog!, timeMs: completedLog!.ticks * (1000 / 60) + levelElapsedMs() };
  }

  it('誠實過關 → ok', async () => {
    const { rec, timeMs } = await honest();
    const r = await verifyRecording({
      recording: structuredClone(rec),
      claimedHash: rec.replayHash,
      levelId: '1-0',
      timeMs,
      serverLevel: level10,
    });
    expect(r.status).toBe('ok');
  });

  it('空錄製（0 tick）→ 重播沒過關 → 可疑', async () => {
    const { rec } = await honest();
    const empty = { ...structuredClone(rec), ticks: 0, frames: [], actions: [], multiTickFrames: [] };
    const h = hashToHex(FNV_OFFSET);
    const r = await verifyRecording({ recording: empty, claimedHash: h, levelId: '1-0', timeMs: 5000 });
    expect(r.status).toBe('mismatch');
    expect(r.reason).toMatch(/未能過關/);
  });

  it('錄製關卡 ≠ 過關關卡 → 可疑', async () => {
    const { rec } = await honest();
    const r = await verifyRecording({ recording: rec, claimedHash: rec.replayHash, levelId: '1-6' });
    expect(r.status).toBe('mismatch');
    expect(r.reason).toMatch(/不符/);
  });

  it('偽造關卡內容 → 以伺服器定義重播，內容不符 → 可疑；老師剛改過 → 無法驗證', async () => {
    const { rec } = await honest();
    const forged = { ...structuredClone(rec), level: { ...level10, passZones: [] } };
    const input = { recording: forged, claimedHash: rec.replayHash, levelId: '1-0', serverLevel: level10 };
    expect((await verifyRecording(structuredClone(input))).status).toBe('mismatch');
    expect((await verifyRecording({ ...structuredClone(input), levelRecentlyEdited: true })).status).toBe(
      'unverifiable',
    );
  });

  it('宣告用時短於模擬時間 → 可疑', async () => {
    const { rec } = await honest();
    const r = await verifyRecording({
      recording: rec,
      claimedHash: rec.replayHash,
      levelId: '1-0',
      timeMs: 1000,
      serverLevel: level10,
    });
    expect(r.status).toBe('mismatch');
    expect(r.reason).toMatch(/用時/);
  });

  it('竄改輸入但保留原 hash → 可疑', async () => {
    const { rec, timeMs } = await honest();
    const tampered = structuredClone(rec);
    tampered.frames[5]![0] = 0.5;
    const r = await verifyRecording({
      recording: tampered,
      claimedHash: rec.replayHash,
      levelId: '1-0',
      timeMs,
      serverLevel: level10,
    });
    expect(r.status).toBe('mismatch');
    expect(r.reason).toMatch(/hash/);
  });

  it('舊版 v1 錄製 → 無法驗證（不標可疑）', async () => {
    const r = await verifyRecording({ recording: { v: 1, levelId: '1-0' }, claimedHash: 'x' });
    expect(r.status).toBe('unverifiable');
  });
});
