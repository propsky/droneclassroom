// ⚽ 無人機足球 — 單人練習（7 個 drill、過中線退半場、窄邊定點視角）。
// 行為對齊 legacy main.js §16：SOC 場地常數、穿門判定（prevZ 跨越 + 門環半徑內）、
// 最佳紀錄 localStorage（沿用 legacy key 'creafly_soccer_<id>'）、飛機縮 0.65。
// 視覺（場地 / 球門 / 門框碰撞 / 球形保護框 / 假人）在 render/soccerField.ts；HUD 在 ui/soccerHud.ts。
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { setSolidObstacles } from '../core/physics';
import { clearLevel } from '../core/level';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { SOCCER_FIELD, SOCCER_BALL_R } from './constants';
import { resetSoccerField } from './field';
import {
  showSoccerPracticeHud,
  renderDrillButtons,
  setPracticeStatus,
} from '../ui/soccerHud';

// ---- Drill 清單（與 legacy SOCCER_DRILLS 相同）----
export interface SoccerDrill {
  id: string;
  name: string;
  type: 'free' | 'pass' | 'shuttle';
  desc: string;
  /** 目標穿門次數（999 = 限時內盡量多穿） */
  target?: number;
  /** 時間限制（秒） */
  timeLimit?: number;
  /** 記錄最佳成績（計時類記最快秒數、限時多穿記次數） */
  record?: boolean;
  /** 門前擺防守假人（P-5） */
  dummies?: boolean;
}

export const SOCCER_DRILLS: readonly SoccerDrill[] = [
  { id: 'P-1', name: '熟悉場地', type: 'free', desc: '自由飛，熟悉場地與兩端球門。' },
  { id: 'P-2', name: '單次穿門', type: 'pass', target: 1, desc: '飛到對面，穿過遠端球門 1 次。' },
  { id: 'P-3', name: '連續穿門×3', type: 'pass', target: 3, timeLimit: 60, desc: '60 秒內穿過遠端門 3 次。' },
  { id: 'P-4', name: '計時單穿', type: 'pass', target: 1, record: true, desc: '計時：穿過遠端門，挑戰最快！' },
  { id: 'P-5', name: '繞過防守', type: 'pass', target: 1, dummies: true, desc: '遠端門前有假人，繞過去穿門。' },
  { id: 'P-6', name: '兩端來回×3', type: 'shuttle', target: 3, desc: '穿遠端門→退回過中線→再穿，來回 3 次。' },
  { id: 'P-7', name: '限時多穿', type: 'pass', target: 999, timeLimit: 180, record: true, desc: '3 分鐘內盡量多穿門！' },
] as const;

/** P-5 防守假人（門前兩顆紫色方塊；與 legacy soccerSpawnDummiesTagged 同座標 / 尺寸） */
const DUMMY_BOXES: readonly { x: number; y: number; z: number; half: number }[] = [
  { x: -1.2, y: SOCCER_FIELD.goalY, z: -SOCCER_FIELD.goalZ + 2.5, half: 0.65 },
  { x: 1.2, y: SOCCER_FIELD.goalY, z: -SOCCER_FIELD.goalZ + 2.5, half: 0.65 },
];

/** 最佳紀錄 localStorage key 前綴（沿用 legacy → 舊紀錄無縫帶過來） */
const LS_BEST_PREFIX = 'creafly_soccer_';

export type PracticeStatus = 'idle' | 'countdown' | 'running' | 'done';

export const practiceState = {
  active: false,
  status: 'idle' as PracticeStatus,
  drill: null as SoccerDrill | null,
  /** 已穿門次數 */
  count: 0,
  /** shuttle：已退回過中線、可再計下一趟 */
  shuttleReturned: true,
  startTime: 0,
  /** 上一 tick 的 z（穿門 = prevZ 在門前、本 tick 在門後的「跨越」） */
  prevZ: 0,
};

export const soccerBest = (id: string): number => {
  try {
    return +(localStorage.getItem(LS_BEST_PREFIX + id) || 0);
  } catch {
    return 0;
  }
};

const soccerSaveBest = (id: string, v: number): void => {
  try {
    localStorage.setItem(LS_BEST_PREFIX + id, String(v));
  } catch {
    /* ignore */
  }
};

// =============================================================================
// 初始化 / 進出場
// =============================================================================
export function initSoccerPractice(): void {
  // 模式互斥：大亂鬥 / 足球對戰接管 → 自動退出練習
  bus.on('mode-takeover', ({ mode }) => {
    if (mode !== 'soccer-practice' && practiceState.active) exitSoccerPractice();
  });
  // 開發後門：?soccer=1 自動進練習場（headless 驗收 / demo 用；對齊 ?arena=1）
  if (new URLSearchParams(location.search).get('soccer') === '1') {
    setTimeout(() => enterSoccerPractice(), 800);
  }
}

export function enterSoccerPractice(): void {
  if (practiceState.active) return;
  bus.emit('mode-takeover', { mode: 'soccer-practice' }); // 大亂鬥 / 對戰收到後自行退出
  practiceState.active = true;
  practiceState.status = 'idle';
  practiceState.drill = null;
  practiceState.count = 0;

  if (flags.mode !== 'manual') setMode('manual');
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickSoccerPractice）
  bus.emit('trail-clear', {});

  // 單人沒有伺服器 → 生效場地回 constants fallback（避免殘留上一場多人下發的尺寸）
  resetSoccerField();
  bus.emit('soccer-entered', { variant: 'practice' }); // render 建場地 + 球門碰撞 + 縮小飛機
  bus.emit('soccer-view-changed', { sign: 1 }); // 窄邊定點視角：站 +z 端（藍隊起始區後方）看向遠端門
  resetPracticeDronePos();

  showSoccerPracticeHud(true);
  renderDrillButtons(SOCCER_DRILLS, soccerBest, startDrill);
  setPracticeStatus('選一個練習開始');
  stateHud('⚽ 選一個練習開始 👇');
  toast('⚽ 進入足球單人練習', 'success');
}

export function exitSoccerPractice(): void {
  if (!practiceState.active) return;
  practiceState.active = false;
  practiceState.status = 'idle';
  practiceState.drill = null;
  setSolidObstacles([]); // 清 P-5 假人碰撞
  bus.emit('soccer-dummies-changed', { boxes: [] });
  bus.emit('soccer-view-changed', { sign: null });
  bus.emit('soccer-exited', {}); // render 清場地 / 碰撞、還原機體大小與地面
  showSoccerPracticeHud(false);
  resetDroneState();
  stateHud('待命');
  toast('已離開足球練習', 'success');
}

/** 飛機回到起始區地面（藍隊起始區中心 z=+startZ、機頭朝遠端門） */
function resetPracticeDronePos(): void {
  droneState.position.x = 0;
  droneState.position.y = HOME_POSITION.y;
  droneState.position.z = SOCCER_FIELD.startZ;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.yaw = 0;
  droneState.isFlying = false;
  droneState.isGrounded = true;
  practiceState.prevZ = droneState.position.z;
}

// =============================================================================
// Drill 流程
// =============================================================================
export function startDrill(idx: number): void {
  const d = SOCCER_DRILLS[idx];
  if (!d || !practiceState.active) return;
  practiceState.drill = d;
  practiceState.count = 0;
  practiceState.shuttleReturned = true;
  // 假人：只有 P-5 擺（碰撞 AABB + render 視覺）
  setSolidObstacles(d.dummies ? DUMMY_BOXES.map((b) => ({ ...b })) : []);
  bus.emit('soccer-dummies-changed', { boxes: d.dummies ? [...DUMMY_BOXES] : [] });
  resetPracticeDronePos();

  if (d.type === 'free') {
    practiceState.status = 'running';
    practiceState.startTime = Date.now();
    stateHud(`⚽ ${d.name}`);
    toast(d.desc);
    return;
  }
  // 3-2-1 倒數（對齊 legacy：只顯示數字，不鎖操控 — 學生可先調整位置）
  practiceState.status = 'countdown';
  toast(d.desc);
  let n = 3;
  const tick = (): void => {
    if (!practiceState.active || practiceState.drill !== d) return; // 中途切 drill / 離場 → 作廢
    if (n > 0) {
      bus.emit('countdown', { n });
      sound('beep');
      n--;
      setTimeout(tick, 700);
    } else {
      bus.emit('countdown', { n: 0 }); // GO!
      sound('go');
      practiceState.status = 'running';
      practiceState.startTime = Date.now();
      practiceState.prevZ = droneState.position.z;
      stateHud(`⚽ ${d.name}：開始！`);
    }
  };
  tick();
}

// =============================================================================
// 每 tick（60Hz；main.ts 在 practiceState.active 時呼叫，取代一般關卡判定）
// =============================================================================
export function tickSoccerPractice(): void {
  clampSoccerBounds();
  const d = practiceState.drill;
  if (practiceState.status !== 'running' || !d) {
    updatePracticeHud();
    return;
  }
  const p = droneState.position;
  const z = p.z;
  // 穿過遠端門：z 由門前跨到門後，且在門環半徑內（與 server / legacy 同一組條件）
  const crossedFar =
    practiceState.prevZ > -SOCCER_FIELD.goalZ &&
    z <= -SOCCER_FIELD.goalZ &&
    Math.abs(p.x) < SOCCER_FIELD.goalR &&
    Math.abs(p.y - SOCCER_FIELD.goalY) < SOCCER_FIELD.goalR;

  if (d.type === 'pass' && crossedFar) {
    practiceState.count++;
    sound('ring');
    const target = d.target ?? 1;
    toast(`⚽ 穿門 ${practiceState.count}${target < 99 ? `/${target}` : ''}`, 'success');
    if (practiceState.count >= target) drillDone(false);
  } else if (d.type === 'shuttle') {
    const target = d.target ?? 1;
    if (practiceState.shuttleReturned && crossedFar) {
      practiceState.count++;
      practiceState.shuttleReturned = false;
      sound('ring');
      if (practiceState.count >= target) drillDone(false);
      else {
        toast(`⚽ 第 ${practiceState.count}/${target} 趟！退回過中線`, 'success');
        stateHud('↩ 退回過中線（z>0）');
      }
    } else if (!practiceState.shuttleReturned && z > 0) {
      practiceState.shuttleReturned = true;
      stateHud('↗ 再去穿遠端門！');
    }
  }
  if (
    practiceState.status === 'running' &&
    d.timeLimit &&
    (Date.now() - practiceState.startTime) / 1000 >= d.timeLimit
  ) {
    drillDone(true);
  }
  practiceState.prevZ = z;
  updatePracticeHud();
}

/** 場地邊界 clamp：以球形保護框半徑內縮（球框不穿牆；地板由 integrate 的 ground clamp 處理） */
function clampSoccerBounds(): void {
  const p = droneState.position;
  const v = droneState.velocity;
  const m = SOCCER_BALL_R;
  if (p.x > SOCCER_FIELD.halfX - m) { p.x = SOCCER_FIELD.halfX - m; if (v.x > 0) v.x = 0; }
  else if (p.x < -SOCCER_FIELD.halfX + m) { p.x = -SOCCER_FIELD.halfX + m; if (v.x < 0) v.x = 0; }
  if (p.z > SOCCER_FIELD.halfZ - m) { p.z = SOCCER_FIELD.halfZ - m; if (v.z > 0) v.z = 0; }
  else if (p.z < -SOCCER_FIELD.halfZ + m) { p.z = -SOCCER_FIELD.halfZ + m; if (v.z < 0) v.z = 0; }
  if (p.y > SOCCER_FIELD.top - m) { p.y = SOCCER_FIELD.top - m; if (v.y > 0) v.y = 0; }
}

function drillDone(timeUp: boolean): void {
  const d = practiceState.drill;
  if (!d || practiceState.status === 'done') return;
  practiceState.status = 'done';
  const secs = (Date.now() - practiceState.startTime) / 1000;
  let msg: string;
  if (d.record && (d.target ?? 0) >= 99) {
    // 限時多穿：比次數（越多越好）
    const best = soccerBest(d.id);
    if (practiceState.count > best) soccerSaveBest(d.id, practiceState.count);
    msg = `⏱ 時間到！穿門 ${practiceState.count} 次（最佳 ${Math.max(best, practiceState.count)}）`;
  } else if (d.record) {
    // 計時單穿：比秒數（越快越好）
    const best = soccerBest(d.id);
    const newBest = !best || secs < best;
    if (newBest) soccerSaveBest(d.id, +secs.toFixed(1));
    msg = `🏆 完成！${secs.toFixed(1)}s${newBest ? '（新紀錄！）' : `（最佳 ${best.toFixed(1)}s）`}`;
  } else if (timeUp) {
    msg = `⏱ 時間到！完成 ${practiceState.count}/${d.target}`;
  } else {
    msg = `🎉 ${d.name} 完成！用時 ${secs.toFixed(1)}s`;
  }
  stateHud(msg);
  toast(msg, 'success');
  sound('complete');
  renderDrillButtons(SOCCER_DRILLS, soccerBest, startDrill); // 最佳紀錄可能更新 → 重繪 ⭐
  updatePracticeHud();
}

/** 練習狀態列（drill 名 + 進度 + 計時 / 倒數剩餘） */
function updatePracticeHud(): void {
  const d = practiceState.drill;
  if (!d) {
    setPracticeStatus('選一個練習開始');
    return;
  }
  let s = `${d.id} ${d.name}`;
  if (practiceState.status === 'running') {
    const t = ((Date.now() - practiceState.startTime) / 1000).toFixed(1);
    const target = d.target ?? 1;
    if (d.type === 'free') s += ` ｜ ${t}s`;
    else if (d.timeLimit) {
      const rem = Math.max(0, Math.ceil(d.timeLimit - (Date.now() - practiceState.startTime) / 1000));
      s += ` ｜ 穿門 ${practiceState.count}${target < 99 ? `/${target}` : ''} ｜ 剩 ${rem}s`;
    } else s += ` ｜ 穿門 ${practiceState.count}/${target} ｜ ${t}s`;
  } else if (practiceState.status === 'countdown') s += ' ｜ 準備…';
  else if (practiceState.status === 'done') s += ' ｜ ✓ 完成';
  setPracticeStatus(s);
}
