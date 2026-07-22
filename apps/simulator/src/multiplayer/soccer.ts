// ⚽ 多人足球對戰（3v3；伺服器權威 — apps/api/app/games/soccer.py）。
// 兩種玩法（伺服器下發 mode）：
// - 'striker' 前鋒穿門（legacy）：進球偵測在 client（我是前鋒 + armed + 跨門 + 機頭前向 +
//   1.5s 去抖）→ 送 soccer_goal、得分後 armed=false 須退回半場、前鋒彩帶。
// - 'ball' 推球進門（新）：共用球由伺服器模擬（soccer_ball ~12.5Hz 廣播 → 60Hz 內插渲染），
//   進球由伺服器判定（client 不偵測不上報）、誰都能得分、烏龍球 own=true。
// 場地資料驅動：尺寸由 soccer_go / soccer_state 的 field 下發（soccer/field.ts 生效值），
// 邊界 clamp / 進球判定 / 渲染 / 相機全依它 — 老師調場地大小，客戶端零改動。
//
// 本版新增（legacy 沒有）：機對機球體碰撞 — 本機與他人分身互推（只修正本機），
// 「撞、擋、卡位」有實感；?nocontact=1 可關（教學備用）。
// 視覺（場地 / 分身 / 彩帶 / 共用球 / 球框）在 render/soccerField.ts；HUD 在 ui/soccerHud.ts。
import type {
  SoccerServerMsg,
  SoccerPlayerState,
  SoccerSpawn,
  SoccerTeam,
  SoccerEndMsg,
  SoccerMode,
  SoccerFieldDef,
  SoccerBallState,
} from '@creafly/shared';
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { clearLevel } from '../core/level';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { sendToServer, wsState, connectToTeacher } from '../net/ws';
import {
  SOCCER_BALL_R,
  SOCCER_CONTACT_R,
  SOCCER_CONTACT_DAMP,
  soccerCameraSign,
} from '../soccer/constants';
import { activeSoccerField, setSoccerFieldFromServer, resetSoccerField } from '../soccer/field';
import { showSoccerMatchHud, setSoccerMatchTimer } from '../ui/soccerHud';

// ---- 常數（與 legacy / server 對齊）----
/** 位置上報間隔（legacy sendSoccerPos 同為 80ms ≈ 12.5Hz） */
const POS_SEND_MS = 80;
/** 進球上報去抖（legacy goalCooldown 1500ms；server 端 armed 才是權威） */
const GOAL_COOLDOWN_MS = 1500;
/** 分身位置內插係數（每 60Hz tick；與 clones.ts 的 INTERP 同語意） */
const INTERP = 0.25;
/** 機對機最小間距（兩機各一個縮放後機身半徑） */
const CONTACT_DIST = SOCCER_CONTACT_R * 2;

export type SoccerMatchStatus = 'idle' | 'countdown' | 'running' | 'done';

/** 其他玩家（分身）的邏輯狀態；pos 為 60Hz 內插後位置 — 碰撞與 render 共用同一份 */
export interface SoccerOther {
  name: string;
  emoji: string;
  team: SoccerTeam | null;
  striker: boolean;
  /** 伺服器最新位置（~12.5Hz）；null = 還沒收到過位置 */
  target: { x: number; y: number; z: number; yaw: number } | null;
  /** 內插後位置（tickSoccerMatch 推進；render/soccerField 直接取用） */
  pos: { x: number; y: number; z: number; yaw: number };
  /** 已收過至少一筆位置（未收過 → 不畫、不碰撞） */
  hasPos: boolean;
}

/** 推球模式的共用球（伺服器模擬 ~12.5Hz；客戶端 60Hz 內插 — 與分身同一套模式） */
export interface SoccerBall {
  /** 球半徑（伺服器下發，資料驅動） */
  r: number;
  /** 伺服器最新位置；null = 還沒收到過 */
  target: { x: number; y: number; z: number } | null;
  /** 內插後位置（tickSoccerMatch 推進；render/soccerField 直接取用） */
  pos: { x: number; y: number; z: number };
  /** 已收過至少一筆位置（未收過 → 不畫） */
  hasPos: boolean;
}

export const soccerState = {
  active: false,
  status: 'idle' as SoccerMatchStatus,
  /** 玩法（伺服器下發；缺省 'striker' = legacy 相容）：'ball' 推球進門 / 'striker' 前鋒穿門 */
  mode: 'striker' as SoccerMode,
  myTeam: null as SoccerTeam | null,
  myStriker: false,
  scores: { blue: 0, red: 0 } as Record<SoccerTeam, number>,
  armed: { blue: true, red: true } as Record<SoccerTeam, boolean>,
  endTime: 0,
  /** 上一 tick 的 z（穿門 = 跨越門面；striker 模式用） */
  prevZ: 0,
  /** 進球上報去抖（performance.now() 比較；striker 模式用） */
  goalCooldownUntil: 0,
  /** 機對機碰撞開關（?nocontact=1 關閉 — 教學備用） */
  contactEnabled: true,
  /** 推球模式：共用球狀態；null = 非 ball 模式或還沒收到 */
  ball: null as SoccerBall | null,
  /** 推球模式：本機是否貼近球（純視覺回饋 — render 讓球微發亮；物理在伺服器） */
  ballNear: false,
  /** playerId → 分身邏輯狀態 */
  others: new Map<string, SoccerOther>(),
};

let posTimer: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// 初始化 / 進出場
// =============================================================================
export function initSoccerMatch(): void {
  bus.on('soccer-message', ({ msg }) => handleSoccerMessage(msg));
  // 斷線重連成功 → 自動補送 soccer_join（server 重連後視為新 session）
  bus.on('ws-connected', () => {
    if (soccerState.active) sendToServer({ type: 'soccer_join' });
  });
  // 模式互斥：大亂鬥 / 足球練習接管 → 自動退出對戰
  bus.on('mode-takeover', ({ mode }) => {
    if (mode !== 'soccer-match' && soccerState.active) exitSoccerMatch();
  });
  soccerState.contactEnabled =
    new URLSearchParams(location.search).get('nocontact') !== '1';
  // 開發後門：?soccermp=1 自動進對戰（headless 驗收 / demo 用；對齊 ?arena=1）
  if (new URLSearchParams(location.search).get('soccermp') === '1') {
    setTimeout(() => enterSoccerMatch(), 800);
  }
}

export function enterSoccerMatch(): void {
  if (soccerState.active) return;
  bus.emit('mode-takeover', { mode: 'soccer-match' }); // 大亂鬥 / 練習收到後自行退出
  soccerState.active = true;
  soccerState.status = 'idle';
  soccerState.mode = 'striker'; // 伺服器 soccer_state / soccer_go 會再告知實際玩法
  soccerState.myTeam = null;
  soccerState.myStriker = false;
  soccerState.scores = { blue: 0, red: 0 };
  soccerState.armed = { blue: true, red: true };
  soccerState.endTime = 0;
  soccerState.goalCooldownUntil = 0;
  soccerState.ball = null;
  soccerState.ballNear = false;
  soccerState.others.clear();
  resetSoccerField(); // 先用 fallback 場地建場；伺服器下發 field 後再重建

  if (flags.mode !== 'manual') setMode('manual');
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickSoccerMatch）
  bus.emit('trail-clear', {});

  bus.emit('soccer-entered', { variant: 'match' }); // render 建場地 + 門框碰撞 + 縮小飛機
  bus.emit('soccer-view-changed', { sign: soccerCameraSign(null) }); // 未分隊先當藍隊視角

  // 開場站中場（legacy 相同；收到 soccer_state 的 spawns 會再瞬移到自己的出生點）
  droneState.position.x = 0;
  droneState.position.y = HOME_POSITION.y;
  droneState.position.z = 0;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.yaw = 0;
  droneState.isGrounded = true;
  droneState.isFlying = false;
  soccerState.prevZ = 0;

  showSoccerMatchHud(true);
  connectToTeacher();
  sendToServer({ type: 'soccer_join' }); // 未連線時靜默丟棄；ws-connected 後會補送
  if (posTimer) clearInterval(posTimer);
  posTimer = setInterval(sendSoccerPos, POS_SEND_MS);

  updateMatchHud();
  stateHud('⚽ 多人足球：等待老師開始…');
  toast('⚽ 進入多人足球對戰！等老師按開始', 'success');
}

export function exitSoccerMatch(): void {
  if (!soccerState.active) return;
  soccerState.active = false;
  sendToServer({ type: 'soccer_leave' });
  if (posTimer) {
    clearInterval(posTimer);
    posTimer = null;
  }
  soccerState.others.clear();
  soccerState.ball = null;
  soccerState.ballNear = false;
  resetSoccerField(); // 不把伺服器場地殘留給下一個模式（單人練習用 fallback）
  bus.emit('soccer-view-changed', { sign: null });
  bus.emit('soccer-exited', {}); // render 清場地 / 分身 / 彩帶 / 共用球（dispose）、還原機體
  showSoccerMatchHud(false);
  resetDroneState();
  stateHud('待命');
  toast('已離開足球對戰', 'success');
}

// =============================================================================
// 伺服器訊息處理（對齊 legacy handleSoccerMessage）
// =============================================================================
function handleSoccerMessage(msg: SoccerServerMsg): void {
  if (!soccerState.active) return;
  switch (msg.type) {
    case 'soccer_state':
      soccerState.status = msg.status;
      soccerState.endTime = msg.endTime || 0;
      if (msg.scores) soccerState.scores = msg.scores;
      if (msg.armed) soccerState.armed = msg.armed;
      applyServerMode(msg.mode);
      applyServerField(msg.field);
      applyServerBall(msg.ball);
      applyMyTeamRole(msg.players);
      updateSoccerPlayers(msg.players);
      // 倒數 / 待機時套用出生點（開賽前大家先站好）
      if (msg.spawns && (msg.status === 'countdown' || msg.status === 'idle')) {
        applyMySpawn(msg.spawns);
      }
      updateMatchHud();
      break;
    case 'soccer_players':
      applyMyTeamRole(msg.players);
      updateSoccerPlayers(msg.players);
      break;
    case 'soccer_countdown':
      soccerState.status = 'countdown';
      bus.emit('countdown', { n: msg.n });
      sound('beep');
      break;
    case 'soccer_go':
      soccerState.status = 'running';
      soccerState.endTime = msg.endTime || 0;
      applyServerMode(msg.mode);
      applyServerField(msg.field);
      applyServerBall(msg.ball);
      applyMyTeamRole(msg.players);
      if (msg.spawns) applyMySpawn(msg.spawns);
      bus.emit('countdown', { n: 0 }); // GO!
      sound('go');
      // 推球模式：人人都能得分（沒有前鋒角色提示）；striker 模式照舊
      stateHud(
        soccerState.mode === 'ball'
          ? '⚽ 把球推進「對方」的門！推進自家門是烏龍球喔'
          : soccerState.myStriker
            ? '🎀 你是前鋒！穿過對方的門得分！'
            : '🛡 你是防守！擋住對方前鋒！',
      );
      updateMatchHud();
      break;
    case 'soccer_ball':
      // 推球模式：共用球位置（~12.5Hz）→ 內插目標；首筆直接放到位
      applyServerBall(msg.ball);
      break;
    case 'soccer_scores':
      if (msg.status) soccerState.status = msg.status as SoccerMatchStatus;
      if (msg.endTime) soccerState.endTime = msg.endTime;
      if (msg.scores) soccerState.scores = msg.scores;
      if (msg.armed) soccerState.armed = msg.armed;
      updateMatchHud();
      break;
    case 'soccer_goal_ok':
      if (msg.scores) soccerState.scores = msg.scores;
      sound('ring');
      if (msg.own) {
        // 推球模式限定：把球推進自家門 → 得分歸對隊；by = 最後觸球（推球）者
        toast(`😅 烏龍球！${msg.byName || ''} 把球推進了自家的門`, 'error');
      } else if (msg.team === soccerState.myTeam) {
        toast(`⚽ 進球！${msg.byName || ''}`, 'success');
        // 半場重置提示只有 striker 模式有（ball 模式伺服器重擺球即可）
        if (soccerState.mode === 'striker' && soccerState.myStriker) {
          stateHud('⚽ 進球！先退回中線（過半場）才能再得分');
        }
      } else {
        toast(`😮 對方進球（${msg.byName || ''}）`);
      }
      updateMatchHud();
      break;
    case 'soccer_end':
      showMatchResult(msg);
      break;
  }
}

/** 玩法（伺服器權威；缺省 'striker' = legacy 相容）。彩帶開關由 render 逐 tick 依 mode 套用 */
function applyServerMode(mode: SoccerMode | undefined): void {
  soccerState.mode = mode === 'ball' ? 'ball' : 'striker';
  if (soccerState.mode !== 'ball') {
    soccerState.ball = null;
    soccerState.ballNear = false;
  }
}

/** 場地定義（伺服器下發 → 生效值變更時通知 render 重建場地 / 門環） */
function applyServerField(field: SoccerFieldDef | undefined): void {
  if (setSoccerFieldFromServer(field)) bus.emit('soccer-field-changed', {});
}

/** 共用球狀態（soccer_go / soccer_state 的 ball 與週期 soccer_ball 共用） */
function applyServerBall(ball: SoccerBallState | null | undefined): void {
  if (!ball || soccerState.mode !== 'ball') return;
  let b = soccerState.ball;
  if (!b) {
    b = { r: ball.r || 0.6, target: null, pos: { x: ball.x, y: ball.y, z: ball.z }, hasPos: false };
    soccerState.ball = b;
  }
  if (ball.r) b.r = ball.r;
  b.target = { x: ball.x, y: ball.y, z: ball.z };
  if (!b.hasPos) {
    b.pos = { ...b.target }; // 首筆直接放到位（避免從原點滑過去）
    b.hasPos = true;
  }
}

/** 自己屬哪一隊 / 是否前鋒（伺服器權威）→ 更新狀態 + 依隊伍切換窄邊視角 */
function applyMyTeamRole(players: SoccerPlayerState[] | undefined): void {
  const me = (players || []).find((p) => p.id === wsState.myId);
  if (!me) return;
  if (me.team && me.team !== soccerState.myTeam) {
    soccerState.myTeam = me.team;
    bus.emit('soccer-view-changed', { sign: soccerCameraSign(me.team) });
  }
  soccerState.myStriker = !!me.striker;
}

function updateSoccerPlayers(list: SoccerPlayerState[] | undefined): void {
  const seen = new Set<string>();
  for (const p of list || []) {
    if (p.id === wsState.myId) continue; // 自己不畫分身
    seen.add(p.id);
    let o = soccerState.others.get(p.id);
    if (!o) {
      o = {
        name: p.name,
        emoji: p.emoji,
        team: p.team ?? null,
        striker: !!p.striker,
        target: null,
        pos: { x: 0, y: HOME_POSITION.y, z: 0, yaw: 0 },
        hasPos: false,
      };
      soccerState.others.set(p.id, o);
    }
    // soccer_state / soccer_go 的 players 不帶位置（只有 ~12.5Hz 的 soccer_players 有）
    if (p.x !== undefined) {
      o.target = { x: p.x, y: p.y ?? HOME_POSITION.y, z: p.z ?? 0, yaw: p.yaw ?? 0 };
      if (!o.hasPos) {
        o.pos = { ...o.target }; // 首筆直接放到位（避免從原點滑過去）
        o.hasPos = true;
      }
    }
    o.team = p.team ?? null; // 隊色 / 前鋒變動由 render 逐 tick 比對套用
    o.striker = !!p.striker;
  }
  // 已離場的分身 → render 在下個 tick 依 others 差集 dispose
  for (const id of [...soccerState.others.keys()]) {
    if (!seen.has(id)) soccerState.others.delete(id);
  }
}

/** 出生點瞬移：面向場中央（站 +z 看 -z = yaw 0；站 -z 看 +z = yaw π） */
function applyMySpawn(spawns: SoccerSpawn[]): void {
  const mine = (spawns || []).find((s) => s.id === wsState.myId);
  if (!mine) return;
  droneState.position.x = mine.x;
  droneState.position.y = HOME_POSITION.y;
  droneState.position.z = mine.z;
  droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  droneState.yaw = mine.z > 0 ? 0 : Math.PI;
  droneState.isGrounded = true;
  droneState.isFlying = false;
  soccerState.prevZ = mine.z;
}

function showMatchResult(msg: SoccerEndMsg): void {
  const s = msg.scores || soccerState.scores;
  soccerState.status = 'done';
  // 老師手動停止 / 切關（智能停止）→ 只提示、不顯示勝負結算（time up 才有完整結算）
  if (msg.reason === 'teacher_stop' || msg.reason === 'level_switch') {
    stateHud('🏁 比賽結束');
    toast('🛑 老師結束了本場比賽', 'warning');
    updateMatchHud();
    return;
  }
  stateHud('🏁 足球結束！');
  const txt =
    msg.winner === 'blue'
      ? `🔵 藍隊勝！${s.blue} : ${s.red}`
      : msg.winner === 'red'
        ? `🔴 紅隊勝！${s.blue} : ${s.red}`
        : `🤝 平手 ${s.blue} : ${s.red}`;
  toast(txt, 'success');
  sound('complete');
  updateMatchHud();
}

// =============================================================================
// 每 tick（60Hz；main.ts 在 soccerState.active 時呼叫，取代一般關卡判定）
// =============================================================================
export function tickSoccerMatch(): void {
  clampMatchBounds();
  interpolateOthers();
  interpolateBall();
  if (soccerState.contactEnabled) resolveDroneContacts();
  detectGoal(); // striker 模式限定（ball 模式進球由伺服器判定，client 不上報）
  soccerState.prevZ = droneState.position.z;
  updateMatchHud();
}

/** 場地邊界 clamp（依伺服器下發的生效場地；以球形保護框半徑內縮） */
function clampMatchBounds(): void {
  const F = activeSoccerField();
  const p = droneState.position;
  const v = droneState.velocity;
  const m = SOCCER_BALL_R;
  if (p.x > F.halfX - m) { p.x = F.halfX - m; if (v.x > 0) v.x = 0; }
  else if (p.x < -F.halfX + m) { p.x = -F.halfX + m; if (v.x < 0) v.x = 0; }
  if (p.z > F.halfZ - m) { p.z = F.halfZ - m; if (v.z > 0) v.z = 0; }
  else if (p.z < -F.halfZ + m) { p.z = -F.halfZ + m; if (v.z < 0) v.z = 0; }
  if (p.y > F.top - m) { p.y = F.top - m; if (v.y > 0) v.y = 0; }
}

/**
 * 推球模式：共用球 60Hz 內插（沿用分身內插模式）＋「貼近球」視覺回饋旗標。
 * 物理（推球 / 反彈 / 進門）全在伺服器；本機只算距離讓球微發亮，學生知道碰到了。
 */
function interpolateBall(): void {
  const b = soccerState.ball;
  if (!b || !b.hasPos || !b.target) {
    soccerState.ballNear = false;
    return;
  }
  b.pos.x += (b.target.x - b.pos.x) * INTERP;
  b.pos.y += (b.target.y - b.pos.y) * INTERP;
  b.pos.z += (b.target.z - b.pos.z) * INTERP;
  const p = droneState.position;
  const d = Math.hypot(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z);
  soccerState.ballNear = d < b.r + SOCCER_BALL_R + 0.5; // 球框半徑 + 球半徑 + 一點餘裕
}

/** 內插他人分身位置（60Hz 固定 tick × 0.25 = legacy 每幀 @60fps 等價） */
function interpolateOthers(): void {
  for (const o of soccerState.others.values()) {
    if (!o.target || !o.hasPos) continue;
    o.pos.x += (o.target.x - o.pos.x) * INTERP;
    o.pos.y += (o.target.y - o.pos.y) * INTERP;
    o.pos.z += (o.target.z - o.pos.z) * INTERP;
    o.pos.yaw = o.target.yaw;
  }
}

/**
 * 機對機球體碰撞（本版新增）：本機與每個分身做球對球推出。
 * 只修正「本機」— 位置權威仍是各自 client（對方的 client 也只推自己），
 * 兩邊各退一步後自然分開；推出後速度衰減 + 移除撞入分量 → 撞到人像撞到牆會被「擋」住。
 */
function resolveDroneContacts(): void {
  const p = droneState.position;
  const v = droneState.velocity;
  for (const o of soccerState.others.values()) {
    if (!o.hasPos) continue;
    let dx = p.x - o.pos.x;
    let dy = p.y - o.pos.y;
    let dz = p.z - o.pos.z;
    let d = Math.hypot(dx, dy, dz);
    if (d >= CONTACT_DIST) continue;
    if (d < 1e-6) {
      // 完全重疊（出生點瞬移撞到人）：往 +x 推開，避免除以零
      dx = 1; dy = 0; dz = 0; d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    // 推出到最小間距（本機承擔全部推出量；對方 client 那邊也會推他自己）
    p.x = o.pos.x + nx * CONTACT_DIST;
    p.y = o.pos.y + ny * CONTACT_DIST;
    p.z = o.pos.z + nz * CONTACT_DIST;
    // 移除「往對方撞入」的速度分量（v·n < 0 = 正在靠近），再整體衰減 → 有「撞上去被擋」的手感
    const vDotN = v.x * nx + v.y * ny + v.z * nz;
    if (vDotN < 0) {
      v.x -= vDotN * nx;
      v.y -= vDotN * ny;
      v.z -= vDotN * nz;
    }
    v.x *= SOCCER_CONTACT_DAMP;
    v.y *= SOCCER_CONTACT_DAMP;
    v.z *= SOCCER_CONTACT_DAMP;
  }
}

/**
 * 前鋒穿對方門偵測 → 上報 server（striker 模式限定；server 才計分，驗證條件與 soccer.py 一致）：
 * 我是前鋒、比賽進行中、該隊 armed、跨越對方門面、機頭朝進攻方向、在門環半徑內。
 * 門面 / 門環尺寸依伺服器下發的生效場地。ball 模式不在此偵測、也不發 soccer_goal —
 * 球穿門由伺服器（球的權威模擬端）判定。
 * 上報前先補送一筆最新位置 — server 以「最後回報座標」驗證（容差 ±1.0m），
 * 避免 80ms 前的舊座標讓合法進球被拒。
 */
function detectGoal(): void {
  if (soccerState.mode !== 'striker') return;
  if (soccerState.status !== 'running' || !soccerState.myStriker || !soccerState.myTeam) return;
  const F = activeSoccerField();
  const team = soccerState.myTeam;
  const attackZ = team === 'blue' ? F.goalZ : -F.goalZ; // 藍攻 +z 門、紅攻 -z 門
  const p = droneState.position;
  const z = p.z;
  const pz = soccerState.prevZ;
  const fwdZ = -Math.cos(droneState.yaw); // 機頭世界前向的 z 分量（>0 朝 +z）
  const crossing =
    team === 'blue'
      ? pz < attackZ && z >= attackZ && fwdZ > 0 // 藍：朝 +z 穿過 +z 門
      : pz > attackZ && z <= attackZ && fwdZ < 0; // 紅：朝 -z 穿過 -z 門
  const inRing = Math.abs(p.x) < F.goalR && Math.abs(p.y - F.goalY) < F.goalR;
  const armed = soccerState.armed[team] !== false;
  if (crossing && inRing && armed && performance.now() > soccerState.goalCooldownUntil) {
    soccerState.goalCooldownUntil = performance.now() + GOAL_COOLDOWN_MS;
    sendSoccerPos();
    sendToServer({ type: 'soccer_goal' });
  }
}

/**
 * 計分 HUD（比分 / 倒數 / 我的隊伍角色 / 半場重置提示）— 對齊 legacy updateSoccerMatchHud。
 * ball 模式：誰都能得分 → 不顯示「前鋒 / 防守」角色與半場重置提示；比分照舊。
 */
function updateMatchHud(): void {
  const s = soccerState.scores;
  let t = '等待開始';
  if (soccerState.status === 'running' && soccerState.endTime) {
    const rem = Math.max(0, Math.ceil((soccerState.endTime - Date.now()) / 1000));
    t = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`;
  } else if (soccerState.status === 'countdown') t = '3-2-1…';
  else if (soccerState.status === 'done') t = '結束';
  const meTeam =
    soccerState.myTeam === 'red' ? '紅隊' : soccerState.myTeam === 'blue' ? '藍隊' : '—';
  const isStrikerMode = soccerState.mode === 'striker';
  const role = isStrikerMode ? (soccerState.myStriker ? '・前鋒' : '・防守') : '';
  // 半場重置提示：striker 模式限定 — 自隊 armed=false（剛得分）→ 提醒前鋒退回中線
  const needBack =
    isStrikerMode &&
    !!soccerState.myTeam &&
    soccerState.armed[soccerState.myTeam] === false &&
    soccerState.status === 'running';
  setSoccerMatchTimer(
    `藍 ${s.blue} : ${s.red} 紅 ｜ ${t} ｜ 我：${meTeam}${role}${needBack ? ' ｜ 先退回半場' : ''}`,
  );
}

/** 80ms 位置上報（座標 toFixed 減量 — 與 legacy 線上格式一致） */
function sendSoccerPos(): void {
  if (!soccerState.active) return;
  sendToServer({
    type: 'soccer_pos',
    x: +droneState.position.x.toFixed(2),
    y: +droneState.position.y.toFixed(2),
    z: +droneState.position.z.toFixed(2),
    yaw: +droneState.yaw.toFixed(3),
  });
}
