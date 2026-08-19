// 老師 WebSocket client — 連 /teacher?ticket=<...>。
// close 4401（ticket 無效/過期）→ 通知上層登出；其他斷線固定 2 秒後重連（沿用有效 ticket）。
// 房間：一條 WS 管多間；「目前選定房間」只存在這裡（單一來源），send() 自動替房間作用域訊息補 roomCode。
import { wsUrl } from './backend';
import type {
  ArenaEndMsg,
  ArenaScoresMsg,
  ArenaStateMsg,
  RoomInfo,
  RoomScoped,
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
  /** 關卡鎖定狀態（連上時伺服器補送 + 廣播後回送 → 開關 UI 以伺服器為準） */
  onLock(locked: boolean): void;
  /** 房間列表 + 目前選定房間（建立/關閉/設定/人數變動/切房時伺服器推送） */
  onRooms(rooms: RoomInfo[], selected: string | null): void;
  /** ticket 無效或已過期 → 上層清 sessionStorage 回登入畫面 */
  onUnauthorized(): void;
}

const RECONNECT_MS = 2000;

/** 會作用在「某一間房」的老師訊息：送出時自動補上目前選定房碼（房間管理訊息本身自帶 roomCode，不在此列） */
const ROOM_SCOPED_TYPES = new Set<TeacherToServer['type']>([
  'broadcast',
  'arena_start', 'arena_state_req', 'arena_stop',
  'soccer_start', 'soccer_state_req', 'soccer_stop',
  'soccer_set_striker', 'soccer_set_team', 'soccer_reset',
]);

export class TeacherWs {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly students = new Map<string, StudentInfo>();
  /** 目前選定房碼；null = 伺服器尚未告知（舊伺服器無房間概念 → 訊息不帶 roomCode，照舊運作） */
  private selectedRoom: string | null = null;

  constructor(
    /** 每次（重）連線時取 ticket；回 null 表示已過期 → 走 onUnauthorized */
    private readonly getTicket: () => string | null,
    private readonly handlers: TeacherWsHandlers,
  ) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 目前選定房碼（以伺服器 room_list.selected 為準） */
  get roomCode(): string | null {
    return this.selectedRoom;
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
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(`/teacher?ticket=${encodeURIComponent(ticket)}`));
    } catch (e) {
      console.warn('[WS] 建立連線失敗：', e);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.handlers.onStatus(true);
      // （重）連上就補一份房間列表 + 賽局快照 —— 老師中途開後台 / 斷線重連也能看到進行中的賽局
      this.send({ type: 'room_list_req' });
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

  /** 送任意老師訊息（賽局控制 arena_* / soccer_*、房間管理 room_*）；未連線回 false（上層跳 toast）。
   *  房間作用域訊息（廣播 / 賽局）自動帶上目前選定房碼；room_select 先樂觀更新選定房，之後以伺服器 room_list 為準。 */
  send(msg: TeacherToServer): boolean {
    if (!this.connected || !this.ws) return false;
    if (msg.type === 'room_select') this.selectedRoom = msg.roomCode;
    this.ws.send(JSON.stringify(this.withRoom(msg)));
    return true;
  }

  /** 房間作用域訊息補 roomCode（呼叫端已明確指定者不覆蓋） */
  private withRoom(msg: TeacherToServer): TeacherToServer & RoomScoped {
    if (!this.selectedRoom || !ROOM_SCOPED_TYPES.has(msg.type)) return msg;
    const scoped: TeacherToServer & RoomScoped = msg;
    if (scoped.roomCode) return scoped;
    const out: TeacherToServer & RoomScoped = { ...scoped };
    out.roomCode = this.selectedRoom;
    return out;
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
      case 'lock_level':
        this.handlers.onLock(msg.locked);
        break;
      case 'room_list':
        this.selectedRoom = msg.selected;
        this.handlers.onRooms(msg.rooms, msg.selected);
        break;
      default:
        break; // 其餘（學生端專用的 arena_go / soccer_countdown …）老師端不需處理
    }
  }
}
