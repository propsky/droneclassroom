// 伺服器重播驗證（J-02）：依 InputRecordingV1 重跑 core 物理，產出 replayHash。
import type { InputRecordingV1 } from '@creafly/shared';
import {
  TICK_MS,
  advanceSimTick,
  flags,
  resetDroneState,
  simNowMs,
  simTime,
} from './droneState';
import { seedRng } from './rng';
import { bootstrapLevelForReplay, levelState } from './level';
import { runProgram, programState } from './program';
import { bus } from './events';
import { FNV_OFFSET, hashDroneTick, hashToHex } from './simHash';
import { frameFromSnapshot } from './inputRecorder';
import { tickLevelSimulation } from './simTick';

const YIELDS_PER_TICK = 8;

export interface ReplayResult {
  replayHash: string;
  ticks: number;
  ringsCollected: number;
}

/** 重播錄製：與 client 錄製期相同的 tick 序列與 hash 累積。 */
export async function replayRecording(rec: InputRecordingV1): Promise<ReplayResult> {
  simTime.tick = 0;
  seedRng(rec.rngSeed);
  resetDroneState();
  bootstrapLevelForReplay(rec.level);
  flags.mode = rec.programCode ? 'program' : 'manual';
  programState.running = false;

  let h = FNV_OFFSET;
  let programFinished = !rec.programCode;
  let off: (() => void) | null = null;

  if (rec.programCode) {
    off = bus.on('program-running', ({ running }) => {
      if (!running) programFinished = true;
    });
    runProgram(rec.programCode);
  }

  const maxTicks = rec.ticks;
  for (let t = 0; t < maxTicks; t++) {
    advanceSimTick();
    const frame = rec.programCode
      ? { lift: 0, forward: 0, right: 0, yawDelta: 0, wantsTakeoff: false, anyInput: false }
      : frameFromSnapshot(rec.frames[t]!);
    tickLevelSimulation({ nowMs: simNowMs(), controlFrame: frame });
    h = hashDroneTick(h);

    if (rec.programCode && !programFinished) {
      for (let y = 0; y < YIELDS_PER_TICK; y++) await Promise.resolve();
    }
  }

  off?.();

  return {
    replayHash: hashToHex(h),
    ticks: maxTicks,
    ringsCollected: levelState.ringsCollected,
  };
}
