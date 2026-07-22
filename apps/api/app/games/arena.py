"""games/arena.py — 大亂鬥（balloon 搶氣球 / tag 鬼抓人），伺服器權威。

行為對齊 legacy/server.js 的 ARENA 區塊（狀態機、tick 判定、廣播格式全照舊）。
與 legacy 的刻意差異：
- 倒數由 tick() 推進（legacy setTimeout）
- 手動 / 智能停止（legacy 沒做）：老師 arena_stop 或在賽局中切關（load_level /
  race_start / reset_all）→ stop() 廣播 arena_end（reason 'teacher_stop' /
  'level_switch'、含當下排行）後回 idle；倒數中也可停
- 位置級防作弊（base.py）：座標 clamp、速度上限、arena_pop 距離驗證
"""

import logging
import math
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

from ..protocol import ArenaPopMsg, ArenaPosMsg, ArenaStartMsg
from ..roster import Roster, StudentRecord
from .base import BaseGame, FieldBounds

logger = logging.getLogger("creafly.api.games.arena")

# ---------- 常數（數值沿用 legacy）----------

ARENA_BALLOON_COUNT = 50
# 氣球生成範圍（x/z 對稱 ±、y 給上下限）
ARENA_BOUNDS = {"x": 22.0, "z": 22.0, "ymin": 1.5, "ymax": 10.0}
ARENA_RESPAWN_MS = 2500.0  # 氣球被戳破後的重生時間
ARENA_CATCH_DIST = 2.2  # 鬼抓人：鬼撞到逃跑者的距離（鬼較大）
ARENA_STUN_MS = 3000.0  # 被抓後暈眩＋傳送回出生點的時間，時間到自動復活（不淘汰）
ARENA_INVINCIBLE_MS = 2000.0  # 復活後額外無敵時間（可以動，但鬼抓不到），讓他有機會跑走
ARENA_TAG_WIN_MULT = 3  # 鬼隊勝利門檻：全場總抓捕數 >= 跑者人數 × 此倍數

# 防作弊（新增）：戳氣球時，玩家最後回報位置與氣球的最大距離。
# client 端戳破判定半徑約 1 出頭，加上位置回報延遲的漂移裕度
# （~100ms、極速 9 單位/秒 ≈ 0.9 單位）取 2.5；超過視為偽造 arena_pop → 丟棄 + strike
ARENA_POP_MAX_DIST = 2.5
# 防作弊（新增）：位置 clamp 邊界。x/z 同氣球場地；y 下限 0（地面）、
# 上限取氣球天花板 10 的兩倍，保留越過氣球頂端的正常飛行空間
ARENA_CLAMP = FieldBounds(max_x=22.0, max_z=22.0, min_y=0.0, max_y=20.0)


@dataclass
class Balloon:
    """一顆氣球（id 即陣列索引，與 legacy 相同）。"""

    id: int
    x: float
    y: float
    z: float
    alive: bool = True
    respawn_at: float = 0.0


@dataclass
class ArenaPlayer:
    """大亂鬥玩家狀態。active=False = 收過 arena_leave（分數保留）；斷線整筆移除。"""

    record: StudentRecord
    active: bool = True
    score: int = 0
    role: str = "runner"
    stunned_until: float = 0.0
    invincible_until: float = 0.0
    caught_count: int = 0
    x: float = 0.0
    y: float = 0.4
    z: float = 0.0
    yaw: float = 0.0
    spawn_x: float = 0.0
    spawn_z: float = 0.0
    # 防作弊：上次接受位置回報的時刻（None = 剛加入 / 剛被伺服器傳送，下一次回報不測速）
    last_pos_ms: float | None = None
    strikes: int = 0


class ArenaGame(BaseGame):
    """大亂鬥賽局（狀態自持，掛 app.state.arena）。"""

    def __init__(self, roster: Roster) -> None:
        super().__init__(roster)
        self.mode = "balloon"
        self.field = "grid"
        self.end_time = 0
        self.duration_sec: float = 180
        self.ghost_count = 1
        self.winner: str | None = None
        self.players: dict[str, ArenaPlayer] = {}
        self.balloons: list[Balloon] = []
        self._init_balloons()  # legacy 在模組載入時就先生一批

    # ---------- 內部狀態 ----------

    def _active(self) -> list[ArenaPlayer]:
        """在場玩家（加入中且連線中）— 對齊 legacy arenaPlayers()。"""
        return [p for p in self.players.values() if p.active and p.record.connected]

    def _stunned(self, p: ArenaPlayer) -> bool:
        return self.now_ms() < p.stunned_until

    def _invincible(self, p: ArenaPlayer) -> bool:
        """暈眩中也算無敵（涵蓋整段抓不到的時間）— 對齊 legacy isInvincible。"""
        return self.now_ms() < p.invincible_until

    def _rand_pos(self) -> tuple[float, float, float]:
        return (
            round((self.rng.random() * 2 - 1) * ARENA_BOUNDS["x"], 2),
            round(
                ARENA_BOUNDS["ymin"]
                + self.rng.random() * (ARENA_BOUNDS["ymax"] - ARENA_BOUNDS["ymin"]),
                2,
            ),
            round((self.rng.random() * 2 - 1) * ARENA_BOUNDS["z"], 2),
        )

    def _init_balloons(self) -> None:
        self.balloons = [
            Balloon(i, *self._rand_pos()) for i in range(ARENA_BALLOON_COUNT)
        ]

    def _assign_spawns(self) -> None:
        """把所有玩家平均散佈在一個圓上，避免 16 台疊在同一個出生點。"""
        players = self._active()
        n = len(players)
        r = 0.0 if n <= 1 else min(20.0, 9 + n * 0.6)
        for i, p in enumerate(players):
            ang = (i / max(1, n)) * math.pi * 2
            p.spawn_x = round(math.cos(ang) * r, 2)
            p.spawn_z = round(math.sin(ang) * r, 2)

    def _assign_roles(self) -> None:
        """鬼抓人：隨機指派 ghostCount 個鬼（至少留 1 個跑者），其餘為逃跑者。"""
        players = self._active()
        n = len(players)
        gc = max(1, min(int(self.ghost_count) or 1, max(1, n - 1)))
        idx = list(range(n))
        self.rng.shuffle(idx)
        ghost_set = set(idx[:gc])
        for i, p in enumerate(players):
            p.role = "ghost" if i in ghost_set else "runner"
            p.stunned_until = 0.0
            p.invincible_until = 0.0
            p.caught_count = 0

    # ---------- payload 組裝（欄位名照 legacy 線上格式）----------

    def _player_info(self, p: ArenaPlayer) -> dict[str, Any]:
        return {
            "id": p.record.id,
            "name": p.record.name,
            "emoji": p.record.emoji,
            "score": p.score,
            "role": p.role,
            "stunned": self._stunned(p),
            "invincible": self._invincible(p),
            "caughtCount": p.caught_count,
        }

    def _ranking(self) -> list[dict[str, Any]]:
        return sorted(
            (self._player_info(p) for p in self._active()),
            key=lambda x: -x["score"],
        )

    def _spawns(self) -> list[dict[str, Any]]:
        return [{"id": p.record.id, "x": p.spawn_x, "z": p.spawn_z} for p in self._active()]

    def _tag_winner(self) -> str:
        """鬼抓人勝負：全場總抓捕數 ≥ 跑者人數 × 倍數 → 鬼隊勝，否則跑者隊勝。"""
        players = self._active()
        total_catches = sum(p.score for p in players if p.role == "ghost")
        runners = sum(1 for p in players if p.role == "runner")
        return "ghosts" if total_catches >= max(1, runners * ARENA_TAG_WIN_MULT) else "runners"

    def snapshot(self) -> dict[str, Any]:
        return {
            "type": "arena_state",
            "status": self.status,
            "mode": self.mode,
            "field": self.field,
            "endTime": self.end_time,
            "durationSec": self.duration_sec,
            "balloons": (
                [{"id": b.id, "x": b.x, "y": b.y, "z": b.z} for b in self.balloons if b.alive]
                if self.mode == "balloon"
                else []
            ),
            "players": [self._player_info(p) for p in self._active()],
            "spawns": self._spawns(),
        }

    async def broadcast_scores(self) -> None:
        """排行廣播：在場玩家 + 老師後台。"""
        msg = {
            "type": "arena_scores",
            "scores": self._ranking(),
            "status": self.status,
            "endTime": self.end_time,
            "mode": self.mode,
            "field": self.field,
        }
        await self._broadcast(self._active(), msg)
        await self._broadcast_teachers(msg)

    # ---------- 學生訊息 ----------

    async def join(self, record: StudentRecord) -> None:
        """加入大亂鬥：位置歸零、分數保留（離開再加入不清空 — legacy 行為）。"""
        p = self.players.get(record.id)
        if p is None:
            p = ArenaPlayer(record=record)
            self.players[record.id] = p
        p.active = True
        p.record = record
        p.x, p.y, p.z, p.yaw = 0.0, 0.4, 0.0, 0.0
        p.last_pos_ms = None  # 新加入不測速第一筆回報
        await self._send(record, self.snapshot())
        await self.broadcast_scores()

    async def leave(self, record: StudentRecord) -> None:
        """離開大亂鬥（arena_leave 或加入足球時的互斥退出）。"""
        p = self.players.get(record.id)
        if p is None or not p.active:
            return
        p.active = False
        await self.broadcast_scores()

    async def drop(self, record: StudentRecord) -> None:
        """斷線清理：整筆移除；其他人會在下個 tick 的 arena_players 移除其分身。"""
        p = self.players.pop(record.id, None)
        if p is not None and p.active:
            await self.broadcast_scores()

    async def pos(self, record: StudentRecord, msg: ArenaPosMsg) -> None:
        """位置回報：clamp + 速度上限（防作弊，見 base.py）。"""
        p = self.players.get(record.id)
        if p is None or not p.active:
            return
        await self._apply_pos(p, ARENA_CLAMP, msg.x, msg.y, msg.z, msg.yaw, "大亂鬥")

    async def pop(self, record: StudentRecord, msg: ArenaPopMsg) -> None:
        """戳氣球：伺服器權威判定 + 距離驗證（防作弊，legacy 只驗氣球存活）。"""
        p = self.players.get(record.id)
        if self.status != "running" or p is None or not p.active:
            return
        if not 0 <= msg.id < len(self.balloons):
            return
        b = self.balloons[msg.id]
        if not b.alive:
            return
        dist = math.dist((p.x, p.y, p.z), (b.x, b.y, b.z))
        if dist > ARENA_POP_MAX_DIST:
            await self._strike(
                p, f"arena_pop 距氣球 {dist:.1f} 單位 > {ARENA_POP_MAX_DIST}，丟棄"
            )
            return
        b.alive = False
        b.respawn_at = self.now_ms() + ARENA_RESPAWN_MS
        p.score += 1
        await self._broadcast(self._active(), {"type": "arena_balloon", "id": b.id, "alive": False})
        await self.broadcast_scores()

    # ---------- 老師訊息 ----------

    async def start(self, msg: ArenaStartMsg) -> None:
        """開始大亂鬥：重置分數 / 角色、生氣球、指派出生點、進入 3-2-1 倒數。"""
        self.duration_sec = max(30, msg.durationSec or 180)  # legacy Math.max(30, … || 180)
        self.mode = msg.mode
        self.field = msg.field
        self.ghost_count = int(msg.ghostCount) or 1
        self.winner = None
        for p in self._active():
            p.score = 0
            p.role = "runner"
            p.stunned_until = 0.0
            p.invincible_until = 0.0
            p.caught_count = 0
        self._init_balloons()
        self._assign_spawns()
        self.status = "countdown"
        await self._broadcast(self._active(), self.snapshot())
        await self._begin_countdown()

    async def send_snapshot_to(self, ws: WebSocket) -> None:
        """arena_state_req：回一份完整快照給請求的老師。"""
        await self._send_ws(ws, self.snapshot())

    async def stop(self, reason: str = "teacher_stop") -> None:
        """老師手動停止（arena_stop）/ 切關智能停止（reason='level_switch'）。

        倒數中或進行中皆可：先廣播 arena_end（含當下排行；tag 進行中依當下抓捕數
        判勝，其餘沿用 'time'），再回 idle 讓老師可直接開下一場。
        """
        if self.status not in ("countdown", "running"):
            return
        # tag 進行中依當下抓捕數判勝；balloon / 倒數中（tag 還沒指派鬼）沿用 legacy 的 'time'
        in_tag_match = self.mode == "tag" and self.status == "running"
        winner = self._tag_winner() if in_tag_match else "time"
        await self._end(winner, reason)
        self.status = "idle"
        self.end_time = 0
        self._countdown_n = 0
        await self._broadcast(self._active(), self.snapshot())
        await self.broadcast_scores()
        logger.info("[Arena] 停止本場（%s），回 idle", reason)

    # ---------- 倒數 / 開賽 ----------

    async def _send_countdown(self, n: int) -> None:
        await self._broadcast(self._active(), {"type": "arena_countdown", "n": n})

    async def _go(self) -> None:
        """倒數結束：tag 這時才指派鬼（GO 才變身）→ running。"""
        if self.mode == "tag":
            self._assign_roles()
        self.status = "running"
        self.end_time = int(self.now_ms() + self.duration_sec * 1000)
        players = self._active()
        for p in players:
            p.last_pos_ms = None  # GO 時全員傳送到出生點 → 重置測速基準，避免誤判瞬移
        await self._broadcast(
            players,
            {
                "type": "arena_go",
                "mode": self.mode,
                "field": self.field,
                "endTime": self.end_time,
                "spawns": self._spawns(),
                "players": [self._player_info(p) for p in players],
            },
        )
        await self.broadcast_scores()
        ghosts = sum(1 for p in players if p.role == "ghost") if self.mode == "tag" else 0
        logger.info(
            "[Arena] 開始！%s %ss，%d 人，鬼 %d", self.mode, self.duration_sec, len(players), ghosts
        )

    async def _end(self, winner: str, reason: str = "time_up") -> None:
        """結束：廣播勝負（含老師端）與最終排行；reason 標記結束原因（時間到 / 停止 / 切關）。"""
        self.status = "ended"
        self.winner = winner
        players = self._active()
        msg = {
            "type": "arena_end",
            "mode": self.mode,
            "winner": winner,
            "ranking": self._ranking(),
            "players": [self._player_info(p) for p in players],
            "reason": reason,
        }
        await self._broadcast(players, msg)
        await self._broadcast_teachers(msg)  # 老師後台也要收到結束 / 勝負
        await self.broadcast_scores()
        logger.info("[Arena] 結束：%s winner=%s（%s）", self.mode, winner, reason)

    # ---------- tick（legacy setInterval 80ms 的對應）----------

    async def tick(self) -> None:
        """推進賽局：倒數、氣球重生、tag 碰撞、時間到判勝、全量位置廣播。"""
        now = self.now_ms()
        if self.status == "countdown":
            await self._tick_countdown()
        if self.status == "running":
            if self.mode == "balloon":
                await self._tick_balloon(now)
            else:
                await self._tick_tag(now)
        players = self._active()
        if players:
            await self._broadcast(
                players,
                {
                    "type": "arena_players",
                    "players": [
                        {
                            "id": p.record.id,
                            "name": p.record.name,
                            "emoji": p.record.emoji,
                            "role": p.role,
                            "stunned": self._stunned(p),
                            "invincible": self._invincible(p),
                            "x": p.x,
                            "y": p.y,
                            "z": p.z,
                            "yaw": p.yaw,
                        }
                        for p in players
                    ],
                },
            )

    async def _tick_balloon(self, now: float) -> None:
        """搶氣球：到點重生 + 時間到結束。"""
        for b in self.balloons:
            if not b.alive and b.respawn_at and now >= b.respawn_at:
                b.x, b.y, b.z = self._rand_pos()
                b.alive = True
                b.respawn_at = 0.0
                await self._broadcast(
                    self._active(),
                    {
                        "type": "arena_balloon",
                        "id": b.id,
                        "alive": True,
                        "x": b.x,
                        "y": b.y,
                        "z": b.z,
                    },
                )
        if now >= self.end_time:
            await self._end("time")

    async def _tick_tag(self, now: float) -> None:
        """鬼抓人：鬼撞到逃跑者 → 暈眩＋傳送回出生點，不淘汰、時間到自動復活繼續玩。"""
        players = self._active()
        ghosts = [p for p in players if p.role == "ghost"]
        runners = [p for p in players if p.role == "runner"]
        for r in runners:
            if self._invincible(r):  # 暈眩中或剛復活的無敵時間內，都抓不到
                continue
            for g in ghosts:
                dx, dy, dz = r.x - g.x, r.y - g.y, r.z - g.z
                if dx * dx + dy * dy + dz * dz < ARENA_CATCH_DIST * ARENA_CATCH_DIST:
                    r.stunned_until = now + ARENA_STUN_MS
                    r.invincible_until = now + ARENA_STUN_MS + ARENA_INVINCIBLE_MS
                    r.caught_count += 1
                    g.score += 1  # 鬼的抓捕數
                    r.last_pos_ms = None  # 被抓會被傳送回出生點 → 重置測速基準
                    await self._broadcast(
                        players,
                        {
                            "type": "arena_caught",
                            "id": r.record.id,
                            "by": g.record.id,
                            "byName": g.record.name,
                            "stunMs": int(ARENA_STUN_MS),
                        },
                    )
                    await self._send(
                        r.record,
                        {
                            "type": "arena_respawn",
                            "x": r.spawn_x,
                            "z": r.spawn_z,
                            "stunMs": int(ARENA_STUN_MS),
                            "invincibleMs": int(ARENA_INVINCIBLE_MS),
                        },
                    )
                    await self.broadcast_scores()
                    break
        # 勝負：時間到才判定 —— 鬼隊總抓捕數達門檻（跑者人數 × 倍數）算鬼隊贏，否則跑者隊贏
        if now >= self.end_time:
            await self._end(self._tag_winner())
