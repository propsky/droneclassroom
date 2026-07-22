// 大亂鬥 Arena（多人即時搶氣球 / 鬼抓人）— 狀態機 + 伺服器訊息處理。
// 行為對齊 legacy main.js §15；伺服器權威（計分 / 抓捕 / 氣球重生都由 server 仲裁），
// 本模組只維護本地狀態、回報位置（80ms）與氣球碰撞候選（arena_pop）。
// 視覺（他人分身 / 名牌 / 氣球 / 光環）在 render/clones.ts；HUD 在 ui/arenaHud.ts。
import type { ArenaPlayerState, ArenaRole, ArenaServerMsg, ArenaEndMsg } from '@creafly/shared';
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { setSolidObstacles, type SolidObstacle } from '../core/physics';
import { clearLevel } from '../core/level';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { sendToServer, wsState, connectToTeacher } from '../net/ws';
import {
  initArenaHud,
  showArenaHud,
  setArenaTimer,
  setArenaFieldLabel,
  updateArenaScoreboard,
} from '../ui/arenaHud';

// ---- 常數（與 legacy / server 對齊） ----
/** 鬼抓人：鬼的推力倍率（掛在 input→physics 的縫；見 main.ts applyManualControls） */
export const GHOST_SPEED = 1.5;
/** 鬼的抓捕範圍（與 server ARENA_CATCH_DIST 一致；光環半徑也用它） */
export const GHOST_CATCH_R = 2.2;
/** 場地邊界（飛不出去；與 legacy ARENA_BOUND 相同） */
export const ARENA_BOUND = { x: 24, z: 24, yTop: 14 } as const;
/** 位置上報間隔（legacy sendArenaPos 同為 80ms ≈ 12.5Hz） */
const POS_SEND_MS = 80;
/** 氣球「撞到」判定距離（與 legacy arenaTick 相同） */
const BALLOON_POP_DIST = 1.4;
/** grid 場地的紫色掩體方塊（與 legacy spawnArenaObstacles 同一組座標；半邊長 1.25） */
export const ARENA_OBSTACLE_DEFS: readonly (readonly [number, number, number])[] = [
  [10, 3, -8], [-10, 3, -8], [8, 5, 8], [-8, 5, 8],
  [0, 4, -15], [0, 6, 12], [14, 4, 0], [-14, 4, 0],
];
export const ARENA_OBSTACLE_HALF = 1.25;

export type ArenaStatus = 'idle' | 'countdown' | 'running' | 'ended';
export type ArenaMode = 'balloon' | 'tag';

/** 其他玩家（分身）的邏輯狀態；內插後的實際位置在 render/clones.ts 的 mesh 上 */
export interface ArenaOther {
  name: string;
  emoji: string;
  role: Exclude<ArenaRole, null>;
  stunned: boolean;
  invincible: boolean;
  /** 伺服器最新位置（~12Hz）；null = 還沒收到過位置 */
  target: { x: number; y: number; z: number; yaw: number } | null;
}

export const arenaState = {
  active: false,
  status: 'idle' as ArenaStatus,
  mode: 'balloon' as ArenaMode,
  field: 'grid' as 'grid' | 'playground',
  myRole: 'runner' as Exclude<ArenaRole, null>,
  /** 鬼抓人：我是否暈眩中（暫時，不淘汰） */
  stunned: false,
  /** 暈眩解除時間戳（鎖操控用；Date.now() 比較） */
  stunUntil: 0,
  /** 無敵解除時間戳（涵蓋暈眩＋復活後的跑走時間，鬼抓不到） */
  invincibleUntil: 0,
  endTime: 0,
  /** id → 位置（存資料非 mesh；碰撞判定用這份，render 只負責畫） */
  balloons: new Map<number, { x: number; y: number; z: number }>(),
  /** 已送出 arena_pop、等 server 仲裁的氣球 id */
  pendingPop: new Set<number>(),
  /** playerId → 分身邏輯狀態 */
  others: new Map<string, ArenaOther>(),
};

let posTimer: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// 初始化 / 進出場
// =============================================================================
export function initArena(): void {
  bus.on('arena-message', ({ msg }) => handleArenaMessage(msg));
  // 斷線重連成功 → 自動補送 arena_join（server 重連後視為新 session）
  bus.on('ws-connected', () => {
    if (arenaState.active) sendToServer({ type: 'arena_join' });
  });
  // 模式互斥：足球（練習 / 對戰）接管時自動退出大亂鬥（server 端 soccer_join 也會互斥）
  bus.on('mode-takeover', ({ mode }) => {
    if (mode !== 'arena' && arenaState.active) exitArena();
  });
  initArenaHud(() => (arenaState.active ? exitArena() : enterArena()));

  // 開發後門：?arena=1 自動進場（headless 驗收 / demo 用；對齊 ?autologin）
  if (new URLSearchParams(location.search).get('arena') === '1') {
    setTimeout(() => enterArena(), 800);
  }
}

export function enterArena(): void {
  if (arenaState.active) return;
  bus.emit('mode-takeover', { mode: 'arena' }); // 足球模式收到後自行退出
  arenaState.active = true;
  arenaState.status = 'idle';
  arenaState.mode = 'balloon';
  arenaState.field = 'grid';
  setMyRole('runner', false);
  arenaState.stunUntil = 0;
  arenaState.invincibleUntil = 0;
  arenaState.endTime = 0;
  arenaState.balloons.clear();
  arenaState.pendingPop.clear();
  arenaState.others.clear();

  if (flags.mode !== 'manual') setMode('manual');
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickArena）
  resetDroneState();
  bus.emit('trail-clear', {});

  // grid 場地掩體（實心，交給既有 AABB 碰撞）
  setSolidObstacles(
    ARENA_OBSTACLE_DEFS.map(([x, y, z]): SolidObstacle => ({ x, y, z, half: ARENA_OBSTACLE_HALF })),
  );

  bus.emit('arena-entered', {}); // render 建掩體視覺、UI 切 HUD
  showArenaHud(true);
  setArenaFieldLabel(arenaState.field);
  setArenaTimer('等待開始');

  connectToTeacher();
  sendToServer({ type: 'arena_join' }); // 未連線時靜默丟棄；ws-connected 後會補送
  if (posTimer) clearInterval(posTimer);
  posTimer = setInterval(sendArenaPos, POS_SEND_MS);

  stateHud('🏟️ 大亂鬥：等待老師開始…');
  toast('🏟️ 進入大亂鬥！等老師按開始', 'success');
}

export function exitArena(): void {
  if (!arenaState.active) return;
  arenaState.active = false;
  flags.multiplayerLock = false;
  sendToServer({ type: 'arena_leave' });
  if (posTimer) {
    clearInterval(posTimer);
    posTimer = null;
  }
  arenaState.balloons.clear();
  arenaState.pendingPop.clear();
  arenaState.others.clear();
  setMyRole('runner', false); // render 會在 arena-exited 還原機體大小 / 透明度
  arenaState.stunUntil = 0;
  arenaState.invincibleUntil = 0;
  setSolidObstacles([]);
  bus.emit('arena-exited', {}); // render 清分身 / 氣球 / 光環 / 掩體（dispose）
  showArenaHud(false);
  resetDroneState();
  stateHud('待命');
  toast('已離開大亂鬥 — 從關卡選單挑一關繼續飛', 'success');
}

// =============================================================================
// 伺服器訊息處理（對齊 legacy handleArenaMessage）
// =============================================================================
function handleArenaMessage(msg: ArenaServerMsg): void {
  if (!arenaState.active) return;
  switch (msg.type) {
    case 'arena_state':
      arenaState.status = msg.status;
      arenaState.endTime = msg.endTime || 0;
      if (msg.mode) arenaState.mode = msg.mode;
      if (msg.field) setArenaField(msg.field);
      arenaState.balloons.clear();
      arenaState.pendingPop.clear();
      (msg.balloons || []).forEach((b) => arenaState.balloons.set(b.id, { x: b.x, y: b.y, z: b.z }));
      updateArenaScoreboard(msg.players || [], arenaState.mode, wsState.myId);
      // 倒數開始時，移到自己的出生點（避免大家疊在原點）
      if (msg.status === 'countdown' && msg.spawns) applyMySpawn(msg.spawns);
      break;
    case 'arena_players':
      updateArenaPlayers(msg.players || []);
      break;
    case 'arena_balloon':
      if (msg.alive) {
        arenaState.balloons.set(msg.id, { x: msg.x ?? 0, y: msg.y ?? 0, z: msg.z ?? 0 });
      } else {
        arenaState.balloons.delete(msg.id);
        // 是「我」戳破的（在 pendingPop 裡）→ 播音效
        if (arenaState.pendingPop.has(msg.id)) sound('pop');
      }
      arenaState.pendingPop.delete(msg.id);
      break;
    case 'arena_countdown':
      arenaState.status = 'countdown';
      bus.emit('countdown', { n: msg.n });
      sound('beep');
      break;
    case 'arena_go': {
      arenaState.status = 'running';
      arenaState.endTime = msg.endTime;
      if (msg.mode) arenaState.mode = msg.mode;
      if (msg.field) setArenaField(msg.field);
      if (msg.spawns) applyMySpawn(msg.spawns); // 後備：確保開賽時在自己出生點
      // 套用自己的角色（鬼抓人）
      if (msg.players) {
        const me = msg.players.find((p) => p.id === wsState.myId);
        if (me) setMyRole(me.role ?? 'runner', !!me.stunned);
        updateArenaPlayers(msg.players);
      }
      bus.emit('countdown', { n: 0 }); // GO!
      sound('go');
      if (arenaState.mode === 'tag') {
        if (arenaState.myRole === 'ghost') {
          stateHud('👻 你是鬼！去抓人！');
          toast('👻 你是鬼！撞到跑者就能抓到，抓越多分越高！', 'error');
        } else {
          stateHud('🏃 快逃！被抓到只會暈眩一下，很快能繼續飛');
          toast('🏃 你是逃跑者！被抓到不會出局，暈幾秒後自動復活～', 'success');
        }
      } else {
        stateHud('🏟️ 開搶！');
        toast('🏟️ 開始搶氣球！', 'success');
      }
      break;
    }
    case 'arena_caught':
      // 有人被抓到（暫時暈眩，不是淘汰）
      if (msg.id === wsState.myId) {
        setMyRole(arenaState.myRole, true);
        stateHud('😵 被抓到了！暈眩中，馬上復活…');
        toast(`😵 被 ${msg.byName || '鬼'} 抓到了！`, 'error');
        sound('bump');
      } else {
        const o = arenaState.others.get(msg.id);
        if (o) o.stunned = true;
      }
      break;
    case 'arena_respawn':
      // 只有被抓到的自己會收到：暈眩鎖操作（見 tickArena → flags.multiplayerLock）
      // ＋傳送回出生點；暈眩結束後還有一段無敵（clones.ts 逐 tick 閃爍提示）
      arenaState.stunUntil = Date.now() + (msg.stunMs || 0);
      arenaState.invincibleUntil = Date.now() + (msg.stunMs || 0) + (msg.invincibleMs || 0);
      droneState.position.x = msg.x;
      droneState.position.y = HOME_POSITION.y;
      droneState.position.z = msg.z;
      droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
      droneState.isGrounded = true;
      droneState.isFlying = false;
      break;
    case 'arena_scores':
      if (msg.status) arenaState.status = msg.status as ArenaStatus;
      if (msg.endTime) arenaState.endTime = msg.endTime;
      if (msg.field) setArenaField(msg.field);
      updateArenaScoreboard(msg.scores || [], arenaState.mode, wsState.myId);
      break;
    case 'arena_end':
      arenaState.status = 'ended';
      if (msg.players) updateArenaPlayers(msg.players);
      showArenaResult(msg);
      break;
  }
}

function updateArenaPlayers(list: ArenaPlayerState[]): void {
  const seen = new Set<string>();
  for (const p of list) {
    if (p.id === wsState.myId) {
      // 更新自己的角色 / 暈眩狀態（伺服器權威）
      if (p.role !== undefined) setMyRole(p.role ?? 'runner', !!p.stunned);
      continue;
    }
    seen.add(p.id);
    let o = arenaState.others.get(p.id);
    if (!o) {
      o = { name: p.name, emoji: p.emoji, role: 'runner', stunned: false, invincible: false, target: null };
      arenaState.others.set(p.id, o);
    }
    // arena_state / arena_go 的 players 不帶位置（只有 ~12Hz 的 arena_players 有）
    if (p.x !== undefined) o.target = { x: p.x, y: p.y ?? 0.4, z: p.z ?? 0, yaw: p.yaw ?? 0 };
    o.invincible = !!p.invincible; // 無敵閃爍交給 clones.ts 逐 tick 處理
    o.role = p.role ?? 'runner';
    o.stunned = !!p.stunned;
  }
  // 已離場的分身 → 由 clones.ts 在下個 tick 依 others 差集 dispose
  for (const id of [...arenaState.others.keys()]) {
    if (!seen.has(id)) arenaState.others.delete(id);
  }
}

/** 設定自己的角色 / 暈眩（機體外觀縮放 / 透明度由 clones.ts 逐 tick 套用） */
function setMyRole(role: Exclude<ArenaRole, null>, stunned: boolean): void {
  arenaState.myRole = role;
  arenaState.stunned = stunned;
}

function showArenaResult(msg: ArenaEndMsg): void {
  // 老師手動停止 / 切關（智能停止）→ 只提示、不顯示勝負結算（time_up 才有完整結算）
  if (msg.reason === 'teacher_stop' || msg.reason === 'level_switch') {
    stateHud('🏁 比賽結束');
    toast('🛑 老師結束了本場比賽', 'warning');
    return;
  }
  stateHud('🏁 大亂鬥結束！');
  if (msg.mode === 'tag') {
    // 隊伍勝負：鬼隊總抓捕數有沒有達門檻（見 legacy server.js ARENA_TAG_WIN_MULT）
    if (msg.winner === 'ghosts') toast('👻 鬼隊獲勝！抓到超多人～', 'error');
    else toast('🏃 跑者隊獲勝！成功撐過鬼的追擊！', 'success');
    // 個人榮譽：抓鬼王（抓最多的鬼）＋逃脫達人（被抓最少的跑者），跟隊伍輸贏無關
    const ranking = msg.ranking || [];
    const topGhost = ranking
      .filter((r) => r.role === 'ghost')
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const topRunner = ranking
      .filter((r) => r.role === 'runner')
      .sort((a, b) => (a.caughtCount || 0) - (b.caughtCount || 0))[0];
    const parts: string[] = [];
    if (topGhost) parts.push(`👻 抓鬼王：${topGhost.emoji || ''}${topGhost.name}（抓到 ${topGhost.score || 0} 次）`);
    if (topRunner) parts.push(`🏃 逃脫達人：${topRunner.emoji || ''}${topRunner.name}（只被抓 ${topRunner.caughtCount || 0} 次）`);
    if (parts.length) setTimeout(() => toast(parts.join('｜'), 'success'), 1800);
  } else {
    const top = msg.ranking?.[0];
    toast(top ? `🏆 冠軍：${top.emoji || ''}${top.name}（${top.score} 顆）` : '🏁 結束', 'success');
  }
  sound('complete');
}

function applyMySpawn(spawns: { id: string; x: number; z: number }[]): void {
  const mine = spawns.find((s) => s.id === wsState.myId);
  if (!mine) return;
  droneState.position.x = mine.x;
  droneState.position.y = HOME_POSITION.y;
  droneState.position.z = mine.z;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.isGrounded = true;
  droneState.isFlying = false;
  droneState.yaw = Math.atan2(mine.x, mine.z); // 機頭朝場地中心
}

/** 由伺服器決定的「場地」（全場一致）：同時切視覺與碰撞（render/playground 訂閱處理） */
function setArenaField(field: 'grid' | 'playground'): void {
  const next = field === 'playground' ? 'playground' : 'grid';
  const changed = next !== arenaState.field;
  arenaState.field = next;
  // 只在真的切換時發事件（arena_state / arena_go / arena_scores 都帶 field，避免重複觸發）
  if (changed) bus.emit('arena-field-changed', { field: next });
  setArenaFieldLabel(arenaState.field);
}

// =============================================================================
// 每 tick（60Hz；main.ts 在 arena.active 時呼叫，取代一般關卡判定）
// =============================================================================
/** 鬼抓人：我是鬼且未暈眩 → 推力 ×GHOST_SPEED（main.ts 傳給 applyManualControls） */
export function arenaThrustScale(): number {
  return arenaState.active &&
    arenaState.mode === 'tag' &&
    arenaState.myRole === 'ghost' &&
    !arenaState.stunned
    ? GHOST_SPEED
    : 1;
}

/** 我目前是否在無敵時間（跑者專屬；暈眩中不算 — 對齊 legacy myInvincibleNow） */
export function myInvincibleNow(now = Date.now()): boolean {
  return (
    arenaState.mode === 'tag' &&
    arenaState.status === 'running' &&
    !arenaState.stunned &&
    arenaState.invincibleUntil > now
  );
}

export function tickArena(): void {
  const now = Date.now();
  // 鎖操控：大亂鬥倒數中 / 鬼抓人暈眩中（時間到自動解除）
  flags.multiplayerLock =
    arenaState.status === 'countdown' ||
    (arenaState.mode === 'tag' && arenaState.stunUntil > now);

  clampArenaBounds();

  // 搶氣球（撞到 → 回報 server 仲裁；不自己扣分）
  if (arenaState.status === 'running') {
    const p = droneState.position;
    for (const [id, b] of arenaState.balloons) {
      if (arenaState.pendingPop.has(id)) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < BALLOON_POP_DIST) {
        arenaState.pendingPop.add(id);
        sendToServer({ type: 'arena_pop', id });
      }
    }
  }

  updateArenaTimerHud(now);
}

/** 場地邊界 clamp（飛不出去；地板由既有 integrate 的 ground clamp 處理） */
function clampArenaBounds(): void {
  const p = droneState.position;
  const v = droneState.velocity;
  if (p.x > ARENA_BOUND.x) { p.x = ARENA_BOUND.x; if (v.x > 0) v.x = 0; }
  else if (p.x < -ARENA_BOUND.x) { p.x = -ARENA_BOUND.x; if (v.x < 0) v.x = 0; }
  if (p.z > ARENA_BOUND.z) { p.z = ARENA_BOUND.z; if (v.z > 0) v.z = 0; }
  else if (p.z < -ARENA_BOUND.z) { p.z = -ARENA_BOUND.z; if (v.z < 0) v.z = 0; }
  if (p.y > ARENA_BOUND.yTop) { p.y = ARENA_BOUND.yTop; if (v.y > 0) v.y = 0; }
}

/** 計時 HUD（鬼抓人多顯示場上人數 + 我的角色）— 對齊 legacy arenaTick 尾段 */
function updateArenaTimerHud(now: number): void {
  let t: string;
  if (arenaState.status === 'running' && arenaState.endTime) {
    const rem = Math.max(0, Math.ceil((arenaState.endTime - now) / 1000));
    t = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
  } else if (arenaState.status === 'ended') t = '結束';
  else t = '等待開始';
  if (arenaState.mode === 'tag' && arenaState.status === 'running') {
    let active = 0;
    arenaState.others.forEach((o) => {
      if (o.role === 'runner' && !o.stunned) active++;
    });
    if (arenaState.myRole === 'runner' && !arenaState.stunned) active++;
    const me = arenaState.stunned
      ? '😵暈眩中'
      : myInvincibleNow(now)
        ? '✨無敵中'
        : arenaState.myRole === 'ghost'
          ? '👻鬼'
          : '🏃逃';
    t += ` ｜ 🏃場上 ${active} ｜ ${me}`;
  }
  setArenaTimer(t);
}

/** 80ms 位置上報（座標 toFixed 減量 — 與 legacy 線上格式一致） */
function sendArenaPos(): void {
  if (!arenaState.active) return;
  sendToServer({
    type: 'arena_pos',
    x: +droneState.position.x.toFixed(2),
    y: +droneState.position.y.toFixed(2),
    z: +droneState.position.z.toFixed(2),
    yaw: +droneState.yaw.toFixed(3),
  });
}
