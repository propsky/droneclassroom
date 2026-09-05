// 關卡系統 — 載入 chapter JSON、rings/passZones/balloons 判定、returnHome、計時。
// 行為對齊 legacy main.js §4 / §12（checkRingCollisions / checkPassZones / checkBalloons）。
import type { LevelDef, BalloonDef } from '@creafly/shared';
import {
  isChapterDef,
  normalizeDeg,
  signedYawDiffDeg,
  RAD2DEG,
  PREVIEW_LEVEL_ID,
  detSin,
  detHypot2,
  detHypot3,
  ringPassRadius,
  balloonPopRadius,
  ringBobAmp,
  ringSpin,
  zoneTriggerRadius,
  obstacleIsCollidable,
} from '@creafly/shared';
import { readPreviewLevel } from '../preview';
import { droneState, resetDroneState, HOME_POSITION, flags } from './droneState';
import { setSolidObstacles } from './physics';
import { bus, toast, sound, stateHud } from './events';
import { finalizeRecording } from './recordingSession';

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
  resetDroneState();
}

/** 實際套用關卡資料（授權通過後；老師廣播 bypass 亦走此） */
export function applyLoadLevel(levelId: string): void {
  const level = levelState.levels.find((l) => l.id === levelId);
  if (!level) {
    console.warn('找不到關卡：', levelId);
    return;
  }
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

  resetDroneState();
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

/** 3 → 2 → 1 → GO! 倒數（期間鎖操控、不判定過關） */
export function runCountdown(onGo?: () => void): void {
  flags.countdownActive = true;
  let n = 3;
  const tick = (): void => {
    if (n > 0) {
      bus.emit('countdown', { n });
      sound('beep');
      n--;
      setTimeout(tick, 700);
    } else {
      bus.emit('countdown', { n: 0 });
      sound('go');
      flags.countdownActive = false;
      onGo?.();
    }
  };
  tick();
}

/** 重置無人機 + 圈圈狀態（對齊 legacy resetDrone：不清 passZones/氣球進度） */
export function resetMission(): void {
  resetDroneState();
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
    checkDuration();
  }
  updateFaceGuidance();
}

function checkRings(nowMs: number): void {
  const s = levelState;
  const p = droneState.position;
  s.rings.forEach((ring, i) => {
    if (ring.passed) return;
    const ry = ringWorldY(i, ring.y, nowMs, ringBobAmp(ring));
    const dist = detHypot3(p.x - ring.x, p.y - ry, p.z - ring.z);
    if (dist >= ringPassRadius(ring)) return;
    // 旋轉鑽圈關：faceYaw 圈必須機頭對準才算穿過
    if (ring.faceYaw !== undefined && ring.faceYaw !== null) {
      const yawDeg = normalizeDeg(droneState.yaw * RAD2DEG);
      const target = normalizeDeg(ring.faceYaw);
      let d = Math.abs(yawDeg - target);
      if (d > 180) d = 360 - d;
      if (d > (ring.faceTol ?? 35)) {
        if (nowMs - ringFaceHintAt > 1500) {
          ringFaceHintAt = nowMs;
          stateHud('🔄 轉向紅圈、機頭對準再穿過！');
          toast('🔄 機頭要對準紅圈才算過！先轉向', 'warning');
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

  // 手動模式：全部圈都過了 →（returnHome 關）引導回家降落，否則直接過關
  const allDone = s.rings.length > 0 && s.ringsCollected >= s.rings.length;
  if (!flags.programRunning && allDone && !s.manualComplete) {
    const level = s.current;
    if (level?.returnHome) {
      const dx = p.x - HOME_POSITION.x;
      const dz = p.z - HOME_POSITION.z;
      const overPad = detHypot2(dx, dz) < 1.5; // 水平距離，不看高度
      const landed = droneState.isGrounded;
      if (overPad && landed) {
        manualLevelComplete();
      } else {
        s.awaitingReturn = true;
        const phase = overPad ? 'land' : 'return';
        if (s.returnPhase !== phase) {
          s.returnPhase = phase;
          if (phase === 'return') {
            stateHud('🏠 全部穿過了！飛回起飛墊（原點）');
            toast('全部圈圈都穿過了！飛回起飛墊上方', 'success');
          } else {
            stateHud('🛬 到墊上方了！降落在起飛墊上');
            toast('🛬 降下去、降落在起飛墊上就完成！', 'success');
          }
          bus.emit('return-home', { phase });
        }
      }
    } else {
      manualLevelComplete();
    }
  }
  // 重置後把完成狀態清掉
  if (s.ringsCollected < s.rings.length) {
    s.manualComplete = false;
    s.awaitingReturn = false;
    s.returnPhase = null;
  }
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

function manualLevelComplete(): void {
  const s = levelState;
  s.manualComplete = true;
  s.awaitingReturn = false;
  s.returnPhase = null;
  if (s.current?.returnHome) bus.emit('return-home', { phase: 'done' });
  const elapsed = levelElapsedMs();
  toast(`🎉 過關！用時 ${(elapsed / 1000).toFixed(1)}s`, 'success');
  sound('complete');
  emitLevelComplete(elapsed);
}

function checkZones(): void {
  const s = levelState;
  const zones = s.current?.passZones;
  if (!zones?.length) return;
  const p = droneState.position;
  zones.forEach((zone, i) => {
    if (s.zoneProgress[i]) return;
    // 必須照順序：前一步沒完成，這一步尚未啟用
    if (i > 0 && !s.zoneProgress[i - 1]) return;
    if (zone.type === 'altitude') {
      const dx = p.x - zone.x;
      const dz = p.z - zone.z;
      if (detHypot2(dx, dz) > zoneTriggerRadius(zone)) return;
      if (zone.minY !== undefined && p.y < zone.minY) return;
      if (zone.maxY !== undefined && p.y > zone.maxY) return;
    } else if (zone.type === 'position') {
      if (zone.minX !== undefined && p.x < zone.minX) return;
      if (zone.maxX !== undefined && p.x > zone.maxX) return;
      if (zone.minZ !== undefined && p.z < zone.minZ) return;
      if (zone.maxZ !== undefined && p.z > zone.maxZ) return;
      if (zone.minY !== undefined && p.y < zone.minY) return;
      if (zone.maxY !== undefined && p.y > zone.maxY) return;
    } else if (zone.type === 'heading') {
      const dx = p.x - zone.x;
      const dz = p.z - zone.z;
      if (detHypot2(dx, dz) > zoneTriggerRadius(zone)) return;
      const yawDeg = normalizeDeg(droneState.yaw * RAD2DEG);
      const target = normalizeDeg(zone.targetYaw);
      let diff = Math.abs(yawDeg - target);
      if (diff > 180) diff = 360 - diff;
      if (diff > (zone.tolerance || 20)) return;
    } else {
      return;
    }
    s.zoneProgress[i] = true;
    const done = s.zoneProgress.filter(Boolean).length;
    bus.emit('zone-passed', { index: i, done, total: zones.length });
    toast(`✓ ${zone.label || `步驟 ${i + 1}`}`, 'success');
    sound('ring');
    if (s.zoneProgress.every(Boolean)) {
      toast('🎉 過關！', 'success');
      sound('complete');
      s.manualComplete = true;
      if (s.current) {
        emitLevelComplete(levelElapsedMs());
      }
    }
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
  if (!s.balloonsDone && s.balloonsCollected >= s.balloons.length) {
    s.balloonsDone = true;
    toast(`🎉 ${s.balloons.length} 顆氣球全部戳破！太厲害了！`, 'success');
    sound('complete');
    if (s.current) emitLevelComplete(levelElapsedMs());
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
  const yawDeg = normalizeDeg(droneState.yaw * RAD2DEG);
  const target = normalizeDeg(ring.faceYaw ?? 0);
  const signed = signedYawDiffDeg(target, yawDeg);
  const tol = ring.faceTol ?? 40;
  return { ringIndex: idx, aligned: Math.abs(signed) <= tol, yawDeg, targetDeg: target, signed };
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
  const allZones =
    !!s.current?.passZones?.length &&
    s.zoneProgress.length === s.current.passZones.length &&
    s.zoneProgress.every(Boolean);
  const passed = allRings || allZones;
  const elapsedMs = levelElapsedMs();
  if (passed && s.current) {
    emitLevelComplete(elapsedMs);
  }
  return {
    passed,
    allRings,
    ringsCollected: s.ringsCollected,
    totalRings: s.rings.length,
    elapsedMs,
  };
}
