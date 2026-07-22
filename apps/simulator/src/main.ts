// 組裝入口：固定時步 60Hz 模擬（accumulator pattern）+ 渲染插值。
// 渲染幀率無關；單幀最多補 5 tick 防 spiral of death。
import './ui/style.css';
import { Vector3 } from '@babylonjs/core';
import { TICK_MS, droneState, isManualLocked } from './core/droneState';
import {
  applyManualControls,
  integrate,
  floorProtect,
  resolveObstacleCollisions,
  tickAutopilot,
} from './core/physics';
import { loadChapters, loadLevel, tickLevel, resetMission, levelState } from './core/level';
import {
  CREAFLY_API,
  runProgram,
  stopProgram,
  tickProgram,
  programState,
  setMode,
} from './core/program';
import { tickPen } from './core/pen';
import { bus, toast } from './core/events';
import { initInputs, tickInputDevices, collectControlFrame, isTouchDevice } from './input';
import { createSceneWorld } from './render/scene';
import { DroneVisual } from './render/drone';
import { LevelVisuals } from './render/levelMeshes';
import { InkVisual } from './render/ink';
import { GuideVisual } from './render/guide';
import { CameraRig } from './render/cameras';
import { initHud, updateHudFrame } from './ui/hud';
import { initOverlays, initPlayer, syncViewButton } from './ui/overlays';
import { initCalibrationOverlay } from './ui/calibrationOverlay';
import {
  calibration,
  gamepadConfig,
  startCalibration,
  endCalibration,
  skipCalibStep,
} from './input/calibration';
import { initAudio } from './ui/audio';
import { initEndCountdown } from './ui/endCountdown';
import { initWs, connectToTeacher } from './net/ws';
import { initBlockly } from './blockly';
import {
  initArena,
  arenaState,
  tickArena,
  arenaThrustScale,
  enterArena,
  exitArena,
} from './multiplayer/arena';
import { ArenaCloneVisuals } from './render/clones';
import { PlaygroundScene } from './render/playground';
import {
  initSoccerPractice,
  practiceState,
  tickSoccerPractice,
  enterSoccerPractice,
  exitSoccerPractice,
  startDrill,
} from './soccer/practice';
import {
  initSoccerMatch,
  soccerState,
  tickSoccerMatch,
  enterSoccerMatch,
  exitSoccerMatch,
} from './multiplayer/soccer';
import { SoccerFieldVisuals } from './render/soccerField';
import { initSoccerHud } from './ui/soccerHud';

// ---- 場景與渲染 ----
const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
const world = createSceneWorld(canvas);
const droneVisual = new DroneVisual(world.scene, world.shadowGenerator);
const levelVisuals = new LevelVisuals(world.scene);
// 畫畫教室：墨水線與參考線（訂閱 event bus，載入 draw 關卡時自動生效）
new InkVisual(world.scene);
new GuideVisual(world.scene);
// 大亂鬥：他人分身 / 名牌 / 氣球 / 光環（訂閱 arena-entered / arena-exited 自動建與清）
const arenaClones = new ArenaCloneVisuals(world.scene, droneVisual);
// 大亂鬥 playground 場地：glb 場景 + Havok 網格碰撞（訂閱 arena-field-changed 自動載卸）
new PlaygroundScene(world.scene);
// ⚽ 足球：場地 / 球門（Havok 門框碰撞）/ 球形保護框 / 隊色分身＋前鋒彩帶
// （訂閱 soccer-entered / soccer-exited 自動建與清）
const soccerVisuals = new SoccerFieldVisuals(world.scene, droneVisual);
const cameraRig = new CameraRig(world.scene);
cameraRig.snapBehindDrone();

// ---- UI / 輸入 / 音效 / 網路 ----
initHud();
initOverlays();
initAudio();
initWs();
initArena(); // 大亂鬥：訊息分派 + 右下進場按鈕（在 initWs 之後掛 bus）
initSoccerPractice(); // ⚽ 足球單人練習（?soccer=1 後門）
initSoccerMatch(); // ⚽ 多人足球對戰（?soccermp=1 後門）
initSoccerHud(
  () => (practiceState.active ? exitSoccerPractice() : enterSoccerPractice()),
  () => (soccerState.active ? exitSoccerMatch() : enterSoccerMatch()),
);
initEndCountdown(); // 賽局結束倒數 chip（§5.3；arena / soccer 共用 endTime）
initPlayer(connectToTeacher);

const doToggleView = (): void => syncViewButton(cameraRig.toggleView());
document.getElementById('view-btn')?.addEventListener('click', doToggleView);
initInputs({ toggleView: doToggleView });
initCalibrationOverlay(); // 搖桿校正精靈 overlay（在 initInputs 之後：狀態機已就緒）

// ---- Blockly 積木編輯器（生成碼經 window.__creaflyGetCode → runProgram 注入 CREAFLY 執行）----
initBlockly();

// window.CREAFLY：Blockly 生成碼的注入來源 + debug 入口
declare global {
  interface Window {
    CREAFLY: typeof CREAFLY_API & {
      runProgram: typeof runProgram;
      stopProgram: typeof stopProgram;
      loadLevel: typeof loadLevel;
      resetMission: typeof resetMission;
      setMode: typeof setMode;
      droneState: typeof droneState;
      levelState: typeof levelState;
      arenaState: typeof arenaState;
      enterArena: typeof enterArena;
      exitArena: typeof exitArena;
      soccerState: typeof soccerState;
      practiceState: typeof practiceState;
      enterSoccerMatch: typeof enterSoccerMatch;
      exitSoccerMatch: typeof exitSoccerMatch;
      enterSoccerPractice: typeof enterSoccerPractice;
      exitSoccerPractice: typeof exitSoccerPractice;
      startDrill: typeof startDrill;
      calibration: typeof calibration;
      gamepadConfig: typeof gamepadConfig;
      startCalibration: typeof startCalibration;
      endCalibration: typeof endCalibration;
      skipCalibStep: typeof skipCalibStep;
    };
  }
}
window.CREAFLY = {
  ...CREAFLY_API,
  runProgram,
  stopProgram,
  loadLevel,
  resetMission,
  setMode,
  droneState,
  levelState,
  // 大亂鬥 debug 入口（對齊 legacy 的 arena / enterArena / exitArena 匯出）
  arenaState,
  enterArena,
  exitArena,
  // ⚽ 足球 debug / headless 驗收入口
  soccerState,
  practiceState,
  enterSoccerMatch,
  exitSoccerMatch,
  enterSoccerPractice,
  exitSoccerPractice,
  startDrill,
  // 校正精靈 debug / headless 驗收入口
  calibration,
  gamepadConfig,
  startCalibration,
  endCalibration,
  skipCalibStep,
};

// ---- 關卡資料 ----
void loadChapters();

// 觸控裝置首次提示
if (isTouchDevice && !sessionStorage.getItem('creafly_hint_shown')) {
  sessionStorage.setItem('creafly_hint_shown', '1');
  setTimeout(() => toast('👆 用畫面下方的兩根搖桿控制無人機'), 800);
}

// 回家按鈕（程式執行中不可用）
bus.on('program-running', ({ running }) => {
  const btn = document.getElementById('home-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = running;
});

// =============================================================================
// 固定時步主迴圈
// =============================================================================
const MAX_TICKS_PER_FRAME = 5;
let accumulator = 0;
let lastTime = performance.now();
const prevSnap = { x: 0, y: 0.4, z: 0, yaw: 0 };
const currSnap = { x: 0, y: 0.4, z: 0, yaw: 0 };
const interpPos = new Vector3();

function snapshot(dst: typeof prevSnap): void {
  dst.x = droneState.position.x;
  dst.y = droneState.position.y;
  dst.z = droneState.position.z;
  dst.yaw = droneState.yaw;
}

function fixedTick(nowMs: number): void {
  // 輸入裝置輪詢（gamepad + 搖桿按鈕）
  tickInputDevices(isManualLocked());

  if (programState.running) {
    // 程式模式：位置由 motion plan 推進，只做地板保護
    tickProgram(TICK_MS);
    floorProtect();
  } else {
    if (droneState.returning) {
      tickAutopilot(TICK_MS);
    } else if (!isManualLocked()) {
      // 大亂鬥鬼抓人：我是鬼 → 推力 ×GHOST_SPEED（非大亂鬥時恆為 1）
      applyManualControls(collectControlFrame(), arenaThrustScale());
    }
    integrate();
  }

  // 實心方塊 AABB 碰撞（兩種模式都要；大亂鬥掩體也走這裡）
  resolveObstacleCollisions();

  // 模式分派：大亂鬥 / 足球 tick 接管 ↔ 一般關卡判定（不重演 legacy 的 if/else 上帝迴圈 —
  // 各模式自己管邊界/判定/HUD，分身視覺在 arenaClones / soccerVisuals；一般關卡照舊）
  if (arenaState.active) {
    tickArena();
    arenaClones.tick();
  } else if (soccerState.active) {
    // ⚽ 多人足球：邊界 / 分身內插 / 機對機碰撞 / 進球偵測 / 計分 HUD
    tickSoccerMatch();
    soccerVisuals.tick();
  } else if (practiceState.active) {
    // ⚽ 單人練習：邊界 / 穿門判定 / drill 進度
    tickSoccerPractice();
    soccerVisuals.tick();
  } else {
    // 關卡判定（圈 / zone / 氣球 / faceYaw / duration）
    tickLevel(nowMs);
    // 畫畫教室：墨水取樣（程式 tween 與手動飛行共用同一條路徑）
    tickPen(nowMs);
  }

  // 視覺 tick（螺旋槳、傾斜、圈動畫、雲、假陰影、軌跡）
  droneVisual.tick();
  levelVisuals.tick(nowMs);
  world.tick(nowMs);
}

world.engine.runRenderLoop(() => {
  const now = performance.now();
  accumulator += now - lastTime;
  lastTime = now;

  let ticks = 0;
  while (accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
    snapshot(prevSnap);
    fixedTick(Date.now());
    snapshot(currSnap);
    accumulator -= TICK_MS;
    ticks++;
  }
  if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0; // spiral of death 保護

  // 渲染插值：prev/current lerp by alpha
  const alpha = Math.min(accumulator / TICK_MS, 1);
  interpPos.set(
    prevSnap.x + (currSnap.x - prevSnap.x) * alpha,
    prevSnap.y + (currSnap.y - prevSnap.y) * alpha,
    prevSnap.z + (currSnap.z - prevSnap.z) * alpha,
  );
  const interpYaw = prevSnap.yaw + (currSnap.yaw - prevSnap.yaw) * alpha;

  const bodyVisible = cameraRig.update(interpPos, interpYaw);
  droneVisual.setVisible(bodyVisible);
  droneVisual.render(interpPos, interpYaw);

  updateHudFrame();
  world.scene.render();
});

// ---- 視窗大小適配 ----
window.addEventListener('resize', () => world.engine.resize());
new ResizeObserver(() => world.engine.resize()).observe(canvas);

console.log('%c[CREAFLY] Babylon.js 模擬器啟動', 'color:#00A3E0;font-weight:bold');
