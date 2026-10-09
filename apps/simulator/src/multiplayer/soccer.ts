// ⚽ 多人足球對戰（伺服器權威 — apps/api/app/games/soccer.py）。
// 每隊人數上限：F9A-A 5 人、F9A-B 3 人。
// 兩種玩法（伺服器下發 mode）：
// - 'striker' 前鋒穿門：客戶端用護罩後緣 + 行進方向偵測後送 soccer_goal（1.5s 去抖）。
//   伺服器依位置軌跡重算，沒有整顆穿過就不計分。得分後該隊全員先回己方半場。
// - 'ball' 推球進門（新）：共用球由伺服器模擬（soccer_ball ~12.5Hz 廣播 → 60Hz 內插渲染），
//   進球由伺服器判定（client 不偵測不上報）、誰都能得分、烏龍球 own=true。
// 場地資料驅動：尺寸由 soccer_go / soccer_state 的 field 下發（soccer/field.ts 生效值），
// 邊界 clamp / 進球判定 / 渲染 / 相機全依它 — 老師調場地大小，客戶端零改動。
//
// 機對機碰撞對齊護罩半徑：推出到不穿模，並加互推反作用；?nocontact=1 可關。
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
  SoccerMatchMeta,
  SoccerFoulReason,
} from '@creafly/shared';
import { droneState, resetDroneState, HOME_POSITION, flags } from '../core/droneState';
import { clearLevel } from '../core/level';
import { setMode } from '../core/program';
import { bus, toast, sound, stateHud } from '../core/events';
import { sendToServer, wsState, connectToTeacher } from '../net/ws';
import { soccerCameraSign } from '../soccer/constants';
import { shieldPassesRing } from '../soccer/crossing';
import {
  SOCCER_IMPACT_TICK,
  bounceSoccerWalls,
  resolveShieldContact,
} from '../soccer/contact';
import { getSoccerFeel, SOCCER_FEELS } from '../soccer/flightFeel';
import { activeSoccerField, setSoccerFieldFromServer, resetSoccerField } from '../soccer/field';
import { showSoccerMatchHud, setSoccerMatchTimer, formatSoccerMatchLine, showSoccerFeel } from '../ui/soccerHud';

// ---- 常數（與 legacy / server 對齊）----
/** 位置上報間隔（legacy sendSoccerPos 同為 80ms ≈ 12.5Hz） */
const POS_SEND_MS = 80;
/** 進球上報去抖（legacy goalCooldown 1500ms；server 端 armed 才是權威） */
const GOAL_COOLDOWN_MS = 1500;
/** 分身位置內插係數（每 60Hz tick；與 clones.ts 的 INTERP 同語意） */
const INTERP = 0.25;
export type SoccerMatchStatus =
  | 'idle'
  | 'countdown'
  | 'running'
  | 'break'
  | 'golden'
  | 'pk'
  | 'penalty'
  | 'done';

export interface SoccerPenaltyView {
  reason: SoccerFoulReason;
  attackTeam: SoccerTeam;
  defendTeam: SoccerTeam;
  strikerId: string | null;
  defenderId: string | null;
  byName: string;
}

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
  /** 三局兩勝進度（伺服器 match；缺省當第 0 局） */
  period: 0,
  sets: { blue: 0, red: 0 } as Record<SoccerTeam, number>,
  pkScores: { blue: 0, red: 0 } as Record<SoccerTeam, number>,
  pkTurn: null as SoccerTeam | null,
  pkRound: 0,
  pkShooterId: null as string | null,
  pkDefenderId: null as string | null,
  /** 最近一次犯規還沒被下一則比分清掉 */
  foulNote: false,
  foulReason: null as SoccerFoulReason | null,
  /** 起槳後、GO 之前 */
  motorsArmed: false,
  penalty: null as SoccerPenaltyView | null,
  myCard: null as 'yellow' | 'red' | null,
  disabled: false,
  crashSent: false,
  /** 上一 tick 的位置（穿環看整段位移，不只 z） */
  prevX: 0,
  prevY: HOME_POSITION.y,
  lastBumpAt: 0,
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
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'k' && e.key !== 'K') return;
    if (!soccerState.active || soccerState.status !== 'pk') return;
    if (soccerState.disabled || soccerState.pkTurn !== soccerState.myTeam) return;
    sendToServer({ type: 'soccer_pk_claim' });
  });
  // 開發後門：?soccermp=1 自動進對戰（headless 驗收 / demo 用；對齊 ?arena=1）
  const params = new URLSearchParams(location.search);
  if (params.get('soccermp') === '1') {
    setTimeout(() => enterSoccerMatch(), 800);
  }
  // ?phase2preview=arm|penalty|card 把真實 HUD／倒數疊層走一輪（沒有老師伺服器時截圖用）。
  // 等關卡清單載完再進場，避免預設關的計時器晚到、蓋掉對戰列。
  const preview = params.get('phase2preview');
  if (preview === 'arm' || preview === 'penalty' || preview === 'card') {
    const offReady = bus.on('levels-ready', () => {
      offReady();
      const offLoaded = bus.on('level-loaded', () => {
        offLoaded();
        setTimeout(() => previewPhase2(preview), 200);
      });
    });
  }
}

function previewPhase2(kind: 'arm' | 'penalty' | 'card'): void {
  enterSoccerMatch();
  soccerState.myTeam = 'blue';
  soccerState.myStriker = true;
  soccerState.period = 1;
  if (kind === 'arm') {
    soccerState.status = 'countdown';
    soccerState.motorsArmed = true;
    syncSoccerLock();
    bus.emit('countdown', { n: 3 });
    stateHud('起槳！倒數結束前不要移動');
  } else if (kind === 'penalty') {
    soccerState.status = 'penalty';
    soccerState.endTime = Date.now() + 10_000;
    soccerState.foulNote = true;
    soccerState.foulReason = 'false_start';
    soccerState.penalty = {
      reason: 'false_start',
      attackTeam: 'red',
      defendTeam: 'blue',
      strikerId: 'other',
      defenderId: wsState.myId,
      byName: '預覽',
    };
    syncSoccerLock();
    stateHud('🛡 罰球：你是這記的防守');
  } else {
    soccerState.status = 'running';
    soccerState.endTime = Date.now() + 180_000;
    soccerState.myCard = 'yellow';
    stateHud('黃牌：本局出場');
  }
  updateMatchHud();
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
  soccerState.period = 0;
  soccerState.sets = { blue: 0, red: 0 };
  soccerState.pkScores = { blue: 0, red: 0 };
  soccerState.pkTurn = null;
  soccerState.pkRound = 0;
  soccerState.pkShooterId = null;
  soccerState.pkDefenderId = null;
  soccerState.foulNote = false;
  soccerState.foulReason = null;
  soccerState.motorsArmed = false;
  soccerState.penalty = null;
  soccerState.myCard = null;
  soccerState.disabled = false;
  soccerState.crashSent = false;
  soccerState.others.clear();
  resetSoccerField(); // 先用 fallback 場地建場；伺服器下發 field 後再重建

  if (flags.mode !== 'manual') setMode('manual');
  clearLevel(); // 一般關卡判定 / 物件 / HUD 停用（main.ts 依 active 改跑 tickSoccerMatch）；軌跡/墨水/虛線一併清

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
  showSoccerFeel(true);
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
  showSoccerFeel(false);
  flags.multiplayerLock = false;
  resetDroneState();
  bus.emit('trail-clear', {}); // 瞬移回原點後清軌跡，避免舊取樣點連到原點拉出長直線
  stateHud('待命');
  toast('已離開足球對戰', 'success');
}

// =============================================================================
// 伺服器訊息處理（對齊 legacy handleSoccerMessage）
// =============================================================================
function handleSoccerMessage(msg: SoccerServerMsg): void {
  if (!soccerState.active) return;
  switch (msg.type) {
    case 'soccer_state': {
      const prev = soccerState.status;
      soccerState.status = msg.status;
      soccerState.endTime = msg.endTime || 0;
      if (msg.scores) soccerState.scores = msg.scores;
      if (msg.armed) soccerState.armed = msg.armed;
      applyMatch(msg.match);
      applyServerMode(msg.mode);
      applyServerField(msg.field);
      applyServerBall(msg.ball);
      applyMyTeamRole(msg.players);
      updateSoccerPlayers(msg.players);
      // 倒數 / 待機時套用出生點（開賽前大家先站好）
      if (msg.spawns && (msg.status === 'countdown' || msg.status === 'idle' || msg.status === 'pk')) {
        applyMySpawn(msg.spawns);
      }
      notePhase(prev);
      syncSoccerLock();
      updateMatchHud();
      break;
    }
    case 'soccer_players':
      applyMyTeamRole(msg.players);
      updateSoccerPlayers(msg.players);
      syncSoccerLock();
      break;
    case 'soccer_arm':
      soccerState.motorsArmed = true;
      soccerState.status = 'countdown';
      syncSoccerLock();
      stateHud('起槳！倒數結束前不要移動');
      toast('起槳，倒數期間鎖控', 'success');
      updateMatchHud();
      break;
    case 'soccer_countdown':
      soccerState.status = 'countdown';
      soccerState.motorsArmed = true;
      syncSoccerLock();
      bus.emit('countdown', { n: msg.n });
      sound('beep');
      updateMatchHud();
      break;
    case 'soccer_go':
      soccerState.status = 'running';
      soccerState.endTime = msg.endTime || 0;
      soccerState.foulNote = false;
      soccerState.foulReason = null;
      soccerState.penalty = null;
      soccerState.motorsArmed = true;
      soccerState.crashSent = false;
      soccerState.disabled = false;
      applyMatch(msg.match);
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
          : (msg.match?.period ?? 1) > 1
            ? `⚽ 第 ${msg.match?.period} 局開始`
              : soccerState.myStriker
              ? '🎀 你是前鋒！穿過對方的圓環得分，得分後全隊先回己方半場'
              : '🛡 你是防守！別飛進自家圓環。得分後也要跟全隊回半場',
      );
      syncSoccerLock();
      updateMatchHud();
      break;
    case 'soccer_ball':
      // 推球模式：共用球位置（~12.5Hz）→ 內插目標；首筆直接放到位
      applyServerBall(msg.ball);
      break;
    case 'soccer_scores': {
      const prev = soccerState.status;
      if (msg.status) soccerState.status = msg.status as SoccerMatchStatus;
      if (msg.endTime) soccerState.endTime = msg.endTime;
      if (msg.scores) soccerState.scores = msg.scores;
      if (msg.armed) soccerState.armed = msg.armed;
      applyMatch(msg.match);
      if (msg.spawns && (soccerState.status === 'pk' || soccerState.status === 'penalty')) {
        applyMySpawn(msg.spawns);
      }
      notePhase(prev);
      syncSoccerLock();
      updateMatchHud();
      break;
    }
    case 'soccer_foul':
      soccerState.foulNote = true;
      soccerState.foulReason = msg.reason;
      toast(`犯規：${foulText(msg.reason, msg.byName)}`, 'error');
      if (msg.by === wsState.myId) stateHud(`⚠ ${foulText(msg.reason, '')}`);
      updateMatchHud();
      break;
    case 'soccer_penalty':
      soccerState.status = 'penalty';
      soccerState.endTime = msg.endTime || 0;
      soccerState.foulNote = true;
      soccerState.foulReason = msg.reason;
      soccerState.penalty = {
        reason: msg.reason,
        attackTeam: msg.attackTeam,
        defendTeam: msg.defendTeam,
        strikerId: msg.strikerId,
        defenderId: msg.defenderId,
        byName: msg.byName,
      };
      if (msg.spawns) applyMySpawn(msg.spawns);
      syncSoccerLock();
      toast(`罰球 10 秒：${foulText(msg.reason, msg.byName)}`, 'error');
      if (msg.strikerId === wsState.myId) stateHud('🎯 罰球：你是攻擊手，10 秒內穿對方圓環');
      else if (msg.defenderId === wsState.myId) stateHud('🛡 罰球：你是這記的防守');
      else stateHud('⏸ 罰球進行中，其餘選手鎖控');
      updateMatchHud();
      break;
    case 'soccer_card': {
      const label = msg.card === 'red' ? '紅牌・整場出場' : '黃牌・本局出場';
      toast(`${label}：${msg.byName || ''}`, 'error');
      if (msg.by === wsState.myId) {
        soccerState.myCard = msg.card;
        soccerState.disabled = true;
        stateHud(msg.card === 'red' ? '紅牌：整場出場' : '黃牌：本局出場');
      }
      syncSoccerLock();
      updateMatchHud();
      break;
    }
    case 'soccer_warning':
      toast(`警告：${msg.byName || ''}（第 ${msg.count} 次）`, 'error');
      if (msg.by === wsState.myId) stateHud('警告：同理由再一次會變黃牌');
      updateMatchHud();
      break;
    case 'soccer_safety':
      toast(`安全事件：${msg.byName || ''} 本局少一人`, 'error');
      if (msg.by === wsState.myId) {
        soccerState.myCard = null;
        soccerState.disabled = true;
        stateHud('安全事件：本局少一人');
      }
      syncSoccerLock();
      updateMatchHud();
      break;
    case 'soccer_timeout':
      toast(`暫停換前鋒：${msg.byName || ''}`, 'success');
      if (msg.spawns) applyMySpawn(msg.spawns);
      if (msg.strikerId === wsState.myId) {
        soccerState.myStriker = true;
        stateHud('你換上前鋒了');
      }
      updateMatchHud();
      break;
    case 'soccer_goal_ok':
      if (msg.scores) soccerState.scores = msg.scores;
      soccerState.foulNote = false;
      sound('ring');
      if (msg.pk) {
        toast(
          `🎯 罰球命中！${msg.byName || ''}`,
          msg.team === soccerState.myTeam ? 'success' : '',
        );
        updateMatchHud();
        break;
      }
      if (msg.own) {
        // 推球模式限定：把球推進自家門 → 得分歸對隊；by = 最後觸球（推球）者
        toast(`😅 烏龍球！${msg.byName || ''} 把球推進了自家的門`, 'error');
      } else if (msg.team === soccerState.myTeam) {
        toast(`⚽ 進球！${msg.byName || ''}`, 'success');
        // 半場重置提示只有 striker 模式有（ball 模式伺服器重擺球即可）
        if (soccerState.mode === 'striker') {
          stateHud('⚽ 進球！全隊先退回己方半場才能再攻');
        }
      } else {
        toast(`😮 對方進球（${msg.byName || ''}）`);
      }
      updateMatchHud();
      break;
    case 'soccer_end':
      showMatchResult(msg);
      break;
    case 'soccer_resume':
      droneState.position.x = msg.x;
      droneState.position.y = msg.y;
      droneState.position.z = msg.z;
      droneState.yaw = msg.yaw;
      droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
      toast('🟢 已恢復連線，回到斷線前位置', 'success');
      break;
  }
}

/** 三局兩勝／黃金／PK。沒帶 match 的舊伺服器 → 維持現值 */
function applyMatch(match: SoccerMatchMeta | undefined): void {
  if (!match) return;
  soccerState.period = match.period || 0;
  if (match.sets) soccerState.sets = match.sets;
  if (match.pkScores) soccerState.pkScores = match.pkScores;
  soccerState.pkTurn = match.pkTurn ?? null;
  soccerState.pkRound = match.pkRound || 0;
  soccerState.pkShooterId = match.pkShooterId ?? null;
  soccerState.pkDefenderId = match.pkDefenderId ?? null;
}

function notePhase(prev: SoccerMatchStatus): void {
  const s = soccerState.status;
  if (s === prev) return;
  if (s === 'break') stateHud('⏸ 局間休息');
  else if (s === 'golden') stateHud('⚡ 平手！黃金進球，先進球者勝');
  else if (s === 'pk') stateHud('🎯 點球：每球 10 秒，按 K 可以換人來罰');
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
  soccerState.myCard = me.card === 'yellow' || me.card === 'red' ? me.card : null;
  soccerState.disabled = !!me.disabled;
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
  // 藍隊攻 +z（yaw π）、紅隊攻 -z（yaw 0）。罰球點在對方半場，不能用 z 符號猜朝向。
  droneState.yaw =
    soccerState.myTeam === 'red' ? 0 : soccerState.myTeam === 'blue' ? Math.PI : mine.z > 0 ? 0 : Math.PI;
  droneState.isGrounded = true;
  droneState.isFlying = false;
  soccerState.prevX = mine.x;
  soccerState.prevY = HOME_POSITION.y;
  soccerState.prevZ = mine.z;
}

function foulText(reason: SoccerFoulReason, name: string): string {
  const who = name ? `${name} ` : '';
  if (reason === 'false_start') return `${who}搶跑`;
  if (reason === 'no_return') return `${who}得分後未回己方半場`;
  return `${who}進入自家圓環`;
}

/** 倒數鎖控、出場／安全事件、罰球時不是上場的那兩台 */
export function soccerControlsLocked(): boolean {
  if (!soccerState.active) return false;
  if (soccerState.disabled || soccerState.status === 'countdown') return true;
  if (soccerState.status !== 'penalty') return false;
  const pen = soccerState.penalty;
  if (!pen) return true;
  return pen.strikerId !== wsState.myId && pen.defenderId !== wsState.myId;
}

function syncSoccerLock(): void {
  flags.multiplayerLock = soccerControlsLocked();
}

function showMatchResult(msg: SoccerEndMsg): void {
  const s = msg.scores || soccerState.scores;
  soccerState.status = 'done';
  applyMatch(msg.match);
  // 老師手動停止 / 切關（智能停止）→ 只提示、不顯示勝負結算（time up 才有完整結算）
  if (msg.reason === 'teacher_stop' || msg.reason === 'level_switch') {
    stateHud('🏁 比賽結束');
    toast('🛑 老師結束了本場比賽', 'warning');
    updateMatchHud();
    return;
  }
  stateHud('🏁 足球結束！');
  const sets = msg.match ? ` 局數 ${msg.match.sets.blue}:${msg.match.sets.red}` : '';
  const pk =
    msg.reason === 'pk' && msg.match
      ? ` 點球 ${msg.match.pkScores.blue}:${msg.match.pkScores.red}`
      : '';
  const txt =
    msg.winner === 'blue'
      ? `🔵 藍隊勝！${s.blue} : ${s.red}${sets}${pk}`
      : msg.winner === 'red'
        ? `🔴 紅隊勝！${s.blue} : ${s.red}${sets}${pk}`
        : `🤝 平手 ${s.blue} : ${s.red}${sets}`;
  toast(txt, 'success');
  sound('complete');
  updateMatchHud();
}

// =============================================================================
// 每 tick（60Hz；main.ts 在 soccerState.active 時呼叫，取代一般關卡判定）
// =============================================================================
export function tickSoccerMatch(): void {
  syncSoccerLock();
  if (soccerState.status === 'countdown') {
    droneState.velocity.x = droneState.velocity.y = droneState.velocity.z = 0;
  }
  clampMatchBounds();
  interpolateOthers();
  interpolateBall();
  if (soccerState.contactEnabled) resolveDroneContacts();
  noteCrash();
  detectGoal(); // striker 模式限定（ball 模式進球由伺服器判定，client 不上報）
  soccerState.prevX = droneState.position.x;
  soccerState.prevY = droneState.position.y;
  soccerState.prevZ = droneState.position.z;
  updateMatchHud();
}

/** 場地邊界：護罩貼牆後輕微反彈（速度不硬夾成 0） */
function clampMatchBounds(): void {
  const F = activeSoccerField();
  bounceSoccerWalls(droneState.position, droneState.velocity, {
    halfX: F.halfX,
    halfZ: F.halfZ,
    top: F.top,
  }, F.shieldR);
}

/** 下降速度夠大撞地 → 通知伺服器，本局排除（只報自己） */
function noteCrash(): void {
  if (!droneState.hardLanding) return;
  droneState.hardLanding = false;
  const live =
    soccerState.mode === 'striker' &&
    (soccerState.status === 'running' ||
      soccerState.status === 'golden' ||
      soccerState.status === 'penalty');
  if (!live || soccerState.crashSent || soccerState.disabled) return;
  soccerState.crashSent = true;
  soccerState.disabled = true;
  syncSoccerLock();
  sendToServer({ type: 'soccer_crash' });
  stateHud('墜機：本局排除');
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
  const shieldR = activeSoccerField().shieldR;
  soccerState.ballNear = d < b.r + shieldR + 0.15; // 視覺貼近：護罩半徑 + 網路延遲餘裕
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
  const body = { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z };
  let bumped = false;
  for (const [id, o] of soccerState.others) {
    if (!o.hasPos) continue;
    const hit = resolveShieldContact(body, o.pos, wsState.myId, id, activeSoccerField().shieldR);
    if (hit.separated) bumped = bumped || hit.impact >= SOCCER_IMPACT_TICK;
  }
  p.x = body.x;
  p.y = body.y;
  p.z = body.z;
  v.x = body.vx;
  v.y = body.vy;
  v.z = body.vz;
  if (bumped && performance.now() > soccerState.lastBumpAt) {
    soccerState.lastBumpAt = performance.now() + 280;
    sound('bump');
  }
}

/**
 * 前鋒穿對方門 → 上報 server。判定用護罩後緣與行進方向，不用機頭。
 * server 會用自己收到的位置軌跡再算一次，對不上就拒絕（擋假得分）。
 * ball 模式不在此偵測。上報前先補送最新位置，讓伺服器這一段軌跡含穿越。
 */
function detectGoal(): void {
  if (soccerState.mode !== 'striker') return;
  if (soccerState.disabled || !soccerState.myTeam) return;
  const pen = soccerState.penalty;
  const penaltyStriker =
    soccerState.status === 'penalty' && pen?.strikerId === wsState.myId;
  const pkShooter =
    soccerState.status === 'pk' && soccerState.pkShooterId === wsState.myId;
  if (!soccerState.myStriker && !penaltyStriker && !pkShooter) return;
  const live =
    soccerState.status === 'running' ||
    soccerState.status === 'golden' ||
    penaltyStriker ||
    pkShooter;
  if (!live) return;
  const F = activeSoccerField();
  const team = soccerState.myTeam;
  const attackSign = team === 'blue' ? 1 : -1;
  const passed = shieldPassesRing(
    { x: soccerState.prevX, y: soccerState.prevY, z: soccerState.prevZ },
    droneState.position,
    {
      goalZ: attackSign * F.goalZ,
      goalY: F.goalY,
      goalR: F.goalR,
      shieldR: F.shieldR,
      attackSign,
    },
  );
  // PK／罰球每一記獨立，不受「得分後回半場」鎖住；正規局仍看 armed
  const armed =
    soccerState.status === 'pk' ||
    soccerState.status === 'penalty' ||
    soccerState.armed[team] !== false;
  if (passed && armed && performance.now() > soccerState.goalCooldownUntil) {
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
  const team = soccerState.myTeam;
  setSoccerMatchTimer(
    formatSoccerMatchLine({
      status: soccerState.status,
      mode: soccerState.mode,
      scores: soccerState.scores,
      sets: soccerState.sets,
      period: soccerState.period,
      endTime: soccerState.endTime,
      now: Date.now(),
      myTeam: team,
      myStriker: soccerState.myStriker,
      needReturn: !!team && soccerState.armed[team] === false,
      pkScores: soccerState.pkScores,
      pkTurn: soccerState.pkTurn,
      pkRound: soccerState.pkRound,
      pkMine: !!soccerState.pkShooterId && soccerState.pkShooterId === wsState.myId,
      foul: soccerState.foulNote,
      foulReason: soccerState.foulReason,
      card: soccerState.myCard,
      disabled: soccerState.disabled,
      feelLabel: SOCCER_FEELS[getSoccerFeel()].label,
    }),
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
