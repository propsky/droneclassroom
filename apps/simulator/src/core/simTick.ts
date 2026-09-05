// 一般關卡模擬單 tick — 從 main.ts 抽離，供主迴圈與 replayRunner 共用。
import { droneState, isManualLocked } from './droneState';
import {
  applyManualControls,
  integrate,
  floorProtect,
  resolveObstacleCollisions,
  tickAutopilot,
  type ControlFrame,
} from './physics';
import { tickLevel } from './level';
import { tickPen } from './pen';
import { programState, tickProgram } from './program';
import { TICK_MS } from './droneState';

export interface LevelSimTickOpts {
  nowMs: number;
  controlFrame: ControlFrame;
  /** 大亂鬥鬼速倍率；一般關卡傳 1 */
  thrustScale?: number;
}

/** 一般關卡路徑的固定 tick（不含大亂鬥 / 足球 / 練習） */
export function tickLevelSimulation(opts: LevelSimTickOpts): void {
  const { nowMs, controlFrame, thrustScale = 1 } = opts;

  if (programState.running) {
    tickProgram(TICK_MS);
    floorProtect();
  } else {
    if (droneState.returning) {
      tickAutopilot(TICK_MS);
    } else if (!isManualLocked()) {
      applyManualControls(controlFrame, thrustScale);
    }
    integrate();
  }

  resolveObstacleCollisions();
  tickLevel(nowMs);
  tickPen(nowMs);
}
