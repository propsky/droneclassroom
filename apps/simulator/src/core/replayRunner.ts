// 伺服器重播驗證（J-02）：依 InputRecordingV2 重跑 core 物理，產出 replayHash 與是否過關。
// 時序與瀏覽器主迴圈逐點對齊（見 main.ts render loop）：
//   - 畫面之間（含 tick 之間的鍵盤 / 點擊 / WS 操作之後）瀏覽器會排空微任務 → 這裡同點排空
//   - 同一畫面內連跑的 tick 之間不排空（multiTickFrames）
//   - tick 內操作（搖桿按鍵）在 advanceSimTick 之後、物理之前套用
import type { InputRecordingV2, RecordedAction } from '@creafly/shared';
import { advanceSimTick, droneState, flags, simNowMs, simTime } from './droneState';
import { seedRng } from './rng';
import { bootstrapLevelForReplay, levelState, resetMission } from './level';
import { autoLand, emergencyStop, goHome, padTakeoff } from './physics';
import { programState, runProgram, setMode, stopProgram } from './program';
import { bus } from './events';
import { FNV_OFFSET, hashDroneTick, hashToHex } from './simHash';
import { decodeFrame, setInFixedTick } from './inputRecorder';
import { tickLevelSimulation } from './simTick';

export interface ReplayResult {
  replayHash: string;
  ticks: number;
  /** 重播過程中觸發過 level-complete（= 依此輸入確實能過關） */
  completed: boolean;
  ringsCollected: number;
}

/** 排空微任務佇列（= 瀏覽器一個 task 結束時的 microtask checkpoint） */
function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

function applyAction(a: RecordedAction): void {
  switch (a.a) {
    case 'takeoff':
      padTakeoff();
      break;
    case 'land':
      autoLand();
      break;
    case 'home':
      goHome();
      break;
    case 'estop':
      emergencyStop();
      break;
    case 'reset':
      resetMission();
      break;
    case 'stop':
      stopProgram();
      break;
    case 'mode':
      if (a.mode) setMode(a.mode);
      break;
    case 'run':
      if (a.code !== undefined) runProgram(a.code);
      break;
  }
}

/** 重播錄製：與 client 錄製期相同的 tick / 操作 / 微任務排空序列與 hash 累積。 */
export async function replayRecording(rec: InputRecordingV2): Promise<ReplayResult> {
  seedRng(rec.rngSeed);
  bootstrapLevelForReplay(rec.level);
  const init = rec.initial;
  Object.assign(droneState.position, init.position);
  Object.assign(droneState.velocity, init.velocity);
  droneState.yaw = init.yaw;
  droneState.isFlying = init.isFlying;
  droneState.isGrounded = init.isGrounded;
  droneState.frozen = init.frozen;
  flags.mode = rec.mode;
  programState.running = false;
  flags.programRunning = false;
  simTime.tick = rec.startTick;

  // 只有程式模式有 async 指令鏈；純手動錄製不必排空（快很多）
  const usesProgram = rec.actions.some((a) => a.a === 'run');
  const drain = usesProgram ? drainMicrotasks : (): Promise<void> => Promise.resolve();
  const notFirstInFrame = new Set<number>();
  for (const [start, n] of rec.multiTickFrames) {
    for (let i = start + 1; i < start + n; i++) notFirstInFrame.add(i);
  }

  let completed = false;
  const off = bus.on('level-complete', () => {
    completed = true;
  });

  let h = FNV_OFFSET;
  let ai = 0;
  try {
    for (let t = 0; t <= rec.ticks; t++) {
      if (!notFirstInFrame.has(t)) await drain();
      // tick 之間的操作：各自是一個瀏覽器 task，結束後排空
      while (ai < rec.actions.length && rec.actions[ai]!.t === t && !rec.actions[ai]!.inTick) {
        applyAction(rec.actions[ai++]!);
        await drain();
      }
      if (t === rec.ticks) break;

      advanceSimTick();
      setInFixedTick(true);
      try {
        while (ai < rec.actions.length && rec.actions[ai]!.t === t && rec.actions[ai]!.inTick) {
          applyAction(rec.actions[ai++]!);
        }
        tickLevelSimulation({ nowMs: simNowMs(), controlFrame: decodeFrame(rec.frames[t]!) });
      } finally {
        setInFixedTick(false);
      }
      h = hashDroneTick(h);
    }
    // 程式模式的過關判定在指令鏈結束的微任務裡
    await drain();
  } finally {
    off();
  }

  return {
    replayHash: hashToHex(h),
    ticks: rec.ticks,
    completed,
    ringsCollected: levelState.ringsCollected,
  };
}
