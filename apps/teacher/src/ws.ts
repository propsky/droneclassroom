// 老師 WebSocket client — 連 /teacher?ticket=<...>。
// close 4401（ticket 無效/過期）→ 通知上層登出；其他斷線固定 2 秒後重連（沿用有效 ticket）。
import type {
  ArenaEndMsg,
  ArenaScoresMsg,
  ArenaStateMsg,
  ServerToClient,
  SoccerEndMsg,
  SoccerGoalOkMsg,
  SoccerPlayersMsg,
  SoccerScoresMsg,
  SoccerStateMsg,
  StudentInfo,
  TeacherBroadcastPayload,
  TeacherToServer,
} from '@creafly/shared';
import { WS_CLOSE_UNAUTHORIZED } from '@creafly/shared';

/** 老師端會收到的大亂鬥訊息（快照 / 排行 / 結束） */
export type TeacherArenaMsg = ArenaStateMsg | ArenaScoresMsg | ArenaEndMsg;
/** 老師端會收到的足球訊息（快照 / 名單 / 比分 / 進球 / 結束） */
export type TeacherSoccerMsg =
  | SoccerStateMsg | SoccerPlayersMsg | SoccerScoresMsg | SoccerGoalOkMsg | SoccerEndMsg;

export interface TeacherWsHandlers {
  /** 連線狀態變化（頂列狀態燈） */
  onStatus(connected: boolean): void;
  /** 學生名單更新（已合併 student_list / student_update） */
  onStudents(list: StudentInfo[]): void;
  /** 大亂鬥訊息（排行榜 / 倒數時鐘 / 勝負） */
  onArena(msg: TeacherArenaMsg): void;
  /** 足球訊息（隊伍名單 / 比分 / 進球 / 勝負） */
  onSoccer(msg: TeacherSoccerMsg): void;
  /** ticket 無效或已過期 → 上層清 sessionStorage 回登入畫面 */
  onUnauthorized(): void;
}

const RECONNECT_MS = 2000;

export class TeacherWs {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly students = new Map<string, StudentInfo>();

  constructor(
    /** 每次（重）連線時取 ticket；回 null 表示已過期 → 走 onUnauthorized */
    private readonly getTicket: () => string | null,
    private readonly handlers: TeacherWsHandlers,
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.stopped) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    const ticket = this.getTicket();
    if (!ticket) {
      this.handlers.onUnauthorized();
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}//${location.host}/teacher?ticket=${encodeURIComponent(ticket)}`);
    } catch (e) {
      console.warn('[WS] 建立連線失敗：', e);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.handlers.onStatus(true);
      // （重）連上就補一份賽局快照 —— 老師中途開後台 / 斷線重連也能看到進行中的賽局
      this.send({ type: 'arena_state_req' });
      this.send({ type: 'soccer_state_req' });
    };

    ws.onmessage = (ev) => {
      try {
        this.handleMessage(JSON.parse(String(ev.data)) as ServerToClient);
      } catch {
        /* 非 JSON 訊息忽略 */
      }
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onStatus(false);
      if (ev.code === WS_CLOSE_UNAUTHORIZED) {
        this.stopped = true;
        this.handlers.onUnauthorized();
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = (e) => console.warn('[WS] 錯誤', e);
  }

  /** 登出時呼叫：不再重連並關閉連線 */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /** 廣播控制訊息給全班；未連線回 false（上層跳 toast） */
  broadcast(payload: TeacherBroadcastPayload): boolean {
    return this.send({ type: 'broadcast', payload });
  }

  /** 送任意老師訊息（賽局控制：arena_* / soccer_*）；未連線回 false（上層跳 toast） */
  send(msg: TeacherToServer): boolean {
    if (!this.connected || !this.ws) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  private handleMessage(msg: ServerToClient): void {
    switch (msg.type) {
      case 'student_list':
        this.students.clear();
        for (const s of msg.students) this.students.set(s.id, s);
        this.handlers.onStudents([...this.students.values()]);
        break;
      case 'student_update': {
        const prev = this.students.get(msg.student.id);
        this.students.set(msg.student.id, { ...prev, ...msg.student });
        this.handlers.onStudents([...this.students.values()]);
        break;
      }
      // ----- 大亂鬥 → 大亂鬥分頁 -----
      case 'arena_state':
      case 'arena_scores':
      case 'arena_end':
        this.handlers.onArena(msg);
        break;
      // ----- 足球 → 足球分頁 -----
      case 'soccer_state':
      case 'soccer_players':
      case 'soccer_scores':
      case 'soccer_goal_ok':
      case 'soccer_end':
        this.handlers.onSoccer(msg);
        break;
      default:
        break; // 其餘（學生端專用的 arena_go / soccer_countdown …）老師端不需處理
    }
  }
}
