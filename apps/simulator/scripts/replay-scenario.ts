// G-04 確定性回放場景 — 純 core 驅動，零 DOM / 零 Node API，
// 可被瀏覽器、Node、jsc 以完全相同的方式執行。
// 場景涵蓋所有確定性關鍵路徑：
//   1. 手動物理（推力 / 阻力 / yaw 旋轉 → detSin/detCos）
//   2. 障礙 AABB 碰撞
//   3. 關卡判定（圈圈距離 detHypot、ring 浮動 detSin、faceYaw）
//   4. 程式模式（motion plan、async 指令鏈、cf_random 可播種 PRNG、
//      cf_elapsed 模擬時間條件、畫筆隨機色）
// 逐 tick 對無人機狀態 hash（FNV-1a 64，吃 Float64 位元），輸出最終 hash。
import type { LevelDef } from '@creafly/shared';
import {
  TICK_MS,
  advanceSimTick,
  droneState,
  flags,
  resetDroneState,
  simNowMs,
  simTime,
} from '../src/core/droneState';
import {
  applyManualControls,
  integrate,
  floorProtect,
  resolveObstacleCollisions,
  type ControlFrame,
} from '../src/core/physics';
import { levelState, bootstrapLevelForReplay, tickLevel } from '../src/core/level';
import { tickPen } from '../src/core/pen';
import { runProgram, tickProgram } from '../src/core/program';
import { seedRng } from '../src/core/rng';
import { bus } from '../src/core/events';

import { FNV_OFFSET, hashDroneTick, hashToHex } from '../src/core/simHash';

// ---- 場景關卡（inline，不經 fetch）----
// 圈與障礙都放在腳本化飛行的實測路徑上（見 scriptedFrame）：
// 圈 1/2 在起飛後直線段、圈 3 在轉彎後段且要求 faceYaw 對準；
// 障礙立在直線段中央 → AABB 推出路徑（碰撞分支確實被 hash 覆蓋）。
const SCENARIO_LEVEL: LevelDef = {
  id: 'R-1',
  name: '確定性回放場景',
  intro: '',
  rings: [
    { x: 0, y: 22.9, z: -10.43 },
    { x: 0, y: 22.9, z: -25.43 },
    { x: -24.39, y: 22.9, z: -8.6, faceYaw: 137, faceTol: 40 },
  ],
  obstacles: [{ type: 'cube', solid: true, x: 0.4, y: 22.9, z: -30, size: 2 }],
};

/** 依 tick 索引產生腳本化手動輸入（確定性；模擬起飛 → 前進 → 轉彎 → 蛇行） */
function scriptedFrame(t: number): ControlFrame {
  const f: ControlFrame = {
    lift: 0,
    forward: 0,
    right: 0,
    yawDelta: 0,
    wantsTakeoff: false,
    anyInput: true,
  };
  if (t < 120) {
    f.lift = 1;
    f.wantsTakeoff = true;
  } else if (t < 400) {
    f.forward = 1;
  } else if (t < 520) {
    f.forward = 0.6;
    f.yawDelta = 0.02;
  } else if (t < 800) {
    f.forward = 1;
    f.right = t % 120 < 60 ? 0.5 : -0.5; // 蛇行（碰障礙 AABB）
  } else if (t < 900) {
    f.yawDelta = -0.03;
  } else {
    f.forward = 0.8;
    f.lift = t % 90 < 45 ? 0.4 : -0.4;
  }
  return f;
}

export interface ScenarioResult {
  manualHash: string;
  programHash: string;
  ticks: number;
  ringsCollected: number;
  programFinished: boolean;
  finalState: { x: number; y: number; z: number; yaw: number };
}

const MANUAL_TICKS = 1200; // 20 秒模擬
const PROGRAM_MAX_TICKS = 6000; // 程式段上限 100 秒模擬
const YIELDS_PER_TICK = 8; // 每 tick 固定讓出微任務次數（兩引擎相同策略 → 確定）

export async function runScenario(): Promise<ScenarioResult> {
  // ---- 全域狀態歸零（確定性初始條件）----
  simTime.tick = 0;
  seedRng(42);
  levelState.levels = [SCENARIO_LEVEL];
  bootstrapLevelForReplay(SCENARIO_LEVEL);
  flags.countdownActive = false;
  flags.paused = false;
  flags.mode = 'manual';
  resetDroneState();

  // ---- 手動段 ----
  let h = FNV_OFFSET;
  for (let t = 0; t < MANUAL_TICKS; t++) {
    advanceSimTick();
    applyManualControls(scriptedFrame(t));
    integrate();
    resolveObstacleCollisions();
    tickLevel(simNowMs());
    tickPen(simNowMs());
    h = hashDroneTick(h);
  }
  const manualHash = hashToHex(h);
  const ringsCollected = levelState.ringsCollected;

  // ---- 程式段（motion plan / async 鏈 / cf_random / cf_elapsed / 畫筆隨機色）----
  const code = [
    'await CREAFLY.takeoff(3);',
    'await CREAFLY.forward(CREAFLY.random(2, 5));',
    'await CREAFLY.rotateCounterClockwise(90);',
    'CREAFLY.penRandom();',
    'await CREAFLY.forward(2);',
    'CREAFLY.penRandom();',
    'await CREAFLY.rotateClockwise(CREAFLY.random(30, 60));',
    'if (CREAFLY.elapsed() > 0.5) { await CREAFLY.forward(1.5); }',
    'await CREAFLY.hover(0.3);',
    'await CREAFLY.up(CREAFLY.random(1, 2));',
    'await CREAFLY.land();',
  ].join('\n');

  let finished = false;
  const off = bus.on('program-running', ({ running }) => {
    if (!running) finished = true;
  });
  runProgram(code);

  h = FNV_OFFSET;
  let pt = 0;
  while (!finished && pt < PROGRAM_MAX_TICKS) {
    advanceSimTick();
    tickProgram(TICK_MS);
    floorProtect();
    resolveObstacleCollisions();
    tickLevel(simNowMs());
    tickPen(simNowMs());
    h = hashDroneTick(h);
    pt++;
    for (let y = 0; y < YIELDS_PER_TICK; y++) await Promise.resolve();
  }
  off();

  return {
    manualHash,
    programHash: hashToHex(h),
    ticks: MANUAL_TICKS + pt,
    ringsCollected,
    programFinished: finished,
    finalState: {
      x: droneState.position.x,
      y: droneState.position.y,
      z: droneState.position.z,
      yaw: droneState.yaw,
    },
  };
}
