// 關卡系統 — 載入 chapter JSON、rings/passZones/balloons 判定、returnHome、計時。
// 行為對齊 legacy main.js §4 / §12（checkRingCollisions / checkPassZones / checkBalloons）。
import type { LevelDef } from '@creafly/shared';
import { isChapterDef, normalizeDeg, signedYawDiffDeg, RAD2DEG } from '@creafly/shared';
import { droneState, resetDroneState, HOME_POSITION, flags } from './droneState';
import { setSolidObstacles } from './physics';
import { bus, toast, sound, stateHud } from './events';

export interface MissionRing {
  x: number;
  y: number;
  z: number;
  color?: number | string;
  label?: string;
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
  current: null as LevelDef | null,
  /** 0 = 尚未開始計時（按開始 + 3-2-1 倒數後才設定） */
  startTime: 0,
  armed: false,
  rings: [] as MissionRing[],
  ringsCollected: 0,
  zoneProgress: [] as boolean[],
  balloons: [] as { x: number; y: number; z: number; popped: boolean }[],
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

/** ring 上下漂浮的即時世界 Y（core 判定與 render 視覺共用同一公式） */
export function ringWorldY(index: number, baseY: number, nowMs: number): number {
  return baseY + Math.sin(nowMs * 0.001 + index) * 0.2;
}

export function levelElapsedMs(): number {
  return levelState.startTime ? Date.now() - levelState.startTime : 0;
}

// =============================================================================
// 載入
// =============================================================================
async function fetchChapter(n: number): Promise<LevelDef[]> {
  try {
    const r = await fetch(`/levels/chapter${n}.json`);
    const data: unknown = await r.json();
    if (!isChapterDef(data)) throw new Error('格式不符');
    return data.levels;
  } catch (e) {
    console.warn(`載入 chapter${n}.json 失敗：`, e);
    return [];
  }
}

/** 載入三章關卡，完成後載入預設關（或 URL ?level= 指定關） */
export async function loadChapters(): Promise<void> {
  const [c1, c2, c3] = await Promise.all([fetchChapter(1), fetchChapter(2), fetchChapter(3)]);
  levelState.levels = [...c1, ...c2, ...c3];
  console.log(`[Chapter] 載入 ${c1.length} + ${c2.length} + ${c3.length} 個關卡`);
  bus.emit('levels-ready', { levels: levelState.levels });
  const lp = new URLSearchParams(location.search).get('level');
  loadLevel(/^[123]-[0-6]$/.test(lp ?? '') ? (lp as string) : '1-0');
}

export function loadLevel(levelId: string): void {
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
  s.armed = false;
  flags.countdownActive = false;
  lastFaceAligned = null;
  lastFaceRing = -1;

  // 實心障礙 → 物理層碰撞資料
  setSolidObstacles(
    (level.obstacles ?? [])
      .filter((o) => o.solid)
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
  s.armed = true; // 取消 intro 的 fallback 自動開始
  flags.countdownActive = false;
  lastFaceAligned = null;
  lastFaceRing = -1;
  setSolidObstacles([]);
  bus.emit('level-cleared', {});
}

function showIntro(level: LevelDef): void {
  bus.emit('level-intro', { level });
  // 太久沒按「開始」→ fallback 自動啟動（1-0 較短）
  const armId = level.id;
  setTimeout(
    () => {
      if (levelState.current?.id === armId) armLevelStart();
    },
    level.id === '1-0' ? 15000 : 20000,
  );
}

/** 按「開始」→ 關閉說明 → 3-2-1 倒數 → 開始計時（每關只觸發一次） */
export function armLevelStart(): void {
  const s = levelState;
  if (s.armed || !s.current) return;
  s.armed = true;
  bus.emit('level-armed', { level: s.current });
  // 自由活動關：不倒數、不計時，直接開飛
  if (s.current.freeplay) return;
  runCountdown(() => {
    s.startTime = Date.now();
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
  if (!flags.countdownActive) {
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
    const ry = ringWorldY(i, ring.y, nowMs);
    const dist = Math.hypot(p.x - ring.x, p.y - ry, p.z - ring.z);
    if (dist >= 1.5) return;
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
      const overPad = Math.hypot(dx, dz) < 1.5; // 水平距離，不看高度
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

function manualLevelComplete(): void {
  const s = levelState;
  s.manualComplete = true;
  s.awaitingReturn = false;
  s.returnPhase = null;
  if (s.current?.returnHome) bus.emit('return-home', { phase: 'done' });
  const elapsed = levelElapsedMs();
  toast(`🎉 過關！用時 ${(elapsed / 1000).toFixed(1)}s`, 'success');
  sound('complete');
  if (s.current) bus.emit('level-complete', { levelId: s.current.id, timeMs: elapsed });
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
        bus.emit('level-complete', { levelId: s.current.id, timeMs: levelElapsedMs() });
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
    if (Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < 1.4) {
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
    if (s.current) bus.emit('level-complete', { levelId: s.current.id, timeMs: levelElapsedMs() });
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
    loadLevel(next.id);
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
    bus.emit('level-complete', { levelId: s.current.id, timeMs: elapsedMs });
  }
  return {
    passed,
    allRings,
    ringsCollected: s.ringsCollected,
    totalRings: s.rings.length,
    elapsedMs,
  };
}
