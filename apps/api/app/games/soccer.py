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
  'ball'（預設）= 推球進門：一顆共用球由伺服器 80ms tick 模擬（積分 + 輕阻力 +
    弱重力向懸浮高度回歸 + 牆面反彈），無人機貼近即沿法線推球，球心過門面且在
    門環半徑內 → 伺服器判進球（推進自家門 = 烏龍球，得分歸對隊）；client 的
    soccer_goal 上報一律忽略
  'striker' = FAI 前鋒穿門（legacy 行為）：前鋒 / armed / 位置在對方門環容差內
"""

import logging
import math
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

from ..config import Settings
from ..protocol import SoccerPosMsg
from ..roster import Roster, StudentRecord
from .base import MIN_POS_INTERVAL_MS, BaseGame, FieldBounds

logger = logging.getLogger("creafly.api.games.soccer")

# ---------- 常數 ----------

SOCCER_DURATION_DEFAULT = 180  # 1 局 3 分鐘（測試可送較短 durationSec）
SOCCER_TEAM_NAMES = ("blue", "red")
SOCCER_GOAL_Z_TOL = 1.0  # striker 模式進球驗證：z 與門面的容差（legacy 寫死 1.0）

# ---------- 推球模式（ball）物理常數 ----------
# 伺服器 80ms tick 模擬；數值以「單位/秒」為主，每 tick 的量以 BALL_TICK_DT 換算

BALL_RADIUS = 1.2  # 球半徑（大顆好推好看；隨 soccer_ball 下發，client 據此渲染）
DRONE_RADIUS = 0.65  # 推球接觸判定用的無人機半徑（接觸門檻 = 球半徑 + 此值）
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

    half_x / half_z = 場地半寬 / 半長（長軸 z、兩門在 z=±half_z 端牆、中線 z=0）；
    goal_y = 門環中心高；goal_r = 門環半徑；ceil = 天花板高。
    """

    half_x: float = 10.0
    half_z: float = 20.0
    goal_y: float = 4.5
    goal_r: float = 3.0
    ceil: float = 15.0

    @classmethod
    def from_settings(cls, cfg: Settings) -> "SoccerField":
        """由伺服器設定建立（環境變數 SOCCER_HALF_X … 可調，見 config.py）。"""
        return cls(
            half_x=cfg.soccer_half_x,
            half_z=cfg.soccer_half_z,
            goal_y=cfg.soccer_goal_y,
            goal_r=cfg.soccer_goal_r,
            ceil=cfg.soccer_ceil,
        )

    def payload(self) -> dict[str, float]:
        """線上格式（SoccerFieldDef，欄位名 camelCase）。"""
        return {
            "halfX": self.half_x,
            "halfZ": self.half_z,
            "goalY": self.goal_y,
            "goalR": self.goal_r,
            "ceil": self.ceil,
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
    """足球玩家狀態。active=False = 收過 soccer_leave（隊伍保留）；斷線整筆移除。"""

    record: StudentRecord
    active: bool = True
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


class SoccerGame(BaseGame):
    """足球賽局（狀態自持，掛 app.state.soccer）。"""

    def __init__(self, roster: Roster, field: SoccerField | None = None) -> None:
        super().__init__(roster)
        self.field = field or SoccerField()
        # 玩法：'ball' 推球進門（預設）/ 'striker' FAI 前鋒穿門（soccer_start 可指定）
        self.mode = "ball"
        self.end_time = 0
        self.duration_sec: float = SOCCER_DURATION_DEFAULT
        self.scores: dict[str, int] = {"blue": 0, "red": 0}
        self.armed: dict[str, bool] = {"blue": True, "red": True}  # 半場重置用
        self.winner: str | None = None
        self.players: dict[str, SoccerPlayer] = {}
        self.ball: SoccerBall | None = None  # 推球模式開賽（GO）才生成
        # 防作弊：位置 clamp 邊界（隨場地設定換算，不留舊尺寸殘值）
        self._clamp = FieldBounds(
            max_x=self.field.half_x,
            max_z=self.field.half_z,
            min_y=0.0,
            max_y=self.field.ceil,
        )
        # 每隊站位端 / 攻門 / 守門（z 軸，隨場地換算）：
        # 藍隊站 -z 端、攻 +z 門；紅隊站 +z 端、攻 -z 門
        self._teams: dict[str, dict[str, float]] = {
            "blue": {
                "stationZ": -self.field.half_z,
                "attackGoalZ": self.field.half_z,
                "defendGoalZ": -self.field.half_z,
            },
            "red": {
                "stationZ": self.field.half_z,
                "attackGoalZ": -self.field.half_z,
                "defendGoalZ": self.field.half_z,
            },
        }

    # ---------- 內部狀態 ----------

    def _active(self) -> list[SoccerPlayer]:
        """在場玩家（加入中且連線中）— 對齊 legacy soccerPlayers()。"""
        return [p for p in self.players.values() if p.active and p.record.connected]

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
        """出生點：前鋒站中間（x≈0），防守沿 x 兩側排開；皆在自隊站位端、略內縮。"""
        for team, cfg in self._teams.items():
            members = self._team(team)
            z = round(cfg["stationZ"] * 0.85, 2)
            striker = next((p for p in members if p.striker), None)
            defenders = [p for p in members if not p.striker]
            if striker is not None:
                striker.spawn_x = 0.0
                striker.spawn_z = z
            for i, p in enumerate(defenders):
                side = -1 if i % 2 == 0 else 1
                mag = self.field.half_x * (0.5 + 0.35 * (i // 2))
                p.spawn_x = round(side * mag, 2)
                p.spawn_z = z

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
            "players": [self._player_info(p) for p in self._active()],
            "spawns": self._spawns(),
            "field": self.field.payload(),
            "ball": self._ball_payload(),
        }

    async def broadcast_state(self) -> None:
        """完整快照廣播：在場玩家 + 老師後台（分隊 / 前鋒異動都走這裡）。"""
        snap = self.snapshot()
        await self._broadcast(self._active(), snap)
        await self._broadcast_teachers(snap)

    async def broadcast_scores(self) -> None:
        msg = {
            "type": "soccer_scores",
            "scores": self.scores,
            "armed": self.armed,
            "status": self.status,
            "endTime": self.end_time,
        }
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)

    # ---------- 學生訊息 ----------

    async def join(self, record: StudentRecord) -> None:
        """加入足球：自動平均分隊（曾加入過則沿用原隊）＋ 確保該隊恰一前鋒。"""
        p = self.players.get(record.id)
        if p is None:
            p = SoccerPlayer(record=record)
            self.players[record.id] = p
        p.active = True
        p.record = record
        p.last_pos_ms = None  # 新加入不測速第一筆回報
        if p.team not in SOCCER_TEAM_NAMES:
            self._auto_assign_team(p)
        self._ensure_striker(p.team)
        await self._send(record, self.snapshot())
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
        p = self.players.get(record.id)
        if p is None or not p.active:
            return
        was_striker, team = p.striker, p.team
        p.active = False
        p.striker = False
        if was_striker and team:
            self._ensure_striker(team)
        await self.broadcast_state()

    async def drop(self, record: StudentRecord) -> None:
        """斷線清理：整筆移除；前鋒斷線 → 遞補。"""
        p = self.players.pop(record.id, None)
        if p is None or not p.active:
            return
        if p.striker and p.team:
            self._ensure_striker(p.team)
        await self.broadcast_state()

    async def pos(self, record: StudentRecord, msg: SoccerPosMsg) -> None:
        """位置回報：clamp + 速度上限（防作弊，見 base.py）＋ 推球用的速度估計。"""
        p = self.players.get(record.id)
        if p is None or not p.active:
            return
        prev = (p.x, p.y, p.z)
        prev_ms = p.last_pos_ms
        ok = await self._apply_pos(p, self._clamp, msg.x, msg.y, msg.z, msg.yaw, "足球")
        if ok and prev_ms is not None:
            # 推球力度用：相鄰兩次「被接受的」位置回報換算速度（分母下限同防作弊測速）
            dt_sec = max(MIN_POS_INTERVAL_MS, p.last_pos_ms - prev_ms) / 1000.0
            p.est_speed = math.dist((p.x, p.y, p.z), prev) / dt_sec

    async def goal(self, record: StudentRecord) -> None:
        """進球宣告（striker 模式）：前鋒 / armed / 位置確在對方門環容差內才算。

        ball 模式進球由伺服器的球物理判定（_tick_ball），client 上報一律忽略。
        """
        if self.mode == "ball":
            return
        p = self.players.get(record.id)
        if (
            self.status != "running"
            or p is None
            or not p.active
            or not p.striker
            or p.team not in SOCCER_TEAM_NAMES
            or not self.armed[p.team]
        ):
            return
        cfg = self._teams[p.team]
        near_goal = (
            abs(p.z - cfg["attackGoalZ"]) < SOCCER_GOAL_Z_TOL
            and abs(p.x) < self.field.goal_r
            and abs(p.y - self.field.goal_y) < self.field.goal_r
        )
        if not near_goal:
            return
        self.scores[p.team] += 1
        self.armed[p.team] = False  # 半場重置：前鋒須過中線回自家半場才能再得分
        ok = {
            "type": "soccer_goal_ok",
            "team": p.team,
            "by": record.id,
            "byName": record.name,
            "scores": self.scores,
        }
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

    async def start(self, duration_sec: float, mode: str = "ball") -> None:
        """開始比賽：設定玩法、比分歸零、補齊前鋒、指派出生點、進入 3 秒倒數。"""
        self.mode = mode
        self.duration_sec = max(5, duration_sec or SOCCER_DURATION_DEFAULT)
        self.scores = {"blue": 0, "red": 0}
        self.armed = {"blue": True, "red": True}
        self.winner = None
        self.ball = None  # GO 才把球放到中場
        self._ensure_striker("blue")  # 開賽前未指定的隊 → 自動補第一人
        self._ensure_striker("red")
        self._assign_spawns()
        self.status = "countdown"
        await self.broadcast_state()
        await self._begin_countdown()

    async def stop(self, reason: str = "teacher_stop") -> None:
        """老師手動停止（soccer_stop）/ 切關智能停止（reason='level_switch'）。

        倒數中或進行中皆可：先廣播 soccer_end（winner 依當下比分或 draw），再回 idle
        讓老師可直接開下一場。
        """
        if self.status not in ("countdown", "running"):
            return
        await self._end(reason)
        self.status = "idle"
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
        self.scores = {"blue": 0, "red": 0}
        self.armed = {"blue": True, "red": True}
        self.winner = None
        self.end_time = 0
        self.ball = None
        players = self._active()
        for p in players:
            p.striker = False
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
        self.status = "running"
        self.end_time = int(self.now_ms() + self.duration_sec * 1000)
        if self.mode == "ball":
            self._reset_ball()  # 球放中場（懸浮高度）
        players = self._active()
        for p in players:
            p.last_pos_ms = None  # GO 時全員傳送到出生點 → 重置測速基準
            p.est_speed = 0.0
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
            },
        )
        await self.broadcast_scores()
        logger.info(
            "[Soccer] 開始！%s %ss，藍 %d 紅 %d",
            self.mode,
            self.duration_sec,
            len(self._team("blue")),
            len(self._team("red")),
        )

    async def _end(self, reason: str) -> None:
        # 線上值 'done' 沿用 legacy（見模組 docstring）
        self.status = "done"
        blue, red = self.scores["blue"], self.scores["red"]
        self.winner = "blue" if blue > red else ("red" if red > blue else "draw")
        players = self._active()
        msg = {
            "type": "soccer_end",
            "reason": reason,
            "winner": self.winner,
            "scores": self.scores,
            "players": [self._player_info(p) for p in players],
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
        # 端牆：門環範圍是「洞」讓球飛過；球心過門面（|z| ≥ halfZ）且在門環半徑內 → 進球
        if abs(b.z) > f.half_z - BALL_RADIUS:
            in_ring = math.hypot(b.x, b.y - f.goal_y) < f.goal_r
            if in_ring:
                if abs(b.z) >= f.half_z:
                    await self._ball_goal(1 if b.z > 0 else -1)
            else:
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
        # 沿用 armed 機制：進球隊 armed=false，前鋒過中線回自家半場才恢復（防守方壓門）
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

    # ---------- tick（legacy setInterval 80ms 的對應）----------

    async def tick(self) -> None:
        """推進賽局：倒數、半場重置、球物理（ball 模式）、時間到判勝、全量位置廣播。"""
        now = self.now_ms()
        if self.status == "countdown":
            await self._tick_countdown()
        if self.status == "running":
            # 半場重置：得分後 armed=false 的隊，其前鋒過中線回自家半場 → 恢復可得分
            for team, cfg in self._teams.items():
                if self.armed[team]:
                    continue
                st = self._striker_of(team)
                if st is None:
                    continue
                own_half_neg = cfg["stationZ"] < 0  # 藍隊自家半場 z<0、紅隊 z>0
                if (st.z < 0) if own_half_neg else (st.z > 0):
                    self.armed[team] = True
                    await self.broadcast_scores()
            if self.mode == "ball":
                await self._tick_ball()
        if self.status == "running" and now >= self.end_time:
            await self._end("time")
        players = self._active()
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
