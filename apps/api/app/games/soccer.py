"""games/soccer.py — 無人機足球 3v3（多人連線對戰），伺服器權威。

行為對齊 legacy/server.js 的 SOCCER 區塊：自動平均分隊、每隊恰一前鋒（離線遞補）、
進球伺服器驗證、半場重置、tick 判勝與位置廣播。
與 legacy 的刻意差異：
- 倒數由 tick() 推進（legacy setTimeout；取消倒數 legacy 已有 soccer_reset，行為照舊）
- 位置級防作弊（base.py）：座標 clamp、速度上限
- 賽終狀態線上值沿用 legacy 的 'done'（shared/protocol.ts 註記 'ended' 與 legacy 實際不符，
  以 legacy 為準）
- 場地尺寸資料驅動（SoccerField，config 環境變數可調）：soccer_state / soccer_go 下發
  完整 SoccerFieldDef，client 據此渲染 —— 調整大小只改伺服器設定
- 兩種玩法（SoccerStartMsg.mode）：
  'striker'（預設）= FAI 前鋒穿門：只有攻擊手穿對方圓環得分；得分的那一台
    須先回己方半場才能再得分；非攻擊手進入自家圓環記一次犯規（階段一不發牌）。
    賽制：一節 durationSec（預設 3 分鐘）、三局兩勝、局間休息、平手黃金進球、
    再平手 PK 罰球。開賽仍沿用既有 3 秒倒數，不另做 Arm／搶跑。
  'ball'（隱藏選配，須明確指定）= 推球進門：一顆共用球由伺服器 80ms tick 模擬
    （積分 + 輕阻力 + 弱重力向懸浮高度回歸 + 牆面反彈），無人機貼近即沿法線推球，
    球心過門面且在門環半徑內 → 伺服器判進球（推進自家門 = 烏龍球，得分歸對隊）；
    client 的 soccer_goal 上報一律忽略。球模式維持單節、時間到比分，不走三局制。
"""

import logging
import math
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

from ..config import Settings
from ..protocol import SoccerPosMsg
from ..roster import Roster, StudentRecord
from .base import MIN_POS_INTERVAL_MS, BaseGame, FieldBounds, game_player_key

logger = logging.getLogger("creafly.api.games.soccer")

# ---------- 常數 ----------

SOCCER_DURATION_DEFAULT = 180  # 1 局 3 分鐘（測試可送較短 durationSec）
SOCCER_TEAM_NAMES = ("blue", "red")
SOCCER_GOAL_Z_TOL = 1.0  # striker 模式進球驗證：z 與門面的容差（legacy 寫死 1.0）
# 三局兩勝（與 client 文案一致；球模式不使用）
SOCCER_SETS_TO_WIN = 2
SOCCER_MAX_PERIODS = 3
SOCCER_BREAK_SEC = 15  # 局間休息
SOCCER_PK_SHOT_SEC = 20  # 每次罰球限時
SOCCER_PK_MIN_ROUNDS = 3  # 至少各罰三輪，之後仍平手改驟死
# 起飛區：底線中段窄帶（與 client SOCCER_START_WIDTH / DEPTH 一致）
SOCCER_START_DEPTH = 1.0
SOCCER_START_HALF_W = 0.5

# ---------- 推球模式（ball）物理常數 ----------
# 伺服器 80ms tick 模擬；數值以「單位/秒」為主，每 tick 的量以 BALL_TICK_DT 換算

BALL_RADIUS = 1.2  # 球半徑（大顆好推好看；隨 soccer_ball 下發，client 據此渲染）
DRONE_RADIUS = 0.8  # 推球接觸判定用的無人機半徑（與 client SOCCER_BALL_R 球形保護框一致）
BALL_TICK_DT = 0.08  # 物理積分步長 = 賽局 tick 週期（80ms），與假時鐘無關、每 tick 固定
BALL_DRAG = 0.985  # 輕阻力：每 tick 速度衰減倍率
BALL_HOVER_GAIN = 1.5  # 弱重力：向懸浮高度（goalY）回歸的加速度增益（/秒²）
# —— 球漂浮在門環高度附近、掉不到地上，比真重力適合無人機推
BALL_PUSH_MIN = 3.0  # 最小推力（單位/秒）：貼著球慢慢蹭也推得動
BALL_PUSH_SPEED_MULT = 0.8  # 推力與玩家回報位置速度估計的比例：衝得快踢得遠
BALL_BOUNCE = 0.7  # 牆 / 天花板 / 地板反彈的速度衰減
BALL_MAX_SPEED = 20.0  # 球速上限（重疊時每 tick 連推會疊加，防爆衝）


@dataclass(frozen=True)
class SoccerField:
    """場地尺寸（資料驅動）：以 SoccerFieldDef 下發，client 據此渲染。

    half_x / half_z = 場地半寬 / 半長（長軸 z、中線 z=0）；
    goal_y = 門環中心高；goal_r = 門環內半徑；goal_tube = 管半徑；ceil = 天花板高。
    兩門在 z=±goal_z（自底線往場內 goal_inset，與 client 門環視覺同位置）；
    端牆 z=±half_z 是場地邊界。
    """

    half_x: float = 3.5
    half_z: float = 7.0
    goal_y: float = 3.25
    goal_r: float = 0.35
    ceil: float = 5.0
    goal_tube: float = 0.10
    goal_inset: float = 2.0

    @property
    def goal_z(self) -> float:
        """門面 z（進球判定用；client 門環畫在同一位置）。"""
        return self.half_z - self.goal_inset

    @classmethod
    def from_settings(cls, cfg: Settings) -> "SoccerField":
        """由伺服器設定建立（環境變數 SOCCER_HALF_X … 可調，見 config.py）。"""
        return cls(
            half_x=cfg.soccer_half_x,
            half_z=cfg.soccer_half_z,
            goal_y=cfg.soccer_goal_y,
            goal_r=cfg.soccer_goal_r,
            ceil=cfg.soccer_ceil,
            goal_tube=cfg.soccer_goal_tube,
            goal_inset=cfg.soccer_goal_inset,
        )

    def payload(self) -> dict[str, float]:
        """線上格式（SoccerFieldDef，欄位名 camelCase）。"""
        return {
            "halfX": self.half_x,
            "halfZ": self.half_z,
            "goalY": self.goal_y,
            "goalR": self.goal_r,
            "ceil": self.ceil,
            "goalTube": self.goal_tube,
            # 門面 z 一併下發（client field.ts 有帶就用，沒帶才用 halfZ - inset 衍生）
            "goalZ": self.goal_z,
        }


@dataclass
class SoccerBall:
    """推球模式的共用球（伺服器模擬）。last_touch = 最後觸球者（進球歸屬 / 烏龍判定）。"""

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    last_touch: "SoccerPlayer | None" = None


@dataclass
class SoccerPlayer:
    """足球玩家狀態。active=False = 收過 soccer_leave；disconnected=True = WS 斷線可 resume。"""

    record: StudentRecord
    active: bool = True
    disconnected: bool = False
    was_striker: bool = False
    team: str | None = None
    striker: bool = False
    x: float = 0.0
    y: float = 0.4
    z: float = 0.0
    yaw: float = 0.0
    spawn_x: float = 0.0
    spawn_z: float = 0.0
    # 防作弊：上次接受位置回報的時刻（None = 剛加入 / GO 傳送，下一次回報不測速）
    last_pos_ms: float | None = None
    strikes: int = 0
    # 推球模式：由相鄰兩次位置回報估計的速度（單位/秒），決定推球力度
    est_speed: float = 0.0
    # 前鋒穿門：這台剛得分，須先回到己方半場（z 與自家站位同側）才能再得分
    needs_return: bool = False
    # 非攻擊手是否正處於自家圓環內（邊緣觸發犯規，避免每 tick 重播）
    in_own_ring: bool = False


class SoccerGame(BaseGame):
    """足球賽局（狀態自持，掛 app.state.soccer）。"""

    def __init__(self, roster: Roster, field: SoccerField | None = None) -> None:
        super().__init__(roster)
        self.field = field or SoccerField()
        # 玩法：'striker' FAI 前鋒穿門（預設）/ 'ball' 推球進門（隱藏選配）
        self.mode = "striker"
        self.end_time = 0
        self.duration_sec: float = SOCCER_DURATION_DEFAULT
        self.scores: dict[str, int] = {"blue": 0, "red": 0}
        self.armed: dict[str, bool] = {"blue": True, "red": True}  # 得分機回半場前為 False
        self.winner: str | None = None
        self.players: dict[str, SoccerPlayer] = {}
        self.ball: SoccerBall | None = None  # 推球模式開賽（GO）才生成
        # 三局兩勝。phase：idle / period / break / golden / pk
        self.phase = "idle"
        self.period = 0
        self.sets: dict[str, int] = {"blue": 0, "red": 0}
        self.pk_scores: dict[str, int] = {"blue": 0, "red": 0}
        self.pk_taken: dict[str, int] = {"blue": 0, "red": 0}
        self.pk_turn: str | None = None
        self.pk_round = 0
        self.foul_count = 0
        # 防作弊：位置 clamp 邊界（隨場地設定換算，不留舊尺寸殘值）
        self._clamp = FieldBounds(
            max_x=self.field.half_x,
            max_z=self.field.half_z,
            min_y=0.0,
            max_y=self.field.ceil,
        )
        # 每隊站位端 / 攻門 / 守門（z 軸，隨場地換算）：
        # 藍隊站 -z 端、攻 +z 門；紅隊站 +z 端、攻 -z 門。
        # 門在 goal_z（底線往場內 goal_inset、與 client 門環視覺同位置），不是 half_z 端牆。
        self._teams: dict[str, dict[str, float]] = {
            "blue": {
                "stationZ": -self.field.half_z,
                "attackGoalZ": self.field.goal_z,
                "defendGoalZ": -self.field.goal_z,
            },
            "red": {
                "stationZ": self.field.half_z,
                "attackGoalZ": -self.field.goal_z,
                "defendGoalZ": self.field.goal_z,
            },
        }

    # ---------- 內部狀態 ----------

    def _active(self) -> list[SoccerPlayer]:
        """在場且連線中（遊戲邏輯）。"""
        return [
            p
            for p in self.players.values()
            if p.active and not p.disconnected and p.record.connected
        ]

    def _present(self) -> list[SoccerPlayer]:
        """在場玩家（含斷線保留 slot）。"""
        return [p for p in self.players.values() if p.active]

    def _team(self, team: str | None) -> list[SoccerPlayer]:
        return [p for p in self._active() if p.team == team]

    def _striker_of(self, team: str) -> SoccerPlayer | None:
        return next((p for p in self._team(team) if p.striker), None)

    def _auto_assign_team(self, p: SoccerPlayer) -> None:
        """自動平均分隊：新加入者補進人少的隊（藍 / 紅人數差 ≤ 1）。"""
        others = [q for q in self._active() if q is not p]
        blue = sum(1 for q in others if q.team == "blue")
        red = sum(1 for q in others if q.team == "red")
        p.team = "blue" if blue <= red else "red"

    def _ensure_striker(self, team: str | None) -> None:
        """確保某隊恰 1 名前鋒：0 名 → 補第一人；>1 名 → 只留第一個。"""
        if team not in SOCCER_TEAM_NAMES:
            return
        members = self._team(team)
        if not members:
            return
        strikers = [p for p in members if p.striker]
        if len(strikers) == 1:
            return
        keep = strikers[0] if strikers else members[0]
        for p in members:
            p.striker = p is keep

    def _assign_spawns(self) -> None:
        """出生點：底線中段、寬約 1m 的起飛窄帶。前鋒居中，其餘排在帶內。"""
        depth = SOCCER_START_DEPTH
        half_w = SOCCER_START_HALF_W
        for _team, cfg in self._teams.items():
            members = self._team(_team)
            sign = -1.0 if cfg["stationZ"] < 0 else 1.0
            z = round(sign * (self.field.half_z - depth / 2), 2)
            striker = next((p for p in members if p.striker), None)
            defenders = [p for p in members if not p.striker]
            if striker is not None:
                striker.spawn_x = 0.0
                striker.spawn_z = z
            for i, p in enumerate(defenders):
                side = -1 if i % 2 == 0 else 1
                x = side * min(0.35, half_w - 0.1)
                # 超過兩人時在窄帶內往場內錯開，仍不超出進深
                slot = i // 2
                z_off = -sign * min(0.25, depth / 2 - 0.15) * slot
                p.spawn_x = round(x, 2)
                p.spawn_z = round(z + z_off, 2)

    def _reset_ball(self) -> SoccerBall:
        """球重置中場：懸浮高度（goalY）、速度歸零、清最後觸球者。"""
        self.ball = SoccerBall(y=self.field.goal_y)
        return self.ball

    # ---------- payload 組裝（欄位名照 legacy 線上格式）----------

    def _player_info(self, p: SoccerPlayer) -> dict[str, Any]:
        return {
            "id": p.record.id,
            "name": p.record.name,
            "emoji": p.record.emoji,
            "team": p.team,
            "striker": bool(p.striker),
        }

    def _spawns(self) -> list[dict[str, Any]]:
        return [{"id": p.record.id, "x": p.spawn_x, "z": p.spawn_z} for p in self._active()]

    def _ball_payload(self) -> dict[str, float] | None:
        """SoccerBallState 線上格式（含半徑 r，client 據此渲染與預測接觸）。"""
        if self.ball is None:
            return None
        return {
            "x": round(self.ball.x, 2),
            "y": round(self.ball.y, 2),
            "z": round(self.ball.z, 2),
            "r": BALL_RADIUS,
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "type": "soccer_state",
            "status": self.status,
            "mode": self.mode,
            "endTime": self.end_time,
            "durationSec": self.duration_sec,
            "scores": self.scores,
            "armed": self.armed,
            "winner": self.winner,
            "players": [self._player_info(p) for p in self._present()],
            "spawns": self._spawns(),
            "field": self.field.payload(),
            "ball": self._ball_payload(),
            "match": self._match_payload(),
        }

    async def broadcast_state(self) -> None:
        """完整快照廣播：在場玩家 + 老師後台（分隊 / 前鋒異動都走這裡）。"""
        snap = self.snapshot()
        await self._broadcast(self._present(), snap)
        await self._broadcast_teachers(snap)

    def _match_payload(self) -> dict[str, Any]:
        """三局兩勝／黃金進球／PK 進度（SoccerMatchMeta）。"""
        return {
            "phase": self.phase,
            "period": self.period,
            "sets": dict(self.sets),
            "pkScores": dict(self.pk_scores),
            "pkTurn": self.pk_turn,
            "pkRound": self.pk_round,
        }

    def _clear_return_flags(self) -> None:
        for p in self.players.values():
            p.needs_return = False
            p.in_own_ring = False
        self.armed = {"blue": True, "red": True}

    def _sync_armed(self) -> None:
        """攻擊手若剛得分還沒回半場，該隊 armed=false（只鎖那一台，不是整隊）。"""
        for team in SOCCER_TEAM_NAMES:
            st = self._striker_of(team)
            self.armed[team] = st is None or not st.needs_return

    def _inside_goal(self, p: SoccerPlayer, goal_z: float) -> bool:
        return (
            abs(p.z - goal_z) < SOCCER_GOAL_Z_TOL
            and math.hypot(p.x, p.y - self.field.goal_y) < self.field.goal_r
        )

    def _winner_now(self) -> str:
        """依局數、當前節比分、PK 點球決定勝者；都平手才是 draw。"""
        if self.phase == "pk" and self.pk_scores["blue"] != self.pk_scores["red"]:
            return "blue" if self.pk_scores["blue"] > self.pk_scores["red"] else "red"
        if self.sets["blue"] != self.sets["red"]:
            return "blue" if self.sets["blue"] > self.sets["red"] else "red"
        if self.scores["blue"] != self.scores["red"]:
            return "blue" if self.scores["blue"] > self.scores["red"] else "red"
        return "draw"

    async def broadcast_scores(self, *, include_spawns: bool = False) -> None:
        msg: dict[str, Any] = {
            "type": "soccer_scores",
            "scores": self.scores,
            "armed": self.armed,
            "status": self.status,
            "endTime": self.end_time,
            "match": self._match_payload(),
        }
        if include_spawns:
            msg["spawns"] = self._spawns()
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)

    # ---------- 學生訊息 ----------

    async def join(self, record: StudentRecord) -> None:
        """加入足球：自動平均分隊；斷線恢復保留位置與前鋒。"""
        key = game_player_key(record)
        p = self.players.get(key)
        resuming = p is not None and p.active and p.disconnected

        if p is None:
            p = SoccerPlayer(record=record)
            self.players[key] = p
            p.x, p.y, p.z, p.yaw = 0.0, 0.4, 0.0, 0.0
            p.last_pos_ms = None
        elif resuming:
            p.record = record
            p.disconnected = False
        elif not p.active:
            p.record = record
            p.active = True
            p.disconnected = False
            p.x, p.y, p.z, p.yaw = 0.0, 0.4, 0.0, 0.0
            p.last_pos_ms = None
        else:
            p.record = record

        p.active = True
        p.disconnected = False
        if p.team not in SOCCER_TEAM_NAMES:
            self._auto_assign_team(p)
        if resuming and p.was_striker and p.team in SOCCER_TEAM_NAMES:
            for other in self.players.values():
                if other.team == p.team and other is not p:
                    other.striker = False
            p.striker = True
            p.was_striker = False
        else:
            self._ensure_striker(p.team)
        if not resuming:
            p.last_pos_ms = None
        await self._send(record, self.snapshot())
        if resuming:
            await self._send(
                record,
                {
                    "type": "soccer_resume",
                    "x": p.x,
                    "y": p.y,
                    "z": p.z,
                    "yaw": p.yaw,
                },
            )
        await self.broadcast_state()
        logger.info(
            "[Soccer] %s%s 加入 → %s%s",
            record.name,
            record.emoji,
            p.team,
            "（前鋒）" if p.striker else "",
        )

    async def leave(self, record: StudentRecord) -> None:
        """離開足球（soccer_leave 或加入大亂鬥時的互斥退出）；前鋒離開 → 遞補。"""
        p = self.players.get(game_player_key(record))
        if p is None or not p.active:
            return
        was_striker, team = p.striker, p.team
        p.active = False
        p.disconnected = False
        p.striker = False
        p.was_striker = False
        if was_striker and team:
            self._ensure_striker(team)
        await self.broadcast_state()

    async def disconnect(self, record: StudentRecord) -> None:
        """WS 斷線：保留 slot；前鋒暫時遞補給連線隊友。"""
        p = self.players.get(game_player_key(record))
        if p is None or not p.active or p.disconnected:
            return
        p.was_striker = p.striker
        p.disconnected = True
        if p.striker and p.team:
            p.striker = False
            self._ensure_striker(p.team)
        await self.broadcast_state()

    async def drop(self, record: StudentRecord) -> None:
        """強制移除（踢人 / 移房）。"""
        p = self.players.pop(game_player_key(record), None)
        if p is None or not p.active:
            return
        if p.striker and p.team:
            self._ensure_striker(p.team)
        await self.broadcast_state()

    def _player_for(self, record: StudentRecord) -> SoccerPlayer | None:
        return self.players.get(game_player_key(record))

    async def pos(self, record: StudentRecord, msg: SoccerPosMsg) -> None:
        """位置回報：clamp + 速度上限（防作弊，見 base.py）＋ 推球用的速度估計。"""
        p = self._player_for(record)
        if p is None or not p.active or p.disconnected:
            return
        prev = (p.x, p.y, p.z)
        prev_ms = p.last_pos_ms
        ok = await self._apply_pos(p, self._clamp, msg.x, msg.y, msg.z, msg.yaw, "足球")
        if ok and prev_ms is not None:
            # 推球力度用：相鄰兩次「被接受的」位置回報換算速度（分母下限同防作弊測速）
            dt_sec = max(MIN_POS_INTERVAL_MS, p.last_pos_ms - prev_ms) / 1000.0
            p.est_speed = math.dist((p.x, p.y, p.z), prev) / dt_sec

    async def goal(self, record: StudentRecord) -> None:
        """進球宣告（striker 模式）。

        ball 模式進球由伺服器的球物理判定（_tick_ball），client 上報一律忽略。
        正規局／黃金進球：只有攻擊手、且這台還沒被「須回半場」鎖住、人在對方圓環內才算。
        得分後鎖的是這一台（needs_return），不是整隊。
        PK：只有輪到的攻擊手穿對方圓環算一記點球。
        """
        if self.mode == "ball":
            return
        if self.status == "pk":
            await self._pk_attempt(record)
            return
        p = self._player_for(record)
        if (
            self.status not in ("running", "golden")
            or p is None
            or not p.active
            or p.disconnected
            or not p.striker
            or p.team not in SOCCER_TEAM_NAMES
            or p.needs_return
        ):
            return
        cfg = self._teams[p.team]
        if not self._inside_goal(p, cfg["attackGoalZ"]):
            return
        self.scores[p.team] += 1
        ok = {
            "type": "soccer_goal_ok",
            "team": p.team,
            "by": record.id,
            "byName": record.name,
            "scores": self.scores,
        }
        if self.status == "golden":
            await self._broadcast(self._active(), ok)
            await self._broadcast_teachers(ok)
            logger.info(
                "[Soccer] ⚡ 黃金進球 %s（%s）！藍 %d : %d 紅",
                record.name,
                p.team,
                self.scores["blue"],
                self.scores["red"],
            )
            await self._end("golden")
            return
        # 正規局：這台須先回己方半場才能再得分
        p.needs_return = True
        self._sync_armed()
        await self._broadcast(self._active(), ok)
        await self._broadcast_teachers(ok)
        await self.broadcast_scores()
        logger.info(
            "[Soccer] ⚽ %s（%s）進球！藍 %d : %d 紅",
            record.name,
            p.team,
            self.scores["blue"],
            self.scores["red"],
        )

    # ---------- 老師訊息 ----------

    async def start(self, duration_sec: float, mode: str = "striker") -> None:
        """開始比賽：預設前鋒穿門。比分與局數歸零、補齊前鋒、進入既有 3 秒倒數。"""
        self.mode = mode if mode in ("ball", "striker") else "striker"
        self.duration_sec = max(5, duration_sec or SOCCER_DURATION_DEFAULT)
        self.scores = {"blue": 0, "red": 0}
        self.sets = {"blue": 0, "red": 0}
        self.pk_scores = {"blue": 0, "red": 0}
        self.pk_taken = {"blue": 0, "red": 0}
        self.pk_turn = None
        self.pk_round = 0
        self.foul_count = 0
        self.period = 1
        self.phase = "period"
        self._clear_return_flags()
        self.winner = None
        self.ball = None  # GO 才把球放到中場（僅 ball 模式）
        self._ensure_striker("blue")  # 開賽前未指定的隊 → 自動補第一人
        self._ensure_striker("red")
        self._assign_spawns()
        self._clear_return_flags()
        self.status = "countdown"
        await self.broadcast_state()
        await self._begin_countdown()

    async def stop(self, reason: str = "teacher_stop") -> None:
        """老師手動停止（soccer_stop）/ 切關智能停止（reason='level_switch'）。

        倒數中或進行中皆可：先廣播 soccer_end（winner 依當下比分或 draw），再回 idle
        讓老師可直接開下一場。
        """
        if self.status not in ("countdown", "running", "break", "golden", "pk"):
            return
        await self._end(reason)
        self.status = "idle"
        self.phase = "idle"
        self.end_time = 0
        self.ball = None
        await self.broadcast_state()
        logger.info("[Soccer] 停止本場（%s），回 idle", reason)

    async def send_snapshot_to(self, ws: WebSocket) -> None:
        """soccer_state_req：回一份完整快照給請求的老師。"""
        await self._send_ws(ws, self.snapshot())

    async def set_striker(self, student_id: str) -> None:
        """老師指定前鋒（每隊強制恰 1 名）。"""
        p = next((q for q in self._active() if q.record.id == student_id), None)
        if p is None or p.team not in SOCCER_TEAM_NAMES:
            return
        for q in self._team(p.team):
            q.striker = q is p
        await self.broadcast_state()

    async def set_team(self, student_id: str, team: str) -> None:
        """老師指定隊伍：換隊時原隊 / 新隊都重新確保前鋒恰 1 名。"""
        p = next((q for q in self._active() if q.record.id == student_id), None)
        if p is None or p.team == team:
            return
        old_team = p.team
        p.team = team
        p.striker = False
        if old_team:
            self._ensure_striker(old_team)
        self._ensure_striker(team)
        await self.broadcast_state()

    async def reset(self, clear_teams: bool) -> None:
        """重設賽局 / 開新場：回 idle、比分歸零、清前鋒；clearTeams 連分隊重洗。

        倒數中呼叫即取消倒數（status 離開 countdown，tick 不再推進 — 對齊 legacy）。
        """
        self.status = "idle"
        self.phase = "idle"
        self.period = 0
        self.scores = {"blue": 0, "red": 0}
        self.sets = {"blue": 0, "red": 0}
        self.pk_scores = {"blue": 0, "red": 0}
        self.pk_taken = {"blue": 0, "red": 0}
        self.pk_turn = None
        self.pk_round = 0
        self.foul_count = 0
        self._clear_return_flags()
        self.winner = None
        self.end_time = 0
        self.ball = None
        players = self._active()
        for p in players:
            p.striker = False
            p.needs_return = False
            p.in_own_ring = False
            if clear_teams:
                p.team = None
        if clear_teams:
            for i, p in enumerate(players):
                p.team = "blue" if i % 2 == 0 else "red"
        await self.broadcast_state()
        logger.info(
            "[Soccer] 重設%s，在場 %d 人", "（重新分隊）" if clear_teams else "", len(players)
        )

    # ---------- 倒數 / 開賽 / 結束 ----------

    async def _send_countdown(self, n: int) -> None:
        await self._broadcast(self._active(), {"type": "soccer_countdown", "n": n})

    async def _go(self) -> None:
        """倒數結束，打開第 1 局（之後的局不再倒數）。"""
        await self._open_period(first=True)

    async def _open_period(self, *, first: bool) -> None:
        """一節開始：比分歸零、攻擊手解鎖、出生點送回起飛區、廣播 soccer_go。"""
        self.phase = "period"
        self.status = "running"
        self.scores = {"blue": 0, "red": 0}
        self._clear_return_flags()
        if not first and self.mode != "ball":
            self._assign_spawns()
        players = self._active()
        for p in players:
            p.last_pos_ms = None  # 傳送到出生點 → 重置測速基準
            p.est_speed = 0.0
            p.needs_return = False
            p.in_own_ring = False
        self.end_time = int(self.now_ms() + self.duration_sec * 1000)
        if self.mode == "ball":
            self._reset_ball()  # 球放中場（懸浮高度）
        await self._broadcast(
            players,
            {
                "type": "soccer_go",
                "endTime": self.end_time,
                "spawns": self._spawns(),
                "players": [self._player_info(p) for p in players],
                "field": self.field.payload(),
                "mode": self.mode,
                "ball": self._ball_payload(),
                "match": self._match_payload(),
            },
        )
        await self.broadcast_scores()
        logger.info(
            "[Soccer] 第 %s 局開始！%s %ss，藍 %d 紅 %d",
            self.period,
            self.mode,
            self.duration_sec,
            len(self._team("blue")),
            len(self._team("red")),
        )

    async def _end(self, reason: str) -> None:
        # 線上值 'done' 沿用 legacy（見模組 docstring）
        self.winner = self._winner_now()
        self.status = "done"
        blue, red = self.scores["blue"], self.scores["red"]
        players = self._active()
        msg = {
            "type": "soccer_end",
            "reason": reason,
            "winner": self.winner,
            "scores": self.scores,
            "players": [self._player_info(p) for p in players],
            "match": self._match_payload(),
        }
        await self._broadcast(players, msg)
        await self._broadcast_teachers(msg)
        await self.broadcast_scores()
        logger.info(
            "[Soccer] 結束：藍 %d : %d 紅 → winner=%s（%s）", blue, red, self.winner, reason
        )

    # ---------- 推球模式：球物理（80ms tick）----------

    async def _tick_ball(self) -> None:
        """一步球物理：無人機推球 → 積分 + 阻力 + 懸浮回歸 → 牆面反彈 → 進球判定 → 廣播。"""
        b = self.ball
        if b is None:
            return
        f = self.field
        dt = BALL_TICK_DT
        # 無人機推球：任一玩家最後回報位置與球距 < r球 + r機 → 沿法線給推力
        for p in self._active():
            if p.last_pos_ms is None:
                continue  # GO 後尚未回報位置，視為未接觸
            dx, dy, dz = b.x - p.x, b.y - p.y, b.z - p.z
            d = math.sqrt(dx * dx + dy * dy + dz * dz)
            if d >= BALL_RADIUS + DRONE_RADIUS:
                continue
            if d < 1e-6:
                # 完全重疊（極罕見）：往該隊攻門方向推
                atk = self._teams.get(p.team or "", self._teams["blue"])["attackGoalZ"]
                nx, ny, nz = 0.0, 0.0, math.copysign(1.0, atk)
            else:
                nx, ny, nz = dx / d, dy / d, dz / d
            power = BALL_PUSH_MIN + p.est_speed * BALL_PUSH_SPEED_MULT
            b.vx += nx * power
            b.vy += ny * power
            b.vz += nz * power
            b.last_touch = p  # 記錄最後觸球者（進球歸屬 / 烏龍判定）
        # 球速上限（接觸期間每 tick 連推會疊加）
        speed = math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
        if speed > BALL_MAX_SPEED:
            k = BALL_MAX_SPEED / speed
            b.vx, b.vy, b.vz = b.vx * k, b.vy * k, b.vz * k
        # 積分 + 輕阻力 + 弱重力向懸浮高度（goalY）回歸（球漂浮、掉不到地上）
        z0 = b.z  # 積分前 z：門面穿越判定用（只認「由場內向外」穿越，回穿不算）
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.z += b.vz * dt
        b.vx *= BALL_DRAG
        b.vy *= BALL_DRAG
        b.vz *= BALL_DRAG
        b.vy += (f.goal_y - b.y) * BALL_HOVER_GAIN * dt
        # 側牆 / 地板 / 天花板反彈（×BALL_BOUNCE）
        if abs(b.x) > f.half_x - BALL_RADIUS:
            b.x = math.copysign(f.half_x - BALL_RADIUS, b.x)
            b.vx = -b.vx * BALL_BOUNCE
        if b.y < BALL_RADIUS:
            b.y = BALL_RADIUS
            b.vy = -b.vy * BALL_BOUNCE
        elif b.y > f.ceil - BALL_RADIUS:
            b.y = f.ceil - BALL_RADIUS
            b.vy = -b.vy * BALL_BOUNCE
        # 門面（z=±goal_z，與 client 門環視覺同位置）：球心由場內向外穿越門面
        # 且在門環半徑內 → 進球（_ball_goal 會把球重置回中場）。
        # 沒進門的球一律被端牆（z=±half_z）反彈；門面～端牆之間是門後退場空間，
        # 球在該區域可自由移動、也可穿過門環回到場內（回穿不計分）。
        crossed_goal = (z0 < f.goal_z <= b.z) or (z0 > -f.goal_z >= b.z)
        if crossed_goal and math.hypot(b.x, b.y - f.goal_y) < f.goal_r:
            await self._ball_goal(1 if b.z > 0 else -1)
        elif abs(b.z) > f.half_z - BALL_RADIUS:
            b.z = math.copysign(f.half_z - BALL_RADIUS, b.z)
            b.vz = -b.vz * BALL_BOUNCE
        # 每 tick 廣播球位置（僅 running 期間會走到這裡）
        msg = {"type": "soccer_ball", "ball": self._ball_payload()}
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)

    async def _ball_goal(self, goal_sign: int) -> None:
        """球心過門面：得分歸該門的攻方；最後觸球者屬守方 = 烏龍球（own=true）。"""
        toucher = self.ball.last_touch if self.ball else None
        # +z 門 = 藍隊攻門 → 藍得分；-z 門 → 紅得分（依 _teams 換算，不寫死）
        scoring = next(
            t for t, cfg in self._teams.items() if cfg["attackGoalZ"] * goal_sign > 0
        )
        own = toucher is not None and toucher.team != scoring
        self.scores[scoring] += 1
        # 沿用 armed：進球隊先鎖，該隊攻擊手過中線回自家半場才恢復（球模式不走三局制）
        st = self._striker_of(scoring)
        if st is not None:
            st.needs_return = True
        self.armed[scoring] = False
        ok = {
            "type": "soccer_goal_ok",
            "team": scoring,
            "by": toucher.record.id if toucher else "",
            "byName": toucher.record.name if toucher else "",
            "scores": self.scores,
            "own": own,
        }
        await self._broadcast(self._active(), ok)
        await self._broadcast_teachers(ok)
        await self.broadcast_scores()
        # 進球後球重置中場、雙方退回（armed 機制，client 端引導）
        self._reset_ball()
        logger.info(
            "[Soccer] ⚽ %s 把球推進%s門（%s 得分%s）！藍 %d : %d 紅",
            toucher.record.name if toucher else "？",
            "＋z" if goal_sign > 0 else "－z",
            scoring,
            "，烏龍球" if own else "",
            self.scores["blue"],
            self.scores["red"],
        )

    # ---------- 賽制：三局兩勝 / 局間 / 黃金進球 / PK ----------

    def _on_own_half(self, p: SoccerPlayer) -> bool:
        """己方半場：與自家站位同一側（中線 z=0 不算，必須過線）。"""
        cfg = self._teams.get(p.team or "")
        if cfg is None:
            return False
        return p.z < 0 if cfg["stationZ"] < 0 else p.z > 0

    async def _tick_returns(self) -> None:
        """得分的那一台回到己方半場 → 解除 needs_return。"""
        changed = False
        for p in self._active():
            if p.needs_return and self._on_own_half(p):
                p.needs_return = False
                changed = True
        if changed:
            self._sync_armed()
            await self.broadcast_scores()

    async def _tick_fouls(self) -> None:
        """非攻擊手進入自家圓環 = 犯規（邊緣觸發，階段一只公告）。"""
        if self.mode != "striker":
            return
        for p in self._active():
            if p.team not in SOCCER_TEAM_NAMES:
                continue
            inside = (not p.striker) and self._inside_goal(p, self._teams[p.team]["defendGoalZ"])
            if inside and not p.in_own_ring:
                p.in_own_ring = True
                self.foul_count += 1
                msg = {
                    "type": "soccer_foul",
                    "team": p.team,
                    "by": p.record.id,
                    "byName": p.record.name,
                    "reason": "own_ring",
                }
                await self._broadcast(self._active(), msg)
                await self._broadcast_teachers(msg)
                logger.info("[Soccer] 犯規 %s（%s）進入自家圓環", p.record.name, p.team)
            elif not inside:
                p.in_own_ring = False

    async def _resolve_period(self) -> None:
        """一節時間到：進球多者贏下該局。先搶兩局結束；三局打完仍平手進黃金進球。"""
        if self.scores["blue"] > self.scores["red"]:
            self.sets["blue"] += 1
        elif self.scores["red"] > self.scores["blue"]:
            self.sets["red"] += 1
        if self.sets["blue"] >= SOCCER_SETS_TO_WIN or self.sets["red"] >= SOCCER_SETS_TO_WIN:
            await self._end("sets")
            return
        if self.period < SOCCER_MAX_PERIODS:
            await self._begin_break()
            return
        if self.sets["blue"] != self.sets["red"]:
            await self._end("sets")
            return
        await self._begin_golden()

    async def _begin_break(self) -> None:
        self.phase = "break"
        self.status = "break"
        self.end_time = int(self.now_ms() + SOCCER_BREAK_SEC * 1000)
        await self.broadcast_scores()
        logger.info(
            "[Soccer] 局間休息 %ss（局數 藍 %d : %d 紅）",
            SOCCER_BREAK_SEC,
            self.sets["blue"],
            self.sets["red"],
        )

    async def _begin_golden(self) -> None:
        """黃金進球：時限與一節相同，先進球者勝；時間到仍 0:0 則 PK。"""
        self.phase = "golden"
        self.status = "golden"
        self.scores = {"blue": 0, "red": 0}
        self._clear_return_flags()
        for p in self._active():
            p.last_pos_ms = None
        self.end_time = int(self.now_ms() + self.duration_sec * 1000)
        await self.broadcast_state()
        await self.broadcast_scores()
        logger.info("[Soccer] 平手，進入黃金進球（%ss）", self.duration_sec)

    def _pk_spot(self, team: str) -> tuple[float, float]:
        """罰球點：對方門面前 2.5m、左右置中。"""
        cfg = self._teams[team]
        sign = 1.0 if cfg["attackGoalZ"] > 0 else -1.0
        z = round(cfg["attackGoalZ"] - sign * 2.5, 2)
        return 0.0, z

    async def _arm_pk_clock(self) -> None:
        """開始（或換）一次罰球：限時，並把輪到的攻擊手出生點改到罰球點。"""
        self.end_time = int(self.now_ms() + SOCCER_PK_SHOT_SEC * 1000)
        turn = self.pk_turn
        if turn:
            shooter = self._striker_of(turn)
            if shooter is not None:
                x, z = self._pk_spot(turn)
                shooter.spawn_x = x
                shooter.spawn_z = z
                shooter.last_pos_ms = None
        await self.broadcast_scores(include_spawns=True)

    async def _begin_pk(self) -> None:
        self.phase = "pk"
        self.status = "pk"
        self.pk_scores = {"blue": 0, "red": 0}
        self.pk_taken = {"blue": 0, "red": 0}
        self.pk_round = 1
        self.pk_turn = "blue"
        self._clear_return_flags()
        logger.info("[Soccer] 黃金進球仍平手，進入 PK")
        await self._arm_pk_clock()

    async def _pk_attempt(self, record: StudentRecord) -> None:
        """輪到的攻擊手穿對方圓環 = 這記點球命中，立刻換邊。"""
        p = self._player_for(record)
        if (
            p is None
            or not p.active
            or p.disconnected
            or not p.striker
            or p.team != self.pk_turn
            or p.team not in SOCCER_TEAM_NAMES
        ):
            return
        if not self._inside_goal(p, self._teams[p.team]["attackGoalZ"]):
            return
        self.pk_scores[p.team] += 1
        ok = {
            "type": "soccer_goal_ok",
            "team": p.team,
            "by": record.id,
            "byName": record.name,
            "scores": self.scores,
            "pk": True,
        }
        await self._broadcast(self._active(), ok)
        await self._broadcast_teachers(ok)
        logger.info(
            "[Soccer] PK %s（%s）命中，點球 藍 %d : %d 紅",
            record.name,
            p.team,
            self.pk_scores["blue"],
            self.pk_scores["red"],
        )
        await self._finish_pk_shot()

    async def _finish_pk_shot(self) -> None:
        """一記罰球結束（進了或時間到沒進）。雙方輪數相同且已滿最低輪次、分出高下就結束。"""
        team = self.pk_turn
        if team not in SOCCER_TEAM_NAMES or self.status != "pk":
            return
        self.pk_taken[team] += 1
        other = "red" if team == "blue" else "blue"
        if self.pk_taken["blue"] == self.pk_taken["red"]:
            if (
                self.pk_round >= SOCCER_PK_MIN_ROUNDS
                and self.pk_scores["blue"] != self.pk_scores["red"]
            ):
                await self._end("pk")
                return
            self.pk_round += 1
            self.pk_turn = "blue"
        else:
            self.pk_turn = other
        await self._arm_pk_clock()

    # ---------- tick（legacy setInterval 80ms 的對應）----------

    async def tick(self) -> None:
        """推進賽局：倒數、回半場、犯規、球物理、節次／黃金／PK 換邊、位置廣播。"""
        now = self.now_ms()
        if self.status == "countdown":
            await self._tick_countdown()
        if self.status in ("running", "golden"):
            await self._tick_returns()
            await self._tick_fouls()
            if self.mode == "ball" and self.status == "running":
                await self._tick_ball()
        if self.status == "running" and now >= self.end_time:
            if self.mode == "ball":
                await self._end("time")
            else:
                await self._resolve_period()
        elif self.status == "break" and now >= self.end_time:
            self.period += 1
            await self._open_period(first=False)
        elif self.status == "golden" and now >= self.end_time:
            await self._begin_pk()
        elif self.status == "pk" and now >= self.end_time:
            await self._finish_pk_shot()
        players = self._present()
        if players:
            await self._broadcast(
                players,
                {
                    "type": "soccer_players",
                    "players": [
                        {
                            "id": p.record.id,
                            "name": p.record.name,
                            "emoji": p.record.emoji,
                            "team": p.team,
                            "striker": bool(p.striker),
                            "x": p.x,
                            "y": p.y,
                            "z": p.z,
                            "yaw": p.yaw,
                        }
                        for p in players
                    ],
                },
            )
