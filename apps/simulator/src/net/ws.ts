// 學生 WebSocket client — 協定與 legacy server 線上格式相容（@creafly/shared/protocol）。
// 指數退避重連 3s→30s；close code 4000（同名擠下線）/ 4001（被踢 / 關房）不重連；斷線不影響單機遊玩。
// 房間：register 帶 roomCode/roomPassword（缺省 = 預設房），room_joined / room_rejected / room_closed
// 只轉成 bus 事件給 ui/overlays.ts 的登入 modal 與 header 房間標籤處理。
import type { RegisterMsg, RoomInfo, ServerToClient, SoccerBallMsg, StudentToServer } from '@creafly/shared';
import { WS_CLOSE_KICKED, WS_CLOSE_REPLACED } from '@creafly/shared';
import { bus, toast } from '../core/events';
import { wsUrl } from './backend';
import { applyEntitlement, grantOfflineGrace, clearEntitlement, isOnlineOnlyMode } from './entitlement';
import { mergeStudentCurriculum } from './curriculum';
import { handleLevelLoadResponse } from './levelLoad';
import { handleCompleteAck, handleProgressSync, initProgressQueue, reportComplete } from './progressQueue';
import { getStudentToken } from './studentAuth';
import { armLevelStart, levelState, resetMission } from '../core/level';
import { loadLevel } from './levelLoad';
import { setMode } from '../core/program';
import { player } from '../ui/overlays';

export const wsState = {
  ws: null as WebSocket | null,
  connected: false,
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  backoffMs: 3000, // 3s → 6s → 12s → 24s → 30s 封頂
  everConnected: false,
  wasDown: false,
  stopped: false, // close 4000 / 4001 / 進房被拒後不再重連（使用者重送登入表單才連）
  myId: '' as string,
  /** 目前所在房間（room_joined 後有值；被踢 / 關房 / 斷線清空） */
  room: null as RoomInfo | null,
};

/** 送訊息給伺服器（未連線時靜默丟棄 — 單機遊玩不受影響） */
export function sendToServer(msg: StudentToServer): void {
  if (wsState.ws?.readyState === WebSocket.OPEN) {
    wsState.ws.send(JSON.stringify(msg));
  }
}
const send = sendToServer;

/** 老師廣播比關卡資料早到（遲到者剛連上時）→ 暫存，levels-ready 後補載入 */
let pendingLevelId: string | null = null;

// ---- 心跳：Wi-Fi 掉線 / 裝置睡眠時 TCP 可能數十秒不斷，靠 ping/pong 偵測死連線 ----
const HEARTBEAT_MS = 8000;
const PONG_TIMEOUT_MS = 25000; // 超過沒收到 pong → 視為死連線，主動斷開觸發重連
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;

function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  heartbeatTimer = setInterval(() => {
    if (wsState.ws?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
      console.warn('[WS] 心跳逾時，主動斷開重連');
      try {
        wsState.ws.close();
      } catch {
        /* ignore */
      }
      return;
    }
    send({ type: 'ping', t: Date.now() });
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function initWs(): void {
  // 登出學生帳號（頭像下拉）：主動斷線、不自動重連（token 已清；使用者重送登入表單才連 → rejoin）
  bus.on('student-logout', () => {
    clearEntitlement();
    wsState.stopped = true;
    wsState.room = null;
    wsState.connected = false;
    wsState.wasDown = false;
    if (wsState.reconnectTimer) {
      clearTimeout(wsState.reconnectTimer);
      wsState.reconnectTimer = null;
    }
    const ws = wsState.ws;
    wsState.ws = null; // 先解除綁定 → onclose 不觸發重連 / 提示
    try {
      ws?.close(1000);
    } catch {
      /* ignore */
    }
  });
  // 過關 / 切關 → 上報老師後台（帳號模式帶冪等鍵、離線先入佇列；訪客照舊直送 — net/progressQueue.ts）
  initProgressQueue();
  bus.on('level-complete', ({ levelId, timeMs, inputLog, replayHash }) =>
    reportComplete(levelId, timeMs, { inputLog, replayHash }),
  );
  bus.on('level-loaded', ({ level }) => send({ type: 'progress', levelId: level.id }));
  // 計時真正起算（按開始 / 倒數結束）→ 校正伺服器防作弊觀察起點，
  // 否則「看說明的時間」會被算進觀察時間、短關正常完成也被標可疑
  bus.on('level-timing-started', ({ levelId }) => send({ type: 'level_start', levelId }));
  bus.on('levels-ready', () => {
    if (pendingLevelId) {
      const id = pendingLevelId;
      pendingLevelId = null;
      void loadLevel(id, { bypassGuard: true });
    }
  });
}

/** 登入完成後呼叫（含重新整理後自動重連） */
export function connectToTeacher(): void {
  if (wsState.stopped) return;
  if (
    wsState.ws &&
    (wsState.ws.readyState === WebSocket.CONNECTING || wsState.ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl('/ws'));
  } catch (e) {
    console.warn('WebSocket 連線失敗：', e);
    scheduleReconnect();
    return;
  }
  wsState.ws = ws;

  ws.onopen = () => {
    if (wsState.ws !== ws) return;
    wsState.connected = true;
    wsState.backoffMs = 3000; // 成功連線 → 退避歸零
    console.log('[WS] 已連線到老師 server');
    if (player.name && player.emoji) {
      // 房間碼缺省 = 預設房（向後相容）；重連時自動帶同一組
      const reg: RegisterMsg = { type: 'register', name: player.name, emoji: player.emoji };
      const studentToken = getStudentToken();
      if (studentToken) {
        // 帳號模式：伺服器以 token 解析身分（name/emoji 以 DB 為準）並自動進所屬班級的房；
        // token 失效時伺服器回退訪客，身分驗證由 overlays 的 fetchStudentMe 負責清 token
        reg.studentToken = studentToken;
      } else if (player.roomCode) {
        reg.roomCode = player.roomCode;
        if (player.roomPassword) reg.roomPassword = player.roomPassword;
      }
      send(reg);
    }
    // 重連後補報當前關卡進度
    if (levelState.current) send({ type: 'progress', levelId: levelState.current.id });
    if (wsState.wasDown) {
      toast('🟢 已恢復連線', 'success');
      wsState.wasDown = false;
    } else {
      toast('🟢 已連線到課程', 'success');
    }
    wsState.everConnected = true;
    startHeartbeat();
    // 通知多人模組（大亂鬥重連後自動補送 arena_join）
    bus.emit('ws-connected', {});
  };

  ws.onmessage = (ev) => {
    try {
      // soccer_ball 不在 shared 的 ServerToClient 匯總裡（只進 SoccerServerMsg）→ 這裡補上
      const msg = JSON.parse(String(ev.data)) as ServerToClient | SoccerBallMsg;
      handleMessage(msg);
    } catch {
      /* 非 JSON 訊息忽略 */
    }
  };

  ws.onclose = (ev) => {
    if (wsState.ws !== ws) return;
    wsState.connected = false;
    stopHeartbeat();
    console.log('[WS] 連線關閉', ev.code);
    if (ev.code === WS_CLOSE_REPLACED) {
      // 同名在其他裝置登入 → 不搶連線
      wsState.stopped = true;
      toast('⚠️ 此名稱已在其他裝置登入', 'error');
      return;
    }
    if (ev.code === WS_CLOSE_KICKED) {
      // 老師踢人 / 關房（伺服器可能先送 room_closed 再關；已處理過的話 wsState.ws 已被清空、走不到這）
      onRoomLeft('kicked');
      return;
    }
    // 斷線寬限：enforce 模式允許在離線狀態玩完當前關（主動登出 / 被踢除外）
    if (!wsState.stopped && levelState.current && isOnlineOnlyMode()) {
      grantOfflineGrace(levelState.current.id);
    }
    // 首次斷線提示（重連期間不重複洗版；恢復時 onopen 會 toast「已恢復連線」）
    if (wsState.everConnected && !wsState.wasDown) {
      wsState.wasDown = true;
      toast('📡 連線中斷，自動重連中…', 'warning');
    }
    scheduleReconnect();
  };

  ws.onerror = (e) => console.warn('[WS] 錯誤', e);
}

/**
 * 以目前身分（名字 / 動物 / 房間碼 / 密碼）重新連線並 register：
 * 登入表單送出時呼叫（首次登入、重整、改名、換房、被踢後重進）。
 * 有既有連線就先關掉再開新的（同一條 WS 換房 / 改名不在協定內）；沒有連線就直接連。
 */
export function rejoin(): void {
  wsState.stopped = false;
  if (wsState.reconnectTimer) {
    clearTimeout(wsState.reconnectTimer);
    wsState.reconnectTimer = null;
  }
  const old = wsState.ws;
  if (old) {
    wsState.ws = null; // 先解除綁定 → 舊連線的 onclose 不會觸發重連 / 提示
    wsState.connected = false;
    wsState.room = null;
    try {
      old.close(1000);
    } catch {
      /* ignore */
    }
  }
  wsState.backoffMs = 3000;
  wsState.wasDown = false; // 主動重連不算「恢復連線」
  connectToTeacher();
}

/** 被關房 / 被踢：斷線、不自動重連進同房、退出多人模式、通知 UI 回登入 modal */
function onRoomLeft(reason: 'closed' | 'kicked'): void {
  wsState.stopped = true;
  wsState.room = null;
  wsState.connected = false;
  wsState.wasDown = false;
  if (wsState.reconnectTimer) {
    clearTimeout(wsState.reconnectTimer);
    wsState.reconnectTimer = null;
  }
  const ws = wsState.ws;
  wsState.ws = null;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    try {
      ws.close(1000);
    } catch {
      /* ignore */
    }
  }
  bus.emit('mode-takeover', { mode: 'level' }); // 大亂鬥 / 足球中被踢 → 先退出多人模式
  toast(reason === 'kicked' ? '🚪 你已被移出房間' : '🚪 老師已關閉房間', 'warning');
  bus.emit('room-left', { reason });
}

function scheduleReconnect(): void {
  if (wsState.reconnectTimer || wsState.stopped) return;
  const delay = wsState.backoffMs;
  wsState.backoffMs = Math.min(wsState.backoffMs * 2, 30000);
  console.log(`[WS] ${delay / 1000}s 後重連`);
  wsState.reconnectTimer = setTimeout(() => {
    wsState.reconnectTimer = null;
    connectToTeacher();
  }, delay);
}

/**
 * 智能切關：老師廣播切關 / 比賽 / 重置時，若正在大亂鬥 / 足球（練習或對戰）中，
 * 先讓各模式走自己既有的 exit 路徑退出（mode-takeover 事件 → 不 import 多人模組，避免循環依賴）。
 * 伺服器通常會先送 arena_end / soccer_end 再送廣播，但 client 不依賴順序 —
 * 單獨收到 load_level 也能正確退出並載入關卡。
 */
function exitMultiplayerForLevel(): void {
  bus.emit('mode-takeover', { mode: 'level' });
}

/** 處理老師廣播；arena_* / soccer_* 分派給 multiplayer/（ws 只分派、不處理） */
function handleMessage(msg: ServerToClient | SoccerBallMsg): void {
  switch (msg.type) {
    case 'welcome':
      wsState.myId = msg.id;
      if (msg.entitlement) applyEntitlement(msg.entitlement);
      break;
    case 'room_joined': {
      // 老師移房（一班多房）：同一條連線收到不同房碼 → 退出進行中的多人模式
      // （賽局是每房一場；伺服器端已把我們移出，client 也要收乾淨）。
      // 重連 rejoin 進同一房（房碼相同）不觸發，大亂鬥自動回賽局的流程不受影響。
      const moved = wsState.room !== null && wsState.room.code !== msg.room.code;
      wsState.room = msg.room;
      if (msg.entitlement) applyEntitlement(msg.entitlement);
      if (msg.entitlement?.mode === 'licensed') {
        void mergeStudentCurriculum();
      }
      if (moved) {
        bus.emit('mode-takeover', { mode: 'level' });
        toast(`🚪 老師把你移到「${msg.room.name || msg.room.code}」`, 'success');
      }
      bus.emit('room-joined', { room: msg.room });
      break;
    }
    case 'room_rejected':
      // 被拒不重試同一組（否則伺服器若斷線會無限重連被拒）；使用者改完再送出 → rejoin()
      wsState.stopped = true;
      wsState.room = null;
      bus.emit('room-rejected', { reason: msg.reason });
      break;
    case 'room_closed':
      onRoomLeft(msg.reason);
      break;
    case 'pong':
      lastPongAt = Date.now(); // 心跳回應（死連線偵測基準）
      break;
    case 'complete_ack':
      // 帳號模式：成績入庫確認 → 佇列移除該筆 + 本地標記進度（net/progressQueue.ts）
      handleCompleteAck(msg.clientEventId);
      break;
    case 'progress_sync':
      // 帳號模式進房後下行：歷史進度（關卡選單勾勾、跨裝置同步）
      handleProgressSync(msg.progress);
      break;
    case 'level_load_ok':
      handleLevelLoadResponse(msg.levelId, true);
      break;
    case 'level_load_denied':
      handleLevelLoadResponse(msg.levelId, false);
      break;
    case 'load_level': {
      if (levelState.levels.length === 0) {
        // 關卡資料還沒載完（剛連上就收到伺服器補送的鎖定關卡）→ 暫存待補
        pendingLevelId = msg.levelId;
        break;
      }
      const level = levelState.levels.find((l) => l.id === msg.levelId);
      if (level) {
        exitMultiplayerForLevel(); // 多人模式中收到 → 先退出再載入
        void loadLevel(msg.levelId, { bypassGuard: true });
        toast(`📋 老師切換到：${level.name}`, 'success');
      }
      break;
    }
    case 'lock_level':
      bus.emit('level-lock', { locked: msg.locked });
      toast(msg.locked ? '🔒 老師已鎖定關卡選擇' : '🔓 老師已解除關卡鎖定', 'warning');
      break;
    case 'set_mode':
      setMode(msg.mode === 'program' ? 'program' : 'manual');
      toast(msg.mode === 'program' ? '🧩 老師切到：程式模式' : '🕹 老師切到：手動模式', 'success');
      break;
    case 'reset_all':
      exitMultiplayerForLevel(); // 多人模式中收到 → 先退出再重置
      if (levelState.current) void loadLevel(levelState.current.id, { bypassGuard: true });
      else resetMission();
      toast('🔄 老師廣播：重置', 'success');
      break;
    case 'race_start':
      exitMultiplayerForLevel(); // 多人模式中收到 → 先退出再開賽
      setMode('manual');
      void loadLevel(msg.levelId || '1-4', { bypassGuard: true });
      // 直接進入倒數並開始計時（跳過 intro 的「開始」按鈕 — 比賽全班同步起跑；
      // 修掉舊寫法只跑 runCountdown 導致 startTime 沒設定、成績為 0 還被標可疑的 bug）
      armLevelStart();
      toast('🏁 比賽開始！', 'success');
      break;
    case 'show_message':
      // 老師廣播走專屬大字橫幅（ui/broadcastBanner.ts），不走 toast —
      // toast 是單一 DOM，2.5 秒內來一則系統訊息就會把廣播蓋掉，且 13px 太小
      bus.emit('broadcast-message', { text: msg.text || '' });
      break;
    case 'arena_state':
    case 'arena_countdown':
    case 'arena_go':
    case 'arena_players':
    case 'arena_balloon':
    case 'arena_caught':
    case 'arena_respawn':
    case 'arena_scores':
    case 'arena_end':
    case 'arena_resume':
      bus.emit('arena-message', { msg });
      break;
    case 'soccer_state':
    case 'soccer_countdown':
    case 'soccer_go':
    case 'soccer_players':
    case 'soccer_ball': // 推球模式：共用球位置廣播（~12.5Hz）
    case 'soccer_goal_ok':
    case 'soccer_scores':
    case 'soccer_end':
    case 'soccer_resume':
      bus.emit('soccer-message', { msg });
      break;
    default:
      break; // student_list 等老師端訊息
  }
}
