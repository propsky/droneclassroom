// WebSocket 訊息協定 — 與 legacy server.js 線上格式相容（過渡期新舊 client 可混連）。
// 角色判定沿用 legacy：URL path === '/teacher' 為老師，其餘為學生。

import type { Entitlement } from './entitlement';

// ---------- Student → Server ----------

export interface RegisterMsg {
  type: 'register';
  name: string;
  emoji: string;
  /** 房間碼（缺省 = 預設房，向後相容既有 URL）；也可由 WS 連線 ?room= 指定 */
  roomCode?: string;
  /** 房間密碼（該房有設時必填） */
  roomPassword?: string;
  /** 學生帳號 token（帳號模式）：伺服器以此解析身分，name/emoji 以 DB 為準、自動進所屬班級的房 */
  studentToken?: string;
}
export interface ProgressMsg {
  type: 'progress';
  levelId: string;
}
/** 計時真正起算（按「開始」→ 倒數結束；freeplay 按開始即送）：
 *  伺服器以此校正防作弊觀察起點 — progress 在關卡載入就送，看說明的時間不該算進去 */
export interface LevelStartMsg {
  type: 'level_start';
  levelId: string;
}
/** 心跳（約 8 秒一次）：伺服器更新 last_seen 並回 pong；client 以 pong 偵測死連線 */
export interface PingMsg {
  type: 'ping';
  t?: number;
}
export interface CompleteLevelMsg {
  type: 'complete_level';
  levelId: string;
  timeMs: number;
  /** 冪等鍵（uuid）：帳號模式一律帶；離線補傳/重送靠它去重 */
  clientEventId?: string;
  /** client 端完成時間（ms epoch）：離線補傳時保留真實完成時刻；稽核雙時間戳用 */
  clientTs?: number;
  /** 離線補傳標記：true = 完成當下不在線（伺服器無法對時驗證，稽核留痕不硬標可疑） */
  offline?: boolean;
}
export interface ArenaJoinMsg { type: 'arena_join' }
export interface ArenaLeaveMsg { type: 'arena_leave' }
export interface ArenaPosMsg {
  type: 'arena_pos';
  x: number; y: number; z: number; yaw: number;
}
export interface ArenaPopMsg { type: 'arena_pop'; id: number }
export interface SoccerJoinMsg { type: 'soccer_join' }
export interface SoccerLeaveMsg { type: 'soccer_leave' }
export interface SoccerPosMsg {
  type: 'soccer_pos';
  x: number; y: number; z: number; yaw: number;
}
export interface SoccerGoalMsg { type: 'soccer_goal' }

export type StudentToServer =
  | RegisterMsg | ProgressMsg | LevelStartMsg | PingMsg | CompleteLevelMsg
  | ArenaJoinMsg | ArenaLeaveMsg | ArenaPosMsg | ArenaPopMsg
  | SoccerJoinMsg | SoccerLeaveMsg | SoccerPosMsg | SoccerGoalMsg;

// ---------- Teacher → Server ----------

export type TeacherBroadcastPayload =
  | { type: 'load_level'; levelId: string }
  | { type: 'set_mode'; mode: 'manual' | 'program' }
  | { type: 'reset_all' }
  | { type: 'race_start'; levelId: string }
  | { type: 'show_message'; text: string }
  /** 鎖定關卡選擇：學生端關卡選單停用，只能由老師廣播切關（伺服器記住狀態，遲到者補送） */
  | { type: 'lock_level'; locked: boolean };

export interface TeacherBroadcastMsg {
  type: 'broadcast';
  payload: TeacherBroadcastPayload;
  /** 目標房屬於班級時套用到該班級所有房（主房＋分房）— 一班多房整班廣播 */
  allRooms?: boolean;
}
export interface ArenaStartMsg {
  type: 'arena_start';
  durationSec: number;
  mode: 'balloon' | 'tag';
  ghostCount?: number;
  field?: 'grid' | 'playground';
}
export interface ArenaStateReqMsg { type: 'arena_state_req' }
/** 老師手動停止大亂鬥（倒數中或進行中皆可；伺服器廣播 arena_end reason:'teacher_stop'） */
export interface ArenaStopMsg { type: 'arena_stop' }

/** 足球玩法：'ball' 推球進門（預設，共用球由伺服器模擬）；'striker' FAI 前鋒穿門（進階） */
export type SoccerMode = 'ball' | 'striker';
export interface SoccerStartMsg { type: 'soccer_start'; durationSec: number; mode?: SoccerMode }
export interface SoccerStateReqMsg { type: 'soccer_state_req' }
/** 老師手動停止足球（伺服器廣播 soccer_end reason:'teacher_stop'） */
export interface SoccerStopMsg { type: 'soccer_stop' }
export interface SoccerSetStrikerMsg { type: 'soccer_set_striker'; studentId: string }
export interface SoccerSetTeamMsg { type: 'soccer_set_team'; studentId: string; team: SoccerTeam }
export interface SoccerResetMsg { type: 'soccer_reset'; clearTeams?: boolean }

// ---------- 房間（Room）：一位老師開的一個場次 = 獨立名冊 + 獨立賽局 + 設定 ----------
// 老師一條 WS 管多間；「作用房間」由每則老師訊息的 roomCode 指定（缺省 = 老師目前選定的房間）。
// 未來帳號系統：Room 加 ownerId/持久化即可，協定不變。

/** 房間設定（老師可改）；伺服器端另有預設值（config），全部不寫死 */
export interface RoomSettings {
  /** 顯示名稱（如「三年二班」）；缺省用房間碼 */
  name?: string;
  /** 加入密碼（空 = 不需密碼） */
  password?: string;
  /** 人數上限（超過拒絕加入） */
  maxStudents?: number;
  /** 鎖房：禁止新加入，已在房內的不受影響 */
  locked?: boolean;
}

export interface RoomInfo {
  code: string;
  name: string;
  hasPassword: boolean;
  maxStudents: number;
  locked: boolean;
  studentCount: number;
  /** 房內賽局狀態摘要（給房間列表顯示） */
  arenaStatus: string;
  soccerStatus: string;
  createdAt: number;
  /** 持久化班級（teams 表）id；訪客預設房與無 DB 模式為 null */
  teamId?: number | null;
  /** 主房（code = 班級碼）或分房（一班多房；獨立產碼）；非班級房恆為 true */
  isMain?: boolean;
}

/**
 * 老師的班級（teams 表，持久化）：code 固定、重啟不消失。
 * 「開房」= 把班級載入成記憶體 Room；`open` 表示目前是否開著（有對應 RoomInfo）。
 */
export interface TeamInfo {
  id: number;
  code: string;
  name: string;
  hasPassword: boolean;
  maxStudents: number;
  locked: boolean;
  createdAt: number;
  open: boolean;
}

/** 老師開某個班級的房（載入成 Room）；無 DB 模式不支援（伺服器忽略） */
export interface RoomOpenTeamMsg { type: 'room_open_team'; teamId: number }
/** 封存班級（archived_at；列表不再顯示、紀錄保留）；若開著先關房 */
export interface RoomArchiveTeamMsg { type: 'room_archive_team'; teamId: number }

export interface RoomCreateMsg { type: 'room_create'; settings?: RoomSettings }
export interface RoomCloseMsg { type: 'room_close'; roomCode: string }
export interface RoomUpdateMsg { type: 'room_update'; roomCode: string; settings: RoomSettings }
/** 踢人（該生 WS 以 WS_CLOSE_KICKED 關閉，可重新加入除非鎖房） */
export interface RoomKickMsg { type: 'room_kick'; roomCode: string; studentId: string }
/** 老師切換「目前作用房間」：之後的名冊/賽局訊息以此房為準 */
export interface RoomSelectMsg { type: 'room_select'; roomCode: string }
export interface RoomListReqMsg { type: 'room_list_req' }
/** 一班多房：在班級主房下開分房（獨立產碼、繼承班級密碼；限擁有者、主房要開著） */
export interface RoomCreateSubMsg { type: 'room_create_sub'; teamId: number; name?: string }
/** 把學生移到另一間房（roomCode = 來源房，缺省 = 選定房）；帳號學生移入分房會持久化指派 */
export interface RoomMoveStudentMsg { type: 'room_move_student'; studentId: string; toRoomCode: string }

/** 帶 roomCode 的老師訊息：缺省 = 目前選定房間 */
export interface RoomScoped { roomCode?: string }

export type TeacherToServer =
  | (TeacherBroadcastMsg & RoomScoped)
  | (ArenaStartMsg & RoomScoped) | (ArenaStateReqMsg & RoomScoped) | (ArenaStopMsg & RoomScoped)
  | (SoccerStartMsg & RoomScoped) | (SoccerStateReqMsg & RoomScoped) | (SoccerStopMsg & RoomScoped)
  | (SoccerSetStrikerMsg & RoomScoped) | (SoccerSetTeamMsg & RoomScoped) | (SoccerResetMsg & RoomScoped)
  | RoomCreateMsg | RoomCloseMsg | RoomUpdateMsg | RoomKickMsg | RoomSelectMsg | RoomListReqMsg
  | RoomOpenTeamMsg | RoomArchiveTeamMsg
  | RoomCreateSubMsg | (RoomMoveStudentMsg & RoomScoped);

// ---------- Server → Client ----------

export type SoccerTeam = 'blue' | 'red';
export type ArenaRole = 'ghost' | 'runner' | null;

export interface StudentInfo {
  id: string;
  name: string;
  emoji: string;
  connected?: boolean;
  level?: string | null;
  time?: number | null;
  /** 防作弊標記：成績與伺服器觀察到的經過時間差距離譜（老師端顯示 ⚠️，不阻擋） */
  suspect?: boolean;
  /** 防作弊標記的原因清單（老師 hover 可見；缺省 / 空 = 無） */
  suspectReasons?: string[];
  /** 最後收到該生任何訊息距今秒數（心跳約 8s；久未回應 = 網路可能已死但 TCP 未斷） */
  lastSeenSec?: number | null;
  /** 已註冊學生（帳號模式進場）：students 表 id；訪客為 null/缺省 */
  studentId?: number | null;
}

/** 心跳回覆（echo ping 的 t） */
export interface PongMsg { type: 'pong'; t?: number | null }

export interface WelcomeMsg {
  type: 'welcome';
  id: string;
  /** 能力包（welcome 時下發；舊 client 可忽略） */
  entitlement?: Entitlement;
}
/** 學生成功進房（register 通過）：帶房間資訊供 HUD 顯示 */
export interface RoomJoinedMsg {
  type: 'room_joined';
  room: RoomInfo;
  /** register 後更新的能力包（帳號升級 licensed 等；舊 client 可忽略） */
  entitlement?: Entitlement;
}
/** 學生進房被拒：reason 給 UI 顯示對應文案 */
export interface RoomRejectedMsg {
  type: 'room_rejected';
  reason: 'not_found' | 'locked' | 'full' | 'bad_password' | 'closed';
}
/** 房間被老師關閉 / 被踢：學生端回到進房畫面 */
export interface RoomClosedMsg { type: 'room_closed'; reason: 'closed' | 'kicked' }
/** 帳號模式：complete_level 的入庫確認（client 收到即從離線佇列移除該筆） */
export interface CompleteAckMsg { type: 'complete_ack'; clientEventId: string }
/** 帳號模式進房後下行：歷史進度（關卡選單標記已完成、跨裝置成績同步） */
export interface ProgressSyncMsg {
  type: 'progress_sync';
  progress: Record<string, { bestTimeMs: number | null; attempts: number }>;
}
/** 老師端：房間列表（建立/關閉/設定變更/人數變動時推送） */
export interface RoomListMsg {
  type: 'room_list';
  rooms: RoomInfo[];
  selected: string | null;
  /** 老師的班級清單（持久化；含未開房的）。無 DB 模式為空陣列 */
  teams?: TeamInfo[];
}
export interface StudentListMsg { type: 'student_list'; students: StudentInfo[] }
export interface StudentUpdateMsg { type: 'student_update'; student: StudentInfo }

export interface ArenaPlayerState {
  id: string; name: string; emoji: string;
  role?: ArenaRole; stunned?: boolean; invincible?: boolean;
  /** 位置只在 arena_players（~12Hz 廣播）帶；arena_state / arena_go 的 players 僅角色與計分 */
  x?: number; y?: number; z?: number; yaw?: number;
  score?: number; caughtCount?: number;
}

/** 計分板 / 排行榜一列（arena_scores.scores 與 arena_end.ranking 同形） */
export interface ArenaScoreEntry {
  id: string; name: string; emoji: string; score: number;
  role?: ArenaRole; stunned?: boolean; invincible?: boolean; caughtCount?: number;
}
export interface ArenaStateMsg {
  type: 'arena_state';
  status: 'idle' | 'countdown' | 'running' | 'ended';
  mode: 'balloon' | 'tag';
  field: 'grid' | 'playground';
  endTime: number;
  durationSec: number;
  balloons: { id: number; x: number; y: number; z: number }[];
  players: ArenaPlayerState[];
  spawns: { id: string; x: number; z: number }[];
}
export interface ArenaCountdownMsg { type: 'arena_countdown'; n: number }
export interface ArenaGoMsg {
  type: 'arena_go';
  mode: 'balloon' | 'tag';
  field: 'grid' | 'playground';
  endTime: number;
  spawns: { id: string; x: number; z: number }[];
  players: ArenaPlayerState[];
}
export interface ArenaPlayersMsg { type: 'arena_players'; players: ArenaPlayerState[] }
export interface ArenaBalloonMsg {
  type: 'arena_balloon';
  id: number; alive: boolean;
  x?: number; y?: number; z?: number;
}
export interface ArenaCaughtMsg {
  type: 'arena_caught';
  id: string; by: string; byName: string; stunMs: number;
}
export interface ArenaRespawnMsg {
  type: 'arena_respawn';
  x: number; z: number; stunMs: number; invincibleMs: number;
}
export interface ArenaScoresMsg {
  type: 'arena_scores';
  scores: ArenaScoreEntry[];
  status: string; endTime: number;
  mode: 'balloon' | 'tag'; field: 'grid' | 'playground';
}
export interface ArenaEndMsg {
  type: 'arena_end';
  mode: 'balloon' | 'tag';
  winner: 'time' | 'ghosts' | 'runners';
  ranking: ArenaScoreEntry[];
  players: ArenaScoreEntry[];
  /** 結束原因：時間到（缺省）/ 老師手動停止 / 老師切換關卡（智能停止） */
  reason?: 'time_up' | 'teacher_stop' | 'level_switch';
}

/** 學生端會收到的所有 arena_* 訊息（ws 分派 → multiplayer/arena 用） */
export type ArenaServerMsg =
  | ArenaStateMsg | ArenaCountdownMsg | ArenaGoMsg | ArenaPlayersMsg
  | ArenaBalloonMsg | ArenaCaughtMsg | ArenaRespawnMsg | ArenaScoresMsg | ArenaEndMsg;

export interface SoccerPlayerState {
  id: string; name: string; emoji: string;
  team: SoccerTeam | null; striker: boolean;
  /** 位置只在 soccer_players（~12Hz tick 廣播）帶；soccer_state / soccer_go 的 players 僅隊伍與前鋒 */
  x?: number; y?: number; z?: number; yaw?: number;
}
/** 出生點（soccer_state / soccer_go 的 spawns 列） */
export interface SoccerSpawn { id: string; x: number; z: number }

/**
 * 場地尺寸 — 由伺服器下發、客戶端據此渲染（資料驅動：調整大小只改伺服器設定）。
 * halfX/halfZ = 場地半寬/半長；goalY = 門環中心高；goalR = 門環半徑；ceil = 天花板高
 */
export interface SoccerFieldDef {
  halfX: number;
  halfZ: number;
  goalY: number;
  goalR: number;
  ceil: number;
}

/** 推球模式的球狀態（伺服器模擬，~12.5Hz 廣播；客戶端內插渲染） */
export interface SoccerBallState {
  x: number; y: number; z: number;
  /** 球半徑（下發以便客戶端渲染與預測接觸，資料驅動） */
  r: number;
}

export interface SoccerStateMsg {
  type: 'soccer_state';
  /** 線上值以 legacy 為準：結束是 'done'（不是 'ended'） */
  status: 'idle' | 'countdown' | 'running' | 'done';
  /** 玩法（缺省視為 'striker' = legacy 相容） */
  mode?: SoccerMode;
  endTime: number; durationSec: number;
  scores: Record<SoccerTeam, number>;
  armed: Record<SoccerTeam, boolean>;
  winner?: SoccerTeam | 'draw' | null;
  players: SoccerPlayerState[];
  spawns?: SoccerSpawn[];
  field?: SoccerFieldDef;
  ball?: SoccerBallState | null;
}
export interface SoccerCountdownMsg { type: 'soccer_countdown'; n: number }
export interface SoccerGoMsg {
  type: 'soccer_go';
  endTime: number; spawns: SoccerSpawn[]; players: SoccerPlayerState[];
  field?: SoccerFieldDef;
  mode?: SoccerMode;
  ball?: SoccerBallState | null;
}
/** 推球模式：球位置廣播（每 tick，僅 running 期間） */
export interface SoccerBallMsg { type: 'soccer_ball'; ball: SoccerBallState }
export interface SoccerPlayersMsg { type: 'soccer_players'; players: SoccerPlayerState[] }
export interface SoccerGoalOkMsg {
  type: 'soccer_goal_ok';
  team: SoccerTeam; by: string; byName: string;
  scores: Record<SoccerTeam, number>;
  /** 推球模式：烏龍球（把球推進自家門，得分歸對隊；by = 最後觸球者） */
  own?: boolean;
}
export interface SoccerScoresMsg {
  type: 'soccer_scores';
  scores: Record<SoccerTeam, number>;
  armed: Record<SoccerTeam, boolean>;
  status: string; endTime: number;
}
export interface SoccerEndMsg {
  type: 'soccer_end';
  reason: string;
  winner: SoccerTeam | 'draw';
  scores: Record<SoccerTeam, number>;
  players: SoccerPlayerState[];
}

/** 學生端會收到的所有 soccer_* 訊息（ws 分派 → multiplayer/soccer 用） */
export type SoccerServerMsg =
  | SoccerStateMsg | SoccerCountdownMsg | SoccerGoMsg | SoccerPlayersMsg
  | SoccerBallMsg | SoccerGoalOkMsg | SoccerScoresMsg | SoccerEndMsg;

export type ServerToClient =
  | WelcomeMsg | PongMsg | StudentListMsg | StudentUpdateMsg
  | RoomJoinedMsg | RoomRejectedMsg | RoomClosedMsg | RoomListMsg
  | CompleteAckMsg | ProgressSyncMsg
  | TeacherBroadcastPayload
  | ArenaStateMsg | ArenaCountdownMsg | ArenaGoMsg | ArenaPlayersMsg
  | ArenaBalloonMsg | ArenaCaughtMsg | ArenaRespawnMsg | ArenaScoresMsg | ArenaEndMsg
  | SoccerStateMsg | SoccerCountdownMsg | SoccerGoMsg | SoccerPlayersMsg
  | SoccerBallMsg | SoccerGoalOkMsg | SoccerScoresMsg | SoccerEndMsg;

/** 同名 register 擠下線時 server 用的 close code（legacy 慣例：收到後不重連） */
export const WS_CLOSE_REPLACED = 4000;
/** 老師踢人 / 關房時對學生 WS 用的 close code（學生端：回進房畫面、不自動重連進同房） */
export const WS_CLOSE_KICKED = 4001;
