// 模擬單 tick — 主迴圈（main.ts）、伺服器重播（replayRunner）與測試共用同一份邏輯，
// 線上與重播不會各自演化而分歧。
import { droneState, isManualLocked, TICK_MS } from './droneState';
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
import { beginRecordedTick, endRecordedTick } from './recordingSession';

/** 飛行物理（程式 motion plan / 自動駕駛 / 手動推力 + 積分）+ 靜態障礙碰撞 — 所有模式共用 */
export function tickFlightPhysics(controlFrame: ControlFrame, thrustScale = 1): void {
  if (programState.running) {
    // 程式模式：位置由 motion plan 推進，只做地板保護
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
  // 實心方塊 AABB 碰撞（兩種模式都要；大亂鬥掩體也走這裡）
  resolveObstacleCollisions();
}

export interface LevelSimTickOpts {
  nowMs: number;
  controlFrame: ControlFrame;
}

/** 一般關卡路徑的固定 tick（不含大亂鬥 / 足球 / 練習） */
export function tickLevelSimulation(opts: LevelSimTickOpts): void {
  tickFlightPhysics(opts.controlFrame);
  // 關卡判定（圈 / zone / 氣球 / faceYaw / duration）
  tickLevel(opts.nowMs);
  // 畫畫教室：墨水取樣（程式 tween 與手動飛行共用同一條路徑）
  tickPen(opts.nowMs);
}

/** 主迴圈一般關卡 tick：模擬 + 輸入錄製（重播端只跑 tickLevelSimulation、自行累積 hash） */
export function tickRecordedLevel(nowMs: number, controlFrame: ControlFrame): void {
  beginRecordedTick(controlFrame);
  tickLevelSimulation({ nowMs, controlFrame });
  endRecordedTick();
}
