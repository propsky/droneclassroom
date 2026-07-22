"""WS 線上協定 — Pydantic v2 模型，對齊 packages/shared/src/protocol.ts。

欄位名沿用線上格式（camelCase：levelId / timeMs），與 legacy client 二進位相容。
進站訊息一律 strict 驗證（不做型別強制轉換），行為對齊 Node 版 guards.ts：
欄位型別不符（如 name 不是字串）→ ValidationError → 呼叫端整則丟棄。
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

# 同名 register 擠下線時 server 用的 close code（legacy 慣例：收到後不重連）
WS_CLOSE_REPLACED = 4000

# 進站數值欄位共用型別：拒絕 NaN / Infinity（會毒害距離 / 速度計算與 JSON 序列化）
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


class _StrictModel(BaseModel):
    """進站訊息基底：strict 模式 + 忽略多餘欄位（與 Node 版逐欄檢查等價）。"""

    model_config = ConfigDict(strict=True, extra="ignore")


# ---------- 學生 → 伺服器 ----------


class RegisterMsg(_StrictModel):
    """學生報到（登入 / 重連）。"""

    type: Literal["register"]
    name: str
    emoji: str


class ProgressMsg(_StrictModel):
    """學生切換 / 進行中的關卡。"""

    type: Literal["progress"]
    levelId: str


class CompleteLevelMsg(_StrictModel):
    """學生完成關卡 + 用時（毫秒）。"""

    type: Literal["complete_level"]
    levelId: str
    timeMs: FiniteFloat


# ---------- 學生 → 伺服器：賽局（arena 大亂鬥 / soccer 足球）----------


class ArenaJoinMsg(_StrictModel):
    """加入大亂鬥（與足球互斥）。"""

    type: Literal["arena_join"]


class ArenaLeaveMsg(_StrictModel):
    """離開大亂鬥（分數保留，斷線才清）。"""

    type: Literal["arena_leave"]


class ArenaPosMsg(_StrictModel):
    """大亂鬥位置回報（進站會經過 clamp + 速度上限防作弊，見 games/base.py）。"""

    type: Literal["arena_pos"]
    x: FiniteFloat
    y: FiniteFloat
    z: FiniteFloat
    yaw: FiniteFloat


class ArenaPopMsg(_StrictModel):
    """宣告戳破氣球（伺服器驗證氣球存活 + 玩家位置距離）。"""

    type: Literal["arena_pop"]
    id: int


class SoccerJoinMsg(_StrictModel):
    """加入足球（與大亂鬥互斥；自動平均分隊）。"""

    type: Literal["soccer_join"]


class SoccerLeaveMsg(_StrictModel):
    """離開足球（隊伍保留；前鋒離開由隊友遞補）。"""

    type: Literal["soccer_leave"]


class SoccerPosMsg(_StrictModel):
    """足球位置回報（同樣經過 clamp + 速度上限防作弊）。"""

    type: Literal["soccer_pos"]
    x: FiniteFloat
    y: FiniteFloat
    z: FiniteFloat
    yaw: FiniteFloat


class SoccerGoalMsg(_StrictModel):
    """宣告進球（伺服器驗證：前鋒 / armed / 最後回報位置在對方門環容差內）。"""

    type: Literal["soccer_goal"]


StudentMessage = Annotated[
    RegisterMsg
    | ProgressMsg
    | CompleteLevelMsg
    | ArenaJoinMsg
    | ArenaLeaveMsg
    | ArenaPosMsg
    | ArenaPopMsg
    | SoccerJoinMsg
    | SoccerLeaveMsg
    | SoccerPosMsg
    | SoccerGoalMsg,
    Field(discriminator="type"),
]
STUDENT_MESSAGE_ADAPTER: TypeAdapter[
    RegisterMsg
    | ProgressMsg
    | CompleteLevelMsg
    | ArenaJoinMsg
    | ArenaLeaveMsg
    | ArenaPosMsg
    | ArenaPopMsg
    | SoccerJoinMsg
    | SoccerLeaveMsg
    | SoccerPosMsg
    | SoccerGoalMsg
] = TypeAdapter(StudentMessage)

# ---------- 老師 → 伺服器 ----------
# broadcast payload 採白名單逐型別驗證（legacy 是原封轉發，這裡跟 Node 版一樣修掉）


class LoadLevelPayload(_StrictModel):
    """要求全班載入指定關卡。"""

    type: Literal["load_level"]
    levelId: str


class SetModePayload(_StrictModel):
    """要求全班切換手動 / 程式模式。"""

    type: Literal["set_mode"]
    mode: Literal["manual", "program"]


class ResetAllPayload(_StrictModel):
    """要求全班重置無人機。"""

    type: Literal["reset_all"]


class RaceStartPayload(_StrictModel):
    """開始計時賽（指定關卡）。"""

    type: Literal["race_start"]
    levelId: str


class ShowMessagePayload(_StrictModel):
    """對全班顯示訊息。"""

    type: Literal["show_message"]
    text: str


TeacherBroadcastPayload = Annotated[
    LoadLevelPayload | SetModePayload | ResetAllPayload | RaceStartPayload | ShowMessagePayload,
    Field(discriminator="type"),
]


class TeacherBroadcastMsg(_StrictModel):
    """老師廣播：payload 通過白名單驗證後原樣轉發全體學生。"""

    type: Literal["broadcast"]
    payload: TeacherBroadcastPayload


# ---------- 老師 → 伺服器：賽局控制 ----------
# 這些訊息只有已通過 ticket 驗證的 /teacher 連線才收得到（ws.py 只在老師端分派）。


class ArenaStartMsg(_StrictModel):
    """開始大亂鬥。durationSec 下限 30 秒由 handler clamp（對齊 legacy Math.max(30, …)）。"""

    type: Literal["arena_start"]
    durationSec: FiniteFloat
    mode: Literal["balloon", "tag"]
    # ghostCount 用 float 收（legacy 收任意 number），handler 取整；0 視同未指定 → 1
    ghostCount: FiniteFloat = 1
    field: Literal["grid", "playground"] = "grid"


class ArenaStateReqMsg(_StrictModel):
    """老師請求大亂鬥完整快照（arena_state）。"""

    type: Literal["arena_state_req"]


class ArenaStopMsg(_StrictModel):
    """老師手動停止大亂鬥（倒數中或進行中皆可；廣播 arena_end reason:'teacher_stop'）。"""

    type: Literal["arena_stop"]


class SoccerStartMsg(_StrictModel):
    """開始足球。durationSec 下限 5 秒由 handler clamp（對齊 legacy Math.max(5, …)）。

    mode 缺省 'ball'（推球進門，共用球由伺服器模擬）；'striker' = FAI 前鋒穿門（進階）。
    """

    type: Literal["soccer_start"]
    durationSec: FiniteFloat
    mode: Literal["ball", "striker"] = "ball"


class SoccerStateReqMsg(_StrictModel):
    """老師請求足球完整快照（soccer_state）。"""

    type: Literal["soccer_state_req"]


class SoccerStopMsg(_StrictModel):
    """老師手動停止足球（廣播 soccer_end reason:'teacher_stop'）。"""

    type: Literal["soccer_stop"]


class SoccerSetStrikerMsg(_StrictModel):
    """老師指定前鋒（每隊強制恰 1 名）。"""

    type: Literal["soccer_set_striker"]
    studentId: str


class SoccerSetTeamMsg(_StrictModel):
    """老師手動分隊（藍 / 紅），取代自動平均分隊。"""

    type: Literal["soccer_set_team"]
    studentId: str
    team: Literal["blue", "red"]


class SoccerResetMsg(_StrictModel):
    """重設足球賽局；clearTeams 連分隊重洗。"""

    type: Literal["soccer_reset"]
    clearTeams: bool = False


TeacherMessage = Annotated[
    TeacherBroadcastMsg
    | ArenaStartMsg
    | ArenaStateReqMsg
    | ArenaStopMsg
    | SoccerStartMsg
    | SoccerStateReqMsg
    | SoccerStopMsg
    | SoccerSetStrikerMsg
    | SoccerSetTeamMsg
    | SoccerResetMsg,
    Field(discriminator="type"),
]
TEACHER_MESSAGE_ADAPTER: TypeAdapter[
    TeacherBroadcastMsg
    | ArenaStartMsg
    | ArenaStateReqMsg
    | ArenaStopMsg
    | SoccerStartMsg
    | SoccerStateReqMsg
    | SoccerStopMsg
    | SoccerSetStrikerMsg
    | SoccerSetTeamMsg
    | SoccerResetMsg
] = TypeAdapter(TeacherMessage)

# ---------- 伺服器 → 客戶端 ----------


class StudentInfo(BaseModel):
    """student_list 名冊項目。"""

    id: str
    name: str
    emoji: str
    connected: bool
    level: str | None
    time: float | None
    suspect: bool = False  # 防作弊標記（標記不阻擋，老師後台顯示用）


class StudentBrief(BaseModel):
    """student_update 項目（與 Node 版一致：不含 connected）。"""

    id: str
    name: str
    emoji: str
    level: str | None
    time: float | None
    suspect: bool = False


class WelcomeMsg(BaseModel):
    """學生連上後的第一則訊息（配發 id）。"""

    type: Literal["welcome"] = "welcome"
    id: str


class StudentListMsg(BaseModel):
    """完整名冊（老師連上 / 名冊變動時扇出）。"""

    type: Literal["student_list"] = "student_list"
    students: list[StudentInfo]


class StudentUpdateMsg(BaseModel):
    """單一學生進度更新（progress / complete_level 時扇出）。"""

    type: Literal["student_update"] = "student_update"
    student: StudentBrief
