// 學生 WebSocket client — 協定與 legacy server 線上格式相容（@creafly/shared/protocol）。
// 指數退避重連 3s→30s；close code 4000（同名擠下線）不重連；斷線不影響單機遊玩。
import type { ServerToClient, SoccerBallMsg, StudentToServer } from '@creafly/shared';
import { WS_CLOSE_REPLACED } from '@creafly/shared';
import { bus, toast } from '../core/events';
import { loadLevel, runCountdown, levelState, resetMission } from '../core/level';
import { setMode } from '../core/program';
import { player } from '../ui/overlays';

export const wsState = {
  ws: null as WebSocket | null,
  connected: false,
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  backoffMs: 3000, // 3s → 6s → 12s → 24s → 30s 封頂
  everConnected: false,
  wasDown: false,
  stopped: false, // close 4000 後不再重連
  myId: '' as string,
};

/** 送訊息給伺服器（未連線時靜默丟棄 — 單機遊玩不受影響） */
export function sendToServer(msg: StudentToServer): void {
  if (wsState.ws?.readyState === WebSocket.OPEN) {
    wsState.ws.send(JSON.stringify(msg));
  }
}
const send = sendToServer;

export function initWs(): void {
  // 過關 / 切關 → 上報老師後台
  bus.on('level-complete', ({ levelId, timeMs }) => send({ type: 'complete_level', levelId, timeMs }));
  bus.on('level-loaded', ({ level }) => send({ type: 'progress', levelId: level.id }));
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
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws`);
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
      send({ type: 'register', name: player.name, emoji: player.emoji });
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
    console.log('[WS] 連線關閉', ev.code);
    if (ev.code === WS_CLOSE_REPLACED) {
      // 同名在其他裝置登入 → 不搶連線
      wsState.stopped = true;
      toast('⚠️ 此名稱已在其他裝置登入', 'error');
      return;
    }
    if (wsState.everConnected) wsState.wasDown = true;
    scheduleReconnect();
  };

  ws.onerror = (e) => console.warn('[WS] 錯誤', e);
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
      break;
    case 'load_level': {
      const level = levelState.levels.find((l) => l.id === msg.levelId);
      if (level) {
        exitMultiplayerForLevel(); // 多人模式中收到 → 先退出再載入
        loadLevel(msg.levelId);
        toast(`📋 老師切換到：${level.name}`, 'success');
      }
      break;
    }
    case 'set_mode':
      setMode(msg.mode === 'program' ? 'program' : 'manual');
      toast(msg.mode === 'program' ? '🧩 老師切到：程式模式' : '🕹 老師切到：手動模式', 'success');
      break;
    case 'reset_all':
      exitMultiplayerForLevel(); // 多人模式中收到 → 先退出再重置
      if (levelState.current) loadLevel(levelState.current.id);
      else resetMission();
      toast('🔄 老師廣播：重置', 'success');
      break;
    case 'race_start':
      exitMultiplayerForLevel(); // 多人模式中收到 → 先退出再開賽
      setMode('manual');
      loadLevel(msg.levelId || '1-4');
      runCountdown();
      toast('🏁 比賽開始！', 'success');
      break;
    case 'show_message':
      toast(msg.text || '', 'success');
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
      bus.emit('soccer-message', { msg });
      break;
    default:
      break; // student_list 等老師端訊息
  }
}
