// WebSocket 訊息協定 — 與 legacy server.js 線上格式相容（過渡期新舊 client 可混連）。
// 角色判定沿用 legacy：URL path === '/teacher' 為老師，其餘為學生。

// ---------- Student → Server ----------

export interface RegisterMsg {
  type: 'register';
  name: string;
  emoji: string;
}
export interface ProgressMsg {
  type: 'progress';
  levelId: string;
}
export interface CompleteLevelMsg {
  type: 'complete_level';
  levelId: string;
  timeMs: number;
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
  | RegisterMsg | ProgressMsg | CompleteLevelMsg
  | ArenaJoinMsg | ArenaLeaveMsg | ArenaPosMsg | ArenaPopMsg
  | SoccerJoinMsg | SoccerLeaveMsg | SoccerPosMsg | SoccerGoalMsg;

// ---------- Teacher → Server ----------

export type TeacherBroadcastPayload =
  | { type: 'load_level'; levelId: string }
  | { type: 'set_mode'; mode: 'manual' | 'program' }
  | { type: 'reset_all' }
  | { type: 'race_start'; levelId: string }
  | { type: 'show_message'; text: string };

export interface TeacherBroadcastMsg {
  type: 'broadcast';
  payload: TeacherBroadcastPayload;
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

export type TeacherToServer =
  | TeacherBroadcastMsg
  | ArenaStartMsg | ArenaStateReqMsg | ArenaStopMsg
  | SoccerStartMsg | SoccerStateReqMsg | SoccerStopMsg
  | SoccerSetStrikerMsg | SoccerSetTeamMsg | SoccerResetMsg;

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
}

export interface WelcomeMsg { type: 'welcome'; id: string }
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
  | WelcomeMsg | StudentListMsg | StudentUpdateMsg
  | TeacherBroadcastPayload
  | ArenaStateMsg | ArenaCountdownMsg | ArenaGoMsg | ArenaPlayersMsg
  | ArenaBalloonMsg | ArenaCaughtMsg | ArenaRespawnMsg | ArenaScoresMsg | ArenaEndMsg
  | SoccerStateMsg | SoccerCountdownMsg | SoccerGoMsg | SoccerPlayersMsg
  | SoccerBallMsg | SoccerGoalOkMsg | SoccerScoresMsg | SoccerEndMsg;

/** 同名 register 擠下線時 server 用的 close code（legacy 慣例：收到後不重連） */
export const WS_CLOSE_REPLACED = 4000;
