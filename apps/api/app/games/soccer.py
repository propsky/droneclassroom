"""games/soccer.py — 無人機足球多人連線對戰（伺服器權威）。

每隊人數上限看子類：F9A-A 5 人、F9A-B 3 人（WDSC 2.1）。教室人數可以少於上限。

行為對齊 legacy/server.js 的 SOCCER 區塊：自動平均分隊、每隊恰一前鋒（離線遞補）、
進球伺服器驗證、半場重置、tick 判勝與位置廣播。
與 legacy 的刻意差異：
- 倒數由 tick() 推進（legacy setTimeout；取消倒數 legacy 已有 soccer_reset，行為照舊）
- 位置級防作弊（base.py）：座標 clamp、速度上限
- 賽終狀態線上值沿用 legacy 的 'done'（shared/protocol.ts 註記 'ended' 與 legacy 實際不符，
  以 legacy 為準）
- 場地尺寸只在 soccer_presets.py（F9A-A／F9A-B）：soccer_state / soccer_go 下發
  完整 SoccerFieldDef（含護罩半徑），client 據此渲染。SOCCER_CLASS 選子類
- 玩法只有前鋒穿門（SoccerStartMsg.mode='striker'）：只有攻擊手穿對方圓環得分；
    得分後該隊全員先回己方半場才能再攻（F9A.8.4）。沒回完就再穿，這一球不算，不罰球。
    穿環看整顆護罩與行進方向，伺服器不單信 soccer_goal。
    整顆護罩穿出自家圓環是烏龍，雙方都不加分。
    警告／黃牌／紅牌按隊伍計（F9A.9）。墜機是安全事件，本局少一人，不發紅牌（F9A.8.5）。
    開賽先起槳再 3-2-1，倒數鎖控。倒數中離開起飛點的座標不採用，不另判罰球。
    賽制：一節 durationSec（預設 3 分鐘）、三局兩勝、局間休息。
    平手順序可設定，預設照 WDSC：先各罰 3 球 PK，仍平手再黃金進球。
    推球（mode='ball'）已移除。舊客戶端送來由 SoccerStartMode 拒絕，不開賽。
"""

import logging
import math
import random
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import WebSocket

from ..config import Settings
from ..protocol import SoccerPosMsg, SoccerStartMode
from ..roster import Roster, StudentRecord, send_safe
from .base import MIN_POS_INTERVAL_MS, BaseGame, FieldBounds, game_player_key
from .soccer_presets import F9A_A, SoccerClassSpec, preset_for
from .soccer_rules import (
    CROSS_GRANT_MS,
    PENALTY_SEC,
    RED_CLOSING_MPS,
    YELLOW_CLOSING_MPS,
    OwnGoal,
    false_start_radius,
    shield_passes_ring,
)

logger = logging.getLogger("creafly.api.games.soccer")

# ---------- 常數 ----------

SOCCER_DURATION_DEFAULT = 180  # 1 局 3 分鐘（測試可送較短 durationSec）
SOCCER_TEAM_NAMES = ("blue", "red")
# 三局兩勝（與 client 文案一致）
SOCCER_SETS_TO_WIN = 2
SOCCER_MAX_PERIODS = 3
SOCCER_BREAK_SEC = 15  # 局間休息
# PK 每一記 10 秒（PENALTY_SEC）。犯規罰球已拿掉，點球時鐘仍用這一個。
SOCCER_PK_MIN_ROUNDS = 3  # WDSC 8.7：先各罰 3 球
# 平手順序。預設 pk_then_golden = WDSC 8.7；golden_then_pk 把黃金進球放前面。
TieBreak = Literal["pk_then_golden", "golden_then_pk"]
TIE_BREAKS = ("pk_then_golden", "golden_then_pk")


@dataclass(frozen=True)
class SoccerField:
    """場地尺寸（資料驅動）：以 SoccerFieldDef 下發，client 據此渲染。

    數字不寫在這裡。from_spec / from_settings 只轉 soccer_presets 的那一份。
    half_x / half_z = 場地半寬 / 半長（長軸 z、中線 z=0）；
    goal_y = 門環中心高；goal_r = 門環內半徑；goal_tube = 管半徑；ceil = 天花板高。
    兩門在 z=±goal_z（自底線往場內 goal_inset，與 client 門環視覺同位置）；
    端牆 z=±half_z 是場地邊界。shield_r = 護罩半徑。
    """

    half_x: float
    half_z: float
    goal_y: float
    goal_r: float
    ceil: float
    goal_tube: float
    goal_inset: float
    shield_r: float
    start_depth: float
    max_players: int

    @property
    def goal_z(self) -> float:
        """門面 z（進球判定用；client 門環畫在同一位置）。"""
        return self.half_z - self.goal_inset

    @classmethod
    def from_spec(cls, spec: SoccerClassSpec | None = None) -> "SoccerField":
        """由子類預設建立。沒帶就用 F9A-A。"""
        chosen = F9A_A if spec is None else spec
        return cls(
            half_x=chosen.half_x,
            half_z=chosen.half_z,
            goal_y=chosen.goal_y,
            goal_r=chosen.goal_r,
            ceil=chosen.ceil,
            goal_tube=chosen.goal_tube,
            goal_inset=chosen.goal_inset,
            shield_r=chosen.shield_r,
            start_depth=chosen.start_depth,
            max_players=chosen.max_players,
        )

    @classmethod
    def from_settings(cls, cfg: Settings) -> "SoccerField":
        """由 SOCCER_CLASS 選 F9A-A 或 F9A-B（見 soccer_presets）。"""
        return cls.from_spec(preset_for(cfg.soccer_class))

    def start_width(self, players: int) -> float:
        """起飛區長度（沿底線）= 人數 × 球徑。兩隊畫一樣大，取人數較多的那隊。"""
        return max(1, players) * (self.shield_r * 2)

    def payload(self, start_width: float | None = None) -> dict[str, float]:
        """線上格式（SoccerFieldDef，欄位名 camelCase）。"""
        width = self.shield_r * 2 if start_width is None else start_width
        return {
            "halfX": self.half_x,
            "halfZ": self.half_z,
            "goalY": self.goal_y,
            "goalR": self.goal_r,
            "ceil": self.ceil,
            "goalTube": self.goal_tube,
            # 門面 z、護罩半徑一併下發（client 有帶就用，沒帶才 fallback）
            "goalZ": self.goal_z,
            "shieldR": self.shield_r,
            "startDepth": self.start_depth,
            "startWidth": width,
        }


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
    # 剛得分的那一隊：這台還沒回到己方半場（z 與自家站位同側）
    needs_return: bool = False
    # 牌面、本局不能飛、新局要不要把前鋒還給他、紅牌整場不能回來
    card: str | None = None
    disabled: bool = False
    restore_striker: bool = False
    ejected_match: bool = False
    # 伺服器自己看到的整顆穿越，soccer_goal 只能兌現這一段
    pending_cross: bool = False
    pending_cross_ms: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    # 倒數時是否已在起飛點報到（報到後再離開才算搶跑）
    spawn_checked_in: bool = False


class SoccerGame(BaseGame):
    """足球賽局（狀態自持，掛 app.state.soccer）。"""

    def __init__(
        self,
        roster: Roster,
        field: SoccerField | None = None,
        *,
        air_contact_cards: bool = False,
        tie_break: str = "pk_then_golden",
    ) -> None:
        super().__init__(roster)
        self.field = field or SoccerField.from_spec(F9A_A)
        # 空中機對機接近速度罰牌。預設關（2026 F9A.9 沒有這條）；教學可打開。
        # 打開時走警告 → 黃牌 → 紅牌，不是直接發牌。
        self.air_contact_cards = air_contact_cards
        self.tie_break_default: TieBreak = (
            tie_break if tie_break in TIE_BREAKS else "pk_then_golden"  # type: ignore[assignment]
        )
        self.tie_break: TieBreak = self.tie_break_default
        self._rng = random.Random()
        # 玩法固定前鋒穿門。推球已移除，開賽若送來 ball 會在 start() 拒絕。
        self.mode = SoccerStartMode.STRIKER
        self.end_time = 0
        self.duration_sec: float = SOCCER_DURATION_DEFAULT
        self.scores: dict[str, int] = {"blue": 0, "red": 0}
        self.armed: dict[str, bool] = {"blue": True, "red": True}  # 得分隊全員回半場前為 False
        self.winner: str | None = None
        self.players: dict[str, SoccerPlayer] = {}
        # 三局兩勝。phase：idle / period / break / golden / pk
        self.phase = "idle"
        self.period = 0
        self.sets: dict[str, int] = {"blue": 0, "red": 0}
        self.pk_scores: dict[str, int] = {"blue": 0, "red": 0}
        self.pk_taken: dict[str, int] = {"blue": 0, "red": 0}
        self.pk_turn: str | None = None
        self.pk_round = 0
        self.pk_first: str | None = None
        self.pk_shooter_id: str | None = None
        self.pk_defender_id: str | None = None
        self.pk_started = False
        # 同理由警告次數、隊伍黃牌張數（整場累計，不跨場）
        self.warnings: dict[str, dict[str, int]] = {"blue": {}, "red": {}}
        self.team_yellows: dict[str, int] = {"blue": 0, "red": 0}
        # 前鋒失能後的暫停換人，每局一次（F9A.8.5）
        self.timeout_used: dict[str, bool] = {"blue": False, "red": False}
        self._contact_latch: set[tuple[str, str]] = set()
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
        """自動平均分隊。每隊不超過子類上限（F9A-A 5、F9A-B 3）；兩邊都滿就先不編隊。"""
        cap = self.field.max_players
        others = [q for q in self._active() if q is not p]
        blue = sum(1 for q in others if q.team == "blue")
        red = sum(1 for q in others if q.team == "red")
        if blue >= cap and red >= cap:
            p.team = None
            return
        if blue >= cap:
            p.team = "red"
        elif red >= cap:
            p.team = "blue"
        else:
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

    def _flying(self, team: str) -> list[SoccerPlayer]:
        """還能飛的隊員（本局排除、整場出場的不算進起飛區）。"""
        return [p for p in self._team(team) if not p.disabled and not p.ejected_match]

    def _lineup(self, members: list[SoccerPlayer]) -> list[SoccerPlayer]:
        """前鋒放中間那一格，其餘由中間往外排。"""
        if not members:
            return []
        strikers = [p for p in members if p.striker]
        others = [p for p in members if not p.striker]
        n = len(members)
        mid = (n - 1) // 2
        line: list[SoccerPlayer | None] = [None] * n
        rest = others
        if strikers:
            line[mid] = strikers[0]
            rest = others + strikers[1:]
        slots = [i for i in range(n) if line[i] is None]
        slots.sort(key=lambda i: (abs(i - mid), i))
        for slot, p in zip(slots, rest, strict=True):
            line[slot] = p
        return [p for p in line if p is not None]

    def _start_player_count(self) -> int:
        """兩隊起飛區一樣大，長度跟人數較多的那隊走（至少 1 人）。"""
        n = 1
        for team in SOCCER_TEAM_NAMES:
            n = max(n, len(self._flying(team)))
        return n

    def field_payload(self) -> dict[str, float]:
        return self.field.payload(self.field.start_width(self._start_player_count()))

    def _assign_spawns(self) -> None:
        """出生點排在起飛區中線。間距 = 球徑 = 2 × 球半徑，前鋒居中。"""
        depth = self.field.start_depth
        ball_r = self.field.shield_r
        spacing = ball_r * 2
        for _team, cfg in self._teams.items():
            members = self._lineup(self._flying(_team))
            n = len(members)
            if n == 0:
                continue
            sign = -1.0 if cfg["stationZ"] < 0 else 1.0
            z = round(sign * (self.field.half_z - depth / 2), 2)
            for i, p in enumerate(members):
                x = (i - (n - 1) / 2.0) * spacing
                p.spawn_x = round(x, 2)
                p.spawn_z = z

    # ---------- payload 組裝（欄位名照 legacy 線上格式）----------

    def _player_info(self, p: SoccerPlayer) -> dict[str, Any]:
        return {
            "id": p.record.id,
            "name": p.record.name,
            "emoji": p.record.emoji,
            "team": p.team,
            "striker": bool(p.striker),
            "card": p.card,
            "disabled": bool(p.disabled),
        }

    def _spawns(self) -> list[dict[str, Any]]:
        return [{"id": p.record.id, "x": p.spawn_x, "z": p.spawn_z} for p in self._active()]

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
            "field": self.field_payload(),
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
            "pkFirst": self.pk_first,
            "pkShooterId": self.pk_shooter_id,
            "pkDefenderId": self.pk_defender_id,
            "tieBreak": self.tie_break,
        }

    def _clear_return_flags(self) -> None:
        for p in self.players.values():
            p.needs_return = False
        self.armed = {"blue": True, "red": True}

    def _sync_armed(self) -> None:
        """得分隊還有人沒回己方半場 → armed=false（整隊都不能再攻）。

        沒回完就再穿對方門，這一球不算，也不罰球。全員回到己方後下一球恢復計分。
        """
        for team in SOCCER_TEAM_NAMES:
            pending = any(p.needs_return for p in self._flying(team))
            self.armed[team] = not pending

    def _mark_team_return(self, team: str) -> None:
        """進球後，還能飛的隊員全都要回自己半場。"""
        for p in self._flying(team):
            p.needs_return = True
        self._sync_armed()

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
        """位置回報：clamp + 速度上限，並用這一段軌跡判穿環／搶跑／自家圓環。"""
        p = self._player_for(record)
        if p is None or not p.active or p.disconnected:
            return
        if p.disabled and self.status in ("running", "golden", "pk"):
            return
        if await self._guard_countdown(p, msg):
            return
        prev = (p.x, p.y, p.z) if p.last_pos_ms is not None else None
        prev_ms = p.last_pos_ms
        ok = await self._apply_pos(p, self._clamp, msg.x, msg.y, msg.z, msg.yaw, "足球")
        if not ok:
            return
        if prev is not None and prev_ms is not None and p.last_pos_ms is not None:
            dt_sec = max(MIN_POS_INTERVAL_MS, p.last_pos_ms - prev_ms) / 1000.0
            p.vx = (p.x - prev[0]) / dt_sec
            p.vy = (p.y - prev[1]) / dt_sec
            p.vz = (p.z - prev[2]) / dt_sec
            await self._on_segment(p, prev)
        else:
            p.vx = p.vy = p.vz = 0.0

    def _cross_fresh(self, p: SoccerPlayer) -> bool:
        return bool(p.pending_cross) and (self.now_ms() - p.pending_cross_ms) <= CROSS_GRANT_MS

    async def goal(self, record: StudentRecord) -> None:
        """進球宣告。沒有伺服器自己看到的整顆護罩穿越就拒絕（擋假得分）。"""
        p = self._player_for(record)
        if p is None or not p.active or p.disconnected or p.disabled:
            return
        if not self._cross_fresh(p):
            logger.info("[Soccer] 拒絕進球 %s：沒有整顆護罩穿越", record.name)
            return
        p.pending_cross = False
        if self.status == "pk":
            await self._pk_attempt(record)
            return
        if (
            self.status not in ("running", "golden")
            or not p.striker
            or p.team not in SOCCER_TEAM_NAMES
            or not self.armed.get(p.team, True)
        ):
            return
        self.scores[p.team] += 1
        ok = self._goal_ok(team=p.team, by=record.id, by_name=record.name)
        if self.status == "golden":
            await self._announce_goal(ok)
            logger.info(
                "[Soccer] ⚡ 黃金進球 %s（%s）！藍 %d : %d 紅",
                record.name,
                p.team,
                self.scores["blue"],
                self.scores["red"],
            )
            await self._end("golden")
            return
        # 正規局：只有得分隊要回己方半場才能再攻（F9A.8.4）。沒回完再穿不算，不罰球。
        self._mark_team_return(p.team)
        await self._announce_goal(ok)
        await self.broadcast_scores()
        logger.info(
            "[Soccer] ⚽ %s（%s）進球！藍 %d : %d 紅",
            record.name,
            p.team,
            self.scores["blue"],
            self.scores["red"],
        )

    # ---------- 老師訊息 ----------

    async def start(
        self, duration_sec: float, mode: str = "striker", tie_break: str | None = None
    ) -> None:
        """開始比賽：前鋒穿門。推球（ball）拒絕、維持現狀。比分與局數歸零後進入 3 秒倒數。"""
        accepted = SoccerStartMode.playable(mode)
        if accepted is None:
            logger.info("[Soccer] 推球模式已移除，拒絕開賽")
            return
        self.mode = accepted
        chosen = tie_break if tie_break in TIE_BREAKS else self.tie_break_default
        self.tie_break = chosen  # type: ignore[assignment]
        self.duration_sec = max(5, duration_sec or SOCCER_DURATION_DEFAULT)
        self.scores = {"blue": 0, "red": 0}
        self.sets = {"blue": 0, "red": 0}
        self.pk_scores = {"blue": 0, "red": 0}
        self.pk_taken = {"blue": 0, "red": 0}
        self.pk_turn = None
        self.pk_round = 0
        self.pk_first = None
        self.pk_shooter_id = None
        self.pk_defender_id = None
        self.pk_started = False
        self.period = 1
        self.phase = "period"
        self._clear_return_flags()
        self._clear_discipline(restore=True, match=True)
        self.winner = None
        self._ensure_striker("blue")  # 開賽前未指定的隊 → 自動補第一人
        self._ensure_striker("red")
        self._assign_spawns()
        self._clear_return_flags()
        for p in self._active():
            p.x, p.y, p.z = p.spawn_x, 0.4, p.spawn_z
            p.last_pos_ms = None
            p.spawn_checked_in = False
            p.pending_cross = False
        self.status = "countdown"
        await self.broadcast_state()
        await self._broadcast(self._active(), {"type": "soccer_arm"})
        await self._broadcast_teachers({"type": "soccer_arm"})
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
        if p is None or p.team == team or team not in SOCCER_TEAM_NAMES:
            return
        if sum(1 for q in self._team(team) if q is not p) >= self.field.max_players:
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
        self.pk_first = None
        self.pk_shooter_id = None
        self.pk_defender_id = None
        self.pk_started = False
        self._clear_return_flags()
        self._clear_discipline(restore=True, match=True)
        self.winner = None
        self.end_time = 0
        players = self._active()
        for p in players:
            p.striker = False
            p.needs_return = False
            if clear_teams:
                p.team = None
        if clear_teams:
            cap = self.field.max_players
            blue_n = red_n = 0
            for p in players:
                if blue_n <= red_n and blue_n < cap:
                    p.team = "blue"
                    blue_n += 1
                elif red_n < cap:
                    p.team = "red"
                    red_n += 1
                else:
                    p.team = None
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
        self._clear_discipline(restore=True, match=False)
        self._ensure_striker("blue")
        self._ensure_striker("red")
        if not first:
            self._assign_spawns()
        players = self._active()
        for p in players:
            p.last_pos_ms = None  # 傳送到出生點 → 重置測速基準
            p.vx = p.vy = p.vz = 0.0
            p.needs_return = False
            p.pending_cross = False
            p.spawn_checked_in = False
        self.end_time = int(self.now_ms() + self.duration_sec * 1000)
        await self._broadcast(
            players,
            {
                "type": "soccer_go",
                "endTime": self.end_time,
                "spawns": self._spawns(),
                "players": [self._player_info(p) for p in players],
                "field": self.field_payload(),
                "mode": self.mode,
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

    # ---------- 賽制：三局兩勝 / 局間 / 黃金進球 / PK ----------

    def _on_own_half(self, p: SoccerPlayer) -> bool:
        """己方半場：與自家站位同一側（中線 z=0 不算，必須過線）。"""
        cfg = self._teams.get(p.team or "")
        if cfg is None:
            return False
        return p.z < 0 if cfg["stationZ"] < 0 else p.z > 0

    async def _tick_returns(self) -> None:
        """回到己方半場的隊員解除 needs_return。全員到齊才恢復可攻。"""
        changed = False
        for p in self._active():
            # 伺服器剛把人放到點球點時 last_pos_ms 是空的，那個座標不算飛回家。
            if p.needs_return and p.last_pos_ms is not None and self._on_own_half(p):
                p.needs_return = False
                changed = True
        if changed:
            self._sync_armed()
            await self.broadcast_scores()

    async def _resolve_period(self) -> None:
        """一節時間到：進球多者贏下該局。先搶兩局結束；三局打完仍平手走平手順序。"""
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
        await self._begin_tiebreak()

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
        """黃金進球：時限與一節相同，先進球者勝。

        時間到仍 0:0，而且順序是先黃金、PK 還沒打過，才接著進 PK。
        """
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

    def _eligible(self, team: str) -> list[SoccerPlayer]:
        return [p for p in self._team(team) if not p.disabled and not p.ejected_match]

    def _place_pk_actors(self) -> None:
        """這一記的主罰與一名守方。主罰預設是前鋒。"""
        turn = self.pk_turn
        if turn not in SOCCER_TEAM_NAMES:
            return
        shooter = next(
            (p for p in self._eligible(turn) if p.record.id == self.pk_shooter_id), None
        )
        if shooter is None:
            named = self._striker_of(turn)
            if named is not None and named.disabled:
                named = None
            if named is None:
                members = self._eligible(turn)
                named = members[0] if members else None
            shooter = named
        self.pk_shooter_id = shooter.record.id if shooter else None
        if shooter is not None:
            x, z = self._pk_spot(turn)
            shooter.spawn_x, shooter.spawn_z = x, z
            shooter.x, shooter.y, shooter.z = x, 0.4, z
            shooter.last_pos_ms = None
            shooter.needs_return = False
            shooter.pending_cross = False
            shooter.vx = shooter.vy = shooter.vz = 0.0
        defender = self._pick_defender(self._other_team(turn))
        if defender is not None and shooter is not None and defender is shooter:
            defender = None
        self.pk_defender_id = defender.record.id if defender else None
        if defender is not None:
            z_def = self._defender_spot(turn)
            defender.spawn_x, defender.spawn_z = 0.0, z_def
            defender.x, defender.y, defender.z = 0.0, 0.4, z_def
            defender.last_pos_ms = None
            defender.vx = defender.vy = defender.vz = 0.0

    async def _arm_pk_clock(self) -> None:
        """開始（或換）一次 PK：10 秒，並把主罰、守方送到點上。"""
        self.end_time = int(self.now_ms() + PENALTY_SEC * 1000)
        self._place_pk_actors()
        await self.broadcast_scores(include_spawns=True)

    async def _begin_tiebreak(self) -> None:
        """三局打完局數相同。預設先 PK，另一種順序先打黃金進球。"""
        if self.tie_break == "pk_then_golden":
            await self._begin_pk()
        else:
            await self._begin_golden()

    async def _begin_pk(self) -> None:
        self.phase = "pk"
        self.status = "pk"
        self.pk_started = True
        self.pk_scores = {"blue": 0, "red": 0}
        self.pk_taken = {"blue": 0, "red": 0}
        self.pk_round = 1
        self.pk_first = self._rng.choice(list(SOCCER_TEAM_NAMES))
        self.pk_turn = self.pk_first
        self.pk_shooter_id = None
        self.pk_defender_id = None
        self._clear_return_flags()
        logger.info("[Soccer] 進入 PK，擲硬幣 %s 先罰", self.pk_first)
        await self._arm_pk_clock()

    async def claim_pk(self, record: StudentRecord) -> None:
        """這一記改由同隊另一人來罰（WDSC 8.7：可以換人，也可以同一人連罰）。"""
        if self.status != "pk" or self.pk_turn not in SOCCER_TEAM_NAMES:
            return
        p = self._player_for(record)
        if (
            p is None
            or not p.active
            or p.disconnected
            or p.disabled
            or p.ejected_match
            or p.team != self.pk_turn
        ):
            return
        if p.record.id == self.pk_shooter_id:
            return
        self.pk_shooter_id = p.record.id
        self._place_pk_actors()
        await self.broadcast_scores(include_spawns=True)
        logger.info("[Soccer] PK 換 %s 來罰", p.record.name)

    async def _pk_attempt(self, record: StudentRecord) -> None:
        """輪到的主罰穿對方圓環 = 這記點球命中，立刻換邊。"""
        p = self._player_for(record)
        if (
            p is None
            or not p.active
            or p.disconnected
            or p.disabled
            or p.record.id != self.pk_shooter_id
            or p.team != self.pk_turn
            or p.team not in SOCCER_TEAM_NAMES
        ):
            return
        self.pk_scores[p.team] += 1
        ok = self._goal_ok(team=p.team, by=record.id, by_name=record.name, pk=True)
        await self._announce_goal(ok)
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
            if self.pk_round >= SOCCER_PK_MIN_ROUNDS:
                if self.pk_scores["blue"] != self.pk_scores["red"]:
                    await self._end("pk")
                    return
                # 各罰滿 3 球仍平手：預設改黃金進球；黃金已經打過就結束成平手
                if self.tie_break == "pk_then_golden" and self.phase == "pk":
                    await self._begin_golden()
                    return
                await self._end("pk")
                return
            self.pk_round += 1
            self.pk_turn = self.pk_first or "blue"
            self.pk_shooter_id = None
        else:
            self.pk_turn = other
            self.pk_shooter_id = None
        await self._arm_pk_clock()

    # ---------- tick（legacy setInterval 80ms 的對應）----------

    def _goal_ok(
        self, *, team: str, by: str, by_name: str, own: bool = False, pk: bool = False
    ) -> dict[str, Any]:
        msg: dict[str, Any] = {
            "type": "soccer_goal_ok",
            "team": team,
            "by": by,
            "byName": by_name,
            "scores": dict(self.scores),
        }
        msg["own"] = bool(own)
        if pk:
            msg["pk"] = True
        return msg

    async def _announce_goal(self, msg: dict[str, Any]) -> None:
        """進球公告：房間裡每個在線學生和老師都要看到，不只上場的人。"""
        data = self._dump(msg)
        for record in self.roster.students:
            if record.connected and record.ws is not None:
                await send_safe(record.ws, data)
        await self.roster.send_raw_to_teachers(data)

    def _clear_discipline(self, *, restore: bool, match: bool) -> None:
        """新局清本局出場；match 時連警告、黃牌張數、紅牌整場出場一起清。"""
        if match:
            self.warnings = {"blue": {}, "red": {}}
            self.team_yellows = {"blue": 0, "red": 0}
        self.timeout_used = {"blue": False, "red": False}
        for p in self.players.values():
            if match:
                p.ejected_match = False
            if p.ejected_match:
                p.disabled = True
                p.card = "red"
                p.striker = False
                p.restore_striker = False
                p.pending_cross = False
                continue
            if restore and p.restore_striker:
                p.striker = True
            p.restore_striker = False
            p.disabled = False
            p.card = None
            p.pending_cross = False

    def _other_team(self, team: str) -> str:
        return "red" if team == "blue" else "blue"

    async def _guard_countdown(self, p: SoccerPlayer, msg: SoccerPosMsg) -> bool:
        """倒數中的位置。回 True 表示這筆不要套用。

        還沒在起飛點報到的舊座標直接丟掉（開賽前站在中場）。
        報到之後離開起飛點：這筆座標不採用，人留在起飛點。倒數照常走到 GO，不罰球。
        """
        if self.status != "countdown" or self.mode != "striker":
            return False
        dist = math.dist((msg.x, msg.y, msg.z), (p.spawn_x, 0.4, p.spawn_z))
        if dist <= false_start_radius(self.field.shield_r):
            p.spawn_checked_in = True
            return False
        return True

    async def _on_segment(self, p: SoccerPlayer, prev: tuple[float, float, float]) -> None:
        if self.mode != "striker" or p.disabled or p.team not in SOCCER_TEAM_NAMES:
            return
        curr = (p.x, p.y, p.z)
        if self.status == "pk":
            attack_z = self._teams[p.team]["attackGoalZ"]
            sign = 1.0 if attack_z > 0 else -1.0
            if (
                p.record.id == self.pk_shooter_id
                and p.team == self.pk_turn
                and shield_passes_ring(
                    prev,
                    curr,
                    goal_z=attack_z,
                    goal_y=self.field.goal_y,
                    goal_r=self.field.goal_r,
                    attack_sign=sign,
                    shield_r=self.field.shield_r,
                    half_thick=self.field.goal_tube,
                )
            ):
                p.pending_cross = True
                p.pending_cross_ms = self.now_ms()
            return
        if self.status not in ("running", "golden"):
            return
        if OwnGoal.shield_into_own(
            prev,
            curr,
            defend_goal_z=self._teams[p.team]["defendGoalZ"],
            goal_y=self.field.goal_y,
            goal_r=self.field.goal_r,
            half_thick=self.field.goal_tube,
            shield_r=self.field.shield_r,
        ):
            await self._announce_own_goal(p)
            return
        if not p.striker:
            return
        attack_z = self._teams[p.team]["attackGoalZ"]
        sign = 1.0 if attack_z > 0 else -1.0
        if not shield_passes_ring(
            prev,
            curr,
            goal_z=attack_z,
            goal_y=self.field.goal_y,
            goal_r=self.field.goal_r,
            attack_sign=sign,
            shield_r=self.field.shield_r,
            half_thick=self.field.goal_tube,
        ):
            return
        if not self.armed.get(p.team, True):
            # 隊上還有人沒回己方半場：這一球不算。不罰球，回齊之後下一球照常計分。
            return
        p.pending_cross = True
        p.pending_cross_ms = self.now_ms()

    async def _announce_own_goal(self, p: SoccerPlayer) -> None:
        """整顆護罩穿出自家圓環：比分不變，公告這球不算。"""
        if p.team not in SOCCER_TEAM_NAMES:
            return
        ok = self._goal_ok(team=p.team, by=p.record.id, by_name=p.record.name, own=True)
        await self._announce_goal(ok)
        logger.info(
            "[Soccer] 烏龍，%s（%s）穿出自家圓環，比分不變 藍 %d : %d 紅",
            p.record.name,
            p.team,
            self.scores["blue"],
            self.scores["red"],
        )

    def _pick_defender(self, team: str | None) -> SoccerPlayer | None:
        if team not in SOCCER_TEAM_NAMES:
            return None
        members = [p for p in self._team(team) if not p.disabled]
        nons = [p for p in members if not p.striker]
        if nons:
            return nons[0]
        return members[0] if members else None

    def _defender_spot(self, attack: str) -> float:
        """防守站在被攻的圓環往場內 1m。"""
        cfg = self._teams[attack]
        sign = 1.0 if cfg["attackGoalZ"] > 0 else -1.0
        return round(cfg["attackGoalZ"] - sign * 1.0, 2)

    async def crash(self, record: StudentRecord) -> None:
        """墜機自報：安全事件，本局少一人，不發紅牌（F9A.8.5）。"""
        p = self._player_for(record)
        if p is None or not p.active or p.disconnected or p.disabled:
            return
        if self.status not in ("running", "golden", "pk"):
            return
        await self._safety_out(p, "crash")

    async def _safety_out(self, p: SoccerPlayer, reason: str) -> None:
        if p.disabled or p.team not in SOCCER_TEAM_NAMES:
            return
        p.disabled = True
        p.card = None
        if p.striker:
            p.striker = False
            p.restore_striker = True
        msg = {
            "type": "soccer_safety",
            "by": p.record.id,
            "byName": p.record.name,
            "team": p.team,
            "reason": reason,
        }
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)
        await self.broadcast_state()
        logger.info("[Soccer] 安全事件 %s（%s），本局少一人", p.record.name, reason)

    async def warn(self, student_id: str, reason: str = "conduct") -> None:
        """老師（裁判）記一次警告。同理由兩次升黃牌。"""
        p = next((q for q in self._active() if q.record.id == student_id), None)
        if p is None or p.team not in SOCCER_TEAM_NAMES:
            return
        await self._give_warning(p, reason or "conduct")

    async def striker_timeout(self, record: StudentRecord, new_striker_id: str = "") -> None:
        """前鋒失能時，未失能的隊員可喊暫停換前鋒，每局一次（F9A.8.5）。"""
        if self.mode != "striker" or self.status not in ("running", "golden"):
            return
        caller = self._player_for(record)
        if (
            caller is None
            or not caller.active
            or caller.disconnected
            or caller.disabled
            or caller.team not in SOCCER_TEAM_NAMES
        ):
            return
        team = caller.team
        if self.timeout_used.get(team):
            return
        flying_striker = self._striker_of(team)
        if flying_striker is not None and not flying_striker.disabled:
            return
        if not any(q.disabled for q in self._team(team)):
            return
        candidates = [q for q in self._eligible(team) if q is not flying_striker]
        if not candidates:
            return
        nxt = next((q for q in candidates if q.record.id == new_striker_id), None)
        if nxt is None:
            nxt = candidates[0]
        for q in self._team(team):
            if q.striker and q is not nxt:
                q.striker = False
        nxt.striker = True
        nxt.restore_striker = False
        sign = -1.0 if self._teams[team]["stationZ"] < 0 else 1.0
        z = round(sign * (self.field.half_z - self.field.start_depth / 2), 2)
        nxt.spawn_x, nxt.spawn_z = 0.0, z
        nxt.x, nxt.y, nxt.z = 0.0, 0.4, z
        nxt.last_pos_ms = None
        nxt.needs_return = False
        nxt.pending_cross = False
        self.timeout_used[team] = True
        msg = {
            "type": "soccer_timeout",
            "team": team,
            "by": caller.record.id,
            "byName": caller.record.name,
            "strikerId": nxt.record.id,
            "spawns": [{"id": nxt.record.id, "x": nxt.spawn_x, "z": nxt.spawn_z}],
        }
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)
        await self.broadcast_state()
        logger.info("[Soccer] %s 暫停，%s 換上前鋒", team, nxt.record.name)

    async def _give_warning(self, p: SoccerPlayer, reason: str) -> None:
        """同理由第 2 次警告 → 黃牌（F9A.9.2／9.3）。按隊伍計，不記在個人。"""
        if p.disabled or p.ejected_match or p.team not in SOCCER_TEAM_NAMES:
            return
        if self.status not in ("running", "golden", "pk"):
            return
        bucket = self.warnings[p.team]
        bucket[reason] = bucket.get(reason, 0) + 1
        count = bucket[reason]
        msg = {
            "type": "soccer_warning",
            "by": p.record.id,
            "byName": p.record.name,
            "team": p.team,
            "reason": reason,
            "count": count,
        }
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)
        logger.info("[Soccer] 警告 %s（%s）第 %d 次", p.record.name, reason, count)
        if count >= 2:
            bucket[reason] = 0
            await self._give_yellow(p, reason)

    async def _give_yellow(self, p: SoccerPlayer, reason: str) -> None:
        """黃牌：這一位本局出場。同隊第 2 張黃牌改發紅牌（F9A.9.3／9.4）。"""
        if p.ejected_match or p.team not in SOCCER_TEAM_NAMES:
            return
        self.team_yellows[p.team] = self.team_yellows.get(p.team, 0) + 1
        if self.team_yellows[p.team] >= 2:
            await self._give_red(p, reason)
            return
        p.card = "yellow"
        p.disabled = True
        if p.striker:
            p.striker = False
            p.restore_striker = True
        await self._broadcast_card(p, "yellow", reason)

    async def _give_red(self, p: SoccerPlayer, reason: str) -> None:
        """紅牌：這一位整場出場，隊伍接下來少一人。"""
        if p.team not in SOCCER_TEAM_NAMES:
            return
        p.card = "red"
        p.disabled = True
        p.ejected_match = True
        p.restore_striker = False
        if p.striker:
            p.striker = False
        await self._broadcast_card(p, "red", reason)

    async def _broadcast_card(self, p: SoccerPlayer, color: str, reason: str) -> None:
        msg = {
            "type": "soccer_card",
            "card": color,
            "by": p.record.id,
            "byName": p.record.name,
            "team": p.team,
            "reason": reason,
        }
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)
        await self.broadcast_state()
        label = "紅牌" if color == "red" else "黃牌"
        logger.info("[Soccer] %s %s（%s）", label, p.record.name, reason)

    def _pair_closing(self, a: SoccerPlayer, b: SoccerPlayer) -> tuple[float, SoccerPlayer]:
        dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist < 1e-6:
            return 0.0, a
        nx, ny, nz = dx / dist, dy / dist, dz / dist
        relx, rely, relz = a.vx - b.vx, a.vy - b.vy, a.vz - b.vz
        closing = -(relx * nx + rely * ny + relz * nz)
        a_toward = -(a.vx * nx + a.vy * ny + a.vz * nz)
        b_toward = b.vx * nx + b.vy * ny + b.vz * nz
        return closing, a if a_toward >= b_toward else b

    async def _tick_contacts(self) -> None:
        """空中接近速度罰牌。預設不跑；air_contact_cards 是教學開關。

        墜機走 crash()，不經過這裡。
        """
        if not self.air_contact_cards:
            return
        if self.mode != "striker" or self.status not in ("running", "golden"):
            return
        players = [p for p in self._active() if not p.disabled]
        live: set[tuple[str, str]] = set()
        reach = self.field.shield_r * 2 + 0.05
        for i, a in enumerate(players):
            for b in players[i + 1 :]:
                key = tuple(sorted((a.record.id, b.record.id)))
                dist = math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
                if dist > reach:
                    self._contact_latch.discard(key)
                    continue
                live.add(key)
                if key in self._contact_latch:
                    continue
                closing, aggressor = self._pair_closing(a, b)
                if closing < YELLOW_CLOSING_MPS:
                    continue
                self._contact_latch.add(key)
                # 教學選項：接近太快記一次警告（同理由兩次才升黃牌）。更快的一擊直接黃牌。
                if closing >= RED_CLOSING_MPS:
                    await self._give_yellow(aggressor, "contact")
                else:
                    await self._give_warning(aggressor, "contact")
        self._contact_latch.intersection_update(live)

    async def tick(self) -> None:
        """推進賽局：倒數、回半場、節次／黃金／PK、碰撞罰牌、位置廣播。"""
        now = self.now_ms()
        if self.status == "countdown":
            await self._tick_countdown()
        if self.status in ("running", "golden"):
            await self._tick_returns()
            await self._tick_contacts()
        if self.status == "running" and now >= self.end_time:
            await self._resolve_period()
        elif self.status == "break" and now >= self.end_time:
            self.period += 1
            await self._open_period(first=False)
        elif self.status == "golden" and now >= self.end_time:
            if self.tie_break == "golden_then_pk" and not self.pk_started:
                await self._begin_pk()
            else:
                await self._end("golden")
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
