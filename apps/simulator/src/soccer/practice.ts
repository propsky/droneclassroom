// ⚽ 無人機足球 — 單人練習（7 個 drill、過中線退半場、窄邊定點視角）。
// 穿門看護罩後緣有沒有離開環的出口面。最佳紀錄 localStorage（沿用 legacy key 'creafly_soccer_<id>'）。
// 視覺（場地 / 球門 / 門框碰撞 / 球形保護框 / 假人）在 render/soccerField.ts；HUD 在 ui/soccerHud.ts。
// P-5 假人是球，碰撞用護罩半徑，不走教室 DRONE_RADIUS 的方塊路徑。
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { setSolidObstacles } from '../core/physics';
import { clearLevel } from '../core/level';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { SOCCER_FIELD } from './constants';
import { shieldPassesRing } from './crossing';
import { bounceSoccerWalls, pushOutOfSphere } from './contact';
import { activeSoccerField, resetSoccerField } from './field';
import {
  showSoccerPracticeHud,
  renderDrillButtons,
  setPracticeStatus,
  showSoccerFeel,
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
  /** 穿完要回到中線、進入自己半場，下一次穿環才算（P-3、P-7；P-6 用 shuttle） */
  mustReturn?: boolean;
}

export const SOCCER_DRILLS: readonly SoccerDrill[] = [
  { id: 'P-1', name: '熟悉場地', type: 'free', desc: '自由飛，熟悉場地與兩端球門。' },
  { id: 'P-2', name: '單次穿門', type: 'pass', target: 1, desc: '飛到對面，穿過遠端球門 1 次。' },
  {
    id: 'P-3',
    name: '連續穿門×3',
    type: 'pass',
    target: 3,
    timeLimit: 60,
    mustReturn: true,
    desc: '60 秒內穿過遠端門 3 次。每穿一次都要先回到中線、進入自己半場。',
  },
  { id: 'P-4', name: '計時單穿', type: 'pass', target: 1, record: true, desc: '計時：穿過遠端門，挑戰最快！' },
  {
    id: 'P-5',
    name: '繞過防守',
    type: 'pass',
    target: 1,
    dummies: true,
    desc: '遠端門前有球形假人，有的會左右巡邏。繞過去穿門。',
  },
  { id: 'P-6', name: '兩端來回×3', type: 'shuttle', target: 3, desc: '穿遠端門→退回過中線→再穿，來回 3 次。' },
  {
    id: 'P-7',
    name: '限時多穿',
    type: 'pass',
    target: 999,
    timeLimit: 180,
    record: true,
    mustReturn: true,
    desc: '3 分鐘內盡量多穿門。每穿一次都要先回到中線、進入自己半場。',
  },
] as const;

/** P-5 假人半徑（與 F9A-A 護罩相同） */
export const PRACTICE_DUMMY_R = 0.2;

export interface PracticeDummy {
  x: number;
  y: number;
  z: number;
  r: number;
  moving: boolean;
}

/**
 * 遠端門在 -z。環前距離朝場內（+z）量，落在 0.5–1.5 m。
 * 左右兩顆靜止，中間一顆沿 x 巡邏。中線空隙用護罩半徑才過得去。
 */
export function practiceDummySpheres(
  phase: number,
  field: { goalZ: number; goalY: number } = SOCCER_FIELD,
): PracticeDummy[] {
  const ahead = (meters: number): number => -field.goalZ + meters;
  const y = field.goalY;
  const r = PRACTICE_DUMMY_R;
  return [
    { x: -0.45, y, z: ahead(0.8), r, moving: false },
    { x: 0.45, y, z: ahead(0.8), r, moving: false },
    { x: Math.sin(phase) * 0.5, y, z: ahead(1.35), r, moving: true },
  ];
}

export type PracticeCrossKind = 'free' | 'open' | 'return';

export function practiceCrossKind(d: SoccerDrill): PracticeCrossKind {
  if (d.type === 'free') return 'free';
  if (d.type === 'shuttle' || d.mustReturn) return 'return';
  return 'open';
}

export interface PracticeCrossInput {
  kind: PracticeCrossKind;
  returned: boolean;
  crossed: boolean;
  /** 目前 z。練習起飛在 +z，自己半場是 z > 0 */
  z: number;
  count: number;
  target: number;
}

export interface PracticeCrossResult {
  returned: boolean;
  count: number;
  done: boolean;
  scored: boolean;
  cameBack: boolean;
}

/** 穿遠端門。return：穿完要 z>0（過中線、進入自己半場）才算下一次。 */
export function scorePracticeCross(input: PracticeCrossInput): PracticeCrossResult {
  const stay = {
    returned: input.returned,
    count: input.count,
    done: false,
    scored: false,
    cameBack: false,
  };
  if (input.kind === 'free') return stay;
  if (input.kind === 'open') {
    if (!input.crossed) return stay;
    const count = input.count + 1;
    return { returned: true, count, done: count >= input.target, scored: true, cameBack: false };
  }
  if (input.returned && input.crossed) {
    const count = input.count + 1;
    return { returned: false, count, done: count >= input.target, scored: true, cameBack: false };
  }
  if (!input.returned && input.z > 0) {
    return { ...stay, returned: true, cameBack: true };
  }
  return stay;
}

/** 最佳紀錄 localStorage key 前綴（沿用 legacy → 舊紀錄無縫帶過來） */
const LS_BEST_PREFIX = 'creafly_soccer_';

export type PracticeStatus = 'idle' | 'countdown' | 'running' | 'done';

export const practiceState = {
  active: false,
  status: 'idle' as PracticeStatus,
  drill: null as SoccerDrill | null,
  /** 已穿門次數 */
  count: 0,
  /** 已退回自己半場、可再計下一趟（P-3／P-6／P-7） */
  shuttleReturned: true,
  startTime: 0,
  /** 上一 tick 的位置（穿環看護罩後緣與行進方向） */
  prevX: 0,
  prevY: 0.4,
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
  // 開發後門：?soccer=1 自動進練習場（headless 驗收 / demo 用；對齊 ?arena=1）。
  // 等關卡清單載完再進場，避免預設關卡晚到把練習場蓋回教室。
  if (new URLSearchParams(location.search).get('soccer') === '1') {
    const offReady = bus.on('levels-ready', () => {
      offReady();
      const offLoaded = bus.on('level-loaded', () => {
        offLoaded();
        setTimeout(() => enterSoccerPractice(), 200);
      });
    });
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
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickSoccerPractice）；軌跡/墨水/虛線一併清

  // 單人沒有伺服器 → 生效場地回 constants fallback（避免殘留上一場多人下發的尺寸）
  resetSoccerField();
  bus.emit('soccer-entered', { variant: 'practice' }); // render 建場地 + 球門碰撞 + 縮小飛機
  bus.emit('soccer-view-changed', { sign: 1 }); // 窄邊定點視角：站 +z 端（藍隊起始區後方）看向遠端門
  resetPracticeDronePos();

  showSoccerPracticeHud(true);
  showSoccerFeel(true);
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
  dummyPhase = 0;
  setSolidObstacles([]);
  bus.emit('soccer-dummies-changed', { spheres: [] });
  bus.emit('soccer-view-changed', { sign: null });
  bus.emit('soccer-exited', {}); // render 清場地 / 碰撞、還原機體大小與地面
  showSoccerPracticeHud(false);
  showSoccerFeel(false);
  resetDroneState();
  bus.emit('trail-clear', {}); // 瞬移回原點後清軌跡，避免舊取樣點連到原點拉出長直線
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
  practiceState.prevX = droneState.position.x;
  practiceState.prevY = droneState.position.y;
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
  dummyPhase = 0;
  setSolidObstacles([]);
  publishPracticeDummies(!!d.dummies, false);
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
      practiceState.prevX = droneState.position.x;
      practiceState.prevY = droneState.position.y;
      practiceState.prevZ = droneState.position.z;
      stateHud(`⚽ ${d.name}：開始！`);
    }
  };
  tick();
}

// =============================================================================
// 每 tick（60Hz；main.ts 在 practiceState.active 時呼叫，取代一般關卡判定）
// =============================================================================
let dummyPhase = 0;
let dummyBumpAt = 0;

function publishPracticeDummies(on: boolean, advance: boolean): void {
  if (!on) {
    bus.emit('soccer-dummies-changed', { spheres: [] });
    return;
  }
  if (advance) dummyPhase += 0.05;
  const spheres = practiceDummySpheres(dummyPhase, activeSoccerField());
  bus.emit('soccer-dummies-changed', { spheres });
  const shield = activeSoccerField().shieldR;
  let bumped = false;
  for (const s of spheres) {
    if (pushOutOfSphere(droneState.position, droneState.velocity, s, shield)) bumped = true;
  }
  if (bumped && droneState.isFlying && performance.now() > dummyBumpAt) {
    dummyBumpAt = performance.now() + 280;
    sound('bump');
  }
}

export function tickSoccerPractice(): void {
  clampSoccerBounds();
  const d = practiceState.drill;
  if (d?.dummies && practiceState.status !== 'idle') {
    publishPracticeDummies(true, practiceState.status !== 'done');
  }
  if (practiceState.status !== 'running' || !d) {
    updatePracticeHud();
    return;
  }
  const p = droneState.position;
  const z = p.z;
  const F = activeSoccerField();
  // 遠端門在 -z。整顆護罩要離開環的出口面才算，不看機頭、不只看球心。
  const crossedFar = shieldPassesRing(
    { x: practiceState.prevX, y: practiceState.prevY, z: practiceState.prevZ },
    p,
    {
      goalZ: -F.goalZ,
      goalY: F.goalY,
      goalR: F.goalR,
      shieldR: F.shieldR,
      halfThick: F.goalTube,
      attackSign: -1,
    },
  );

  const target = d.target ?? 1;
  const scored = scorePracticeCross({
    kind: practiceCrossKind(d),
    returned: practiceState.shuttleReturned,
    crossed: crossedFar,
    z,
    count: practiceState.count,
    target,
  });
  practiceState.shuttleReturned = scored.returned;
  practiceState.count = scored.count;
  if (scored.scored) {
    sound('ring');
    if (scored.done) drillDone(false);
    else if (practiceCrossKind(d) === 'return') {
      toast(`⚽ 穿門 ${practiceState.count}${target < 99 ? `/${target}` : ''}，退回過中線`, 'success');
      stateHud('↩ 退回中線，進入自己半場');
    } else {
      toast(`⚽ 穿門 ${practiceState.count}${target < 99 ? `/${target}` : ''}`, 'success');
    }
  } else if (scored.cameBack) {
    stateHud('↗ 再去穿遠端門！');
  }
  if (
    practiceState.status === 'running' &&
    d.timeLimit &&
    (Date.now() - practiceState.startTime) / 1000 >= d.timeLimit
  ) {
    drillDone(true);
  }
  practiceState.prevX = p.x;
  practiceState.prevY = p.y;
  practiceState.prevZ = z;
  updatePracticeHud();
}

/** 場地邊界：護罩貼牆後輕微反彈（地板仍由 integrate 落地） */
function clampSoccerBounds(): void {
  const F = activeSoccerField();
  bounceSoccerWalls(
    droneState.position,
    droneState.velocity,
    { halfX: F.halfX, halfZ: F.halfZ, top: F.top },
    F.shieldR,
  );
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
    const back =
      practiceCrossKind(d) === 'return' && !practiceState.shuttleReturned ? ' ｜ 先回自己半場' : '';
    if (d.type === 'free') s += ` ｜ ${t}s`;
    else if (d.timeLimit) {
      const rem = Math.max(0, Math.ceil(d.timeLimit - (Date.now() - practiceState.startTime) / 1000));
      s += ` ｜ 穿門 ${practiceState.count}${target < 99 ? `/${target}` : ''}${back} ｜ 剩 ${rem}s`;
    } else s += ` ｜ 穿門 ${practiceState.count}/${target}${back} ｜ ${t}s`;
  } else if (practiceState.status === 'countdown') s += ' ｜ 準備…';
  else if (practiceState.status === 'done') s += ' ｜ ✓ 完成';
  setPracticeStatus(s);
}
