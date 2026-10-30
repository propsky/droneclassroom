// 關卡系統 — 載入 chapter JSON、rings/passZones/balloons 判定、returnHome、計時。
// 行為對齊 legacy main.js §4 / §12（checkRingCollisions / checkPassZones / checkBalloons）。
import type { LevelDef, BalloonDef } from '@creafly/shared';
import {
  FlightArea,
  isChapterDef,
  signedYawDiffDeg,
  PREVIEW_LEVEL_ID,
  detSin,
  detHypot3,
  ringPassRadius,
  balloonPopRadius,
  ringBobAmp,
  ringSpin,
  ringYawDeg,
  obstacleIsCollidable,
  FaceYawJudge,
  LandingJudge,
  OrderJudge,
  PassZoneJudge,
  RingJudge,
  RingPassJudge,
  TaskJudge,
  YawAccumulator,
  type Pose,
  type TaskTally,
} from '@creafly/shared';
import { readPreviewLevel } from '../preview';
import { droneState, resetDroneState, HOME_POSITION, flags, simTime } from './droneState';
import { setFlightBounds, setSolidObstacles } from './physics';
import { bus, toast, sound, stateHud } from './events';
import { finalizeRecording, recordAction } from './recordingSession';
import { releasePauseForSwitch } from './pause';
import { GameSession } from './session';

export interface MissionRing {
  x: number;
  y: number;
  z: number;
  color?: number | string;
  label?: string;
  diameter?: number;
  thickness?: number;
  spin?: number;
  bobAmp?: number;
  faceYaw?: number;
  faceTol?: number;
  passed: boolean;
}

export interface FaceGuidance {
  ringIndex: number;
  aligned: boolean;
  yawDeg: number;
  targetDeg: number;
  /** >0 需往左轉、<0 需往右轉 */
  signed: number;
}

export const levelState = {
  levels: [] as LevelDef[],
  /** 章節導覽用：各章 meta + 所屬關卡（levels 為三章攤平，維持既有相容） */
  chapters: [] as {
    chapter: number;
    name: string;
    /** 班級 curriculum 分組標籤（有則優先顯示） */
    groupLabel?: string;
    levels: LevelDef[];
  }[],
  current: null as LevelDef | null,
  /** 0 = 尚未開始計時（按開始 + 3-2-1 倒數後才設定） */
  startTime: 0,
  /** 暫停起始時間戳（0 = 未暫停）；恢復時把暫停時長補回 startTime，計時凍結 */
  pausedAt: 0,
  armed: false,
  rings: [] as MissionRing[],
  ringsCollected: 0,
  zoneProgress: [] as boolean[],
  balloons: [] as (BalloonDef & { popped: boolean })[],
  balloonsCollected: 0,
  balloonsDone: false,
  manualComplete: false,
  awaitingReturn: false,
  returnPhase: null as null | 'return' | 'land',
  durationDone: false,
};

let ringFaceHintAt = 0; // 「機頭沒對準圈」提示節流
let lastFaceAligned: boolean | null = null;
let lastFaceRing = -1;
/** 上一 tick 的累積轉角（度）。用來分辨「停在目標角」和「掃過去」。 */
let previousYawDeg = 0;

function currentYawDeg(): number {
  return YawAccumulator.fromRadians(droneState.yaw);
}

/** 上一 tick 的位置，穿圈要看這一 tick 的移動線段有沒有穿過圈面 */
const previousPos = { x: 0, y: 0, z: 0 };

/**
 * 把「上一 tick 的角與位置」對齊現在。每 tick 結束、以及重置／載入（瞬移）後都要取樣，
 * 避免第一個 tick 被看成大幅轉動，或把瞬移的線段算成穿圈。
 */
function samplePose(): void {
  previousYawDeg = currentYawDeg();
  previousPos.x = droneState.position.x;
  previousPos.y = droneState.position.y;
  previousPos.z = droneState.position.z;
}

/** 重播：套用錄製起點的位置與機頭後重新取樣，和線上錄製開始時的狀態一致。 */
export function resyncLevelPose(): void {
  samplePose();
}

function currentPose(): Pose {
  const p = droneState.position;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    accumulatedYawDeg: currentYawDeg(),
    previousYawDeg,
    grounded: droneState.isGrounded,
  };
}
/** 3-2-1 倒數世代：切關／離場遞增，舊的 setTimeout 回呼直接作廢 */
let countdownToken = 0;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;

/** 關卡載入前檢查（由 main 注入；core 不依賴 net/） */
let levelLoadGuard: ((levelId: string) => boolean) | null = null;
/** 首關選擇（由 main 注入；依授權挑可玩的關） */
let initialLevelResolver: ((levels: LevelDef[], requested: string) => string) | null = null;

export function setLevelLoadGuard(guard: ((levelId: string) => boolean) | null): void {
  levelLoadGuard = guard;
}

export function checkLevelLoadGuard(levelId: string): boolean {
  if (!levelLoadGuard) return true;
  return levelLoadGuard(levelId);
}

export function setInitialLevelResolver(
  fn: ((levels: LevelDef[], requested: string) => string) | null,
): void {
  initialLevelResolver = fn;
}

export interface LoadLevelOptions {
  /** 老師廣播切關等伺服器指令：略過授權 gate */
  bypassGuard?: boolean;
}

/** ring 上下漂浮的即時世界 Y（core 判定與 render 視覺共用同一公式；nowMs = 模擬時間） */
export function ringWorldY(
  index: number,
  baseY: number,
  nowMs: number,
  bobAmp?: number,
): number {
  const amp = bobAmp ?? 0.2;
  if (amp <= 0) return baseY;
  return baseY + detSin(nowMs * 0.001 + index) * amp;
}

export function levelElapsedMs(): number {
  if (!levelState.startTime) return 0;
  // 暫停中：以暫停當下時間為基準 → HUD 計時凍結。
  // clamp ≥ 0：防禦「暫停中按開始」等時序邊界產生負值
  const base = levelState.pausedAt || Date.now();
  return Math.max(0, base - levelState.startTime);
}

// =============================================================================
// 載入
// =============================================================================
async function fetchChapter(n: number): Promise<{ chapter: number; name: string; levels: LevelDef[] } | null> {
  try {
    const r = await fetch(`/levels/chapter${n}.json`);
    const data: unknown = await r.json();
    if (!isChapterDef(data)) throw new Error('格式不符');
    return { chapter: data.chapter, name: data.name ?? `第 ${n} 章`, levels: data.levels };
  } catch (e) {
    console.warn(`載入 chapter${n}.json 失敗：`, e);
    return null;
  }
}

/** 載入三章關卡，完成後載入預設關（或 URL ?level= 指定關） */
export async function loadChapters(): Promise<void> {
  const preview = readPreviewLevel();
  if (preview) {
    levelState.chapters = [
      { chapter: 0, name: '預覽', groupLabel: '預覽', levels: [preview] },
    ];
    levelState.levels = [preview];
    console.log('[Chapter] 預覽模式載入自訂關卡');
    bus.emit('levels-ready', { levels: levelState.levels });
    applyLoadLevel(PREVIEW_LEVEL_ID);
    return;
  }

  const chapters = (
    await Promise.all([fetchChapter(1), fetchChapter(2), fetchChapter(3)])
  ).filter((c): c is NonNullable<typeof c> => c !== null);
  levelState.chapters = chapters;
  levelState.levels = chapters.flatMap((c) => c.levels);
  console.log(`[Chapter] 載入 ${chapters.map((c) => c.levels.length).join(' + ')} 個關卡`);
  bus.emit('levels-ready', { levels: levelState.levels });
  const lp = new URLSearchParams(location.search).get('level');
  const requested = /^[123]-[0-6]$/.test(lp ?? '') ? (lp as string) : '1-0';
  const id = initialLevelResolver?.(levelState.levels, requested) ?? requested;
  void import('../net/levelLoad').then((m) => m.loadLevel(id));
}

/**
 * 重播 / 伺服器驗證用：直接套用 LevelDef，略過 intro 與授權 gate。
 * 計時基準設為現在（僅供程式模式 checkProgramCompletion；hash 驗證不依賴用時）。
 */
export function bootstrapLevelForReplay(level: LevelDef): void {
  const s = levelState;
  s.current = level;
  s.rings = (level.rings ?? []).map((r) => ({ ...r, passed: false }));
  s.ringsCollected = 0;
  s.zoneProgress = new Array(level.passZones?.length ?? 0).fill(false);
  s.balloons = (level.balloons ?? []).map((b) => ({ ...b, popped: false }));
  s.balloonsCollected = 0;
  s.balloonsDone = false;
  s.manualComplete = false;
  s.awaitingReturn = false;
  s.returnPhase = null;
  s.durationDone = false;
  s.startTime = Date.now();
  s.pausedAt = 0;
  s.armed = true;
  flags.countdownActive = false;
  flags.paused = false;
  lastFaceAligned = null;
  lastFaceRing = -1;
  setSolidObstacles(
    (level.obstacles ?? [])
      .filter((o) => obstacleIsCollidable(o))
      .map((o) => ({ x: o.x, y: o.y, z: o.z, half: o.size / 2 })),
  );
  setFlightBounds(FlightArea.of(level));
  resetDroneState();
  samplePose();
}

/** 實際套用關卡資料（授權通過後；老師廣播 bypass 亦走此） */
export function applyLoadLevel(levelId: string): void {
  const level = levelState.levels.find((l) => l.id === levelId);
  if (!level) {
    console.warn('找不到關卡：', levelId);
    return;
  }
  // 先退出目前場次（大亂鬥／足球／上一關，含切回同一關），再寫入新關。
  // 學生自己點關卡與老師廣播都走這裡，避免只更新關卡資料、場景卻留在舊模式。
  GameSession.enter('level');
  const s = levelState;
  s.current = level;
  s.rings = (level.rings ?? []).map((r) => ({ ...r, passed: false }));
  s.ringsCollected = 0;
  s.zoneProgress = new Array(level.passZones?.length ?? 0).fill(false);
  s.balloons = (level.balloons ?? []).map((b) => ({ ...b, popped: false }));
  s.balloonsCollected = 0;
  s.balloonsDone = false;
  s.manualComplete = false;
  s.awaitingReturn = false;
  s.returnPhase = null;
  s.durationDone = false;
  s.startTime = 0;
  s.pausedAt = 0;
  s.armed = false;
  flags.countdownActive = false;
  flags.paused = false;
  lastFaceAligned = null;
  lastFaceRing = -1;

  // 實心障礙 → 物理層碰撞資料
  setSolidObstacles(
    (level.obstacles ?? [])
      .filter((o) => obstacleIsCollidable(o))
      .map((o) => ({ x: o.x, y: o.y, z: o.z, half: o.size / 2 })),
  );
  setFlightBounds(FlightArea.of(level));

  resetDroneState();
  samplePose();
  bus.emit('trail-clear', {});
  bus.emit('level-loaded', { level });
  stateHud(level.hud ?? level.name);
  showIntro(level);
}

/**
 * 清除目前關卡（進大亂鬥用）：一般關卡判定 / 物件 / HUD 全部停用。
 * 之後回一般模式時由使用者（或老師廣播）再選關。
 */
export function clearLevel(): void {
  const s = levelState;
  s.current = null;
  s.rings = [];
  s.ringsCollected = 0;
  s.zoneProgress = [];
  s.balloons = [];
  s.balloonsCollected = 0;
  s.balloonsDone = false;
  s.manualComplete = false;
  s.awaitingReturn = false;
  s.returnPhase = null;
  s.durationDone = false;
  s.startTime = 0;
  s.pausedAt = 0;
  s.armed = true;
  flags.countdownActive = false;
  flags.paused = false;
  lastFaceAligned = null;
  lastFaceRing = -1;
  setSolidObstacles([]);
  setFlightBounds(null);
  samplePose();
  // 清飛行軌跡（進大亂鬥 / 足球的唯一共同出口在這裡統一發，呼叫端不必各自補）；
  // 墨水線與參考虛線由 pen.ts / render 端監聽 level-cleared 清除
  bus.emit('trail-clear', {});
  bus.emit('level-cleared', {});
}

function showIntro(level: LevelDef): void {
  // 只顯示說明，等學生按「開始」才啟動（不再有逾時自動倒數 —
  // 學生還在登入 / 看題目就被強制開始計時的問題由此修掉）
  bus.emit('level-intro', { level });
}

/** 按「開始」→ 關閉說明 → 3-2-1 倒數 → 開始計時（每關只觸發一次） */
export function armLevelStart(): void {
  const s = levelState;
  if (s.armed || !s.current) return;
  s.armed = true;
  bus.emit('level-armed', { level: s.current });
  // 自由活動關：不倒數、直接開飛，但仍要設 startTime —
  // 1-6 這類「freeplay＋有完成條件（氣球）」的關卡，過關結算與上報才有真實用時
  // （否則恆為 0 秒，還會被伺服器 <1s 防作弊誤標為可疑成績）。HUD 依 freeplay 不顯示計時。
  if (s.current.freeplay) {
    s.startTime = Date.now();
    bus.emit('level-timing-started', { levelId: s.current.id });
    return;
  }
  runCountdown(() => {
    s.startTime = Date.now();
    if (s.current) bus.emit('level-timing-started', { levelId: s.current.id });
  });
}

/** 作廢進行中的 3-2-1（切關、離場）。舊回呼不得再改 startTime／countdownActive。 */
export function cancelCountdown(): void {
  countdownToken++;
  if (countdownTimer) {
    GameSession.clearTracked(countdownTimer);
    countdownTimer = null;
  }
  flags.countdownActive = false;
}

/** 3 → 2 → 1 → GO! 倒數（期間鎖操控、不判定過關） */
export function runCountdown(onGo?: () => void): void {
  cancelCountdown();
  const token = countdownToken;
  flags.countdownActive = true;
  let n = 3;
  const tick = (): void => {
    if (token !== countdownToken) return;
    if (n > 0) {
      bus.emit('countdown', { n });
      sound('beep');
      n--;
      countdownTimer = GameSession.trackTimeout(tick, 700);
    } else {
      countdownTimer = null;
      bus.emit('countdown', { n: 0 });
      sound('go');
      flags.countdownActive = false;
      onGo?.();
    }
  };
  tick();
}

/** 離開一般關卡：倒數、暫停、關卡物件與判定全部停下。進大亂鬥／足球／換關都走這裡。 */
function exitLevel(): void {
  cancelCountdown();
  releasePauseForSwitch();
  clearLevel();
}

GameSession.onExit('level', exitLevel);

/** 重置無人機 + 圈圈狀態（對齊 legacy resetDrone：不清 passZones/氣球進度） */
export function resetMission(): void {
  recordAction({ a: 'reset' });
  resetDroneState();
  samplePose();
  levelState.rings.forEach((r) => (r.passed = false));
  levelState.ringsCollected = 0;
  bus.emit('rings-reset', {});
  bus.emit('trail-clear', {});
  stateHud('待命');
}

// =============================================================================
// 每 tick 判定（由主迴圈呼叫；倒數中不判定）
// =============================================================================
export function tickLevel(nowMs: number): void {
  const level = levelState.current;
  if (!level) return;
  // 未按「開始」（intro 卡還開著）不判定 — 否則低門檻關（如 1-1 起飛 zone）
  // 會在 startTime 還沒設定時就完成，產生 0 秒成績
  if (levelState.armed && !flags.countdownActive) {
    checkRings(nowMs);
    checkZones();
    checkBalloons();
    checkCompletion();
    checkDuration();
  }
  updateFaceGuidance();
  samplePose();
}

function checkRings(nowMs: number): void {
  const s = levelState;
  const p = droneState.position;
  s.rings.forEach((ring, i) => {
    if (!RingJudge.canPass(s.rings.map((r) => r.passed), i, s.current?.ringOrder)) return;
    // 這一 tick 的移動線段要從圈裡穿過圈面才算；在圈前面晃、從旁邊擦過都不算
    const center = { x: ring.x, y: ringWorldY(i, ring.y, nowMs, ringBobAmp(ring)), z: ring.z };
    const yawRad = RingPassJudge.yawRadAt(ringYawDeg(ring), ringSpin(ring), simTime.tick);
    if (!RingPassJudge.crossed(previousPos, p, center, yawRad, ringPassRadius(ring))) return;
    // 旋轉鑽圈：faceYaw 比的是機頭朝向（最短角差），不是累積轉了幾度。
    if (ring.faceYaw !== undefined && ring.faceYaw !== null) {
      const yawDeg = currentYawDeg();
      if (!FaceYawJudge.aligned(yawDeg, ring.faceYaw, FaceYawJudge.tolerance(ring.faceTol))) {
        if (nowMs - ringFaceHintAt > 1500) {
          ringFaceHintAt = nowMs;
          stateHud('🔄 先轉向，機頭對準圈的方向再穿過！');
          toast('🔄 機頭要對準圈的方向才算過！先轉向', 'warning');
        }
        return;
      }
    }
    ring.passed = true;
    s.ringsCollected++;
    bus.emit('ring-passed', { index: i, collected: s.ringsCollected, total: s.rings.length });
    toast(`✓ 穿過圈 ${i + 1}`, 'success');
    sound('ring');
  });
}

/** 各種任務的進度。圈、任務點、氣球都在這裡，整關過關與程式模式共用。 */
function taskTallies(): TaskTally[] {
  const s = levelState;
  return [
    { done: s.ringsCollected, total: s.rings.length },
    { done: s.zoneProgress.filter(Boolean).length, total: s.zoneProgress.length },
    { done: s.balloonsCollected, total: s.balloons.length },
  ];
}

/**
 * 整關過關（手動飛行）：關卡裡出現的任務全部做完 →（returnHome 關）飛回起飛墊降落 → 過關。
 * 每次嘗試只上報一次。
 */
function checkCompletion(): void {
  const s = levelState;
  const level = s.current;
  if (!level) return;
  if (!TaskJudge.allDone(taskTallies())) {
    // 重置後（圈清掉）可以重新完成
    s.manualComplete = false;
    s.awaitingReturn = false;
    s.returnPhase = null;
    return;
  }
  if (s.manualComplete) return;
  // 程式模式的穿圈關在程式結束時才判定（checkProgramCompletion），與 legacy 一致
  if (flags.programRunning && s.rings.length > 0) return;
  if (!level.returnHome) {
    manualLevelComplete();
    return;
  }
  const p = droneState.position;
  const overPad = LandingJudge.overPad(p.x, p.z, undefined, HOME_POSITION.x, HOME_POSITION.z);
  if (overPad && droneState.isGrounded) {
    manualLevelComplete();
    return;
  }
  s.awaitingReturn = true;
  const phase = overPad ? 'land' : 'return';
  if (s.returnPhase === phase) return;
  s.returnPhase = phase;
  if (phase === 'return') {
    stateHud('🏠 任務完成！飛回起飛墊（原點）');
    toast('任務都完成了！飛回起飛墊上方', 'success');
  } else {
    stateHud('🛬 到墊上方了！降落在起飛墊上');
    toast('🛬 降下去、降落在起飛墊上就完成！', 'success');
  }
  bus.emit('return-home', { phase });
}

function emitLevelComplete(timeMs: number): void {
  const s = levelState;
  if (!s.current) return;
  const inputLog = finalizeRecording();
  bus.emit('level-complete', {
    levelId: s.current.id,
    timeMs,
    inputLog,
    replayHash: inputLog?.replayHash,
  });
}

/** 標記本次嘗試已過關並上報（手動與程式模式共用，提示音與 toast 由呼叫端決定）。 */
function markLevelComplete(elapsedMs: number): void {
  const s = levelState;
  s.manualComplete = true;
  s.awaitingReturn = false;
  s.returnPhase = null;
  if (s.current?.returnHome) bus.emit('return-home', { phase: 'done' });
  emitLevelComplete(elapsedMs);
}

function manualLevelComplete(): void {
  const elapsed = levelElapsedMs();
  toast(`🎉 過關！用時 ${(elapsed / 1000).toFixed(1)}s`, 'success');
  sound('complete');
  markLevelComplete(elapsed);
}

function checkZones(): void {
  const s = levelState;
  const zones = s.current?.passZones;
  if (!zones?.length) return;
  const pose = currentPose();
  zones.forEach((zone, i) => {
    // 必須照順序：前一步沒完成，這一步尚未啟用
    if (!OrderJudge.isActive(s.zoneProgress, i)) return;
    if (!PassZoneJudge.satisfies(zone, pose)) return;
    s.zoneProgress[i] = true;
    const done = s.zoneProgress.filter(Boolean).length;
    bus.emit('zone-passed', { index: i, done, total: zones.length });
    toast(`✓ ${zone.label || `步驟 ${i + 1}`}`, 'success');
    sound('ring');
  });
}

function checkBalloons(): void {
  const s = levelState;
  if (!s.balloons.length) return;
  const p = droneState.position;
  s.balloons.forEach((b, i) => {
    if (b.popped) return;
    if (detHypot3(p.x - b.x, p.y - b.y, p.z - b.z) < balloonPopRadius(b)) {
      b.popped = true;
      s.balloonsCollected++;
      bus.emit('balloon-popped', {
        index: i,
        collected: s.balloonsCollected,
        total: s.balloons.length,
      });
      toast(`🎈 戳破 ${s.balloonsCollected}/${s.balloons.length}`, 'success');
      sound('pop');
    }
  });
  // 只提示；過關由 checkCompletion 統一判定（混合關卡還有別的任務要做）
  if (!s.balloonsDone && s.balloonsCollected >= s.balloons.length) {
    s.balloonsDone = true;
    toast(`🎈 ${s.balloons.length} 顆氣球全部戳破！太厲害了！`, 'success');
  }
}

/** duration 關（1-0）：倒數結束自動進下一關 */
function checkDuration(): void {
  const s = levelState;
  const level = s.current;
  if (!level?.duration || !s.startTime || s.durationDone) return;
  if ((Date.now() - s.startTime) / 1000 < level.duration) return;
  s.durationDone = true;
  const idx = s.levels.findIndex((l) => l.id === level.id);
  const next = s.levels[idx + 1];
  if (next) {
    toast(`⏰ 熱身結束，進入下一關：${next.name}`, 'success');
    void import('../net/levelLoad').then((m) => m.loadLevel(next.id));
  }
}

// =============================================================================
// 旋轉鑽圈（faceYaw）機頭方向引導
// =============================================================================
export function getFaceGuidance(): FaceGuidance | null {
  const s = levelState;
  if (!s.rings.length) return null;
  const idx = s.rings.findIndex((r) => !r.passed && r.faceYaw != null);
  const ring = idx >= 0 ? s.rings[idx] : undefined;
  if (!ring) return null;
  const yawDeg = currentYawDeg();
  const target = ring.faceYaw ?? 0;
  const signed = signedYawDiffDeg(target, yawDeg);
  const tol = FaceYawJudge.tolerance(ring.faceTol);
  return {
    ringIndex: idx,
    aligned: FaceYawJudge.aligned(yawDeg, target, tol),
    yawDeg,
    targetDeg: target,
    signed,
  };
}

/** 對準狀態改變時發事件（render 把目標圈變綠） */
function updateFaceGuidance(): void {
  const g = getFaceGuidance();
  if (!g) {
    lastFaceAligned = null;
    lastFaceRing = -1;
    return;
  }
  if (g.aligned !== lastFaceAligned || g.ringIndex !== lastFaceRing) {
    lastFaceAligned = g.aligned;
    lastFaceRing = g.ringIndex;
    bus.emit('ring-face', { index: g.ringIndex, aligned: g.aligned });
  }
}

// =============================================================================
// 程式模式過關判定（runProgram 結束時呼叫）
// =============================================================================
export interface ProgramResult {
  passed: boolean;
  allRings: boolean;
  ringsCollected: number;
  totalRings: number;
  elapsedMs: number;
}

export function checkProgramCompletion(): ProgramResult {
  const s = levelState;
  const allRings = s.rings.length > 0 && s.ringsCollected >= s.rings.length;
  // 和手動一樣：出現的任務都要做完。程式模式不要求返航降落（與 legacy 一致）。
  const passed = TaskJudge.allDone(taskTallies());
  const elapsedMs = levelElapsedMs();
  // 每次嘗試只上報一次：任務點／氣球關在 tick 內可能已由 checkCompletion 上報；
  // 穿圈關這裡上報後標記完成，程式結束後下一 tick 的 checkCompletion 就不會再報
  if (passed && s.current && !s.manualComplete) markLevelComplete(elapsedMs);
  return {
    passed,
    allRings,
    ringsCollected: s.ringsCollected,
    totalRings: s.rings.length,
    elapsedMs,
  };
}
